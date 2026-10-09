/**
 * Outils d'exploitation des images du catalogue :
 *   photos-cli import <manifeste.json> [--only-missing]   synchronise les images du catalogue avec le manifeste
 *   photos-cli purge [--dry-run] [--min-age-minutes N]    supprime les images que plus rien ne référence (base + stockage)
 * Le manifeste est la source de vérité ; toutes les vérifications ont lieu avant la moindre écriture.
 */
import { loadConfig } from "./config.js";
import { createPoolFromConfig } from "./db.js";
import { hardenApiRoles } from "./harden.js";
import { migrate } from "./migrate.js";
import { createPhotoStore } from "./photos.js";
import { purgeOrphanAssets, syncCatalogPhotos } from "./photos-import.js";

const args = process.argv.slice(2);
const [cmd, manifestPath] = args;
const flag = (n: string) => args.includes(n);
const numArg = (n: string) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : undefined);
if (!(cmd === "import" && manifestPath) && cmd !== "purge") {
  console.log("Usage : photos-cli import <manifeste.json> [--only-missing] | purge [--dry-run] [--min-age-minutes N]");
  process.exit(1);
}

const config = loadConfig();
const db = createPoolFromConfig(config);
try {
  await migrate(db);
  await hardenApiRoles(db);
  const store = createPhotoStore(config);
  if (cmd === "import") {
    const r = await syncCatalogPhotos(db, store, manifestPath!, { onlyMissing: flag("--only-missing") });
    for (const k of r.imported) console.log(`OK    ${k}`);
    console.log(`${r.imported.length} remplacée(s) ou ajoutée(s), ${r.skipped.length} déjà à jour.`);
  } else {
    const p = await purgeOrphanAssets(db, store, { dryRun: flag("--dry-run"), minAgeMinutes: numArg("--min-age-minutes") });
    if (flag("--dry-run")) console.log(`Simulation, rien n'est supprimé : ${p.assets} enregistrement(s) d'image et ${p.keys.length} fichier(s) seraient supprimés.`);
    else console.log(`Supprimé : ${p.assets} enregistrement(s) d'image, ${p.files} fichier(s), ${p.bytesFreed} octets libérés.`);
  }
} finally {
  await db.end();
}
