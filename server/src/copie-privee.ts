import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { decrypt, listBackups, LocalBackupStore, S3BackupStore, selectTools, type BackupStore } from "./backup.js";
import { s3ClientFromParts } from "./photos.js";

/*
 * COPIE PRIVÉE d'une sauvegarde de production, CONSERVÉE pour un examen hors ligne (par exemple le rapport d'un foyer :
 * docs/catalogue/import-2026-11-01/rapport-foyer.sql). À lancer uniquement sur le poste de l'administrateur, jamais dans
 * l'intégration continue du dépôt public. Comme la restauration de contrôle, ce programme :
 *   - ne reçoit AUCUNE adresse de la base de production (refus si DATABASE_URL est défini) ;
 *   - ne restaure que vers un serveur PostgreSQL local (COPY_TARGET_URL : localhost, 127.0.0.1 ou le conteneur « copie-pg ») ;
 *   - n'écrit rien dans le stockage des sauvegardes (lecture seule) ;
 *   - n'affiche que des dates et des nombres, jamais une donnée de famille.
 * La copie reste dans une NOUVELLE base « copie_privee_<date> » du serveur local ; la supprimer après l'examen.
 */
const env = process.env;
const fail = (m: string): never => {
  console.error(`REFUS : ${m}`);
  process.exit(3);
};
if (env.DATABASE_URL) fail("DATABASE_URL est défini : cette copie ne doit jamais connaître l'adresse de la base de production.");
const target = env.COPY_TARGET_URL ?? fail("COPY_TARGET_URL manquant (serveur PostgreSQL local de la copie).");
if (!["localhost", "127.0.0.1", "copie-pg"].includes(new URL(target).hostname)) fail("la copie n'est autorisée que vers un serveur PostgreSQL local.");
const passphrase = env.BACKUP_KEY && env.BACKUP_KEY.length >= 16 ? env.BACKUP_KEY : fail("BACKUP_KEY manquante ou trop courte.");
const p = env.BACKUP_S3_BUCKET ? "BACKUP_S3_" : "S3_";
// COPY_LOCAL_DIR : sauvegardes d'un dossier local (contrôle du programme lui-même, sans stockage distant).
const store: BackupStore = env.COPY_LOCAL_DIR ? new LocalBackupStore(env.COPY_LOCAL_DIR) : new S3BackupStore(
  s3ClientFromParts({
    endpoint: env[`${p}ENDPOINT`], region: env[`${p}REGION`], accessKeyId: env[`${p}ACCESS_KEY_ID`], secretAccessKey: env[`${p}SECRET_ACCESS_KEY`],
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "false" ? false : undefined,
  }),
  env[`${p}BUCKET`] ?? fail("aucun stockage de sauvegardes (S3_BUCKET ou BACKUP_S3_BUCKET)."),
);

const all = await listBackups(store);
const pick = env.COPY_BACKUP ? all.find((e) => e.key.includes(env.COPY_BACKUP!)) : all[0];
if (!pick) fail(env.COPY_BACKUP ? `aucune sauvegarde ne correspond à « ${env.COPY_BACKUP} ».` : "aucune sauvegarde trouvée.");
console.log(`Sauvegarde utilisée : ${pick!.key.replace(/^backups\//, "")}, ${pick!.at.toISOString()}`);

const admin = new pg.Client({ connectionString: target });
await admin.connect();
const major = Math.floor(Number((await admin.query("SHOW server_version_num")).rows[0].server_version_num) / 10000);
const tools = selectTools(major);
if (!tools.ok) fail(tools.message);
const dbName = `copie_privee_${pick!.at.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
if ((await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName])).rows[0]) fail(`la base ${dbName} existe déjà : la supprimer d'abord (DROP DATABASE).`);
await admin.query(`CREATE DATABASE "${dbName}"`);
await admin.end();

const dir = mkdtempSync(path.join(os.tmpdir(), "copie-"));
try {
  const blob = (await store.get(pick!.key)) ?? fail("fichier de sauvegarde introuvable.");
  const file = path.join(dir, "copie.dump");
  writeFileSync(file, decrypt(blob as Buffer, passphrase), { mode: 0o600 });
  const url = new URL(target);
  url.pathname = `/${dbName}`;
  await promisify(execFile)(tools.pgRestore!, ["--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${url.toString()}`, file], { maxBuffer: 64 * 1024 * 1024 });
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  const mig = (await c.query("SELECT max(name) AS m, count(*)::int AS n FROM schema_migrations")).rows[0];
  const fam = (await c.query("SELECT count(*)::int AS n FROM families")).rows[0].n;
  await c.end();
  console.log(`Copie privée restaurée et CONSERVÉE : base « ${dbName} » (dernière migration ${mig.m}, ${mig.n} migrations, ${fam} familles).`);
  console.log(`Rapport foyer : psql "<adresse de la base ${dbName}>" -v famille=CODEFAMILLE -f docs/catalogue/import-2026-11-01/rapport-foyer.sql`);
} finally {
  rmSync(dir, { recursive: true, force: true }); // le fichier déchiffré ne reste jamais sur le disque
}
