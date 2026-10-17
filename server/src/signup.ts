import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { withTx, type Db } from "./db.js";
import { createFamilyRecords, createSession, type AuthContext } from "./auth.js";
import { HttpError } from "./errors.js";
import type { Role } from "./permissions.js";
import { maskEmail, normalizeEmail, type RecoveryService } from "./recovery.js";
import { hashSecret, isValidNewSecret, isWeakSecret, NEW_SECRET_RULE } from "./security.js";

/**
 * Création de famille autonome depuis l'application, sans jeton d'installation :
 *   1. start  : la demande est vérifiée puis enregistrée, un code à 6 chiffres part à l'adresse (rien n'est créé) ;
 *   2. verify : code exact → la famille, son administrateur principal (adresse vérifiée) et sa session sont créés d'un coup.
 * Protections : limites par adresse IP, par adresse e-mail et globales ; une seule demande ouverte par adresse ; une adresse
 * qui administre déjà une famille est refusée ; essais de code limités ; double appui sans effet (même demande, même famille).
 */
export interface SignupLimits {
  perEmailPerDay: number;
  perIpPerHour: number;
  globalPerHour: number;
  familiesPerDay: number;
  maxAttempts: number;
  codeMinutes: number;
  resendSeconds: number;
  maxSends: number;
  /** Une vérification répétée (double appui) dans ce délai renvoie la même famille, avec une nouvelle session. */
  replayMinutes: number;
}
export const DEFAULT_SIGNUP_LIMITS: SignupLimits = {
  perEmailPerDay: 3,
  perIpPerHour: 5,
  // Demandes (envois de code) toutes adresses confondues : large devant le plafond de familles, pour ne jamais bloquer des
  // inscriptions normales aux heures chargées ; il protège seulement le quota d'envoi d'e-mails contre une rafale.
  globalPerHour: 300,
  // Familles réellement créées (code vérifié) sur 24 heures glissantes, toutes adresses confondues.
  familiesPerDay: 100,
  maxAttempts: 5,
  codeMinutes: 30,
  resendSeconds: 60,
  maxSends: 4,
  replayMinutes: 15,
};

export interface SignupInput {
  requestId: string;
  familyName: string;
  displayName: string;
  login: string;
  city: string;
  email: string;
  secret: string;
}

export interface SignupView {
  signupId: string;
  email: string;
  expiresInMinutes: number;
  resendInSeconds: number;
  /** « sent » : pris en charge par le service d'envoi ; « uncertain » : pas de réponse dans le délai (peut-être parti, à confirmer). */
  delivery?: "sent" | "uncertain";
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const codeHash = (signupId: string, code: string) => sha(`${signupId}:${code}`);
const emailKey = (e: string) => sha(normalizeEmail(e));
export const ipKey = (ip: string | undefined) => (ip ? sha(`ip:${ip}`) : null);
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

async function emailAdministersFamily(q: Pick<Db, "query">, email: string): Promise<boolean> {
  const r = await q.query("SELECT 1 FROM profiles WHERE is_primary AND recovery_email_verified_at IS NOT NULL AND lower(recovery_email) = $1 LIMIT 1", [normalizeEmail(email)]);
  return r.rows.length > 0;
}

function view(row: { id: string; email: string; expires_at: Date; last_sent_at: Date }, limits: SignupLimits): SignupView {
  const wait = Math.ceil((row.last_sent_at.getTime() + limits.resendSeconds * 1000 - Date.now()) / 1000);
  return {
    signupId: row.id,
    email: maskEmail(row.email),
    expiresInMinutes: Math.max(0, Math.ceil((row.expires_at.getTime() - Date.now()) / 60000)),
    resendInSeconds: Math.max(0, wait),
  };
}

/** Limites lues dans l'environnement du serveur (modifiables sans reconstruire l'application) : valeurs entières ≥ 0. */
export function signupLimitsFromEnv(env: NodeJS.ProcessEnv, warn: (msg: string) => void = () => {}): Partial<SignupLimits> {
  const out: Partial<SignupLimits> = {};
  const read = (name: string, key: keyof SignupLimits) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return;
    const v = Number(raw);
    if (Number.isInteger(v) && v >= 0) out[key] = v;
    else warn(`${name} ignoré (entier positif attendu) : valeur par défaut ${DEFAULT_SIGNUP_LIMITS[key]}`);
  };
  read("SIGNUP_MAX_FAMILIES_PER_DAY", "familiesPerDay");
  read("SIGNUP_MAX_REQUESTS_PER_HOUR", "globalPerHour");
  read("SIGNUP_MAX_PER_EMAIL_PER_DAY", "perEmailPerDay");
  read("SIGNUP_MAX_PER_IP_PER_HOUR", "perIpPerHour");
  return out;
}

