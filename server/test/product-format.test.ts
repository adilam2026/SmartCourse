import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

/** Format du produit : facultatif, modifiable par l'administrateur, renvoyé dans le catalogue, sans aucune conversion. */
let db: Db;
let app: FastifyInstance;
type Cookies = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, store: testStore(), loginRateLimit: { max: 1000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

describe("format du produit", () => {
  it("facultatif, enregistré et effacé par l'administrateur, visible au catalogue, sans changer unité ni prix", async () => {
    const r = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: "Format", admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
    const admin = cookieOf(r);
    const code = r.json().familyCode as string;
    await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: "Lamiaa", login: "lamiaa", role: "parent", secret: "573918", secretConfirm: "573918" } });
    const parent = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: code, login: "lamiaa", secret: "573918" } }));
    const cat = (await app.inject({ method: "GET", url: "/api/catalog", cookies: admin })).json();
    const thon = cat.categories.flatMap((c: any) => c.products).find((p: any) => p.name === "Thon en conserve");
    expect(thon).toMatchObject({ unit: "boite", format: null });

    const set = await app.inject({ method: "PATCH", url: `/api/products/${thon.id}`, cookies: admin, payload: { format: "  boîte de 80 g " } });
    expect(set.json().product).toMatchObject({ unit: "boite", format: "boîte de 80 g" });
    const again = (await app.inject({ method: "GET", url: "/api/catalog", cookies: parent })).json().categories.flatMap((c: any) => c.products).find((p: any) => p.id === thon.id);
    expect(again).toMatchObject({ unit: "boite", format: "boîte de 80 g", price: thon.price }); // unité et prix inchangés

    expect((await app.inject({ method: "PATCH", url: `/api/products/${thon.id}`, cookies: parent, payload: { format: "x" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/api/products/${thon.id}`, cookies: admin, payload: { format: "x".repeat(61) } })).statusCode).toBe(400);
    // Une autre modification ne l'efface pas ; une valeur vide l'efface
    expect((await app.inject({ method: "PATCH", url: `/api/products/${thon.id}`, cookies: admin, payload: { active: true } })).json().product.format).toBe("boîte de 80 g");
    expect((await app.inject({ method: "PATCH", url: `/api/products/${thon.id}`, cookies: admin, payload: { format: "" } })).json().product.format).toBeNull();
  });
});
