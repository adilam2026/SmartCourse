import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { SseHub } from "../src/hub.js";
import { quotaActivate, quotaDeactivate } from "../src/list-quota.js";
import { AppleStore, verifyAppleJws } from "../src/store/apple.js";
import { GooglePlay } from "../src/store/google.js";
import { StoreService } from "../src/store/service.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";
import { FakeGoogle, rtdn, signJws, testAppleChain, testServiceAccount, type TestChain } from "./store-fakes.js";

const PKG = "app.smartcourse.courses.natif";
const BUNDLE = "app.smartcourse.courses";
const RTDN = "jeton-rtdn-de-test";

let db: Db;
let app: FastifyInstance;
let g: FakeGoogle;
let chain: TestChain;
let sandboxAll = true;
const hub = new SseHub();
const events: { familyId: string; event: string }[] = [];
let n = 0;

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  chain = testAppleChain();
  g = new FakeGoogle();
  const google = new GooglePlay({ packageName: PKG, serviceAccount: testServiceAccount(), rtdnToken: RTDN }, g.fetch);
  const apple = new AppleStore({ bundleId: BUNDLE, roots: [chain.rootFingerprint] });
  const sandbox = { get all() { return sandboxAll; }, families: [] as string[] };
  app = await buildApp({ db, hub, store: testStore(), loginRateLimit: { max: 10_000, timeWindow: "1 minute" }, stores: { google, apple, sandbox, log: () => {} }, purchaseRateLimit: { max: 10_000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  await quotaDeactivate(db);
  await app.close();
  await closeTestDb();
});
beforeEach(async () => {
  sandboxAll = true;
  g.down = false;
  events.length = 0;
  await quotaActivate(db);
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
async function family() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `S${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const familyCode = res.json().familyCode as string;
  const admin = cookieOf(res);
  await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: "Marie", login: "marie", role: "staff", secret: "573918", secretConfirm: "573918" } });
  const staff = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login: "marie", secret: "573918" } }));
  const plan = (await app.inject({ method: "GET", url: "/api/family/plan", cookies: admin })).json().plan;
  const fid = (await db.query("SELECT id FROM families WHERE store_account_token = $1", [plan.storeAccountToken])).rows[0].id as string;
  hub.add({ familyId: fid, profileId: "spy", sessionId: `spy-${n}`, send: (event) => events.push({ familyId: fid, event }), close: () => {} });
  return { admin, staff, token: plan.storeAccountToken as string, familyId: fid };
}
type Fam = Awaited<ReturnType<typeof family>>;

const plan = async (f: Fam, who: "admin" | "staff" = "admin") => (await app.inject({ method: "GET", url: "/api/family/plan", cookies: f[who] })).json().plan;
const submit = (f: Fam, payload: object, who: "admin" | "staff" = "admin") => app.inject({ method: "POST", url: "/api/family/purchases", cookies: f[who], payload: payload as any });
const googleBuy = (f: Fam, token: string, productId = "courses_famille_a_vie", who: "admin" | "staff" = "admin") => submit(f, { platform: "google", productId, purchaseToken: token }, who);
const notifyGoogle = (body: unknown, tok = RTDN) => app.inject({ method: "POST", url: `/api/store/google/rtdn?token=${tok}`, payload: body as any });
const notifyApple = (payload: unknown) => app.inject({ method: "POST", url: "/api/store/apple/notifications", payload: { signedPayload: signJws(payload, chain) } });
const useUp = async (f: Fam) => {
  await db.query("UPDATE families SET list_creations_used = 10 WHERE id = $1", [f.familyId]);
};
const row = async (key: string) => (await db.query("SELECT * FROM family_entitlements WHERE purchase_key = $1", [key])).rows[0];
let k = 0;
const tok = () => `google-token-${++k}-${"x".repeat(20)}`;

const appleTx = (f: Fam | null, o: Partial<Record<string, unknown>> = {}) => ({
  transactionId: `2000000${++k}`,
  originalTransactionId: `1000000${k}`,
  bundleId: BUNDLE,
  productId: "courses_famille_a_vie",
  type: "Non-Consumable",
  environment: "Sandbox",
  inAppOwnershipType: "PURCHASED",
  ...(f ? { appAccountToken: f.token } : {}),
  ...o,
});

describe("vérification des achats Google Play", () => {
  it("achat à vie : vérifié auprès de Google, rattaché à la famille, acheteur tracé, confirmé, toute la famille débloquée", async () => {
    const f = await family();
    await useUp(f);
    expect((await plan(f)).blocked).toBe(true);
    const t = tok();
    g.lifetime(t, f.token, { test: true });
    const r = await googleBuy(f, t);
    expect(r.statusCode).toBe(200);
    expect(r.json().plan.blocked).toBe(false);
    expect(r.json().plan.entitlement.kind).toBe("lifetime");
    const e = await row(t);
    expect(e.family_id).toBe(f.familyId);
    expect(e.buyer_profile_id).toBeTruthy();
    expect(e.environment).toBe("sandbox");
    expect(g.acks).toContain(t);
    // Le personnel (Android ou iPhone : même serveur) voit la famille débloquée, sans jeton d'achat.
    const sp = await plan(f, "staff");
    expect(sp.blocked).toBe(false);
    expect(sp.storeAccountToken).toBeUndefined();
    expect(events.some((x) => x.familyId === f.familyId && x.event === "plan.updated")).toBe(true);
    // Le compteur reste ce qu'il était : aucune remise à zéro.
    expect(sp.used).toBe(10);
  });

  it("un achat sans le jeton de la famille, ou fait pour une autre famille, est refusé et journalisé", async () => {
    const a = await family();
    const b = await family();
    const t1 = tok();
    g.lifetime(t1, null);
    expect((await googleBuy(a, t1)).json().error).toBe("purchase_not_for_family");
    const t2 = tok();
    g.lifetime(t2, a.token);
    const r = await googleBuy(b, t2);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("purchase_not_for_family");
    expect(await row(t2)).toBeUndefined();
    const ev = (await db.query("SELECT type, details FROM entitlement_events WHERE source = 'refused' AND family_id = $1", [b.familyId])).rows;
    expect(ev.map((x) => x.type)).toContain("purchase_not_for_family");
    expect(JSON.stringify(ev)).not.toContain(t2); // jamais le jeton complet dans le journal
  });

  it("un même achat ne peut jamais être rattaché à deux familles", async () => {
    const a = await family();
    const b = await family();
    const t = tok();
    g.lifetime(t, a.token);
    expect((await googleBuy(a, t)).statusCode).toBe(200);
    const r = await googleBuy(b, t);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("purchase_other_family");
    expect((await row(t)).family_id).toBe(a.familyId);
    expect((await plan(b)).entitlement).toBeNull();
  });

  it("présentations simultanées et rejouées (restaurer) : une seule ligne, aucune erreur", async () => {
    const f = await family();
    const t = tok();
    g.lifetime(t, f.token);
    const rs = await Promise.all([googleBuy(f, t), googleBuy(f, t), googleBuy(f, t, "courses_famille_a_vie", "staff")]);
    expect(rs.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect((await db.query("SELECT count(*)::int AS n FROM family_entitlements WHERE purchase_key = $1", [t])).rows[0].n).toBe(1);
  });

  it("achat de test refusé quand le serveur ne les admet pas (production)", async () => {
    sandboxAll = false;
    const f = await family();
    const t = tok();
    g.lifetime(t, f.token, { test: true });
    const r = await googleBuy(f, t);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("purchase_sandbox");
    expect(g.acks).not.toContain(t); // non confirmé : Google le rembourse
  });

  it("paiement en attente : aucun accès, puis débloqué par la notification Google quand il est payé", async () => {
    const f = await family();
    await useUp(f);
    const t = tok();
    g.lifetime(t, f.token, { state: 2 });
    expect((await googleBuy(f, t)).json().plan.blocked).toBe(true);
    expect(g.acks).not.toContain(t);
    g.lifetime(t, f.token, { state: 0 });
    const r = await notifyGoogle(rtdn("m-pending-1", { oneTimeProductNotification: { version: "1.0", notificationType: 1, purchaseToken: t, sku: "courses_famille_a_vie" } }));
    expect(r.statusCode).toBe(200);
    expect((await plan(f)).blocked).toBe(false);
    expect(g.acks).toContain(t);
  });

  it("notification : adresse protégée par jeton, autre application ignorée, rejeu traité une seule fois", async () => {
    const f = await family();
    const t = tok();
    g.annual(t, f.token);
    await googleBuy(f, t, "courses_famille_annuel");
    expect((await notifyGoogle(rtdn("m1", {}), "mauvais")).statusCode).toBe(404);
    expect((await notifyGoogle(rtdn("m2", { subscriptionNotification: { notificationType: 3, purchaseToken: t, subscriptionId: "courses_famille_annuel" } }, "autre.app"))).statusCode).toBe(200);
    g.annual(t, f.token, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenew: false });
    const body = rtdn("m3", { subscriptionNotification: { notificationType: 3, purchaseToken: t, subscriptionId: "courses_famille_annuel" } });
    await notifyGoogle(body);
    await notifyGoogle(body);
    const ev = (await db.query("SELECT count(*)::int AS n FROM entitlement_events WHERE event_key = 'pubsub:m3'")).rows[0].n;
    expect(ev).toBe(1);
    expect((await row(t)).status).toBe("cancelled");
  });

  it("abonnement annuel : arrêté → accès jusqu'à l'échéance ; expiré → bloqué, sans nouveau lot gratuit", async () => {
    const f = await family();
    await useUp(f);
    const t = tok();
    const expiry = new Date(Date.now() + 20 * 86400_000);
    g.annual(t, f.token, { expiry });
    expect((await googleBuy(f, t, "courses_famille_annuel")).json().plan.blocked).toBe(false);
    expect(g.acks).toContain(t);
    let p = await plan(f);
    expect(p.entitlement.autoRenewing).toBe(true);
    expect(p.entitlement.expiresAt).toBe(expiry.toISOString());
    g.annual(t, f.token, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenew: false, expiry });
    await notifyGoogle(rtdn("m-cancel", { subscriptionNotification: { notificationType: 3, purchaseToken: t, subscriptionId: "courses_famille_annuel" } }));
    p = await plan(f);
    expect(p.blocked).toBe(false);
    expect(p.entitlement.status).toBe("cancelled");
    expect(p.entitlement.autoRenewing).toBe(false);
    g.annual(t, f.token, { state: "SUBSCRIPTION_STATE_EXPIRED", autoRenew: false, expiry: new Date(Date.now() - 1000) });
    await notifyGoogle(rtdn("m-exp", { subscriptionNotification: { notificationType: 13, purchaseToken: t, subscriptionId: "courses_famille_annuel" } }));
    p = await plan(f);
    expect(p.blocked).toBe(true);
    expect(p.entitlement).toBeNull();
    expect(p.freeRemaining).toBe(0);
  });

  it("période de grâce : l'accès continue ; suspension (paiement refusé) : bloqué", async () => {
    const f = await family();
    await useUp(f);
    const t = tok();
    g.annual(t, f.token, { state: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", expiry: new Date(Date.now() - 86400_000) });
    expect((await googleBuy(f, t, "courses_famille_annuel")).json().plan.blocked).toBe(false);
    g.annual(t, f.token, { state: "SUBSCRIPTION_STATE_ON_HOLD", expiry: new Date(Date.now() - 86400_000) });
    await notifyGoogle(rtdn("m-hold", { subscriptionNotification: { notificationType: 5, purchaseToken: t, subscriptionId: "courses_famille_annuel" } }));
    expect((await plan(f)).blocked).toBe(true);
  });

  it("remboursement (achat annulé) : accès retiré, et une nouvelle présentation ne le rend pas ; révocation d'abonnement aussi", async () => {
    const f = await family();
    await useUp(f);
    const t = tok();
    g.lifetime(t, f.token);
    await googleBuy(f, t);
    await notifyGoogle(rtdn("m-void", { voidedPurchaseNotification: { purchaseToken: t, orderId: "GPA.1", productType: 2, refundType: 1 } }));
    expect((await row(t)).status).toBe("refunded");
    expect((await plan(f)).blocked).toBe(true);
    expect((await googleBuy(f, t)).json().plan.blocked).toBe(true); // Google le dit encore « acheté » : le remboursement prime
    const s = tok();
    g.annual(s, f.token);
    await googleBuy(f, s, "courses_famille_annuel");
    expect((await plan(f)).blocked).toBe(false);
    await notifyGoogle(rtdn("m-revoke", { subscriptionNotification: { notificationType: 12, purchaseToken: s, subscriptionId: "courses_famille_annuel" } }));
    expect((await row(s)).status).toBe("revoked");
    expect((await plan(f)).blocked).toBe(true);
  });

  it("abonnement repris avec un nouveau jeton : l'ancien est marqué remplacé", async () => {
    const f = await family();
    const old = tok();
    g.annual(old, f.token);
    await googleBuy(f, old, "courses_famille_annuel");
    const neu = tok();
    g.annual(neu, f.token, { linked: old });
    await googleBuy(f, neu, "courses_famille_annuel");
    const o = await row(old);
    expect(o.status).toBe("replaced");
    expect(o.replaced_by).toBe((await row(neu)).id);
  });

  it("achat inconnu de Google, produit inconnu, Google indisponible : refus compréhensibles, rien d'enregistré", async () => {
    const f = await family();
    const r1 = await googleBuy(f, tok());
    expect(r1.statusCode).toBe(400);
    expect(r1.json().error).toBe("purchase_unknown");
    expect((await googleBuy(f, tok(), "autre_produit")).json().error).toBe("purchase_unknown");
    const t = tok();
    g.lifetime(t, f.token);
    g.down = true;
    const r3 = await googleBuy(f, t);
    expect(r3.statusCode).toBe(503);
    expect(r3.json().error).toBe("store_unavailable");
    expect(await row(t)).toBeUndefined();
  });

  it("notification d'un achat jamais présenté par l'application (application fermée pendant l'achat) : rattaché par le jeton de la famille", async () => {
    const f = await family();
    const t = tok();
    g.lifetime(t, f.token);
    await notifyGoogle(rtdn("m-orphan", { oneTimeProductNotification: { notificationType: 1, purchaseToken: t, sku: "courses_famille_a_vie" } }));
    const e = await row(t);
    expect(e.family_id).toBe(f.familyId);
    expect(e.buyer_profile_id).toBeNull();
    expect(g.acks).toContain(t);
  });

  it("rapprochement : rattrape une notification perdue et les remboursements de la liste Google", async () => {
    const f = await family();
    const s = tok();
    g.annual(s, f.token);
    await googleBuy(f, s, "courses_famille_annuel");
    const t = tok();
    g.lifetime(t, f.token);
    await googleBuy(f, t);
    g.annual(s, f.token, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenew: false });
    g.voided = [{ purchaseToken: t, orderId: "GPA.x", voidedTimeMillis: "123" }];
    const svc = new StoreService(db, undefined, { google: new GooglePlay({ packageName: PKG, serviceAccount: testServiceAccount() }, g.fetch), log: () => {} });
    const r = await svc.reconcile();
    expect(r.changed).toBeGreaterThanOrEqual(1);
    expect(r.voided).toBe(1);
    expect((await row(s)).status).toBe("cancelled");
    expect((await row(t)).status).toBe("refunded");
    expect((await svc.reconcile()).voided).toBe(0); // déjà traité
    g.voided = [];
  });
});

describe("vérification des achats App Store", () => {
  it("transaction signée par Apple : achat à vie rattaché ; signature, racine, application ou famille invalides refusées", async () => {
    const f = await family();
    await useUp(f);
    const tx = appleTx(f);
    const r = await submit(f, { platform: "apple", signedTransaction: signJws(tx, chain) });
    expect(r.statusCode).toBe(200);
    expect(r.json().plan.blocked).toBe(false);
    expect((await row(tx.originalTransactionId)).platform).toBe("apple");

    const jws = signJws(appleTx(f), chain);
    const tampered = jws.slice(0, jws.lastIndexOf(".") - 4) + "AAAA" + jws.slice(jws.lastIndexOf("."));
    expect((await submit(f, { platform: "apple", signedTransaction: tampered })).json().error).toBe("purchase_invalid");
    expect((await submit(f, { platform: "apple", signedTransaction: signJws(appleTx(f), chain.foreign) })).json().error).toBe("purchase_invalid");
    expect((await submit(f, { platform: "apple", signedTransaction: signJws(appleTx(f, { bundleId: "autre.app" }), chain) })).json().error).toBe("purchase_invalid");
    expect((await submit(f, { platform: "apple", signedTransaction: signJws(appleTx(null), chain) })).json().error).toBe("purchase_not_for_family");
    expect((await submit(f, { platform: "apple", signedTransaction: signJws(appleTx(f, { inAppOwnershipType: "FAMILY_SHARED" }), chain) })).json().error).toBe("purchase_family_shared");
    // La racine réelle d'Apple n'accepte pas la chaîne de test.
    expect(() => verifyAppleJws(signJws(appleTx(f), chain))).toThrow();
  });

  it("abonnement annuel : notifications Apple (arrêt du renouvellement, remboursement, annulation du remboursement, expiration, grâce)", async () => {
    const f = await family();
    await useUp(f);
    const expiresDate = Date.now() + 30 * 86400_000;
    const tx = appleTx(f, { productId: "courses_famille_annuel", type: "Auto-Renewable Subscription", expiresDate });
    expect((await submit(f, { platform: "apple", signedTransaction: signJws(tx, chain) })).json().plan.blocked).toBe(false);
    const key = tx.originalTransactionId as string;
    const note = (type: string, t: object, extra: object = {}, subtype?: string) =>
      notifyApple({ notificationType: type, subtype, notificationUUID: `uuid-${++k}`, data: { bundleId: BUNDLE, environment: "Sandbox", signedTransactionInfo: signJws(t, chain), ...extra } });

    await note("DID_CHANGE_RENEWAL_STATUS", tx, { signedRenewalInfo: signJws({ autoRenewStatus: 0 }, chain), status: 1 }, "AUTO_RENEW_DISABLED");
    let p = await plan(f);
    expect(p.entitlement.status).toBe("cancelled");
    expect(p.blocked).toBe(false);

    await note("REFUND", { ...tx, revocationDate: Date.now() });
    expect((await row(key)).status).toBe("refunded");
    expect((await plan(f)).blocked).toBe(true);
    await note("REFUND_REVERSED", tx, { signedRenewalInfo: signJws({ autoRenewStatus: 1 }, chain), status: 1 });
    expect((await row(key)).status).toBe("active");

    await note("DID_FAIL_TO_RENEW", { ...tx, expiresDate: Date.now() - 1000 }, { signedRenewalInfo: signJws({ autoRenewStatus: 1, gracePeriodExpiresDate: Date.now() + 5 * 86400_000 }, chain), status: 4 }, "GRACE_PERIOD");
    p = await plan(f);
    expect(p.entitlement.status).toBe("grace");
    expect(p.blocked).toBe(false);

    await note("EXPIRED", { ...tx, expiresDate: Date.now() - 1000 }, { signedRenewalInfo: signJws({ autoRenewStatus: 0 }, chain), status: 2 }, "VOLUNTARY");
    p = await plan(f);
    expect(p.blocked).toBe(true);
    expect(p.freeRemaining).toBe(0);
  });

  it("notification non signée par Apple refusée ; notification rejouée traitée une seule fois", async () => {
    const f = await family();
    const bad = await app.inject({ method: "POST", url: "/api/store/apple/notifications", payload: { signedPayload: signJws({ notificationType: "TEST" }, chain.foreign) } });
    expect(bad.statusCode).toBe(400);
    const tx = appleTx(f);
    const body = { notificationType: "ONE_TIME_CHARGE", notificationUUID: "uuid-replay", data: { bundleId: BUNDLE, signedTransactionInfo: signJws(tx, chain) } };
    await notifyApple(body);
    await notifyApple(body);
    expect((await row(tx.originalTransactionId)).family_id).toBe(f.familyId);
    expect((await db.query("SELECT count(*)::int AS n FROM entitlement_events WHERE event_key = 'asn:uuid-replay'")).rows[0].n).toBe(1);
  });

  it("achat Android puis restauration sur iPhone : un seul paiement, la famille reste débloquée partout", async () => {
    const f = await family();
    await useUp(f);
    const t = tok();
    g.lifetime(t, f.token);
    expect((await googleBuy(f, t)).json().result).toEqual({ status: "active" });
    // L'iPhone n'a aucun achat App Store à restaurer : il lit simplement l'état de la famille.
    expect((await plan(f, "staff")).blocked).toBe(false);
    expect((await plan(f, "staff")).entitlement.platform).toBe("google");
  });
});
