import { createPool, type Db } from "../src/db.js";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../src/migrate.js";
import { LocalPhotoStore } from "../src/photos.js";

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

const REFERENCE_TABLES = ["schema_migrations", "categories", "initial_catalog", "extended_catalog"];

/** Empties per-family data (keeps schema and reference catalogues) so each test file starts clean. */
export async function resetData(db: Db): Promise<void> {
  const t = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // replica role: FK checks and the photo_assets immutability trigger are bypassed for this test-only wipe.
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("UPDATE initial_catalog SET photo_asset_id = NULL");
    await client.query("UPDATE extended_catalog SET photo_asset_id = NULL");
    for (const { tablename } of t.rows) if (!REFERENCE_TABLES.includes(tablename)) await client.query(`DELETE FROM "${tablename}"`);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export const testStore = () => new LocalPhotoStore(mkdtempSync(path.join(os.tmpdir(), "photos-")));
