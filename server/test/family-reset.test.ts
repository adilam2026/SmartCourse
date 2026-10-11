import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
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
  n = 0;
  async send(m: OutgoingMail): Promise<SendResult> {
    this.sent.push(m);
    return this.next ?? { accepted: true, messageId: `<m-${++this.n}@relay.test>` };
  }
}
const BASE = "https://smartcourse.example";
let db: Db;
let mailer: RecordingMailer;
let recovery: RecoveryService;
let app: FastifyInstance; // règles d'installation actuelles (e-mail obligatoire)
const store = testStore();
let n = 0;
const rate = { max: 1000, timeWindow: "1 minute" };

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  mailer = new RecordingMailer();
  recovery = new RecoveryService(db, mailer, BASE, { resendCooldownSec: 0 });
  app = await buildApp({ db, store, recovery, requireRecoveryEmail: true, loginRateLimit: rate, recoveryRateLimit: rate });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
const tokenIn = (m: OutgoingMail) => decodeURIComponent(m.text.match(/#\/verify\/([^\s]+)/)![1]!);
const email = () => `adil${++n}@example.org`;
const setupBody = async (over: object = {}, token?: string) => ({
  installToken: token ?? (await generateInstallToken(db)),
  familyName: `F${++n}`,
  admin: { displayName: "Adil", login: "adil", secret: "482913", secretConfirm: "482913", recoveryEmail: email(), ...over },
});

describe("première installation : adresse de récupération obligatoire et vérifiée", () => {
  it("refuse l'installation sans adresse, sans consommer le jeton ; refuse aussi si l'envoi d'e-mails n'est pas configuré", async () => {
    const token = await generateInstallToken(db);
    const noMail = await app.inject({ method: "POST", url: "/api/setup/family", payload: await setupBody({ recoveryEmail: undefined }, token) });
    expect([noMail.statusCode, noMail.json().error]).toEqual([400, "email_required"]);
    const bad = await app.inject({ method: "POST", url: "/api/setup/family", payload: await setupBody({ recoveryEmail: "pas-une-adresse" }, token) });
    expect(bad.statusCode).toBe(400);
    const off = await buildApp({ db, store, recovery: new RecoveryService(db, new DisabledMailer(), BASE, { resendCooldownSec: 0 }), requireRecoveryEmail: true, loginRateLimit: rate });
    const refused = await off.inject({ method: "POST", url: "/api/setup/family", payload: await setupBody({}, token) });
    expect([refused.statusCode, refused.json().error]).toEqual([503, "mail_not_configured"]);
    await off.close();
    expect((await db.query("SELECT consumed_at FROM install_tokens WHERE token_hash = encode(sha256($1::bytea), 'hex')", [token])).rows[0].consumed_at).toBeNull();
    // le jeton est toujours utilisable
    expect((await app.inject({ method: "POST", url: "/api/setup/family", payload: await setupBody({}, token) })).statusCode).toBe(201);
  });

  it("la famille reste « en attente » : tout est refusé jusqu'à la vérification ; le lien termine l'installation", async () => {
    mailer.sent.length = 0;
    const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: await setupBody() });
    expect(res.statusCode).toBe(201);
    expect(res.json().me.setupPending).toBe(true);
    expect(res.json().recovery).toMatchObject({ verified: false, setupPending: true, lastMail: { status: "accepted" } });
    const admin = cookieOf(res);
    expect(mailer.sent).toHaveLength(1);
    for (const [method, url] of [["GET", "/api/catalog"], ["GET", "/api/lists/active"], ["GET", "/api/profiles"], ["POST", "/api/lists"], ["GET", "/api/catalog/all"], ["GET", "/api/events"]] as const) {
      const r = await app.inject({ method, url, cookies: admin });
      expect([url, r.statusCode, r.json().error]).toEqual([url, 403, "setup_incomplete"]);
    }
    expect((await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: "x", login: "xx", role: "staff", secret: "573918", secretConfirm: "573918" } })).statusCode).toBe(403);
    // ce qui reste possible : savoir où on en est, changer d'adresse, renvoyer, se déconnecter
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: admin })).json().me.setupPending).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/recovery-email", cookies: admin })).statusCode).toBe(200);
    // se reconnecter plus tard : même situation
    const code = res.json().familyCode;
    const again = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: code, login: "adil", secret: "482913" } }));
    expect((await app.inject({ method: "GET", url: "/api/catalog", cookies: again })).statusCode).toBe(403);
    // vérification : l'installation se termine
    expect((await app.inject({ method: "POST", url: "/api/auth/verify-email", payload: { token: tokenIn(mailer.sent[0]!) } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: admin })).json().me).toMatchObject({ setupPending: false, family: { code } });
    expect((await app.inject({ method: "GET", url: "/api/catalog", cookies: admin })).statusCode).toBe(200);
    expect((await db.query("SELECT setup_completed_at FROM families WHERE code = $1", [code])).rows[0].setup_completed_at).not.toBeNull();
  });

  it("échec d'envoi : on peut réessayer (et changer d'adresse) sans recréer la famille ; les échecs ne comptent pas dans la limite horaire", async () => {
    mailer.sent.length = 0;
    mailer.next = { accepted: false, detail: "refus du service d'envoi (HTTP 401)" };
    const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: await setupBody() });
    expect(res.statusCode).toBe(201); // pas d'erreur : la famille existe, en attente
    expect(res.json().recovery.lastMail).toMatchObject({ status: "failed" });
    const admin = cookieOf(res);
    const code = res.json().familyCode;
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: "POST", url: "/api/recovery-email/resend", cookies: admin })).json().lastMail.status).toBe("failed");
    mailer.next = null;
    const ok = await app.inject({ method: "POST", url: "/api/recovery-email/resend", cookies: admin });
    expect(ok.json().lastMail.status).toBe("accepted");
    expect((await db.query("SELECT count(*)::int AS n FROM families WHERE code = $1", [code])).rows[0].n).toBe(1);
    // adresse mal saisie : on la change, un nouveau lien part, l'ancien ne marche plus
    const old = tokenIn(mailer.sent.at(-1)!);
    const fixed = email();
    expect((await app.inject({ method: "PUT", url: "/api/recovery-email", cookies: admin, payload: { email: fixed } })).statusCode).toBe(200);
    expect(mailer.sent.at(-1)!.to).toBe(fixed);
    expect((await app.inject({ method: "POST", url: "/api/auth/verify-email", payload: { token: old } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/auth/verify-email", payload: { token: tokenIn(mailer.sent.at(-1)!) } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/catalog", cookies: admin })).statusCode).toBe(200);
  });

  it("les familles déjà installées ne sont pas concernées par la règle", async () => {
    const legacy = await buildApp({ db, store, recovery, requireRecoveryEmail: false, loginRateLimit: rate });
    const r = await legacy.inject({ method: "POST", url: "/api/setup/family", payload: await setupBody({ recoveryEmail: undefined }) });
    expect(r.statusCode).toBe(201);
    expect(r.json().me.setupPending).toBe(false);
    expect((await legacy.inject({ method: "GET", url: "/api/catalog", cookies: cookieOf(r) })).statusCode).toBe(200);
    await legacy.close();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

const TABLES = ["profiles", "products", "lists", "list_items", "purchases", "validations", "list_events", "push_subscriptions", "push_events", "op_log", "sessions", "auth_tokens", "email_log", "photo_assets"];
async function counts(familyId: string | null) {
  const out: Record<string, number> = {};
  const q = async (t: string, where: string) => (out[t] = Number((await db.query(`SELECT count(*) AS n FROM ${t} WHERE ${where}`, familyId ? [familyId] : [])).rows[0].n));
  if (familyId) {
    for (const t of ["profiles", "products", "lists", "list_items", "purchases", "validations", "list_events", "push_subscriptions", "push_events"]) await q(t, "family_id = $1");
    await q("photo_assets", "owner_family_id = $1");
    for (const t of ["sessions", "auth_tokens", "email_log", "op_log"]) await q(t, "profile_id IN (SELECT id FROM profiles WHERE family_id = $1)");
  }
  return out;
}

async function installedFamily(label: string) {
  mailer.sent.length = 0;
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: await setupBody({}) });
  const code = res.json().familyCode as string;
  const admin = cookieOf(res);
  await app.inject({ method: "POST", url: "/api/auth/verify-email", payload: { token: tokenIn(mailer.sent.at(-1)!) } });
  const mk = async (role: string, login: string) => {
    await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: login, login, role, secret: "573918", secretConfirm: "573918" } });
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: code, login, secret: "573918" } }));
  };
  const parent = await mk("parent", "lamiaa");
  const staff = await mk("staff", "marie");
  const familyId = (await db.query("SELECT id FROM families WHERE code = $1", [code])).rows[0].id as string;
  const cat = (await app.inject({ method: "GET", url: "/api/catalog", cookies: admin })).json().categories.flatMap((c: any) => c.products);
  const pid = (name: string) => cat.find((p: any) => p.name === name).id as string;
  // photo propre à la famille + produit propre
  const png = (await sharp({ create: { width: 40, height: 40, channels: 3, background: label === "A" ? "#aa3333" : "#3366aa" } }).png().toBuffer()).toString("base64");
  const own = (await app.inject({ method: "POST", url: "/api/products", cookies: admin, payload: { name: `Maison ${label}`, category: "maison", image: png } })).json().product;
  // listes : une clôturée (archive) avec achats, une en cours
  const list = async (items: string[], close: boolean) => {
    const l = (await app.inject({ method: "POST", url: "/api/lists", cookies: parent })).json().list.id as string;
    const ops = items.map((p) => ({ opId: randomUUID(), type: "add", productId: pid(p) }));
    await app.inject({ method: "POST", url: `/api/lists/${l}/ops`, cookies: parent, payload: { ops, batch: { id: randomUUID(), clientAt: new Date().toISOString() } } });
    const view = (await app.inject({ method: "GET", url: `/api/lists/${l}`, cookies: parent })).json().list;
    for (const it of view.items.slice(0, 2)) await app.inject({ method: "POST", url: `/api/lists/${l}/ops`, cookies: parent, payload: { ops: [{ opId: randomUUID(), type: "purchase", itemId: it.id }] } });
    if (close) expect((await app.inject({ method: "POST", url: `/api/lists/${l}/close`, cookies: parent })).statusCode).toBe(200);
    return l;
  };
  await list(["Tomates", "Lait", "Sucre"], true);
  await list(["Pain", "Œufs"], false);
  await db.query("INSERT INTO push_subscriptions (family_id, profile_id, endpoint, p256dh, auth) SELECT $1, id, 'https://push.example/' || $2 || gen_random_uuid(), 'k', 'a' FROM profiles WHERE family_id = $1 AND login = 'lamiaa'", [familyId, label]);
  return { code, admin, parent, staff, familyId, ownPhoto: own.photoUrl as string, ownId: own.id as string };
}

