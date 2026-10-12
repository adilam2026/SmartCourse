import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { classify, parseCsv } from "../src/price-import.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
let n = 0;
const rate = { max: 1000, timeWindow: "1 minute" };

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
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
  const add = async (login: string, role: string) => {
    await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: login, login, role, secret: "573918", secretConfirm: "573918" } });
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: r.json().familyCode, login, secret: "573918" } }));
  };
  const cat = (await app.inject({ method: "GET", url: "/api/catalog", cookies: admin })).json();
  const products: Record<string, any> = {};
  for (const c of cat.categories) for (const p of c.products) products[p.name] = p;
  return { admin, add, products, code: r.json().familyCode as string };
}
const priceOf = async (cookies: any, id: string) => {
  const cat = (await app.inject({ method: "GET", url: "/api/catalog", cookies })).json();
  for (const c of cat.categories) for (const p of c.products) if (p.id === id) return p.price;
  return undefined;
};
const base = (key: string, amount: string, unit = "kg", qty = "1", extra = "") =>
  db.query(`INSERT INTO base_prices (origin, key, amount, ref_qty, ref_unit, kind, source, observed_on) VALUES ('initial',$1,$2,$3,$4,'observed','capture de test','2026-10-01') ON CONFLICT (origin, key) DO UPDATE SET amount = $2`, [key, amount, qty, unit]);

