import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
await migrate(db);

const app = buildApp({ db });
await app.listen({ port: config.PORT, host: "0.0.0.0" });

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
