import cookie from "@fastify/cookie";
import { DEFAULT_SIGNUP_LIMITS, ipKey, resendSignupCode, signupLimitsFromEnv, startSignup, verifySignup, type SignupLimits } from "./signup.js";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { readFile } from "node:fs/promises";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { ZodError, z } from "zod";
import { authenticate, confirmPassword, login, revokeSession, setupFamily, type AuthContext, SESSION_DAYS } from "./auth.js";
import { backupStatus } from "./backup.js";
import { catalogRoutes } from "./catalog-routes.js";
import { familyProductRoutes } from "./family-products.js";
import { COOKIE, makeGuard } from "./guard.js";
import { listRoutes } from "./list-routes.js";
import { statsRoutes } from "./stats-routes.js";
import { PushService } from "./push.js";
import { pushRoutes } from "./push-routes.js";
import type { PhotoStore } from "./photos.js";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";
import { SseHub } from "./hub.js";
import { can, type Action } from "./permissions.js";
import { canonicalCity } from "./cities.js";
import { COUNTRIES, isCountry } from "./countries.js";
import { familyLocation, locationRoutes } from "./location.js";
import { priceRoutes } from "./prices.js";
import { templateRoutes } from "./templates.js";
import { priceCommunityRoutes } from "./price-community.js";
import { createProfile, deleteOwnAccount, deleteProfile, listProfiles, resetSecret, setOwnCity, transferPrimary, updateProfile } from "./profiles.js";
import { mailerFromEnv } from "./mail.js";
import { countFamilyData, identifyFamily, purgeFamily } from "./family-purge.js";
import { RecoveryService, secretMatches } from "./recovery.js";
import { NEW_SECRET_PATTERN, NEW_SECRET_RULE, SECRET_PATTERN } from "./security.js";

export interface AppDeps {
  db: Db;
  hub?: SseHub;
  store: PhotoStore;
  /** Contact address printed on the public privacy / deletion pages (CONTACT_EMAIL). Absent: the pages say so instead of inventing one. */
  contactEmail?: string;
  /** Gestionnaires du catalogue commun (identifiants de profils, variable CATALOG_MANAGERS), en plus de la table catalog_managers. */
  catalogManagers?: string[];
  /** Built PWA (web/dist). When set, the server also serves the app and falls back to index.html. */
  webDir?: string;
  /** Digital Asset Links (Android app ↔ this site), served at /.well-known/assetlinks.json: lets the Android app open the site without an address bar. Public data (certificate fingerprints). */
  assetLinks?: unknown;
  /** Where scheduled backups go (null = not set up). */
  backupStorage?: "s3" | "local" | null;
  /** "external": backups are made by the scheduled job, the app only shows their state. */
  backupMode?: "internal" | "external";
  /** Per-IP limits on the unauthenticated routes. */
  loginRateLimit?: { max: number; timeWindow: string };
  /** Création de famille autonome : limites par adresse IP des routes, et limites métier (adresse, global, essais). */
  signupRateLimit?: { max: number; timeWindow: string };
  signupVerifyRateLimit?: { max: number; timeWindow: string };
  signupLimits?: Partial<SignupLimits>;
  /** How often an open SSE stream re-checks its session (catches out-of-band revocation). */
  sseRevalidateMs?: number;
  /** Notifications service (tests give it a sender that records instead of calling a push service). */
  push?: PushService;
  /** Récupération par e-mail (tests : expéditeur factice ; production : Brevo si les paramètres sont présents). */
  recovery?: RecoveryService;
  /** Jeton de l'adresse du webhook Brevo (BREVO_WEBHOOK_SECRET) ; sans lui, le webhook est fermé. */
  brevoWebhookSecret?: string;
  /** Demandes de récupération sans session, par IP (par défaut 5 par heure, comme Petits Héros). */
  recoveryRateLimit?: { max: number; timeWindow: string };
  /** Première installation : adresse de récupération obligatoire et vérifiée (toujours vrai en production ; les tests d'avant cette règle peuvent la lever avec SC_LEGACY_SETUP=1, ignoré hors NODE_ENV=test). */
  requireRecoveryEmail?: boolean;
  /** Ville obligatoire à la création d'un profil et du premier administrateur (toujours vrai en production ; levée seulement par SC_CITY_OPTIONAL=1 sous NODE_ENV=test). */
  requireCity?: boolean;
}


