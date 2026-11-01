import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import { catalogOrderer, neighbourRank } from "../src/catalog-order.js";
import type { Db } from "../src/db.js";
import { insertPhotoAsset, preparePhoto } from "../src/photos.js";
import { syncCatalogPhotos } from "../src/photos-import.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

/**
 * Lot catalogue du 1er novembre 2026 (migration 029 + images) : nouvelles références, unités, recherche, classement à côté des
 * articles semblables, et rien de ce qui appartient aux familles (identifiants, prix, photos personnelles, favoris) ne bouge.
 */
const MANIFEST = path.resolve(import.meta.dirname, "../catalog-photos/manifest.json");
const MIGRATION = path.resolve(import.meta.dirname, "../migrations/029_catalogue_captures.sql");
let db: Db;
let app: FastifyInstance;
const store = testStore();
type Cookies = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
let n = 0;
async function family() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `Lot${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const admin = cookieOf(res);
  await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: "Marie", login: "marie", role: "staff", secret: "573918", secretConfirm: "573918" } });
  const staff = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: res.json().familyCode, login: "marie", secret: "573918" } }));
  const familyId = (await db.query("SELECT id FROM families WHERE name = $1", [`Lot${n}`])).rows[0].id as string;
  return { admin, staff, familyId };
}
const names = async (cookies: Cookies, cat: string, inactive = false) =>
  ((await app.inject({ method: "GET", url: `/api/catalog${inactive ? "?includeInactive=1" : ""}`, cookies })).json().categories as any[])
    .find((c) => c.key === cat)!.products.map((p: any) => p.name as string);
const addExtended = async (cookies: Cookies, key: string) =>
  (await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies, payload: { origin: "extended", key } })).json().product;

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, store, loginRateLimit: { max: 1000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

describe("voisinages (classement seulement, aucune sous-catégorie)", () => {
  const starting = [
    { category: "epicerie", name: "Huile de table", position: 0 },
    { category: "epicerie", name: "Huile d’olive", position: 1 },
    { category: "epicerie", name: "Sucre", position: 2 },
    { category: "epicerie", name: "Concentré de tomates", position: 3 },
    { category: "epicerie", name: "Sel alimentaire", position: 4 },
    { category: "epicerie", name: "Levure chimique", position: 5 },
  ];
  const order = catalogOrderer(starting);
  const fam = (extra: { name: string; seq: number }[]) =>
    order([...starting.map((s) => ({ ...s, startPos: s.position, seq: s.position, id: s.name })), ...extra.map((e) => ({ category: "epicerie", ...e, id: e.name }))]).map((r) => r.name);
  it("articles de départ dans leur ordre ; un ajout rejoint ses voisins, ou le groupe voisin le plus proche", () => {
    expect(fam([{ name: "Moutarde", seq: 40 }, { name: "Huile d'argan alimentaire", seq: 41 }, { name: "Olives meslala", seq: 42 }, { name: "Pistaches", seq: 43 }, { name: "Article inconnu", seq: 44 }]))
      .toEqual(["Huile de table", "Huile d’olive", "Huile d'argan alimentaire", "Sucre", "Concentré de tomates", "Moutarde", "Olives meslala", "Sel alimentaire", "Levure chimique", "Pistaches", "Article inconnu"]);
  });
  it("indépendant de l'ordre d'ajout pour les articles qui ont des voisins ; les autres restent dans l'ordre d'ajout", () => {
    const a = fam([{ name: "Pistaches", seq: 40 }, { name: "Olives meslala", seq: 41 }, { name: "Zeste", seq: 42 }, { name: "Article", seq: 43 }]);
    const b = fam([{ name: "Article", seq: 40 }, { name: "Olives meslala", seq: 41 }, { name: "Zeste", seq: 42 }, { name: "Pistaches", seq: 43 }]);
    expect(a.filter((x) => !["Zeste", "Article"].includes(x))).toEqual(b.filter((x) => !["Zeste", "Article"].includes(x)));
    expect(a.slice(-2)).toEqual(["Zeste", "Article"]);
    expect(b.slice(-2)).toEqual(["Article", "Zeste"]);
  });
  it("accents, majuscules et pluriels", () => {
    expect(neighbourRank("pain", "Céréales au chocolat")).toBe(neighbourRank("pain", "Granola aux trois chocolats"));
    expect(neighbourRank("epicerie", "Raisins secs blonds")).toBe(neighbourRank("epicerie", "Amandes"));
    expect(neighbourRank("epicerie", "Fèves sèches")).toBe(neighbourRank("epicerie", "Lentilles"));
    expect(neighbourRank("boissons", "Boisson énergisante")).not.toBe(1000);
    expect(neighbourRank("viandes", "Anneaux de calamar")).toBe(neighbourRank("viandes", "Crevettes"));
    expect(neighbourRank("viandes", "Saint-Pierre métallisé")).toBe(neighbourRank("viandes", "Poisson"));
    expect(neighbourRank("laitages", "Œufs")).not.toBe(1000);
  });
  it("le vrai catalogue de départ garde exactement son ordre, et chaque référence du lot a des voisins", async () => {
    const init = (await db.query("SELECT key, category, name, position FROM initial_catalog")).rows as { key: string; category: string; name: string; position: number }[];
    const o = catalogOrderer(init);
    const byPos = [...init].sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.position - b.position)).map((r) => r.key);
    expect(o(init.map((r) => ({ ...r, startPos: r.position }))).map((r) => r.key)).toEqual(byPos);
    const lot = (await db.query("SELECT category, name FROM extended_catalog WHERE source = 'captures-20261101'")).rows;
    expect(lot.filter((r: any) => neighbourRank(r.category, r.name) === 1000).map((r: any) => r.name)).toEqual([]);
  });
});

describe("migration 029", () => {
  it("45 références ajoutées, clés stables, unités sans conversion, identifiants existants réutilisés", async () => {
    const added = (await db.query("SELECT key, category, unit FROM extended_catalog WHERE source = 'captures-20261101'")).rows;
    expect(added).toHaveLength(45);
    const u = Object.fromEntries(added.map((r) => [r.key, r.unit]));
    expect([u["soupe-aux-lentilles"], u["creme-de-poulet"]]).toEqual(["sachet", "sachet"]); // potages en sachets (40 à 100 g)
    expect([u["sauce-algerienne"], u["sauce-barbecue"], u["assaisonnement-au-citron"]]).toEqual(["litre", "litre", "litre"]); // relevés en mL / cL
    expect([u["cola"], u["boisson-energisante"], u["sole"], u["bar"], u["pistaches"]]).toEqual(["litre", "litre", "kg", "kg", "kg"]);
    // aucune référence du lot ne double une clé ou un nom existant
    const dup = (await db.query(
      `SELECT e.key FROM extended_catalog e WHERE e.source = 'captures-20261101' AND (
         EXISTS (SELECT 1 FROM initial_catalog i WHERE lower(i.name) = lower(e.name))
         OR EXISTS (SELECT 1 FROM extended_catalog o WHERE o.id <> e.id AND lower(o.name) = lower(e.name)))`,
    )).rows;
    expect(dup).toEqual([]);
    // références existantes : mêmes clés et unités, mots de recherche complétés
    expect((await db.query("SELECT aliases FROM initial_catalog WHERE key = 'vermicelles'")).rows[0].aliases).toContain("cheveux d'ange");
    expect((await db.query("SELECT aliases, unit FROM initial_catalog WHERE key = 'huile-de-table'")).rows[0]).toMatchObject({ unit: "litre" });
    expect((await db.query("SELECT search_text FROM extended_catalog WHERE key = 'sole'")).rows[0].search_text).toContain("poisson");
    expect((await db.query("SELECT key, category FROM extended_catalog WHERE key IN ('raisins-secs','cereales') ORDER BY key")).rows)
      .toEqual([{ key: "cereales", category: "pain" }, { key: "raisins-secs", category: "epicerie" }]);
    expect((await db.query("SELECT count(*)::int AS n FROM categories")).rows[0].n).toBe(11); // aucune catégorie ajoutée
  });

  it("déplacement de catégorie : les articles des familles suivent seulement s'ils sont restés dans la catégorie d'origine", async () => {
    const A = await family();
    const B = await family();
    const pa = await addExtended(A.admin, "cereales");
    const pb = await addExtended(B.admin, "cereales");
    // état d'avant 029 : Céréales en Épicerie ; la famille B l'avait rangée elle-même dans « Boissons »
    await db.query("UPDATE extended_catalog SET category = 'epicerie' WHERE key = 'cereales'");
    await db.query("UPDATE products SET category = 'epicerie' WHERE id = $1", [pa.id]);
    await db.query("UPDATE products SET category = 'boissons' WHERE id = $1", [pb.id]);
    const revBefore = Number((await db.query("SELECT catalog_rev FROM families WHERE id = $1", [A.familyId])).rows[0].catalog_rev);
    await db.query(await readFile(MIGRATION, "utf8")); // relancée : idempotente, aucun doublon
    expect((await db.query("SELECT count(*)::int AS n FROM extended_catalog WHERE source = 'captures-20261101'")).rows[0].n).toBe(45);
    const after = Object.fromEntries((await db.query("SELECT id, category FROM products WHERE id = ANY($1)", [[pa.id, pb.id]])).rows.map((r) => [r.id, r.category]));
    expect(after).toEqual({ [pa.id]: "pain", [pb.id]: "boissons" }); // même identifiant ; choix de B intact
    // les téléphones rechargent le catalogue (révision augmentée par la migration et par le déplacement de l'article)
    expect(Number((await db.query("SELECT catalog_rev FROM families WHERE id = $1", [A.familyId])).rows[0].catalog_rev)).toBeGreaterThan(revBefore);
  });
});

describe("classement chez une famille et dans le catalogue complet", () => {
  it("un article ajouté puis masqué et réaffiché reste à côté des articles semblables (administrateur et personnel)", async () => {
    const F = await family();
    const before = await names(F.admin, "epicerie");
    expect(before.slice(0, 2)).toEqual(["Huile de table", "Huile d’olive"]); // ordre de départ conservé
    await addExtended(F.admin, "huile-d-argan-alimentaire");
    await addExtended(F.admin, "sauce-barbecue");
    await addExtended(F.admin, "vermicelles-de-chine");
    const after = await names(F.admin, "epicerie");
    expect(after.indexOf("Huile d'argan alimentaire")).toBe(after.indexOf("Huile d’olive") + 1);
    expect(after.indexOf("Vermicelles de Chine")).toBe(after.indexOf("Vermicelles") + 1);
    expect(after.indexOf("Sauce barbecue")).toBe(after.indexOf("Concentré de tomates") + 1);
    expect(after.at(-1)).not.toBe("Vermicelles de Chine");
    expect(await names(F.staff, "epicerie")).toEqual(after); // le personnel voit le même ordre
    // masqué puis réaffiché : même place ; masqué, il ne déplace pas les autres
    const argan = (await db.query("SELECT id FROM products WHERE family_id = $1 AND name = 'Huile d''argan alimentaire'", [F.familyId])).rows[0].id;
    await app.inject({ method: "PATCH", url: `/api/products/${argan}`, cookies: F.admin, payload: { active: false } });
    expect(await names(F.staff, "epicerie")).toEqual(after.filter((x: string) => x !== "Huile d'argan alimentaire"));
    expect(await names(F.admin, "epicerie", true)).toEqual(after);
    await app.inject({ method: "PATCH", url: `/api/products/${argan}`, cookies: F.admin, payload: { active: true } });
    expect(await names(F.staff, "epicerie")).toEqual(after);
    // poissons du lot : à la suite de « Poisson », avant les produits sans voisin
    await addExtended(F.admin, "merguez");
    await addExtended(F.admin, "sole");
    await addExtended(F.admin, "crevettes-roses");
    const v = await names(F.admin, "viandes");
    expect(v.indexOf("Sole")).toBeLessThan(v.indexOf("Merguez"));
    expect(v.indexOf("Sole")).toBeGreaterThan(v.indexOf("Poisson"));
  });

  it("catalogue complet : nouvelles références près des semblables, recherche par nom et par mots relevés", async () => {
    const F = await family();
    const all = async (q: string) => (await app.inject({ method: "GET", url: `/api/catalog/all?${q}`, cookies: F.admin })).json();
    const viandes = (await all("category=viandes&limit=60")).items.map((x: any) => x.name as string);
    const iPoisson = viandes.indexOf("Poisson");
    expect(viandes.slice(iPoisson, iPoisson + 3)).toEqual(["Poisson", "Thon en conserve", "Bar"]); // espèces à la suite, par nom
    expect(viandes.indexOf("Sole")).toBeLessThan(viandes.indexOf("Saucisses"));
    expect(viandes.indexOf("Crevettes grises")).toBe(viandes.indexOf("Crevettes") + 1);
    const fish = (await all("q=poisson&limit=60")).items.map((x: any) => x.name);
    expect(fish).toEqual(expect.arrayContaining(["Poisson", "Sole", "Espadon", "Dorade royale"]));
    expect((await all("q=cheveux%20d%27ange")).items.map((x: any) => x.name)).toContain("Vermicelles");
    expect((await all("q=tournesol")).items.map((x: any) => x.name)).toContain("Huile de table");
    expect((await all("q=soda")).items.map((x: any) => x.name)).toEqual(expect.arrayContaining(["Cola", "Soda à l'orange", "Tonic"]));
    // pagination stable : deux pages consécutives ne se chevauchent pas
    const p1 = (await all("category=epicerie&limit=20&offset=0")).items.map((x: any) => x.key);
    const p2 = (await all("category=epicerie&limit=20&offset=20")).items.map((x: any) => x.key);
    expect(p1.filter((k: string) => p2.includes(k))).toEqual([]);
  });
});

describe("images du lot", () => {
  it("synchronisées par clé stable ; photos personnelles, prix, favoris et identifiants des familles intacts ; relancer ne change rien", async () => {
    const F = await family();
    const sucre = (await db.query("SELECT id, photo_asset_id FROM products WHERE family_id = $1 AND catalog_key = 'sucre'", [F.familyId])).rows[0];
    const farine = (await db.query("SELECT id FROM products WHERE family_id = $1 AND catalog_key = 'farine'", [F.familyId])).rows[0];
    const own = await preparePhoto(store, await sharp({ create: { width: 64, height: 64, channels: 3, background: "#3366cc" } }).png().toBuffer(), { sourceName: "Photo familiale", license: "OWN" });
    const ownId = await insertPhotoAsset(db as any, own, { ownerFamilyId: F.familyId, importedBy: null });
    await db.query("UPDATE products SET photo_asset_id = $2 WHERE id = $1", [sucre.id, ownId]);
    expect((await app.inject({ method: "PUT", url: `/api/products/${farine.id}/price`, cookies: F.admin, payload: { amount: "12,50", refQty: 1, refUnit: "kg" } })).statusCode).toBe(200);
    const price = (await db.query("SELECT amount, ref_qty, ref_unit FROM family_prices WHERE product_id = $1", [farine.id])).rows[0];
    const me = (await db.query("SELECT id FROM profiles WHERE family_id = $1 AND login = 'adil'", [F.familyId])).rows[0].id;
    const tpl = (await db.query("INSERT INTO list_templates (family_id, name, created_by) VALUES ($1, 'Semaine', $2) RETURNING id", [F.familyId, me])).rows[0].id;
    await db.query("INSERT INTO list_template_items (template_id, product_id, quantity, unit) VALUES ($1, $2, 2, 'kg')", [tpl, farine.id]);
    const idsBefore = (await db.query("SELECT id, name FROM products WHERE family_id = $1 ORDER BY id", [F.familyId])).rows;

    await syncCatalogPhotos(db, store, MANIFEST);
    const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
    const lot = manifest.items.filter((i: any) => i.file && /lot du 1er novembre|captures du 1er novembre/i.test(i.source ?? ""));
    expect(lot).toHaveLength(77); // 81 images du lot, sauf 4 visuels fournis par l'éditeur (022), conservés
    const editor = manifest.items.filter((i: any) => ["semoule-fine", "couscous", "farine-complete", "farine-fino"].includes(i.key));
    expect(editor.map((i: any) => i.sourceName)).toEqual(Array(4).fill("Visuel fourni par l'éditeur de Mes Courses"));
    // chaque référence du lot porte l'image du manifeste (512 × 512, WebP)
    for (const it of lot) {
      const table = it.target === "initial" ? "initial_catalog" : "extended_catalog";
      const r = (await db.query(`SELECT a.source_sha256 FROM ${table} t JOIN photo_assets a ON a.id = t.photo_asset_id WHERE t.key = $1`, [it.key])).rows[0];
      expect([it.key, r?.source_sha256]).toEqual([it.key, it.sha256]);
    }
    const famille = (await db.query("SELECT id, photo_asset_id FROM products WHERE id = ANY($1)", [[sucre.id, farine.id]])).rows;
    const farineRef = (await db.query("SELECT photo_asset_id FROM initial_catalog WHERE key = 'farine'")).rows[0].photo_asset_id;
    expect(famille.find((x) => x.id === sucre.id)!.photo_asset_id).toBe(ownId); // photo personnelle jamais remplacée
    expect(famille.find((x) => x.id === farine.id)!.photo_asset_id).toBe(farineRef); // image commune : suit le catalogue
    expect((await db.query("SELECT amount, ref_qty, ref_unit FROM family_prices WHERE product_id = $1", [farine.id])).rows[0]).toEqual(price);
    expect((await db.query("SELECT product_id, quantity::float AS q FROM list_template_items WHERE template_id = $1", [tpl])).rows).toEqual([{ product_id: farine.id, q: 2 }]);
    expect((await db.query("SELECT id, name FROM products WHERE family_id = $1 ORDER BY id", [F.familyId])).rows).toEqual(idsBefore); // rien d'ajouté ni de renommé
    const again = await syncCatalogPhotos(db, store, MANIFEST);
    expect(again.imported).toEqual([]);
  });
});
