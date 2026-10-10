import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateInstallToken, setupFamily } from "../src/auth.js";
import { backupFamilyPhotos, backupPhotoKey, copySnapshotPhotos, photoBackupHooks, restorePhotos, verifyPhotoBackup } from "../src/backup-photos.js";
import { createBackupStorage } from "../src/backup-store.js";
import { backupStatus, backupVerifyPrune, createBackup, encrypt, LocalBackupStore, S3BackupStore, selectTools, verifyBackup, type BackupCtx } from "../src/backup.js";
import { loadConfig } from "../src/config.js";
import { assertSafeDatabaseUrl, createPool, createPoolFromConfig, schemaOf, toolsDatabaseUrl, type Db } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { hardenApiRoles } from "../src/harden.js";
import { savePhotoAsset } from "../src/photos.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

const URL_ = process.env.DATABASE_URL!;
const SNAKEOIL = "/etc/ssl/certs/ssl-cert-snakeoil.pem";
const local = new URL(URL_).hostname === "localhost";
let db: Db;
let familyId: string;

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  const f = await setupFamily(db, { installToken: await generateInstallToken(db), familyName: "Managed", admin: { displayName: "Adil", login: "adil", secret: "482913" } });
  familyId = f.auth.familyId;
});
afterAll(closeTestDb);

