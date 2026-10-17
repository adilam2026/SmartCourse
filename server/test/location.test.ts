import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import type { Mailer, OutgoingMail, SendResult } from "../src/mail.js";
import { RecoveryService } from "../src/recovery.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

class RecordingMailer implements Mailer {
  enabled = true;
  sent: OutgoingMail[] = [];
  async send(m: OutgoingMail): Promise<SendResult> { this.sent.push(m); return { accepted: true, messageId: `<m${this.sent.length}@test>` }; }
}
let db: Db;
let app: FastifyInstance;
const mailer = new RecordingMailer();
let n = 0;
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  const recovery = new RecoveryService(db, mailer, "https://x.example", { resendCooldownSec: 0 });
  app = await buildApp({ db, store: testStore(), recovery, loginRateLimit: { max: 1000, timeWindow: "1 minute" }, signupRateLimit: { max: 1000, timeWindow: "1 minute" }, signupVerifyRateLimit: { max: 1000, timeWindow: "1 minute" }, signupLimits: { perIpPerHour: 1000, globalPerHour: 1000, familiesPerDay: 1000 } });
  await app.ready();
});
afterAll(async () => { await app.close(); await closeTestDb(); });
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
const me = async (cookies: any) => (await app.inject({ method: "GET", url: "/api/me", cookies })).json().me;

