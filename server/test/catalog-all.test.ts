import type { FastifyInstance } from "fastify";
import sharp from "sharp";
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
afterAll(async () => {
  await app.close();
  await closeTestDb();
});
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
async function newFamily() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `A${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const admin = cookieOf(res);
  await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: "marie", login: "marie", role: "staff", secret: "573918", secretConfirm: "573918" } });
  const staff = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: res.json().familyCode, login: "marie", secret: "573918", secretConfirm: "573918" } }));
  return { admin, staff };
}
const all = async (cookies: any, qs = "") => (await app.inject({ method: "GET", url: `/api/catalog/all${qs}`, cookies })).json();

describe("catalogue complet (Tous les produits)", () => {
  it("s'ouvre sans recherche, page par page, sans doublon ni perte (plus de 20 résultats)", async () => {
    const f = await newFamily();
    const first = await all(f.admin, "?limit=60");
    expect(first.total).toBeGreaterThanOrEqual(180);
    const seen = new Set<string>();
    for (let off = 0; off < first.total; off += 24) {
      const p = await all(f.admin, `?offset=${off}&limit=24`);
      for (const it of p.items) {
        const id = `${it.origin}:${it.key}`;
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(first.total);
    const fruits = await all(f.admin, "?category=fruits&limit=60");
    expect(fruits.items.every((i: any) => i.category === "fruits")).toBe(true);
    expect(fruits.total).toBeGreaterThan(20);
  });

  it("recherche commune (accents, casse) dans le catalogue de départ et étendu", async () => {
    const f = await newFamily();
    expect((await all(f.admin, "?q=PÊCHES")).items.map((i: any) => i.name)).toContain("Pêches");
    expect((await all(f.admin, "?q=oeufs")).items.map((i: any) => i.name)).toContain("Œufs");
    expect((await all(f.admin, "?q=%25%25")).total).toBe(0);
  });

  it("filtre par état, compteurs réels et « présents d'abord » (application Android)", async () => {
    const f = await newFamily();
    const c0 = (await all(f.admin, "?counts=1&limit=1")).counts;
    expect(c0.active + c0.inactive + c0.absent).toBe((await all(f.admin, "?limit=1")).total);
    expect(c0.active).toBeGreaterThanOrEqual(80);       // le catalogue de départ est copié à l'installation
    expect(c0.absent).toBeGreaterThan(50);              // le catalogue étendu reste à ajouter
    const todo = await all(f.admin, "?status=todo&limit=60&counts=1");
    expect(todo.total).toBe(c0.inactive + c0.absent);
    expect(todo.items.every((i: any) => i.status !== "active")).toBe(true);
    expect((await all(f.admin, "?status=active&limit=60")).items.every((i: any) => i.status === "active")).toBe(true);
    // Retirer (désactiver) : l'article passe de « dans mon catalogue » à « à ajouter », et le compteur suit.
    const first = (await all(f.admin, "?status=active&limit=1")).items[0];
    expect((await app.inject({ method: "PATCH", url: `/api/products/${first.productId}`, cookies: f.admin, payload: { active: false } })).statusCode).toBe(200);
    const c1 = (await all(f.admin, "?counts=1&limit=1")).counts;
    expect(c1).toEqual({ active: c0.active - 1, inactive: c0.inactive + 1, absent: c0.absent });
    expect((await all(f.admin, "?status=inactive&limit=60")).items.map((i: any) => i.productId)).toEqual([first.productId]);
    // « Tous » : les articles présents d'abord, puis les absents ; les compteurs suivent la recherche et la catégorie.
    const page = (await all(f.admin, "?presentFirst=1&offset=50&limit=60")).items.map((i: any) => i.status === "active");
    expect(page.indexOf(false)).toBeGreaterThan(-1);
    expect(page.slice(page.indexOf(false)).every((x: boolean) => x === false)).toBe(true);
    const peches = (await all(f.admin, "?q=peches&counts=1&limit=5")).counts;
    expect(peches.active + peches.inactive + peches.absent).toBe((await all(f.admin, "?q=peches")).total);
    // Réversible : on le remet, rien n'est détruit.
    await app.inject({ method: "PATCH", url: `/api/products/${first.productId}`, cookies: f.admin, payload: { active: true } });
    expect((await all(f.admin, "?counts=1&limit=1")).counts).toEqual(c0);
    // Droits : réservé à l'administrateur.
    expect((await app.inject({ method: "GET", url: "/api/catalog/all?counts=1", cookies: f.staff })).statusCode).toBe(403);
  });

  it("états absent / actif / désactivé ; réactive au lieu de recréer ; un article saisi à la main n'est jamais doublé", async () => {
    const f = await newFamily();
    const find = async (q: string) => (await all(f.admin, `?q=${encodeURIComponent(q)}`)).items.find((i: any) => i.name === q);
    expect((await find("Tomates")).status).toBe("active");
    expect((await find("Pêches")).status).toBe("absent");
    const add = await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "extended", key: "peches" } });
    expect(add.statusCode).toBe(201);
    const id = add.json().product.id;
    expect((await find("Pêches")).status).toBe("active");
    expect((await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "extended", key: "peches" } })).json()).toMatchObject({ created: false, reactivated: false });
    await app.inject({ method: "PATCH", url: `/api/products/${id}`, cookies: f.admin, payload: { active: false } });
    expect((await find("Pêches")).status).toBe("inactive");
    const re = await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "extended", key: "peches" } });
    expect(re.statusCode).toBe(200);
    expect(re.json()).toMatchObject({ created: false, reactivated: true, product: { id, active: true } });
    // article saisi à la main, même nom : reconnu, pas de second article
    await app.inject({ method: "POST", url: "/api/products", cookies: f.admin, payload: { name: "Melon", category: "fruits" } });
    expect((await find("Melon")).status).toBe("active");
    const dup = await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "extended", key: "melon" } });
    expect(dup.json()).toMatchObject({ created: false });
    const n = (await db.query("SELECT count(*)::int AS n FROM products p JOIN families f ON f.id = p.family_id WHERE lower(p.name) = 'melon'")).rows[0].n;
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("aucun droit nouveau : refusé au personnel, clé inconnue = 404", async () => {
    const f = await newFamily();
    expect((await app.inject({ method: "GET", url: "/api/catalog/all", cookies: f.staff })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.staff, payload: { origin: "extended", key: "peches" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "extended", key: "nexiste-pas" } })).statusCode).toBe(404);
  });

  it("audit : source de la photo et partage entre noms différents", async () => {
    const f = await newFamily();
    const rows = (await app.inject({ method: "GET", url: "/api/catalog/audit", cookies: f.admin })).json().products;
    expect(rows.length).toBe(80);
    expect(rows.find((r: any) => r.name === "Tomates").photoSource).toMatch(/catalogue|none/);
    expect((await app.inject({ method: "GET", url: "/api/catalog/audit", cookies: f.staff })).statusCode).toBe(403);
  });

  it("décisions validées : Laitue trouvable par « salade », huile végétale, Sel alimentaire, Boisson végétale, Gâteaux secs marocains", async () => {
    const f = await newFamily();
    const names = async (q: string) => (await all(f.admin, `?q=${encodeURIComponent(q)}`)).items.map((i: any) => i.name);
    expect(await names("salade")).toContain("Laitue");
    expect(await names("salade verte")).toEqual(["Laitue"]); // une seule entrée équivalente
    expect(await names("huile végétale")).toContain("Huile de table");
    expect((await names("huile")).filter((n: string) => n === "Huile de table")).toHaveLength(1);
    expect(await names("sel")).toEqual(expect.arrayContaining(["Sel alimentaire", "Sel régénérant pour lave-vaisselle"]));
    for (const q of ["amande", "avoine", "soja", "riz"]) expect(await names(q)).toContain("Boisson végétale");
    expect(await names("Lait d'amande")).toContain("Boisson végétale");
    expect(await names("gâteaux secs")).toContain("Gâteaux secs marocains");
    for (const n of ["Pain", "Baguette", "Pain de mie", "Pain complet", "Raisins", "Raisins secs", "Fèves fraîches", "Fèves sèches", "Beurre", "Smen", "Maïs frais", "Maïs en conserve", "Piments frais", "Piment en poudre", "Papier cuisson", "Papier aluminium", "Film alimentaire"])
      expect((await all(f.admin, "?limit=60&offset=0")).total).toBeGreaterThan(0), expect((await all(f.admin, `?q=${encodeURIComponent(n)}&limit=60`)).items.map((i: any) => i.name)).toContain(n);
  });

  it("une famille qui avait « Salade verte » retrouve ce même article sous Laitue : pas de nouvelle entrée, identifiant conservé", async () => {
    const f = await newFamily();
    const fam = (await db.query("SELECT id FROM families ORDER BY created_at DESC LIMIT 1")).rows[0].id;
    await db.query("UPDATE products SET active = false WHERE family_id = $1 AND catalog_key = 'laitue'", [fam]);
    await db.query("UPDATE products SET catalog_key = NULL, name = 'Salade verte', extended_id = (SELECT id FROM extended_catalog WHERE key = 'salade-verte'), active = true WHERE family_id = $1 AND catalog_key = 'laitue'", [fam]);
    const it = (await all(f.admin, "?q=laitue")).items;
    expect(it).toHaveLength(1);
    expect(it[0]).toMatchObject({ name: "Laitue", status: "active" });
    const before = (await db.query("SELECT id FROM products WHERE family_id = $1 AND name = 'Salade verte'", [fam])).rows[0].id;
    expect(it[0].productId).toBe(before);
    const add = await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "initial", key: "laitue" } });
    expect(add.json()).toMatchObject({ created: false, product: { id: before } });
    expect((await db.query("SELECT count(*)::int AS n FROM products WHERE family_id = $1 AND lower(name) IN ('laitue','salade verte')", [fam])).rows[0].n).toBe(1);
  });

  it("aucun nouvel article n'est activé dans une famille ; unités proposées (bouteille pour les huiles, boîte pour les conserves)", async () => {
    const f = await newFamily();
    const fam = (await db.query("SELECT id FROM families ORDER BY created_at DESC LIMIT 1")).rows[0].id;
    expect((await db.query("SELECT count(*)::int AS n FROM products WHERE family_id = $1", [fam])).rows[0].n).toBe(80);
    const unitOf = async (name: string) => (await all(f.admin, `?q=${encodeURIComponent(name)}`)).items.find((i: any) => i.name === name).unit;
    expect(await unitOf("Huile de table")).toBe("bouteille");
    expect(await unitOf("Huile d’olive")).toBe("bouteille");
    expect(await unitOf("Thon en conserve")).toBe("boite");
    expect(await unitOf("Sardines en conserve")).toBe("boite");
    expect(await unitOf("Smen")).toBe("pot");
    const add = await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: f.admin, payload: { origin: "extended", key: "smen" } });
    expect(add.json().product.unit).toBe("pot");
  });

  it("audit + remplacement : une photo personnelle erronée est remplacée par la photo du catalogue du même nom, les autres photos personnelles sont intactes", async () => {
    const f = await newFamily();
    const fam = (await db.query("SELECT id FROM families ORDER BY created_at DESC LIMIT 1")).rows[0].id;
    const png = (await sharp({ create: { width: 32, height: 32, channels: 3, background: "#aa3333" } }).png().toBuffer()).toString("base64");
    const mk = async (name: string) => (await app.inject({ method: "POST", url: "/api/products", cookies: f.admin, payload: { name, category: "maison", image: png } })).json().product.id;
    const papier = await mk("Papier cuisson");
    const autre = await mk("Boîte à tartes");
    // le catalogue reçoit (plus tard) la bonne photo de « Papier cuisson »
    const asset = (await db.query("INSERT INTO photo_assets (owner_family_id, storage_key, content_hash, mime, width, height, bytes, source_name, license) VALUES (NULL,'k','h','image/webp',512,512,1,'test','GENERATED') RETURNING id")).rows[0].id;
    await db.query("UPDATE extended_catalog SET photo_asset_id = $1 WHERE key = 'papier-cuisson'", [asset]);
    const audit = async () => (await app.inject({ method: "GET", url: "/api/catalog/audit", cookies: f.admin })).json().products;
    const a1 = (await audit()).find((p: any) => p.id === papier);
    expect(a1).toMatchObject({ photoSource: "famille", catalogPhotoUrl: `/api/photos/${asset}` });
    expect((await audit()).find((p: any) => p.id === autre).catalogPhotoUrl).toBeNull(); // pas d'approximation par catégorie
    const r = await app.inject({ method: "PATCH", url: `/api/products/${papier}`, cookies: f.admin, payload: { resetImage: true } });
    expect(r.json().product.photoUrl).toBe(`/api/photos/${asset}`);
    const other = (await db.query("SELECT a.owner_family_id FROM products p JOIN photo_assets a ON a.id = p.photo_asset_id WHERE p.id = $1", [autre])).rows[0];
    expect(other.owner_family_id).toBe(fam);
    await db.query("UPDATE extended_catalog SET photo_asset_id = NULL WHERE key = 'papier-cuisson'");
  });
});