const FAMILIES_LIMIT = () => new HttpError(429, "families_limit", "La limite temporaire de créations est atteinte. Réessayez plus tard.");
const familiesToday = async (q: Pick<Db, "query">) => Number((await q.query("SELECT count(*)::int AS n FROM family_signups WHERE completed_at > now() - interval '1 day'")).rows[0].n);

/** Le service d'envoi a refusé (ou n'est pas configuré) : la demande est retirée, rien n'est créé, l'application peut réessayer. */
function mailRefused(status: string): boolean {
  return status === "failed" || status === "not_configured";
}

/** Durée de conservation des demandes de création (abouties ou non) et de leurs e-mails de code : les limites n'utilisent que 24 heures. */
export const SIGNUP_RETENTION_DAYS = 30;
export async function purgeOldSignups(db: Pick<Db, "query">): Promise<void> {
  await db.query(`DELETE FROM family_signups WHERE created_at < now() - interval '${SIGNUP_RETENTION_DAYS} days'`);
  await db.query(`DELETE FROM email_log WHERE kind = 'signup_code' AND created_at < now() - interval '${SIGNUP_RETENTION_DAYS} days'`);
}

export async function startSignup(db: Db, recovery: RecoveryService, input: SignupInput, ipHash: string | null, limits: SignupLimits): Promise<SignupView> {
  if (!isValidNewSecret(input.secret)) throw new HttpError(400, "invalid_secret", NEW_SECRET_RULE);
  if (isWeakSecret(input.secret)) throw new HttpError(400, "weak_secret", "Code d'accès trop simple (évitez 123456, 111111…)");
  const email = normalizeEmail(input.email);
  const eh = emailKey(email);
  await purgeOldSignups(db);

  // Double appui : la même demande est renvoyée telle quelle (aucun nouvel e-mail, aucun doublon).
  const same = (await db.query("SELECT id, email, expires_at, last_sent_at, completed_at, superseded_at, email_hash FROM family_signups WHERE request_id = $1", [input.requestId])).rows[0];
  if (same) {
    if (same.email_hash !== eh) throw new HttpError(409, "request_reused", "Demande déjà utilisée : recommencez");
    if (same.completed_at) throw new HttpError(409, "already_completed", "Cette famille est déjà créée : connectez-vous");
    if (same.superseded_at) throw new HttpError(410, "signup_expired", "Demande expirée : recommencez");
    return view(same, limits);
  }

  if (await emailAdministersFamily(db, email)) throw new HttpError(409, "email_in_use", "Cette adresse gère déjà une famille. Utilisez « J'ai oublié mon code » ou « Récupérer ma famille ».");
  if (!recovery.enabled) throw new HttpError(503, "mail_unavailable", "L'e-mail n'a pas pu être envoyé. Veuillez réessayer dans quelques instants.");

  const n = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows[0].n as number;
  if ((await n("SELECT count(*)::int AS n FROM family_signups WHERE email_hash = $1 AND created_at > now() - interval '1 day'", [eh])) >= limits.perEmailPerDay)
    throw new HttpError(429, "too_many_signups", "Trop de demandes pour cette adresse : réessayez demain");
  if (ipHash && (await n("SELECT count(*)::int AS n FROM family_signups WHERE ip_hash = $1 AND created_at > now() - interval '1 hour'", [ipHash])) >= limits.perIpPerHour)
    throw new HttpError(429, "too_many_signups", "Trop de demandes depuis cette connexion : réessayez dans une heure");
  // Plafond de familles déjà atteint : inutile d'envoyer un code (seules les familles créées comptent, jamais les demandes).
  if ((await familiesToday(db)) >= limits.familiesPerDay) throw FAMILIES_LIMIT();
  if ((await n("SELECT count(*)::int AS n FROM family_signups WHERE created_at > now() - interval '1 hour'", [])) >= limits.globalPerHour)
    throw new HttpError(429, "signups_paused", "Beaucoup de demandes en ce moment : réessayez dans quelques minutes");

  const code = newCode();
  const secretHash = await hashSecret(input.secret);
  const insert = () => withTx(db, async (c) => {
    // Une seule demande ouverte par adresse : la précédente est remplacée (son code ne fonctionne plus).
    await c.query("UPDATE family_signups SET superseded_at = now() WHERE email_hash = $1 AND completed_at IS NULL AND superseded_at IS NULL", [eh]);
    const r = await c.query(
      `INSERT INTO family_signups (request_id, email, email_hash, ip_hash, family_name, display_name, login, city, secret_hash, code_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'', now() + make_interval(mins => $10)) RETURNING id, email, expires_at, last_sent_at`,
      [input.requestId, email, eh, ipHash, input.familyName, input.displayName, input.login, input.city, secretHash, limits.codeMinutes],
    );
    await c.query("UPDATE family_signups SET code_hash = $2 WHERE id = $1", [r.rows[0].id, codeHash(r.rows[0].id, code)]);
    return r.rows[0];
  });
  let row: { id: string; email: string; expires_at: Date; last_sent_at: Date };
  try {
    row = await insert();
  } catch (e: any) {
    if (e?.code !== "23505") throw e;
    // Deux appuis simultanés : la demande gagnante est renvoyée ; une autre demande ouverte pour cette adresse : on patiente.
    const won = (await db.query("SELECT id, email, expires_at, last_sent_at FROM family_signups WHERE request_id = $1", [input.requestId])).rows[0];
    if (won) return view(won, limits);
    throw new HttpError(409, "signup_in_progress", "Une demande est déjà en cours pour cette adresse : réessayez dans un instant");
  }
  const status = await recovery.sendSignupCode(email, code).catch(async (e) => {
    await db.query("DELETE FROM family_signups WHERE id = $1", [row.id]);
    throw e;
  });
  if (mailRefused(status)) {
    await db.query("DELETE FROM family_signups WHERE id = $1", [row.id]);
    throw new HttpError(502, "mail_failed", "L'e-mail n'a pas pu être envoyé. Vérifiez l'adresse ou réessayez dans quelques instants.");
  }
  return { ...view(row, limits), delivery: status === "accepted" ? "sent" : "uncertain" };
}

