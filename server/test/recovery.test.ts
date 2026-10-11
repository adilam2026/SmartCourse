import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { BrevoMailer, DisabledMailer, mailerFromEnv, type Mailer, type OutgoingMail, type SendResult } from "../src/mail.js";
import { RecoveryService } from "../src/recovery.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

class RecordingMailer implements Mailer {
  enabled = true;
  sent: OutgoingMail[] = [];
  next: SendResult | null = null;
  n = 0;
  async send(m: OutgoingMail): Promise<SendResult> {
    this.sent.push(m);
    return this.next ?? { accepted: true, messageId: `<msg-${++this.n}@smtp-relay.test>` };
  }
}

const BASE = "https://smartcourse.example";
let db: Db;
let app: FastifyInstance;
let mailer: RecordingMailer;
let recovery: RecoveryService;
let n = 0;

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  mailer = new RecordingMailer();
  recovery = new RecoveryService(db, mailer, BASE);
  app = await buildApp({ db, store: testStore(), recovery, brevoWebhookSecret: "hook-secret-1234567890", loginRateLimit: { max: 1000, timeWindow: "1 minute" }, recoveryRateLimit: { max: 1000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
const post = (url: string, payload: object, cookies?: Record<string, string>) => app.inject({ method: "POST", url, payload, cookies });
const tokenIn = (m: OutgoingMail, key: "verify" | "reset") => decodeURIComponent(m.text.match(new RegExp(`#/${key}/([^\\s]+)`))![1]!);
const email = () => `adil${++n}@example.org`;

async function family(recoveryEmail?: string) {
  const res = await post("/api/setup/family", {
    installToken: await generateInstallToken(db),
    familyName: `F${++n}`,
    admin: { displayName: "Adil", login: "adil", secret: "482913", secretConfirm: "482913", ...(recoveryEmail ? { recoveryEmail } : {}) },
  });
  expect(res.statusCode).toBe(201);
  await recovery.idle();
  return { admin: cookieOf(res), code: res.json().familyCode as string, id: res.json().me.id as string };
}
async function verifiedFamily() {
  const addr = email();
  const f = await family(addr);
  const m = mailer.sent.at(-1)!;
  expect((await post("/api/auth/verify-email", { token: tokenIn(m, "verify") })).statusCode).toBe(200);
  mailer.sent.length = 0;
  return { ...f, addr };
}
const login = (code: string, login: string, secret: string) => post("/api/auth/login", { familyCode: code, login, secret });

describe("adresse de récupération de l'administrateur principal", () => {
  it("enregistrée à la création puis vérifiée par un lien qui ouvre SmartCourse ; inutilisable tant qu'elle n'est pas vérifiée", async () => {
    mailer.sent.length = 0;
    const addr = email();
    const f = await family(addr);
    expect(mailer.sent).toHaveLength(1);
    const m = mailer.sent[0]!;
    expect(m.to).toBe(addr);
    expect(m.text).toContain(`${BASE}/#/verify/`); // fragment : le jeton ne passe jamais dans les journaux du serveur
    expect(m.html).toContain(`${BASE}/#/verify/`);
    let st = (await app.inject({ method: "GET", url: "/api/recovery-email", cookies: f.admin })).json();
    expect(st).toMatchObject({ canEdit: true, email: addr, verified: false, lastMail: { kind: "verify_email", status: "accepted" } });
    // non vérifiée : ni code famille ni lien de mot de passe
    await post("/api/auth/forgot-family-code", { email: addr });
    await post("/api/auth/forgot-password", { email: addr });
    await recovery.idle();
    expect(mailer.sent).toHaveLength(1);
    expect((await post("/api/auth/verify-email", { token: tokenIn(m, "verify") })).statusCode).toBe(200);
    expect((await post("/api/auth/verify-email", { token: tokenIn(m, "verify") })).statusCode).toBe(400); // usage unique
    st = (await app.inject({ method: "GET", url: "/api/recovery-email", cookies: f.admin })).json();
    expect(st.verified).toBe(true);
  });

  it("existante : renseignée depuis les réglages ; changer l'adresse annule la vérification et les anciens liens ; seul le principal peut la gérer", async () => {
    mailer.sent.length = 0;
    const f = await family();
    expect((await app.inject({ method: "GET", url: "/api/recovery-email", cookies: f.admin })).json()).toMatchObject({ email: null, verified: false, canEdit: true });
    const a1 = email();
    expect((await app.inject({ method: "PUT", url: "/api/recovery-email", cookies: f.admin, payload: { email: a1.toUpperCase() } })).statusCode).toBe(200);
    const first = mailer.sent.at(-1)!;
    expect(first.to).toBe(a1); // normalisée
    const a2 = email();
    await app.inject({ method: "PUT", url: "/api/recovery-email", cookies: f.admin, payload: { email: a2 } });
    expect((await post("/api/auth/verify-email", { token: tokenIn(first, "verify") })).statusCode).toBe(400); // lien de l'ancienne adresse
    expect((await post("/api/auth/verify-email", { token: tokenIn(mailer.sent.at(-1)!, "verify") })).statusCode).toBe(200);
    // adresse invalide, deuxième administrateur, parent, personnel
    expect((await app.inject({ method: "PUT", url: "/api/recovery-email", cookies: f.admin, payload: { email: "pas-un-email" } })).statusCode).toBe(400);
    for (const [login, role] of [["lamiaa", "admin"], ["sara", "parent"], ["marie", "staff"]] as const) {
      await post("/api/profiles", { displayName: login, login, role, secret: "573918", secretConfirm: "573918" }, f.admin);
      const c = cookieOf(await login_(f.code, login));
      const put = await app.inject({ method: "PUT", url: "/api/recovery-email", cookies: c, payload: { email: email() } });
      expect(put.statusCode).toBe(role === "admin" ? 403 : 403);
      if (role === "admin") expect((await app.inject({ method: "GET", url: "/api/recovery-email", cookies: c })).json().canEdit).toBe(false);
    }
  });

  it("l'envoi accepté par le service ≠ message reçu : « accepté » puis « remis » seulement si le service le signale ; échec visible", async () => {
    mailer.sent.length = 0;
    const f = await family(email());
    const state = async () => (await app.inject({ method: "GET", url: "/api/recovery-email", cookies: f.admin })).json().lastMail.status;
    expect(await state()).toBe("accepted");
    const id = mailer.n; // dernier identifiant de message
    expect((await post(`/api/email/brevo-webhook/mauvais-secret`, { event: "delivered", "message-id": `<msg-${id}@smtp-relay.test>` })).statusCode).toBe(404);
    expect(await state()).toBe("accepted");
    expect((await post(`/api/email/brevo-webhook/hook-secret-1234567890`, { event: "delivered", "message-id": `<msg-${id}@smtp-relay.test>` })).statusCode).toBe(200);
    expect(await state()).toBe("delivered");
    await post(`/api/email/brevo-webhook/hook-secret-1234567890`, { event: "hard_bounce", "message-id": `<msg-${id}@smtp-relay.test>` });
    expect(await state()).toBe("bounced");
    await post(`/api/email/brevo-webhook/hook-secret-1234567890`, { event: "delivered", "message-id": `<msg-${id}@smtp-relay.test>` });
    expect(await state()).toBe("bounced"); // un rejet n'est pas masqué
    mailer.next = { accepted: false, detail: "refus du service d'envoi (HTTP 401)" };
    await app.inject({ method: "POST", url: "/api/recovery-email/resend", cookies: f.admin });
    mailer.next = null;
    const st = (await app.inject({ method: "GET", url: "/api/recovery-email", cookies: f.admin })).json();
    expect(st.lastMail).toMatchObject({ status: "failed", detail: "refus du service d'envoi (HTTP 401)" });
  });
});

const login_ = (code: string, l: string) => login(code, l, "573918");

describe("code famille oublié", () => {
  it("envoie le code à l'adresse vérifiée ; réponse identique pour une adresse inconnue ou non vérifiée ; rien n'est envoyé dans ces cas", async () => {
    const f = await verifiedFamily();
    const known = await post("/api/auth/forgot-family-code", { email: f.addr });
    const unknown = await post("/api/auth/forgot-family-code", { email: email() });
    expect(known.statusCode).toBe(200);
    expect(unknown.json()).toEqual(known.json());
    await recovery.idle();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe(f.addr);
    expect(mailer.sent[0]!.text).toContain(f.code);
    expect(mailer.sent[0]!.text).not.toMatch(/482913/); // jamais le mot de passe
    const unver = await family(email());
    mailer.sent.length = 0;
    await post("/api/auth/forgot-family-code", { email: (await db.query("SELECT recovery_email FROM profiles WHERE id = $1", [unver.id])).rows[0].recovery_email });
    await recovery.idle();
    expect(mailer.sent).toHaveLength(0);
  });

  it("au plus 3 e-mails par heure vers la même adresse", async () => {
    const f = await verifiedFamily();
    for (let i = 0; i < 6; i++) await post("/api/auth/forgot-family-code", { email: f.addr });
    await recovery.idle();
    expect(mailer.sent).toHaveLength(3);
  });
});

describe("mot de passe oublié", () => {
  it("lien temporaire à usage unique ; nouveau mot de passe saisi deux fois ; ancien refusé ; sessions révoquées ; verrou levé ; jamais l'ancien mot de passe dans le message", async () => {
    const f = await verifiedFamily();
    const session = f.admin;
    for (let i = 0; i < 5; i++) await login(f.code, "adil", "000111"); // verrouillé
    const neutral = await post("/api/auth/forgot-password", { email: f.addr, familyCode: f.code });
    expect(neutral.json()).toEqual((await post("/api/auth/forgot-password", { email: email() })).json()); // même réponse si inconnue
    await recovery.idle();
    expect(mailer.sent).toHaveLength(1);
    const m = mailer.sent[0]!;
    expect(m.text).toContain(`${BASE}/#/reset/`);
    expect(m.text + m.html).not.toContain("482913");
    const token = tokenIn(m, "reset");
    expect((await post("/api/auth/reset-password/check", { token })).json()).toEqual({ valid: true });
    // validations
    expect((await post("/api/auth/reset-password", { token, secret: "Ab3$xy", secretConfirm: "Ab3$xz" })).json().error).toBe("secret_mismatch");
    expect((await post("/api/auth/reset-password", { token, secret: "123456", secretConfirm: "123456" })).json().error).toBe("weak_secret");
    expect((await post("/api/auth/reset-password", { token, secret: "court", secretConfirm: "court" })).statusCode).toBe(400);
    expect((await post("/api/auth/reset-password/check", { token })).json()).toEqual({ valid: true }); // les échecs n'ont pas consommé le lien
    const ok = await post("/api/auth/reset-password", { token, secret: "Ab3$xy", secretConfirm: "Ab3$xy" });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: session })).statusCode).toBe(401);
    expect((await login(f.code, "adil", "482913")).statusCode).toBe(401);
    expect((await login(f.code, "adil", "Ab3$xy")).statusCode).toBe(200);
    const again = await post("/api/auth/reset-password", { token, secret: "Zz9#qq", secretConfirm: "Zz9#qq" });
    expect([again.statusCode, again.json().error]).toEqual([400, "invalid_link"]);
    expect((await post("/api/auth/reset-password/check", { token })).json()).toEqual({ valid: false });
  });

  it("lien expiré ou remplacé par une nouvelle demande : refusé ; adresse changée entre-temps : refusé", async () => {
    const f = await verifiedFamily();
    await post("/api/auth/forgot-password", { email: f.addr });
    await recovery.idle();
    const t1 = tokenIn(mailer.sent.at(-1)!, "reset");
    await post("/api/auth/forgot-password", { email: f.addr });
    await recovery.idle();
    const t2 = tokenIn(mailer.sent.at(-1)!, "reset");
    expect((await post("/api/auth/reset-password", { token: t1, secret: "Ab3$xy", secretConfirm: "Ab3$xy" })).statusCode).toBe(400); // remplacé
    await db.query("UPDATE auth_tokens SET expires_at = now() - interval '1 minute' WHERE profile_id = $1 AND purpose = 'reset_password'", [f.id]);
    expect((await post("/api/auth/reset-password", { token: t2, secret: "Ab3$xy", secretConfirm: "Ab3$xy" })).statusCode).toBe(400); // expiré
    expect((await login(f.code, "adil", "482913")).statusCode).toBe(200); // rien n'a changé
    const f2 = await verifiedFamily();
    await post("/api/auth/forgot-password", { email: f2.addr });
    await recovery.idle();
    const t3 = tokenIn(mailer.sent.at(-1)!, "reset");
    await app.inject({ method: "PUT", url: "/api/recovery-email", cookies: f2.admin, payload: { email: email() } });
    expect((await post("/api/auth/reset-password", { token: t3, secret: "Ab3$xy", secretConfirm: "Ab3$xy" })).statusCode).toBe(400);
  });

  it("seuls les profils à adresse vérifiée (administrateur principal) reçoivent un lien ; les autres profils n'en reçoivent jamais", async () => {
    const f = await verifiedFamily();
    await post("/api/profiles", { displayName: "Sara", login: "sara", role: "parent", secret: "573918", secretConfirm: "573918" }, f.admin);
    await db.query("UPDATE profiles SET recovery_email = $2, recovery_email_verified_at = now() WHERE login = 'sara' AND family_id = (SELECT family_id FROM profiles WHERE id = $1)", [f.id, email()]);
    await post("/api/auth/forgot-password", { email: (await db.query("SELECT recovery_email FROM profiles WHERE login = 'sara' AND family_id = (SELECT family_id FROM profiles WHERE id = $1)", [f.id])).rows[0].recovery_email });
    await recovery.idle();
    expect(mailer.sent).toHaveLength(0);
  });

  it("les routes de récupération n'ont besoin d'aucune session mais sont limitées par IP", async () => {
    const limited = await buildApp({ db, store: testStore(), recovery, recoveryRateLimit: { max: 3, timeWindow: "1 hour" } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await limited.inject({ method: "POST", url: "/api/auth/forgot-password", payload: { email: "x@example.org" } })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    await limited.close();
  });
});

describe("module d'envoi Brevo", () => {
  it("appelle l'API Brevo avec la clé en en-tête, jamais dans le corps ; accepté ≠ reçu", async () => {
    const calls: { url: string; init: any }[] = [];
    const mailerB = new BrevoMailer({
      apiKey: "cle-de-test", senderEmail: "noreply@smartcourse.example", senderName: "SmartCourse",
      fetchImpl: (async (url: any, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify({ messageId: "<abc@smtp-relay.mailin.fr>" }), { status: 201 }); }) as any,
    });
    const r = await mailerB.send({ to: "a@example.org", subject: "S", text: "t", html: "<p>t</p>" });
    expect(r).toEqual({ accepted: true, messageId: "<abc@smtp-relay.mailin.fr>" });
    expect(calls[0]!.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(calls[0]!.init.headers["api-key"]).toBe("cle-de-test");
    expect(calls[0]!.init.body).not.toContain("cle-de-test");
    expect(JSON.parse(calls[0]!.init.body)).toMatchObject({ sender: { name: "SmartCourse", email: "noreply@smartcourse.example" }, to: [{ email: "a@example.org" }] });
  });

  it("refus ou panne du service : non accepté, sans fuite de secret", async () => {
    const mk = (f: any) => new BrevoMailer({ apiKey: "cle-secrete", senderEmail: "n@x.org", senderName: "S", fetchImpl: f });
    const refused = await mk(async () => new Response(JSON.stringify({ code: "unauthorized", message: "Key not found cle-secrete" }), { status: 401 })).send({ to: "a@b.c", subject: "s", text: "t", html: "t" });
    expect(refused.accepted).toBe(false);
    expect(refused.detail).toContain("401");
    expect(JSON.stringify(refused)).not.toContain("cle-secrete");
    const down = await mk(async () => { throw new TypeError("fetch failed"); }).send({ to: "a@b.c", subject: "s", text: "t", html: "t" });
    expect(down).toMatchObject({ accepted: false });
  });

  it("acceptation démontrée seulement par un 2xx AVEC messageId ; délai dépassé = issue inconnue ; HTTPS imposé", async () => {
    const mk = (f: any, over: object = {}) => new BrevoMailer({ apiKey: "cle-secrete", senderEmail: "n@x.org", senderName: "S", fetchImpl: f, ...over });
    const mail = { to: "a@b.c", subject: "s", text: "t", html: "t" };
    const noId = await mk(async () => new Response("{}", { status: 201 })).send(mail);
    expect(noId.accepted).toBe(false);
    expect(noId.detail).toContain("non démontrée");
    const slow = await mk((_u: any, init: any) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" })))), { timeoutMs: 20 }).send(mail);
    expect(slow).toMatchObject({ accepted: false, unknown: true });
    const http = await mk(async () => new Response("{}", { status: 201 }), { endpoint: "http://api.example.com/v3" }).send(mail);
    expect(http.accepted).toBe(false);
    expect(http.detail).toContain("HTTPS");
  });

  it("lien invalidé si l'envoi échoue de façon certaine ; conservé si l'issue est inconnue (délai dépassé)", async () => {
    const f = await verifiedFamily();
    mailer.next = { accepted: false, detail: "refus du service d'envoi (HTTP 401)" };
    await post("/api/auth/forgot-password", { email: f.addr });
    await recovery.idle();
    expect((await db.query("SELECT count(*)::int AS n FROM auth_tokens WHERE profile_id = $1 AND purpose = 'reset_password' AND used_at IS NULL", [f.id])).rows[0].n).toBe(0);
    mailer.next = { accepted: false, unknown: true, detail: "délai dépassé" };
    await post("/api/auth/forgot-password", { email: f.addr });
    await recovery.idle();
    mailer.next = null;
    expect((await db.query("SELECT count(*)::int AS n FROM auth_tokens WHERE profile_id = $1 AND purpose = 'reset_password' AND used_at IS NULL", [f.id])).rows[0].n).toBe(1);
    expect((await db.query("SELECT status FROM email_log WHERE profile_id = $1 AND kind = 'reset_password' ORDER BY created_at DESC LIMIT 1", [f.id])).rows[0].status).toBe("unknown");
  });

  it("sans paramètres Brevo l'application fonctionne : envoi désactivé, état « non configuré »", async () => {
    expect(mailerFromEnv({} as any).enabled).toBe(false);
    expect(mailerFromEnv({ BREVO_API_KEY: "k", BREVO_FROM_EMAIL: "n@x.org" } as any).enabled).toBe(true);
    expect(mailerFromEnv({ BREVO_API_KEY: "k", BREVO_FROM_EMAIL: "pas-une-adresse" } as any).enabled).toBe(false); // expéditeur invalide : désactivé
    const off = new RecoveryService(db, new DisabledMailer(), BASE);
    const a = await buildApp({ db, store: testStore(), recovery: off, loginRateLimit: { max: 1000, timeWindow: "1 minute" } });
    expect((await a.inject({ method: "GET", url: "/health" })).json().mail).toBe("off");
    const res = await a.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: "Off", admin: { displayName: "A", login: "adil", secret: "482913", recoveryEmail: email() } } });
    expect(res.statusCode).toBe(201); // la création de la famille ne dépend pas de l'envoi
    const st = (await a.inject({ method: "GET", url: "/api/recovery-email", cookies: cookieOf(res) })).json();
    expect(st).toMatchObject({ configured: false, verified: false, lastMail: { status: "not_configured" } });
    await a.close();
  });
});
