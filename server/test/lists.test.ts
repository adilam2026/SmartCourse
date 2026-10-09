import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { SseHub } from "../src/hub.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
let hub: SseHub;
let n = 0;
type Cookies = Record<string, string>;

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  hub = new SseHub();
  app = await buildApp({ db, hub, store: testStore(), loginRateLimit: { max: 10_000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });

async function newFamily() {
  const res = await app.inject({
    method: "POST",
    url: "/api/setup/family",
    payload: { installToken: await generateInstallToken(db), familyName: `F${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } },
  });
  const familyCode = res.json().familyCode as string;
  const adil = cookieOf(res);
  const mk = async (role: string, login: string, display = login) => {
    await app.inject({ method: "POST", url: "/api/profiles", cookies: adil, payload: { displayName: display, login, role, secret: "573918" } });
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login, secret: "573918" } }));
  };
  const lamiaa = await mk("parent", "lamiaa", "Lamiaa");
  const marie = await mk("staff", "marie", "Marie");
  const products: Record<string, string> = {};
  for (const c of (await app.inject({ method: "GET", url: "/api/catalog", cookies: adil })).json().categories) for (const p of c.products) products[p.name] = p.id;
  const familyId = (await db.query("SELECT id FROM families WHERE code = $1", [familyCode])).rows[0].id as string;
  return { familyCode, familyId, adil, lamiaa, marie, products };
}

async function newList(f: Awaited<ReturnType<typeof newFamily>>) {
  const r = await app.inject({ method: "POST", url: "/api/lists", cookies: f.lamiaa });
  expect(r.statusCode).toBe(201);
  return r.json().list.id as string;
}

const op = {
  add: (productId: string) => ({ opId: randomUUID(), type: "add", productId }),
  remove: (productId: string, baseRev: number) => ({ opId: randomUUID(), type: "remove", productId, baseRev }),
  purchase: (itemId: string) => ({ opId: randomUUID(), type: "purchase", itemId }),
  correct: (purchaseId: string, reason?: string) => ({ opId: randomUUID(), type: "correct", purchaseId, ...(reason !== undefined ? { reason } : {}) }),
};
const send = (cookies: Cookies, listId: string, ops: object[]) => app.inject({ method: "POST", url: `/api/lists/${listId}/ops`, cookies, payload: { ops } });
const one = async (cookies: Cookies, listId: string, o: object) => (await send(cookies, listId, [o])).json().results[0];
const view = async (cookies: Cookies) => (await app.inject({ method: "GET", url: "/api/lists/active", cookies })).json().list;
const itemOf = (list: any, productId: string) => list.items.find((i: any) => i.productId === productId);

/** Invariants that must hold after any interleaving. */
async function assertConsistent(listId: string) {
  const bad = await db.query(
    `SELECT i.id FROM list_items i WHERE (i.status = 'purchased') <> EXISTS (SELECT 1 FROM purchases p WHERE p.list_item_id = i.id AND p.voided_at IS NULL) AND i.list_id = $1`,
    [listId],
  );
  expect(bad.rows).toEqual([]);
  const dup = await db.query("SELECT product_id FROM list_items WHERE list_id = $1 GROUP BY product_id HAVING count(*) > 1", [listId]);
  expect(dup.rows).toEqual([]);
}

describe("listes : base", () => {
  it("une seule liste active par famille, même avec des créations simultanées", async () => {
    const f = await newFamily();
    const rs = await Promise.all([f.lamiaa, f.adil, f.lamiaa, f.adil].map((c) => app.inject({ method: "POST", url: "/api/lists", cookies: c })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409]);
    expect((await app.inject({ method: "POST", url: "/api/lists", cookies: f.marie })).statusCode).toBe(403);
  });

  it("sans liste active : le personnel reçoit « null » (écran « Aucune liste en cours ») et ne peut pas créer", async () => {
    const f = await newFamily();
    expect((await app.inject({ method: "GET", url: "/api/lists/active", cookies: f.marie })).json()).toEqual({ list: null });
    expect((await app.inject({ method: "POST", url: "/api/lists", cookies: f.marie })).statusCode).toBe(403);
  });

  it("critère 4 : une sélection validée par le personnel est visible chez les parents", async () => {
    const f = await newFamily();
    const id = await newList(f);
    const r = await send(f.marie, id, [op.add(f.products["Lait"]!), op.add(f.products["Œufs"]!)]);
    expect(r.json().results.map((x: any) => x.status)).toEqual(["applied", "applied"]);
    const v = await view(f.adil);
    expect(v.items.map((i: any) => i.name).sort()).toEqual(["Lait", "Œufs"]);
  });

  it("critère 5 : deux membres qui ajoutent le même produit ne créent qu'une ligne", async () => {
    const f = await newFamily();
    const id = await newList(f);
    const rs = await Promise.all([f.marie, f.adil, f.lamiaa, f.marie, f.adil].map((c) => one(c, id, op.add(f.products["Lait"]!))));
    expect(rs.filter((r) => r.status === "applied")).toHaveLength(1);
    expect(rs.filter((r) => r.status === "already")).toHaveLength(4);
    expect((await view(f.adil)).items).toHaveLength(1);
    await assertConsistent(id);
  });

  it("critère 9 : des ajouts indépendants de membres différents sont tous conservés", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await Promise.all([one(f.marie, id, op.add(f.products["Lait"]!)), one(f.adil, id, op.add(f.products["Sucre"]!)), one(f.lamiaa, id, op.add(f.products["Riz"]!))]);
    expect((await view(f.adil)).items.map((i: any) => i.name).sort()).toEqual(["Lait", "Riz", "Sucre"]);
  });

  it("un produit inconnu ou d'une autre famille est refusé", async () => {
    const a = await newFamily();
    const b = await newFamily();
    const id = await newList(a);
    expect((await one(a.marie, id, op.add(randomUUID()))).reason).toBe("product_unknown");
    expect((await one(a.marie, id, op.add(b.products["Lait"]!))).reason).toBe("product_unknown");
  });
});

describe("achats, retraits, rev", () => {
  it("critère 6 : un achat d'Adil apparaît chez Lamiaa avec son auteur ; le personnel voit seulement « acheté »", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await one(f.marie, id, op.add(f.products["Lait"]!));
    const item = itemOf(await view(f.adil), f.products["Lait"]!);
    expect((await one(f.adil, id, op.purchase(item.id))).status).toBe("applied");

    const forLamiaa = itemOf(await view(f.lamiaa), f.products["Lait"]!);
    expect(forLamiaa.status).toBe("purchased");
    expect(forLamiaa.purchase.by.displayName).toBe("Adil");
    expect(typeof forLamiaa.purchase.at).toBe("string");

    const forStaff = itemOf(await view(f.marie), f.products["Lait"]!);
    expect(forStaff.status).toBe("purchased");
    expect(forStaff.purchase).toBeUndefined();
  });

  it("le personnel ne peut ni acheter ni corriger (403), et l'identité vient de la session", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await one(f.marie, id, op.add(f.products["Lait"]!));
    const item = itemOf(await view(f.adil), f.products["Lait"]!);
    expect((await send(f.marie, id, [op.purchase(item.id)])).statusCode).toBe(403);
    expect((await send(f.marie, id, [op.correct(randomUUID())])).statusCode).toBe(403);
    expect((await send(f.marie, id, [op.add(f.products["Sucre"]!), op.purchase(item.id)])).statusCode).toBe(403);
    expect(itemOf(await view(f.adil), f.products["Sucre"]!)).toBeUndefined(); // rien n'a été appliqué
    // un faux « purchasedBy » dans la requête est ignoré
    const forged = { ...op.purchase(item.id), purchasedBy: "00000000-0000-4000-8000-000000000000" };
    await one(f.lamiaa, id, forged);
    expect(itemOf(await view(f.adil), f.products["Lait"]!).purchase.by.displayName).toBe("Lamiaa");
  });

  it("critère 7 : le personnel ne peut pas retirer un article acheté, même depuis un ancien brouillon", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await one(f.marie, id, op.add(f.products["Lait"]!));
    const seen = itemOf(await view(f.marie), f.products["Lait"]!); // le brouillon se base sur cet état (rev 1)
    await one(f.adil, id, op.purchase(seen.id));
    const r = await one(f.marie, id, op.remove(f.products["Lait"]!, seen.rev));
    expect(r).toMatchObject({ status: "rejected", reason: "locked_purchased" });
    const after = itemOf(await view(f.marie), f.products["Lait"]!);
    expect(after.status).toBe("purchased");
    // même avec la révision à jour
    expect((await one(f.marie, id, op.remove(f.products["Lait"]!, after.rev))).reason).toBe("locked_purchased");
  });

  it("critère 8 : correction sans motif ; l'article revient à acheter ; l'ancien brouillon de retrait est périmé", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await one(f.marie, id, op.add(f.products["Lait"]!));
    const seen = itemOf(await view(f.marie), f.products["Lait"]!);
    await one(f.adil, id, op.purchase(seen.id));
    const bought = itemOf(await view(f.adil), f.products["Lait"]!);

    const c = await one(f.lamiaa, id, op.correct(bought.purchase.id)); // aucun motif
    expect(c.status).toBe("applied");
    const after = itemOf(await view(f.lamiaa), f.products["Lait"]!);
    expect(after.status).toBe("to_buy");
    expect(after.purchase).toBeUndefined();

    // le brouillon du personnel (rev 1) ne peut pas défaire l'état courant
    expect((await one(f.marie, id, op.remove(f.products["Lait"]!, seen.rev))).reason).toBe("stale");
    expect(itemOf(await view(f.lamiaa), f.products["Lait"]!).status).toBe("to_buy");
    // avec la bonne révision, le retrait d'un article non acheté fonctionne
    expect((await one(f.marie, id, op.remove(f.products["Lait"]!, after.rev))).status).toBe("applied");

    // la correction reste tracée (auteur, date, achat annulé)
    const cor = (await view(f.adil)).corrections;
    expect(cor).toHaveLength(1);
    expect(cor[0]).toMatchObject({ name: "Lait", purchasedBy: { displayName: "Adil" }, correctedBy: { displayName: "Lamiaa" }, reason: null });
    expect((await view(f.marie)).corrections).toBeUndefined();
  });

  it("une correction avec motif le conserve ; corriger deux fois ne fait rien de plus", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await one(f.marie, id, op.add(f.products["Riz"]!));
    await one(f.adil, id, op.purchase(itemOf(await view(f.adil), f.products["Riz"]!).id));
    const pid = itemOf(await view(f.adil), f.products["Riz"]!).purchase.id;
    expect((await one(f.lamiaa, id, op.correct(pid, "Mauvais paquet"))).status).toBe("applied");
    expect((await one(f.adil, id, op.correct(pid, "autre"))).status).toBe("already");
    const cor = (await view(f.adil)).corrections;
    expect(cor).toHaveLength(1);
    expect(cor[0].reason).toBe("Mauvais paquet");
  });

  it("rejouer une opération (même op_id) ne la rejoue pas : pas de doublon, pas d'annulation d'une correction", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await one(f.marie, id, op.add(f.products["Lait"]!));
    const item = itemOf(await view(f.adil), f.products["Lait"]!);
    const buy = op.purchase(item.id);
    expect((await one(f.adil, id, buy)).status).toBe("applied");
    await one(f.lamiaa, id, op.correct(itemOf(await view(f.adil), f.products["Lait"]!).purchase.id));
    const replay = await one(f.adil, id, buy); // connexion coupée : l'application renvoie la même opération
    expect(replay).toMatchObject({ status: "applied", replay: true });
    expect(itemOf(await view(f.adil), f.products["Lait"]!).status).toBe("to_buy"); // la correction tient
    const rows = await db.query("SELECT count(*)::int AS n FROM purchases WHERE list_item_id = $1", [item.id]);
    expect(rows.rows[0].n).toBe(1);
  });

  it("la même opération envoyée deux fois en même temps n'est exécutée qu'une fois", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await one(f.marie, id, op.add(f.products["Lait"]!));
    const item = itemOf(await view(f.adil), f.products["Lait"]!);
    const buy = op.purchase(item.id);
    const [a, b] = await Promise.all([one(f.adil, id, buy), one(f.adil, id, buy)]);
    expect([a.status, b.status]).toEqual(["applied", "applied"]);
    expect([a.replay, b.replay].filter(Boolean)).toHaveLength(1);
    expect((await db.query("SELECT count(*)::int AS n FROM purchases WHERE list_item_id = $1", [item.id])).rows[0].n).toBe(1);
  });

  it("une correction ne peut viser qu'un achat de la même famille et de la liste active", async () => {
    const a = await newFamily();
    const b = await newFamily();
    const ida = await newList(a);
    const idb = await newList(b);
    await one(a.marie, ida, op.add(a.products["Lait"]!));
    await one(a.adil, ida, op.purchase(itemOf(await view(a.adil), a.products["Lait"]!).id));
    const pidA = itemOf(await view(a.adil), a.products["Lait"]!).purchase.id;
    // la famille B vise l'achat de A, via sa propre liste puis via celle de A
    expect((await one(b.adil, idb, op.correct(pidA))).reason).toBe("purchase_unknown");
    expect((await app.inject({ method: "POST", url: `/api/lists/${ida}/ops`, cookies: b.adil, payload: { ops: [op.correct(pidA)] } })).statusCode).toBe(404);
    expect(itemOf(await view(a.adil), a.products["Lait"]!).status).toBe("purchased");
    // l'article d'une autre famille est inconnu
    const itemA = itemOf(await view(a.adil), a.products["Lait"]!).id;
    expect((await one(b.adil, idb, op.purchase(itemA))).reason).toBe("item_unknown");
  });
});

describe("concurrence", () => {
  it("achat contre retrait : un seul des deux gagne, l'état reste cohérent", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const f = await newFamily();
      const id = await newList(f);
      await one(f.marie, id, op.add(f.products["Lait"]!));
      const item = itemOf(await view(f.adil), f.products["Lait"]!);
      const [buy, rem] = await Promise.all([one(f.adil, id, op.purchase(item.id)), one(f.marie, id, op.remove(f.products["Lait"]!, item.rev))]);
      const final = (await db.query("SELECT status FROM list_items WHERE id = $1", [item.id])).rows[0].status;
      if (buy.status === "applied") {
        expect(rem).toMatchObject({ status: "rejected", reason: "locked_purchased" });
        expect(final).toBe("purchased");
        seen.add("buy-first");
      } else {
        expect(buy).toMatchObject({ status: "rejected", reason: "item_removed" });
        expect(rem.status).toBe("applied");
        expect(final).toBe("removed");
        seen.add("remove-first");
      }
      await assertConsistent(id);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it("achat contre achat : un seul achat, l'autre apprend qui a acheté", async () => {
    for (let i = 0; i < 15; i++) {
      const f = await newFamily();
      const id = await newList(f);
      await one(f.marie, id, op.add(f.products["Lait"]!));
      const item = itemOf(await view(f.adil), f.products["Lait"]!);
      const [a, l] = await Promise.all([one(f.adil, id, op.purchase(item.id)), one(f.lamiaa, id, op.purchase(item.id))]);
      expect([a.status, l.status].sort()).toEqual(["already", "applied"]);
      const winner = a.status === "applied" ? "Adil" : "Lamiaa";
      const loser = a.status === "applied" ? l : a;
      expect(loser.detail.purchasedBy.displayName).toBe(winner);
      expect((await db.query("SELECT count(*)::int AS n FROM purchases WHERE list_item_id = $1 AND voided_at IS NULL", [item.id])).rows[0].n).toBe(1);
      await assertConsistent(id);
    }
  });

  it("correction contre nouvel achat : jamais deux achats ouverts, jamais un état contradictoire", async () => {
    for (let i = 0; i < 20; i++) {
      const f = await newFamily();
      const id = await newList(f);
      await one(f.marie, id, op.add(f.products["Lait"]!));
      const item = itemOf(await view(f.adil), f.products["Lait"]!);
      await one(f.adil, id, op.purchase(item.id));
      const p1 = itemOf(await view(f.adil), f.products["Lait"]!).purchase.id;
      const [cor, buy] = await Promise.all([one(f.lamiaa, id, op.correct(p1)), one(f.adil, id, op.purchase(item.id))]);
      expect(cor.status).toBe("applied");
      const open = (await db.query("SELECT id FROM purchases WHERE list_item_id = $1 AND voided_at IS NULL", [item.id])).rows;
      const st = (await db.query("SELECT status FROM list_items WHERE id = $1", [item.id])).rows[0].status;
      if (buy.status === "applied") {
        expect(open).toHaveLength(1); // la correction a eu lieu avant : nouvel achat valide
        expect(open[0].id).not.toBe(p1);
        expect(st).toBe("purchased");
      } else {
        expect(buy.status).toBe("already"); // l'achat est arrivé avant la correction
        expect(open).toHaveLength(0);
        expect(st).toBe("to_buy");
      }
      await assertConsistent(id);
    }
  });

  it("clôture contre toute modification : chaque opération est soit appliquée avant, soit refusée « liste clôturée »", async () => {
    for (let i = 0; i < 15; i++) {
      const f = await newFamily();
      const id = await newList(f);
      await send(f.marie, id, [op.add(f.products["Lait"]!), op.add(f.products["Riz"]!), op.add(f.products["Sucre"]!)]);
      const v = await view(f.adil);
      const lait = itemOf(v, f.products["Lait"]!);
      const riz = itemOf(v, f.products["Riz"]!);
      const [close, add, buy, rem, cor] = await Promise.all([
        app.inject({ method: "POST", url: `/api/lists/${id}/close`, cookies: f.lamiaa }),
        one(f.marie, id, op.add(f.products["Pâtes"]!)),
        one(f.adil, id, op.purchase(lait.id)),
        one(f.marie, id, op.remove(f.products["Riz"]!, riz.rev)),
        one(f.adil, id, op.add(f.products["Café"]!)),
      ]);
      expect(close.statusCode).toBe(200);
      const rows = (await db.query("SELECT p.name, i.status FROM list_items i JOIN products p ON p.id = i.product_id WHERE i.list_id = $1", [id])).rows;
      const state = Object.fromEntries(rows.map((r) => [r.name, r.status]));
      const check = (res: any, applied: boolean) => {
        if (res.status === "applied") expect(applied).toBe(true);
        else expect(res).toMatchObject({ status: "rejected", reason: "list_closed" });
      };
      check(add, state["Pâtes"] === "to_buy");
      check(cor, state["Café"] === "to_buy");
      check(buy, state["Lait"] === "purchased");
      check(rem, state["Riz"] === "removed");
      // les chiffres renvoyés par la clôture correspondent à l'état final de l'archive
      const body = close.json();
      expect(body.remaining).toBe(rows.filter((r) => r.status === "to_buy").length);
      expect(body.purchased).toBe(rows.filter((r) => r.status === "purchased").length);
      await assertConsistent(id);
    }
  });

  const settles = async <T>(p: Promise<T>, ms = 400) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

  it("verrou déterministe : une opération attend une clôture en cours, puis est refusée « liste clôturée »", async () => {
    const f = await newFamily();
    const id = await newList(f);
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT 1 FROM lists WHERE id = $1 FOR UPDATE", [id]); // une clôture est « en cours »
      const pending = one(f.marie, id, op.add(f.products["Lait"]!));
      expect(await settles(pending)).toBe(false); // l'opération attend, elle ne passe pas devant
      const adil = (await db.query("SELECT id FROM profiles WHERE family_id = $1 AND login = 'adil'", [f.familyId])).rows[0].id;
      await c.query("UPDATE lists SET status = 'archived', closed_by = $2, closed_at = now() WHERE id = $1", [id, adil]);
      await c.query("COMMIT");
      expect(await pending).toMatchObject({ status: "rejected", reason: "list_closed" });
    } finally {
      c.release();
    }
    expect((await db.query("SELECT count(*)::int AS n FROM list_items WHERE list_id = $1", [id])).rows[0].n).toBe(0);
  });

  it("verrou déterministe : la clôture attend les opérations en cours avant de figer la liste", async () => {
    const f = await newFamily();
    const id = await newList(f);
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT 1 FROM lists WHERE id = $1 FOR SHARE", [id]); // une opération est « en cours »
      const closing = app.inject({ method: "POST", url: `/api/lists/${id}/close`, cookies: f.lamiaa });
      expect(await settles(closing)).toBe(false);
      await c.query("COMMIT");
      expect((await closing).statusCode).toBe(200);
    } finally {
      c.release();
    }
  });

  it("verrou déterministe : deux opérations sur des articles différents ne se bloquent pas ; sur le même article elles s'enchaînent", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await send(f.marie, id, [op.add(f.products["Lait"]!), op.add(f.products["Riz"]!)]);
    const lait = itemOf(await view(f.adil), f.products["Lait"]!);
    const riz = itemOf(await view(f.adil), f.products["Riz"]!);
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT 1 FROM list_items WHERE id = $1 FOR UPDATE", [lait.id]); // achat du lait « en cours »
      expect(await settles(one(f.adil, id, op.purchase(riz.id)))).toBe(true); // autre article : pas bloqué
      const samePending = one(f.lamiaa, id, op.purchase(lait.id));
      expect(await settles(samePending)).toBe(false); // même article : attend
      await c.query("COMMIT");
      expect((await samePending).status).toBe("applied");
    } finally {
      c.release();
    }
  });

  it("deux clôtures simultanées : une seule effective", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await one(f.marie, id, op.add(f.products["Lait"]!));
    const rs = await Promise.all([f.adil, f.lamiaa, f.adil].map((c) => app.inject({ method: "POST", url: `/api/lists/${id}/close`, cookies: c })));
    expect(rs.map((r) => r.json().status).sort()).toEqual(["already", "already", "applied"]);
  });
});

describe("clôture et archives", () => {
  it("critère 11 : clôturée avec des articles restants, l'archive les garde « à acheter »", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await send(f.marie, id, [op.add(f.products["Lait"]!), op.add(f.products["Riz"]!), op.add(f.products["Sucre"]!)]);
    await one(f.adil, id, op.purchase(itemOf(await view(f.adil), f.products["Lait"]!).id));
    const c = await app.inject({ method: "POST", url: `/api/lists/${id}/close`, cookies: f.lamiaa });
    expect(c.json()).toEqual({ status: "applied", remaining: 2, purchased: 1 });
    const arch = (await app.inject({ method: "GET", url: `/api/lists/${id}`, cookies: f.adil })).json().list;
    expect(arch.status).toBe("archived");
    expect(Object.fromEntries(arch.items.map((i: any) => [i.name, i.status]))).toEqual({ Lait: "purchased", Riz: "to_buy", Sucre: "to_buy" });
    expect(arch.closedBy.displayName).toBe("Lamiaa");
    expect(arch.closedAt).toBeTruthy();
    expect(itemOf(arch, f.products["Lait"]!).purchase.by.displayName).toBe("Adil");
    expect((await view(f.adil))).toBeNull();
  });

  it("une nouvelle liste est vide ; l'historique résume chaque clôture", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await one(f.marie, id, op.add(f.products["Lait"]!));
    await app.inject({ method: "POST", url: `/api/lists/${id}/close`, cookies: f.adil });
    const id2 = await newList(f);
    expect(id2).not.toBe(id);
    expect((await view(f.adil)).items).toEqual([]);
    const h = (await app.inject({ method: "GET", url: "/api/lists", cookies: f.lamiaa })).json().lists;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id, purchased: 0, remaining: 1, corrections: 0, closedBy: { displayName: "Adil" } });
  });

  it("critère 12 : un ancien brouillon ne modifie jamais une liste archivée, ni la nouvelle liste", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await one(f.marie, id, op.add(f.products["Lait"]!));
    const seen = itemOf(await view(f.marie), f.products["Lait"]!);
    await app.inject({ method: "POST", url: `/api/lists/${id}/close`, cookies: f.adil });
    const id2 = await newList(f);

    const r = await send(f.marie, id, [op.add(f.products["Riz"]!), op.remove(f.products["Lait"]!, seen.rev)]);
    expect(r.json().results.map((x: any) => x.reason)).toEqual(["list_closed", "list_closed"]);
    expect((await app.inject({ method: "GET", url: `/api/lists/${id}`, cookies: f.adil })).json().list.items.map((i: any) => i.name)).toEqual(["Lait"]);
    expect((await view(f.adil)).items).toEqual([]); // la nouvelle liste n'a rien reçu
    // reprise explicite : le client renvoie ses ajouts vers la nouvelle liste
    expect((await one(f.marie, id2, op.add(f.products["Lait"]!))).status).toBe("applied");
    // la base elle-même refuse
    await expect(db.query("UPDATE list_items SET rev = rev + 1 WHERE list_id = $1", [id])).rejects.toThrow(/archivée/);
    await expect(db.query("DELETE FROM list_items WHERE list_id = $1", [id])).rejects.toThrow(/archivée/);
    await expect(db.query("INSERT INTO list_items (list_id, family_id, product_id, added_by) SELECT $1, family_id, $2, added_by FROM list_items WHERE list_id = $1", [id, f.products["Riz"]!])).rejects.toThrow(/archivée/);
    await expect(db.query("UPDATE lists SET closed_at = now() WHERE id = $1", [id])).rejects.toThrow(/archivée/);
    await expect(db.query("UPDATE purchases SET void_reason = 'x' WHERE list_id = $1", [id])).resolves.toBeTruthy(); // aucun achat : 0 ligne
  });

  it("critère 15 / huitième décision : renommer ou changer la photo n'altère pas les anciennes listes", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await one(f.marie, id, op.add(f.products["Lait"]!));
    await app.inject({ method: "PATCH", url: `/api/products/${f.products["Lait"]}`, cookies: f.adil, payload: { brand: "Lactel" } });
    const asset = (await db.query(
      `INSERT INTO photo_assets (owner_family_id, storage_key, content_hash, mime, width, height, bytes, source_name, license)
       VALUES ($1, $2, $2, 'image/webp', 480, 480, 10, 'test', 'OWN') RETURNING id`,
      [f.familyId, `photos/${"a".repeat(64)}.webp`],
    )).rows[0].id;
    await db.query("UPDATE products SET photo_asset_id = $2 WHERE id = $1", [f.products["Lait"], asset]);
    await app.inject({ method: "POST", url: `/api/lists/${id}/close`, cookies: f.adil });

    // après clôture : nom, marque et photo changent dans le catalogue
    await app.inject({ method: "PATCH", url: `/api/products/${f.products["Lait"]}`, cookies: f.adil, payload: { name: "Lait demi-écrémé", brand: "Autre" } });
    const asset2 = (await db.query(
      `INSERT INTO photo_assets (owner_family_id, storage_key, content_hash, mime, width, height, bytes, source_name, license)
       VALUES ($1, $2, $2, 'image/webp', 480, 480, 10, 'test', 'OWN') RETURNING id`,
      [f.familyId, `photos/${"b".repeat(64)}.webp`],
    )).rows[0].id;
    await db.query("UPDATE products SET photo_asset_id = $2 WHERE id = $1", [f.products["Lait"], asset2]);

    const arch = (await app.inject({ method: "GET", url: `/api/lists/${id}`, cookies: f.adil })).json().list;
    expect(arch.items[0]).toMatchObject({ name: "Lait", brand: "Lactel", photoUrl: `/api/photos/${asset}` });
    expect(arch.items[0].productId).toBe(f.products["Lait"]); // même identité
    const id2 = await newList(f);
    await one(f.marie, id2, op.add(f.products["Lait"]!));
    expect((await view(f.adil)).items[0]).toMatchObject({ name: "Lait demi-écrémé", brand: "Autre", photoUrl: `/api/photos/${asset2}` });
  });

  it("les droits : le personnel ne clôture pas et ne lit pas l'historique ; parents et administrateur le peuvent", async () => {
    const f = await newFamily();
    const id = await newList(f);
    expect((await app.inject({ method: "POST", url: `/api/lists/${id}/close`, cookies: f.marie })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/lists", cookies: f.marie })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/api/lists/${id}`, cookies: f.marie })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/lists/${id}/close`, cookies: f.lamiaa })).statusCode).toBe(200);
    const id2 = await newList(f);
    expect((await app.inject({ method: "POST", url: `/api/lists/${id2}/close`, cookies: f.adil })).statusCode).toBe(200);
  });

  it("critère 14 : une famille ne lit, ne modifie et ne clôture pas la liste d'une autre", async () => {
    const a = await newFamily();
    const b = await newFamily();
    const ida = await newList(a);
    await newList(b);
    await one(a.marie, ida, op.add(a.products["Lait"]!));
    expect((await app.inject({ method: "GET", url: `/api/lists/${ida}`, cookies: b.adil })).statusCode).toBe(404);
    expect((await send(b.marie, ida, [op.add(b.products["Lait"]!)])).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/lists/${ida}/close`, cookies: b.adil })).statusCode).toBe(404);
    expect((await view(b.adil)).items).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/lists", cookies: b.adil })).json().lists).toEqual([]);
  });
});