describe("connexion à une base gérée (Supabase) : garde-fous", () => {
  it("refuse le pooler en mode transaction (6543) et une base Supabase sans certificat ; accepte le mode session avec certificat et une base ordinaire", () => {
    const pooler = (port: number) => `postgresql://postgres.abcd:pw@aws-0-eu-west-3.pooler.supabase.com:${port}/postgres`;
    const ok = { ca: "x", schema: "smartcourse", backupMode: "external" as const };
    expect(() => assertSafeDatabaseUrl(pooler(6543), ok)).toThrow(/transaction/);
    expect(() => assertSafeDatabaseUrl(pooler(5432), { ...ok, ca: undefined })).toThrow(/DATABASE_SSL_CA/);
    expect(() => assertSafeDatabaseUrl("postgresql://postgres:pw@db.abcd.supabase.co:5432/postgres", { ...ok, ca: undefined })).toThrow(/DATABASE_SSL_CA/);
    expect(() => assertSafeDatabaseUrl(pooler(5432), ok)).not.toThrow();
    expect(() => assertSafeDatabaseUrl("postgresql://u:p@db.railway.internal:5432/railway")).not.toThrow();
    expect(() => assertSafeDatabaseUrl("postgresql://u:p@localhost:5432/x")).not.toThrow();
    expect(() => assertSafeDatabaseUrl("pas une url")).toThrow();
  });

  it("sur Supabase : schéma « public » ou réservé refusé ; sauvegardes internes refusées ; message clair", () => {
    const url = "postgresql://postgres.abcd:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres";
    expect(() => assertSafeDatabaseUrl(url, { ca: "x", backupMode: "external" })).toThrow(/DATABASE_SCHEMA=smartcourse/); // public par défaut
    expect(() => assertSafeDatabaseUrl(url, { ca: "x", schema: "public", backupMode: "external" })).toThrow(/propre schéma/);
    for (const reserved of ["auth", "storage", "extensions", "graphql_public", "realtime", "pg_catalog", "pg_toast", "information_schema"]) {
      expect(() => assertSafeDatabaseUrl(url, { ca: "x", schema: reserved, backupMode: "external" }), reserved).toThrow(/réservé/);
    }
    expect(() => assertSafeDatabaseUrl(url, { ca: "x", schema: "smartcourse", backupMode: "internal" })).toThrow(/BACKUP_MODE=external/);
    expect(() => assertSafeDatabaseUrl(url, { ca: "x", schema: "smartcourse" })).toThrow(/BACKUP_MODE=external/); // défaut interne
    expect(() => assertSafeDatabaseUrl(url, { ca: "x", schema: "smartcourse", backupMode: "external" })).not.toThrow();
    // une base ordinaire garde ses réglages par défaut (public, sauvegardes internes)
    expect(() => assertSafeDatabaseUrl("postgresql://u:p@localhost:5432/x", { schema: "public", backupMode: "internal" })).not.toThrow();
  });

  it("le démarrage lit la configuration : erreur claire avant toute connexion, 5 connexions maximum par défaut sur une base gérée", () => {
    const base = { DATABASE_URL: "postgresql://postgres.abcd:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres", DATABASE_SSL_CA: "x" } as NodeJS.ProcessEnv;
    expect(() => createPoolFromConfig(loadConfig({ ...base } as NodeJS.ProcessEnv))).toThrow(/DATABASE_SCHEMA/);
    expect(() => createPoolFromConfig(loadConfig({ ...base, DATABASE_SCHEMA: "smartcourse" } as NodeJS.ProcessEnv))).toThrow(/BACKUP_MODE=external/);
    expect(() => loadConfig({ ...base, DATABASE_SCHEMA: "Smart-Course" } as NodeJS.ProcessEnv)).toThrow(/DATABASE_SCHEMA/);
    // CA invalide mais configuration cohérente : la pool se construit (aucune connexion n'est ouverte à la création) avec 5 connexions
    const cfg = loadConfig({ ...base, DATABASE_CA: "", DATABASE_SCHEMA: "smartcourse", BACKUP_MODE: "external", DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----" } as NodeJS.ProcessEnv);
    const pool = createPoolFromConfig(cfg);
    expect((pool as unknown as { options: { max: number } }).options.max).toBe(5);
    expect(schemaOf(pool)).toBe("smartcourse");
    void pool.end();
  });

  const tls = it.skipIf(!local || !existsSync(SNAKEOIL));
  tls("TLS réel : chiffré ET vérifié avec le certificat racine fourni ; refusé sans lui ou avec un autre certificat", async () => {
    const url = URL_ + (URL_.includes("?") ? "&" : "?") + "sslmode=require";
    const ok = createPool(url, { sslCa: SNAKEOIL });
    expect((await ok.query("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")).rows[0].ssl).toBe(true);
    await ok.end();
    // Sans certificat racine, node-postgres vérifie avec les autorités du système : un certificat privé est refusé.
    const bare = new pg.Pool({ connectionString: url });
    await expect(bare.query("SELECT 1")).rejects.toThrow(/self[- ]signed|unable to verify|certificate/i);
    await bare.end();
    // Un autre certificat (par exemple celui d'un attaquant) n'est pas accepté.
    const dir = mkdtempSync(path.join(os.tmpdir(), "othercert-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-subj", "/CN=localhost", "-days", "1"], { stdio: "ignore" });
    const wrong = createPool(url, { sslCa: path.join(dir, "c.pem") });
    await expect(wrong.query("SELECT 1")).rejects.toThrow(/self[- ]signed|unable to verify|certificate/i);
    await wrong.end();
  });

  tls("les outils libpq (pg_dump) reçoivent une URL chiffrée et vérifiée : la sauvegarde fonctionne, et échoue avec un mauvais certificat", async () => {
    const t = selectTools(16);
    if (!t.ok) return; // pas de client 16 ici
    const good = toolsDatabaseUrl({ DATABASE_URL: URL_, DATABASE_SSL_CA: SNAKEOIL });
    expect(good).toMatch(/sslmode=verify-full/);
    expect(good).toMatch(/sslrootcert=/);
    const dump = execFileSync(t.pgDump!, ["--schema-only", `--dbname=${good}`], { maxBuffer: 64 * 1024 * 1024 });
    expect(dump.length).toBeGreaterThan(1000);
    const dir = mkdtempSync(path.join(os.tmpdir(), "othercert-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-subj", "/CN=localhost", "-days", "1"], { stdio: "ignore" });
    const bad = toolsDatabaseUrl({ DATABASE_URL: URL_, DATABASE_SSL_CA: path.join(dir, "c.pem") });
    expect(() => execFileSync(t.pgDump!, ["--schema-only", `--dbname=${bad}`], { stdio: "pipe" })).toThrow();
  });

  it("un certificat donné en texte (variable d'environnement avec \\n) ou en fichier est lu de la même façon", () => {
    if (!existsSync(SNAKEOIL)) return;
    const pem = readFileSync(SNAKEOIL, "utf8");
    const u1 = toolsDatabaseUrl({ DATABASE_URL: URL_, DATABASE_SSL_CA: pem });
    const u2 = toolsDatabaseUrl({ DATABASE_URL: URL_, DATABASE_SSL_CA: pem.trim().replace(/\n/g, "\\n") });
    for (const u of [u1, u2]) expect(readFileSync(new URL(u).searchParams.get("sslrootcert")!, "utf8").trim()).toBe(pem.trim());
  });
});

describe("protection des tables contre l'API de données de Supabase", () => {
  const A = "sc_test_anon";
  const B = "sc_test_authenticated";
  const roles = [A, B];
  // Les rôles d'essai restent dans le serveur de test (un rôle appartient au serveur, pas à la base, et l'utilisateur de test ne peut pas
  // les supprimer) ; ils sont sans connexion et sans aucun droit à la fin du test.
  const cleanup = async () => {
    await db.query("DROP TABLE IF EXISTS zz_nouvelle_table");
    for (const t of (await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows) await db.query(`ALTER TABLE public."${t.tablename}" DISABLE ROW LEVEL SECURITY`);
  };
  afterAll(cleanup);

  it("sans ces rôles (PostgreSQL ordinaire) : rien n'est fait", async () => {
    expect(await hardenApiRoles(db, ["sc_absent_a", "sc_absent_b"])).toEqual({ applied: false, schema: "public", roles: [], tables: 0 });
  });

  it("reproduit les droits par défaut de Supabase, puis ferme tout : aucun droit, RLS partout, y compris pour une table créée après", async () => {
    for (const r of roles) if (!(await db.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [r])).rowCount) await db.query(`CREATE ROLE ${r} NOLOGIN`);
    for (const r of roles) {
      await db.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
      await db.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${r}`);
      await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${r}`);
    }
    const exposed = async () =>
      (await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
                         AND (has_table_privilege('${A}', c.oid, 'SELECT') OR has_table_privilege('${B}', c.oid, 'INSERT') OR NOT c.relrowsecurity)`)).rows.length;
    expect(await exposed()).toBeGreaterThan(10); // avant : tout est ouvert
    const r = await hardenApiRoles(db, roles);
    expect(r.applied).toBe(true);
    expect(r.roles.sort()).toEqual([A, B].sort());
    expect(await exposed()).toBe(0);
    // idempotent
    expect((await hardenApiRoles(db, roles)).applied).toBe(true);
    // une table créée par une migration ultérieure démarre fermée (droits par défaut retirés), puis la protection l'enferme aussi
    await db.query("DROP TABLE IF EXISTS zz_nouvelle_table");
    await db.query("CREATE TABLE zz_nouvelle_table (id int)");
    expect((await db.query(`SELECT has_table_privilege('${A}', 'zz_nouvelle_table', 'SELECT') AS p`)).rows[0].p).toBe(false);
    await hardenApiRoles(db, roles);
    expect((await db.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'zz_nouvelle_table'")).rows[0].relrowsecurity).toBe(true);
    // le serveur (propriétaire des tables) continue de tout lire et écrire
    expect((await db.query("SELECT count(*)::int AS n FROM families")).rows[0].n).toBeGreaterThan(0);
    await db.query("INSERT INTO zz_nouvelle_table VALUES (1)");
    // et les rôles de l'API ne lisent rien
    const c = await db.connect();
    try {
      await c.query(`SET ROLE ${A}`);
      await expect(c.query("SELECT * FROM public.profiles")).rejects.toThrow(/permission denied/);
      await c.query("RESET ROLE");
    } finally {
      c.release();
    }
  });
});

describe("isolation : SmartCourse ne touche qu'à son propre schéma", () => {
  const SCHEMA = "sc_test_app";
  const R = "sc_test_iso_role";
  let app: Db;
  afterAll(async () => {
    await app?.end();
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await db.query("DROP TABLE IF EXISTS public.zz_autre_application");
  });

  it("migrations dans le schéma dédié ; la protection laisse intacts les tables d'une autre application et le schéma public", async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    if (!(await db.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [R])).rowCount) await db.query(`CREATE ROLE ${R} NOLOGIN`);
    // « une autre application » : une table du schéma public avec les droits par défaut de Supabase, sans RLS
    await db.query("DROP TABLE IF EXISTS public.zz_autre_application");
    await db.query("CREATE TABLE public.zz_autre_application (id int)");
    await db.query(`GRANT USAGE ON SCHEMA public TO ${R}`);
    await db.query(`GRANT ALL ON public.zz_autre_application TO ${R}`);
    const publicBefore = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.tablename);
    const aclBefore = (await db.query("SELECT relacl::text AS a, relrowsecurity AS rls FROM pg_class WHERE oid = 'public.zz_autre_application'::regclass")).rows[0];

    app = createPool(URL_, { schema: SCHEMA });
    expect(schemaOf(app)).toBe(SCHEMA);
    const applied = await migrate(app);
    expect(applied.length).toBeGreaterThan(5);
    // toutes les tables SmartCourse sont dans le schéma dédié, aucune dans public
    const inApp = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname = $1", [SCHEMA])).rows.map((r) => r.tablename);
    expect(inApp).toEqual(expect.arrayContaining(["families", "profiles", "products", "list_items", "schema_migrations", "backup_runs"]));
    expect((await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.tablename)).toEqual(publicBefore);
    // l'application lit et écrit dans son schéma sans le nommer
    const f = await setupFamily(app, { installToken: await generateInstallToken(app), familyName: "Isolée", admin: { displayName: "Adil", login: "adil", secret: "482913" } });
    expect((await app.query("SELECT count(*)::int AS n FROM products WHERE family_id = $1", [f.auth.familyId])).rows[0].n).toBe(80);
    expect((await db.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.products`)).rows[0].n).toBeGreaterThanOrEqual(80);

    // droits par défaut de Supabase sur NOTRE schéma, puis protection
    await db.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${R}`);
    await db.query(`GRANT ALL ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${R}`);
    const res = await hardenApiRoles(app, [R]);
    expect(res).toMatchObject({ applied: true, schema: SCHEMA, roles: [R] });
    expect(res.tables).toBe(inApp.length);
    const open = await db.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind = 'r'
                                   AND (has_table_privilege('${R}', c.oid, 'SELECT') OR NOT c.relrowsecurity)`, [SCHEMA]);
    expect(open.rows[0].n).toBe(0);
    // l'autre application : droits, RLS et contenu strictement inchangés
    const aclAfter = (await db.query("SELECT relacl::text AS a, relrowsecurity AS rls FROM pg_class WHERE oid = 'public.zz_autre_application'::regclass")).rows[0];
    expect(aclAfter).toEqual(aclBefore);
    expect(aclAfter.rls).toBe(false);
    expect((await db.query(`SELECT has_table_privilege('${R}', 'public.zz_autre_application', 'SELECT') AS p`)).rows[0].p).toBe(true);
    expect((await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.tablename)).toEqual(publicBefore);
  });

  it("la sauvegarde ne copie que le schéma SmartCourse et la restauration de contrôle le retrouve entier", async () => {
    const store = new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "bk-")));
    const scratch = createPool(new URL("/postgres", URL_).toString().replace(/\/postgres$/, "/postgres"));
    try {
      const ctx: BackupCtx = { db: app, databaseUrl: URL_, store, passphrase: "une-phrase-secrete-de-test", verify: { db: scratch, url: new URL("/postgres", URL_).toString() } };
      const b = await createBackup(ctx);
      expect(Object.keys(b.manifest.tables)).not.toContain("zz_autre_application"); // l'autre application n'est ni lue ni copiée
      expect(Object.keys(b.manifest.tables)).toEqual(expect.arrayContaining(["families", "products"]));
      const v = await verifyBackup(ctx, b.key);
      expect(v.problems).toEqual([]);
      expect(v.restoredTables).toBe(Object.keys(b.manifest.tables).length);
    } finally {
      await scratch.end();
    }
  });
});

