import { schemaOf, type Db } from "./db.js";

/**
 * Supabase exposes tables through its Data API (REST/GraphQL) to the roles `anon` and `authenticated`. SmartCourse lives in a
 * schema of its own (see DATABASE_SCHEMA), which the API does not expose by default; this is a second lock for the day someone
 * exposes it by mistake. It touches ONLY that schema: other applications' tables, the `public` schema and every schema managed by
 * the platform are never read, altered nor protected here. Idempotent, run after every migration:
 *   1. row level security enabled on every SmartCourse table (no policy = nothing readable through the API);
 *   2. every privilege on SmartCourse tables, sequences, functions and on the SmartCourse schema revoked from those roles;
 *   3. default privileges of this schema revoked, so tables created by a later migration start closed;
 *   4. a final check that nothing is reachable; it throws if something is.
 * On a plain PostgreSQL (Railway, development, tests) these roles do not exist: nothing is done.
 * The server connects with the database owner, which is not affected by any of this.
 */
export const API_ROLES = ["anon", "authenticated"];

export interface HardenResult {
  applied: boolean;
  schema: string;
  roles: string[];
  tables: number;
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function hardenApiRoles(db: Db, wanted: string[] = API_ROLES): Promise<HardenResult> {
  const schema = schemaOf(db);
  const roles = (await db.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname = ANY($1)", [wanted])).rows.map((r) => r.rolname);
  if (roles.length === 0) return { applied: false, schema, roles: [], tables: 0 };
  const list = roles.map(q).join(", ");
  const sch = q(schema);
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const tables = (await c.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY 1", [schema])).rows.map((r) => r.tablename);
    for (const t of tables) await c.query(`ALTER TABLE ${sch}.${q(t)} ENABLE ROW LEVEL SECURITY`);
    await c.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${sch} FROM ${list}`);
    await c.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${sch} FROM ${list}`);
    await c.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${sch} FROM ${list}`);
    await c.query(`REVOKE ALL ON SCHEMA ${sch} FROM ${list}`);
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${sch} REVOKE ALL ON TABLES FROM ${list}`);
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${sch} REVOKE ALL ON SEQUENCES FROM ${list}`);
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${sch} REVOKE ALL ON FUNCTIONS FROM ${list}`);
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
            WHERE n.nspname = $2 AND c.relkind IN ('r','p')`,
          [r, schema],
        )
      ).rows;
      for (const x of rows) if (x.priv || !x.rls) open.push(`${schema}.${x.t} (${r})`);
    }
    if (open.length) throw new Error(`Tables SmartCourse encore exposées à l'API de données : ${open.join(", ")}`);
    return { applied: true, schema, roles, tables: tables.length };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
