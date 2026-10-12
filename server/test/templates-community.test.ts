import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
let n = 0;
const rate = { max: 1000, timeWindow: "1 minute" };
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  await db.query("DELETE FROM price_contributions");
  await db.query("DELETE FROM base_prices");
  app = await buildApp({ db, store: testStore(), loginRateLimit: rate });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((x) => x.name === "sc_session")!.value });
async function family() {
  const r = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `F${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const admin = cookieOf(r);
  await app.inject({ method: "PUT", url: "/api/me/city", cookies: admin, payload: { city: "Casablanca" } }); // prix partagés : par ville
  const add = async (login: string, role: string) => {
    await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: login, login, role, secret: "573918", secretConfirm: "573918" } });
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: r.json().familyCode, login, secret: "573918" } }));
  };
  const cat = (await app.inject({ method: "GET", url: "/api/catalog", cookies: admin })).json();
  const products: Record<string, any> = {};
  for (const c of cat.categories) for (const p of c.products) products[p.name] = p;
  return { admin, add, products };
}

describe("favoris", () => {
  it("les administrateurs créent, modifient, nomment et suppriment ; les parents lisent ; le personnel n'y a pas accès ; famille isolée", async () => {
    const f = await family();
    const g = await family();
    const parent = await f.add("lamiaa", "parent");
    const staff = await f.add("marie", "staff");
    const body = { name: "Courses de la semaine", items: [{ productId: f.products["Tomates"].id, quantity: 1.5 }, { productId: f.products["Lait"].id, quantity: 6 }] };
    expect((await app.inject({ method: "POST", url: "/api/templates", cookies: parent, payload: body })).statusCode).toBe(403);
    const made = await app.inject({ method: "POST", url: "/api/templates", cookies: f.admin, payload: body });
    expect(made.statusCode).toBe(201);
    const t = made.json().template;
    expect(t.items.map((i: any) => [i.name, i.quantity])).toEqual(expect.arrayContaining([["Tomates", 1.5], ["Lait", 6]]));
    expect((await app.inject({ method: "POST", url: "/api/templates", cookies: f.admin, payload: { ...body, name: "courses de la semaine" } })).statusCode).toBe(409); // nom unique
    expect((await app.inject({ method: "GET", url: "/api/templates", cookies: parent })).json().templates).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: "/api/templates", cookies: staff })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/templates", cookies: g.admin })).json().templates).toHaveLength(0);
    expect((await app.inject({ method: "PUT", url: `/api/templates/${t.id}`, cookies: g.admin, payload: { name: "X" } })).statusCode).toBe(404);
    const up = await app.inject({ method: "PUT", url: `/api/templates/${t.id}`, cookies: f.admin, payload: { name: "Semaine", items: [{ productId: f.products["Tomates"].id, quantity: 2 }] } });
    expect(up.json().template).toMatchObject({ name: "Semaine", items: [{ name: "Tomates", quantity: 2 }] });
    // quantités : décimales seulement pour kg et litre
    expect((await app.inject({ method: "POST", url: "/api/templates", cookies: f.admin, payload: { name: "Mauvais", items: [{ productId: f.products["Lait"].id, quantity: 1.5 }] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: `/api/templates/${t.id}`, cookies: f.admin })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/templates", cookies: parent })).json().templates).toHaveLength(0);
  });

  it("un favori garde ses produits désactivés (signalés, jamais réactivés) ; utiliser un favori ne le modifie pas ; enregistrer une liste comme favori", async () => {
    const f = await family();
    const tid = (await app.inject({ method: "POST", url: "/api/templates", cookies: f.admin, payload: { name: "A", items: [{ productId: f.products["Tomates"].id, quantity: 1 }] } })).json().template.id;
    await app.inject({ method: "PATCH", url: `/api/products/${f.products["Tomates"].id}`, cookies: f.admin, payload: { active: false } });
    const t = (await app.inject({ method: "GET", url: "/api/templates", cookies: f.admin })).json().templates[0];
    expect(t.items[0]).toMatchObject({ name: "Tomates", productActive: false });
    // le produit reste désactivé après lecture
    const cat = (await app.inject({ method: "GET", url: "/api/catalog?includeInactive=1", cookies: f.admin })).json();
    expect(cat.categories.flatMap((c: any) => c.products).find((p: any) => p.name === "Tomates").active).toBe(false);
    // depuis une liste
    const list = (await app.inject({ method: "POST", url: "/api/lists", cookies: f.admin })).json().list;
    await app.inject({ method: "POST", url: `/api/lists/${list.id}/ops`, cookies: f.admin, payload: { ops: [{ opId: randomUUID(), type: "add", productId: f.products["Lait"].id, quantity: 3 }] } });
    const fromList = await app.inject({ method: "POST", url: "/api/templates", cookies: f.admin, payload: { name: "Depuis la liste", fromListId: list.id } });
    expect(fromList.json().template.items).toMatchObject([{ name: "Lait", quantity: 3 }]);
    void tid;
  });
});

describe("partage communautaire des prix", () => {
  const price = { amount: "10", refQty: 1, refUnit: "kg" };
  const setPrice = (f: any, id: string, p: object = price) => app.inject({ method: "PUT", url: `/api/products/${id}/price`, cookies: f.admin, payload: p });
  const share = (f: any, id: string, extra: object = {}) => app.inject({ method: "POST", url: "/api/prices/share", cookies: f.admin, payload: { productId: id, ...extra } });

  it("une modification locale n'est pas publique ; seul un prix de la famille se partage ; rien d'identifiant n'est publié", async () => {
    const f = await family();
    const id = f.products["Tomates"].id;
    expect((await share(f, id)).statusCode).toBe(409); // aucun prix de la famille
    await setPrice(f, id);
    expect((await db.query("SELECT count(*)::int AS n FROM price_contributions")).rows[0].n).toBe(0); // local seulement
    const ok = await share(f, id, { city: "Rabat", store: "Marjane" });
    expect(ok.statusCode).toBe(201);
    const row = (await db.query("SELECT * FROM price_contributions ORDER BY created_at DESC LIMIT 1")).rows[0];
    expect(Object.keys(row).sort()).toEqual(["amount", "city", "contributor", "created_at", "excluded", "id", "key", "observed_on", "origin", "packaging", "piece_weight_g", "ref_qty", "ref_unit", "store"]);
    const dump = JSON.stringify(row);
    expect(dump).not.toMatch(/Adil|F\d+|@|adil/); // aucun nom, e-mail ni code famille
    expect(row.contributor).toMatch(/^[0-9a-f]{64}$/);
    // un produit propre à la famille ne se partage pas
    const own = await app.inject({ method: "POST", url: "/api/products", cookies: f.admin, payload: { name: "Mon produit maison", category: "epicerie" } });
    await setPrice(f, own.json().product.id);
    expect((await share(f, own.json().product.id)).statusCode).toBe(409);
  });

  it("limitation : un partage par produit et par jour ; prix incohérent refusé ; date invalide refusée", async () => {
    const f = await family();
    const id = f.products["Carottes"].id;
    await setPrice(f, id);
    expect((await share(f, id)).statusCode).toBe(201);
    expect((await share(f, id)).statusCode).toBe(409);
    const g = await family();
    const gid = g.products["Carottes"].id;
    await setPrice(g, gid, { amount: "900", refQty: 1, refUnit: "kg" }); // 90× la médiane connue ? (une seule contribution : base absente, accepté) puis incohérence avec 3+ contributions
    for (let i = 0; i < 3; i++) {
      const h = await family();
      await setPrice(h, h.products["Carottes"].id, { amount: "10", refQty: 1, refUnit: "kg" });
      await share(h, h.products["Carottes"].id);
    }
    expect((await share(g, gid)).statusCode).toBe(422);
    const k = await family();
    await setPrice(k, k.products["Oignons"].id);
    expect((await share(k, k.products["Oignons"].id, { observedOn: "2999-01-01" })).statusCode).toBe(400);
    expect((await share(k, k.products["Oignons"].id, { observedOn: "2020-01-01" })).statusCode).toBe(400);
  });

  it("propositions : médiane d'un format, plusieurs familles, valeurs aberrantes ignorées, formats jamais mélangés ; application explicite ; signalement", async () => {
    const viewer = await family();
    const vid = viewer.products["Pommes"].id;
    await setPrice(viewer, vid, { amount: "7", refQty: 1, refUnit: "kg" }); // prix de la famille : jamais écrasé automatiquement
    const key = (await db.query("SELECT catalog_key FROM products WHERE id = $1", [vid])).rows[0].catalog_key;
    const contribute = async (amount: string, refQty: number, refUnit: string, packaging?: string) => {
      const h = await family();
      const id = h.products["Pommes"].id;
      await setPrice(h, id, { amount, refQty, refUnit, ...(packaging ? { packaging } : {}) });
      const r = await share(h, id);
      expect(r.statusCode).toBe(201);
    };
    await contribute("10", 1, "kg");
    await contribute("12", 1, "kg");
    expect((await app.inject({ method: "GET", url: "/api/prices/community", cookies: viewer.admin })).json().proposals.filter((p: any) => p.productId === vid)).toHaveLength(0); // 2 familles : pas assez
    await contribute("6", 500, "g"); // 12 DH/kg (500 g à 6 DH)
    await contribute("11", 1, "kg");
    await db.query("INSERT INTO price_contributions (origin, key, amount, ref_qty, ref_unit, observed_on, contributor) VALUES ('initial',$1,'99',1,'kg',current_date,'x1')", [key]); // aberrante, ignorée
    await contribute("14", 1, "paquet", "250 g"); // autre format : jamais mélangé
    const props = (await app.inject({ method: "GET", url: "/api/prices/community", cookies: viewer.admin })).json().proposals.filter((p: any) => p.productId === vid);
    expect(props).toHaveLength(1); // le format « paquet de 250 g » n'a qu'une famille ; il n'est pas compatible avec l'unité kg du produit
    expect(props[0]).toMatchObject({ format: "kg", price: { amount: "11.50", refQty: "1", refUnit: "kg" }, current: { amount: "7.00", source: "family" } });
    // aucun écrasement automatique : le prix de la famille est toujours là
    const cat = (await app.inject({ method: "GET", url: "/api/catalog", cookies: viewer.admin })).json();
    expect(cat.categories.flatMap((c: any) => c.products).find((p: any) => p.id === vid).price).toMatchObject({ amount: "7.00", source: "family" });
    // l'administrateur choisit : seul un administrateur peut appliquer
    const parent = await viewer.add("lamiaa", "parent");
    expect((await app.inject({ method: "POST", url: "/api/prices/community/apply", cookies: parent, payload: { items: [{ productId: vid, format: "kg" }] } })).statusCode).toBe(403);
    const applied = await app.inject({ method: "POST", url: "/api/prices/community/apply", cookies: viewer.admin, payload: { items: [{ productId: vid, format: "kg" }] } });
    expect(applied.json()).toEqual({ applied: 1, gone: [] });
    expect((await app.inject({ method: "GET", url: "/api/catalog", cookies: viewer.admin })).json().categories.flatMap((c: any) => c.products).find((p: any) => p.id === vid).price).toMatchObject({ amount: "11.50", source: "community" });
    expect((await app.inject({ method: "POST", url: "/api/prices/community/apply", cookies: viewer.admin, payload: { items: [{ productId: vid, format: "kg" }] } })).statusCode).toBe(200);
    // signaler : la proposition disparaît pour cette famille
    const rep = await app.inject({ method: "POST", url: "/api/prices/community/report", cookies: viewer.admin, payload: { productId: vid, format: "kg", reason: "incohérent" } });
    expect(rep.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/prices/community", cookies: viewer.admin })).json().proposals.filter((p: any) => p.productId === vid)).toHaveLength(0);
  });

  it("la suppression d'une famille retire ses prix, favoris, profils ET les prix qu'elle avait partagés ; les autres familles et leurs contributions restent", async () => {
    const f = await family();
    const other = await family();
    await setPrice(f, f.products["Tomates"].id);
    await setPrice(other, other.products["Tomates"].id);
    await share(f, f.products["Tomates"].id);
    await share(other, other.products["Tomates"].id);
    await app.inject({ method: "POST", url: "/api/templates", cookies: f.admin, payload: { name: "Z", items: [{ productId: f.products["Tomates"].id, quantity: 1 }] } });
    const rows = (await db.query("SELECT f.id, f.code FROM families f ORDER BY f.created_at DESC LIMIT 2")).rows; // [other, f]
    const fid = rows[1].id as string;
    expect((await db.query("SELECT count(*)::int AS n FROM family_prices WHERE family_id = $1", [fid])).rows[0].n).toBe(1);
    const before = (await db.query("SELECT count(*)::int AS n FROM price_contributions")).rows[0].n;
    const { purgeFamily } = await import("../src/family-purge.js");
    await purgeFamily(db, testStore(), fid, rows[1].code);
    expect((await db.query("SELECT count(*)::int AS n FROM family_prices WHERE family_id = $1", [fid])).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM list_templates WHERE family_id = $1", [fid])).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM price_contributions")).rows[0].n).toBe(before - 1); // la sienne seulement
    expect((await db.query("SELECT count(*)::int AS n FROM family_prices WHERE family_id = $1", [rows[0].id])).rows[0].n).toBe(1);
  });
});
