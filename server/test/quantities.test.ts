import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import { createPool, type Db } from "../src/db.js";
import { SseHub } from "../src/hub.js";
import { MIGRATIONS_DIR, migrate } from "../src/migrate.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

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
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });

async function newFamily() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `Q${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const familyCode = res.json().familyCode as string;
  const adil = cookieOf(res);
  const mk = async (role: string, login: string, display: string) => {
    await app.inject({ method: "POST", url: "/api/profiles", cookies: adil, payload: { displayName: display, login, role, secret: "573918" } });
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login, secret: "573918" } }));
  };
  const lamiaa = await mk("parent", "lamiaa", "Lamiaa");
  const marie = await mk("staff", "marie", "Marie");
  const products: Record<string, string> = {};
  const units: Record<string, string> = {};
  for (const c of (await app.inject({ method: "GET", url: "/api/catalog", cookies: adil })).json().categories) for (const p of c.products) (products[p.name] = p.id), (units[p.name] = p.unit);
  const familyId = (await db.query("SELECT id FROM families WHERE code = $1", [familyCode])).rows[0].id as string;
  const list = (await app.inject({ method: "POST", url: "/api/lists", cookies: lamiaa })).json().list.id as string;
  return { familyCode, familyId, adil, lamiaa, marie, products, units, list };
}
type F = Awaited<ReturnType<typeof newFamily>>;

const op = {
  add: (productId: string, quantity?: number) => ({ opId: randomUUID(), type: "add", productId, ...(quantity !== undefined ? { quantity } : {}) }),
  setQty: (productId: string, quantity: number, baseRev: number) => ({ opId: randomUUID(), type: "set_qty", productId, quantity, baseRev }),
  again: (productId: string, quantity?: number) => ({ opId: randomUUID(), type: "request_again", productId, ...(quantity !== undefined ? { quantity } : {}) }),
  remove: (productId: string, baseRev: number) => ({ opId: randomUUID(), type: "remove", productId, baseRev }),
  purchase: (itemId: string) => ({ opId: randomUUID(), type: "purchase", itemId }),
  correct: (purchaseId: string) => ({ opId: randomUUID(), type: "correct", purchaseId }),
};
const send = (cookies: Cookies, listId: string, ops: object[], batch?: { id: string; at?: string }) => app.inject({ method: "POST", url: `/api/lists/${listId}/ops`, cookies, payload: { ops, ...(batch ? { batch } : {}) } });
const one = async (cookies: Cookies, listId: string, o: object) => (await send(cookies, listId, [o])).json().results[0];
const view = async (cookies: Cookies) => (await app.inject({ method: "GET", url: "/api/lists/active", cookies })).json().list;
const lines = (list: any, productId: string) => list.items.filter((i: any) => i.productId === productId);

describe("unités et quantités", () => {
  it("chaque produit a une unité ; l'ajout sans quantité vaut 1 ; les kg acceptent les décimales, pas les autres unités", async () => {
    const f = await newFamily();
    expect(f.units["Tomates"]).toBe("kg");
    expect(f.units["Persil"]).toBe("paquet");
    expect(f.units["Lait"]).toBe("piece");
    expect((await one(f.marie, f.list, op.add(f.products["Lait"]!))).status).toBe("applied");
    expect((await one(f.marie, f.list, op.add(f.products["Tomates"]!, 1.5))).status).toBe("applied");
    expect((await one(f.marie, f.list, op.add(f.products["Persil"]!, 2.5))).reason).toBe("bad_quantity");
    const v = await view(f.adil);
    expect(lines(v, f.products["Lait"]!)[0]).toMatchObject({ quantity: 1, unit: "piece" });
    expect(lines(v, f.products["Tomates"]!)[0]).toMatchObject({ quantity: 1.5, unit: "kg" });
    expect(lines(v, f.products["Persil"]!)).toHaveLength(0);
  });

  it("une quantité nulle, négative ou énorme est refusée par le serveur", async () => {
    const f = await newFamily();
    for (const q of [0, -2, 1000]) expect((await send(f.marie, f.list, [op.add(f.products["Lait"]!, q)])).statusCode).toBe(400);
    expect((await view(f.adil)).items).toHaveLength(0);
  });

  it("l'unité d'un produit est configurable par l'administrateur seulement ; elle ne change pas les lignes déjà demandées", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Lait"]!, 2));
    expect((await app.inject({ method: "PATCH", url: `/api/products/${f.products["Lait"]}`, cookies: f.lamiaa, payload: { unit: "bouteille" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/api/products/${f.products["Lait"]}`, cookies: f.adil, payload: { unit: "bouteille" } })).json().product.unit).toBe("bouteille");
    expect((await app.inject({ method: "PATCH", url: `/api/products/${f.products["Lait"]}`, cookies: f.adil, payload: { unit: "litre" } })).statusCode).toBe(400);
    expect(lines(await view(f.adil), f.products["Lait"]!)[0]).toMatchObject({ quantity: 2, unit: "piece" });
  });
});

