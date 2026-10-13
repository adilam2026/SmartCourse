import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { DisabledMailer, type Mailer, type OutgoingMail, type SendResult } from "../src/mail.js";
import { RecoveryService } from "../src/recovery.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

class RecordingMailer implements Mailer {
  enabled = true;
  sent: OutgoingMail[] = [];
  next: SendResult | null = null;
  async send(m: OutgoingMail): Promise<SendResult> {
    this.sent.push(m);
    return this.next ?? { accepted: true, messageId: `<m${this.sent.length}@test>` };
  }
}

let db: Db;
let app: FastifyInstance;
let mailer: RecordingMailer;
let recovery: RecoveryService;
let n = 0;
const OPEN = { perIpPerHour: 1000, globalPerHour: 1000, familiesPerDay: 1000 };

async function mk(limits: object = OPEN, rec = recovery) {
  const a = await buildApp({ db, store: testStore(), recovery: rec, loginRateLimit: { max: 1000, timeWindow: "1 minute" }, signupRateLimit: { max: 1000, timeWindow: "1 minute" }, signupVerifyRateLimit: { max: 1000, timeWindow: "1 minute" }, signupLimits: limits });
  await a.ready();
  return a;
}
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  mailer = new RecordingMailer();
  recovery = new RecoveryService(db, mailer, "https://x.example", { resendCooldownSec: 0 });
  app = await mk();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const email = () => `famille${++n}@example.org`;
const body = (over: object = {}) => ({ requestId: randomUUID(), familyName: "Famille Test", displayName: "Adil", login: "adil", city: "Casablanca", email: email(), secret: "482913", secretConfirm: "482913", ...over });
const start = (b: object, a = app) => a.inject({ method: "POST", url: "/api/signup/start", payload: b });
const verify = (signupId: string, code: string, a = app) => a.inject({ method: "POST", url: "/api/signup/verify", payload: { signupId, code } });
const codeTo = (to: string) => mailer.sent.filter((m) => m.to === to).at(-1)!.text.match(/(\d{6})/)![1]!;
const count = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0].n);
const families = () => count("SELECT count(*) AS n FROM families");

