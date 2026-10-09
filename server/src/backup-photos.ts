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
