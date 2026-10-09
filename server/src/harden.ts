import type { Db } from "./db.js";

/**
 * Supabase exposes every table of the `public` schema through its Data API (REST/GraphQL) to the roles `anon` and
 * `authenticated`, and a new table starts with ALL privileges granted to them. Our tables (profiles, hashed codes, sessions,
 * purchases…) must be reachable ONLY through this server. Idempotent, run after every migration:
 *   1. row level security enabled on every table (no policy = nothing is readable through the API);
 *   2. every privilege on tables, sequences, functions and the schema revoked from those roles;
 *   3. default privileges revoked, so tables created by a later migration start closed;
 *   4. a final check that nothing is still reachable; it throws if something is.
 * On a plain PostgreSQL (Railway, development, tests) these roles do not exist: nothing is done.
 * The server connects with the database owner (`postgres`), which is not affected by any of this.
 */
export const API_ROLES = ["anon", "authenticated"];

export interface HardenResult {
  applied: boolean;
  roles: string[];
  tables: number;
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function hardenApiRoles(db: Db, wanted: string[] = API_ROLES): Promise<HardenResult> {
  const roles = (await db.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname = ANY($1)", [wanted])).rows.map((r) => r.rolname);
  if (roles.length === 0) return { applied: false, roles: [], tables: 0 };
  const list = roles.map(q).join(", ");
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const tables = (await c.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.tablename);
    for (const t of tables) await c.query(`ALTER TABLE public.${q(t)} ENABLE ROW LEVEL SECURITY`);
    await c.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${list}`);
    await c.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${list}`);
    await c.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${list}`);
    await c.query(`REVOKE ALL ON SCHEMA public FROM ${list}`);
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${list}`);
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${list}`);
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM ${list}`);
    await c.query("COMMIT");

    const open: string[] = [];
    for (const r of roles) {
      const rows = (
        await c.query<{ t: string; priv: boolean; rls: boolean }>(
          `SELECT c.relname AS t,
                  (has_table_privilege($1, c.oid, 'SELECT') OR has_table_privilege($1, c.oid, 'INSERT')
                   OR has_table_privilege($1, c.oid, 'UPDATE') OR has_table_privilege($1, c.oid, 'DELETE')) AS priv,
                  c.relrowsecurity AS rls
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p')`,
          [r],
        )
      ).rows;
      for (const x of rows) if (x.priv || !x.rls) open.push(`${x.t} (${r})`);
    }
    if (open.length) throw new Error(`Tables encore exposées à l'API de données : ${open.join(", ")}`);
    return { applied: true, roles, tables: tables.length };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
