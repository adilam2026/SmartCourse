import { type BackupCtx, backupVerifyPrune, checkBackupTools, createBackup, listBackups, pruneBackups, verifyBackup } from "./backup.js";
import { createBackupStorage } from "./backup-store.js";
import { loadConfig } from "./config.js";
import { backupFamilyPhotos, photoBackupHooks, restorePhotos } from "./backup-photos.js";
import { createPool, createPoolFromConfig, toolsDatabaseUrl } from "./db.js";
import { hardenApiRoles } from "./harden.js";
import { createPhotoStore } from "./photos.js";
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
// Never print bucket names or hosts: the scheduled job runs in a PUBLIC repository, whose logs are public.
console.log(`Stockage des sauvegardes : ${storage.kind === "s3" ? "stockage S3 (indépendant si BACKUP_S3_* est défini)" : "dossier local"}`);
const db = createPoolFromConfig(config);
// Restoration check on ANOTHER server when VERIFY_DATABASE_URL is given (required for a managed database, where a scratch database
// cannot be created next to the production one).
const verifyDb = config.VERIFY_DATABASE_URL ? createPool(config.VERIFY_DATABASE_URL) : null;
const external = config.BACKUP_MODE === "external";
let photoCheck: { checked: number; bytes: number } | null = null;
// Pictures of the picture storage (Railway bucket, or local in development). The family's pictures are part of every backup: copied,
// then proven restorable. In production without S3_BUCKET no backup storage exists anyway (see createBackupStorage).
const photoStore = createPhotoStore(config);
const ctx: BackupCtx = {
  db,
  databaseUrl: toolsDatabaseUrl(config),
  store: storage.store,
  passphrase: config.BACKUP_KEY,
  verify: verifyDb ? { db: verifyDb, url: config.VERIFY_DATABASE_URL! } : undefined,
  ...photoBackupHooks(db, photoStore, storage.store, (c) => (photoCheck = c)),
};
try {
  // In external mode this command runs from the scheduled job, possibly with code newer than the deployed app: the app alone
  // owns the schema, the job must never migrate (nor change grants on) the production database.
  if (config.BACKUP_MODE !== "external") {
    await migrate(db);
    await hardenApiRoles(db);
  }
  if (cmd === "check") {
    const t = await checkBackupTools(db);
    console.log(`${t.ok ? "OK" : "ÉCHEC"} : ${t.message}`);
    if (!t.ok) process.exitCode = 2;
  } else if (cmd === "run") {
    const r = await backupVerifyPrune(ctx);
    console.log(`Sauvegarde : ${r.backup.key} (${r.backup.bytes} octets)`);
    console.log(r.verify.ok ? `Restauration vérifiée (${r.verify.restoredTables} tables conformes au manifeste, fichier chiffré, déchiffré avec la clé).` : `RESTAURATION EN ÉCHEC :\n- ${r.verify.problems.join("\n- ")}`);
    if (r.verify.ok && photoCheck) console.log(`Photos vérifiées après restauration : ${(photoCheck as { checked: number }).checked} (empreinte SHA-256, taille, décodage).`);
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
  } else if (cmd === "photos") {
    const r = await backupFamilyPhotos(db, photoStore, ctx.store);
    console.log(`Photos de la famille : ${r.total} référencée(s), ${r.copied} copiée(s) (${r.bytes} octets), ${r.total - r.copied - r.missing.length} déjà présente(s).`);
    if (r.missing.length) {
      console.log(`ABSENTES du stockage d'images (référencées par la base) : ${r.missing.join(", ")}`);
      process.exitCode = 2;
    }
  } else if (cmd === "restore-photos") {
    // After restoring the database (see deploiement.md): puts back the family pictures missing from the picture storage.
    const r = await restorePhotos(db, photoStore, ctx.store);
    console.log(`Photos de la famille : ${r.total} référencée(s), ${r.restored} remise(s) en place, ${r.present} déjà présente(s).`);
    if (r.missing.length) {
      console.log(`INTROUVABLES dans la sauvegarde : ${r.missing.join(", ")}`);
      process.exitCode = 2;
    }
  } else if (cmd === "prune") {
    console.log(`Supprimées : ${(await pruneBackups(ctx.store)).join(", ") || "aucune"}`);
  } else {
    console.log("Usage : backup-cli check | run | backup | verify [clé] | photos | restore-photos | list | prune");
    process.exitCode = 1;
  }
} finally {
  await verifyDb?.end();
  await db.end();
}