describe("prix : base initiale, prix de la famille, préférences", () => {
  it("la base s'applique par clé stable exacte ; le prix d'une famille prime et reste dans la famille ; la base ne l'écrase jamais", async () => {
    const f = await family();
    const g = await family();
    const tomates = f.products["Tomates"];
    expect(tomates.price).toBeNull(); // aucun prix : jamais zéro
    const key = (await db.query("SELECT catalog_key FROM products WHERE id = $1", [tomates.id])).rows[0].catalog_key;
    await base(key, "9.90");
    expect(await priceOf(f.admin, tomates.id)).toMatchObject({ amount: "9.90", refQty: "1", refUnit: "kg", source: "base", basis: { kind: "observed", observedOn: "2026-10-01" } });
    // la famille personnalise
    const put = await app.inject({ method: "PUT", url: `/api/products/${tomates.id}/price`, cookies: f.admin, payload: { amount: "11,5", refQty: 1, refUnit: "kg" } });
    expect(put.statusCode).toBe(200);
    expect(await priceOf(f.admin, tomates.id)).toMatchObject({ amount: "11.50", source: "family" });
    expect(await priceOf(g.admin, g.products["Tomates"].id)).toMatchObject({ amount: "9.90", source: "base" }); // l'autre famille garde la base
    // une nouvelle importation de la base ne touche pas le prix personnalisé
    await base(key, "8.00");
    expect(await priceOf(f.admin, tomates.id)).toMatchObject({ amount: "11.50", source: "family" });
    expect(await priceOf(g.admin, g.products["Tomates"].id)).toMatchObject({ amount: "8.00", source: "base" });
    // « Rétablir le prix initial »
    await app.inject({ method: "DELETE", url: `/api/products/${tomates.id}/price`, cookies: f.admin });
    expect(await priceOf(f.admin, tomates.id)).toMatchObject({ amount: "8.00", source: "base" });
  });

  it("seuls les administrateurs modifient les prix ; entrées invalides refusées ; le personnel lit les prix", async () => {
    const f = await family();
    const staff = await f.add("marie", "staff");
    const parent = await f.add("lamiaa", "parent");
    const id = f.products["Tomates"].id;
    const body = { amount: "9.90", refQty: 1, refUnit: "kg" };
    expect((await app.inject({ method: "PUT", url: `/api/products/${id}/price`, cookies: staff, payload: body })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: `/api/products/${id}/price`, cookies: parent, payload: body })).statusCode).toBe(403);
    for (const bad of [{ ...body, amount: "0" }, { ...body, amount: "9.999" }, { ...body, amount: "abc" }, { ...body, refQty: 0 }, { ...body, refUnit: "tonne" }, { ...body, refUnit: "g", refQty: 0.5 }, { ...body, amount: "-3" }]) {
      expect([JSON.stringify(bad), (await app.inject({ method: "PUT", url: `/api/products/${id}/price`, cookies: f.admin, payload: bad })).statusCode]).toEqual([JSON.stringify(bad), 400]);
    }
    expect((await app.inject({ method: "PUT", url: `/api/products/${id}/price`, cookies: f.admin, payload: body })).statusCode).toBe(200);
    expect(await priceOf(staff, id)).toMatchObject({ amount: "9.90" });
    // produit d'une autre famille : introuvable
    const g = await family();
    expect((await app.inject({ method: "PUT", url: `/api/products/${g.products["Tomates"].id}/price`, cookies: f.admin, payload: body })).statusCode).toBe(404);
  });

  it("préférences : désactivées par défaut, propres à chaque profil, les montants impliquent les prix", async () => {
    const f = await family();
    const lam = await f.add("lamiaa", "parent");
    const me = async (c: any) => (await app.inject({ method: "GET", url: "/api/me", cookies: c })).json().me.prefs;
    expect(await me(f.admin)).toEqual({ showPrices: false, showTotals: false, rev: 0 });
    const r = await app.inject({ method: "PUT", url: "/api/me/prefs", cookies: f.admin, payload: { showPrices: false, showTotals: true } });
    expect(r.json().prefs).toMatchObject({ showPrices: true, showTotals: true });
    expect(await me(f.admin)).toMatchObject({ showPrices: true, showTotals: true });
    expect(await me(lam)).toEqual({ showPrices: false, showTotals: false, rev: 0 }); // l'autre profil est inchangé
    await app.inject({ method: "PUT", url: "/api/me/prefs", cookies: lam, payload: { showPrices: true, showTotals: false } });
    expect(await me(lam)).toMatchObject({ showPrices: true, showTotals: false });
    expect(await me(f.admin)).toMatchObject({ showPrices: true, showTotals: true });
  });

  it("le prix de référence est figé à la validation ; une liste archivée garde le sien ; la réévaluation est explicite", async () => {
    const f = await family();
    const tomates = f.products["Tomates"];
    const lait = f.products["Lait"];
    const key = (await db.query("SELECT catalog_key FROM products WHERE id = $1", [tomates.id])).rows[0].catalog_key;
    await base(key, "9.90");
    const list = (await app.inject({ method: "POST", url: "/api/lists", cookies: f.admin })).json().list;
    const ops = (await import("node:crypto")).randomUUID;
    const post = (cookies: any, body: object) => app.inject({ method: "POST", url: `/api/lists/${list.id}/ops`, cookies, payload: body });
    const r = await post(f.admin, { ops: [{ opId: ops(), type: "add", productId: tomates.id, quantity: 0.25 }, { opId: ops(), type: "add", productId: lait.id }] });
    const item = (id: string) => r2.items.find((i: any) => i.productId === id);
    let r2 = r.json().list;
    expect(item(tomates.id)).toMatchObject({ price: { amount: "9.90", refUnit: "kg", source: "base" }, priceFrozen: true, quantity: 0.25 });
    expect(item(lait.id)).toMatchObject({ price: null, priceFrozen: true }); // aucun prix à la validation : jamais zéro
    // le prix change ensuite : la ligne validée garde le sien jusqu'à une réévaluation explicite
    await app.inject({ method: "PUT", url: `/api/products/${tomates.id}/price`, cookies: f.admin, payload: { amount: "12", refQty: 1, refUnit: "kg" } });
    r2 = (await app.inject({ method: "GET", url: "/api/lists/active", cookies: f.admin })).json().list;
    expect(item(tomates.id).price.amount).toBe("9.90");
    const rep = await app.inject({ method: "POST", url: `/api/lists/${list.id}/reprice`, cookies: f.admin });
    expect(rep.statusCode).toBe(200);
    r2 = rep.json().list;
    expect(item(tomates.id).price).toMatchObject({ amount: "12.00", source: "family" });
    // clôture : le prix reste celui de la liste, même si le prix change ensuite ; une liste archivée ne se réévalue pas
    expect((await app.inject({ method: "POST", url: `/api/lists/${list.id}/close`, cookies: f.admin })).statusCode).toBe(200);
    await app.inject({ method: "PUT", url: `/api/products/${tomates.id}/price`, cookies: f.admin, payload: { amount: "20", refQty: 1, refUnit: "kg" } });
    r2 = (await app.inject({ method: "GET", url: `/api/lists/${list.id}`, cookies: f.admin })).json().list;
    expect(item(tomates.id).price.amount).toBe("12.00");
    expect((await app.inject({ method: "POST", url: `/api/lists/${list.id}/reprice`, cookies: f.admin })).statusCode).toBe(409);
  });

  it("litre : unité acceptée avec des quantités décimales ; les unités existantes ne changent pas", async () => {
    const f = await family();
    const lait = f.products["Lait"];
    const before = lait.unit;
    const p = await app.inject({ method: "PATCH", url: `/api/products/${lait.id}`, cookies: f.admin, payload: { unit: "litre" } });
    expect(p.statusCode).toBe(200);
    const list = (await app.inject({ method: "POST", url: "/api/lists", cookies: f.admin })).json().list;
    const op = { opId: (await import("node:crypto")).randomUUID(), type: "add", productId: lait.id, quantity: 1.25 };
    const r = await app.inject({ method: "POST", url: `/api/lists/${list.id}/ops`, cookies: f.admin, payload: { ops: [op] } });
    expect(r.json().results[0].status).toBe("applied");
    expect(r.json().list.items[0]).toMatchObject({ unit: "litre", quantity: 1.25 });
    expect(before).not.toBe("litre");
  });
});

