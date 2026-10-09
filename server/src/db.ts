import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import type { Config } from "./config.js";

export type Db = pg.Pool;

/** Schemas owned by the platform or by PostgreSQL itself: never used for SmartCourse, never touched by it. */
const RESERVED_SCHEMAS = new Set([
  "information_schema", "auth", "storage", "realtime", "vault", "extensions", "graphql", "graphql_public", "pgbouncer", "net", "cron",
  "supabase_functions", "supabase_migrations", "pgsodium", "pgsodium_masks", "_realtime", "_analytics", "topology", "tiger", "tiger_data",
]);
const isReservedSchema = (s: string) => RESERVED_SCHEMAS.has(s) || s.startsWith("pg_");

const SCHEMAS = new WeakMap<Db, string>();
/** The schema a pool works in ("public" unless configured otherwise). */
export const schemaOf = (db: Db): string => SCHEMAS.get(db) ?? "public";
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** PEM text, or the path of a PEM file. */
export function readCa(value: string): string {
  const v = value.trim();
  if (v.includes("-----BEGIN")) return v.replace(/\\n/g, "\n");
  if (!existsSync(v)) throw new Error(`DATABASE_SSL_CA : fichier introuvable (${v})`);
  return readFileSync(v, "utf8");
}

const MANAGED_HOST = /(^|\.)(supabase\.(co|com|net)|pooler\.supabase\.com)$/i;

/**
 * Refuses configurations that would silently misbehave or leak:
 *  - Supabase's transaction pooler (port 6543): session state (advisory locks used by migrations and backups, SET) does not
 *    survive there; use the session-mode pooler (port 5432) or the direct connection;
 *  - a Supabase host without a CA certificate: the connection would be unencrypted or unverified.
 */
export function assertSafeDatabaseUrl(url: string, opts: { ca?: string; schema?: string; backupMode?: "internal" | "external" } = {}): void {
  if (opts.schema !== undefined && isReservedSchema(opts.schema)) {
    throw new Error(`DATABASE_SCHEMA=${opts.schema} : schéma réservé (PostgreSQL ou plateforme). Choisissez un schéma à vous, par exemple « smartcourse ».`);
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("DATABASE_URL illisible");
  }
  const managed = MANAGED_HOST.test(u.hostname);
  if (managed && u.port === "6543") {
    throw new Error("DATABASE_URL : le pooler en mode transaction (port 6543) n'est pas pris en charge (verrous de session des migrations et sauvegardes). Utilisez le pooler en mode session (port 5432).");
  }
  if (managed && (opts.schema ?? "public") === "public") {
    throw new Error("DATABASE_SCHEMA : sur une base Supabase, SmartCourse doit avoir son propre schéma (DATABASE_SCHEMA=smartcourse). Le schéma « public » est partagé avec les autres applications et exposé par l'API de données de Supabase : il ne sera jamais utilisé.");
  }
  if (managed && opts.backupMode !== "external") {
    throw new Error("BACKUP_MODE : sur une base Supabase, les sauvegardes internes de l'application sont incompatibles (leur restauration de contrôle exige de créer une base sur le même serveur). Définissez BACKUP_MODE=external et laissez la tâche planifiée « Sauvegarde externe » les faire (docs/hebergement-supabase.md).");
  }
  if (managed && !opts.ca) {
    throw new Error("DATABASE_URL : base Supabase sans DATABASE_SSL_CA. Fournissez le certificat racine (Supabase → Database settings → SSL) : la connexion doit être chiffrée ET vérifiée.");
  }
}

/** Connection string without the libpq SSL parameters (node-postgres would let them override the options below). */
function stripSsl(url: string): string {
  const u = new URL(url);
  for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "ssl"]) u.searchParams.delete(k);
  return u.toString();
}

export interface PoolOptions {
  /** Schema of all SmartCourse tables (search_path of every connection). Default "public". */
  schema?: string;
  /** Root certificate (PEM text or file path): the server certificate is verified against it. */
  sslCa?: string;
  max?: number;
}

/** A client that sets the search_path of its connection BEFORE it is handed out (no query can overtake it). */
function clientForSchema(schema: string): typeof pg.Client {
  const sql = `SET search_path TO ${ident(schema)}`;
  class SchemaClient extends pg.Client {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connect(cb?: any): any {
      if (!cb) return super.connect().then(() => this.query(sql)).then(() => undefined);
      super.connect((err: Error | undefined) => {
        if (err) return cb(err);
        this.query(sql, (e: Error | null) => cb(e ?? undefined));
      });
    }
  }
  return SchemaClient as unknown as typeof pg.Client;
}

export function createPool(connectionString: string, opts: PoolOptions = {}): Db {
  const schema = opts.schema ?? "public";
  // Every connection works in the SmartCourse schema only. Set on the connection itself (not on the database role, which
  // other applications share, and not as a startup option, which some poolers ignore).
  const Client = schema === "public" ? undefined : clientForSchema(schema);
  const pool = opts.sslCa
    ? new pg.Pool({ connectionString: stripSsl(connectionString), max: opts.max ?? 10, ssl: { ca: readCa(opts.sslCa), rejectUnauthorized: true }, Client })
    : new pg.Pool({ connectionString, max: opts.max ?? 10, Client });
  SCHEMAS.set(pool, schema);
  return pool;
}

/** Creates the SmartCourse schema when it is not "public". Idempotent. */
export async function ensureSchema(db: Db): Promise<void> {
  const schema = schemaOf(db);
  if (schema === "public") return;
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)}`);
}

/** The pool described by the environment, after the safety checks (they throw a clear message when the configuration is wrong). */
export function createPoolFromConfig(config: Pick<Config, "DATABASE_URL" | "DATABASE_SSL_CA" | "DATABASE_SCHEMA" | "DATABASE_POOL_MAX"> & { BACKUP_MODE?: "internal" | "external" }): Db {
  assertSafeDatabaseUrl(config.DATABASE_URL, { ca: config.DATABASE_SSL_CA, schema: config.DATABASE_SCHEMA, backupMode: config.BACKUP_MODE });
  const managed = MANAGED_HOST.test(new URL(config.DATABASE_URL).hostname);
  return createPool(config.DATABASE_URL, { sslCa: config.DATABASE_SSL_CA, schema: config.DATABASE_SCHEMA, max: config.DATABASE_POOL_MAX ?? (managed ? 5 : 10) });
}

/** URL for libpq tools (pg_dump, pg_restore): same server, encrypted and verified when a CA is configured. */
export function toolsDatabaseUrl(config: Pick<Config, "DATABASE_URL" | "DATABASE_SSL_CA">): string {
  if (!config.DATABASE_SSL_CA) return config.DATABASE_URL;
  const dir = mkdtempSync(path.join(os.tmpdir(), "sc-ca-"));
  const file = path.join(dir, "ca.pem");
  writeFileSync(file, readCa(config.DATABASE_SSL_CA), { mode: 0o600 });
  const u = new URL(stripSsl(config.DATABASE_URL));
  u.searchParams.set("sslmode", "verify-full");
  u.searchParams.set("sslrootcert", file);
  return u.toString();
}

/** Run `fn` in a transaction; commits on success, rolls back on any error. */
export async function withTx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
