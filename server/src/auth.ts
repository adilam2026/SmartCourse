import type pg from "pg";
import { withTx, type Db } from "./db.js";
import { HttpError, invalidCredentials } from "./errors.js";
import type { Role } from "./permissions.js";
import { dummyHash, generateFamilyCode, hashSecret, hashToken, isWeakSecret, newToken, verifySecret } from "./security.js";

export interface AuthContext {
  sessionId: string;
  profileId: string;
  familyId: string;
  role: Role;
  displayName: string;
  login: string;
}

export const SESSION_DAYS = 90;
const LOCK_AFTER = 5;

async function createSession(c: pg.PoolClient, profileId: string): Promise<{ token: string; sessionId: string }> {
  const token = newToken();
  const r = await c.query<{ id: string }>("INSERT INTO sessions (profile_id, token_hash) VALUES ($1, $2) RETURNING id", [
    profileId,
    hashToken(token),
  ]);
  return { token, sessionId: r.rows[0]!.id };
}

/** Resolves a session token. Checks the database on every call: deactivation takes effect at once. */
export async function authenticate(db: Db, token: string | undefined): Promise<AuthContext | null> {
  if (!token) return null;
  const r = await db.query(
    `SELECT s.id AS session_id, s.last_seen_at < now() - interval '1 minute' AS stale,
            p.id AS profile_id, p.family_id, p.role, p.display_name, p.login
       FROM sessions s JOIN profiles p ON p.id = s.profile_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND p.active
        AND s.last_seen_at > now() - make_interval(days => $2)`,
    [hashToken(token), SESSION_DAYS],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.stale) await db.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [row.session_id]);
  return {
    sessionId: row.session_id,
    profileId: row.profile_id,
    familyId: row.family_id,
    role: row.role,
    displayName: row.display_name,
    login: row.login,
  };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [sessionId]);
}

export async function revokeProfileSessions(c: pg.PoolClient | Db, profileId: string): Promise<void> {
  await c.query("UPDATE sessions SET revoked_at = now() WHERE profile_id = $1 AND revoked_at IS NULL", [profileId]);
}

export interface LoginInput {
  familyCode: string;
  login: string;
  secret: string;
}

/**
 * Attempts are serialised per profile (row lock) so parallel guesses cannot outrun the lockout.
 * Every failure mode answers identically and spends comparable time.
 */
export async function login(db: Db, input: LoginInput): Promise<{ token: string; auth: AuthContext }> {
  const outcome = await withTx(db, async (c) => {
    const found = await c.query(
      `SELECT p.*, p.locked_until > now() AS locked
         FROM profiles p JOIN families f ON f.id = p.family_id
        WHERE f.code = $1 AND p.login = $2
          FOR UPDATE OF p`,
      [input.familyCode, input.login],
    );
    const p = found.rows[0];
    if (!p) {
      await verifySecret(input.secret, await dummyHash());
      return { ok: false as const };
    }
    const good = await verifySecret(input.secret, p.secret_hash);
    if (p.locked || !p.active) return { ok: false as const };
    if (!good) {
      const attempts = p.failed_attempts + 1;
      const delay = attempts >= LOCK_AFTER ? Math.min(900, 30 * 2 ** (attempts - LOCK_AFTER)) : 0;
      await c.query(
        `UPDATE profiles SET failed_attempts = $2,
                locked_until = CASE WHEN $3 > 0 THEN now() + make_interval(secs => $3) ELSE locked_until END
          WHERE id = $1`,
        [p.id, attempts, delay],
      );
      return { ok: false as const };
    }
    await c.query("UPDATE profiles SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [p.id]);
    const s = await createSession(c, p.id);
    return {
      ok: true as const,
      token: s.token,
      auth: {
        sessionId: s.sessionId,
        profileId: p.id,
        familyId: p.family_id,
        role: p.role as Role,
        displayName: p.display_name,
        login: p.login,
      },
    };
  });
  if (!outcome.ok) throw invalidCredentials();
  return { token: outcome.token, auth: outcome.auth };
}

export interface SetupInput {
  installToken: string;
  familyName: string;
  admin: { displayName: string; login: string; secret: string };
}

/**
 * Creates a family and its first administrator.
 * The install token is consumed by a single conditional UPDATE: of N concurrent calls with the same
 * token, exactly one matches `consumed_at IS NULL`; the others get a generic 403.
 * Everything happens in one transaction, so a failure after consumption gives the token back.
 */
export async function setupFamily(db: Db, input: SetupInput): Promise<{ token: string; familyCode: string; auth: AuthContext }> {
  if (isWeakSecret(input.admin.secret)) throw new HttpError(400, "weak_secret", "Code trop simple");
  const secretHash = await hashSecret(input.admin.secret);
  return withTx(db, async (c) => {
    const consumed = await c.query<{ id: string }>(
      "UPDATE install_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL RETURNING id",
      [hashToken(input.installToken)],
    );
    if (!consumed.rows[0]) throw new HttpError(403, "invalid_install_token", "Jeton d'installation invalide ou déjà utilisé");
    const code = generateFamilyCode();
    const fam = await c.query<{ id: string }>("INSERT INTO families (code, name) VALUES ($1, $2) RETURNING id", [code, input.familyName]);
    const familyId = fam.rows[0]!.id;
    await c.query("UPDATE install_tokens SET family_id = $2 WHERE id = $1", [consumed.rows[0].id, familyId]);
    const prof = await c.query<{ id: string }>(
      `INSERT INTO profiles (family_id, display_name, login, role, secret_hash)
       VALUES ($1, $2, $3, 'admin', $4) RETURNING id`,
      [familyId, input.admin.displayName, input.admin.login, secretHash],
    );
    const profileId = prof.rows[0]!.id;
    // Catalogue familial de départ : copie des 80 références génériques.
    await c.query(
      `INSERT INTO products (family_id, category, name, catalog_key, photo_asset_id, position)
       SELECT $1, category, name, key, photo_asset_id, position FROM initial_catalog`,
      [familyId],
    );
    await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action, target_profile_id) VALUES ($1, $2, 'family.created', $2)", [
      familyId,
      profileId,
    ]);
    const s = await createSession(c, profileId);
    return {
      token: s.token,
      familyCode: code,
      auth: {
        sessionId: s.sessionId,
        profileId,
        familyId,
        role: "admin" as Role,
        displayName: input.admin.displayName,
        login: input.admin.login,
      },
    };
  });
}

/** Registers the INSTALL_TOKEN environment variable as a one-shot install token (idempotent). */
export async function ensureInstallToken(db: Db, plain: string): Promise<void> {
  await db.query("INSERT INTO install_tokens (token_hash) VALUES ($1) ON CONFLICT (token_hash) DO NOTHING", [hashToken(plain)]);
}

/** Operator tool: mints a fresh one-shot install token and returns it in clear (only its hash is stored). */
export async function generateInstallToken(db: Db): Promise<string> {
  const token = newToken();
  await db.query("INSERT INTO install_tokens (token_hash) VALUES ($1)", [hashToken(token)]);
  return token;
}
