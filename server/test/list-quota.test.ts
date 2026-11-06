import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { quotaActivate, quotaDeactivate } from "../src/list-quota.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
let n = 0;
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, store: testStore(), loginRateLimit: { max: 10_000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  await quotaDeactivate(db); // jamais laissée active pour les autres fichiers de tests
  await app.close();
  await closeTestDb();
});
beforeEach(async () => {
  await quotaDeactivate(db);
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
async function family(multiLists = false) {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `Q${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const familyCode = res.json().familyCode as string;
  const admin = cookieOf(res);
  const mk = async (login: string, role: string) => {
    await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: login, login, role, secret: "573918", secretConfirm: "573918" } });
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login, secret: "573918" } }));
  };
  const parent = await mk("lamiaa", "parent");
  const staff = await mk("marie", "staff");
  if (multiLists) await app.inject({ method: "PUT", url: "/api/family/features", cookies: admin, payload: { multiLists: true } });
  const products = (await app.inject({ method: "GET", url: "/api/catalog", cookies: admin })).json().categories.flatMap((c: any) => c.products);
  const familyId = (await db.query("SELECT id FROM families WHERE code = $1", [familyCode])).rows[0].id as string;
  return { familyId, admin, parent, staff, tomates: products.find((p: any) => p.name === "Tomates").id as string, oignons: products.find((p: any) => p.name === "Oignons").id as string };
}
type F = Awaited<ReturnType<typeof family>>;

const create = (c: any, payload: object = {}) => app.inject({ method: "POST", url: "/api/lists", cookies: c, payload });
const request = (c: any, productId: string, batch = randomUUID()) =>
  app.inject({ method: "POST", url: "/api/lists/active/ops", cookies: c, payload: { ops: [{ opId: randomUUID(), type: "add", productId, quantity: 1 }], batch: { id: batch } } });
const plan = async (c: any) => (await app.inject({ method: "GET", url: "/api/family/plan", cookies: c })).json().plan;
const listCount = async (f: F) => Number((await db.query("SELECT count(*) FROM lists WHERE family_id = $1", [f.familyId])).rows[0].count);
const used = async (f: F) => Number((await db.query("SELECT list_creations_used FROM families WHERE id = $1", [f.familyId])).rows[0].list_creations_used);
const setUsed = (f: F, v: number) => db.query("UPDATE families SET list_creations_used = $2 WHERE id = $1", [f.familyId, v]);
const closeAll = async (f: F) => {
  for (const r of (await db.query("SELECT id FROM lists WHERE family_id = $1 AND status = 'active'", [f.familyId])).rows)
    expect((await app.inject({ method: "POST", url: `/api/lists/${r.id}/close`, cookies: f.admin, payload: {} })).statusCode).toBe(200);
};
const grant = (f: F, kind: "annual" | "lifetime", status: string, expiresInDays: number | null) =>
  db.query(
    `INSERT INTO family_entitlements (family_id, platform, product_id, kind, purchase_key, status, expires_at, environment)
     VALUES ($1, 'google', $2, $3, $4, $5, $6, 'sandbox')`,
    [f.familyId, kind === "annual" ? "courses_famille_annuel" : "courses_famille_a_vie", kind, randomUUID(), status, expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86400_000)],
  );

describe("règle désactivée (état par défaut, production)", () => {
  it("rien n'est compté ni bloqué", async () => {
    const f = await family(true);
    for (let i = 0; i < 12; i++) expect((await create(f.admin)).statusCode).toBe(201);
    expect(await used(f)).toBe(0);
    expect(await plan(f.admin)).toMatchObject({ quotaActive: false, blocked: false, entitlement: null, canPurchase: true });
  });
});

describe("activation explicite", () => {
  it("familles existantes : dix créations gratuites maintenant, anciennes listes non comptées, données intactes", async () => {
    const f = await family(true);
    for (let i = 0; i < 3; i++) await create(f.admin);
    const before = await listCount(f);
    expect((await quotaActivate(db)).familiesStarted).toBeGreaterThan(0);
    expect(await listCount(f)).toBe(before);
    expect(await plan(f.parent)).toMatchObject({ quotaActive: true, freeLimit: 10, used: 0, freeRemaining: 10, blocked: false, canPurchase: false });
  });

  it("une famille créée après l'activation démarre aussitôt ; une deuxième activation ne redonne rien", async () => {
    await quotaActivate(db);
    const f = await family(true);
    expect((await plan(f.admin)).quotaActive).toBe(true);
    await setUsed(f, 7);
    await quotaActivate(db);
    expect(await used(f)).toBe(7);
  });
});

describe("seuils 9 / 10 / 11", () => {
  it("création explicite : la onzième est refusée (409 quota_reached) sans créer de liste", async () => {
    await quotaActivate(db);
    const f = await family(true);
    for (let i = 1; i <= 9; i++) expect((await create(f.admin)).statusCode).toBe(201);
    expect(await plan(f.admin)).toMatchObject({ used: 9, freeRemaining: 1, blocked: false });
    expect((await create(f.parent)).statusCode).toBe(201); // dixième
    expect(await plan(f.admin)).toMatchObject({ used: 10, freeRemaining: 0, blocked: true });
    const count = await listCount(f);
    const r = await create(f.admin, { name: "Onzième" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("quota_reached");
    expect(r.json().message).toMatch(/administrateur/);
    expect(await listCount(f)).toBe(count);
    expect(await used(f)).toBe(10);
  });

  it("création implicite (demande du personnel sans liste en cours) : 404 quota_reached, aucune liste ; la liste en cours reste utilisable", async () => {
    await quotaActivate(db);
    const f = await family();
    expect((await request(f.staff, f.tomates)).statusCode).toBe(200); // création implicite n° 1
    expect(await used(f)).toBe(1);
    await setUsed(f, 10);
    // liste en cours : ajouts, achats et clôture toujours possibles
    expect((await request(f.staff, f.oignons)).statusCode).toBe(200);
    expect(await used(f)).toBe(10);
    await closeAll(f);
    const count = await listCount(f);
    const r = await request(f.staff, f.tomates);
    expect(r.statusCode).toBe(404); // anciennes versions : les articles demandés sont gardés (« Reprendre »)
    expect(r.json().error).toBe("quota_reached");
    expect(await listCount(f)).toBe(count);
    // historique, statistiques et données existantes restent consultables
    expect((await app.inject({ method: "GET", url: "/api/lists", cookies: f.admin })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/stats/purchases", cookies: f.admin })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/catalog", cookies: f.staff })).statusCode).toBe(200);
  });
});

describe("jamais compté deux fois", () => {
  it("« Créer une liste » rejouée (même requestId) : même liste, compteur inchangé", async () => {
    await quotaActivate(db);
    const f = await family(true);
    const requestId = randomUUID();
    const a = await create(f.admin, { requestId });
    const b = await create(f.admin, { requestId });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().list.id).toBe(a.json().list.id);
    expect(await used(f)).toBe(1);
    // même rejouée au seuil : la création d'origine est retrouvée, rien n'est refusé ni recompté
    await setUsed(f, 10);
    expect((await create(f.admin, { requestId })).json().list.id).toBe(a.json().list.id);
    expect(await used(f)).toBe(10);
  });

  it("lot de demandes rejoué après la clôture de la liste qu'il avait créée : aucune nouvelle liste", async () => {
    await quotaActivate(db);
    const f = await family();
    const batch = randomUUID();
    expect((await request(f.staff, f.tomates, batch)).statusCode).toBe(200);
    await closeAll(f);
    const count = await listCount(f);
    await request(f.staff, f.tomates, batch); // réponse perdue, lot renvoyé
    expect(await listCount(f)).toBe(count);
    expect(await used(f)).toBe(1);
  });

  it("créations simultanées au seuil (deux appareils et plus) : exactement une réussit", async () => {
    await quotaActivate(db);
    const f = await family(true);
    await setUsed(f, 9);
    const before = await listCount(f);
    const res = await Promise.all([f.admin, f.parent, f.admin, f.parent, f.admin].map((c) => create(c)));
    expect(res.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(res.filter((r) => r.statusCode === 409 && r.json().error === "quota_reached")).toHaveLength(4);
    expect(await listCount(f)).toBe(before + 1);
    expect(await used(f)).toBe(10);
  });

  it("demandes simultanées sans liste en cours : une seule liste créée et comptée, toutes les demandes y sont", async () => {
    await quotaActivate(db);
    const f = await family();
    await setUsed(f, 5);
    const res = await Promise.all([request(f.staff, f.tomates), request(f.parent, f.oignons), request(f.admin, f.tomates), request(f.staff, f.oignons)]);
    expect(res.every((r) => r.statusCode === 200)).toBe(true);
    expect(await listCount(f)).toBe(1);
    expect(await used(f)).toBe(6);
  });

  it("supprimer, archiver, renommer, consulter : aucun crédit rendu ni consommé", async () => {
    await quotaActivate(db);
    const f = await family();
    const id = (await create(f.admin)).json().list.id as string;
    expect(await used(f)).toBe(1);
    expect((await app.inject({ method: "PATCH", url: `/api/lists/${id}`, cookies: f.admin, payload: { name: "Samedi" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/lists/${id}`, cookies: f.admin })).statusCode).toBe(200);
    await closeAll(f);
    expect((await app.inject({ method: "DELETE", url: `/api/lists/${id}`, cookies: f.admin })).statusCode).toBe(200);
    expect(await used(f)).toBe(1);
    expect((await db.query("SELECT count(*)::int AS n FROM list_creations WHERE family_id = $1", [f.familyId])).rows[0].n).toBe(1); // traçabilité gardée
  });
});

