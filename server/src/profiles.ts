import type pg from "pg";
import { withTx, type Db } from "./db.js";
import { revokeProfileSessions, type AuthContext } from "./auth.js";
import { HttpError } from "./errors.js";
import type { SseHub } from "./hub.js";
import type { Role } from "./permissions.js";
import { generateSecret, hashSecret, isValidSecret, isWeakSecret } from "./security.js";

export interface ProfileView {
  id: string;
  displayName: string;
  login: string;
  role: Role;
  active: boolean;
  /** Administrateur principal : le premier de la famille. Son rôle ne peut pas être changé et il ne peut pas être désactivé. */
  primary: boolean;
}

const toView = (r: any): ProfileView => ({
  id: r.id,
  displayName: r.display_name,
  login: r.login,
  role: r.role,
  active: r.active,
  primary: r.is_primary,
});

export async function listProfiles(db: Db, familyId: string): Promise<ProfileView[]> {
  const r = await db.query("SELECT * FROM profiles WHERE family_id = $1 ORDER BY created_at, login", [familyId]);
  return r.rows.map(toView);
}

/** All profile mutations of a family take this lock first, so invariants (last admin) are checked race-free. */
async function lockFamily(c: pg.PoolClient, familyId: string): Promise<void> {
  await c.query("SELECT 1 FROM families WHERE id = $1 FOR UPDATE", [familyId]);
}

async function otherActiveAdmins(c: pg.PoolClient, familyId: string, exceptId: string): Promise<number> {
  const r = await c.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM profiles WHERE family_id = $1 AND role = 'admin' AND active AND id <> $2",
    [familyId, exceptId],
  );
  return r.rows[0]!.n;
}

async function audit(c: pg.PoolClient, familyId: string, actor: string | null, action: string, target: string | null, details: object = {}) {
  await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action, target_profile_id, details) VALUES ($1,$2,$3,$4,$5)", [
    familyId,
    actor,
    action,
    target,
    JSON.stringify(details),
  ]);
}

async function loadTarget(c: pg.PoolClient, familyId: string, id: string) {
  // The family filter is what keeps one family from touching another's profiles.
  const r = await c.query("SELECT * FROM profiles WHERE id = $1 AND family_id = $2 FOR UPDATE", [id, familyId]);
  if (!r.rows[0]) throw new HttpError(404, "not_found", "Profil introuvable");
  return r.rows[0];
}

export interface CreateProfileInput {
  displayName: string;
  login: string;
  role: Role;
  /** Choisi et saisi par l'administrateur : jamais généré automatiquement. */
  secret: string;
  secretConfirm: string;
}

/** Same rules everywhere a password is chosen by a person: 6 visible characters, typed twice, not trivially guessable. */
export function checkChosenSecret(secret: string, confirm: string): void {
  if (!isValidSecret(secret)) throw new HttpError(400, "invalid_secret", "Le mot de passe doit comporter 6 caractères");
  if (secret !== confirm) throw new HttpError(400, "secret_mismatch", "Les deux mots de passe ne sont pas identiques");
  if (isWeakSecret(secret)) throw new HttpError(400, "weak_secret", "Mot de passe trop simple (évitez 123456, 111111…)");
}

