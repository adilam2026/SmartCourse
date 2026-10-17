import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
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
afterAll(async () => { await app.close(); await closeTestDb(); });
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
async function family() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `M${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const admin = cookieOf(res);
  await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: "Lamiaa", login: "lamiaa", role: "parent", secret: "573918", secretConfirm: "573918" } });
  const parent = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: res.json().familyCode, login: "lamiaa", secret: "573918" } }));
  const products = (await app.inject({ method: "GET", url: "/api/catalog", cookies: admin })).json().categories.flatMap((c: any) => c.products);
  return { admin, parent, tomates: products.find((p: any) => p.name === "Tomates").id as string };
}
const add = (cookies: any, url: string, productId: string, quantity: number) =>
  app.inject({ method: "POST", url, cookies, payload: { ops: [{ opId: randomUUID(), type: "add", productId, quantity }] } });
const active = async (cookies: any) => (await app.inject({ method: "GET", url: "/api/lists/active", cookies })).json().list;

describe("plusieurs listes actives (option avancée)", () => {
  it("désactivée par défaut : une seule liste en cours, comme avant", async () => {
    const f = await family();
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: f.admin })).json().me.features).toEqual({ multiLists: false, budget: false });
    expect((await app.inject({ method: "POST", url: "/api/lists", cookies: f.admin, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/lists", cookies: f.admin, payload: { name: "Autre" } })).json().error).toBe("active_exists");
    expect((await app.inject({ method: "PUT", url: "/api/family/features", cookies: f.parent, payload: { multiLists: true } })).statusCode).toBe(403);
  });

  it("activée : listes nommées indépendantes, liste consultée par profil, désactivation refusée tant que plusieurs listes sont en cours", async () => {
    const f = await family();
    expect((await add(f.admin, "/api/lists/active/ops", f.tomates, 3)).statusCode).toBe(200);
    const first = (await active(f.admin)).id;
    expect((await app.inject({ method: "PUT", url: "/api/family/features", cookies: f.admin, payload: { multiLists: true } })).json().features.multiLists).toBe(true);
    const fete = (await app.inject({ method: "POST", url: "/api/lists", cookies: f.admin, payload: { name: "Fête de samedi" } })).json().list;
    expect(fete.name).toBe("Fête de samedi");
    expect((await active(f.admin)).id).toBe(fete.id); // l'auteur consulte la nouvelle liste
    expect((await active(f.parent)).id).toBe(fete.id); // sans choix enregistré : la plus récente
    // même produit, quantités indépendantes ; la création n'a déplacé aucun article
    expect((await add(f.admin, `/api/lists/${fete.id}/ops`, f.tomates, 1)).statusCode).toBe(200);
    const qty = async (id: string) => (await app.inject({ method: "GET", url: `/api/lists/${id}`, cookies: f.admin })).json().list.items.map((i: any) => i.quantity);
    expect((await qty(first)).map(Number)).toEqual([3]);
    expect((await qty(fete.id)).map(Number)).toEqual([1]);
    const open = (await app.inject({ method: "GET", url: "/api/lists/open", cookies: f.parent })).json().lists;
    expect(open.map((l: any) => [l.name, l.remaining])).toEqual(expect.arrayContaining([["Fête de samedi", 1], [null, 1]]));
    // choisir la liste consultée
    expect((await app.inject({ method: "PUT", url: "/api/me/current-list", cookies: f.parent, payload: { listId: first } })).statusCode).toBe(200);
    expect((await active(f.parent)).id).toBe(first);
    expect((await active(f.admin)).id).toBe(fete.id);
    // désactivation refusée : rien n'est fusionné ni supprimé
    const off = await app.inject({ method: "PUT", url: "/api/family/features", cookies: f.admin, payload: { multiLists: false } });
    expect([off.statusCode, off.json().error]).toEqual([409, "multiple_active_lists"]);
    expect((await qty(first)).map(Number)).toEqual([3]);
    // après clôture de l'une, désactivation possible ; puis de nouveau une seule liste à la fois
    expect((await app.inject({ method: "POST", url: `/api/lists/${fete.id}/close`, cookies: f.admin, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/api/family/features", cookies: f.admin, payload: { multiLists: false } })).json().features.multiLists).toBe(false);
    expect((await active(f.admin)).id).toBe(first);
    expect((await app.inject({ method: "POST", url: "/api/lists", cookies: f.admin, payload: {} })).json().error).toBe("active_exists");
  });
});