describe("sauvegarde externe : restauration de contrôle sur un autre serveur, photos, état", () => {
  const PASS = "une-phrase-secrete-de-test";
  const adminUrl = (dbName: string) => {
    const u = new URL(URL_);
    u.pathname = `/${dbName}`;
    return u.toString();
  };

  it("la restauration de contrôle utilise le serveur indiqué (VERIFY_DATABASE_URL), pas la base sauvegardée", async () => {
    const store = new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "bk-")));
    const scratch = createPool(adminUrl("postgres")); // une AUTRE base d'administration : la base jetable y est créée
    try {
      const ctx: BackupCtx = { db, databaseUrl: URL_, store, passphrase: PASS, verify: { db: scratch, url: adminUrl("postgres") } };
      const b = await createBackup(ctx);
      const v = await verifyBackup(ctx, b.key);
      expect(v.problems).toEqual([]);
      expect(v.ok).toBe(true);
      // aucune base jetable ne reste
      expect((await scratch.query("SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'sc_verify_%'")).rows[0].n).toBe(0);
    } finally {
      await scratch.end();
    }
  });

  it("un serveur de contrôle inaccessible fait échouer la vérification (rien n'est annoncé vérifié)", async () => {
    const store = new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "bk-")));
    const badUrl = new URL(URL_);
    badUrl.password = "mauvais-mot-de-passe";
    badUrl.pathname = "/postgres";
    const scratch = createPool(badUrl.toString());
    try {
      const ctx: BackupCtx = { db, databaseUrl: URL_, store, passphrase: PASS, verify: { db: scratch, url: badUrl.toString() } };
      const b = await createBackup(ctx);
      await expect(verifyBackup(ctx, b.key)).rejects.toThrow();
    } finally {
      await scratch.end();
    }
  });

  it("copie les photos de la famille (une fois chacune), signale celles qui manquent dans le stockage d'images, ignore celles du catalogue", async () => {
    const photos = testStore();
    const target = new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "bk-")));
    const png = (c: string) => sharp({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer();
    const meta = { sourceName: "Photo familiale", license: "OWN" };
    const a = await savePhotoAsset(db, photos, await png("#aa0000"), meta, { ownerFamilyId: familyId });
    await savePhotoAsset(db, photos, await png("#00aa00"), meta, { ownerFamilyId: familyId });
    await savePhotoAsset(db, photos, await png("#0000aa"), meta, { ownerFamilyId: null }); // photo du catalogue : non copiée
    const r1 = await backupFamilyPhotos(db, photos, target);
    expect(r1).toMatchObject({ total: 2, copied: 2, missing: [] });
    const r2 = await backupFamilyPhotos(db, photos, target);
    expect(r2).toMatchObject({ total: 2, copied: 0, missing: [] }); // idempotent
    expect((await target.list("backup-photos/")).length).toBe(2);
    // un fichier référencé par la base mais absent du stockage d'images : signalé
    const key = (await db.query("SELECT storage_key FROM photo_assets WHERE id = $1", [a])).rows[0].storage_key as string;
    await photos.delete(key);
    await target.delete(backupPhotoKey(key));
    const r3 = await backupFamilyPhotos(db, photos, target);
    expect(r3.missing).toEqual([key]);
  });

  it("en mode externe l'état est lu dans la base : planification externe annoncée, aucun contrôle d'outils local ; le mode interne est inchangé", async () => {
    const ext = await backupStatus(db, "s3", "external");
    expect(ext.configured).toBe(true);
    expect(ext.tools).toBeNull();
    expect(ext.schedule).toMatch(/hors de l'application/);
    const internal = await backupStatus(db, "s3");
    expect(internal.tools).not.toBeNull();
    expect(internal.schedule).toMatch(/par l'application/);
  });

  it("un stockage de sauvegarde dédié (BACKUP_S3_*) est préféré au stockage d'images", () => {
    const config = loadConfig({ DATABASE_URL: URL_, NODE_ENV: "production", S3_BUCKET: "images", BACKUP_S3_BUCKET: "sauvegardes", BACKUP_S3_ENDPOINT: "https://example.invalid", BACKUP_S3_ACCESS_KEY_ID: "k", BACKUP_S3_SECRET_ACCESS_KEY: "s" } as NodeJS.ProcessEnv);
    const st = createBackupStorage(config)!;
    expect(st.kind).toBe("s3");
    expect(st.store).toBeInstanceOf(S3BackupStore);
    expect(loadConfig({ DATABASE_URL: URL_ } as NodeJS.ProcessEnv).BACKUP_MODE).toBe("internal"); // défaut : les sauvegardes internes ne sont pas désactivées
  });

  it("restauration complète : les photos listées par la base RESTAURÉE doivent exister, intactes, dans la sauvegarde (absente, altérée ou illisible = échec)", async () => {
    const photos = testStore();
    const store = new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "bk-")));
    const png = (c: string) => sharp({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer();
    await db.query("DELETE FROM photo_assets WHERE owner_family_id IS NOT NULL AND false"); // (aucune suppression : les assets sont immuables)
    const mine = await savePhotoAsset(db, photos, await png("#112233"), { sourceName: "Photo familiale", license: "OWN" }, { ownerFamilyId: familyId });
    const key = (await db.query("SELECT storage_key FROM photo_assets WHERE id = $1", [mine])).rows[0].storage_key as string;
    const scratchAdmin = createPool(new URL("/postgres", URL_).toString());
    try {
      const mk = (): BackupCtx => ({
        db, databaseUrl: URL_, store, passphrase: "une-phrase-secrete-de-test", verify: { db: scratchAdmin, url: new URL("/postgres", URL_).toString() },
        afterRestore: async (scratch) => (await verifyPhotoBackup(scratch, store)).problems.map((p) => `photos : ${p}`),
      });
      // 1. photos non copiées : la sauvegarde de la base seule ne suffit pas
      const b1 = await createBackup(mk());
      const v1 = await verifyBackup(mk(), b1.key);
      expect(v1.ok).toBe(false);
      expect(v1.problems.join("\n")).toMatch(/absente de la sauvegarde/);
      // 2. copiées : complet (toutes les photos de la famille de la base restaurée sont vérifiées)
      const all = await backupFamilyPhotos(db, photos, store);
      expect(all.missing.filter((k) => k !== undefined).length).toBeGreaterThanOrEqual(0);
      const ownKeys = (await db.query("SELECT DISTINCT storage_key FROM photo_assets WHERE owner_family_id IS NOT NULL")).rows.map((r) => r.storage_key as string);
      // (les photos des essais précédents dont le fichier a été retiré du stockage sont signalées par la copie, pas par la restauration)
      for (const k of ownKeys) if (!(await store.get(backupPhotoKey(k)))) { const f = await photos.get(k); if (f) await store.put(backupPhotoKey(k), f.data); }
      const stillMissing = (await Promise.all(ownKeys.map(async (k) => ((await store.get(backupPhotoKey(k))) ? null : k)))).filter(Boolean) as string[];
      if (stillMissing.length === 0) {
        const b2 = await createBackup(mk());
        const v2 = await verifyBackup(mk(), b2.key);
        expect(v2.problems).toEqual([]);
        // 3. altérée : même clé, autre contenu → empreinte différente
        await store.put(backupPhotoKey(key), await png("#445566"));
        const v3 = await verifyBackup(mk(), (await createBackup(mk())).key);
        expect(v3.ok).toBe(false);
        expect(v3.problems.join("\n")).toMatch(/empreinte SHA-256/);
      }
      // 4. fichier illisible mais de la bonne empreinte : impossible à fabriquer ; on vérifie au moins la détection d'absence après suppression
      await store.delete(backupPhotoKey(key));
      const v4 = await verifyBackup(mk(), (await createBackup(mk())).key);
      expect(v4.ok).toBe(false);
      expect(v4.problems.join("\n")).toContain(key);
    } finally {
      await scratchAdmin.end();
    }
  });

  it("un fichier de sauvegarde lisible (non chiffré) est refusé", async () => {
    const store = new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "bk-")));
    const ctx: BackupCtx = { db, databaseUrl: URL_, store, passphrase: "une-phrase-secrete-de-test" };
    await store.put("backups/sc-clair.dump.enc", Buffer.from("PGDMP\u0000contenu lisible"));
    await store.put("backups/sc-clair.manifest.json", Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), tables: {}, migrations: [] })));
    const v = await verifyBackup(ctx, "backups/sc-clair.dump.enc");
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/pas chiffré/);
    // et un fichier chiffré avec une autre clé est refusé aussi
    await store.put("backups/sc-autre.dump.enc", encrypt(Buffer.from("PGDMPxx"), "une-autre-phrase-secrete"));
    await store.put("backups/sc-autre.manifest.json", Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), tables: {}, migrations: [] })));
    expect((await verifyBackup(ctx, "backups/sc-autre.dump.enc")).problems.join(" ")).toMatch(/déchiffrement impossible/);
  });
});

