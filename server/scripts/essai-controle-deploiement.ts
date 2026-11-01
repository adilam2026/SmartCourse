/** Essai local de src/controle-migration.ts : base FICTIVE au schéma 025 (foyer de test), puis contrôle du déploiement. */
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { controleDeploiement } from "../src/controle-migration.js";
import { createPool } from "../src/db.js";
import { MIGRATIONS_DIR, migrate } from "../src/migrate.js";

const url = process.env.ESSAI_URL!;
const dir = mkdtempSync(path.join(os.tmpdir(), "mig025-"));
for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x < "026")) copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
const db = createPool(url);
await migrate(db, dir);
const fam = (await db.query("INSERT INTO families (code, name) VALUES ('TESTFOY1','Foyer de test') RETURNING id")).rows[0].id as string;
const add = async (key: string, extended: boolean, unit: string) => {
  const r = (await db.query(extended ? "SELECT id, name, category FROM extended_catalog WHERE key = $1" : "SELECT key, name, category FROM initial_catalog WHERE key = $1", [key])).rows[0];
  return (await db.query("INSERT INTO products (family_id, category, name, catalog_key, extended_id, unit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [fam, r.category, r.name, extended ? null : key, extended ? r.id : null, unit])).rows[0].id as string;
};
const sucre = await add("sucre", false, "kg");
await add("miel", false, "pot");
const melon = await add("melon", true, "kg");
await db.query("INSERT INTO family_prices (family_id, product_id, amount, ref_qty, ref_unit) VALUES ($1,$2,5.2,1,'kg'), ($1,$3,4,1,'kg')", [fam, sucre, melon]);
await db.end();
const c = new pg.Client({ connectionString: url });
await c.connect();
const r = await controleDeploiement(c, url, "./catalog-photos/manifest.json");
await c.end();
console.log(r.lines.join("\n"));
console.log("Écarts :", r.problems);
