import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { withTx, type Db } from "./db.js";
import { checkLicense, insertPhotoAsset, preparePhoto, type PhotoStore, type PreparedPhoto } from "./photos.js";

const itemSchema = z.object({
  target: z.enum(["initial", "extended"]),
  key: z.string(),
  /** Exact product name expected for this key (guards against an image landing on the wrong product). */
  name: z.string().optional(),
  file: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  sourceName: z.string(),
  sourceUrl: z.string().url().nullish(),
  license: z.string(),
  licenseUrl: z.string().url().nullish(),
  author: z.string().nullish(),
});
const manifestSchema = z.object({ version: z.number().optional(), items: z.array(itemSchema) });

export type Manifest = z.infer<typeof manifestSchema>;
type Item = Manifest["items"][number];

export interface ImportResult {
  /** References whose image was added or replaced. */
  imported: string[];
  /** Left alone: already up to date (same source file) or, in onlyMissing mode, already illustrated. */
  skipped: string[];
}

const where = (it: Item) => (it.target === "initial" ? { table: "initial_catalog", idCol: "key" } : { table: "extended_catalog", idCol: "id" });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/**
 * Brings the catalogue images in line with a manifest — the manifest is the source of truth.
 *
 *  1. VERIFY everything first, writing nothing: provenance/licence, known reference, exact product name (when the
 *     manifest gives one), no duplicate key, file readable and decodable, SHA-256 equal to the manifest's.
 *     One bad entry aborts the whole run.
 *  2. WRITE the new files (content-addressed, so repeating is harmless).
 *  3. SWITCH in a single transaction: new assets are recorded and the references moved together. Nothing is half-done.
 *  4. READ BACK every new file from the storage; a mismatch raises (and nothing is purged afterwards).
 *
 * Idempotent: a reference whose current image came from the same source file (SHA-256) is left alone, so a restart or
 * a second deployment changes nothing. Family-owned (custom) pictures are never touched: only products that show a
 * shared catalogue image, or none, follow the catalogue.
 * `onlyMissing` (legacy) only illustrates references that have no image at all.
 */
export async function syncCatalogPhotos(db: Db, store: PhotoStore, manifestPath: string, opts: { onlyMissing?: boolean } = {}): Promise<ImportResult> {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const dir = path.dirname(manifestPath);

  // ---- 1. verify
  const seen = new Set<string>();
  const loaded = new Map<Item, { bytes: Buffer; inputSha: string; current: { id: string | null; source_sha256: string | null } }>();
  for (const it of manifest.items) {
    const id = `${it.target}:${it.key}`;
    if (seen.has(id)) throw new Error(`Clé en double dans le manifeste : ${id}`);
    seen.add(id);
    checkLicense(it);
    const { table, idCol } = where(it);
    const row = (await db.query(`SELECT * FROM ${table} WHERE ${idCol} = $1`, [it.key])).rows[0];
    if (!row) throw new Error(`Référence inconnue (${it.target}) : ${it.key}`);
    if (it.name !== undefined && row.name !== it.name) throw new Error(`Nom différent pour ${it.key} : « ${it.name} » dans le manifeste, « ${row.name} » dans le catalogue`);
    const bytes = await readFile(path.resolve(dir, it.file));
    const inputSha = sha(bytes);
    if (it.sha256 && it.sha256 !== inputSha) throw new Error(`Empreinte SHA-256 différente pour ${it.key} (${it.file})`);
    try {
      await sharp(bytes).metadata();
      await sharp(bytes).resize(8, 8).raw().toBuffer(); // really decodable, not just a valid header
    } catch {
      throw new Error(`Image illisible pour ${it.key} (${it.file})`);
    }
    const cur = row.photo_asset_id
      ? (await db.query("SELECT id, source_sha256 FROM photo_assets WHERE id = $1", [row.photo_asset_id])).rows[0]
      : { id: null, source_sha256: null };
    loaded.set(it, { bytes, inputSha, current: cur });
  }

  const result: ImportResult = { imported: [], skipped: [] };
  const todo: { it: Item; prepared: PreparedPhoto }[] = [];
  for (const it of manifest.items) {
    const l = loaded.get(it)!;
    const hasImage = !!l.current.id;
    const upToDate = opts.onlyMissing ? hasImage : l.current.source_sha256 === l.inputSha;
    if (upToDate) {
      result.skipped.push(`${it.target}:${it.key}`);
      continue;
    }
    // ---- 2. write files
    todo.push({ it, prepared: await preparePhoto(store, l.bytes, it) });
  }
  if (todo.length === 0) return result;

  // ---- 3. switch, all or nothing
  await withTx(db, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(727003)"); // two instances starting together: one at a time
    for (const { it, prepared } of todo) {
      const { table, idCol } = where(it);
      const assetId = await insertPhotoAsset(c, prepared, { ownerFamilyId: null });
      await c.query(`UPDATE ${table} SET photo_asset_id = $2 WHERE ${idCol} = $1`, [it.key, assetId]);
      if (it.target === "initial") {
        // Products follow the catalogue unless the family chose its own picture (owner_family_id set): never overwritten.
        await c.query(
          `UPDATE products SET photo_asset_id = $2
            WHERE catalog_key = $1
              AND (photo_asset_id IS NULL OR photo_asset_id IN (SELECT id FROM photo_assets WHERE owner_family_id IS NULL))`,
          [it.key, assetId],
        );
      }
      result.imported.push(`${it.target}:${it.key}`);
    }
  });

  // ---- 4. read back
  for (const { it, prepared } of todo) {
    const back = await store.get(prepared.img.key);
    if (!back || sha(back.data) !== prepared.img.hash) throw new Error(`Relecture du stockage échouée pour ${it.key} : l'ancien contenu ne sera pas purgé`);
  }
  return result;
}

