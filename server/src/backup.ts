import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type pg from "pg";
import { schemaOf, type Db } from "./db.js";

/*
 * Backups = a consistent pg_dump, encrypted, plus a manifest of row counts taken in the SAME snapshot.
 * A backup is only trusted once `verifyBackup` has restored it into a scratch database and the restored
 * data matches the manifest: a file that was written but never restored proves nothing.
 */

export interface BackupStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  list(prefix: string): Promise<{ key: string; at: Date }[]>;
  delete(key: string): Promise<void>;
}

export class LocalBackupStore implements BackupStore {
  constructor(private dir: string) {}
  private file(key: string) {
    if (!/^(backups|photos)\/[\w.-]+$/.test(key)) throw new Error(`Invalid backup key: ${key}`);
    return path.join(this.dir, key);
  }
  async put(key: string, data: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data);
  }
  async get(key: string) {
    try {
      return await readFile(this.file(key));
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async list(prefix: string) {
    const slash = prefix.lastIndexOf("/");
    const folder = prefix.slice(0, slash); // "backups"
    const namePrefix = prefix.slice(slash + 1);
    const dir = path.join(this.dir, folder);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
    const out = [];
    for (const n of names) if (n.startsWith(namePrefix)) out.push({ key: `${folder}/${n}`, at: (await stat(path.join(dir, n))).mtime });
    return out;
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

export class S3BackupStore implements BackupStore {
  constructor(private c: S3Client, private bucket: string) {}
  async put(key: string, data: Buffer) {
    await this.c.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }));
  }
  async get(key: string) {
    try {
      const r = await this.c.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (e: any) {
      if (e.name === "NoSuchKey") return null;
      throw e;
    }
  }
  async list(prefix: string) {
    const out: { key: string; at: Date }[] = [];
    let token: string | undefined;
    do {
      const r = await this.c.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, at: o.LastModified ?? new Date(0) });
      token = r.NextContinuationToken;
    } while (token);
    return out;
  }
  async delete(key: string) {
    await this.c.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

// ---- encryption (AES-256-GCM, key derived from the passphrase with scrypt) ---------------------
const MAGIC = Buffer.from("SCB1");

export function encrypt(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ct]);
}

/** Throws if the passphrase is wrong or a single byte was altered (GCM authentication). */
export function decrypt(blob: Buffer, passphrase: string): Buffer {
  if (blob.length < 48 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error("Not a SmartCourse backup");
  const salt = blob.subarray(4, 20);
  const iv = blob.subarray(20, 32);
  const tag = blob.subarray(32, 48);
  const key = scryptSync(passphrase, salt, 32);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(48)), d.final()]);
}

// ---- retention -----------------------------------------------------------------------------------
export interface Policy {
  daily: number;
  weekly: number;
  monthly: number;
}
export const DEFAULT_POLICY: Policy = { daily: 7, weekly: 4, monthly: 3 };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
function weekKey(d: Date): string {
  // ISO week: Thursday of the week decides the year.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7)).padStart(2, "0")}`;
}

/** Keeps the newest backup of each of the last N days, N weeks and N months (those that have backups). */
export function selectKeep<T extends { at: Date }>(entries: T[], policy: Policy = DEFAULT_POLICY): Set<T> {
  const sorted = [...entries].sort((a, b) => b.at.getTime() - a.at.getTime());
  const keep = new Set<T>();
  const take = (keyFn: (d: Date) => string, n: number) => {
    const seen = new Set<string>();
    for (const e of sorted) {
      const k = keyFn(e.at);
      if (seen.has(k)) continue;
      if (seen.size >= n) break;
      seen.add(k);
      keep.add(e);
    }
  };
  take(dayKey, policy.daily);
  take(weekKey, policy.weekly);
  take(monthKey, policy.monthly);
  return keep;
}