const reset = (cookies: Record<string, string>, body: object) => app.inject({ method: "POST", url: "/api/family/reset", cookies, payload: body });

describe("réinitialisation définitive d'une famille", () => {
  it("supprime tout ce qui appartient à CETTE famille (archives comprises) et rien d'autre ; accès révoqués ; nouveau jeton à usage unique", async () => {
    const A = await installedFamily("A");
    const B = await installedFamily("B");
    const before = { A: await counts(A.familyId), B: await counts(B.familyId) };
    expect(before.A.list_items).toBeGreaterThan(0);
    expect(before.A.purchases).toBeGreaterThan(0);
    expect(before.A.validations).toBeGreaterThan(0);
    expect(before.A.list_events).toBeGreaterThan(0);
    expect(before.A.photo_assets).toBe(1);
    expect(before.A.push_subscriptions).toBe(1);
    const shared = async () => ({
      initial: (await db.query("SELECT count(*)::int AS n, count(photo_asset_id)::int AS p FROM initial_catalog")).rows[0],
      extended: (await db.query("SELECT count(*)::int AS n, count(photo_asset_id)::int AS p FROM extended_catalog")).rows[0],
      shared: (await db.query("SELECT count(*)::int AS n FROM photo_assets WHERE owner_family_id IS NULL")).rows[0].n,
      migrations: (await db.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n,
      families: (await db.query("SELECT count(*)::int AS n FROM families")).rows[0].n,
    });
    const sharedBefore = await shared();
    const ownKey = (await db.query("SELECT storage_key FROM photo_assets WHERE owner_family_id = $1", [A.familyId])).rows[0].storage_key as string;
    expect(await store.get(ownKey)).toBeTruthy();

    // prévisualisation : identification précise
    const prev = await app.inject({ method: "GET", url: "/api/family/reset-preview", cookies: A.admin });
    expect(prev.json()).toMatchObject({ family: { code: A.code }, ready: { mailConfigured: true, recoveryEmailVerified: true } });
    expect(prev.json().counts.listItems).toBe(before.A.list_items);

    // refus : mauvais code, mauvais mot de passe, parent, personnel, administrateur non principal
    expect((await reset(A.admin, { password: "482913", confirmCode: B.code })).statusCode).toBe(400);
    const wrongPw = await reset(A.admin, { password: "000111", confirmCode: A.code });
    expect([wrongPw.statusCode, wrongPw.json().error]).toEqual([403, "wrong_password"]);
    expect((await reset(A.parent, { password: "573918", confirmCode: A.code })).statusCode).toBe(403);
    expect((await reset(A.staff, { password: "573918", confirmCode: A.code })).statusCode).toBe(403);
    expect(await counts(A.familyId)).toEqual(before.A);

    // suppression
    const r = await reset(A.admin, { password: "482913", confirmCode: A.code.toLowerCase() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, family: { code: A.code }, otherFamiliesUntouched: expect.any(Number) });
    const newToken = r.json().installToken as string;
    expect(newToken.length).toBeGreaterThan(20);

    // plus rien de A
    expect((await db.query("SELECT count(*)::int AS n FROM families WHERE id = $1", [A.familyId])).rows[0].n).toBe(0);
    for (const t of Object.keys(before.A)) expect((await db.query(`SELECT 1 FROM ${t} WHERE ${["photo_assets"].includes(t) ? "owner_family_id" : ["sessions", "auth_tokens", "email_log", "op_log"].includes(t) ? "false AND family_id" : "family_id"} = $1`.replace("false AND family_id", "false AND profile_id::text"), [A.familyId])).rowCount ?? 0).toBe(0);
    expect(await store.get(ownKey)).toBeNull(); // fichier de la photo propre retiré du stockage
    expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE family_id = $1", [A.familyId])).rows[0].n).toBe(0);
    expect((await db.query("SELECT details FROM audit_log WHERE action = 'family.purged' ORDER BY id DESC LIMIT 1")).rows[0].details.deleted.profiles).toBe(3);
    // accès révoqués
    for (const c of [A.admin, A.parent, A.staff]) expect((await app.inject({ method: "GET", url: "/api/me", cookies: c })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: A.code, login: "adil", secret: "482913" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/forgot-password", payload: { email: "x@example.org", familyCode: A.code } })).statusCode).toBe(200);

    // B et le catalogue partagé : identiques
    expect(await counts(B.familyId)).toEqual(before.B);
    expect(await shared()).toEqual({ ...sharedBefore, families: sharedBefore.families - 1 });
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: B.admin })).statusCode).toBe(200);
    const bPhoto = await app.inject({ method: "GET", url: B.ownPhoto, cookies: B.admin });
    expect(bPhoto.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/lists/active", cookies: B.parent })).json().list.items.length).toBe(2);

    // jeton neuf : usage unique ; l'ancien jeton consommé ne permet pas de recommencer
    const oldToken = (await db.query("SELECT 1 FROM install_tokens WHERE family_id IS NULL AND consumed_at IS NOT NULL LIMIT 1")).rowCount;
    expect(oldToken).toBe(1);
    const first = await app.inject({ method: "POST", url: "/api/setup/family", payload: await setupBody({}, newToken) });
    expect(first.statusCode).toBe(201);
    expect(first.json().familyCode).not.toBe(A.code);
    const second = await app.inject({ method: "POST", url: "/api/setup/family", payload: await setupBody({}, newToken) });
    expect(second.statusCode).toBe(403);
  });

  it("n'est possible que si l'envoi d'e-mails est configuré et l'adresse du principal vérifiée (preuve que Brevo fonctionne réellement)", async () => {
    mailer.sent.length = 0;
    const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: await setupBody() });
    const admin = cookieOf(res);
    const code = res.json().familyCode;
    // installation inachevée : tout est refusé
    expect((await reset(admin, { password: "482913", confirmCode: code })).statusCode).toBe(403);
    await app.inject({ method: "POST", url: "/api/auth/verify-email", payload: { token: tokenIn(mailer.sent.at(-1)!) } });
    // adresse changée → non vérifiée de nouveau (famille déjà installée)
    await app.inject({ method: "PUT", url: "/api/recovery-email", cookies: admin, payload: { email: email() } });
    const notReady = await reset(admin, { password: "482913", confirmCode: code });
    expect([notReady.statusCode, notReady.json().error]).toEqual([409, "reset_not_ready"]);
    expect((await db.query("SELECT count(*)::int AS n FROM families WHERE code = $1", [code])).rows[0].n).toBe(1);
    // e-mail de test : réponse réelle du service, accepté ≠ reçu
    await app.inject({ method: "POST", url: "/api/auth/verify-email", payload: { token: tokenIn(mailer.sent.at(-1)!) } });
    const t = await app.inject({ method: "POST", url: "/api/recovery-email/test", cookies: admin });
    expect(t.json().lastMail).toMatchObject({ kind: "test", status: "accepted" });
    expect(mailer.sent.at(-1)!.subject).toContain("test");
  });

  it("le principal est le seul à pouvoir réinitialiser (un second administrateur est refusé)", async () => {
    const F = await installedFamily("C");
    await app.inject({ method: "POST", url: "/api/profiles", cookies: F.admin, payload: { displayName: "Co", login: "co", role: "admin", secret: "573918", secretConfirm: "573918" } });
    const co = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: F.code, login: "co", secret: "573918" } }));
    expect((await reset(co, { password: "573918", confirmCode: F.code })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/family/reset-preview", cookies: co })).statusCode).toBe(403);
  });
});
