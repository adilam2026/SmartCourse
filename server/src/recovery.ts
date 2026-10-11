import { createHash, timingSafeEqual } from "node:crypto";
import { withTx, type Db } from "./db.js";
import { revokeProfileSessions } from "./auth.js";
import { HttpError } from "./errors.js";
import type { SseHub } from "./hub.js";
import { appBaseUrl, explainMailFailure, templates, type Mailer, type OutgoingMail } from "./mail.js";
import { checkChosenSecret } from "./profiles.js";
import { hashSecret, hashToken, newToken } from "./security.js";

const VERIFY_HOURS = 48;
const RESET_MINUTES = 60;
/** Per profile / per address, to stop a person (or a bot) from flooding a mailbox. */
const MAX_MAILS_PER_HOUR = 3;
/** Minimum wait between two verification links requested by hand. */
const RESEND_COOLDOWN_SEC = 30;

export const normalizeEmail = (s: string): string => s.trim().toLowerCase();
const emailHash = (e: string) => createHash("sha256").update(normalizeEmail(e)).digest("hex");
export function maskEmail(e: string): string {
  const [u = "", d = ""] = normalizeEmail(e).split("@");
  return `${u.slice(0, 1)}***@${d}`;
}

/** What the screens may know about the last message: nothing about the sending service, only « on its way / sent / not sent ». */
export interface MailStatusView {
  kind: string;
  status: "sending" | "sent" | "failed";
  at: string;
}

/** Minimal logger shape (Fastify's `app.log` fits). */
export interface MailLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export class RecoveryService {
  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
    private readonly baseUrl: string = appBaseUrl(),
    private readonly opts: { resendCooldownSec?: number } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private log: MailLog | null = null;
  /** The REAL cause of every failure goes here (server logs), with no key, no address, no content. */
  setLogger(log: MailLog): void {
    this.log = log;
  }
  /** Default logger (the application's own), unless one was set explicitly. */
  useLogger(log: MailLog): void {
    this.log ??= log;
  }

  get enabled(): boolean {
    return this.mailer.enabled;
  }

  /** Background sends (anti-enumeration answers do not wait for them); tests wait on this. */
  private pending = new Set<Promise<unknown>>();
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
  private background(p: Promise<unknown>): void {
    const q = p.catch(() => {}).finally(() => this.pending.delete(q));
    this.pending.add(q);
  }

  /** Records the attempt, hands the message to the mailer and records what the service answered. */
  private async deliver(kind: "verify_email" | "reset_password" | "family_code" | "test", profileId: string | null, mail: OutgoingMail, token?: string): Promise<void> {
    const log = (
      await this.db.query(
        "INSERT INTO email_log (kind, profile_id, recipient_hash, recipient_masked, status) VALUES ($1,$2,$3,$4,'queued') RETURNING id",
        [kind, profileId, emailHash(mail.to), maskEmail(mail.to)],
      )
    ).rows[0].id as string;
    const r = await this.mailer.send(mail);
    const status = r.accepted ? "accepted" : r.notConfigured ? "not_configured" : r.unknown ? "unknown" : "failed";
    if (r.accepted) this.log?.info({ event: "mail.sent", kind, messageId: r.messageId ? r.messageId.replace(/[<>]/g, "") : null }, "e-mail pris en charge par le service d'envoi");
    else {
      const why = explainMailFailure(status, r.detail ?? null);
      this.log?.warn({ event: "mail.failed", kind, status, cause: why.title, todo: why.hint, detail: r.detail ?? null }, "e-mail non envoyé");
    }
    // Échec certain (refus, réseau, non configuré) : le lien qui n'a pas pu partir est invalidé. Issue inconnue (délai dépassé) : il est conservé.
    if (token && (status === "failed" || status === "not_configured")) await this.db.query("UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL", [hashToken(token)]);
    await this.db.query("UPDATE email_log SET status = $2, provider_message_id = $3, detail = $4, updated_at = now() WHERE id = $1", [
      log,
      status,
      r.messageId ? r.messageId.replace(/[<>]/g, "") : null,
      r.detail ?? null,
    ]);
  }

