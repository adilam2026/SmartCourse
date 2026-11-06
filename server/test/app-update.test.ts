import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import { disableRequired, updateLevel } from "../src/app-update.js";
import type { Db } from "../src/db.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

/** Mise à jour de l'application : conseillée ou obligatoire, réglée par un gestionnaire, désactivée par défaut, annulable aussitôt. */
let db: Db;
let app: FastifyInstance;
type Cookies = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
let manager: Cookies;
let admin: Cookies;

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  const boot = await buildApp({ db, store: testStore() });
  await boot.ready();
  const r1 = await boot.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: "Gestion", admin: { displayName: "Gest", login: "gest", secret: "482913" } } });
  const r2 = await boot.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: "Famille", admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const managerId = r1.json().me.id as string;
  await boot.close();
  app = await buildApp({ db, store: testStore(), catalogManagers: [managerId] });
  await app.ready();
  manager = cookieOf(r1);
  admin = cookieOf(r2);
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const check = async (code: number) => (await app.inject({ method: "GET", url: `/api/app/update?platform=android&versionCode=${code}` })).json();
const put = (c: Cookies, body: object) => app.inject({ method: "PUT", url: "/api/gestion/app-update", cookies: c, payload: body });

describe("mise à jour de l'application", () => {
  it("règle de comparaison des numéros techniques (blocage seulement si activé ; système trop ancien jamais bloqué)", () => {
    const P = (latest: number | null, min: number | null, requiredActive = min !== null, minOs: number | null = null) => ({ latest, min, requiredActive, minOs });
    const L = (vc: number, p: ReturnType<typeof P>, os: number | null = null) => updateLevel(vc, p, os).level;
    expect(L(1188, P(null, null))).toBe("none");
    expect(L(1188, P(1195, null))).toBe("recommended");
    expect(L(1195, P(1195, null))).toBe("none");
    expect(L(1188, P(1195, 1190))).toBe("required");
    expect(L(1190, P(1195, 1190))).toBe("recommended");
    expect(L(1188, P(1195, 1190, false))).toBe("recommended"); // blocage préparé mais désactivé
    expect(L(1188, P(1195, 1190, true, 28), 26)).toBe("none"); // appareil qui ne peut pas installer la version exigée
    expect(updateLevel(1188, P(1195, 1190, true, 28), 26).deviceUnsupported).toBe(true);
    expect(L(1188, P(1195, 1190, true, 28), 30)).toBe("required");
    expect(L(1188, P(1195, 1190, true, 28), null)).toBe("recommended"); // système non transmis : jamais bloqué
    expect(L(9, P(10, 10), null)).toBe("required"); // comparaison numérique (9 < 10), pas alphabétique
  });

  it("désactivée par défaut, lisible sans connexion ; conseillée puis obligatoire avec confirmation ; annulation immédiate", async () => {
    expect(await check(1188)).toMatchObject({ update: "none", latestVersionCode: null, minVersionCode: null, storeUrl: "https://play.google.com/store/apps/details?id=app.smartcourse.courses.natif" });
    // Publier/conseiller une version ne la rend pas obligatoire
    expect((await put(manager, { latestVersionCode: 1195, minVersionCode: null })).statusCode).toBe(200);
    expect((await check(1188)).update).toBe("recommended");
    expect((await check(1195)).update).toBe("none");
    // Obligation : refusée sans confirmation de disponibilité sur Google Play, ou au-delà de la version conseillée
    expect((await put(manager, { latestVersionCode: 1195, minVersionCode: 1195 })).json().error).toBe("availability_not_confirmed");
    expect((await put(manager, { latestVersionCode: 1195, minVersionCode: 1200, availableOnPlay: true })).json().error).toBe("min_above_latest");
    expect((await put(manager, { latestVersionCode: null, minVersionCode: 1195, availableOnPlay: true })).json().error).toBe("min_without_latest");
    expect((await check(1188)).update).toBe("recommended");
    expect((await put(manager, { latestVersionCode: 1195, minVersionCode: 1195, availableOnPlay: true })).json().error).toBe("rollout_not_confirmed");
    expect((await put(manager, { latestVersionCode: 1195, minVersionCode: 1195, availableOnPlay: true, rolloutComplete: true, note: "1195 en production" })).statusCode).toBe(200);
    expect((await check(1188)).update).toBe("required");
    expect((await check(1195)).update).toBe("none");
    // Annulation de l'obligation : effet immédiat, la recommandation reste
    expect((await put(manager, { latestVersionCode: 1195, minVersionCode: null })).statusCode).toBe(200);
    expect((await check(1188)).update).toBe("recommended");
    const d = (await app.inject({ method: "GET", url: "/api/gestion/app-update", cookies: manager })).json();
    expect(d.history.filter((h: any) => h.platform === "android").map((h: any) => [h.latestVersionCode, h.minVersionCode])).toEqual([[1195, null], [1195, 1195], [1195, null]]);
    await put(manager, { latestVersionCode: null, minVersionCode: null });
    expect((await check(1188)).update).toBe("none");
  });

  it("réservé aux gestionnaires de Mes Courses (un administrateur de famille n'y a pas accès)", async () => {
    expect((await put(admin, { latestVersionCode: 1195, minVersionCode: null })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/gestion/app-update", cookies: admin })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/gestion/app-update", payload: { latestVersionCode: 1, minVersionCode: null } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/gestion/mise-a-jour" })).statusCode).toBe(200);
  });

  it("iPhone : réglage séparé d'Android, fiche App Store exigée, blocage activable et désactivable sans rien republier", async () => {
    const ios = async (code: number, os?: number) => (await app.inject({ method: "GET", url: `/api/app/update?platform=ios&versionCode=${code}${os ? `&os=${os}` : ""}` })).json();
    expect(await ios(5)).toMatchObject({ update: "none", storeUrl: null, minVersionCode: null });
    // Sans fiche App Store : rien n'est proposé (rien à ouvrir) et le blocage est refusé.
    expect((await put(manager, { platform: "ios", latestVersionCode: 12, minVersionCode: null })).statusCode).toBe(200);
    expect((await ios(5)).update).toBe("none");
    expect((await put(manager, { platform: "ios", latestVersionCode: 12, minVersionCode: 10, availableOnStore: true, rolloutComplete: true })).json().error).toBe("store_url_missing");
    expect((await put(manager, { platform: "ios", latestVersionCode: 12, minVersionCode: null, storeUrl: "https://exemple.com/app" })).json().error).toBe("store_url_invalid");
    expect((await put(manager, { platform: "ios", latestVersionCode: 12, minVersionCode: null, storeUrl: "https://apps.apple.com/app/id1234567890" })).statusCode).toBe(200);
    expect((await ios(5)).update).toBe("recommended");
    // Blocage préparé mais pas activé : seulement la proposition.
    expect((await put(manager, { platform: "ios", latestVersionCode: 12, minVersionCode: 10, requiredActive: false })).statusCode).toBe(200);
    expect((await ios(5)).update).toBe("recommended");
    expect((await ios(5)).minVersionCode).toBeNull();
    // Activation : confirmations exigées ; ensuite bloqué en dessous de 10, proposé entre 10 et 11, rien à 12.
    expect((await put(manager, { platform: "ios", latestVersionCode: 12, minVersionCode: 10, requiredActive: true, availableOnStore: true })).json().error).toBe("rollout_not_confirmed");
    expect((await put(manager, { platform: "ios", latestVersionCode: 12, minVersionCode: 10, requiredActive: true, minOs: 16, availableOnStore: true, rolloutComplete: true })).statusCode).toBe(200);
    expect((await ios(9, 17)).update).toBe("required");
    expect((await ios(9, 15)).update).toBe("none"); // iOS 15 : ne peut pas installer la version exigée
    expect((await ios(10, 17)).update).toBe("recommended");
    expect((await ios(12, 17)).update).toBe("none");
    // Android n'est pas touché.
    expect((await check(1)).update).toBe("none");
    // Désactivation immédiate (coupure de secours), numéros conservés ; réactivation : nouvelles confirmations.
    expect(await disableRequired(db, ["ios"], "test")).toBe(1);
    expect((await ios(9, 17)).update).toBe("recommended");
    const g = (await app.inject({ method: "GET", url: "/api/gestion/app-update", cookies: manager })).json();
    expect(g.platforms.ios).toMatchObject({ minVersionCode: 10, requiredActive: false, latestVersionCode: 12 });
    expect((await put(manager, { platform: "ios", latestVersionCode: 12, minVersionCode: 10, requiredActive: true })).json().error).toBe("availability_not_confirmed");
    await put(manager, { platform: "ios", latestVersionCode: null, minVersionCode: null });
    expect((await ios(9, 17)).update).toBe("none");
  });
});
