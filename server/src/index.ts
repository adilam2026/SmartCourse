import { buildApp } from "./app.js";
import { ensureInstallToken } from "./auth.js";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { createBackupStorage } from "./backup-store.js";
import { startBackupScheduler } from "./backup.js";
import { createPhotoStore } from "./photos.js";

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
await migrate(db);
if (config.INSTALL_TOKEN) await ensureInstallToken(db, config.INSTALL_TOKEN);

const backup = config.BACKUP_KEY ? createBackupStorage(config) : null;
const app = await buildApp({ db, loginRateLimit: { max: config.LOGIN_RATE_MAX, timeWindow: "1 minute" }, store: createPhotoStore(config), webDir: existsSync(config.WEB_DIR) ? config.WEB_DIR : undefined, backupStorage: backup?.kind ?? null });
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