describe("import de la base initiale : lignes retenues et exclues", () => {
  const csv = (rows: string[]) =>
    ["cle_stable;origine;produit_observe;montant;quantite_reference;unite_reference;conditionnement;poids_piece_g;nature;source;date_capture;statut;remise_conditionnelle;valide_pour_generique;remarque", ...rows].join("\n");
  const idx = new Map<string, "initial" | "extended">([["tomates", "initial"], ["nettoyant-sol", "initial"], ["dinde", "extended"], ["riz", "initial"], ["the", "initial"], ["lait", "initial"], ["cafe", "initial"]]);
  const run = (rows: string[]) => classify(parseCsv(csv(rows)), idx);
  const S = "capture magasin A";
  it("retient une ligne confirmée, complète et générique", () => {
    const [r] = run([`tomates;initial;Tomates rondes;9,90;1;kg;;;observation;${S};2026-10-01;confirmé;non;;`]);
    expect(r!.retained).toBe(true);
    expect(r!.row).toMatchObject({ key: "tomates", amount: "9.90", refQty: "1", refUnit: "kg", kind: "observed", observedOn: "2026-10-01" });
  });
  it("exclut : à confirmer, format incomplet, clé inconnue, remise conditionnelle, nettoyant sol, brochettes de dinde, basmati", () => {
    const rows = run([
      `tomates;initial;Tomates;9,90;1;kg;;;observation;${S};2026-10-01;à confirmer;non;;`,
      `the;initial;Thé;14;1;paquet;;;observation;${S};2026-10-01;confirmé;non;;`, // paquet sans contenu de référence
      `lait;initial;Lait;;1;litre;;;observation;${S};2026-10-01;confirmé;non;;`, // montant absent
      `inconnu;initial;X;5;1;kg;;;observation;${S};2026-10-01;confirmé;non;;`,
      `cafe;initial;Café;40;1;paquet;250 g;;observation;${S};2026-10-01;confirmé;oui;;cashback 5 DH`,
      `nettoyant-sol;initial;Nettoyant four;32,20;500;ml;;;observation;${S};2026-10-01;confirmé;non;;`,
      `dinde;extended;Brochettes de dinde;85;1;kg;;;observation;${S};2026-10-01;confirmé;non;;`,
      `riz;initial;Riz basmati;24;1;kg;;;observation;${S};2026-10-01;confirmé;non;;`,
    ]);
    expect(rows.every((r) => !r.retained)).toBe(true);
    expect(rows[0]!.reasons.join()).toContain("à confirmer");
    expect(rows[1]!.reasons.join()).toContain("contenu de référence");
    expect(rows[2]!.reasons.join()).toContain("montant");
    expect(rows[3]!.reasons.join()).toContain("inconnue du catalogue");
    expect(rows[4]!.reasons.join()).toContain("cashback");
    expect(rows[5]!.reasons.join()).toContain("nettoyant sol");
    expect(rows[6]!.reasons.join()).toContain("générique");
    expect(rows[7]!.reasons.join()).toContain("générique");
  });
  it("un riz ou une dinde ne sont retenus que sur validation spécifique du produit générique", () => {
    const [ok] = run([`riz;initial;Riz basmati;24;1;kg;;;observation;${S};2026-10-01;confirmé;non;oui;validé pour le riz générique`]);
    expect(ok!.retained).toBe(true);
  });
  it("distingue observation, prix moyen et prix arrondi", () => {
    const k = run([
      `tomates;initial;T;9,90;1;kg;;;moyen;moyenne de 3 magasins;2026-10-01;confirmé;non;;`,
      `tomates;initial;T;10;1;kg;;;arrondi;arrondi proposé;2026-10-01;confirmé;non;;`,
    ]).map((r) => r.row!.kind);
    expect(k).toEqual(["average", "rounded"]);
  });
});
