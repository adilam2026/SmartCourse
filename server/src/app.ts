import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { ZodError, z } from "zod";
import { authenticate, confirmPassword, login, revokeSession, setupFamily, type AuthContext, SESSION_DAYS } from "./auth.js";
import { backupStatus } from "./backup.js";
import { catalogRoutes } from "./catalog-routes.js";
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
import { createProfile, listProfiles, resetSecret, updateProfile } from "./profiles.js";
import { mailerFromEnv } from "./mail.js";
import { countFamilyData, identifyFamily, purgeFamily } from "./family-purge.js";
import { RecoveryService, secretMatches } from "./recovery.js";
import { NEW_SECRET_PATTERN, SECRET_PATTERN } from "./security.js";

export interface AppDeps {
  db: Db;
  hub?: SseHub;
  store: PhotoStore;
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
}


const loginSchema = z.object({
  familyCode: z.string().trim().toUpperCase().min(1).max(20),
  login: z.string().trim().toLowerCase().min(1).max(40),
  secret: z.string().regex(SECRET_PATTERN),
});
const loginField = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,30}$/);
/** Un NOUVEAU code : exactement 6 chiffres (les anciens mots de passe à lettres restent acceptés à la connexion seulement). */
const secretField = z.string().regex(NEW_SECRET_PATTERN, "6 chiffres");
const emailField = z.string().trim().toLowerCase().email().max(254);
const roleField = z.enum(["admin", "parent", "staff"]);
const nameField = z.string().trim().min(1).max(40);

const setupSchema = z.object({
  installToken: z.string().min(16).max(200),
  familyName: z.string().trim().min(1).max(60),
  admin: z.object({ displayName: nameField, login: loginField, secret: secretField, secretConfirm: z.string().optional(), recoveryEmail: emailField.optional() }),
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
    if (err instanceof ZodError) return reply.code(400).send({ error: "invalid_request", issues: err.issues });
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

  const requireEmail = deps.requireRecoveryEmail ?? !(process.env.NODE_ENV === "test" && process.env.SC_LEGACY_SETUP === "1");
  app.post("/api/setup/family", { config: { rateLimit: limit } }, async (req, reply) => {
    const input = setupSchema.parse(req.body);
    if (input.admin.secretConfirm !== undefined && input.admin.secretConfirm !== input.admin.secret) throw new HttpError(400, "secret_mismatch", "Les deux codes secrets ne sont pas identiques");
    const { recoveryEmail, secretConfirm: _c, ...admin } = input.admin;
    if (requireEmail) {
      // Avant toute création (et sans consommer le jeton) : une installation ne doit jamais laisser un compte inutilisable.
      if (!recoveryEmail) throw new HttpError(400, "email_required", "Une adresse e-mail de récupération est obligatoire");
      if (!recovery.enabled) {
        app.log.error({ event: "mail.not_configured" }, "installation refusée : envoi d'e-mails non configuré (BREVO_API_KEY / BREVO_FROM_EMAIL)");
        throw new HttpError(503, "mail_unavailable", "L'e-mail n'a pas pu être envoyé. Veuillez réessayer dans quelques instants.");
      }
    }
    const r = await setupFamily(db, { ...input, admin: { ...admin, ...(recoveryEmail ? { recoveryEmail } : {}) } });
    setSessionCookie(reply, r.token);
    // La famille existe, en attente de vérification. Un échec d'envoi n'annule rien : l'écran de vérification permet de réessayer.
    let state: Awaited<ReturnType<RecoveryService["state"]>> | null = null;
    if (recoveryEmail) {
      await recovery.sendInitialVerification(r.auth.profileId).catch(() => {});
      state = await recovery.state(r.auth.profileId);
    }
    return reply.code(201).send({ familyCode: r.familyCode, me: publicMe(r.auth), recovery: state });
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
      .object({ displayName: nameField, login: loginField, role: roleField, secret: secretField, secretConfirm: z.string() })
      .parse(req.body);
    return reply.code(201).send(await createProfile(db, req.auth!, body)); // le mot de passe est choisi par l'administrateur : il n'est jamais renvoyé
  });

  app.patch("/api/profiles/:id", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ displayName: nameField.optional(), role: roleField.optional(), active: z.boolean().optional() }).parse(req.body);
    return { profile: await updateProfile(db, hub, req.auth!, id, body) };
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
  listRoutes(app, { db, hub, guard, push });
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
    await app.register(fastifyStatic, {
      root,
      wildcard: false,
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