/** Legacy name kept for the CLI and older tests: same behaviour. */
export const importManifest = syncCatalogPhotos;

export interface PurgeResult {
  assets: number;
  files: number;
  bytesFreed: number;
  keys: string[];
}

/**
 * Deletes pictures that NOTHING refers to any more — not a product (any family), not the initial or extended
 * catalogue, not the frozen snapshot of a closed list — together with their files in the storage.
 * A picture used by an archive is therefore always kept. Very recent uploads are spared (`minAgeMinutes`) so a
 * picture being linked right now is never taken away.
 * Order: database rows first (one transaction, refused by foreign keys anyway if something still points at them),
 * then the files, and a file is only removed when no remaining row uses the same content-addressed key.
 */
export async function purgeOrphanAssets(db: Db, store: PhotoStore, opts: { minAgeMinutes?: number; dryRun?: boolean } = {}): Promise<PurgeResult> {
  const minAge = opts.minAgeMinutes ?? 10;
  const orphan = `a.imported_at < now() - make_interval(mins => $1)
      AND NOT EXISTS (SELECT 1 FROM products p WHERE p.photo_asset_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM initial_catalog i WHERE i.photo_asset_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM extended_catalog e WHERE e.photo_asset_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM list_items li WHERE li.snapshot_photo_asset_id = a.id)`;
  if (opts.dryRun) {
    const r = await db.query(`SELECT a.id, a.storage_key FROM photo_assets a WHERE ${orphan}`, [minAge]);
    return { assets: r.rowCount ?? 0, files: 0, bytesFreed: 0, keys: [...new Set(r.rows.map((x) => x.storage_key as string))] };
  }
  const deleted = await withTx(db, async (c) => {
    await c.query("SET LOCAL app.photo_purge = 'on'"); // the only door through the immutability trigger
    const r = await c.query(`DELETE FROM photo_assets a WHERE ${orphan} RETURNING a.storage_key`, [minAge]);
    return r.rows.map((x) => x.storage_key as string);
  });
  let files = 0;
  let bytesFreed = 0;
  for (const key of new Set(deleted)) {
    const still = await db.query("SELECT 1 FROM photo_assets WHERE storage_key = $1 LIMIT 1", [key]);
    if (still.rowCount) continue; // another asset (same bytes) still needs the file
    const freed = await store.delete(key);
    if (freed > 0) files++;
    bytesFreed += freed;
  }
  return { assets: deleted.length, files, bytesFreed, keys: [...new Set(deleted)] };
}