describe("ajustement de quantité et modifications simultanées", () => {
  it("set_qty change la quantité, journalise l'ancienne et la nouvelle valeur avec l'auteur", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Lait"]!, 2));
    const item = lines(await view(f.adil), f.products["Lait"]!)[0];
    const r = await one(f.lamiaa, f.list, op.setQty(f.products["Lait"]!, 5, item.rev));
    expect(r.status).toBe("applied");
    const v = await view(f.adil);
    expect(lines(v, f.products["Lait"]!)[0]).toMatchObject({ quantity: 5, lastChange: { kind: "qty", before: 2, after: 5, by: { displayName: "Lamiaa" } } });
    expect(v.events.map((e: any) => [e.kind, e.before, e.after, e.by.displayName])).toEqual([["add", null, 2, "Marie"], ["qty", 2, 5, "Lamiaa"]]);
  });

  it("deux modifications simultanées sur la même révision : une seule s'applique, l'autre est refusée avec la valeur actuelle (rien n'est écrasé)", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Lait"]!, 2));
    const item = lines(await view(f.adil), f.products["Lait"]!)[0];
    const rs = await Promise.all([one(f.lamiaa, f.list, op.setQty(f.products["Lait"]!, 3, item.rev)), one(f.marie, f.list, op.setQty(f.products["Lait"]!, 6, item.rev))]);
    expect(rs.map((r) => r.status).sort()).toEqual(["applied", "rejected"]);
    const lost = rs.find((r) => r.status === "rejected");
    expect(lost.reason).toBe("stale");
    const final = lines(await view(f.adil), f.products["Lait"]!)[0].quantity;
    expect(lost.detail.quantity).toBe(final); // la personne refusée apprend la valeur en vigueur
    expect([3, 6]).toContain(final);
  });

  it("un membre du personnel apprend la quantité actuelle mais pas le nom de l'auteur du changement", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Lait"]!, 2));
    const item = lines(await view(f.adil), f.products["Lait"]!)[0];
    await one(f.lamiaa, f.list, op.setQty(f.products["Lait"]!, 4, item.rev));
    const stale = await one(f.marie, f.list, op.setQty(f.products["Lait"]!, 9, item.rev));
    expect(stale).toMatchObject({ status: "rejected", reason: "stale", detail: { quantity: 4, unit: "piece" } });
    expect(stale.detail.lastBy).toBeUndefined();
    const parent = await one(f.adil, f.list, op.setQty(f.products["Lait"]!, 9, item.rev));
    expect(parent.detail.lastBy.displayName).toBe("Lamiaa");
  });

  it("la même valeur sur une révision dépassée n'est pas une erreur ; un retrait sur une révision dépassée est refusé", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Lait"]!, 2));
    const item = lines(await view(f.adil), f.products["Lait"]!)[0];
    await one(f.lamiaa, f.list, op.setQty(f.products["Lait"]!, 4, item.rev));
    expect((await one(f.marie, f.list, op.setQty(f.products["Lait"]!, 4, item.rev))).status).toBe("already");
    expect((await one(f.marie, f.list, op.remove(f.products["Lait"]!, item.rev))).reason).toBe("stale");
    expect(lines(await view(f.adil), f.products["Lait"]!)).toHaveLength(1);
  });

  it("rejouer la même opération (resynchronisation) ne double ni la quantité ni le journal", async () => {
    const f = await newFamily();
    const add = op.add(f.products["Tomates"]!, 2);
    await send(f.marie, f.list, [add]);
    await send(f.marie, f.list, [add]);
    const item = lines(await view(f.adil), f.products["Tomates"]!)[0];
    const set = op.setQty(f.products["Tomates"]!, 3, item.rev);
    const a = await one(f.marie, f.list, set);
    const b = await one(f.marie, f.list, set);
    expect(a.status).toBe("applied");
    expect(b).toMatchObject({ status: "applied", replay: true });
    const v = await view(f.adil);
    expect(lines(v, f.products["Tomates"]!)[0].quantity).toBe(3);
    expect(v.events).toHaveLength(2);
  });
});