const loginSchema = z.object({
  familyCode: z.string().trim().toUpperCase().min(1).max(20),
  login: z.string().trim().toLowerCase().min(1).max(40),
  secret: z.string().regex(SECRET_PATTERN),
});
const loginField = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,30}$/);
/** Un NOUVEAU code : 6 à 8 chiffres (les anciens mots de passe à lettres restent acceptés à la connexion seulement). */
const secretField = z.string().regex(NEW_SECRET_PATTERN, "entre 6 et 8 chiffres");
const emailField = z.string().trim().toLowerCase().email().max(254);
const roleField = z.enum(["admin", "parent", "staff"]);
const nameField = z.string().trim().min(1).max(40);

/** Ville choisie dans la liste (nom canonique) ; absente seulement là où la règle est levée (tests des anciennes règles). */
const cityIn = z.string().trim().max(60).optional();
function resolveCity(raw: string | undefined, required: boolean): string | undefined {
  if (raw === undefined || raw === "") {
    if (required) throw new HttpError(400, "city_required", "La ville est obligatoire");
    return undefined;
  }
  const c = canonicalCity(raw);
  if (!c) throw new HttpError(400, "invalid_city", "Choisissez une ville dans la liste");
  return c;
}

const setupSchema = z.object({
  installToken: z.string().min(16).max(200),
  familyName: z.string().trim().min(1).max(60),
  admin: z.object({ displayName: nameField, login: loginField, secret: secretField, secretConfirm: z.string().optional(), recoveryEmail: emailField.optional(), city: cityIn }),
});

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { db } = deps;
  const hub = deps.hub ?? new SseHub();
  const push = deps.push ?? new PushService(db);
  const recovery = deps.recovery ?? new RecoveryService(db, mailerFromEnv());
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true });
  recovery.useLogger(app.log); // la vraie cause des échecs d'envoi va dans les journaux du serveur, jamais à l'écran
  app.log.info({ event: "mail.config", mail: recovery.enabled ? "on" : "off" }, "envoi d'e-mails");

  // Plugins must be fully loaded before routes are declared, or per-route rateLimit config is silently ignored.
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) {
      // Nouveau code d'accès mal formé : message précis et identique partout (application, site, serveur).
      if (err.issues.some((i) => i.message === "entre 6 et 8 chiffres")) return reply.code(400).send({ error: "invalid_secret", message: NEW_SECRET_RULE });
      return reply.code(400).send({ error: "invalid_request", issues: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: "bad_request", message: (err as Error).message });
    app.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  const setSessionCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_DAYS * 24 * 3600,
    });

  const guard = makeGuard(db);

  const limit = deps.loginRateLimit ?? { max: 20, timeWindow: "1 minute" };

  app.get("/health", async (_req, reply) => {
    try {
      // The latest applied migration tells which version of the schema this server runs (checked after a deployment).
      const m = await db.query("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1");
      return { status: "ok", schema: (m.rows[0]?.name as string | undefined) ?? null, mail: recovery.enabled ? "on" : "off", commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? null };
    } catch {
      return reply.code(503).send({ status: "db_unavailable" });
    }
  });

  const requireCity = deps.requireCity ?? !(process.env.NODE_ENV === "test" && process.env.SC_CITY_OPTIONAL === "1");
  const requireEmail = deps.requireRecoveryEmail ?? !(process.env.NODE_ENV === "test" && process.env.SC_LEGACY_SETUP === "1");
  app.post("/api/setup/family", { config: { rateLimit: limit } }, async (req, reply) => {
    const input = setupSchema.parse(req.body);
    if (input.admin.secretConfirm !== undefined && input.admin.secretConfirm !== input.admin.secret) throw new HttpError(400, "secret_mismatch", "Les deux codes secrets ne sont pas identiques");
    const { recoveryEmail, secretConfirm: _c, city: rawCity, ...admin } = input.admin;
    const city = resolveCity(rawCity, requireCity); // avant toute création : le jeton n'est pas consommé en cas de refus
    if (requireEmail) {
      // Avant toute création (et sans consommer le jeton) : une installation ne doit jamais laisser un compte inutilisable.
      if (!recoveryEmail) throw new HttpError(400, "email_required", "Une adresse e-mail de récupération est obligatoire");
      if (!recovery.enabled) {
        app.log.error({ event: "mail.not_configured" }, "installation refusée : envoi d'e-mails non configuré (BREVO_API_KEY / BREVO_FROM_EMAIL)");
        throw new HttpError(503, "mail_unavailable", "L'e-mail n'a pas pu être envoyé. Veuillez réessayer dans quelques instants.");
      }
    }
    const r = await setupFamily(db, { ...input, admin: { ...admin, ...(city ? { city } : {}), ...(recoveryEmail ? { recoveryEmail } : {}) } });
    setSessionCookie(reply, r.token);
    // La famille existe, en attente de vérification. Un échec d'envoi n'annule rien : l'écran de vérification permet de réessayer.
    let state: Awaited<ReturnType<RecoveryService["state"]>> | null = null;
    if (recoveryEmail) {
      await recovery.sendInitialVerification(r.auth.profileId).catch(() => {});
      state = await recovery.state(r.auth.profileId);
    }
    return reply.code(201).send({ familyCode: r.familyCode, me: publicMe(r.auth), recovery: state });
  });

  // ---- Création de famille autonome depuis l'application (sans jeton) : adresse vérifiée par code AVANT toute création. ----
  // L'installation par jeton (/api/setup/family) reste inchangée et protégée.
  // Plafonds modifiables par les variables du service (SIGNUP_MAX_FAMILIES_PER_DAY…), sans reconstruire l'application.
  const signupLimits = { ...DEFAULT_SIGNUP_LIMITS, ...signupLimitsFromEnv(process.env, (m) => app.log.warn({ event: "signup.config" }, m)), ...(deps.signupLimits ?? {}) };
  app.log.info({ event: "signup.limits", familiesPerDay: signupLimits.familiesPerDay, requestsPerHour: signupLimits.globalPerHour }, "création de famille : plafonds");
  const signupOpen = () => {
    if (process.env.SIGNUP_DISABLED === "1") throw new HttpError(503, "signups_closed", "La création de famille est momentanément fermée : réessayez plus tard");
  };
  const signupStartSchema = z.object({
    requestId: z.string().uuid(),
    familyName: z.string().trim().min(1).max(60),
    displayName: nameField,
    login: loginField,
    // Pays (code ISO) ; ville seulement pour le Maroc. Sans pays (ancienne application) : une ville marocaine vaut « Maroc ».
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
    city: z.string().trim().max(60).optional(),
    email: emailField,
    secret: secretField,
    secretConfirm: z.string(),
  });
  app.post("/api/signup/start", { config: { rateLimit: deps.signupRateLimit ?? { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    signupOpen();
    const b = signupStartSchema.parse(req.body);
    if (b.secretConfirm !== b.secret) throw new HttpError(400, "secret_mismatch", "Les deux codes d'accès ne sont pas identiques");
    const country = b.country ?? (b.city ? "MA" : undefined);
    if (!country) throw new HttpError(400, "country_required", "Choisissez le pays de la famille");
    if (!isCountry(country)) throw new HttpError(400, "invalid_country", "Choisissez un pays dans la liste");
    const city = country === "MA" ? resolveCity(b.city, true)! : null;
    const v = await startSignup(db, recovery, { requestId: b.requestId, familyName: b.familyName, displayName: b.displayName, login: b.login, city, country, email: b.email, secret: b.secret }, ipKey(req.ip), signupLimits);
    return reply.code(201).send(v);
  });
  app.post("/api/signup/resend", { config: { rateLimit: deps.signupRateLimit ?? { max: 10, timeWindow: "1 hour" } } }, async (req) => {
    signupOpen();
    const { signupId } = z.object({ signupId: z.string().uuid() }).parse(req.body);
    return resendSignupCode(db, recovery, signupId, signupLimits);
  });
  app.post("/api/signup/verify", { config: { rateLimit: deps.signupVerifyRateLimit ?? { max: 20, timeWindow: "10 minutes" } } }, async (req, reply) => {
    signupOpen();
    const { signupId, code } = z.object({ signupId: z.string().uuid(), code: z.string().trim().max(12) }).parse(req.body);
    const r = await verifySignup(db, signupId, code, signupLimits);
    setSessionCookie(reply, r.token);
    return reply.code(201).send({ familyCode: r.familyCode, me: publicMe(r.auth) });
  });

  app.post("/api/auth/login", { config: { rateLimit: limit } }, async (req, reply) => {
    const r = await login(db, loginSchema.parse(req.body));
    setSessionCookie(reply, r.token);
    return { me: publicMe(r.auth) };
  });

  app.post("/api/auth/logout", { preHandler: guard(undefined, { allowPending: true }) }, async (req, reply) => {
    await revokeSession(db, req.auth!.sessionId);
    hub.disconnectSession(req.auth!.sessionId);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: guard(undefined, { allowPending: true }) }, async (req) => {
    const a = req.auth!;
    const me: Record<string, unknown> = publicMe(a);
    const pr = (await db.query("SELECT show_prices, show_totals, prefs_rev, city FROM profiles WHERE id = $1", [a.profileId])).rows[0];
    me.city = pr?.city ?? null;
    me.prefs = { showPrices: !!pr?.show_prices, showTotals: !!pr?.show_totals, rev: Number(pr?.prefs_rev ?? 0) };
    me.location = await familyLocation(db, a.familyId, can(a.role, "family.manage"));
    if (can(a.role, "family.manage")) {
      const f = await db.query("SELECT code, name FROM families WHERE id = $1", [a.familyId]);
      me.family = { code: f.rows[0].code, name: f.rows[0].name };
      me.primary = !!(await db.query("SELECT is_primary FROM profiles WHERE id = $1", [a.profileId])).rows[0]?.is_primary;
    }
    return { me };
  });

  // --- profils (administrateur) ---
  app.get("/api/profiles", { preHandler: guard("family.manage") }, async (req) => ({
    profiles: await listProfiles(db, req.auth!.familyId),
  }));

  app.post("/api/profiles", { preHandler: guard("family.manage") }, async (req, reply) => {
    const body = z
      .object({ displayName: nameField, login: loginField, role: roleField, secret: secretField, secretConfirm: z.string(), city: cityIn })
      .parse(req.body);
    const city = resolveCity(body.city, requireCity);
    return reply.code(201).send(await createProfile(db, req.auth!, { ...body, city })); // le mot de passe est choisi par l'administrateur : il n'est jamais renvoyé
  });

  app.patch("/api/profiles/:id", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ displayName: nameField.optional(), role: roleField.optional(), active: z.boolean().optional() }).parse(req.body);
    return { profile: await updateProfile(db, hub, req.auth!, id, body) };
  });

  // Ma ville : choisie dans la liste, modifiable à tout moment.
  app.put("/api/me/city", { preHandler: guard() }, async (req) => {
    const b = z.object({ city: z.string().trim().max(60) }).parse(req.body);
    const city = resolveCity(b.city, true)!;
    await setOwnCity(db, req.auth!.profileId, city);
    return { city };
  });

  // Suppression d'un profil (jamais celui d'un administrateur : il faut d'abord lui retirer ce rôle) ; la famille reste intacte.
  app.delete("/api/profiles/:id", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await deleteProfile(db, hub, req.auth!, id);
    return { ok: true };
  });

  // « Supprimer mon compte » : toute personne connectée (personnel compris) supprime son propre profil en retapant son mot de passe.
  app.post("/api/me/delete", { preHandler: guard(), config: { rateLimit: limit } }, async (req, reply) => {
    const a = req.auth!;
    const body = z.object({ secret: z.string().regex(SECRET_PATTERN) }).parse(req.body ?? {});
    await confirmPassword(db, a.profileId, body.secret);
    await deleteOwnAccount(db, hub, a.familyId, a.profileId, "self");
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  // L'administrateur principal confie ce rôle à un autre administrateur (préalable à la suppression de son seul compte).
  app.post("/api/family/transfer-primary", { preHandler: guard("family.manage"), config: { rateLimit: limit } }, async (req) => {
    const a = req.auth!;
    const body = z.object({ toProfileId: z.string().uuid(), secret: z.string().regex(SECRET_PATTERN) }).parse(req.body ?? {});
    await confirmPassword(db, a.profileId, body.secret);
    return { profile: await transferPrimary(db, a, body.toProfileId) };
  });

  // Page publique de demande de suppression (sans connexion préalable) : mêmes vérifications et mêmes verrouillages que la connexion.
  app.post("/api/account/delete", { config: { rateLimit: limit } }, async (req) => {
    const body = loginSchema.parse(req.body);
    const r = await login(db, body);
    try {
      await deleteOwnAccount(db, hub, r.auth.familyId, r.auth.profileId, "self_public");
    } finally {
      await revokeSession(db, r.auth.sessionId); // la session créée pour la vérification ne sert qu'à elle
    }
    return { ok: true };
  });

  // « Modifier le mot de passe » : deux champs, jamais de génération ni d'affichage ; les sessions du profil sont révoquées.
  app.post("/api/profiles/:id/reset-secret", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ secret: secretField, secretConfirm: z.string() }).parse(req.body ?? {});
    await resetSecret(db, hub, req.auth!, id, body.secret, body.secretConfirm);
    return { ok: true };
  });

  // --- adresse de récupération (administrateur principal) ---
  app.get("/api/recovery-email", { preHandler: guard("family.manage", { allowPending: true }) }, async (req) => recovery.state(req.auth!.profileId));
  app.put("/api/recovery-email", { preHandler: guard("family.manage", { allowPending: true }) }, async (req) => {
    const { email } = z.object({ email: emailField }).parse(req.body);
    await recovery.setEmail(req.auth!.profileId, email);
    return recovery.state(req.auth!.profileId);
  });
  app.post("/api/recovery-email/resend", { preHandler: guard("family.manage", { allowPending: true }) }, async (req) => {
    await recovery.resendVerification(req.auth!.profileId);
    return recovery.state(req.auth!.profileId);
  });

  app.post("/api/recovery-email/test", { preHandler: guard("family.manage"), config: { rateLimit: deps.recoveryRateLimit ?? { max: 10, timeWindow: "1 hour" } } }, async (req) => {
    await recovery.sendTest(req.auth!.profileId);
    return recovery.state(req.auth!.profileId);
  });

  // --- réinitialisation de MA famille (administrateur principal) : suppression définitive, confirmée par mot de passe ET code famille ---
  app.get("/api/family/reset-preview", { preHandler: guard("family.manage") }, async (req) => {
    const me = (await db.query("SELECT is_primary, recovery_email_verified_at FROM profiles WHERE id = $1", [req.auth!.profileId])).rows[0];
    if (!me.is_primary) throw new HttpError(403, "forbidden", "Seul l'administrateur principal peut réinitialiser la famille");
    const fam = await identifyFamily(db, req.auth!.familyId);
    return {
      family: { name: fam.name, code: fam.code, createdAt: fam.createdAt, profiles: fam.profiles },
      counts: await countFamilyData(db, req.auth!.familyId),
      // La preuve que l'envoi d'e-mails fonctionne réellement : une adresse vérifiée est une adresse qui a REÇU un e-mail.
      ready: { recoveryEmailVerified: !!me.recovery_email_verified_at && recovery.enabled },
    };
  });
  app.post("/api/family/reset", { preHandler: guard("family.manage"), config: { rateLimit: deps.recoveryRateLimit ?? { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const b = z.object({ password: z.string().min(1).max(40), confirmCode: z.string().trim().min(1).max(20) }).parse(req.body);
    const a = req.auth!;
    const me = (await db.query("SELECT is_primary, recovery_email_verified_at FROM profiles WHERE id = $1", [a.profileId])).rows[0];
    if (!me.is_primary) throw new HttpError(403, "forbidden", "Seul l'administrateur principal peut réinitialiser la famille");
    if (!recovery.enabled || !me.recovery_email_verified_at) throw new HttpError(409, "reset_not_ready", "Vérifiez d'abord votre adresse e-mail de récupération.");
    await confirmPassword(db, a.profileId, b.password);
    const report = await purgeFamily(db, deps.store, a.familyId, b.confirmCode);
    for (const id of report.profileIds) hub.disconnectProfile(id);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true, family: report.family, deleted: report.deleted, photoFilesRemoved: report.photoFilesRemoved, otherFamiliesUntouched: report.otherFamiliesUntouched, installToken: report.installToken };
  });

  // --- récupération sans session : réponses identiques que l'adresse soit connue ou non ---
  const recoveryLimit = deps.recoveryRateLimit ?? { max: 5, timeWindow: "1 hour" }; // envois d'e-mails
  const linkLimit = deps.loginRateLimit ?? { max: 20, timeWindow: "1 minute" }; // ouverture des liens
  const NEUTRAL = { ok: true, message: "Si cette adresse est enregistrée et vérifiée, un e-mail vient d'être envoyé." };
  app.post("/api/auth/verify-email", { config: { rateLimit: linkLimit } }, async (req) => {
    await recovery.verifyEmail(z.object({ token: z.string().min(20).max(200) }).parse(req.body).token);
    return { ok: true };
  });
  app.post("/api/auth/forgot-family-code", { config: { rateLimit: recoveryLimit } }, async (req) => {
    await recovery.forgotFamilyCode(z.object({ email: emailField }).parse(req.body).email);
    return NEUTRAL;
  });
  app.post("/api/auth/forgot-password", { config: { rateLimit: recoveryLimit } }, async (req) => {
    const b = z.object({ email: emailField, familyCode: z.string().trim().max(20).optional() }).parse(req.body);
    await recovery.forgotPassword(b.email, b.familyCode || undefined);
    return NEUTRAL;
  });
  app.post("/api/auth/reset-password/check", { config: { rateLimit: linkLimit } }, async (req) => ({
    valid: await recovery.checkResetToken(z.object({ token: z.string().min(20).max(200) }).parse(req.body).token),
  }));
  app.post("/api/auth/reset-password", { config: { rateLimit: linkLimit } }, async (req) => {
    const b = z.object({ token: z.string().min(20).max(200), secret: secretField, secretConfirm: z.string() }).parse(req.body);
    await recovery.resetPassword(hub, b.token, b.secret, b.secretConfirm);
    return { ok: true };
  });

  // Retour du service d'envoi : seul canal qui peut faire passer un message de « accepté » à « remis » (ou « rejeté »).
  app.post("/api/email/brevo-webhook/:secret", async (req, reply) => {
    const { secret } = req.params as { secret: string };
    if (!deps.brevoWebhookSecret || !secretMatches(secret, deps.brevoWebhookSecret)) return reply.code(404).send({ error: "not_found" });
    const b = (req.body ?? {}) as { event?: string; "message-id"?: string };
    await recovery.providerEvent(String(b.event ?? ""), typeof b["message-id"] === "string" ? b["message-id"] : undefined);
    return { ok: true };
  });

  app.get("/api/admin/backup-status", { preHandler: guard("family.manage") }, async () => backupStatus(db, deps.backupStorage ?? null, deps.backupMode ?? "internal"));

  catalogRoutes(app, { db, store: deps.store, guard, hub });
  familyProductRoutes(app, { db, store: deps.store, guard, hub, managers: deps.catalogManagers });
  locationRoutes(app, { db, guard, hub, resolveCity: (c) => resolveCity(c, true)! });
  app.get("/api/countries", async () => ({ countries: COUNTRIES }));
  listRoutes(app, { db, hub, guard, push });
  priceRoutes(app, { db, guard, hub });
  templateRoutes(app, { db, guard });
  priceCommunityRoutes(app, { db, guard, hub });
  statsRoutes(app, { db, guard });
  pushRoutes(app, { db, guard, push });

  // --- flux SSE ---
  app.get("/api/events", { preHandler: guard() }, async (req, reply) => {
    const auth = req.auth!;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (s: string) => {
      if (!res.writableEnded) res.write(s);
    };
    let cleanup = () => {};
    const close = () => {
      cleanup();
      if (!res.writableEnded) res.end();
    };
    const off = hub.add({
      familyId: auth.familyId,
      profileId: auth.profileId,
      sessionId: auth.sessionId,
      send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      close,
    });
    const heartbeat = setInterval(() => write(": ping\n\n"), 25_000);
    const revalidate = setInterval(async () => {
      const still = await authenticate(db, req.cookies[COOKIE]).catch(() => auth);
      if (!still) close();
    }, deps.sseRevalidateMs ?? 30_000);
    cleanup = () => {
      clearInterval(heartbeat);
      clearInterval(revalidate);
      off();
    };
    req.raw.on("close", cleanup);
    // Un commentaire de ~2 Ko force les intermédiaires (tunnels, proxys) à vider leur tampon : sans lui, ils peuvent
    // retenir les premiers octets du flux et l'événement « ready » n'arrive pas. Ignoré par EventSource.
    write(`: ${" ".repeat(2048)}\n\n`);
    write("retry: 3000\n\n");
    write(`event: ready\ndata: {}\n\n`);
  });

  if (deps.assetLinks) {
    app.get("/.well-known/assetlinks.json", async (_req, reply) => reply.header("Cache-Control", "public, max-age=3600").type("application/json").send(deps.assetLinks));
  }

  if (deps.webDir) {
    const root = path.resolve(deps.webDir);
    // Pages publiques (sans connexion) : confidentialité et suppression. Toujours relues (jamais mises en cache par le service worker ni par un intermédiaire) ;
    // l'adresse de contact vient de la configuration, jamais du code.
    const contact = deps.contactEmail
      ? `<a href="mailto:${deps.contactEmail}">${deps.contactEmail}</a>`
      : "l'administrateur principal de votre famille (le contact public de l'application n'est pas encore renseigné)";
    for (const name of ["confidentialite", "suppression-compte"]) {
      const serve = async (_req: unknown, reply: FastifyReply) => {
        const html = (await readFile(path.join(root, `${name}.html`), "utf8")).replaceAll("<!--CONTACT-->", contact);
        return reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(html);
      };
      app.get(`/${name}`, serve);
      app.get(`/${name}.html`, serve);
    }
    await app.register(fastifyStatic, {
      root,
      wildcard: false,
      globIgnore: ["confidentialite.html", "suppression-compte.html"], // servies par les routes ci-dessus (adresse de contact injectée)
      setHeaders: (res, file) => {
        // Hashed bundles never change; the shell, service worker and manifest must always be revalidated.
        const immutable = /[\\/]assets[\\/]/.test(file) || /[\\/]icons[\\/]/.test(file);
        res.header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      // Only page addresses fall back to the app shell. A missing FILE (a script, a style, an image…) is a real 404: answering it with the
      // shell would be cached by the service worker as if it were that script and leave the app blank.
      const isFile = /\.[A-Za-z0-9]{1,8}(\?.*)?$/.test(req.url);
      if (req.method === "GET" && !isFile && !req.url.startsWith("/api/") && !req.url.startsWith("/health") && !req.url.startsWith("/.well-known/")) return reply.header("Cache-Control", "no-cache").sendFile("index.html");
      return reply.code(404).send({ error: "not_found" });
    });
  }

  return app;
}

const publicMe = (a: AuthContext) => ({ id: a.profileId, familyId: a.familyId, displayName: a.displayName, login: a.login, role: a.role, setupPending: !!a.setupPending });