describe("droits payants (famille entière)", () => {
  it("achat à vie : créations au-delà de dix, toujours comptées ; remboursé : bloqué", async () => {
    await quotaActivate(db);
    const f = await family(true);
    await setUsed(f, 10);
    await grant(f, "lifetime", "active", null);
    expect(await plan(f.parent)).toMatchObject({ blocked: false, entitlement: { kind: "lifetime", status: "active" } });
    expect((await create(f.parent)).statusCode).toBe(201);
    expect(await used(f)).toBe(11);
    await db.query("UPDATE family_entitlements SET status = 'refunded' WHERE family_id = $1", [f.familyId]);
    expect((await create(f.admin)).json().error).toBe("quota_reached");
  });

  it("abonnement annulé : accès jusqu'à la fin de la période payée ; expiré : aucun nouveau lot gratuit", async () => {
    await quotaActivate(db);
    const f = await family(true);
    await setUsed(f, 10);
    await grant(f, "annual", "cancelled", 3);
    expect((await create(f.admin)).statusCode).toBe(201);
    await db.query("UPDATE family_entitlements SET expires_at = now() - interval '1 day', status = 'expired' WHERE family_id = $1", [f.familyId]);
    const r = await create(f.admin);
    expect(r.json().error).toBe("quota_reached");
    expect(await plan(f.admin)).toMatchObject({ blocked: true, freeRemaining: 0, entitlement: null });
  });

  it("le même achat ne peut pas être rattaché à deux familles", async () => {
    const a = await family();
    const b = await family();
    const key = randomUUID();
    const ins = (f: F) =>
      db.query("INSERT INTO family_entitlements (family_id, platform, product_id, kind, purchase_key, status, environment) VALUES ($1,'apple','courses_famille_a_vie','lifetime',$2,'active','sandbox')", [f.familyId, key]);
    await ins(a);
    await expect(ins(b)).rejects.toMatchObject({ code: "23505" });
  });
});

describe("retour arrière", () => {
  it("désactivation : plus de blocage, compteurs conservés ; réactivation : pas de nouveau lot", async () => {
    await quotaActivate(db);
    const f = await family(true);
    await setUsed(f, 10);
    expect((await create(f.admin)).json().error).toBe("quota_reached");
    await quotaDeactivate(db);
    expect((await create(f.admin)).statusCode).toBe(201);
    expect(await used(f)).toBe(11); // le compteur continue (famille démarrée)
    await quotaActivate(db);
    expect((await create(f.admin)).json().error).toBe("quota_reached");
  });
});