export async function resendSignupCode(db: Db, recovery: RecoveryService, signupId: string, limits: SignupLimits): Promise<SignupView> {
  const r = (await db.query("SELECT id, email, expires_at, last_sent_at, sends, completed_at, superseded_at FROM family_signups WHERE id = $1", [signupId])).rows[0];
  if (!r) throw new HttpError(404, "signup_not_found", "Demande introuvable : recommencez");
  if (r.completed_at) throw new HttpError(409, "already_completed", "Cette famille est déjà créée : connectez-vous");
  if (r.superseded_at) throw new HttpError(410, "signup_expired", "Demande expirée : recommencez");
  const v = view(r, limits);
  if (v.resendInSeconds > 0) throw new HttpError(429, "too_soon", `Patientez ${v.resendInSeconds} s avant de renvoyer le code`);
  if (r.sends >= limits.maxSends) throw new HttpError(429, "too_many_mails", "Trop d'envois pour cette demande : recommencez plus tard");
  const code = newCode();
  const upd = (
    await db.query(
      `UPDATE family_signups SET code_hash = $2, attempts = 0, sends = sends + 1, last_sent_at = now(), expires_at = now() + make_interval(mins => $3)
        WHERE id = $1 AND completed_at IS NULL AND superseded_at IS NULL RETURNING id, email, expires_at, last_sent_at`,
      [signupId, codeHash(signupId, code), limits.codeMinutes],
    )
  ).rows[0];
  if (!upd) throw new HttpError(410, "signup_expired", "Demande expirée : recommencez");
  const status = await recovery.sendSignupCode(r.email, code);
  if (mailRefused(status)) throw new HttpError(502, "mail_failed", "L'e-mail n'a pas pu être envoyé : réessayez dans quelques instants.");
  return { ...view(upd, limits), delivery: status === "accepted" ? "sent" : "uncertain" };
}

export interface SignupResult {
  token: string;
  familyCode: string;
  auth: AuthContext;
}