describe("doublons et articles déjà achetés", () => {
  it("ajouter un produit déjà présent ne crée pas de doublon : la quantité actuelle est renvoyée et rien ne change", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Lait"]!, 3));
    const r = await one(f.lamiaa, f.list, op.add(f.products["Lait"]!, 1));
    expect(r).toMatchObject({ status: "already", detail: { quantity: 3, unit: "piece" } });
    const v = await view(f.adil);
    expect(lines(v, f.products["Lait"]!)).toHaveLength(1);
    expect(lines(v, f.products["Lait"]!)[0].quantity).toBe(3);
  });

  it("un article acheté n'est jamais remis à acheter par un simple ajout ; la demande doit être explicite et crée une NOUVELLE ligne", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Lait"]!, 2));
    const first = lines(await view(f.adil), f.products["Lait"]!)[0];
    await one(f.adil, f.list, op.purchase(first.id));
    const plain = await one(f.marie, f.list, op.add(f.products["Lait"]!, 1));
    expect(plain).toMatchObject({ status: "rejected", reason: "already_purchased", detail: { quantity: 2, unit: "piece" } });
    expect(plain.detail.purchasedBy).toBeUndefined(); // personnel : pas de nom
    expect(lines(await view(f.adil), f.products["Lait"]!)).toHaveLength(1);

    const again = await one(f.marie, f.list, op.again(f.products["Lait"]!, 4));
    expect(again.status).toBe("applied");
    const v = await view(f.adil);
    const ls = lines(v, f.products["Lait"]!);
    expect(ls.map((l: any) => [l.status, l.quantity]).sort()).toEqual([["purchased", 2], ["to_buy", 4]]);
    expect(ls.find((l: any) => l.status === "purchased").purchase.by.displayName).toBe("Adil");
    expect(v.events.map((e: any) => e.kind)).toEqual(["add", "request_again"]);
    // une deuxième demande ne crée pas de troisième ligne
    expect(await one(f.lamiaa, f.list, op.again(f.products["Lait"]!, 9))).toMatchObject({ status: "already", detail: { quantity: 4 } });
    expect(lines(await view(f.adil), f.products["Lait"]!)).toHaveLength(2);
  });

  it("request_again sur un produit jamais acheté est refusé (il faut « add »)", async () => {
    const f = await newFamily();
    expect((await one(f.marie, f.list, op.again(f.products["Lait"]!))).reason).toBe("item_unknown");
  });

  it("la ligne achetée reste verrouillée ; la nouvelle ligne se modifie et se retire normalement", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Lait"]!, 2));
    await one(f.adil, f.list, op.purchase(lines(await view(f.adil), f.products["Lait"]!)[0].id));
    expect((await one(f.marie, f.list, op.setQty(f.products["Lait"]!, 5, 2))).reason).toBe("locked_purchased");
    await one(f.marie, f.list, op.again(f.products["Lait"]!, 1));
    const open = lines(await view(f.adil), f.products["Lait"]!).find((l: any) => l.status === "to_buy");
    expect((await one(f.lamiaa, f.list, op.setQty(f.products["Lait"]!, 3, open.rev))).status).toBe("applied");
    const open2 = lines(await view(f.adil), f.products["Lait"]!).find((l: any) => l.status === "to_buy");
    expect((await one(f.lamiaa, f.list, op.remove(f.products["Lait"]!, open2.rev))).status).toBe("applied");
    const left = lines(await view(f.adil), f.products["Lait"]!);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ status: "purchased", quantity: 2 });
  });

  it("corriger un achat quand une nouvelle demande existe : les quantités se regroupent sur la ligne ouverte (une seule ligne ouverte par produit)", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Lait"]!, 2));
    const bought = lines(await view(f.adil), f.products["Lait"]!)[0];
    await one(f.adil, f.list, op.purchase(bought.id));
    await one(f.marie, f.list, op.again(f.products["Lait"]!, 3));
    const pid = (await view(f.adil)).items.find((i: any) => i.id === bought.id).purchase.id;
    const r = await one(f.lamiaa, f.list, op.correct(pid));
    expect(r.status).toBe("applied");
    const ls = lines(await view(f.adil), f.products["Lait"]!);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ status: "to_buy", quantity: 5 });
    const inv = await db.query(`SELECT count(*)::int AS n FROM list_items i WHERE (i.status = 'purchased') <> EXISTS (SELECT 1 FROM purchases p WHERE p.list_item_id = i.id AND p.voided_at IS NULL)`);
    expect(inv.rows[0].n).toBe(0);
  });

  it("l'achat fige produit, quantité et unité", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Tomates"]!, 2.5));
    await one(f.adil, f.list, op.purchase(lines(await view(f.adil), f.products["Tomates"]!)[0].id));
    await app.inject({ method: "PATCH", url: `/api/products/${f.products["Tomates"]}`, cookies: f.adil, payload: { unit: "piece", name: "Tomates cerises" } });
    const pu = (await db.query("SELECT product_id, quantity, unit FROM purchases WHERE family_id = $1", [f.familyId])).rows[0];
    expect(pu).toMatchObject({ product_id: f.products["Tomates"], unit: "kg" });
    expect(Number(pu.quantity)).toBe(2.5);
  });
});

