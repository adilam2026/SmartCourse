import { createPool, type Db } from "../src/db.js";
import { migrate } from "../src/migrate.js";

let pool: Db | undefined;

export async function testDb(): Promise<Db> {
  if (!pool) {
    pool = createPool(process.env.DATABASE_URL!);
    await migrate(pool);
  }
  return pool;
}

export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
