import { buildApp } from "./app.js";
import { ensureInstallToken } from "./auth.js";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { createPhotoStore } from "./photos.js";

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
await migrate(db);
if (config.INSTALL_TOKEN) await ensureInstallToken(db, config.INSTALL_TOKEN);

const app = await buildApp({ db, loginRateLimit: { max: config.LOGIN_RATE_MAX, timeWindow: "1 minute" }, store: createPhotoStore(config), webDir: existsSync(config.WEB_DIR) ? config.WEB_DIR : undefined });
await app.listen({ port: config.PORT, host: "0.0.0.0" });

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