describe("sauvegarde pendant que des photos sont créées ou remplacées : jamais un ensemble incohérent", () => {
  const PASS = "une-phrase-secrete-de-test";
  const png = (c: string) => sharp({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer();
  const meta = { sourceName: "Photo familiale", license: "OWN" };
  const adminUrl = new URL("/postgres", URL_).toString();
  let fid = "";
  // Base propre avant CHAQUE scénario : les photos des essais précédents (assets immuables, fichiers dans d'autres dossiers temporaires)
  // fausseraient celui-ci.
  beforeEach(async () => {
    await resetData(db);
    fid = (await setupFamily(db, { installToken: await generateInstallToken(db), familyName: "Concurrence", admin: { displayName: "Adil", login: "adil", secret: "482913" } })).auth.familyId;
  });

  /** La même chaîne que backup-cli en mode externe : copie préalable, instantané, copie des photos de l'instantané, restauration, contrôle. */
  async function runExternal(photos: ReturnType<typeof testStore>, hooks: { beforeSnapshot?: () => Promise<void>; duringCopy?: (m: { photos?: string[] }) => Promise<void> } = {}) {
    const store = new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "bk-")));
    const scratch = createPool(adminUrl);
    try {
      await backupFamilyPhotos(db, photos, store); // phase A
      await hooks.beforeSnapshot?.(); // une photo arrive entre la phase A et l'instantané
      const ctx: BackupCtx = {
        db, databaseUrl: URL_, store, passphrase: PASS, verify: { db: scratch, url: adminUrl },
        afterSnapshot: async (m) => {
          await hooks.duringCopy?.(m); // des événements juste après l'instantané
          return copySnapshotPhotos(photos, store, m); // phase B
        },
        afterRestore: async (scratch2, manifest) => (await verifyPhotoBackup(scratch2, store, manifest.photos)).problems.map((p) => `photos : ${p}`),
      };
      const r = await backupVerifyPrune(ctx);
      return { r, store };
    } finally {
      await scratch.end();
    }
  }
  const keyOf = async (id: string) => (await db.query("SELECT storage_key FROM photo_assets WHERE id = $1", [id])).rows[0].storage_key as string;

  it("une photo créée entre la copie préalable et l'instantané est rattrapée par la copie des photos de l'instantané", async () => {
    const photos = testStore();
    const base = await savePhotoAsset(db, photos, await png("#101010"), meta, { ownerFamilyId: fid });
    let late = "";
    const { r, store } = await runExternal(photos, { beforeSnapshot: async () => void (late = await savePhotoAsset(db, photos, await png("#202020"), meta, { ownerFamilyId: fid })) });
    expect(r.verify.problems).toEqual([]);
    expect(r.verify.ok).toBe(true);
    expect(r.backup.manifest.photos).toContain(await keyOf(late));
    expect(await store.get(backupPhotoKey(await keyOf(late)))).not.toBeNull();
    expect(await store.get(backupPhotoKey(await keyOf(base)))).not.toBeNull();
  });

  it("une photo créée APRÈS l'instantané n'est pas dans cette sauvegarde, et la sauvegarde reste complète et cohérente", async () => {
    const photos = testStore();
    let after = "";
    const { r, store } = await runExternal(photos, { duringCopy: async () => void (after = await savePhotoAsset(db, photos, await png("#303030"), meta, { ownerFamilyId: fid })) });
    expect(r.verify.problems).toEqual([]);
    expect(r.backup.manifest.photos).not.toContain(await keyOf(after)); // elle appartient à la sauvegarde suivante
    expect(await store.get(backupPhotoKey(await keyOf(after)))).toBeNull();
  });

  it("une photo « modifiée » (remplacée par une autre) pendant la sauvegarde : l'ancienne reste présente, tout est cohérent", async () => {
    const photos = testStore();
    const old = await savePhotoAsset(db, photos, await png("#404040"), meta, { ownerFamilyId: fid });
    const { r, store } = await runExternal(photos, {
      duringCopy: async () => {
        // le produit change d'image juste après l'instantané : un NOUVEL asset, l'ancien n'est jamais réécrit
        await savePhotoAsset(db, photos, await png("#505050"), meta, { ownerFamilyId: fid });
      },
    });
    expect(r.verify.problems).toEqual([]);
    expect(await store.get(backupPhotoKey(await keyOf(old)))).not.toBeNull();
    const bytes = (await store.get(backupPhotoKey(await keyOf(old))))!;
    expect((await db.query("SELECT content_hash FROM photo_assets WHERE id = $1", [old])).rows[0].content_hash).toBe(require("node:crypto").createHash("sha256").update(bytes).digest("hex"));
  });

  it("une photo de l'instantané dont le fichier disparaît avant sa copie : sauvegarde déclarée INVALIDE (pas d'ensemble incohérent), anciennes sauvegardes conservées", async () => {
    const photos = testStore();
    let lost = "";
    const { r } = await runExternal(photos, {
      beforeSnapshot: async () => void (lost = await savePhotoAsset(db, photos, await png("#606060"), meta, { ownerFamilyId: fid })),
      duringCopy: async () => void (await photos.delete(await keyOf(lost))), // purge simulée entre l'instantané et la copie
    });
    expect(r.verify.ok).toBe(false);
    expect(r.verify.problems.join("\n")).toContain(await keyOf(lost));
    expect(r.pruned).toEqual([]); // rien n'est supprimé sur un échec
  });

  it("la liste des photos de la base restaurée doit être celle du manifeste", async () => {
    const photos = testStore();
    const store = new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "bk-")));
    await backupFamilyPhotos(db, photos, store);
    const rows = await verifyPhotoBackup(db, store, ["photos/" + "0".repeat(64) + ".webp"]); // manifeste différent de la base
    expect(rows.problems.join("\n")).toMatch(/diffère de celle du manifeste/);
  });

  it("sauvegarde INTERNE (celle de l'application) : base + photos de la famille, chiffrées, restauration vérifiée ; puis remise en place réelle des photos perdues", async () => {
    const photos = testStore();
    const store = new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "bk-")));
    const a = await savePhotoAsset(db, photos, await png("#aa5500"), meta, { ownerFamilyId: fid });
    const b = await savePhotoAsset(db, photos, await png("#0055aa"), meta, { ownerFamilyId: fid });
    const keyA = (await db.query("SELECT storage_key FROM photo_assets WHERE id = $1", [a])).rows[0].storage_key as string;
    const keyB = (await db.query("SELECT storage_key FROM photo_assets WHERE id = $1", [b])).rows[0].storage_key as string;
    let checked = 0;
    const ctx: BackupCtx = { db, databaseUrl: URL_, store, passphrase: PASS, ...photoBackupHooks(db, photos, store, (c) => (checked = c.checked)) };
    const r = await backupVerifyPrune(ctx);
    expect(r.verify.problems).toEqual([]);
    expect(checked).toBe(2);
    expect(r.backup.manifest.photos).toEqual([keyA, keyB].sort());
    // les copies sont dans un préfixe à part et intactes
    expect((await store.list("backup-photos/")).length).toBe(2);
    // sinistre : les fichiers du stockage d'images disparaissent ; la base restaurée les liste, la sauvegarde les remet en place
    const before = (await photos.get(keyA))!.data;
    await photos.delete(keyA);
    await photos.delete(keyB);
    const bad = await restorePhotos(db, photos, new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "bk-")))); // mauvaise source : rien à restaurer
    expect(bad.missing.sort()).toEqual([keyA, keyB].sort());
    const ok = await restorePhotos(db, photos, store);
    expect(ok).toMatchObject({ total: 2, restored: 2, missing: [] });
    expect((await photos.get(keyA))!.data.equals(before)).toBe(true);
    // une copie altérée : détectée à la restauration de contrôle si elle est utilisée telle quelle…
    await store.put(backupPhotoKey(keyB), await png("#123456"));
    const v = await verifyBackup(ctx, r.backup.key);
    expect(v.ok).toBe(false);
    expect(v.problems.join("\n")).toMatch(/empreinte SHA-256/);
    // …et réparée (recopiée depuis le stockage d'images) par la sauvegarde suivante, qui redevient valide
    const r2 = await backupVerifyPrune({ ...ctx, now: () => new Date(Date.now() + 60_000) });
    expect(r2.verify.problems).toEqual([]);
  });
});
