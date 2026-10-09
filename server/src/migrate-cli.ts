import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";

const db = createPool(loadConfig().DATABASE_URL);
const applied = await migrate(db);
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database up to date");
await db.end();
