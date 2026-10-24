import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { SseHub } from "../src/hub.js";
import { statsClock } from "../src/stats-routes.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

/**
 * Statistiques : liste complète des produits achetés (au-delà de l'aperçu), historique détaillé d'un produit sur la période ou sur
 * tout l'historique, unités jamais additionnées entre elles, date réelle d'achat, isolation entre familles.
 */
let db: Db;
let app: FastifyInstance;
let n = 0;
type Cookies = Record<string, string>;

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, hub: new SseHub(), store: testStore(), loginRateLimit: { max: 10_000, timeWindow: "1 minute" } });
  await app.ready();
});
const realNow = statsClock.now;
afterEach(() => { statsClock.now = realNow; });
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });

async function newFamily() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `S${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const familyCode = res.json().familyCode as string;
  const adil = cookieOf(res);
  await app.inject({ method: "POST", url: "/api/profiles", cookies: adil, payload: { displayName: "Marie", login: "marie", role: "staff", secret: "573918", secretConfirm: "573918" } });
  const marie = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login: "marie", secret: "573918" } }));
  const products: Record<string, string> = {};
  for (const c of (await app.inject({ method: "GET", url: "/api/catalog", cookies: adil })).json().categories) for (const p of c.products) products[p.name] = p.id;
  const familyId = (await db.query("SELECT id FROM families WHERE code = $1", [familyCode])).rows[0].id as string;
  return { familyId, adil, marie, products };
}
type F = Awaited<ReturnType<typeof newFamily>>;

const send = (cookies: Cookies, listId: string, ops: object[], batch?: { id: string; at?: string }) =>
  app.inject({ method: "POST", url: `/api/lists/${listId}/ops`, cookies, payload: { ops, ...(batch ? { batch } : {}) } });
const activeList = async (f: F) =>
  ((await db.query("SELECT id FROM lists WHERE family_id = $1 AND status = 'active'", [f.familyId])).rows[0]?.id as string | undefined) ??
  ((await app.inject({ method: "POST", url: "/api/lists", cookies: f.adil })).json().list.id as string);

/** One purchase of `name` (quantity in the product's unit), dated `when`. */
async function buy(f: F, name: string, qty: number, when: string) {
  const listId = await activeList(f);
  const pid = f.products[name]!;
  const r = (await send(f.marie, listId, [{ opId: randomUUID(), type: "add", productId: pid, quantity: qty }])).json().results[0];
  if (r.reason === "already_purchased") await send(f.marie, listId, [{ opId: randomUUID(), type: "request_again", productId: pid, quantity: qty }]);
  const item = (await db.query("SELECT id FROM list_items WHERE list_id = $1 AND product_id = $2 AND status = 'to_buy'", [listId, pid])).rows[0].id as string;
  const pr = (await send(f.adil, listId, [{ opId: randomUUID(), type: "purchase", itemId: item }])).json().results[0];
  if (pr.status !== "applied") throw new Error(JSON.stringify(pr));
  await db.query("UPDATE purchases SET purchased_at = $2 WHERE list_item_id = $1 AND voided_at IS NULL", [item, when]);
  return { listId, itemId: item };
}
const get = async (c: Cookies, url: string) => app.inject({ method: "GET", url, cookies: c });

describe("statistiques : tous les produits achetés et historique d'un produit", () => {
  it("la liste complète contient les produits au-delà du huitième, classés par achats puis par nom ; le détail suit la période ou tout l'historique", async () => {
    statsClock.now = () => new Date("2026-10-20T12:00:00Z");
    const f = await newFamily();
    // Neuf produits achetés deux fois, puis Cumin une seule fois : Cumin est 10e (hors de l'aperçu de huit).
    const top = ["Tomates", "Lait", "Oignons", "Carottes", "Pommes", "Bananes", "Œufs", "Sucre", "Farine"];
    for (const [i, name] of top.entries()) {
      await buy(f, name, 1, `2026-10-0${1 + (i % 8)}T10:00:00Z`);
      await buy(f, name, 1, `2026-10-1${i % 9}T10:00:00Z`);
    }
    await buy(f, "Cumin", 0.25, "2026-10-15T09:30:00Z");
    await buy(f, "Cumin", 0.5, "2026-08-10T09:30:00Z"); // août : hors de la période « Ce mois »

    const s = (await get(f.adil, "/api/stats/purchases?period=month")).json();
    expect(s.rows).toHaveLength(10);
    expect(s.rows.slice(0, 9).map((r: any) => r.name)).toEqual([...top].sort((a, b) => a.localeCompare(b, "fr"))); // égalité : ordre alphabétique
    expect(s.rows[9]).toMatchObject({ name: "Cumin", purchases: 1, units: [{ unit: "kg", purchases: 1, quantity: 0.25 }] });
    // Recherche serveur sans accents ni majuscules (la liste de l'application filtre aussi la liste complète localement)
    expect((await get(f.adil, "/api/stats/purchases?period=month&q=CUMÍN")).json().rows.map((r: any) => r.name)).toEqual(["Cumin"]);
    expect((await get(f.adil, "/api/stats/purchases?period=month&q=oeu")).json().rows.map((r: any) => r.name)).toEqual(["Œufs"]);

    // Détail : période choisie, puis tout l'historique
    const id = f.products["Cumin"]!;
    const month = (await get(f.adil, `/api/stats/products/${id}?period=month`)).json();
    expect(month.summary).toMatchObject({ purchases: 1, units: [{ unit: "kg", purchases: 1, quantity: 0.25 }] });
    expect(month.purchases.map((p: any) => [p.at, p.quantity, p.unit])).toEqual([["2026-10-15T09:30:00.000Z", 0.25, "kg"]]);
    expect(month.window).toMatchObject({ fromDay: "2026-10-01", toDay: "2026-10-20" });
    expect(month.truncated).toBe(false);
    const all = (await get(f.adil, `/api/stats/products/${id}?period=all`)).json();
    expect(all.period).toBe("all");
    expect(all.summary).toMatchObject({ purchases: 2, units: [{ unit: "kg", purchases: 2, quantity: 0.75 }] });
    expect(all.purchases.map((p: any) => p.at)).toEqual(["2026-10-15T09:30:00.000Z", "2026-08-10T09:30:00.000Z"]); // plus récent d'abord
    // « Tout l'historique » n'a rien à comparer
    expect((await get(f.adil, "/api/stats/purchases?period=all")).json().comparison.available).toBe(false);
    expect((await get(f.adil, "/api/stats/purchases?period=all")).json().rows.find((r: any) => r.name === "Cumin").purchases).toBe(2);
  });

  it("plusieurs achats du même produit : dates, quantités, nom de la liste ; un changement d'unité n'additionne rien et ne modifie pas les anciens achats", async () => {
    statsClock.now = () => new Date("2026-10-20T12:00:00Z");
    const f = await newFamily();
    const a = await buy(f, "Riz", 1.5, "2026-10-02T10:00:00Z");
    await buy(f, "Riz", 0.5, "2026-10-09T10:00:00Z");
    await db.query("UPDATE lists SET name = 'Grandes courses' WHERE id = $1", [a.listId]);
    // L'administrateur passe le riz en paquets : l'achat suivant est en paquets, les anciens restent en kg.
    expect((await app.inject({ method: "PATCH", url: `/api/products/${f.products["Riz"]}`, cookies: f.adil, payload: { unit: "paquet" } })).json().product.unit).toBe("paquet");
    await buy(f, "Riz", 2, "2026-10-12T10:00:00Z");
    const d = (await get(f.adil, `/api/stats/products/${f.products["Riz"]}?period=month`)).json();
    expect(d.summary.purchases).toBe(3);
    expect(d.summary.units.map((u: any) => [u.unit, u.purchases, u.quantity])).toEqual([["kg", 2, 2], ["paquet", 1, 2]]);
    expect(JSON.stringify(d.summary)).not.toMatch(/"quantity":4/); // 2 kg et 2 paquets ne font jamais « 4 »
    expect(d.purchases.map((p: any) => [p.at.slice(0, 10), p.quantity, p.unit, p.list.name])).toEqual([
      ["2026-10-12", 2, "paquet", "Grandes courses"],
      ["2026-10-09", 0.5, "kg", "Grandes courses"],
      ["2026-10-02", 1.5, "kg", "Grandes courses"],
    ]);
    const row = (await get(f.adil, "/api/stats/purchases?period=month")).json().rows.find((r: any) => r.name === "Riz");
    expect(row.units.map((u: any) => [u.unit, u.quantity])).toEqual([["kg", 2], ["paquet", 2]]);
  });

  it("un produit retiré du catalogue reste consultable ; un achat corrigé ne compte pas ; une nouvelle tentative réseau ne compte pas deux fois", async () => {
    statsClock.now = () => new Date("2026-10-20T12:00:00Z");
    const f = await newFamily();
    const { listId, itemId } = await buy(f, "Lait", 2, "2026-10-05T10:00:00Z");
    // Renvoi de la même opération d'achat (même opId) : rejouée, jamais un second achat
    const again = { opId: randomUUID(), type: "purchase", itemId };
    await send(f.adil, listId, [again]);
    await send(f.adil, listId, [again]);
    expect((await db.query("SELECT count(*)::int AS n FROM purchases WHERE list_item_id = $1", [itemId])).rows[0].n).toBe(1);
    // Achat corrigé : hors de tous les chiffres
    const second = await buy(f, "Tomates", 1, "2026-10-06T10:00:00Z");
    const pu = (await db.query("SELECT id FROM purchases WHERE list_item_id = $1", [second.itemId])).rows[0].id as string;
    await send(f.adil, listId, [{ opId: randomUUID(), type: "correct", purchaseId: pu }]);
    // Produit désactivé : historique intact
    await app.inject({ method: "PATCH", url: `/api/products/${f.products["Lait"]}`, cookies: f.adil, payload: { active: false } });
    const s = (await get(f.adil, "/api/stats/purchases?period=month")).json();
    expect(s.rows.map((r: any) => [r.name, r.purchases, r.active])).toEqual([["Lait", 1, false]]);
    expect((await get(f.adil, `/api/stats/products/${f.products["Lait"]}?period=all`)).json().summary.purchases).toBe(1);
    expect((await get(f.adil, `/api/stats/products/${f.products["Tomates"]}?period=all`)).json().summary.purchases).toBe(0);
  });

  it("date réelle d'achat : l'heure où « Acheté » a été coché sur le téléphone, même envoyé plus tard", async () => {
    const f = await newFamily();
    const listId = await activeList(f);
    await send(f.marie, listId, [{ opId: randomUUID(), type: "add", productId: f.products["Lait"]!, quantity: 1 }]);
    const item = (await db.query("SELECT id FROM list_items WHERE list_id = $1", [listId])).rows[0].id as string;
    const ticked = new Date(Date.now() - 3 * 3600_000).toISOString(); // coché hors connexion il y a trois heures
    await send(f.adil, listId, [{ opId: randomUUID(), type: "purchase", itemId: item }], { id: randomUUID(), at: ticked });
    const at = (await db.query("SELECT purchased_at FROM purchases WHERE list_item_id = $1", [item])).rows[0].purchased_at as Date;
    expect(at.toISOString()).toBe(ticked);
  });

  it("une famille n'accède jamais aux statistiques ni à l'historique d'une autre ; le personnel n'y a pas accès", async () => {
    statsClock.now = () => new Date("2026-10-20T12:00:00Z");
    const a = await newFamily();
    const b = await newFamily();
    await buy(a, "Cumin", 0.25, "2026-10-05T10:00:00Z");
    expect((await get(b.adil, `/api/stats/products/${a.products["Cumin"]}?period=all`)).statusCode).toBe(404);
    expect((await get(b.adil, "/api/stats/purchases?period=all")).json().rows).toHaveLength(0);
    expect((await get(a.marie, `/api/stats/products/${a.products["Cumin"]}?period=all`)).statusCode).toBe(403);
    expect((await get(a.adil, `/api/stats/products/${a.products["Cumin"]}?period=forever`)).statusCode).toBe(400);
  });
});