describe("validations successives (date, heure, auteur)", () => {
  it("5 articles à 08:00 puis 3 à 14:00 : deux validations distinctes, l'heure du premier ajout n'est jamais écrasée", async () => {
    const f = await newFamily();
    const morning = new Date(Date.now() - 6 * 3_600_000);
    const noon = new Date(Date.now() - 1 * 3_600_000);
    const names1 = ["Lait", "Sucre", "Riz", "Œufs", "Tomates"];
    const names2 = ["Oignons", "Carottes", "Bananes"];
    const b1 = { id: randomUUID(), at: morning.toISOString() };
    const b2 = { id: randomUUID(), at: noon.toISOString() };
    expect((await send(f.marie, f.list, names1.map((x) => op.add(f.products[x]!)), b1)).statusCode).toBe(200);
    expect((await send(f.lamiaa, f.list, names2.map((x) => op.add(f.products[x]!)), b2)).statusCode).toBe(200);
    const v = await view(f.adil);
    expect(v.validations.map((x: any) => [x.by.displayName, new Date(x.at).getTime()])).toEqual([["Marie", morning.getTime()], ["Lamiaa", noon.getTime()]]);
    const group = (id: string) => v.events.filter((e: any) => e.validationId === id).map((e: any) => e.name).sort();
    expect(group(b1.id)).toEqual([...names1].sort());
    expect(group(b2.id)).toEqual([...names2].sort());
    // chaque ligne garde l'heure et l'auteur de SON ajout
    expect(new Date(lines(v, f.products["Lait"]!)[0].addedAt).getTime()).toBe(morning.getTime());
    expect(lines(v, f.products["Oignons"]!)[0]).toMatchObject({ addedBy: { displayName: "Lamiaa" } });
    expect(new Date(lines(v, f.products["Oignons"]!)[0].addedAt).getTime()).toBe(noon.getTime());
    // modifier une quantité l'après-midi n'écrase pas l'heure d'ajout du matin : c'est un événement de plus
    const lait = lines(v, f.products["Lait"]!)[0];
    await send(f.lamiaa, f.list, [op.setQty(f.products["Lait"]!, 4, lait.rev)], b2);
    const v2 = await view(f.adil);
    const l2 = lines(v2, f.products["Lait"]!)[0];
    expect(new Date(l2.addedAt).getTime()).toBe(morning.getTime());
    expect(l2.lastChange).toMatchObject({ kind: "qty", before: 1, after: 4, by: { displayName: "Lamiaa" } });
    expect(new Date(l2.lastChange.at).getTime()).toBe(noon.getTime());
    expect(v2.validations).toHaveLength(2); // la 2e validation s'est enrichie, il n'y en a pas de nouvelle
  });

  it("une heure d'appareil absurde (futur, ou plus de 30 jours) est remplacée par l'heure du serveur ; une validation hors connexion récente est conservée", async () => {
    const f = await newFamily();
    const before = Date.now();
    await send(f.marie, f.list, [op.add(f.products["Lait"]!)], { id: randomUUID(), at: new Date(before + 3_600_000).toISOString() });
    await send(f.marie, f.list, [op.add(f.products["Sucre"]!)], { id: randomUUID(), at: new Date(before - 40 * 86_400_000).toISOString() });
    const offline = new Date(before - 2 * 3_600_000);
    await send(f.marie, f.list, [op.add(f.products["Riz"]!)], { id: randomUUID(), at: offline.toISOString() });
    const v = await view(f.adil);
    const at = (name: string) => new Date(lines(v, f.products[name]!)[0].addedAt).getTime();
    expect(at("Lait")).toBeGreaterThanOrEqual(before - 1000);
    expect(at("Lait")).toBeLessThan(before + 60_000);
    expect(at("Sucre")).toBeGreaterThanOrEqual(before - 1000);
    expect(at("Riz")).toBe(offline.getTime());
  });

  it("un identifiant de validation déjà pris par une autre personne n'accroche pas les opérations à sa validation", async () => {
    const f = await newFamily();
    const shared = randomUUID();
    await send(f.marie, f.list, [op.add(f.products["Lait"]!)], { id: shared });
    await send(f.lamiaa, f.list, [op.add(f.products["Sucre"]!)], { id: shared });
    const v = await view(f.adil);
    expect(v.validations).toHaveLength(2);
    const sucre = v.events.find((e: any) => e.name === "Sucre");
    expect(v.validations.find((x: any) => x.id === sucre.validationId).by.displayName).toBe("Lamiaa");
  });

  it("le journal est réservé aux parents : le personnel ne reçoit ni événements, ni validations, ni auteurs", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Lait"]!, 2));
    const s = await view(f.marie);
    expect(s.events).toBeUndefined();
    expect(s.validations).toBeUndefined();
    expect(s.items[0].addedBy).toBeUndefined();
    expect(s.items[0]).toMatchObject({ quantity: 2, unit: "piece" });
  });

  it("une liste clôturée est immuable : opérations refusées, journal impossible à modifier ou à effacer", async () => {
    const f = await newFamily();
    await one(f.marie, f.list, op.add(f.products["Lait"]!, 2));
    const item = lines(await view(f.adil), f.products["Lait"]!)[0];
    expect((await app.inject({ method: "POST", url: `/api/lists/${f.list}/close`, cookies: f.lamiaa })).statusCode).toBe(200);
    for (const o of [op.add(f.products["Sucre"]!), op.setQty(f.products["Lait"]!, 9, item.rev), op.again(f.products["Lait"]!), op.remove(f.products["Lait"]!, item.rev)]) {
      expect((await one(f.marie, f.list, o)).reason).toBe("list_closed");
    }
    await expect(db.query("INSERT INTO list_events (list_id, family_id, item_id, product_id, validation_id, kind, qty_after, unit, actor_id, at) SELECT list_id, family_id, id, product_id, (SELECT id FROM validations LIMIT 1), 'add', 1, 'piece', added_by, now() FROM list_items WHERE id = $1", [item.id])).rejects.toThrow(/archivée/);
    await expect(db.query("UPDATE list_events SET qty_after = 99 WHERE item_id = $1", [item.id])).rejects.toThrow(/ajout seulement/);
    await expect(db.query("DELETE FROM validations WHERE list_id = $1", [f.list])).rejects.toThrow(/ajout seulement/);
    const archived = (await app.inject({ method: "GET", url: `/api/lists/${f.list}`, cookies: f.adil })).json().list;
    expect(lines(archived, f.products["Lait"]!)[0].quantity).toBe(2);
    expect(archived.events).toHaveLength(1);
  });
});

