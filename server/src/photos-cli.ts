/**
 * Import de photos depuis un manifeste JSON :
 *   { "items": [ { "target": "initial", "key": "tomates", "file": "./tomates.jpg",
 *                  "sourceName": "Wikimedia Commons", "sourceUrl": "...", "license": "CC-BY-SA-4.0",
 *                  "licenseUrl": "...", "author": "..." } ] }
 * target = "initial" (clé du catalogue initial) ou "extended" (id du catalogue étendu).
 * Chaque entrée passe le contrôle de licence et de provenance ; rien n'est importé si une entrée est refusée.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { checkLicense, createPhotoStore, savePhotoAsset } from "./photos.js";

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

const [cmd, manifestPath] = process.argv.slice(2);
if (cmd !== "import" || !manifestPath) {
  console.log("Usage : photos-cli import <manifeste.json>");
  process.exit(1);
}

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const store = createPhotoStore(config);
try {
  await migrate(db);
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  for (const it of manifest.items) checkLicense(it); // tout valider avant d'écrire quoi que ce soit
  for (const it of manifest.items) {
    const data = await readFile(path.resolve(path.dirname(manifestPath), it.file));
    const assetId = await savePhotoAsset(db, store, data, it, { ownerFamilyId: null });
    if (it.target === "initial") {
      const old = await db.query("SELECT photo_asset_id FROM initial_catalog WHERE key = $1", [it.key]);
      if (!old.rows[0]) throw new Error(`Clé inconnue dans le catalogue initial : ${it.key}`);
      await db.query("UPDATE initial_catalog SET photo_asset_id = $2 WHERE key = $1", [it.key, assetId]);
      // Les produits familiaux qui n'ont pas de photo propre suivent la photo du catalogue initial.
      await db.query(
        "UPDATE products SET photo_asset_id = $2 WHERE catalog_key = $1 AND photo_asset_id IS NOT DISTINCT FROM $3",
        [it.key, assetId, old.rows[0].photo_asset_id],
      );
    } else {
      await db.query("UPDATE extended_catalog SET photo_asset_id = $2 WHERE id = $1", [it.key, assetId]);
    }
    console.log(`OK  ${it.target}:${it.key}  (${it.license})`);
  }
} finally {
  await db.end();
}
