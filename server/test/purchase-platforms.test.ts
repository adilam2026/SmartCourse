import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { quotaActivate, quotaDeactivate } from "../src/list-quota.js";
import { setPlatform } from "../src/purchase-platforms.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

/** Achats ouverts par plateforme : une famille n'est bloquée que si un de ses administrateurs peut réellement acheter. */
let db: Db;
let app: FastifyInstance;
let n = 0;
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, store: testStore(), loginRateLimit: { max: 10_000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  await quotaDeactivate(db);
  await setPlatform(db, "android", false, null);
  await setPlatform(db, "ios", false, null);
  await app.close();
  await closeTestDb();
});
beforeEach(async () => {
  await setPlatform(db, "android", false, null);
  await setPlatform(db, "ios", false, null);
  await quotaActivate(db);
});

type C = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): C => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
async function family() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `P${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const familyCode = res.json().familyCode as string;
  const admin = cookieOf(res);
  await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: "Marie", login: "marie", role: "staff", secret: "573918", secretConfirm: "573918" } });
  const staff = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login: "marie", secret: "573918" } }));
  const familyId = (await db.query("SELECT family_id FROM profiles WHERE id = (SELECT profile_id FROM sessions ORDER BY created_at DESC LIMIT 1)")).rows[0].family_id as string;
  await db.query("UPDATE families SET list_creations_used = 10 WHERE id = $1", [familyId]); // listes gratuites épuisées
  return { admin, staff, familyId };
}
const plan = async (c: C, client?: string) =>
  (await app.inject({ method: "GET", url: "/api/family/plan", cookies: c, headers: client ? { "x-courses-client": client } : {} })).json().plan;
const create = (c: C, client?: string) => app.inject({ method: "POST", url: "/api/lists", cookies: c, payload: {}, headers: client ? { "x-courses-client": client } : {} });
const closeActive = async (c: C) => {
  const l = (await app.inject({ method: "GET", url: "/api/lists/active", cookies: c })).json().list;
  if (l) await app.inject({ method: "POST", url: `/api/lists/${l.id}/close`, cookies: c, payload: {} });
};

describe("achats ouverts par plateforme", () => {
  it("aucune plateforme ouverte : listes gratuites épuisées mais création toujours possible (compteur qui continue)", async () => {
    const f = await family();
    const p = await plan(f.admin, "android/1300");
    expect(p).toMatchObject({ limitReached: true, familyCanPurchase: false, blocked: false });
    expect(p.purchaseHere).toEqual({ available: false, reason: "platform_closed", platform: "android" });
    await closeActive(f.admin);
    expect((await create(f.admin, "android/1300")).statusCode).toBe(201);
    expect((await plan(f.admin)).used).toBe(11);
  });

  it("Android ouvert à partir de 1300 : ancienne version (ou application web) = pas de blocage ; version suffisante = blocage et achat proposé", async () => {
    await setPlatform(db, "android", true, 1300);
    const f = await family();
    expect(await plan(f.admin, "android/1250")).toMatchObject({ blocked: false, purchaseHere: { available: false, reason: "update_required" } });
    expect((await plan(f.admin)).purchaseHere.reason).toBe("unknown_client"); // web ou version sans en-tête
    await closeActive(f.admin);
    expect((await create(f.admin)).statusCode).toBe(201);
    // L'administrateur ouvre une version qui sait acheter : la famille est désormais bloquée, et l'achat lui est proposé.
    expect(await plan(f.admin, "android/1300")).toMatchObject({ blocked: true, familyCanPurchase: true, purchaseHere: { available: true, reason: "ok" } });
    await closeActive(f.admin);
    const r = await create(f.admin);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("quota_reached");
  });

  it("seuls les administrateurs comptent : personnel sur Android à jour, administrateur seulement sur iPhone (fermé) → pas de blocage", async () => {
    await setPlatform(db, "android", true, 1);
    const f = await family();
    await plan(f.staff, "android/1300");
    const pa = await plan(f.admin, "ios/7");
    expect(pa).toMatchObject({ blocked: false, familyCanPurchase: false, purchaseHere: { available: false, reason: "platform_closed", platform: "ios" } });
    expect((await plan(f.staff, "android/1300")).purchaseHere.reason).toBe("not_admin");
    // Ouverture de l'iPhone : la famille devient bloquée, l'administrateur peut acheter depuis son iPhone.
    await setPlatform(db, "ios", true, 5);
    expect(await plan(f.admin, "ios/7")).toMatchObject({ blocked: true, purchaseHere: { available: true } });
  });

  it("activations indépendantes ; fermeture d'une plateforme : déblocage immédiat de ses familles", async () => {
    await setPlatform(db, "ios", true, 1);
    const f = await family();
    expect((await plan(f.admin, "android/1300")).blocked).toBe(false); // Android reste fermé
    await plan(f.admin, "ios/3");
    expect((await plan(f.admin)).blocked).toBe(true); // le même administrateur a aussi un iPhone qui permet d'acheter
    await setPlatform(db, "ios", false, null);
    expect((await plan(f.admin)).blocked).toBe(false);
  });

  it("en-tête invalide ignoré ; règle inactive : rien ne change", async () => {
    await setPlatform(db, "android", true, 1);
    const f = await family();
    expect((await plan(f.admin, "windows/3")).purchaseHere.reason).toBe("unknown_client");
    await quotaDeactivate(db);
    expect(await plan(f.admin, "android/5")).toMatchObject({ quotaActive: false, limitReached: false, blocked: false });
  });
});
