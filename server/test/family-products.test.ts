import type { FastifyInstance } from "fastify";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { syncCatalogPhotos } from "../src/photos-import.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
const store = testStore();
let n = 0;
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, store, loginRateLimit: { max: 1000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  // Les catalogues communs ne sont pas vidés entre fichiers de test : retirer la référence publiée par ce test.
  await db.query("UPDATE products SET extended_id = NULL WHERE extended_id IN (SELECT id FROM extended_catalog WHERE source = 'proposal')");
  await db.query("DELETE FROM catalog_proposals");
  await db.query("DELETE FROM extended_catalog WHERE source = 'proposal'");
  await app.close();
  await closeTestDb();
});
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
async function newFamily() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `F${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const admin = cookieOf(res);
  await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: "marie", login: "marie", role: "staff", secret: "573918", secretConfirm: "573918" } });
  const staff = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: res.json().familyCode, login: "marie", secret: "573918" } }));
  const me = (await app.inject({ method: "GET", url: "/api/gestion/me", cookies: admin })).json();
  return { admin, staff, adminId: me.profileId as string };
}
const catalogNames = async (cookies: any) =>
  ((await app.inject({ method: "GET", url: "/api/catalog", cookies })).json().categories as any[]).flatMap((c) => c.products.map((p: any) => p.name));

describe("catalogue : six références et leurs photos", () => {
  it("références, unités, recherche Nutella, et photos fournies", async () => {
    const refs = (await db.query(
      `SELECT name, unit, search_text AS s FROM extended_catalog WHERE key IN ('farine-fino','farine-force','pate-a-tartiner-nutella','couscous','farine-complete','pate-a-tartiner')
       UNION ALL SELECT name, unit, aliases FROM initial_catalog WHERE key IN ('semoule-fine','farine')`,
    )).rows;
    const by = Object.fromEntries(refs.map((r) => [r.name, r]));
    for (const k of ["Farine fino", "Farine force", "Semoule fine", "Semoule couscous", "Farine complète"]) expect(by[k]?.unit, k).toBe("kg");
    expect(by["Pâte à tartiner Nutella"].unit).toBe("pot");
    expect(by["Farine"]).toBeTruthy(); // la farine actuelle reste
    expect(by["Pâte à tartiner"]).toBeTruthy(); // la générique reste
    for (const q of ["nutella", "chocolat a tartiner", "pate a tartiner"]) expect(by["Pâte à tartiner Nutella"].s).toContain(q);
    expect((await db.query("SELECT 1 FROM categories WHERE key = 'autres' AND label = 'Autres'")).rows).toHaveLength(1);
    expect((await db.query("SELECT 1 FROM extended_catalog WHERE lower(name) LIKE '%luxe%'")).rows).toHaveLength(0);

    await syncCatalogPhotos(db, store, path.resolve("catalog-photos/manifest.json"));
    const photos = (await db.query(
      `SELECT c.name, a.source_name FROM extended_catalog c JOIN photo_assets a ON a.id = c.photo_asset_id WHERE c.key IN ('farine-fino','farine-force','pate-a-tartiner-nutella','couscous','farine-complete')
       UNION ALL SELECT c.name, a.source_name FROM initial_catalog c JOIN photo_assets a ON a.id = c.photo_asset_id WHERE c.key = 'semoule-fine'`,
    )).rows;
    expect(photos).toHaveLength(6);
    expect(photos.every((p) => p.source_name === "Visuel fourni par l'éditeur de Mes Courses")).toBe(true);
  }, 120_000);

  it("Couscous déjà dans une famille : renommé seulement s'il gardait le nom du catalogue (cas couvert par la migration)", async () => {
    const r = (await db.query("SELECT former_names FROM extended_catalog WHERE key = 'couscous'")).rows[0];
    expect(r.former_names).toContain("couscous");
  });
});

describe("produit créé par la famille", () => {
  it("le personnel crée un produit (Autres, icône neutre) ; double envoi sans doublon ; invisible des autres familles", async () => {
    const a = await newFamily();
    const b = await newFamily();
    const r1 = await app.inject({ method: "POST", url: "/api/products/family", cookies: a.staff, payload: { name: "Harissa  du bled" } });
    expect(r1.statusCode).toBe(201);
    const p = r1.json().product;
    expect(p).toMatchObject({ name: "Harissa du bled", category: "autres", unit: "piece", photoUrl: null, own: true, active: true });
    const r2 = await app.inject({ method: "POST", url: "/api/products/family", cookies: a.staff, payload: { name: "harissa du bled" } });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().product.id).toBe(p.id);
    expect(await catalogNames(a.staff)).toContain("Harissa du bled");
    expect(await catalogNames(b.admin)).not.toContain("Harissa du bled");
    expect((await app.inject({ method: "POST", url: `/api/products/${p.id}/propose`, cookies: b.admin, payload: {} })).statusCode).toBe(404);
    // Ajouter le produit à la liste reste soumis aux règles habituelles (le personnel peut faire une demande sur la liste en cours)
    const ops = await app.inject({ method: "POST", url: "/api/lists/active/ops", cookies: a.staff, payload: { ops: [{ opId: crypto.randomUUID(), type: "add", productId: p.id, quantity: 1 }] } });
    expect(ops.statusCode).toBeLessThan(300);
    // Aucun droit en plus : le personnel ne gère toujours ni le catalogue ni les membres
    expect((await app.inject({ method: "PATCH", url: `/api/products/${p.id}`, cookies: a.staff, payload: { active: false } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/profiles", cookies: a.staff })).statusCode).toBe(403);
  });

  it("un nom de référence commune donne la référence (photo comprise), pas un doublon ; un produit masqué n'est pas réactivé par le personnel", async () => {
    const a = await newFamily();
    const r = (await app.inject({ method: "POST", url: "/api/products/family", cookies: a.staff, payload: { name: "Farine force" } })).json();
    expect(r.product.own).toBe(false);
    expect(r.product.unit).toBe("kg");
    const sug = (await app.inject({ method: "GET", url: "/api/catalog/suggest?q=nutella", cookies: a.staff })).json();
    expect(sug.results.map((x: any) => x.name)).toContain("Pâte à tartiner Nutella");
    const lait = (await app.inject({ method: "GET", url: "/api/catalog", cookies: a.admin })).json().categories.flatMap((c: any) => c.products).find((p: any) => p.name === "Lait");
    await app.inject({ method: "PATCH", url: `/api/products/${lait.id}`, cookies: a.admin, payload: { active: false } });
    expect((await app.inject({ method: "POST", url: "/api/products/family", cookies: a.staff, payload: { name: "Lait" } })).statusCode).toBe(409);
  });
});

describe("propositions et espace /gestion", () => {
  it("/gestion : connexion exigée, refusé aux administrateurs de famille, ouvert aux gestionnaires inscrits", async () => {
    const a = await newFamily();
    expect((await app.inject({ method: "GET", url: "/gestion" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/gestion/proposals" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/gestion/proposals", cookies: a.admin })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/gestion/proposals", cookies: a.staff })).statusCode).toBe(403);

    const p = (await app.inject({ method: "POST", url: "/api/products/family", cookies: a.staff, payload: { name: "Lait d'avoine", category: "boissons", unit: "brique" } })).json().product;
    const pr = await app.inject({ method: "POST", url: `/api/products/${p.id}/propose`, cookies: a.staff, payload: { description: "Brique de 1 L" } });
    expect(pr.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/api/products/${p.id}/propose`, cookies: a.staff, payload: {} })).statusCode).toBe(200); // pas de doublon

    const m = await newFamily();
    await db.query("INSERT INTO catalog_managers (profile_id) VALUES ($1)", [m.adminId]);
    const list = (await app.inject({ method: "GET", url: "/api/gestion/proposals", cookies: m.admin })).json();
    const got = list.proposals.find((x: any) => x.name === "Lait d'avoine");
    expect(got).toMatchObject({ description: "Brique de 1 L", unit: "brique", families: 1 });
    // jamais la famille (l'identifiant aléatoire de la proposition est exclu : ses chiffres hexadécimaux peuvent contenir « f5 »)
    const { id: _proposalId, ...shown } = got;
    expect(JSON.stringify(shown)).not.toMatch(/F\d|family/i);

    // Rien n'est public avant acceptation
    expect((await db.query("SELECT 1 FROM extended_catalog WHERE name = 'Boisson d''avoine'")).rows).toHaveLength(0);
    const acc = await app.inject({ method: "POST", url: `/api/gestion/proposals/${got.id}/accept`, cookies: m.admin, payload: { name: "Boisson d'avoine", category: "boissons", unit: "brique" } });
    expect(acc.statusCode).toBe(200);
    const after = (await db.query("SELECT name, extended_id FROM products WHERE id = $1", [p.id])).rows[0];
    expect(after.name).toBe("Lait d'avoine"); // nom de la famille gardé
    expect(after.extended_id).toBeTruthy(); // rattaché
    expect((await app.inject({ method: "POST", url: `/api/gestion/proposals/${got.id}/reject`, cookies: m.admin, payload: {} })).statusCode).toBe(409);
  });
});