  private async recentMails(kind: string, recipientHash: string): Promise<number> {
    return (await this.db.query("SELECT count(*)::int AS n FROM email_log WHERE kind = $1 AND recipient_hash = $2 AND status NOT IN ('failed', 'not_configured') AND created_at > now() - interval '1 hour'", [kind, recipientHash])).rows[0].n;
  }

  private async issueToken(purpose: "verify_email" | "reset_password", profileId: string, email: string): Promise<string> {
    const token = newToken();
    const ttl = purpose === "verify_email" ? `${VERIFY_HOURS} hours` : `${RESET_MINUTES} minutes`;
    await withTx(this.db, async (c) => {
      // A new link cancels the previous ones of the same purpose: only the latest e-mail works.
      await c.query("UPDATE auth_tokens SET used_at = now() WHERE profile_id = $1 AND purpose = $2 AND used_at IS NULL", [profileId, purpose]);
      await c.query("INSERT INTO auth_tokens (purpose, profile_id, email, token_hash, expires_at) VALUES ($1,$2,$3,$4, now() + $5::interval)", [
        purpose,
        profileId,
        normalizeEmail(email),
        hashToken(token),
        ttl,
      ]);
    });
    return token;
  }

  // ---- adresse de récupération (administrateur principal) -------------------------------------------------------

  async state(profileId: string): Promise<{ canEdit: boolean; email: string | null; verified: boolean; setupPending: boolean; lastMail: MailStatusView | null; resendInSeconds: number }> {
    const p = (await this.db.query("SELECT p.is_primary, p.recovery_email, p.recovery_email_verified_at, f.setup_completed_at IS NULL AS setup_pending FROM profiles p JOIN families f ON f.id = p.family_id WHERE p.id = $1", [profileId])).rows[0];
    const last = (
      await this.db.query("SELECT kind, status, detail, updated_at FROM email_log WHERE profile_id = $1 AND kind IN ('verify_email', 'test') ORDER BY created_at DESC LIMIT 1", [profileId])
    ).rows[0];
    return {
      canEdit: !!p?.is_primary,
      email: p?.recovery_email ?? null,
      verified: !!p?.recovery_email_verified_at,
      setupPending: !!p?.setup_pending,
      resendInSeconds: await this.resendWait(profileId),
      lastMail: last ? { kind: last.kind, status: last.status === "queued" ? "sending" : last.status === "accepted" || last.status === "delivered" ? "sent" : "failed", at: new Date(last.updated_at).toISOString() } : null,
    };
  }

  /** Seconds before a new verification link may be requested (a message that left, or may have left, less than the cooldown ago). */
  private async resendWait(profileId: string): Promise<number> {
    const cool = this.opts.resendCooldownSec ?? RESEND_COOLDOWN_SEC;
    if (cool <= 0) return 0;
    const r = (await this.db.query("SELECT ceil(extract(epoch from (created_at + make_interval(secs => $2) - now())))::int AS s, status IN ('failed', 'not_configured') AS failed FROM email_log WHERE profile_id = $1 AND kind = 'verify_email' ORDER BY created_at DESC LIMIT 1", [profileId, cool])).rows[0];
    if (!r || r.failed) return 0; // the latest attempt did not leave: no reason to wait
    return Math.max(0, Number(r.s ?? 0));
  }

  /** Registers (or changes) the address and sends the verification link. The address is unusable for recovery until verified. */
  async setEmail(profileId: string, email: string): Promise<void> {
    const e = normalizeEmail(email);
    const p = (await this.db.query("SELECT is_primary FROM profiles WHERE id = $1", [profileId])).rows[0];
    if (!p?.is_primary) throw new HttpError(403, "forbidden", "Seul l'administrateur principal peut gérer l'adresse de récupération");
    await this.db.query("UPDATE profiles SET recovery_email = $2, recovery_email_verified_at = NULL WHERE id = $1", [profileId, e]);
    await this.sendVerification(profileId);
  }

  /** First installation: the address given at creation (already stored, unverified) receives its link. */
  async sendInitialVerification(profileId: string): Promise<void> {
    await this.sendVerification(profileId);
  }