export async function createProfile(db: Db, actor: AuthContext, input: CreateProfileInput): Promise<{ profile: ProfileView }> {
  checkChosenSecret(input.secret, input.secretConfirm);
  const hash = await hashSecret(input.secret);
  return withTx(db, async (c) => {
    await lockFamily(c, actor.familyId);
    try {
      const r = await c.query(
        `INSERT INTO profiles (family_id, display_name, login, role, secret_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [actor.familyId, input.displayName, input.login, input.role, hash],
      );
      await audit(c, actor.familyId, actor.profileId, "profile.created", r.rows[0].id, { role: input.role });
      return { profile: toView(r.rows[0]) };
    } catch (err: any) {
      if (err.code === "23505") throw new HttpError(409, "login_taken", "Cet identifiant existe déjà dans la famille");
      throw err;
    }
  });
}

export interface UpdateProfileInput {
  displayName?: string;
  role?: Role;
  active?: boolean;
}

export async function updateProfile(db: Db, hub: SseHub, actor: AuthContext, id: string, input: UpdateProfileInput): Promise<ProfileView> {
  const { view, deactivated } = await withTx(db, async (c) => {
    await lockFamily(c, actor.familyId);
    const t = await loadTarget(c, actor.familyId, id);
    const role: Role = input.role ?? t.role;
    const active: boolean = input.active ?? t.active;
    // Protection de l'administration : un administrateur n'est jamais désactivé (il faut d'abord lui retirer ce rôle), et
    // l'administrateur principal ne peut pas perdre son rôle, ce qui empêcherait de le désactiver ensuite.
    if (t.is_primary && role !== "admin") throw new HttpError(409, "primary_admin_protected", "Le rôle de l'administrateur principal ne peut pas être modifié");
    if (!active && t.active && t.role === "admin") throw new HttpError(409, "admin_cannot_deactivate", "Un administrateur ne peut pas être désactivé");
    const wasActiveAdmin = t.role === "admin" && t.active;
    const staysActiveAdmin = role === "admin" && active;
    if (wasActiveAdmin && !staysActiveAdmin && (await otherActiveAdmins(c, actor.familyId, id)) === 0) {
      throw new HttpError(409, "last_admin", "Impossible : c'est le dernier administrateur actif");
    }
    const r = await c.query("UPDATE profiles SET display_name = $2, role = $3, active = $4 WHERE id = $1 RETURNING *", [
      id,
      input.displayName ?? t.display_name,
      role,
      active,
    ]);
    const deactivated = t.active && !active;
    if (deactivated) await revokeProfileSessions(c, id);
    // A profile that is deactivated or becomes staff no longer receives notifications on any phone.
    if (deactivated || role === "staff") await c.query("DELETE FROM push_subscriptions WHERE profile_id = $1", [id]);
    if (input.role && input.role !== t.role) await audit(c, actor.familyId, actor.profileId, "profile.role_changed", id, { from: t.role, to: role });
    if (t.active !== active) await audit(c, actor.familyId, actor.profileId, active ? "profile.reactivated" : "profile.deactivated", id);
    return { view: toView(r.rows[0]), deactivated };
  });
  if (deactivated) hub.disconnectProfile(id); // after commit: open SSE streams are cut at once
  return view;
}

/** « Modifier le mot de passe » : l'ancien n'est jamais affiché ni renvoyé ; toutes les sessions du profil sont révoquées. */
export async function resetSecret(db: Db, hub: SseHub, actor: AuthContext, id: string, secret: string, secretConfirm: string): Promise<void> {
  checkChosenSecret(secret, secretConfirm);
  const hash = await hashSecret(secret);
  await withTx(db, async (c) => {
    await lockFamily(c, actor.familyId);
    await loadTarget(c, actor.familyId, id);
    await c.query("UPDATE profiles SET secret_hash = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1", [id, hash]);
    await revokeProfileSessions(c, id);
    await audit(c, actor.familyId, actor.profileId, "profile.secret_reset", id);
  });
  hub.disconnectProfile(id);
}

/** Emergency path for the operator (no session): see admin-cli.ts. */
export async function operatorResetSecret(db: Db, familyCode: string, login: string): Promise<string> {
  const code = generateSecret();
  const hash = await hashSecret(code);
  await withTx(db, async (c) => {
    const r = await c.query(
      "SELECT p.id, p.family_id FROM profiles p JOIN families f ON f.id = p.family_id WHERE f.code = $1 AND p.login = $2 FOR UPDATE OF p",
      [familyCode, login],
    );
    const p = r.rows[0];
    if (!p) throw new HttpError(404, "not_found", "Profil introuvable");
    await c.query("UPDATE profiles SET secret_hash = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1", [p.id, hash]);
    await revokeProfileSessions(c, p.id);
    await audit(c, p.family_id, null, "profile.secret_reset_by_operator", p.id);
  });
  return code;
}