describe("Statistiques d'achats", () => {
  async function buy(f: F, name: string, qty: number, when: string, by = f.adil) {
    const id = (await db.query("SELECT id FROM lists WHERE family_id = $1 AND status = 'active'", [f.familyId])).rows[0]?.id ?? (await app.inject({ method: "POST", url: "/api/lists", cookies: f.lamiaa })).json().list.id;
    const added = await one(f.marie, id, op.add(f.products[name]!, qty));
    if (added.reason === "already_purchased") await one(f.marie, id, op.again(f.products[name]!, qty)); // déjà acheté : nouvelle demande explicite
    const item = lines(await view(f.adil), f.products[name]!).find((l: any) => l.status === "to_buy");
    await one(by, id, op.purchase(item.id));
    await db.query("UPDATE purchases SET purchased_at = $2 WHERE list_item_id = $1 AND voided_at IS NULL", [item.id, when]);
    return { itemId: item.id };
  }
  const stats = async (c: Cookies, month?: string) => (await app.inject({ method: "GET", url: `/api/stats/purchases${month ? `?month=${month}` : ""}`, cookies: c })).json();

  it("réservé aux parents et administrateurs", async () => {
    const f = await newFamily();
    expect((await app.inject({ method: "GET", url: "/api/stats/purchases", cookies: f.marie })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/stats/purchases", cookies: f.lamiaa })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/stats/purchases", cookies: f.adil })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/stats/purchases?month=2026-13", cookies: f.adil })).statusCode).toBe(400);
  });

  it("fréquence et quantité distinctes, mois en Africa/Casablanca, comparaison avec le mois précédent, pas de dépenses", async () => {
    const f = await newFamily();
    // Fin septembre 23:30 UTC = 00:30 le 1er octobre à Casablanca (UTC+1) : compte pour octobre.
    await buy(f, "Tomates", 2, "2026-09-30T23:30:00Z");
    await buy(f, "Tomates", 1.5, "2026-10-12T10:00:00Z");
    await buy(f, "Lait", 6, "2026-10-13T10:00:00Z");
    await buy(f, "Lait", 2, "2026-09-15T10:00:00Z");
    await buy(f, "Tomates", 4, "2026-09-10T10:00:00Z");
    await buy(f, "Riz", 1, "2026-11-02T10:00:00Z"); // hors des deux mois
    const s = await stats(f.lamiaa, "2026-10");
    expect(s).toMatchObject({ month: "2026-10", previousMonth: "2026-09", timeZone: "Africa/Casablanca", spending: null });
    const row = (name: string) => s.rows.find((r: any) => r.name === name);
    expect(row("Tomates")).toMatchObject({ unit: "kg", current: { purchases: 2, quantity: 3.5 }, previous: { purchases: 1, quantity: 4 } });
    expect(row("Lait")).toMatchObject({ unit: "piece", current: { purchases: 1, quantity: 6 }, previous: { purchases: 1, quantity: 2 } });
    expect(row("Riz")).toBeUndefined();
    expect(s.rows[0].name).toBe("Tomates"); // le plus souvent acheté d'abord (fréquence, pas quantité : Lait a 6 unités)
    expect(s.totals).toEqual({ purchases: 3, previousPurchases: 2 });
    expect(s.months).toContain("2026-11");
  });

  it("achats confirmés seulement, sans double comptage : un achat corrigé ne compte pas, son rachat compte une fois", async () => {
    const f = await newFamily();
    const { itemId } = await buy(f, "Lait", 3, "2026-10-05T10:00:00Z");
    const purchaseId = (await db.query("SELECT id FROM purchases WHERE list_item_id = $1", [itemId])).rows[0].id as string;
    const listId = (await db.query("SELECT id FROM lists WHERE family_id = $1 AND status = 'active'", [f.familyId])).rows[0].id as string;
    await one(f.lamiaa, listId, op.correct(purchaseId));
    expect((await stats(f.adil, "2026-10")).rows).toHaveLength(0);
    const open = lines(await view(f.adil), f.products["Lait"]!)[0];
    await one(f.adil, listId, op.purchase(open.id));
    await db.query("UPDATE purchases SET purchased_at = '2026-10-06T10:00:00Z' WHERE list_item_id = $1 AND voided_at IS NULL", [open.id]);
    const s = await stats(f.adil, "2026-10");
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].current).toEqual({ purchases: 1, quantity: 3, unknownQuantity: 0 });
    // l'écran peut être appelé deux fois : même résultat
    expect((await stats(f.adil, "2026-10")).rows[0].current).toEqual(s.rows[0].current);
  });

  it("jamais de total mélangeant des unités ; renommer, désactiver ou changer l'unité d'un produit préserve l'historique", async () => {
    const f = await newFamily();
    await buy(f, "Tomates", 2, "2026-10-05T10:00:00Z");
    await app.inject({ method: "PATCH", url: `/api/products/${f.products["Tomates"]}`, cookies: f.adil, payload: { unit: "paquet", name: "Tomates grappe", active: false } });
    // la liste active est vide de Tomates (achetée) ; on désactive puis on réactive pour racheter en paquets
    await app.inject({ method: "PATCH", url: `/api/products/${f.products["Tomates"]}`, cookies: f.adil, payload: { active: true } });
    await buy(f, "Tomates", 3, "2026-10-07T10:00:00Z");
    await app.inject({ method: "PATCH", url: `/api/products/${f.products["Tomates"]}`, cookies: f.adil, payload: { active: false } });
    const s = await stats(f.adil, "2026-10");
    const tomates = s.rows.filter((r: any) => r.productId === f.products["Tomates"]);
    expect(tomates.map((r: any) => [r.unit, r.current.purchases, r.current.quantity]).sort()).toEqual([["kg", 1, 2], ["paquet", 1, 3]]);
    expect(tomates[0]).toMatchObject({ name: "Tomates grappe", active: false }); // nom actuel, produit désactivé : l'historique est conservé
    expect(JSON.stringify(s)).not.toMatch(/"quantity":5/); // 2 kg + 3 paquets n'est jamais additionné
  });

  it("les achats antérieurs à cette fonction comptent dans la fréquence mais n'inventent pas de quantité", async () => {
    const f = await newFamily();
    const { itemId } = await buy(f, "Lait", 1, "2026-10-05T10:00:00Z");
    await db.query("UPDATE purchases SET quantity = NULL, unit = NULL WHERE list_item_id = $1", [itemId]);
    const r = (await stats(f.adil, "2026-10")).rows[0];
    expect(r).toMatchObject({ unit: null, current: { purchases: 1, quantity: null, unknownQuantity: 1 } });
  });

  it("une famille ne voit jamais les achats d'une autre", async () => {
    const a = await newFamily();
    const b = await newFamily();
    await buy(a, "Lait", 1, "2026-10-05T10:00:00Z");
    expect((await stats(b.adil, "2026-10")).rows).toHaveLength(0);
  });
});