  async resendVerification(profileId: string): Promise<void> {
    const p = (await this.db.query("SELECT is_primary, recovery_email, recovery_email_verified_at FROM profiles WHERE id = $1", [profileId])).rows[0];
    if (!p?.is_primary) throw new HttpError(403, "forbidden", "Seul l'administrateur principal peut gérer l'adresse de récupération");
    if (!p.recovery_email) throw new HttpError(400, "no_email", "Aucune adresse enregistrée");
    if (p.recovery_email_verified_at) return;
    if ((await this.resendWait(profileId)) > 0) throw new HttpError(429, "too_soon", "Un lien vient d'être envoyé : patientez un instant avant de le renvoyer");
    await this.sendVerification(profileId);
  }

  private async sendVerification(profileId: string): Promise<void> {
    const p = (await this.db.query("SELECT recovery_email FROM profiles WHERE id = $1", [profileId])).rows[0];
    if (!p?.recovery_email) return;
    if ((await this.recentMails("verify_email", emailHash(p.recovery_email))) >= MAX_MAILS_PER_HOUR) throw new HttpError(429, "too_many_mails", "Trop d'e-mails envoyés à cette adresse : réessayez dans une heure");
    const token = await this.issueToken("verify_email", profileId, p.recovery_email);
    // The administrator is waiting for the answer here: the result of the hand-over is recorded before replying.
    await this.deliver("verify_email", profileId, templates.verifyEmail(p.recovery_email, `${this.baseUrl}/#/verify/${encodeURIComponent(token)}`), token);
  }

  /** Real check of the sending chain: a short message to the VERIFIED address. The result recorded is the service's answer (accepted ≠ received). */
  async sendTest(profileId: string): Promise<void> {
    const p = (await this.db.query("SELECT is_primary, recovery_email, recovery_email_verified_at FROM profiles WHERE id = $1", [profileId])).rows[0];
    if (!p?.is_primary) throw new HttpError(403, "forbidden", "Seul l'administrateur principal peut gérer l'adresse de récupération");
    if (!p.recovery_email || !p.recovery_email_verified_at) throw new HttpError(400, "email_not_verified", "L'adresse doit d'abord être vérifiée");
    if ((await this.recentMails("test", emailHash(p.recovery_email))) >= MAX_MAILS_PER_HOUR) throw new HttpError(429, "too_many_mails", "Trop d'e-mails envoyés à cette adresse : réessayez dans une heure");
    await this.deliver("test", profileId, templates.test(p.recovery_email));
  }

