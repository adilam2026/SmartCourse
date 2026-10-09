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

/** Empties all data tables (keeps the schema) so each test file starts clean. */
export async function resetData(db: Db): Promise<void> {
  const t = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'",
  );
  if (t.rows.length) await db.query(`TRUNCATE ${t.rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}
