import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { photoKeys } from "../src/platform.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

/** Espace plateforme : accès réservé au profil autorisé côté serveur ; photos manquantes et usage, données fictives. */
let db: Db;
let app: FastifyInstance;
type C = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): C => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
let n = 0;

async function family(extraAdmin = false) {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `Plateforme${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const familyCode = res.json().familyCode as string;
  const admin = cookieOf(res);
  const me = (await app.inject({ method: "GET", url: "/api/me", cookies: admin })).json().me;
  let admin2: C | null = null;
  if (extraAdmin) {
    await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: "Karim", login: "karim", role: "admin", secret: "573918", secretConfirm: "573918" } });
    admin2 = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login: "karim", secret: "573918" } }));
  }
  return { admin, admin2, profileId: me.id as string, familyId: me.familyId as string, code: familyCode, name: `Plateforme${n}` };
}
type F = Awaited<ReturnType<typeof family>>;
const get = (c: C | undefined, url: string) => app.inject({ method: "GET", url, cookies: c ?? {} });
const prod = (f: F, name: string, o: { photo?: string | null; catalogKey?: string; extendedKey?: string; category?: string; at?: string; active?: boolean } = {}) =>
  db.query(
    `INSERT INTO products (family_id, category, name, photo_asset_id, catalog_key, extended_id, active, created_at)
     VALUES ($1, $2, $3, $4, $5, (SELECT id FROM extended_catalog WHERE key = $6), $7, coalesce($8::timestamptz, now()))`,
    [f.familyId, o.category ?? "autres", name, o.photo ?? null, o.catalogKey ?? null, o.extendedKey ?? null, o.active ?? true, o.at ?? null],
  );

let A: F, B: F, X: F, D: F;
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, store: testStore(), loginRateLimit: { max: 10_000, timeWindow: "1 minute" } });
  await app.ready();
  A = await family(true); // famille d'Adil, avec un second administrateur
  B = await family(); // une autre famille
  X = await family(); // famille de démonstration (exclue)
  D = await family(); // famille sans articles
  // Données entièrement fictives : on retire les articles de départ créés avec chaque famille.
  await db.query("DELETE FROM products WHERE family_id = ANY ($1)", [[A.familyId, B.familyId, X.familyId, D.familyId]]);
  await db.query("INSERT INTO platform_admins (profile_id, family_id) VALUES ($1, $2)", [A.profileId, A.familyId]); // comme admin-cli platform-grant
  await db.query("INSERT INTO platform_excluded_families (family_id, reason) VALUES ($1, 'demo')", [X.familyId]);
  // Photos fictives : une du catalogue (Pâtes), une propre à la famille A
  await db.query(
    `INSERT INTO photo_assets (id, storage_key, content_hash, mime, width, height, bytes, source_name, license, owner_family_id) VALUES
       ('00000000-0000-0000-0000-00000000c0a1','pk1','ph1','image/webp',10,10,1,'cat','CC0',NULL),
       ('00000000-0000-0000-0000-00000000f0a1','pk2','ph2','image/webp',10,10,1,'fam','OWN',$1)`,
    [A.familyId],
  );
  await db.query("UPDATE initial_catalog SET photo_asset_id = '00000000-0000-0000-0000-00000000c0a1' WHERE key = 'pates'");
  await db.query("UPDATE initial_catalog SET photo_asset_id = NULL WHERE key = 'lait'");
  await db.query("INSERT INTO extended_catalog (category, name, search_text, source, key, unit) VALUES ('epicerie','Pâté','pate','fictif','pate-fictif','piece') ON CONFLICT (key) DO NOTHING");
  // Articles manuels
  await prod(A, "Quinoa", { at: "2026-10-01T10:00:00Z" });
  await prod(B, "quinoas", { at: "2026-10-05T10:00:00Z" });
  await prod(D, "QUINOA ", { photo: null, at: "2026-10-02T10:00:00Z" });
  await prod(A, "Graines de chia", { photo: "00000000-0000-0000-0000-00000000f0a1" }); // photo propre : jamais compté
  await prod(B, "Pate", { at: "2026-10-03T10:00:00Z" }); // ambigu : Pâtes ou Pâté ?
  await prod(A, "The", { at: "2026-10-04T10:00:00Z" }); // proche de « Thé »
  await prod(D, "Laits", { category: "laitages", at: "2026-10-08T10:00:00Z" }); // pluriel évident de « Lait » : rattaché à la référence
  await prod(B, "Pâtes", { category: "epicerie", at: "2026-10-06T10:00:00Z" }); // identique à une référence avec photo, non rattaché
  await prod(A, "Article retiré", { active: false });
  await prod(X, "Quinoa"); // famille exclue
  await prod(X, "Produit démo");
  // Articles rattachés au catalogue sans photo sur l'article
  await prod(A, "Pâtes", { catalogKey: "pates", category: "epicerie", at: "2026-10-07T10:00:00Z" }); // la référence a une photo
  await prod(B, "Pâtes ", { catalogKey: "pates", category: "epicerie" }); // même famille B que l'article manuel « Pâtes » : compté une fois
  await prod(A, "Lait", { catalogKey: "lait", category: "laitages" }); // référence sans photo
  await prod(D, "Lait", { catalogKey: "lait", category: "laitages", photo: "00000000-0000-0000-0000-00000000c0a1" }); // photo affichée : non compté
});
afterAll(async () => {
  // Catalogue de référence remis dans son état (il n'est pas effacé entre les fichiers de tests).
  await db.query("UPDATE initial_catalog SET photo_asset_id = NULL WHERE key = 'pates'");
  await db.query("DELETE FROM extended_catalog WHERE key = 'pate-fictif'");
  await app.close();
  await closeTestDb();
});

describe("espace plateforme : accès", () => {
  it("seul le profil autorisé voit l'espace ; autre administrateur de la même famille, administrateur d'une autre famille, sans session : refusés", async () => {
    expect((await get(A.admin, "/api/me")).json().me.platform).toBe(true);
    expect((await get(A.admin2!, "/api/me")).json().me.platform).toBeUndefined();
    expect((await get(B.admin, "/api/me")).json().me.platform).toBeUndefined();
    for (const url of ["/api/platform/photos", "/api/platform/usage"]) {
      expect((await get(A.admin, url)).statusCode).toBe(200);
      expect((await get(A.admin2!, url)).statusCode).toBe(403);
      expect((await get(B.admin, url)).statusCode).toBe(403);
      expect((await get(undefined, url)).statusCode).toBe(401);
    }
  });

  it("le droit est lié à la famille du profil (impossible de le rattacher à une autre famille) ; retrait immédiat", async () => {
    await expect(db.query("INSERT INTO platform_admins (profile_id, family_id) VALUES ($1, $2)", [A.profileId, B.familyId])).rejects.toThrow();
    await db.query("DELETE FROM platform_admins WHERE profile_id = $1", [A.profileId]);
    expect((await get(A.admin, "/api/platform/photos")).statusCode).toBe(403);
    expect((await get(A.admin, "/api/me")).json().me.platform).toBeUndefined();
    await db.query("INSERT INTO platform_admins (profile_id, family_id) VALUES ($1, $2)", [A.profileId, A.familyId]);
    expect((await get(A.admin, "/api/platform/photos")).statusCode).toBe(200);
  });
});

describe("photos manquantes", () => {
  it("clés de regroupement identiques aux audits SQL validés", () => {
    expect(photoKeys("QUINOA ").k).toBe(photoKeys("quinoas").k);
    expect(photoKeys("Œufs de caille").k).toBe(photoKeys("oeuf de caille").k);
    expect(photoKeys("Pâté").k).not.toBe(photoKeys("Pâtes").k);
    expect(photoKeys("Pâté").k2).toBe(photoKeys("Pâtes").k2);
  });

  it("trois catégories, références dédupliquées, familles jamais comptées deux fois, photos propres et familles exclues ignorées", async () => {
    const r = (await get(A.admin, "/api/platform/photos")).json();
    const find = (name: string) => r.rows.filter((x: any) => x.name === name);
    // Photo à fournir : Quinoa (A, B, D ; famille exclue X ignorée), Lait (référence sans photo, rattaché)
    expect(find("Quinoa")).toHaveLength(1);
    expect(find("Quinoa")[0]).toMatchObject({ bucket: "provide", familiesWithoutPhoto: 3, reference: null, matching: "aucun", lastAddedAt: "2026-10-05T10:00:00.000Z" });
    expect(find("Quinoa")[0].variants).toEqual(["QUINOA", "Quinoa", "quinoas"].sort((a, b) => a.localeCompare(b)));
    // Lait : rattaché (A) + « Laits », variante évidente (D) → une ligne, 2 familles ; la famille D (photo affichée sur son « Lait » rattaché) n'est comptée que pour « Laits »
    expect(find("Lait")).toHaveLength(1);
    expect(find("Lait")[0]).toMatchObject({ bucket: "provide", familiesWithoutPhoto: 2, reference: { name: "Lait", hasPhoto: false }, linkedArticles: 1, manualArticles: 1 });
    // Photo existante à réutiliser : Pâtes = rattachés A et B + manuel B identique → UNE ligne, 2 familles (B une seule fois)
    expect(find("Pâtes")).toHaveLength(1);
    expect(find("Pâtes")[0]).toMatchObject({ bucket: "reuse", familiesWithoutPhoto: 2, reference: { key: "pates", hasPhoto: true }, linkedArticles: 2, manualArticles: 1 });
    // Rapprochements à vérifier : « Pate » ambigu (Pâtes | Pâté), « The » proche de « Thé »
    const pate = r.rows.find((x: any) => x.variants.includes("Pate"));
    expect(pate).toMatchObject({ bucket: "verify", matching: "ambigu" });
    expect(pate.candidates).toEqual(expect.arrayContaining(["Pâtes", "Pâté"]));
    expect(r.rows.find((x: any) => x.variants.includes("The"))).toMatchObject({ bucket: "verify", matching: "proche", candidates: ["Thé"] });
    // Jamais : article avec photo propre, article retiré, famille exclue, ni photo privée
    expect(r.rows.some((x: any) => x.variants.includes("Graines de chia") || x.variants.includes("Article retiré") || x.variants.includes("Produit démo"))).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/\/api\/photos\/|f0a1|c0a1/);
    expect(r.excludedFamilies).toBe(1);
  });

  it("tri « Plus récents »", async () => {
    const r = (await get(A.admin, "/api/platform/photos?sort=recent")).json();
    const dates = r.rows.map((x: any) => x.lastAddedAt ?? "");
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("usage de l'application", () => {
  it("familles inscrites, nouvelles, actives ; listes créées (supprimées comprises, une seule fois) ; classement anonyme ; familles exclues", async () => {
    // Listes fictives : A en crée 2 (une sera supprimée), B en a une ancienne ; X (exclue) une.
    const mk = async (f: F, at?: string) => {
      const r = await app.inject({ method: "POST", url: "/api/lists", cookies: f.admin, payload: {} });
      const id = r.json().list.id as string;
      await app.inject({ method: "POST", url: `/api/lists/${id}/close`, cookies: f.admin, payload: {} });
      if (at) {
        // Liste ancienne : création, clôture et journal datés du passé
        const c = await db.connect(); // base de test : protections des listes archivées levées pour antidater la liste fictive
        try {
          await c.query("BEGIN");
          await c.query("SET LOCAL session_replication_role = replica");
          await c.query("UPDATE lists SET created_at = $2, closed_at = $2 WHERE id = $1", [id, at]);
          await c.query("UPDATE list_events SET at = $2 WHERE list_id = $1", [id, at]);
          await c.query("COMMIT");
        } finally {
          c.release();
        }
      }
      return id;
    };
    const a1 = await mk(A);
    await mk(A);
    await mk(B, "2025-01-15T10:00:00Z");
    await mk(X);
    const del = await app.inject({ method: "DELETE", url: `/api/lists/${a1}`, cookies: A.admin });
    expect([200, 204]).toContain(del.statusCode);
    await db.query("UPDATE families SET created_at = '2025-01-01T00:00:00Z' WHERE id = $1", [B.familyId]);
    const u = (await get(A.admin, "/api/platform/usage?days=30")).json();
    // Familles : A, B, D inscrites (X exclue) ; B ancienne ; actives sur 30 jours : A seulement (B : liste de 2025, D : rien)
    expect(u.families).toMatchObject({ registered: 3, new7: 2, new30: 2, active30: 1, active7: 1 });
    expect(u.activeDefinition).toMatch(/action enregistrée sur une de ses listes/);
    // Listes : A 2 (dont 1 supprimée), B 1 = 3 ; sur 30 jours : A 2 (la supprimée reste datée par le compteur)
    expect(u.lists).toMatchObject({ total: 3, period: 2 });
    expect(u.lists.totalLabel).toMatch(/supprimées/);
    // Classement anonyme : identifiants « F-XXXXXX », aucune donnée de famille
    expect(u.ranking.map((x: any) => [x.total, x.period])).toEqual([[2, 2], [1, 0]]);
    for (const x of u.ranking) expect(x.anon).toMatch(/^F-[0-9A-F]{6}$/);
    const json = JSON.stringify(u);
    for (const f of [A, B, X, D]) {
      expect(json).not.toContain(f.code);
      expect(json).not.toContain(f.familyId);
      expect(json).not.toContain(f.name);
    }
    expect(json).not.toMatch(/Adil|Karim|@/);
    expect(u.excludedFamilies).toBe(1);
  });
});
