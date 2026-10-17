import { buildApp } from "./app.js";
import { ensureInstallToken } from "./auth.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { createPoolFromConfig, toolsDatabaseUrl } from "./db.js";
import { hardenApiRoles } from "./harden.js";
import { migrate, pendingMigrations } from "./migrate.js";
import { createBackupStorage } from "./backup-store.js";
import { backupAndVerify, startBackupScheduler } from "./backup.js";
import { purgeOldSignups } from "./signup.js";
import { photoBackupHooks } from "./backup-photos.js";
import { createPhotoStore } from "./photos.js";
import { purgeOrphanAssets, syncCatalogPhotos } from "./photos-import.js";

const config = loadConfig();
const db = createPoolFromConfig(config);
// Sauvegarde de sécurité JUSTE AVANT d'appliquer des migrations en attente sur une base existante : créée, puis restaurée dans une
// base temporaire et comparée à son manifeste. Si elle n'est pas exploitable, le serveur s'arrête AVANT toute migration : avec le
// contrôle de santé Railway, la version précédente reste en service. Rien n'est supprimé (pas d'élagage ici).
const pending = await pendingMigrations(db);
if (pending.length > 0 && config.BACKUP_MODE !== "external") {
  const storage = config.BACKUP_KEY ? createBackupStorage(config) : null;
  if (!storage || !config.BACKUP_KEY) {
    console.error(`Migrations en attente (${pending.join(", ")}) mais aucune sauvegarde possible (BACKUP_KEY ou stockage absent) : arrêt avant migration.`);
    process.exit(1);
  }
  const r = await backupAndVerify({ db, databaseUrl: toolsDatabaseUrl(config), store: storage.store, passphrase: config.BACKUP_KEY, ...photoBackupHooks(db, createPhotoStore(config), storage.store) });
  if (!r.verify.ok) {
    console.error(`Sauvegarde avant migration NON exploitable (${r.backup.key}) : ${r.verify.problems.join(" ; ")}. Arrêt avant migration.`);
    process.exit(1);
  }
  console.log(`Sauvegarde avant migration : ${r.backup.key}, restaurée et conforme (${r.verify.restoredTables} tables). Migrations à appliquer : ${pending.join(", ")}.`);
}
await migrate(db);
// Managed PostgreSQL with a public Data API (Supabase): our tables must be reachable only through this server. Throws if not closed.
const hardened = await hardenApiRoles(db);
if (hardened.applied) console.log(`Tables protégées contre l'API de données (${hardened.tables} tables, rôles ${hardened.roles.join(", ")}).`);
if (config.INSTALL_TOKEN) await ensureInstallToken(db, config.INSTALL_TOKEN);

// Catalogue pictures shipped with the app (server/catalog-photos): the manifest is the source of truth. Verified, switched
// in one transaction, read back; then pictures nothing refers to any more are removed from the database AND the storage.
// Pictures the family chose itself are never touched, and none that an archive still shows is ever deleted.
const photoStore = createPhotoStore(config);
const photoManifest = path.resolve(config.PHOTO_MANIFEST);
let readBackOk = true;
if (existsSync(photoManifest)) {
  try {
    const r = await syncCatalogPhotos(db, photoStore, photoManifest);
    console.log(`Images du catalogue : ${r.imported.length} remplacée(s) ou ajoutée(s), ${r.skipped.length} déjà à jour.`);
  } catch (e) {
    readBackOk = false;
    console.error(`Synchronisation des images du catalogue impossible : ${(e as Error).message}`); // never prevents the app from starting
  }
}
const purgeOnce = async () => {
  try {
    const p = await purgeOrphanAssets(db, photoStore);
    if (p.assets) console.log(`Images inutilisées supprimées : ${p.assets} enregistrement(s), ${p.files} fichier(s), ${p.bytesFreed} octets libérés.`);
  } catch (e) {
    console.error(`Purge des images inutilisées impossible : ${(e as Error).message}`);
  }
};
if (readBackOk) await purgeOnce(); // after a failed switch nothing is purged
setInterval(() => void purgeOnce(), 6 * 3_600_000).unref();

// Demandes de création de famille et e-mails de code de plus de 30 jours : effacés au démarrage puis toutes les 6 heures,
// qu'il y ait ou non de nouvelles inscriptions.
const purgeSignups = async () => {
  try {
    await purgeOldSignups(db);
  } catch (e) {
    console.error(`Effacement des anciennes demandes de création impossible : ${(e as Error).message}`);
  }
};
await purgeSignups();
setInterval(() => void purgeSignups(), 6 * 3_600_000).unref();

const external = config.BACKUP_MODE === "external";
const backup = config.BACKUP_KEY || external ? createBackupStorage(config) : null;
const assetLinks = existsSync("./assetlinks.json") ? JSON.parse(readFileSync("./assetlinks.json", "utf8")) : undefined;
const app = await buildApp({ db, assetLinks, loginRateLimit: { max: config.LOGIN_RATE_MAX, timeWindow: "1 minute" }, store: photoStore, webDir: existsSync(config.WEB_DIR) ? config.WEB_DIR : undefined, backupStorage: external ? "s3" : backup?.kind ?? null, backupMode: config.BACKUP_MODE, brevoWebhookSecret: process.env.BREVO_WEBHOOK_SECRET, contactEmail: config.CONTACT_EMAIL, catalogManagers: (process.env.CATALOG_MANAGERS ?? "").split(/[\s,;]+/).filter((x) => /^[0-9a-f-]{36}$/i.test(x)) });
await app.listen({ port: config.PORT, host: "0.0.0.0" });

if (external) {
  // The scheduled job (external job, no longer shipped) makes, restores elsewhere and records the backups; the app does not run its own, and
  // says so loudly when the last verified one is old, so that a silent job failure cannot go unnoticed.
  const watch = async () => {
    const r = await db.query("SELECT max(at) AS v FROM backup_runs WHERE kind = 'verify' AND ok");
    const last = r.rows[0]?.v as Date | null;
    if (!last || Date.now() - last.getTime() > 36 * 3_600_000) app.log.error(`Sauvegarde externe : aucune restauration vérifiée depuis plus de 36 h (dernière : ${last ? last.toISOString() : "jamais"}).`);
  };
  app.log.info("Sauvegardes externes (BACKUP_MODE=external) : planificateur interne désactivé, état lu dans la base.");
  void watch().catch(() => {});
  setInterval(() => void watch().catch(() => {}), 6 * 3_600_000).unref();
} else if (backup && config.BACKUP_KEY) {
  startBackupScheduler({ db, databaseUrl: toolsDatabaseUrl(config), store: backup.store, passphrase: config.BACKUP_KEY, ...photoBackupHooks(db, photoStore, backup.store) }, (m) => app.log.info(m));
  app.log.info(`Sauvegardes automatiques actives (stockage : ${backup.kind}).`);
} else if (config.BACKUP_KEY) {
  app.log.error("BACKUP_KEY présent mais aucun stockage sûr : configurez le bucket (S3_*). Sauvegardes automatiques DÉSACTIVÉES.");
} else {
  app.log.warn("BACKUP_KEY absent : aucune sauvegarde automatique n'est faite.");
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
