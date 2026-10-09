import { backupVerifyPrune, checkBackupTools, createBackup, listBackups, pruneBackups, verifyBackup } from "./backup.js";
import { createBackupStorage } from "./backup-store.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";

const [cmd, arg] = process.argv.slice(2);
const config = loadConfig();
if (!config.BACKUP_KEY) {
  console.error("BACKUP_KEY est obligatoire (≥ 16 caractères). Conservez-la AUSSI hors de Railway.");
  process.exit(1);
}
const storage = createBackupStorage(config);
if (!storage) {
  console.error("Aucun stockage sûr : en production, configurez le bucket (S3_*), ou BACKUP_ALLOW_LOCAL=1 avec un volume persistant.");
  process.exit(1);
}
console.log(`Stockage des sauvegardes : ${storage.kind === "s3" ? `bucket ${config.S3_BUCKET}` : `dossier local ${config.BACKUP_DIR}`}`);
const db = createPool(config.DATABASE_URL);
const ctx = { db, databaseUrl: config.DATABASE_URL, store: storage.store, passphrase: config.BACKUP_KEY };
try {
  await migrate(db);
  if (cmd === "check") {
    const t = await checkBackupTools(db);
    console.log(`${t.ok ? "OK" : "ÉCHEC"} : ${t.message}`);
    if (!t.ok) process.exitCode = 2;
  } else if (cmd === "run") {
    const r = await backupVerifyPrune(ctx);
    console.log(`Sauvegarde : ${r.backup.key} (${r.backup.bytes} octets)`);
    console.log(r.verify.ok ? `Restauration vérifiée (${r.verify.restoredTables} tables conformes au manifeste).` : `RESTAURATION EN ÉCHEC :\n- ${r.verify.problems.join("\n- ")}`);
    if (r.pruned.length) console.log(`Supprimées (hors rétention) : ${r.pruned.join(", ")}`);
    if (!r.verify.ok) process.exitCode = 2;
  } else if (cmd === "backup") {
    const b = await createBackup(ctx);
    console.log(`Sauvegarde : ${b.key} — NON vérifiée tant que « verify » n'a pas réussi.`);
  } else if (cmd === "verify") {
    const key = arg ?? (await listBackups(ctx.store))[0]?.key;
    if (!key) throw new Error("Aucune sauvegarde à vérifier.");
    const v = await verifyBackup(ctx, key);
    console.log(v.ok ? `OK : ${key} restaurée et conforme (${v.restoredTables} tables).` : `ÉCHEC : ${key}\n- ${v.problems.join("\n- ")}`);
    if (!v.ok) process.exitCode = 2;
  } else if (cmd === "list") {
    for (const e of await listBackups(ctx.store)) console.log(`${e.at.toISOString()}  ${e.key}`);
  } else if (cmd === "prune") {
    console.log(`Supprimées : ${(await pruneBackups(ctx.store)).join(", ") || "aucune"}`);
  } else {
    console.log("Usage : backup-cli check | run | backup | verify [clé] | list | prune");
    process.exitCode = 1;
  }
} finally {
  await db.end();
}