describe("création de famille autonome (sans jeton d'installation)", () => {
  it("parcours complet : rien n'est créé avant la vérification ; puis famille, administrateur principal, adresse vérifiée, session", async () => {
    const before = await families();
    const b = body();
    const s = await start(b);
    expect(s.statusCode).toBe(201);
    expect(s.json().email).not.toContain(b.email); // adresse masquée
    expect(await families()).toBe(before);
    const code = codeTo(b.email);
    expect((await verify(s.json().signupId, code === "000000" ? "111111" : "000000")).statusCode).toBe(400);
    const v = await verify(s.json().signupId, code);
    expect(v.statusCode).toBe(201);
    const { familyCode, me } = v.json();
    expect(familyCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(me.role).toBe("admin");
    expect(await families()).toBe(before + 1);
    const cookie = v.cookies.find((c) => c.name === "sc_session")!.value;
    const meRes = await app.inject({ method: "GET", url: "/api/me", cookies: { sc_session: cookie } });
    expect(meRes.statusCode).toBe(200);
    const p = (await db.query("SELECT p.is_primary, p.recovery_email, p.recovery_email_verified_at, p.city, f.setup_completed_at, f.name FROM profiles p JOIN families f ON f.id = p.family_id WHERE f.code = $1", [familyCode])).rows[0];
    expect(p.is_primary).toBe(true);
    expect(p.recovery_email).toBe(b.email);
    expect(p.recovery_email_verified_at).not.toBeNull();
    expect(p.setup_completed_at).not.toBeNull();
    expect(p.city).toBe("Casablanca");
    expect(await count("SELECT count(*) AS n FROM products pr JOIN families f ON f.id = pr.family_id WHERE f.code = $1", [familyCode])).toBe(80);
    // Connexion ordinaire ensuite avec le code famille généré
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login: "adil", secret: "482913" } });
    expect(login.statusCode).toBe(200);
  });

  it("double appui sur « Recevoir le code » : même demande, un seul e-mail ; appuis simultanés compris", async () => {
    const b = body();
    const [a1, a2] = await Promise.all([start(b), start(b)]);
    const a3 = await start(b);
    expect([a1.statusCode, a2.statusCode, a3.statusCode]).toEqual([201, 201, 201]);
    expect(new Set([a1.json().signupId, a2.json().signupId, a3.json().signupId]).size).toBe(1);
    expect(mailer.sent.filter((m) => m.to === b.email)).toHaveLength(1);
    expect(await count("SELECT count(*) AS n FROM family_signups WHERE request_id = $1", [b.requestId])).toBe(1);
  });

  it("double appui sur « Valider » (simultané) : une seule famille, même code famille", async () => {
    const before = await families();
    const b = body();
    const id = (await start(b)).json().signupId;
    const code = codeTo(b.email);
    const [v1, v2] = await Promise.all([verify(id, code), verify(id, code)]);
    expect([v1.statusCode, v2.statusCode]).toEqual([201, 201]);
    expect(v1.json().familyCode).toBe(v2.json().familyCode);
    expect(await families()).toBe(before + 1);
  });

  it("doublon : une adresse qui gère déjà une famille est refusée", async () => {
    const b = body();
    const id = (await start(b)).json().signupId;
    expect((await verify(id, codeTo(b.email))).statusCode).toBe(201);
    const again = await start(body({ email: b.email }));
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("email_in_use");
  });

  it("une nouvelle demande pour la même adresse remplace la précédente (l'ancien code ne fonctionne plus)", async () => {
    const e = email();
    const first = (await start(body({ email: e }))).json().signupId;
    const oldCode = codeTo(e);
    const second = (await start(body({ email: e }))).json().signupId;
    expect(second).not.toBe(first);
    expect((await verify(first, oldCode)).statusCode).toBe(410);
    expect((await verify(second, codeTo(e))).statusCode).toBe(201);
  });

  it("essais limités : après 5 codes faux, même le bon code est refusé", async () => {
    const b = body();
    const id = (await start(b)).json().signupId;
    const good = codeTo(b.email);
    const bad = good === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) expect((await verify(id, bad)).statusCode).toBe(400);
    const r = await verify(id, good);
    expect(r.statusCode).toBe(429);
    expect(r.json().error).toBe("too_many_attempts");
  });

  it("code expiré refusé ; renvoi : délai respecté, nouveau code, l'ancien ne fonctionne plus", async () => {
    const b = body();
    const id = (await start(b)).json().signupId;
    const first = codeTo(b.email);
    const soon = await app.inject({ method: "POST", url: "/api/signup/resend", payload: { signupId: id } });
    expect(soon.statusCode).toBe(429);
    await db.query("UPDATE family_signups SET last_sent_at = now() - interval '2 minutes' WHERE id = $1", [id]);
    expect((await app.inject({ method: "POST", url: "/api/signup/resend", payload: { signupId: id } })).statusCode).toBe(200);
    const second = codeTo(b.email);
    if (second !== first) expect((await verify(id, first)).statusCode).toBe(400);
    await db.query("UPDATE family_signups SET expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
    const r = await verify(id, second);
    expect(r.statusCode).toBe(410);
    expect(r.json().error).toBe("code_expired");
  });

  it("champs vérifiés avant tout envoi : code faible, codes différents, ville hors liste, e-mail invalide", async () => {
    const sent = mailer.sent.length;
    expect((await start(body({ secret: "123456", secretConfirm: "123456" }))).json().error).toBe("weak_secret");
    expect((await start(body({ secretConfirm: "482914" }))).json().error).toBe("secret_mismatch");
    expect((await start(body({ city: "Atlantide" }))).json().error).toBe("invalid_city");
    expect((await start(body({ email: "pas-une-adresse" }))).statusCode).toBe(400);
    expect(mailer.sent.length).toBe(sent);
  });

  it("limites : par adresse e-mail (3 par jour), par connexion, globales", async () => {
    const e = email();
    for (let i = 0; i < 3; i++) expect((await start(body({ email: e }))).statusCode).toBe(201);
    expect((await start(body({ email: e }))).json().error).toBe("too_many_signups");
    const perIp = await mk({ ...OPEN, perIpPerHour: 0 });
    expect((await start(body(), perIp)).json().error).toBe("too_many_signups");
    await perIp.close();
    const paused = await mk({ ...OPEN, globalPerHour: 0 });
    expect((await start(body(), paused)).json().error).toBe("signups_paused");
    await paused.close();
    const fam = await mk({ ...OPEN, familiesPerDay: 0 });
    expect((await start(body(), fam)).json().error).toBe("signups_paused");
    await fam.close();
  });

  it("e-mail refusé par le service d'envoi : rien n'est gardé, la même demande peut être relancée", async () => {
    const b = body();
    mailer.next = { accepted: false, detail: "HTTP 400 refus" };
    const r = await start(b);
    mailer.next = null;
    expect(r.statusCode).toBe(502);
    expect(await count("SELECT count(*) AS n FROM family_signups WHERE request_id = $1", [b.requestId])).toBe(0);
    expect((await start(b)).statusCode).toBe(201);
  });

  it("envoi d'e-mails non configuré : création refusée proprement", async () => {
    const off = await mk(OPEN, new RecoveryService(db, new DisabledMailer(), "https://x.example"));
    expect((await start(body(), off)).json().error).toBe("mail_unavailable");
    await off.close();
  });

  it("fermeture d'urgence par variable d'environnement (SIGNUP_DISABLED=1)", async () => {
    process.env.SIGNUP_DISABLED = "1";
    try {
      expect((await start(body())).json().error).toBe("signups_closed");
    } finally {
      delete process.env.SIGNUP_DISABLED;
    }
  });

  it("l'ancienne installation reste protégée par son jeton ; les familles existantes ne sont pas modifiées", async () => {
    const tok = await generateInstallToken(db);
    const legacy = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: tok, familyName: "Ancienne", admin: { displayName: "A", login: "admin", secret: "482913", secretConfirm: "482913", recoveryEmail: email(), city: "Rabat" } } });
    expect(legacy.statusCode).toBe(201);
    const snapshot = await db.query("SELECT id, code, name, setup_completed_at FROM families WHERE code = $1", [legacy.json().familyCode]);
    const refused = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: "x".repeat(32), familyName: "Pirate", admin: { displayName: "P", login: "p1", secret: "482913", secretConfirm: "482913", recoveryEmail: email(), city: "Rabat" } } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("invalid_install_token");
    const b = body();
    const id = (await start(b)).json().signupId;
    expect((await verify(id, codeTo(b.email))).statusCode).toBe(201);
    expect((await db.query("SELECT id, code, name, setup_completed_at FROM families WHERE code = $1", [legacy.json().familyCode])).rows).toEqual(snapshot.rows);
  });
});
