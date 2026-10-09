import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/migrate.js";
import { closeTestDb, testDb } from "./helpers.js";

afterAll(closeTestDb);

describe("socle", () => {
  it("/health répond ok quand la base est joignable", async () => {
    const app = await buildApp({ db: await testDb() });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("les migrations sont idempotentes", async () => {
    const db = await testDb();
    expect(await migrate(db)).toEqual([]);
  });

  it("une migration en échec est annulée et n'est pas enregistrée", async () => {
    const db = await testDb();
    const dir = await mkdtemp(path.join(os.tmpdir(), "mig-"));
    await writeFile(path.join(dir, "900_bad.sql"), "CREATE TABLE tmp_bad(a int); SELECT 1/0;");
    await expect(migrate(db, dir)).rejects.toThrow(/900_bad/);
    const t = await db.query("SELECT to_regclass('tmp_bad') AS t");
    expect(t.rows[0].t).toBeNull();
    const m = await db.query("SELECT 1 FROM schema_migrations WHERE name='900_bad.sql'");
    expect(m.rowCount).toBe(0);
  });

  it("deux migrateurs simultanés n'appliquent chaque migration qu'une fois", async () => {
    const db = await testDb();
    const dir = await mkdtemp(path.join(os.tmpdir(), "mig-"));
    await writeFile(path.join(dir, "901_once.sql"), "CREATE TABLE IF NOT EXISTS tmp_once(a int); INSERT INTO tmp_once VALUES (1);");
    const [a, b] = await Promise.all([migrate(db, dir), migrate(db, dir)]);
    expect(a.length + b.length).toBe(1);
    const n = await db.query("SELECT count(*)::int AS n FROM tmp_once");
    expect(n.rows[0].n).toBe(1);
    await db.query("DROP TABLE tmp_once; DELETE FROM schema_migrations WHERE name='901_once.sql'");
  });
});
