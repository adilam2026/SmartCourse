import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Db } from "./db.js";
import { checkLicense, savePhotoAsset, type PhotoStore } from "./photos.js";

const manifestSchema = z.object({
  items: z.array(
    z.object({
      target: z.enum(["initial", "extended"]),
      key: z.string(),
      file: z.string(),
      sourceName: z.string(),
      sourceUrl: z.string().url().nullish(),
      license: z.string(),
      licenseUrl: z.string().url().nullish(),
      author: z.string().nullish(),
    }),
  ),
});

export type Manifest = z.infer<typeof manifestSchema>;

export interface ImportResult {
  imported: string[];
  skipped: string[];
}

/**
 * Imports the photos of a manifest (paths relative to the manifest file).
 *  - Every entry is checked (licence, provenance) BEFORE anything is written: one refused entry imports nothing.
 *  - `onlyMissing` (used at startup): entries whose catalogue reference already has a photo are left alone, so
 *    restarting never duplicates or replaces anything.
 *  - Family products follow the initial catalogue photo only while they have none of their own (or still show the
 *    previous catalogue photo): a photo the family took itself is never overwritten.
 */
export async function importManifest(db: Db, store: PhotoStore, manifestPath: string, opts: { onlyMissing?: boolean } = {}): Promise<ImportResult> {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const where = (it: Manifest["items"][number]) => (it.target === "initial" ? { table: "initial_catalog", idCol: "key" } : { table: "extended_catalog", idCol: "id" });
  // All checks first (licence, provenance, known reference, readable file): one bad entry means nothing is written.
  const rows = new Map<Manifest["items"][number], { photo_asset_id: string | null }>();
  for (const it of manifest.items) {
    checkLicense(it);
    const { table, idCol } = where(it);
    const row = (await db.query(`SELECT photo_asset_id FROM ${table} WHERE ${idCol} = $1`, [it.key])).rows[0];
    if (!row) throw new Error(`Référence inconnue (${it.target}) : ${it.key}`);
    await readFile(path.resolve(path.dirname(manifestPath), it.file));
    rows.set(it, row);
  }
  const result: ImportResult = { imported: [], skipped: [] };
  for (const it of manifest.items) {
    const { table, idCol } = where(it);
    const row = rows.get(it)!;
    if (opts.onlyMissing && row.photo_asset_id) {
      result.skipped.push(`${it.target}:${it.key}`);
      continue;
    }
    const data = await readFile(path.resolve(path.dirname(manifestPath), it.file));
    const assetId = await savePhotoAsset(db, store, data, it, { ownerFamilyId: null });
    await db.query(`UPDATE ${table} SET photo_asset_id = $2 WHERE ${idCol} = $1`, [it.key, assetId]);
    if (it.target === "initial") {
      await db.query("UPDATE products SET photo_asset_id = $2 WHERE catalog_key = $1 AND photo_asset_id IS NOT DISTINCT FROM $3", [it.key, assetId, row.photo_asset_id]);
    }
    result.imported.push(`${it.target}:${it.key}`);
  }
  return result;
}
