import { previewUnitMigration } from "./migration-preview.js";
import { keepBackup, KEPT_PREFIX, listBackups, S3BackupStore, verifyBackup, type BackupStore } from "./backup.js";
import { verifyPhotoBackup } from "./backup-photos.js";
import { createPool } from "./db.js";
import { s3ClientFromParts } from "./photos.js";

/*
 * Restauration de CONTRÔLE d'une sauvegarde de production dans un serveur PostgreSQL ISOLÉ et jetable (conteneur de la vérification
 * GitHub Actions). Ce programme ne reçoit AUCUNE adresse de la base de production : il lit seulement le fichier chiffré et son manifeste
 * dans le stockage des sauvegardes, puis restaure dans RESTORE_TARGET_URL, qui doit désigner un serveur local (refus sinon).
 * Sortie publique : dates, nombres et résultats seulement (ni hôte, ni nom de stockage, ni donnée de famille).
 * Seule écriture possible, et seulement si on la demande : une COPIE protégée (préfixe backups-conservees/, jamais élagué) des
 * sauvegardes désignées par KEEP (fragments d'horodatage, ex. « 2026-10-17T09-18 ») et, avec KEEP_LATEST=1, de la plus récente
 * une fois sa restauration réussie. Rien n'est jamais supprimé ni modifié.
 */
const env = process.env;
const fail = (m: string): never => {
  console.error(`REFUS : ${m}`);
  process.exit(3);
};
if (env.DATABASE_URL) fail("DATABASE_URL est défini : ce contrôle ne doit jamais connaître l'adresse de la base de production.");
const target = env.RESTORE_TARGET_URL ?? fail("RESTORE_TARGET_URL manquant (serveur PostgreSQL jetable de la vérification).");
const host = new URL(target).hostname;
if (!["localhost", "127.0.0.1", "restore-pg"].includes(host)) fail("la restauration n'est autorisée que vers le serveur jetable local de la vérification.");
const passphrase = env.BACKUP_KEY && env.BACKUP_KEY.length >= 16 ? env.BACKUP_KEY : fail("BACKUP_KEY manquante ou trop courte.");
const p = env.BACKUP_S3_BUCKET ? "BACKUP_S3_" : "S3_";
const bucket = env[`${p}BUCKET`] ?? fail("aucun stockage de sauvegardes (S3_BUCKET ou BACKUP_S3_BUCKET).");
const store: BackupStore = new S3BackupStore(
  s3ClientFromParts({
    endpoint: env[`${p}ENDPOINT`], region: env[`${p}REGION`], accessKeyId: env[`${p}ACCESS_KEY_ID`], secretAccessKey: env[`${p}SECRET_ACCESS_KEY`],
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "false" ? false : undefined,
  }),
  bucket,
);

const db = createPool(target);
let photos: { checked: number; bytes: number } | null = null;
try {
  const all = await listBackups(store);
  const latest = all[0] ?? fail("aucune sauvegarde trouvée.");
  const ageH = (Date.now() - latest.at.getTime()) / 3_600_000;
  const mf = JSON.parse((await store.get(latest.key.replace(/\.dump\.enc$/, ".manifest.json")))?.toString() ?? "{}") as { createdAt?: string; pgDumpVersion?: string; tables?: Record<string, number>; migrations?: string[] };
  console.log(`Sauvegardes disponibles : ${all.length} ; plus récente : ${latest.key.replace(/^backups\//, "")}, ${latest.at.toISOString()} (il y a ${ageH.toFixed(1)} h)`);
  console.log(`Instantané du manifeste : ${mf.createdAt ?? "?"} ; pg_dump ${mf.pgDumpVersion ?? "?"} ; dernière migration ${mf.migrations?.at(-1) ?? "?"} ; ${Object.keys(mf.tables ?? {}).length} tables`);
  const v = await verifyBackup(
    {
      db, databaseUrl: target, store, passphrase,
      afterRestore: async (scratch, manifest) => {
        const r = await verifyPhotoBackup(scratch, store, manifest.photos);
        photos = { checked: r.checked, bytes: r.bytes };
        // Sur demande : aperçu d'une migration sur cette copie isolée (transaction annulée, totaux seulement).
        if (env.MIGRATION_PREVIEW) for (const line of await previewUnitMigration(scratch, env.MIGRATION_PREVIEW)) console.log(line);
        return r.problems.map((x) => `photos : ${x}`);
      },
    },
    latest.key,
  );
  for (const frag of (env.KEEP ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const hit = all.find((e) => e.key.includes(frag));
    if (!hit) { console.log(`CONSERVATION : aucune sauvegarde ne correspond à « ${frag} ».`); process.exitCode = 2; continue; }
    const k = await keepBackup(store, hit.key);
    console.log(`CONSERVATION : ${hit.key} → ${k.kept} (${k.already ? "copie déjà présente et identique" : "copie écrite puis relue identique"}, ${k.bytes} octets).`);
  }
  if (v.ok) {
    console.log(`RÉSULTAT : restauration RÉUSSIE dans un serveur isolé (${v.restoredTables} tables).`);
    if (env.KEEP_LATEST === "1") {
      const k = await keepBackup(store, latest.key);
      console.log(`CONSERVATION : sauvegarde vérifiée ${latest.key} → ${k.kept} (${k.already ? "déjà présente" : "copie relue identique"}).`);
    }
    console.log(`Copies conservées (hors élagage) : ${(await store.list(KEPT_PREFIX)).filter((e) => e.key.endsWith(".dump.enc")).length}.`);
    console.log("Contrôles : fichier chiffré et déchiffré avec la clé ; nombre de lignes de chaque table = manifeste ; liste des migrations identique ; invariants métier respectés (articles/achats, listes actives, administrateur par famille).");
    if (photos) console.log(`Photos de famille vérifiées : ${(photos as { checked: number }).checked} (empreinte, taille, image lisible).`);
    if (ageH > 36) {
      console.log(`ATTENTION : la plus récente a ${ageH.toFixed(0)} h : la sauvegarde quotidienne ne tourne peut-être plus.`);
      process.exitCode = 2;
    }
  } else {
    console.log(`RÉSULTAT : ÉCHEC\n- ${v.problems.join("\n- ")}`);
    process.exitCode = 2;
  }
} finally {
  await db.end();
}
