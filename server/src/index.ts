import { buildApp } from "./app.js";
import { ensureInstallToken } from "./auth.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { createBackupStorage } from "./backup-store.js";
import { startBackupScheduler } from "./backup.js";
import { createPhotoStore } from "./photos.js";
import { purgeOrphanAssets, syncCatalogPhotos } from "./photos-import.js";

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
await migrate(db);
if (config.INSTALL_TOKEN) await ensureInstallToken(db, config.INSTALL_TOKEN);

// Catalogue pictures shipped with the app (server/catalog-photos): the manifest is the source of truth. Verified, switched
// in one transaction, read back; then pictures nothing refers to any more are removed from the database AND the storage.
// Pictures the family chose itself are never touched, and none that an archive still shows is ever deleted.
const photoStore = createPhotoStore(config);
const photoManifest = path.resolve(config.PHOTO_MANIFEST);
let readBackOk = true;
if (existsSync(photoManifest)) {
  try {
    const r = await syncCatalogPhotos(db, photoStore, photoManifest);
    console.log(`Images du catalogue : ${r.imported.length} remplacée(s) ou ajoutée(s), ${r.skipped.length} déjà à jour.`);
  } catch (e) {
    readBackOk = false;
    console.error(`Synchronisation des images du catalogue impossible : ${(e as Error).message}`); // never prevents the app from starting
  }
}
const purgeOnce = async () => {
  try {
    const p = await purgeOrphanAssets(db, photoStore);
    if (p.assets) console.log(`Images inutilisées supprimées : ${p.assets} enregistrement(s), ${p.files} fichier(s), ${p.bytesFreed} octets libérés.`);
  } catch (e) {
    console.error(`Purge des images inutilisées impossible : ${(e as Error).message}`);
  }
};
if (readBackOk) await purgeOnce(); // after a failed switch nothing is purged
setInterval(() => void purgeOnce(), 6 * 3_600_000).unref();

const backup = config.BACKUP_KEY ? createBackupStorage(config) : null;
const app = await buildApp({ db, loginRateLimit: { max: config.LOGIN_RATE_MAX, timeWindow: "1 minute" }, store: photoStore, webDir: existsSync(config.WEB_DIR) ? config.WEB_DIR : undefined, backupStorage: backup?.kind ?? null });
await app.listen({ port: config.PORT, host: "0.0.0.0" });

if (backup && config.BACKUP_KEY) {
  startBackupScheduler({ db, databaseUrl: config.DATABASE_URL, store: backup.store, passphrase: config.BACKUP_KEY }, (m) => app.log.info(m));
  app.log.info(`Sauvegardes automatiques actives (stockage : ${backup.kind}).`);
} else if (config.BACKUP_KEY) {
  app.log.error("BACKUP_KEY présent mais aucun stockage sûr : configurez le bucket (S3_*). Sauvegardes automatiques DÉSACTIVÉES.");
} else {
  app.log.warn("BACKUP_KEY absent : aucune sauvegarde automatique n'est faite.");
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
