import { loadConfig } from "./config.js";
import { createPoolFromConfig } from "./db.js";
import { hardenApiRoles } from "./harden.js";
import { migrate } from "./migrate.js";

const db = createPoolFromConfig(loadConfig());
const applied = await migrate(db);
await hardenApiRoles(db);
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database up to date");
await db.end();