// ---- tool compatibility ----------------------------------------------------------------------------
// The client major version must EQUAL the server's: an older client refuses to dump, a newer one writes
// dumps that an older server cannot restore (e.g. `SET transaction_timeout`, unknown before PostgreSQL 17).
// So the image carries several clients under /usr/lib/postgresql/<major>/bin and the right one is chosen
// from the server's version each time.
export interface ToolCheck {
  ok: boolean;
  serverMajor: number | null;
  available: number[];
  pgDump: string | null;
  pgRestore: string | null;
  message: string;
}

export const PG_ROOT = process.env.PG_BIN_ROOT ?? "/usr/lib/postgresql";

export function availableMajors(root = PG_ROOT): number[] {
  try {
    return readdirSync(root)
      .filter((d) => /^\d+$/.test(d) && existsSync(path.join(root, d, "bin", "pg_dump")) && existsSync(path.join(root, d, "bin", "pg_restore")))
      .map(Number)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Pure: which client binaries to use for a given server major (null paths when none matches). */
export function selectTools(serverMajor: number | null, root = PG_ROOT): ToolCheck {
  const available = availableMajors(root);
  if (serverMajor === null) return { ok: false, serverMajor, available, pgDump: null, pgRestore: null, message: "version du serveur PostgreSQL illisible" };
  if (!available.includes(serverMajor)) {
    return {
      ok: false, serverMajor, available, pgDump: null, pgRestore: null,
      message: `aucun client pg_dump ${serverMajor} dans l'image (disponibles : ${available.join(", ") || "aucun"}) : ajouter cette version au Dockerfile et reconstruire`,
    };
  }
  const bin = path.join(root, String(serverMajor), "bin");
  return { ok: true, serverMajor, available, pgDump: path.join(bin, "pg_dump"), pgRestore: path.join(bin, "pg_restore"), message: `client pg_dump ${serverMajor} = serveur PostgreSQL ${serverMajor}` };
}

export async function checkBackupTools(db: Db, root = PG_ROOT): Promise<ToolCheck> {
  const num = Number((await db.query("SHOW server_version_num")).rows[0].server_version_num);
  return selectTools(Number.isFinite(num) ? Math.floor(num / 10000) : null, root);
}

// ---- backup ----------------------------------------------------------------------------------------
export interface Manifest {
  createdAt: string;
  pgDumpVersion?: string;
  tables: Record<string, number>;
  migrations: string[];
  /** Storage keys of the pictures families added, as listed by the database IN THE SAME SNAPSHOT as the dump. */
  photos?: string[];
}

export interface BackupCtx {
  db: Db;
  /** URL given to pg_dump (libpq): encrypted and verified when a CA is configured (see toolsDatabaseUrl). */
  databaseUrl: string;
  /** Scratch server where a backup is restored to be checked. Default: the same server as `db` (in-app backups). */
  verify?: { db: Db; url: string };
  /** Extra checks run on the RESTORED database (e.g. every picture it references exists, intact, in the backup storage). Returns problems. */
  afterRestore?: (scratch: pg.Client, manifest: Manifest) => Promise<string[]>;
  /** Run right after the snapshot is stored (e.g. copy the pictures it lists). Returns problems: any makes the backup invalid. */
  afterSnapshot?: (manifest: Manifest) => Promise<string[]>;
  store: BackupStore;
  passphrase: string;
  now?: () => Date;
}

function run(cmd: string, args: string[], opts: { input?: Buffer } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve({ stdout: Buffer.concat(out), stderr: err }) : reject(new Error(`${cmd} exited ${code}: ${err.trim().slice(0, 500)}`))));
    p.stdin.end(opts.input);
  });
}

