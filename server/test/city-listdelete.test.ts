import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { SseHub } from "../src/hub.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance; // règles de production : la ville est obligatoire
let hub: SseHub;
let n = 0;
const rate = { max: 1000, timeWindow: "1 minute" };
const events: { event: string; data: any }[] = [];

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  await db.query("DELETE FROM price_contributions");
  hub = new SseHub();
  const orig = hub.broadcast.bind(hub);
  hub.broadcast = (f: string, e: string, d: unknown) => (events.push({ event: e, data: d }), orig(f, e, d));
  app = await buildApp({ db, store: testStore(), hub, loginRateLimit: rate, requireCity: true });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((x) => x.name === "sc_session")!.value });
async function family(city = "Rabat") {
  const r = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `F${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913", city } } });
  expect(r.statusCode).toBe(201);
  const admin = cookieOf(r);
  const add = async (login: string, role: string, c = city) => {
    expect((await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: login, login, role, secret: "573918", secretConfirm: "573918", city: c } })).statusCode).toBe(201);
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: r.json().familyCode, login, secret: "573918" } }));
  };
  const cat = (await app.inject({ method: "GET", url: "/api/catalog", cookies: admin })).json();
  const products: Record<string, any> = {};
  for (const c of cat.categories) for (const p of c.products) products[p.name] = p;
  return { admin, add, products, code: r.json().familyCode as string };
}

describe("ville du profil", () => {
  it("obligatoire au premier administrateur et à chaque nouveau profil ; choisie dans la liste (casse et accents indifférents) ; le jeton n'est pas consommé en cas de refus", async () => {
    const token = await generateInstallToken(db);
    const body = (city?: string) => ({ installToken: token, familyName: "Z", admin: { displayName: "A", login: "aa", secret: "482913", ...(city !== undefined ? { city } : {}) } });
    expect((await app.inject({ method: "POST", url: "/api/setup/family", payload: body() })).json().error).toBe("city_required");
    expect((await app.inject({ method: "POST", url: "/api/setup/family", payload: body("Atlantide") })).json().error).toBe("invalid_city");
    const ok = await app.inject({ method: "POST", url: "/api/setup/family", payload: body("fes") }); // même jeton : toujours valable
    expect(ok.statusCode).toBe(201);
    const me = (await app.inject({ method: "GET", url: "/api/me", cookies: cookieOf(ok) })).json().me;
    expect(me.city).toBe("Fès");
    const f = await family();
    // Cette règle historique ne concerne que les familles sans localisation confirmée.
    await db.query("UPDATE families SET location_confirmed_at = NULL WHERE code = $1", [f.code]);
    expect((await app.inject({ method: "POST", url: "/api/profiles", cookies: f.admin, payload: { displayName: "X", login: "xx", role: "staff", secret: "573918", secretConfirm: "573918" } })).json().error).toBe("city_required");
    await db.query("UPDATE families SET location_confirmed_at = now() WHERE code = $1", [f.code]);
    expect((await app.inject({ method: "POST", url: "/api/profiles", cookies: f.admin, payload: { displayName: "X", login: "xx", role: "staff", secret: "573918", secretConfirm: "573918", city: "Gotham" } })).json().error).toBe("invalid_city");
  });
  it("modifiable dans le profil ; visible dans la liste des profils ; un profil existant sans ville fonctionne normalement", async () => {
    const f = await family("Marrakech");
    const staff = await f.add("marie", "staff", "Agadir");
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: staff })).json().me.city).toBe("Agadir");
    expect((await app.inject({ method: "PUT", url: "/api/me/city", cookies: staff, payload: { city: "tanger" } })).json().city).toBe("Tanger");
    expect((await app.inject({ method: "PUT", url: "/api/me/city", cookies: staff, payload: { city: "Mordor" } })).statusCode).toBe(400);
    const profiles = (await app.inject({ method: "GET", url: "/api/profiles", cookies: f.admin })).json().profiles;
    expect(profiles.map((p: any) => [p.login, p.city]).sort()).toEqual([["adil", "Marrakech"], ["marie", "Tanger"]]);
    // profil existant sans ville (créé avant cette règle) : l'usage courant n'est pas bloqué
    await db.query("UPDATE profiles SET city = NULL WHERE login = 'marie' AND family_id = (SELECT family_id FROM profiles WHERE login = 'adil' ORDER BY created_at DESC LIMIT 1)");
    expect((await app.inject({ method: "GET", url: "/api/catalog", cookies: staff })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/lists/active", cookies: staff })).statusCode).toBe(200);
  });
});

describe("prix de la communauté par ville", () => {
  it("la synchronisation n'utilise que la ville de la famille (ou du profil) ; sans ville elle la demande ; un autre profil d'une autre ville voit les siennes", async () => {
    const share = async (city: string, amount: string) => {
      const g = await family(city);
      await app.inject({ method: "PUT", url: `/api/products/${g.products["Pommes"].id}/price`, cookies: g.admin, payload: { amount, refQty: 1, refUnit: "kg" } });
      expect((await app.inject({ method: "POST", url: "/api/prices/share", cookies: g.admin, payload: { productId: g.products["Pommes"].id } })).statusCode).toBe(201);
    };
    for (const a of ["10", "12", "11"]) await share("Rabat", a);
    for (const a of ["20", "22", "21"]) await share("Agadir", a);
    const props = async (cookies: any) => (await app.inject({ method: "GET", url: "/api/prices/community", cookies })).json();
    const rabat = await family("Rabat");
    const agadir = await family("Agadir");
    const marrakech = await family("Marrakech");
    const sel = (r: any, pid: string) => r.proposals.find((p: any) => p.productId === pid);
    expect(sel(await props(rabat.admin), rabat.products["Pommes"].id)).toMatchObject({ price: { amount: "11.00" } });
    expect(sel(await props(agadir.admin), agadir.products["Pommes"].id)).toMatchObject({ price: { amount: "21.00" } });
    expect((await props(marrakech.admin)).proposals.filter((p: any) => p.productId === marrakech.products["Pommes"].id)).toHaveLength(0); // aucune contribution dans sa ville
    // sans ville : demandée
    await db.query("UPDATE profiles SET city = NULL WHERE family_id = (SELECT family_id FROM profiles WHERE login = 'adil' ORDER BY created_at DESC LIMIT 1)");
    // (depuis 023, la ville de la famille passe avant celle du profil : famille sans localisation confirmée ici)
    await db.query("UPDATE families SET country = NULL, city = NULL, location_confirmed_at = NULL WHERE id = (SELECT family_id FROM profiles WHERE login = 'adil' ORDER BY created_at DESC LIMIT 1)");
    expect((await app.inject({ method: "GET", url: "/api/prices/community", cookies: marrakech.admin })).json().error).toBe("city_required");
    expect((await app.inject({ method: "POST", url: "/api/prices/share", cookies: marrakech.admin, payload: { productId: marrakech.products["Pommes"].id } })).json().error).toBe("city_required");
    // appliquer : seulement ce qui est sélectionné
    const r = await app.inject({ method: "POST", url: "/api/prices/community/apply", cookies: rabat.admin, payload: { items: [{ productId: rabat.products["Pommes"].id, format: "kg" }] } });
    expect(r.json().applied).toBe(1);
  });
});

describe("suppression d'une liste clôturée (administrateur)", () => {
  async function closedList(f: Awaited<ReturnType<typeof family>>, names: string[]) {
    const list = (await app.inject({ method: "POST", url: "/api/lists", cookies: f.admin })).json().list;
    const ops = names.map((nm) => ({ opId: randomUUID(), type: "add", productId: f.products[nm].id, quantity: 1 }));
    const l = (await app.inject({ method: "POST", url: `/api/lists/${list.id}/ops`, cookies: f.admin, payload: { ops } })).json().list;
    for (const it of l.items) await app.inject({ method: "POST", url: `/api/lists/${list.id}/ops`, cookies: f.admin, payload: { ops: [{ opId: randomUUID(), type: "purchase", itemId: it.id }] } });
    expect((await app.inject({ method: "POST", url: `/api/lists/${list.id}/close`, cookies: f.admin })).statusCode).toBe(200);
    return list.id as string;
  }
  const stat = async (f: any) => (await app.inject({ method: "GET", url: "/api/stats/purchases", cookies: f.admin })).json();

  it("supprime la liste et ses achats ; recalcule les statistiques ; préserve catalogue, favoris et autres listes ; prévient les autres téléphones ; réservé aux administrateurs de la famille", async () => {
    const f = await family();
    const g = await family();
    const parent = await f.add("lamiaa", "parent");
    const staff = await f.add("marie", "staff");
    const keep = await closedList(f, ["Tomates"]);
    const doomed = await closedList(f, ["Oignons", "Carottes"]);
    const foreign = await closedList(g, ["Tomates"]);
    await app.inject({ method: "POST", url: "/api/templates", cookies: f.admin, payload: { name: "Fav", items: [{ productId: f.products["Tomates"].id, quantity: 1 }] } });
    const before = JSON.stringify(await stat(f));
    expect(before).toContain("Oignons");
    // droits et appartenance
    for (const who of [parent, staff]) expect((await app.inject({ method: "DELETE", url: `/api/lists/${doomed}`, cookies: who })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/lists/${foreign}`, cookies: f.admin })).statusCode).toBe(404); // autre famille
    expect((await app.inject({ method: "GET", url: `/api/lists/${doomed}`, cookies: f.admin })).statusCode).toBe(200); // rien n'a été supprimé
    // une liste en cours ne se supprime pas ainsi
    const active = (await app.inject({ method: "POST", url: "/api/lists", cookies: f.admin })).json().list.id;
    expect((await app.inject({ method: "DELETE", url: `/api/lists/${active}`, cookies: f.admin })).json().error).toBe("list_active");
    const nProducts = (await db.query("SELECT count(*)::int AS n FROM products WHERE family_id = (SELECT family_id FROM lists WHERE id = $1)", [doomed])).rows[0].n;
    events.length = 0;
    const del = await app.inject({ method: "DELETE", url: `/api/lists/${doomed}`, cookies: f.admin });
    expect(del.json()).toMatchObject({ ok: true, items: 2, purchases: 2 });
    expect(events).toContainEqual({ event: "list.deleted", data: { listId: doomed } });
    expect((await app.inject({ method: "GET", url: `/api/lists/${doomed}`, cookies: f.admin })).statusCode).toBe(404);
    expect((await db.query("SELECT count(*)::int AS n FROM purchases WHERE list_id = $1", [doomed])).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM list_events WHERE list_id = $1", [doomed])).rows[0].n).toBe(0);
    // statistiques recalculées : plus d'oignons ni de carottes ; la liste conservée compte encore
    const after = JSON.stringify(await stat(f));
    expect(after).not.toContain("Oignons");
    expect(after).toContain("Tomates");
    // catalogue, favoris, autres listes (de la famille et d'une autre) intacts
    expect((await db.query("SELECT count(*)::int AS n FROM products WHERE family_id = (SELECT family_id FROM lists WHERE id = $1)", [keep])).rows[0].n).toBe(nProducts);
    expect((await app.inject({ method: "GET", url: "/api/templates", cookies: f.admin })).json().templates).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: `/api/lists/${keep}`, cookies: f.admin })).json().list.items).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: `/api/lists/${foreign}`, cookies: g.admin })).statusCode).toBe(200);
    // une ancienne action hors connexion ne recrée jamais la liste
    const late = await app.inject({ method: "POST", url: `/api/lists/${doomed}/ops`, cookies: f.admin, payload: { ops: [{ opId: randomUUID(), type: "add", productId: f.products["Tomates"].id }] } });
    expect(late.statusCode).toBe(404);
    expect((await db.query("SELECT count(*)::int AS n FROM lists WHERE id = $1", [doomed])).rows[0].n).toBe(0);
    // trace d'audit sans donnée personnelle
    expect((await db.query("SELECT details FROM audit_log WHERE action = 'list.deleted' ORDER BY id DESC LIMIT 1")).rows[0].details).toEqual({ items: 2, purchases: 2 });
  });

  it("la protection des archives reste entière : toute suppression ou modification directe est refusée", async () => {
    const f = await family();
    const id = await closedList(f, ["Tomates"]);
    for (const q of ["DELETE FROM list_items WHERE list_id = $1", "DELETE FROM purchases WHERE list_id = $1", "DELETE FROM list_events WHERE list_id = $1", "DELETE FROM validations WHERE list_id = $1", "DELETE FROM lists WHERE id = $1", "UPDATE list_items SET quantity = 5 WHERE list_id = $1"]) {
      await expect(db.query(q, [id]), q).rejects.toThrow();
    }
    // le réglage d'une AUTRE liste n'ouvre rien : seule la liste désignée peut être supprimée
    const other = await closedList(f, ["Oignons"]);
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.list_delete', $1, true)", [other]);
      await expect(c.query("DELETE FROM purchases WHERE list_id = $1", [id])).rejects.toThrow();
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    expect((await db.query("SELECT count(*)::int AS n FROM purchases WHERE list_id = $1", [id])).rows[0].n).toBe(1);
  });
});

describe("liste des villes", () => {
  it("est identique côté serveur et côté application", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("../web/src/cities.ts", "utf8")).toBe(readFileSync("src/cities.ts", "utf8"));
  });
});