describe("produit désactivé", () => {
  it("reste dans la liste active, achetable et retirable, mais non ajoutable ; visible du personnel", async () => {
    const f = await newFamily();
    const id = await newList(f);
    await send(f.marie, id, [op.add(f.products["Lait"]!), op.add(f.products["Riz"]!)]);
    await app.inject({ method: "PATCH", url: `/api/products/${f.products["Lait"]}`, cookies: f.adil, payload: { active: false } });
    await app.inject({ method: "PATCH", url: `/api/products/${f.products["Riz"]}`, cookies: f.adil, payload: { active: false } });

    const staff = await view(f.marie);
    expect(itemOf(staff, f.products["Lait"]!)).toMatchObject({ productActive: false, status: "to_buy" });
    expect((await app.inject({ method: "GET", url: "/api/catalog", cookies: f.marie })).json().categories.flatMap((c: any) => c.products).map((p: any) => p.name)).not.toContain("Lait");

    // achetable
    expect((await one(f.adil, id, op.purchase(itemOf(staff, f.products["Lait"]!).id))).status).toBe("applied");
    // retirable (non acheté), puis non réajoutable
    const riz = itemOf(await view(f.marie), f.products["Riz"]!);
    expect((await one(f.marie, id, op.remove(f.products["Riz"]!, riz.rev))).status).toBe("applied");
    expect((await one(f.marie, id, op.add(f.products["Riz"]!))).reason).toBe("product_inactive");
    // un ajout direct d'un produit désactivé jamais présent est refusé aussi
    await app.inject({ method: "PATCH", url: `/api/products/${f.products["Sucre"]}`, cookies: f.adil, payload: { active: false } });
    expect((await one(f.marie, id, op.add(f.products["Sucre"]!))).reason).toBe("product_inactive");
    // les achats passés restent intacts dans l'archive
    await app.inject({ method: "POST", url: `/api/lists/${id}/close`, cookies: f.adil });
    expect(itemOf((await app.inject({ method: "GET", url: `/api/lists/${id}`, cookies: f.adil })).json().list, f.products["Lait"]!).status).toBe("purchased");
  });
});

describe("temps réel", () => {
  it("publie un événement aux membres de la famille seulement, après validation", async () => {
    const a = await newFamily();
    const b = await newFamily();
    const got: { family: string; event: string; data: any }[] = [];
    const sub = (family: string, familyId: string) =>
      hub.add({ familyId, profileId: randomUUID(), sessionId: randomUUID(), send: (event, data) => got.push({ family, event, data }), close() {} });
    const offA = sub("A", a.familyId);
    const offB = sub("B", b.familyId);
    const id = await newList(a);
    await one(a.marie, id, op.add(a.products["Lait"]!));
    await one(a.marie, id, op.add(a.products["Lait"]!)); // « already » : aucun changement, aucun événement
    offA();
    offB();
    expect(got.every((g) => g.family === "A")).toBe(true);
    expect(got.map((g) => g.event)).toEqual(["list.created", "list.updated"]);
  });
});