describe("migration 009 sur des données existantes", () => {
  it("préserve profils, listes, achats et historiques ; crée les événements d'ajout ; applique les unités par défaut ; garde les listes archivées verrouillées", async () => {
    const dbName = `sc_mig_${Date.now()}`;
    const admin = createPool(new URL("/postgres", process.env.DATABASE_URL!).toString());
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const legacyDir = mkdtempSync(path.join(os.tmpdir(), "mig-"));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x < "009")) copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(legacyDir, f));
    mkdirSync(legacyDir, { recursive: true });
    const old = createPool(new URL(`/${dbName}`, process.env.DATABASE_URL!).toString());
    try {
      await migrate(old, legacyDir);
      const fam = (await old.query("INSERT INTO families (code, name) VALUES ('MIG123','Ancienne') RETURNING id")).rows[0].id as string;
      const prof = (await old.query("INSERT INTO profiles (family_id, display_name, login, role, secret_hash) VALUES ($1,'Adil','adil','admin','x') RETURNING id", [fam])).rows[0].id as string;
      await old.query(`INSERT INTO products (family_id, category, name, catalog_key, position) SELECT $1, category, name, key, position FROM initial_catalog`, [fam]);
      const tom = (await old.query("SELECT id FROM products WHERE family_id = $1 AND name = 'Tomates'", [fam])).rows[0].id as string;
      const lait = (await old.query("SELECT id FROM products WHERE family_id = $1 AND name = 'Lait'", [fam])).rows[0].id as string;
      const l1 = (await old.query("INSERT INTO lists (family_id, created_by) VALUES ($1,$2) RETURNING id", [fam, prof])).rows[0].id as string;
      const i1 = (await old.query("INSERT INTO list_items (list_id, family_id, product_id, added_by, added_at, status) VALUES ($1,$2,$3,$4,'2026-10-01T08:00:10Z','purchased') RETURNING id", [l1, fam, tom, prof])).rows[0].id as string;
      await old.query("INSERT INTO list_items (list_id, family_id, product_id, added_by, added_at) VALUES ($1,$2,$3,$4,'2026-10-01T08:00:40Z')", [l1, fam, lait, prof]);
      await old.query("INSERT INTO purchases (list_item_id, list_id, family_id, purchased_by, purchased_at) VALUES ($1,$2,$3,$4,'2026-10-01T09:00:00Z')", [i1, l1, fam, prof]);
      await old.query("UPDATE lists SET status = 'archived', closed_by = $2, closed_at = now() WHERE id = $1", [l1, prof]);
      const l2 = (await old.query("INSERT INTO lists (family_id, created_by) VALUES ($1,$2) RETURNING id", [fam, prof])).rows[0].id as string;
      await old.query("INSERT INTO list_items (list_id, family_id, product_id, added_by, status) VALUES ($1,$2,$3,$4,'removed')", [l2, fam, lait, prof]);

      expect(await migrate(old)).toEqual(["009_quantities.sql"]);

      expect((await old.query("SELECT count(*)::int AS n FROM profiles")).rows[0].n).toBe(1);
      const items = (await old.query("SELECT product_id, quantity, unit, status FROM list_items ORDER BY added_at NULLS LAST")).rows;
      expect(items.filter((i) => i.product_id === tom)[0]).toMatchObject({ unit: "kg", status: "purchased" });
      expect(Number(items[0].quantity)).toBe(1);
      expect((await old.query("SELECT unit FROM products WHERE id = $1", [lait])).rows[0].unit).toBe("piece");
      expect((await old.query("SELECT unit FROM products WHERE family_id = $1 AND name = 'Persil'", [fam])).rows[0].unit).toBe("paquet");
      const pu = (await old.query("SELECT product_id, quantity, unit FROM purchases")).rows[0];
      expect(pu).toMatchObject({ product_id: tom, quantity: null, unit: null });
      // un événement d'ajout par article existant (le retiré n'en a pas), à l'heure d'origine, groupés par minute
      const ev = (await old.query("SELECT kind, qty_after, at FROM list_events ORDER BY at")).rows;
      expect(ev).toHaveLength(2);
      expect(ev.every((e) => e.kind === "add" && Number(e.qty_after) === 1)).toBe(true);
      expect(ev[0].at.toISOString()).toBe("2026-10-01T08:00:10.000Z");
      expect((await old.query("SELECT count(*)::int AS n FROM validations")).rows[0].n).toBe(1); // même auteur, même minute
      // les listes archivées restent verrouillées après la migration
      await expect(old.query("UPDATE list_items SET quantity = 7 WHERE list_id = $1", [l1])).rejects.toThrow(/archivée/);
      // la nouvelle règle : plusieurs lignes achetées autorisées, une seule ligne ouverte par produit
      await old.query("INSERT INTO list_items (list_id, family_id, product_id, added_by) VALUES ($1,$2,$3,$4)", [l2, fam, tom, prof]);
      await expect(old.query("INSERT INTO list_items (list_id, family_id, product_id, added_by) VALUES ($1,$2,$3,$4)", [l2, fam, tom, prof])).rejects.toThrow(/duplicate|unique/i);
      // la révision du catalogue a changé : les téléphones retéléchargent le catalogue avec les unités
      expect(Number((await old.query("SELECT catalog_rev FROM families")).rows[0].catalog_rev)).toBeGreaterThan(0);
    } finally {
      await old.end();
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  });
});
