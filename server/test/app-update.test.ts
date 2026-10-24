import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import { updateLevel } from "../src/app-update.js";
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
  it("règle de comparaison des versionCode", () => {
    expect(updateLevel(1188, null, null)).toBe("none");
    expect(updateLevel(1188, 1195, null)).toBe("recommended");
    expect(updateLevel(1195, 1195, null)).toBe("none");
    expect(updateLevel(1188, 1195, 1190)).toBe("required");
    expect(updateLevel(1190, 1195, 1190)).toBe("recommended");
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
    expect((await put(manager, { latestVersionCode: 1195, minVersionCode: 1195, availableOnPlay: true, note: "1195 en production" })).statusCode).toBe(200);
    expect((await check(1188)).update).toBe("required");
    expect((await check(1195)).update).toBe("none");
    // Annulation de l'obligation : effet immédiat, la recommandation reste
    expect((await put(manager, { latestVersionCode: 1195, minVersionCode: null })).statusCode).toBe(200);
    expect((await check(1188)).update).toBe("recommended");
    const d = (await app.inject({ method: "GET", url: "/api/gestion/app-update", cookies: manager })).json();
    expect(d.history.map((h: any) => [h.latestVersionCode, h.minVersionCode])).toEqual([[1195, null], [1195, 1195], [1195, null]]);
    await put(manager, { latestVersionCode: null, minVersionCode: null });
    expect((await check(1188)).update).toBe("none");
  });

  it("réservé aux gestionnaires de Mes Courses (un administrateur de famille n'y a pas accès)", async () => {
    expect((await put(admin, { latestVersionCode: 1195, minVersionCode: null })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/gestion/app-update", cookies: admin })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/gestion/app-update", payload: { latestVersionCode: 1, minVersionCode: null } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/gestion/mise-a-jour" })).statusCode).toBe(200);
  });
});
