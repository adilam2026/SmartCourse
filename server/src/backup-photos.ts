import { createHash } from "node:crypto";
import sharp from "sharp";
import type { BackupStore } from "./backup.js";
import type { Db } from "./db.js";
import type { PhotoStore } from "./photos.js";

/**
 * Database backups hold the references to pictures, not the files. The 80 catalogue pictures ship with the app and are re-imported
 * from it; the pictures a family added exist only in the picture storage. They are copied (content-addressed, so a file is copied
 * once) to the independent backup storage under `backup-photos/<sha256>.webp` (a second copy even when it is the same bucket): restoring is copying them back (`restorePhotos`).
 *
 * Why a picture created or replaced WHILE a backup runs cannot make an inconsistent set:
 *   - a picture is immutable and named by its content: "modifying" one creates a new picture, the old one stays as long as something
 *     refers to it; no file is ever half-rewritten in place;
 *   - the file is written to the storage BEFORE its database row is committed, so any row a snapshot can see already has its file;
 *   - the backup lists its pictures in the SAME snapshot as the dump (manifest.photos), copies everything known before the snapshot
 *     (phase A), then whatever the snapshot lists that is still missing (phase B). The restored database is therefore always
 *     matched by files; pictures created after the snapshot belong to the next backup;
 *   - the only gap is a picture the snapshot lists whose file disappears before phase B (replaced and purged within minutes: the
 *     purge only removes pictures older than 10 minutes and unreferenced). It is reported, the backup is declared invalid and
 *     the previous good backups are kept; the next run repairs it.
 */
/** Where the backup copy of a picture lives: its own prefix, so that it is a real second copy even inside the same bucket. */
export const backupPhotoKey = (key: string) => `backup-photos/${key.slice(key.lastIndexOf("/") + 1)}`;

export async function copyPhotoKeys(photos: PhotoStore, target: BackupStore, keys: string[]): Promise<{ total: number; copied: number; missing: string[]; bytes: number }> {
  const have = new Set((await target.list("backup-photos/")).map((e) => e.key));
  let copied = 0;
  let bytes = 0;
  const missing: string[] = [];
  for (const key of keys) {
    const dest = backupPhotoKey(key);
    // An existing copy is trusted only if its content still matches its name (SHA-256): a damaged copy is rewritten, not kept forever.
    if (have.has(dest)) {
      const old = await target.get(dest);
      if (old && createHash("sha256").update(old).digest("hex") === dest.slice("backup-photos/".length, -".webp".length)) continue;
    }
    const f = await photos.get(key);
    if (!f) {
      missing.push(key); // referenced by the database but absent from the picture storage: reported, never hidden
      continue;
    }
    await target.put(dest, f.data);
    copied++;
    bytes += f.data.length;
  }
  return { total: keys.length, copied, missing, bytes };
}

/** Phase A: every picture the database lists now. */
export async function backupFamilyPhotos(db: Db, photos: PhotoStore, target: BackupStore): Promise<{ total: number; copied: number; missing: string[]; bytes: number }> {
  const keys = (await db.query<{ storage_key: string }>("SELECT DISTINCT storage_key FROM photo_assets WHERE owner_family_id IS NOT NULL ORDER BY 1")).rows.map((r) => r.storage_key);
  return copyPhotoKeys(photos, target, keys);
}

/** Phase B (`ctx.afterSnapshot`): the pictures the snapshot lists, then problems for any that cannot be found. */
export async function copySnapshotPhotos(photos: PhotoStore, target: BackupStore, manifest: { photos?: string[] }): Promise<string[]> {
  const r = await copyPhotoKeys(photos, target, manifest.photos ?? []);
  return r.missing.map((k) => `photos : ${k} listée par la sauvegarde mais absente du stockage d'images (remplacée et purgée entre l'instantané et la copie ?)`);
}

/**
 * Copying files is not a backup until they are proven restorable. Run on the RESTORED database: every picture a family added
 * (as the restored data lists them) must exist in the backup storage, be byte-for-byte the content the database recorded
 * (SHA-256 and size) and decode as an image. Returns the problems found (empty = complete).
 */
export async function verifyPhotoBackup(
  restored: { query: Db["query"] },
  target: BackupStore,
  manifestPhotos?: string[],
): Promise<{ problems: string[]; checked: number; bytes: number }> {
  const rows = (await restored.query("SELECT storage_key, content_hash, bytes FROM photo_assets WHERE owner_family_id IS NOT NULL ORDER BY storage_key")).rows as { storage_key: string; content_hash: string; bytes: number }[];
  const problems: string[] = [];
  let checked = 0;
  let total = 0;
  if (manifestPhotos) {
    // The restored data must list exactly the pictures the snapshot listed (nothing lost, nothing added by the restoration).
    const a = rows.map((r) => r.storage_key).join("\n");
    const b = [...manifestPhotos].sort().join("\n");
    if (a !== b) problems.push("la liste des photos de la base restaurée diffère de celle du manifeste");
  }
  for (const r of rows) {
    const data = await target.get(backupPhotoKey(r.storage_key));
    if (!data) {
      problems.push(`${r.storage_key} : absente de la sauvegarde`);
      continue;
    }
    if (createHash("sha256").update(data).digest("hex") !== r.content_hash) {
      problems.push(`${r.storage_key} : contenu différent de celui enregistré (empreinte SHA-256)`);
      continue;
    }
    if (data.length !== Number(r.bytes)) {
      problems.push(`${r.storage_key} : taille ${data.length} au lieu de ${r.bytes}`);
      continue;
    }
    try {
      const m = await sharp(data).metadata();
      if (!m.width || !m.height) throw new Error("dimensions");
    } catch {
      problems.push(`${r.storage_key} : image illisible`);
      continue;
    }
    checked++;
    total += data.length;
  }
  return { problems, checked, bytes: total };
}

/** Disaster recovery: puts back every family picture the (restored) database lists that the picture storage no longer has. */
export async function restorePhotos(db: Db, photos: PhotoStore, source: BackupStore): Promise<{ total: number; restored: number; present: number; missing: string[] }> {
  const keys = (await db.query<{ storage_key: string }>("SELECT DISTINCT storage_key FROM photo_assets WHERE owner_family_id IS NOT NULL ORDER BY 1")).rows.map((r) => r.storage_key);
  let restored = 0;
  let present = 0;
  const missing: string[] = [];
  for (const key of keys) {
    if (await photos.get(key)) {
      present++;
      continue;
    }
    const data = await source.get(backupPhotoKey(key));
    if (!data) {
      missing.push(key);
      continue;
    }
    await photos.put(key, data, "image/webp");
    restored++;
  }
  return { total: keys.length, restored, present, missing };
}

/** The three hooks that make a backup include the pictures: copy before, copy what the snapshot lists after, prove it after restoring. */
export function photoBackupHooks(db: Db, photos: PhotoStore, target: BackupStore, onChecked?: (c: { checked: number; bytes: number }) => void) {
  return {
    beforeSnapshot: async (): Promise<string[]> => (await backupFamilyPhotos(db, photos, target)).missing.map((k) => `photos : ${k} référencée par la base mais absente du stockage d'images`),
    afterSnapshot: (m: { photos?: string[] }) => copySnapshotPhotos(photos, target, m),
    afterRestore: async (scratch: { query: Db["query"] }, manifest: { photos?: string[] }): Promise<string[]> => {
      const r = await verifyPhotoBackup(scratch, target, manifest.photos);
      onChecked?.({ checked: r.checked, bytes: r.bytes });
      return r.problems.map((p) => `photos : ${p}`);
    },
  };
}