/**
 * Code exact : création de la famille et de son administrateur principal (adresse vérifiée), puis session.
 * Ligne verrouillée : deux vérifications simultanées ne créent jamais deux familles ; la seconde reçoit la même famille.
 */
export async function verifySignup(db: Db, signupId: string, code: string, limits: SignupLimits): Promise<SignupResult> {
  type Out = { ok: SignupResult } | { error: HttpError };
  const out: Out = await withTx(db, async (c): Promise<Out> => {
    const r = (await c.query("SELECT * FROM family_signups WHERE id = $1 FOR UPDATE", [signupId])).rows[0];
    if (!r) return { error: new HttpError(404, "signup_not_found", "Demande introuvable : recommencez") };
    const good = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(codeHash(r.id, code)), Buffer.from(r.code_hash));
    if (r.completed_at) {
      // Double appui sur « Valider » : même famille, nouvelle session ; jamais de seconde famille.
      const recent = Date.now() - (r.completed_at as Date).getTime() < limits.replayMinutes * 60000;
      if (!good || !recent || !r.profile_id || !r.family_id) return { error: new HttpError(409, "already_completed", "Cette famille est déjà créée : connectez-vous") };
      const fam = (await c.query("SELECT code FROM families WHERE id = $1", [r.family_id])).rows[0];
      if (!fam) return { error: new HttpError(409, "already_completed", "Cette famille est déjà créée : connectez-vous") };
      const s = await createSession(c, r.profile_id);
      return { ok: { token: s.token, familyCode: fam.code, auth: authOf(s, r) } };
    }
    if (r.superseded_at) return { error: new HttpError(410, "signup_expired", "Demande expirée : recommencez") };
    if ((r.expires_at as Date).getTime() < Date.now()) return { error: new HttpError(410, "code_expired", "Ce code a expiré : recevez un nouveau code (vos informations sont conservées)") };
    if (r.attempts >= limits.maxAttempts) return { error: new HttpError(429, "too_many_attempts", "Trop d'essais : demandez un nouveau code") };
    if (!good) {
      const a = r.attempts + 1;
      await c.query("UPDATE family_signups SET attempts = $2 WHERE id = $1", [r.id, a]);
      return { error: new HttpError(400, "invalid_code", a >= limits.maxAttempts ? "Code incorrect. Trop d'essais : demandez un nouveau code" : `Code incorrect (${limits.maxAttempts - a} essai${limits.maxAttempts - a > 1 ? "s" : ""} restant${limits.maxAttempts - a > 1 ? "s" : ""})`) };
    }
    // Plafond quotidien, contrôlé au moment de créer, sous un verrou commun : des validations simultanées ne le dépassent jamais.
    // La demande reste ouverte : elle pourra aboutir quand le plafond le permettra (tant que le code est valable).
    await c.query("SELECT pg_advisory_xact_lock(hashtext('family_signup_daily_cap'))");
    if ((await familiesToday(c)) >= limits.familiesPerDay) return { error: FAMILIES_LIMIT() };
    // Dernier contrôle des doublons, au moment de créer (une autre demande a pu aboutir entre-temps).
    if (await emailAdministersFamily(c, r.email)) return { error: new HttpError(409, "email_in_use", "Cette adresse gère déjà une famille. Utilisez « J'ai oublié mon code » ou « Récupérer ma famille ».") };
    const created = await createFamilyRecords(c, {
      familyName: r.family_name,
      admin: { displayName: r.display_name, login: r.login, secretHash: r.secret_hash, city: r.city, recoveryEmail: r.email, emailVerified: true },
      completed: true,
    });
    await c.query("UPDATE family_signups SET completed_at = now(), family_id = $2, profile_id = $3 WHERE id = $1", [r.id, created.familyId, created.profileId]);
    const s = await createSession(c, created.profileId);
    return { ok: { token: s.token, familyCode: created.code, auth: authOf(s, { ...r, family_id: created.familyId, profile_id: created.profileId }) } };
  });
  if ("error" in out) throw out.error;
  return out.ok;
}

function authOf(s: { token: string; sessionId: string }, r: { profile_id: string; family_id: string; display_name: string; login: string }): AuthContext {
  return { sessionId: s.sessionId, profileId: r.profile_id, familyId: r.family_id, role: "admin" as Role, displayName: r.display_name, login: r.login, setupPending: false };
}
