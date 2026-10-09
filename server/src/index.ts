import { buildApp } from "./app.js";
import { ensureInstallToken } from "./auth.js";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { createBackupStore } from "./backup-store.js";
import { startBackupScheduler } from "./backup.js";
import { createPhotoStore } from "./photos.js";

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
await migrate(db);
if (config.INSTALL_TOKEN) await ensureInstallToken(db, config.INSTALL_TOKEN);

const app = await buildApp({ db, loginRateLimit: { max: config.LOGIN_RATE_MAX, timeWindow: "1 minute" }, store: createPhotoStore(config), webDir: existsSync(config.WEB_DIR) ? config.WEB_DIR : undefined, backupConfigured: !!config.BACKUP_KEY });
await app.listen({ port: config.PORT, host: "0.0.0.0" });

if (config.BACKUP_KEY) {
  startBackupScheduler({ db, databaseUrl: config.DATABASE_URL, store: createBackupStore(config), passphrase: config.BACKUP_KEY }, (m) => app.log.info(m));
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
