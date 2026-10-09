import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import type { Config } from "./config.js";

export type Db = pg.Pool;

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
export function assertSafeDatabaseUrl(url: string, opts: { ca?: string } = {}): void {
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
  /** Root certificate (PEM text or file path): the server certificate is verified against it. */
  sslCa?: string;
  max?: number;
}

export function createPool(connectionString: string, opts: PoolOptions = {}): Db {
  if (!opts.sslCa) return new pg.Pool({ connectionString, max: opts.max ?? 10 });
  return new pg.Pool({ connectionString: stripSsl(connectionString), max: opts.max ?? 10, ssl: { ca: readCa(opts.sslCa), rejectUnauthorized: true } });
}

/** The pool described by the environment, after the safety checks. */
export function createPoolFromConfig(config: Pick<Config, "DATABASE_URL" | "DATABASE_SSL_CA">): Db {
  assertSafeDatabaseUrl(config.DATABASE_URL, { ca: config.DATABASE_SSL_CA });
  return createPool(config.DATABASE_URL, { sslCa: config.DATABASE_SSL_CA });
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
