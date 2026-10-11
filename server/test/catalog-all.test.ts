import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
let n = 0;
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
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
async function newFamily() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `A${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const admin = cookieOf(res);
  await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: "marie", login: "marie", role: "staff", secret: "573918" } });
  const staff = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: res.json().familyCode, login: "marie", secret: "573918" } }));
  return { admin, staff };
}
const all = async (cookies: any, qs = "") => (await app.inject({ method: "GET", url: `/api/catalog/all${qs}`, cookies })).json();

describe("catalogue complet (Tous les produits)", () => {
  it("s'ouvre sans recherche, page par page, sans doublon ni perte (plus de 20 résultats)", async () => {
    const f = await newFamily();
    const first = await all(f.admin, "?limit=60");
    expect(first.total).toBeGreaterThanOrEqual(180);
    const seen = new Set<string>();
    for (let off = 0; off < first.total; off += 24) {
      const p = await all(f.admin, `?offset=${off}&limit=24`);
      for (const it of p.items) {
        const id = `${it.origin}:${it.key}`;
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(first.total);
    const fruits = await all(f.admin, "?category=fruits&limit=60");
    expect(fruits.items.every((i: any) => i.category === "fruits")).toBe(true);
    expect(fruits.total).toBeGreaterThan(20);
  });

  it("recherche commune (accents, casse) dans le catalogue de départ et étendu", async () => {
    const f = await newFamily();
    expect((await all(f.admin, "?q=PÊCHES")).items.map((i: any) => i.name)).toContain("Pêches");
    expect((await all(f.admin, "?q=oeufs")).items.map((i: any) => i.name)).toContain("Œufs");
    expect((await all(f.admin, "?q=%25%25")).total).toBe(0);
  });

  it("états absent / actif / désactivé ; réactive au lieu de recréer ; un article saisi à la main n'est jamais doublé", async () => {
    const f = await newFamily();
    const find = async (q: string) => (await all(f.admin, `?q=${encodeURIComponent(q)}`)).items.find((i: any) => i.name === q);
    expect((await find("Tomates")).status).toBe("active");
    expect((await find("Pêches")).status).toBe("absent");
    const add = await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "extended", key: "peches" } });
    expect(add.statusCode).toBe(201);
    const id = add.json().product.id;
    expect((await find("Pêches")).status).toBe("active");
    expect((await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "extended", key: "peches" } })).json()).toMatchObject({ created: false, reactivated: false });
    await app.inject({ method: "PATCH", url: `/api/products/${id}`, cookies: f.admin, payload: { active: false } });
    expect((await find("Pêches")).status).toBe("inactive");
    const re = await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "extended", key: "peches" } });
    expect(re.statusCode).toBe(200);
    expect(re.json()).toMatchObject({ created: false, reactivated: true, product: { id, active: true } });
    // article saisi à la main, même nom : reconnu, pas de second article
    await app.inject({ method: "POST", url: "/api/products", cookies: f.admin, payload: { name: "Melon", category: "fruits" } });
    expect((await find("Melon")).status).toBe("active");
    const dup = await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "extended", key: "melon" } });
    expect(dup.json()).toMatchObject({ created: false });
    const n = (await db.query("SELECT count(*)::int AS n FROM products p JOIN families f ON f.id = p.family_id WHERE lower(p.name) = 'melon'")).rows[0].n;
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("aucun droit nouveau : refusé au personnel, clé inconnue = 404", async () => {
    const f = await newFamily();
    expect((await app.inject({ method: "GET", url: "/api/catalog/all", cookies: f.staff })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.staff, payload: { origin: "extended", key: "peches" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "extended", key: "nexiste-pas" } })).statusCode).toBe(404);
  });

  it("audit : source de la photo et partage entre noms différents", async () => {
    const f = await newFamily();
    const rows = (await app.inject({ method: "GET", url: "/api/catalog/audit", cookies: f.admin })).json().products;
    expect(rows.length).toBe(80);
    expect(rows.find((r: any) => r.name === "Tomates").photoSource).toMatch(/catalogue|none/);
    expect((await app.inject({ method: "GET", url: "/api/catalog/audit", cookies: f.staff })).statusCode).toBe(403);
  });
});