async function signup(over: object) {
  const email = `loc${++n}@example.org`;
  const s = await app.inject({ method: "POST", url: "/api/signup/start", payload: { requestId: randomUUID(), familyName: "F", displayName: "A", login: "adil", email, secret: "482913", secretConfirm: "482913", ...over } });
  if (s.statusCode !== 201) return { start: s };
  const code = mailer.sent.filter((m) => m.to === email).at(-1)!.text.match(/(\d{6})/)![1]!;
  const v = await app.inject({ method: "POST", url: "/api/signup/verify", payload: { signupId: s.json().signupId, code } });
  return { start: s, cookies: cookieOf(v) };
}
/** Famille « existante » (avant la localisation familiale) : installée par jeton, puis remise sans pays. */
async function legacyFamily(adminCity: string | null) {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `L${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const cookies = cookieOf(res);
  const m = await me(cookies);
  await db.query("UPDATE families SET country = NULL, city = NULL, location_confirmed_at = NULL WHERE id = $1", [m.familyId]);
  await db.query("UPDATE profiles SET city = $2 WHERE id = $1", [m.id, adminCity]);
  return { cookies, familyCode: res.json().familyCode as string, familyId: m.familyId as string };
}

describe("pays et ville de la famille", () => {
  it("création : Maroc → ville obligatoire et normalisée ; autre pays → sans ville ; ancienne application (ville seule) → Maroc", async () => {
    expect((await signup({ country: "MA" })).start.json().error).toBe("city_required");
    expect((await signup({ country: "MA", city: "Ville inventée" })).start.json().error).toBe("invalid_city");
    expect((await signup({})).start.json().error).toBe("country_required");
    expect((await signup({ country: "ZZ" })).start.json().error).toBe("invalid_country");
    const ma = await signup({ country: "MA", city: "casablanca" });
    expect((await me(ma.cookies)).location).toMatchObject({ country: "MA", city: "Casablanca", confirmed: true, pricesAvailable: true });
    const fr = await signup({ country: "FR", city: "Paris" });
    expect((await me(fr.cookies)).location).toMatchObject({ country: "FR", city: null, confirmed: true, pricesAvailable: false });
    const old = await signup({ city: "Rabat" });
    expect((await me(old.cookies)).location).toMatchObject({ country: "MA", city: "Rabat", confirmed: true });
  });

  it("famille existante : jamais Maroc supposé ; préremplissage seulement depuis une ville reconnue ; confirmation par un administrateur", async () => {
    const known = await legacyFamily("Casablanca");
    expect((await me(known.cookies)).location).toEqual({ country: null, city: null, confirmed: false, pricesAvailable: true, suggestion: { country: "MA", city: "Casablanca" } });
    const unknown = await legacyFamily("Ville inconnue");
    expect((await me(unknown.cookies)).location.suggestion).toBeNull();
    const none = await legacyFamily(null);
    expect((await me(none.cookies)).location.suggestion).toBeNull();
    // personnel : ni suggestion ni modification
    await app.inject({ method: "POST", url: "/api/profiles", cookies: known.cookies, payload: { displayName: "Marie", login: "marie", role: "staff", secret: "573918", secretConfirm: "573918" } });
    const staff = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: known.familyCode, login: "marie", secret: "573918" } }));
    expect((await me(staff)).location.suggestion).toBeNull();
    expect((await app.inject({ method: "PUT", url: "/api/family/location", cookies: staff, payload: { country: "MA", city: "Rabat" } })).statusCode).toBe(403);
    // confirmation : Maroc + ville ; les membres sans ville en héritent, une ville déjà choisie n'est pas écrasée
    await db.query("UPDATE profiles SET city = NULL WHERE login = 'marie' AND family_id = $1", [known.familyId]);
    const put = await app.inject({ method: "PUT", url: "/api/family/location", cookies: known.cookies, payload: { country: "MA", city: "casa anfa" } });
    expect(put.statusCode === 200 || put.json().error === "invalid_city").toBe(true);
    const ok = await app.inject({ method: "PUT", url: "/api/family/location", cookies: known.cookies, payload: { country: "MA", city: "Rabat" } });
    expect(ok.json().location).toMatchObject({ country: "MA", city: "Rabat", confirmed: true });
    expect((await me(staff)).city).toBe("Rabat");
    expect((await me(known.cookies)).city).toBe("Casablanca");
    // nouveau membre : hérite de la ville de la famille
    await app.inject({ method: "POST", url: "/api/profiles", cookies: known.cookies, payload: { displayName: "Sara", login: "sara", role: "parent", secret: "573918", secretConfirm: "573918" } });
    expect((await db.query("SELECT city FROM profiles WHERE login = 'sara' AND family_id = $1", [known.familyId])).rows[0].city).toBe("Rabat");
  });

  it("hors du Maroc : pas de prix indicatifs ni de prix communautaires ; les prix familiaux restent enregistrés", async () => {
    const f = await legacyFamily("Casablanca");
    const prods = (await app.inject({ method: "GET", url: "/api/catalog", cookies: f.cookies })).json().categories.flatMap((c: any) => c.products);
    const lait = prods.find((p: any) => p.name === "Lait");
    expect((await app.inject({ method: "PUT", url: `/api/products/${lait.id}/price`, cookies: f.cookies, payload: { amount: "12.00", refQty: "1", refUnit: "litre" } })).statusCode).toBeLessThan(300);
    await app.inject({ method: "PUT", url: "/api/family/location", cookies: f.cookies, payload: { country: "FR" } });
    const after = (await app.inject({ method: "GET", url: "/api/catalog", cookies: f.cookies })).json().categories.flatMap((c: any) => c.products);
    expect(after.every((p: any) => p.price === null)).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/prices/community", cookies: f.cookies })).json().error).toBe("prices_unavailable");
    expect((await db.query("SELECT amount FROM family_prices WHERE product_id = $1", [lait.id])).rows[0].amount).toBe("12.00"); // conservé
    // retour au Maroc : le prix familial réapparaît, intact
    await app.inject({ method: "PUT", url: "/api/family/location", cookies: f.cookies, payload: { country: "MA", city: "Fès" } });
    const back = (await app.inject({ method: "GET", url: "/api/catalog", cookies: f.cookies })).json().categories.flatMap((c: any) => c.products).find((p: any) => p.id === lait.id);
    expect(back.price?.amount ?? back.price?.amountText ?? JSON.stringify(back.price)).toContain("12");
  });
});
