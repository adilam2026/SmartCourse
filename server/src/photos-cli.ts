/**
 * Import de photos depuis un manifeste JSON (chemins relatifs au manifeste) :
 *   { "items": [ { "target": "initial", "key": "tomates", "file": "files/tomates.jpg",
 *                  "sourceName": "Wikimedia Commons", "sourceUrl": "...", "license": "CC-BY-SA-4.0",
 *                  "licenseUrl": "...", "author": "..." } ] }
 * Rien n'est importé si une seule entrée est refusée (licence, provenance). Option --only-missing : ignore les
 * références qui ont déjà une photo (c'est ce que fait le démarrage du serveur).
 */
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { createPhotoStore } from "./photos.js";
import { importManifest } from "./photos-import.js";

const args = process.argv.slice(2);
const [cmd, manifestPath] = args;
if (cmd !== "import" || !manifestPath) {
  console.log("Usage : photos-cli import <manifeste.json> [--only-missing]");
  process.exit(1);
}

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
try {
  await migrate(db);
  const r = await importManifest(db, createPhotoStore(config), manifestPath, { onlyMissing: args.includes("--only-missing") });
  for (const k of r.imported) console.log(`OK    ${k}`);
  for (const k of r.skipped) console.log(`déjà  ${k}`);
} finally {
  await db.end();
}
