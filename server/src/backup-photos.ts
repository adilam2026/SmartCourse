import { createHash } from "node:crypto";
import sharp from "sharp";
import type { BackupStore } from "./backup.js";
import type { Db } from "./db.js";
import type { PhotoStore } from "./photos.js";

/**
 * Database backups hold the references to pictures, not the files. The 80 catalogue pictures ship with the app and are re-imported
 * from it; the pictures a family added exist only in the picture storage. This copies them (content-addressed, so a file is copied
 * once) to the independent backup storage under the same key (`photos/<sha256>.webp`): restoring is copying them back.
 */
export async function backupFamilyPhotos(db: Db, photos: PhotoStore, target: BackupStore): Promise<{ total: number; copied: number; missing: string[]; bytes: number }> {
  const keys = (await db.query<{ storage_key: string }>("SELECT DISTINCT storage_key FROM photo_assets WHERE owner_family_id IS NOT NULL ORDER BY 1")).rows.map((r) => r.storage_key);
  const have = new Set((await target.list("photos/")).map((e) => e.key));
  let copied = 0;
  let bytes = 0;
  const missing: string[] = [];
  for (const key of keys) {
    if (have.has(key)) continue;
    const f = await photos.get(key);
    if (!f) {
      missing.push(key); // referenced by the database but absent from the picture storage: reported, never hidden
      continue;
    }
    await target.put(key, f.data);
    copied++;
    bytes += f.data.length;
  }
  return { total: keys.length, copied, missing, bytes };
}

/**
 * Copying files is not a backup until they are proven restorable. Run on the RESTORED database: every picture a family added
 * (as the restored data lists them) must exist in the backup storage, be byte-for-byte the content the database recorded
 * (SHA-256 and size) and decode as an image. Returns the problems found (empty = complete).
 */
export async function verifyPhotoBackup(
  restored: { query: Db["query"] },
  target: BackupStore,
): Promise<{ problems: string[]; checked: number; bytes: number }> {
  const rows = (await restored.query("SELECT storage_key, content_hash, bytes FROM photo_assets WHERE owner_family_id IS NOT NULL ORDER BY storage_key")).rows as { storage_key: string; content_hash: string; bytes: number }[];
  const problems: string[] = [];
  let checked = 0;
  let total = 0;
  for (const r of rows) {
    const data = await target.get(r.storage_key);
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
