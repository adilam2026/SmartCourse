/**
 * Contrôle de scripts/rapport-foyer-prive.sh (intégration continue) : base FICTIVE au schéma de la production (025) avec un foyer
 * de test, puis une sauvegarde chiffrée déposée dans un stockage S3 LOCAL (MinIO). Aucune donnée réelle, aucun vrai secret.
 * Usage (depuis server/) : SRC_URL=… S3_ENDPOINT=… S3_BUCKET=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… BACKUP_KEY=… npx tsx scripts/seed-sauvegarde-test.ts
 */
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { createBackup, S3BackupStore } from "../src/backup.js";
import { createPool } from "../src/db.js";
import { MIGRATIONS_DIR, migrate } from "../src/migrate.js";
import { s3ClientFromParts } from "../src/photos.js";

const env = process.env as Record<string, string>;
const dir = mkdtempSync(path.join(os.tmpdir(), "mig025-"));
for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x < "026")) copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
const db = createPool(env.SRC_URL);
await migrate(db, dir);
const fam = (await db.query("INSERT INTO families (code, name) VALUES ('TESTFOY1','Foyer de test') RETURNING id")).rows[0].id as string;
const add = async (key: string, extended: boolean, unit: string) => {
  const r = (await db.query(extended ? "SELECT id, name, category FROM extended_catalog WHERE key = $1" : "SELECT key, name, category FROM initial_catalog WHERE key = $1", [key])).rows[0];
  return (await db.query("INSERT INTO products (family_id, category, name, catalog_key, extended_id, unit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [fam, r.category, r.name, extended ? null : key, extended ? r.id : null, unit])).rows[0].id as string;
};
const sucre = await add("sucre", false, "pot");            // unité choisie par la famille : conservée et signalée par le rapport
await add("miel", false, "pot");                            // unité du catalogue (025) : suit les décisions
const melon = await add("melon", true, "kg");               // unité du catalogue : passe à la pièce, prix au kg à compléter
await db.query("INSERT INTO family_prices (family_id, product_id, amount, ref_qty, ref_unit) VALUES ($1,$2,5.2,1,'kg'), ($1,$3,4,1,'kg')", [fam, sucre, melon]);

const s3 = s3ClientFromParts({ endpoint: env.S3_ENDPOINT, region: "auto", accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY });
await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET })).catch(() => {});
const r = await createBackup({ db, databaseUrl: env.SRC_URL, store: new S3BackupStore(s3, env.S3_BUCKET), passphrase: env.BACKUP_KEY });
console.log(`Sauvegarde fictive déposée : ${r.key} (${r.bytes} octets)`);
await db.end();