  /** Link clicked: the address becomes usable for recovery. The token proves control of the mailbox. */
  async verifyEmail(token: string): Promise<void> {
    await withTx(this.db, async (c) => {
      const t = (
        await c.query(
          "UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > now() RETURNING profile_id, email",
          [hashToken(token)],
        )
      ).rows[0];
      if (!t) throw new HttpError(400, "invalid_link", "Ce lien n'est plus valable");
      // The address must still be the one that was verified (it may have been changed since).
      const r = await c.query("UPDATE profiles SET recovery_email_verified_at = now() WHERE id = $1 AND lower(recovery_email) = $2 RETURNING family_id", [t.profile_id, t.email]);
      if (!r.rows[0]) throw new HttpError(400, "invalid_link", "Ce lien n'est plus valable");
      await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action, target_profile_id) VALUES ($1,$2,'profile.recovery_email_verified',$2)", [r.rows[0].family_id, t.profile_id]);
      // Première installation : la famille n'est installée qu'une fois l'adresse du principal vérifiée.
      const done = await c.query("UPDATE families SET setup_completed_at = now() WHERE id = $1 AND setup_completed_at IS NULL AND EXISTS (SELECT 1 FROM profiles WHERE id = $2 AND is_primary)", [r.rows[0].family_id, t.profile_id]);
      if (done.rowCount) await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action) VALUES ($1,$2,'family.setup_completed')", [r.rows[0].family_id, t.profile_id]);
    });
  }

  // ---- récupération (sans session) -----------------------------------------------------------------------------

  /**
   * Same answer whether or not the address is known. The mail leaves only for a VERIFIED address of a primary administrator.
   * The code is not secret on its own (a login still needs an identifier and a password) but it is only sent to that mailbox.
   */
  async forgotFamilyCode(email: string): Promise<void> {
    const e = normalizeEmail(email);
    const rows = (
      await this.db.query(
        `SELECT p.id, f.code, f.name FROM profiles p JOIN families f ON f.id = p.family_id
          WHERE lower(p.recovery_email) = $1 AND p.recovery_email_verified_at IS NOT NULL AND p.is_primary AND p.active ORDER BY f.created_at`,
        [e],
      )
    ).rows;
    if (!rows.length || (await this.recentMails("family_code", emailHash(e))) >= MAX_MAILS_PER_HOUR) return;
    this.background(this.deliver("family_code", rows[0].id, templates.familyCode(e, rows.map((r) => ({ name: r.name, code: r.code })))));
  }

  /** A link to choose a NEW password; the old one is never sent nor shown. */
  async forgotPassword(email: string, familyCode?: string): Promise<void> {
    const e = normalizeEmail(email);
    const rows = (
      await this.db.query(
        `SELECT p.id FROM profiles p JOIN families f ON f.id = p.family_id
          WHERE lower(p.recovery_email) = $1 AND p.recovery_email_verified_at IS NOT NULL AND p.is_primary AND p.active
            AND ($2::text IS NULL OR f.code = $2)`,
        [e, familyCode ? familyCode.trim().toUpperCase() : null],
      )
    ).rows;
    for (const r of rows) {
      if ((await this.recentMails("reset_password", emailHash(e))) >= MAX_MAILS_PER_HOUR) return;
      const token = await this.issueToken("reset_password", r.id, e);
      this.background(this.deliver("reset_password", r.id, templates.resetPassword(e, `${this.baseUrl}/#/reset/${encodeURIComponent(token)}`), token));
    }
  }

  async checkResetToken(token: string): Promise<boolean> {
    const r = await this.db.query("SELECT 1 FROM auth_tokens WHERE token_hash = $1 AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > now()", [hashToken(token)]);
    return r.rowCount === 1;
  }

  /** The new password replaces the old one, every session of the profile is revoked, the lockout is cleared. Single use. */
  async resetPassword(hub: SseHub, token: string, secret: string, confirm: string): Promise<void> {
    checkChosenSecret(secret, confirm);
    const hash = await hashSecret(secret);
    const profileId = await withTx(this.db, async (c) => {
      const t = (
        await c.query(
          "UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1 AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > now() RETURNING profile_id, email",
          [hashToken(token)],
        )
      ).rows[0];
      if (!t) throw new HttpError(400, "invalid_link", "Ce lien n'est plus valable : demandez-en un nouveau");
      // Still the verified address of an active primary administrator at the time of use.
      const p = (await c.query("SELECT family_id FROM profiles WHERE id = $1 AND active AND is_primary AND lower(recovery_email) = $2 AND recovery_email_verified_at IS NOT NULL FOR UPDATE", [t.profile_id, t.email])).rows[0];
      if (!p) throw new HttpError(400, "invalid_link", "Ce lien n'est plus valable : demandez-en un nouveau");
      await c.query("UPDATE profiles SET secret_hash = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1", [t.profile_id, hash]);
      await c.query("UPDATE auth_tokens SET used_at = now() WHERE profile_id = $1 AND used_at IS NULL", [t.profile_id]);
      await revokeProfileSessions(c, t.profile_id);
      await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action, target_profile_id) VALUES ($1,NULL,'profile.secret_reset_by_email',$2)", [p.family_id, t.profile_id]);
      return t.profile_id as string;
    });
    hub.disconnectProfile(profileId);
  }

  // ---- retour du service d'envoi (webhook Brevo) ----------------------------------------------------------------

  /** Brevo reports what became of a message: only then does a message count as « remis » (still not proof of reading). */
  async providerEvent(event: string, messageId: string | undefined): Promise<boolean> {
    if (!messageId) return false;
    const status = event === "delivered" ? "delivered" : ["hard_bounce", "soft_bounce", "blocked", "invalid_email", "spam", "error"].includes(event) ? "bounced" : null;
    if (!status) return false;
    const r = await this.db.query(
      // A later « delivered » never hides a bounce, and an « accepted » is only ever raised.
      "UPDATE email_log SET status = $2, detail = $3, updated_at = now() WHERE provider_message_id = $1 AND NOT (status = 'bounced' AND $2 = 'delivered')",
      [messageId.replace(/[<>]/g, ""), status, `événement du service : ${event}`],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

export function secretMatches(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
