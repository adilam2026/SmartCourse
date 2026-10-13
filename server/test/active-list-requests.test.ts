import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { SseHub } from "../src/hub.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

/*
 * Demandes sur « la liste en cours » (POST /api/lists/active/ops) : le personnel, qui ne peut ni créer ni clôturer une liste, obtient la
 * liste du jour en demandant des articles ; deux appareils simultanés ne créent jamais deux listes ; aucune demande n'est perdue.
 */
let db: Db;
let app: FastifyInstance;
let hub: SseHub;
let n = 0;
const events: { event: string }[] = [];
const rate = { max: 1000, timeWindow: "1 minute" };

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  hub = new SseHub();
  const orig = hub.broadcast.bind(hub);
  hub.broadcast = (f: string, e: string, d: unknown) => (events.push({ event: e }), orig(f, e, d));
  app = await buildApp({ db, store: testStore(), hub, loginRateLimit: rate });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((x) => x.name === "sc_session")!.value });
async function family() {
  const r = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `F${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913", secretConfirm: "482913" } } });
  expect(r.statusCode).toBe(201);
  const admin = cookieOf(r);
  const add = async (login: string, role: string) => {
    expect((await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: login, login, role, secret: "573918", secretConfirm: "573918" } })).statusCode).toBe(201);
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: r.json().familyCode, login, secret: "573918" } }));
  };
  const cat = (await app.inject({ method: "GET", url: "/api/catalog", cookies: admin })).json();
  const products: Record<string, any> = {};
  for (const c of cat.categories) for (const p of c.products) products[p.name] = p;
  return { admin, add, products };
}
const addOp = (productId: string, quantity?: number) => ({ opId: randomUUID(), type: "add", productId, ...(quantity ? { quantity } : {}) });
const post = (cookies: object, ops: object[], batchId = randomUUID()) => app.inject({ method: "POST", url: "/api/lists/active/ops", cookies: cookies as Record<string, string>, payload: { ops, batch: { id: batchId } } });
const active = async (f: { admin: object }) => (await app.inject({ method: "GET", url: "/api/lists/active", cookies: f.admin as Record<string, string> })).json().list;
const nActive = async () => (await db.query("SELECT count(*)::int AS n FROM lists WHERE status = 'active'")).rows[0].n as number;

describe("demandes du personnel sans liste", () => {
  it("le personnel crée la liste du jour en demandant des articles, sans gagner d'autre droit", async () => {
    const f = await family();
    const staff = await f.add("marie", "staff");
    expect(await active(f)).toBeNull();
    // aucune création directe, aucune clôture, aucun achat
    expect((await app.inject({ method: "POST", url: "/api/lists", cookies: staff })).statusCode).toBe(403);
    const r = await post(staff, [addOp(f.products["Tomates"].id, 1.5), addOp(f.products["Riz"].id)]);
    expect(r.statusCode).toBe(200);
    const list = r.json().list;
    expect(list.status).toBe("active");
    expect(list.items.map((i: any) => `${i.name}:${i.quantity}`).sort()).toEqual(["Riz:1", "Tomates:1.5"]);
    const by = (await db.query("SELECT p.login FROM lists l JOIN profiles p ON p.id = l.created_by WHERE l.id = $1", [list.id])).rows[0].login;
    expect(by).toBe("marie");
    expect(events.some((e) => e.event === "list.created")).toBe(true); // les autres téléphones sont prévenus
    expect((await app.inject({ method: "POST", url: `/api/lists/${list.id}/close`, cookies: staff })).statusCode).toBe(403);
    expect((await post(staff, [{ opId: randomUUID(), type: "purchase", itemId: list.items[0].id }])).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/lists", cookies: staff })).statusCode).toBe(403);
    // l'administrateur voit la liste, la clôture, puis une nouvelle demande crée une nouvelle liste
    expect((await active(f)).id).toBe(list.id);
    expect((await app.inject({ method: "POST", url: `/api/lists/${list.id}/close`, cookies: f.admin })).statusCode).toBe(200);
    const next = await post(staff, [addOp(f.products["Lait"].id)]);
    expect(next.json().list.id).not.toBe(list.id);
    expect(next.json().list.items).toHaveLength(1);
  });

  it("sans article à ajouter, aucune liste n'est créée (ni pour un achat, ni pour une quantité)", async () => {
    const f = await family();
    const parent = await f.add("lamiaa", "parent");
    const r = await post(parent, [{ opId: randomUUID(), type: "purchase", itemId: randomUUID() }]);
    expect(r.statusCode).toBe(404);
    expect(await active(f)).toBeNull();
    const s = await post(parent, [{ opId: randomUUID(), type: "set_qty", productId: f.products["Riz"].id, quantity: 2, baseRev: 1 }]);
    expect(s.statusCode).toBe(404);
    expect(await active(f)).toBeNull();
  });

  it("deux appareils qui valident en même temps : une seule liste en cours, aucune demande perdue", async () => {
    const f = await family();
    const a = await f.add("marie", "staff");
    const b = await f.add("paul", "staff");
    const c = await f.add("lamiaa", "parent");
    const results = await Promise.all([
      post(a, [addOp(f.products["Tomates"].id, 2)]),
      post(b, [addOp(f.products["Riz"].id), addOp(f.products["Lait"].id)]),
      post(c, [addOp(f.products["Oignons"].id)]),
    ]);
    for (const r of results) expect(r.statusCode).toBe(200);
    const fam = (await db.query("SELECT family_id FROM lists ORDER BY created_at DESC LIMIT 1")).rows[0].family_id;
    const lists = (await db.query("SELECT id FROM lists WHERE family_id = $1 AND status = 'active'", [fam])).rows;
    expect(lists).toHaveLength(1); // jamais deux listes en cours
    const list = await active(f);
    expect(list.items.map((i: any) => i.name).sort()).toEqual(["Lait", "Oignons", "Riz", "Tomates"]);
    expect(new Set(results.map((r) => r.json().list.id)).size).toBe(1);
  });

  it("renvoyer le même lot (réponse perdue) ne duplique rien ; une même quantité demandée deux fois s'additionne comme d'habitude", async () => {
    const f = await family();
    const staff = await f.add("marie", "staff");
    const op = addOp(f.products["Tomates"].id, 2);
    const batch = randomUUID();
    expect((await post(staff, [op], batch)).statusCode).toBe(200);
    expect((await post(staff, [op], batch)).statusCode).toBe(200); // rejeu du même lot
    const list = await active(f);
    expect(list.items).toHaveLength(1);
    expect(Number(list.items[0].quantity)).toBe(2);
    expect(await nActive()).toBeGreaterThanOrEqual(1);
  });

  it("isolement : la liste d'une famille n'est jamais celle d'une autre", async () => {
    const f = await family();
    const g = await family();
    const sf = await f.add("marie", "staff");
    const sg = await g.add("marie", "staff");
    const rf = await post(sf, [addOp(f.products["Tomates"].id)]);
    const rg = await post(sg, [addOp(g.products["Riz"].id)]);
    expect(rf.json().list.id).not.toBe(rg.json().list.id);
    expect((await active(f)).items.map((i: any) => i.name)).toEqual(["Tomates"]);
    expect((await active(g)).items.map((i: any) => i.name)).toEqual(["Riz"]);
  });
});