async function tableNames(q: { query: Db["query"] }, schema = "public"): Promise<string[]> {
  const r = await q.query("SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY 1", [schema]);
  return r.rows.map((x: { tablename: string }) => x.tablename);
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-");

export async function createBackup(ctx: BackupCtx): Promise<{ key: string; manifest: Manifest; bytes: number }> {
  const tools = await checkBackupTools(ctx.db);
  if (!tools.ok) throw new Error(tools.message); // fail before touching anything, with an actionable message
  const now = (ctx.now ?? (() => new Date()))();
  const c = await ctx.db.connect();
  try {
    // One snapshot shared by the row counts and pg_dump: the manifest describes exactly what the dump holds.
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snap = (await c.query("SELECT pg_export_snapshot() AS s")).rows[0].s as string;
    const tables: Record<string, number> = {};
    for (const t of await tableNames(c, schemaOf(ctx.db))) tables[t] = (await c.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;
    const migrations = (await c.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((r) => r.name as string);
    // The pictures this snapshot refers to: listed in the SAME snapshot, so the manifest says exactly what the restored data needs.
    const photos = (await c.query("SELECT DISTINCT storage_key FROM photo_assets WHERE owner_family_id IS NOT NULL ORDER BY 1")).rows.map((r) => r.storage_key as string);
    // Only SmartCourse's own schema is dumped when it has one (other applications' data is never copied into our backups).
    const only = schemaOf(ctx.db) === "public" ? [] : [`--schema=${schemaOf(ctx.db)}`];
    const dump = await run(tools.pgDump!, ["--format=custom", `--snapshot=${snap}`, "--no-owner", "--no-privileges", ...only, `--dbname=${ctx.databaseUrl}`]);
    await c.query("COMMIT");
    const manifest: Manifest = { createdAt: now.toISOString(), tables, migrations, photos };
    const base = `backups/sc-${stamp(now)}`;
    const blob = encrypt(dump.stdout, ctx.passphrase);
    await ctx.store.put(`${base}.dump.enc`, blob);
    await ctx.store.put(`${base}.manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)));
    return { key: `${base}.dump.enc`, manifest, bytes: blob.length };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export interface VerifyResult {
  ok: boolean;
  key: string;
  problems: string[];
  restoredTables: number;
}

const INVARIANTS: { name: string; sql: string }[] = [
  {
    name: "article acheté sans achat ouvert (ou l'inverse)",
    sql: `SELECT count(*)::int AS n FROM list_items i WHERE (i.status = 'purchased') <> EXISTS (SELECT 1 FROM purchases p WHERE p.list_item_id = i.id AND p.voided_at IS NULL)`,
  },
  { name: "plusieurs listes actives dans une famille", sql: `SELECT count(*)::int AS n FROM (SELECT family_id FROM lists WHERE status = 'active' GROUP BY 1 HAVING count(*) > 1) x` },
  { name: "famille sans administrateur actif", sql: `SELECT count(*)::int AS n FROM families f WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.family_id = f.id AND p.role = 'admin' AND p.active)` },
];

/** Restores a backup into a scratch database and checks it against its manifest. Always cleans up. */
export async function verifyBackup(ctx: BackupCtx, dumpKey: string): Promise<VerifyResult> {
  const problems: string[] = [];
  const result = (restoredTables = 0): VerifyResult => ({ ok: problems.length === 0, key: dumpKey, problems, restoredTables });
  const manifestKey = dumpKey.replace(/\.dump\.enc$/, ".manifest.json");
  const [blob, mf] = await Promise.all([ctx.store.get(dumpKey), ctx.store.get(manifestKey)]);
  if (!blob) return problems.push("fichier de sauvegarde introuvable"), result();
  if (!mf) return problems.push("manifeste introuvable"), result();
  const manifest = JSON.parse(mf.toString()) as Manifest;
  // The stored file must be encrypted: a readable dump (or anything not produced by `encrypt`) is a failure, not a success.
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC) || blob.includes(Buffer.from("PGDMP"))) return problems.push("le fichier stocké n'est pas chiffré"), result();
  let dump: Buffer;
  try {
    dump = decrypt(blob, ctx.passphrase);
  } catch {
    return problems.push("déchiffrement impossible (mauvaise clé ou fichier altéré)"), result();
  }

  const tools = await checkBackupTools(ctx.db);
  if (!tools.ok) return problems.push(tools.message), result();

  // Where the restore happens: another server for external backups (then its major version must be the source's, or the
  // check would not prove that THIS dump restores on THIS kind of server).
  const vdb = ctx.verify?.db ?? ctx.db;
  const vurl = ctx.verify?.url ?? ctx.databaseUrl;
  if (ctx.verify) {
    const m = Math.floor(Number((await vdb.query("SHOW server_version_num")).rows[0].server_version_num) / 10000);
    if (m !== tools.serverMajor) return problems.push(`le serveur de contrôle est en PostgreSQL ${m}, la base sauvegardée en ${tools.serverMajor} : restauration de contrôle non significative`), result();
  }

  const dbName = `sc_verify_${Date.now()}_${randomBytes(3).toString("hex")}`;
  const tmpFile = path.join(os.tmpdir(), `${dbName}.dump`);
  const scratchUrl = new URL(vurl);
  scratchUrl.pathname = `/${dbName}`;
  await vdb.query(`CREATE DATABASE "${dbName}"`);
  let scratch: import("pg").Client | undefined;
  try {
    await writeFile(tmpFile, dump, { mode: 0o600 });
    await run(tools.pgRestore!, ["--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${scratchUrl.toString()}`, tmpFile]);
    const pg = (await import("pg")).default;
    scratch = new pg.Client({ connectionString: scratchUrl.toString() });
    await scratch.connect();
    const schema = schemaOf(ctx.db);
    if (schema !== "public") await scratch.query(`SET search_path TO "${schema.replace(/"/g, '""')}"`);
    const restored = await tableNames(scratch, schema);
    for (const [t, expected] of Object.entries(manifest.tables)) {
      if (!restored.includes(t)) {
        problems.push(`table ${t} absente après restauration`);
        continue;
      }
      const n = (await scratch.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n as number;
      if (n !== expected) problems.push(`table ${t} : ${n} lignes restaurées, ${expected} attendues`);
    }
    const mig = (await scratch.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((r) => r.name as string);
    if (JSON.stringify(mig) !== JSON.stringify(manifest.migrations)) problems.push("liste des migrations différente");
    for (const inv of INVARIANTS) {
      const n = (await scratch.query(inv.sql)).rows[0].n as number;
      if (n > 0) problems.push(`invariant violé : ${inv.name} (${n})`);
    }
    if (ctx.afterRestore) problems.push(...(await ctx.afterRestore(scratch, manifest)));
    return result(restored.length);
  } catch (e) {
    problems.push(`restauration échouée : ${(e as Error).message}`);
    return result();
  } finally {
    await scratch?.end().catch(() => {});
    await rm(tmpFile, { force: true });
    await vdb.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
  }
}

export async function listBackups(store: BackupStore): Promise<{ key: string; at: Date }[]> {
  return (await store.list("backups/")).filter((e) => e.key.endsWith(".dump.enc")).sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Deletes backups outside the policy (both the dump and its manifest). Returns deleted dump keys. */
export async function pruneBackups(store: BackupStore, policy: Policy = DEFAULT_POLICY): Promise<string[]> {
  const all = await listBackups(store);
  const keep = selectKeep(all, policy);
  const deleted: string[] = [];
  for (const e of all) {
    if (keep.has(e)) continue;
    await store.delete(e.key);
    await store.delete(e.key.replace(/\.dump\.enc$/, ".manifest.json"));
    deleted.push(e.key);
  }
  return deleted;
}

// ---- orchestration & recording --------------------------------------------------------------------------
async function record(db: Db, kind: "backup" | "verify", ok: boolean, backupKey: string | null, detail: object) {
  await db.query("INSERT INTO backup_runs (kind, ok, backup_key, detail) VALUES ($1,$2,$3,$4)", [kind, ok, backupKey, JSON.stringify(detail)]);
}

/** Backup → restore check → prune (only if the new backup restored correctly). */
export async function backupVerifyPrune(ctx: BackupCtx, policy: Policy = DEFAULT_POLICY) {
  const b = await createBackup(ctx);
  await record(ctx.db, "backup", true, b.key, { bytes: b.bytes, tables: b.manifest.tables });
  // Pictures the snapshot lists are copied AFTER it was taken (see backup-photos.ts): a picture that cannot be found invalidates it.
  const extra = ctx.afterSnapshot ? await ctx.afterSnapshot(b.manifest).catch((e) => [`copie des photos en échec : ${(e as Error).message}`]) : [];
  const v = await verifyBackup(ctx, b.key);
  if (extra.length) {
    v.problems.push(...extra);
    v.ok = false;
  }
  await record(ctx.db, "verify", v.ok, b.key, { problems: v.problems, restoredTables: v.restoredTables });
  const pruned = v.ok ? await pruneBackups(ctx.store, policy) : []; // never delete older good backups on a bad one
  return { backup: b, verify: v, pruned };
}

export interface BackupStatus {
  configured: boolean;
  storage: "s3" | "local" | null;
  /** Human-readable schedule. */
  schedule: string;
  tools: ToolCheck | null;
  lastBackupAt: string | null;
  lastVerifiedOkAt: string | null;
  lastVerifyFailedAt: string | null;
}

export const EXTERNAL_SCHEDULE_TEXT = "Sauvegarde chiffrée quotidienne faite hors de l'application (tâche planifiée GitHub Actions), restaurée dans un autre serveur PostgreSQL avant d'être déclarée valide ; copie des photos de la famille ajoutée.";

export async function backupStatus(db: Db, storage: "s3" | "local" | null, mode: "internal" | "external" = "internal"): Promise<BackupStatus> {
  const configured = storage !== null;
  const tools = configured && mode === "internal" ? await checkBackupTools(db) : null;
  const r = await db.query(
    `SELECT (SELECT max(at) FROM backup_runs WHERE kind = 'backup' AND ok) AS b,
            (SELECT max(at) FROM backup_runs WHERE kind = 'verify' AND ok) AS v,
            (SELECT max(at) FROM backup_runs WHERE kind = 'verify' AND NOT ok) AS f`,
  );
  const row = r.rows[0];
  return { configured, storage, schedule: mode === "external" ? EXTERNAL_SCHEDULE_TEXT : SCHEDULE_TEXT, tools, lastBackupAt: row.b?.toISOString() ?? null, lastVerifiedOkAt: row.v?.toISOString() ?? null, lastVerifyFailedAt: row.f?.toISOString() ?? null };
}

export const SCHEDULE_TEXT = "Une sauvegarde chiffrée par jour (dès que la dernière a plus de 24 h ; contrôle toutes les 10 min par l'application), suivie d'une restauration de vérification.";
const LOCK = 727_002;
/** Daily backup + restore check, run by the app itself. One run at a time even if two instances overlap. */
export function startBackupScheduler(ctx: BackupCtx, log: (m: string) => void, everyMs = 10 * 60_000): () => void {
  const tick = async () => {
    const c = await ctx.db.connect();
    try {
      if (!(await c.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK])).rows[0].ok) return;
      const st = await backupStatus(ctx.db, "s3");
      const due = !st.lastBackupAt || Date.now() - new Date(st.lastBackupAt).getTime() > 24 * 3_600_000;
      if (!due) return;
      const r = await backupVerifyPrune(ctx);
      log(`backup ${r.backup.key} (${r.backup.bytes} o), restauration ${r.verify.ok ? "vérifiée" : "ÉCHEC: " + r.verify.problems.join("; ")}, ${r.pruned.length} ancien(s) supprimé(s)`);
    } catch (e) {
      log(`backup en échec : ${(e as Error).message}`);
      await record(ctx.db, "backup", false, null, { error: (e as Error).message }).catch(() => {});
    } finally {
      await c.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => {});
      c.release();
    }
  };
  const t = setInterval(() => void tick(), everyMs);
  setTimeout(() => void tick(), 30_000); // first check shortly after start
  return () => clearInterval(t);
}
