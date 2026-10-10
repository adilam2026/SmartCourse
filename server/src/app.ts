import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { ZodError, z } from "zod";
import { authenticate, login, revokeSession, setupFamily, type AuthContext, SESSION_DAYS } from "./auth.js";
import { backupStatus } from "./backup.js";
import { catalogRoutes } from "./catalog-routes.js";
import { COOKIE, makeGuard } from "./guard.js";
import { listRoutes } from "./list-routes.js";
import type { PhotoStore } from "./photos.js";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";
import { SseHub } from "./hub.js";
import { can, type Action } from "./permissions.js";
import { createProfile, listProfiles, resetSecret, updateProfile } from "./profiles.js";

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
}


const loginSchema = z.object({
  familyCode: z.string().trim().toUpperCase().min(1).max(20),
  login: z.string().trim().toLowerCase().min(1).max(40),
  secret: z.string().regex(/^\d{6}$/),
});
const loginField = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,30}$/);
const secretField = z.string().regex(/^\d{6}$/);
const roleField = z.enum(["admin", "parent", "staff"]);
const nameField = z.string().trim().min(1).max(40);

const setupSchema = z.object({
  installToken: z.string().min(16).max(200),
  familyName: z.string().trim().min(1).max(60),
  admin: z.object({ displayName: nameField, login: loginField, secret: secretField }),
});

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { db } = deps;
  const hub = deps.hub ?? new SseHub();
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true });

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
      await db.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "db_unavailable" });
    }
  });

  app.post("/api/setup/family", { config: { rateLimit: limit } }, async (req, reply) => {
    const input = setupSchema.parse(req.body);
    const r = await setupFamily(db, input);
    setSessionCookie(reply, r.token);
    return reply.code(201).send({ familyCode: r.familyCode, me: publicMe(r.auth) });
  });

  app.post("/api/auth/login", { config: { rateLimit: limit } }, async (req, reply) => {
    const r = await login(db, loginSchema.parse(req.body));
    setSessionCookie(reply, r.token);
    return { me: publicMe(r.auth) };
  });

  app.post("/api/auth/logout", { preHandler: guard() }, async (req, reply) => {
    await revokeSession(db, req.auth!.sessionId);
    hub.disconnectSession(req.auth!.sessionId);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const me: Record<string, unknown> = publicMe(a);
    if (can(a.role, "family.manage")) {
      const f = await db.query("SELECT code, name FROM families WHERE id = $1", [a.familyId]);
      me.family = { code: f.rows[0].code, name: f.rows[0].name };
    }
    return { me };
  });

  // --- profils (administrateur) ---
  app.get("/api/profiles", { preHandler: guard("family.manage") }, async (req) => ({
    profiles: await listProfiles(db, req.auth!.familyId),
  }));

  app.post("/api/profiles", { preHandler: guard("family.manage") }, async (req, reply) => {
    const body = z
      .object({ displayName: nameField, login: loginField, role: roleField, secret: secretField.optional() })
      .parse(req.body);
    const r = await createProfile(db, req.auth!, body);
    return reply.code(201).send(r); // the secret is shown once, here
  });

  app.patch("/api/profiles/:id", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ displayName: nameField.optional(), role: roleField.optional(), active: z.boolean().optional() }).parse(req.body);
    return { profile: await updateProfile(db, hub, req.auth!, id, body) };
  });

  app.post("/api/profiles/:id/reset-secret", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ secret: secretField.optional() }).parse(req.body ?? {});
    return { secret: await resetSecret(db, hub, req.auth!, id, body.secret) };
  });

  app.get("/api/admin/backup-status", { preHandler: guard("family.manage") }, async () => backupStatus(db, deps.backupStorage ?? null, deps.backupMode ?? "internal"));

  catalogRoutes(app, { db, store: deps.store, guard, hub });
  listRoutes(app, { db, hub, guard });

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
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/health") && !req.url.startsWith("/.well-known/")) return reply.header("Cache-Control", "no-cache").sendFile("index.html");
      return reply.code(404).send({ error: "not_found" });
    });
  }

  return app;
}

const publicMe = (a: AuthContext) => ({ id: a.profileId, familyId: a.familyId, displayName: a.displayName, login: a.login, role: a.role });
