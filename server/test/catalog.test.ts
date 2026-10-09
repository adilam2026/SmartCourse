import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { checkLicense, savePhotoAsset } from "../src/photos.js";
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
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });

async function newFamily() {
  const res = await app.inject({
    method: "POST",
    url: "/api/setup/family",
    payload: { installToken: await generateInstallToken(db), familyName: `F${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } },
  });
  const admin = cookieOf(res);
  const mk = async (role: string, login: string) => {
    await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: login, login, role, secret: "573918" } });
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: res.json().familyCode, login, secret: "573918" } }));
  };
  return { admin, staff: await mk("staff", "marie"), parent: await mk("parent", "lamiaa"), familyCode: res.json().familyCode as string };
}

const png = (color: string, w = 900, h = 600) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

describe("catalogue initial", () => {
  it("contient exactement les 80 produits, par catégorie", async () => {
    const f = await newFamily();
    const res = await app.inject({ method: "GET", url: "/api/catalog", cookies: f.staff });
    const cats = res.json().categories as { key: string; label: string; products: { name: string }[] }[];
    const counts = Object.fromEntries(cats.map((c) => [c.label, c.products.length]));
    expect(counts).toEqual({
      "Légumes et herbes": 15,
      Fruits: 10,
      "Laitages et œufs": 10,
      Épicerie: 15,
      "Viandes et poisson": 5,
      Surgelés: 2,
      "Pain et petit-déjeuner": 6,
      Boissons: 2,
      Maison: 9,
      Hygiène: 6,
    });
    expect(cats.flatMap((c) => c.products).length).toBe(80);
    expect(cats[0]!.products.map((p) => p.name).slice(0, 3)).toEqual(["Tomates", "Pommes de terre", "Oignons"]);
    expect(cats.find((c) => c.key === "epicerie")!.products.map((p) => p.name)).toContain("Huile d’olive");
  });

  it("chaque famille a son propre catalogue (copie indépendante)", async () => {
    const a = await newFamily();
    const b = await newFamily();
    const listA = (await app.inject({ method: "GET", url: "/api/catalog", cookies: a.admin })).json().categories[0].products;
    const target = listA[0];
    await app.inject({ method: "PATCH", url: `/api/products/${target.id}`, cookies: a.admin, payload: { name: "Tomates cerises" } });
    const listB = (await app.inject({ method: "GET", url: "/api/catalog", cookies: b.admin })).json().categories[0].products;
    expect(listB[0].name).toBe("Tomates");
    // et B ne peut pas modifier le produit de A
    expect((await app.inject({ method: "PATCH", url: `/api/products/${target.id}`, cookies: b.admin, payload: { active: false } })).statusCode).toBe(404);
  });
});

describe("gestion du catalogue (administrateur)", () => {
  it("désactiver/réactiver : masqué du personnel, conservé pour l'administrateur, même identifiant", async () => {
    const f = await newFamily();
    const tomates = (await app.inject({ method: "GET", url: "/api/catalog", cookies: f.admin })).json().categories[0].products[0];
    const off = await app.inject({ method: "PATCH", url: `/api/products/${tomates.id}`, cookies: f.admin, payload: { active: false } });
    expect(off.json().product.id).toBe(tomates.id);
    const staffView = (await app.inject({ method: "GET", url: "/api/catalog?includeInactive=1", cookies: f.staff })).json().categories[0].products;
    expect(staffView.map((p: any) => p.name)).not.toContain("Tomates"); // le paramètre est ignoré pour le personnel
    const adminView = (await app.inject({ method: "GET", url: "/api/catalog?includeInactive=1", cookies: f.admin })).json().categories[0].products;
    expect(adminView.find((p: any) => p.id === tomates.id).active).toBe(false);
    await app.inject({ method: "PATCH", url: `/api/products/${tomates.id}`, cookies: f.admin, payload: { active: true } });
    const back = (await app.inject({ method: "GET", url: "/api/catalog", cookies: f.staff })).json().categories[0].products;
    expect(back.find((p: any) => p.id === tomates.id)).toBeTruthy();
  });

  it("renommer et ajouter une marque conserve l'identité ; un doublon est refusé", async () => {
    const f = await newFamily();
    const [lait, beurre] = (await app.inject({ method: "GET", url: "/api/catalog", cookies: f.admin })).json().categories[2].products;
    const r = await app.inject({ method: "PATCH", url: `/api/products/${lait.id}`, cookies: f.admin, payload: { brand: "Lactel" } });
    expect(r.json().product).toMatchObject({ id: lait.id, name: "Lait", brand: "Lactel" });
    const dup = await app.inject({ method: "PATCH", url: `/api/products/${beurre.id}`, cookies: f.admin, payload: { name: "Lait", brand: "Lactel" } });
    expect(dup.statusCode).toBe(409);
    const clear = await app.inject({ method: "PATCH", url: `/api/products/${lait.id}`, cookies: f.admin, payload: { brand: null } });
    expect(clear.json().product.brand).toBeNull();
  });

  it("le personnel et les parents ne peuvent pas paramétrer le catalogue", async () => {
    const f = await newFamily();
    const p = (await app.inject({ method: "GET", url: "/api/catalog", cookies: f.admin })).json().categories[0].products[0];
    for (const who of [f.staff, f.parent]) {
      expect((await app.inject({ method: "PATCH", url: `/api/products/${p.id}`, cookies: who, payload: { active: false } })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/api/catalog/extended?q=melon", cookies: who })).statusCode).toBe(403);
    }
  });
});

describe("catalogue étendu (recherche administrateur)", () => {
  it("cherche sans tenir compte des accents/casse, n'expose jamais tout, ajoute au catalogue familial", async () => {
    const f = await newFamily();
    const res = await app.inject({ method: "GET", url: "/api/catalog/extended?q=PÊCHE", cookies: f.admin });
    expect(res.statusCode).toBe(200);
    const peches = res.json().results.find((r: any) => r.name === "Pêches");
    expect(peches).toBeTruthy();
    expect(peches.alreadyAdded).toBe(false);
    expect(res.json().results.length).toBeLessThanOrEqual(20);
    expect((await app.inject({ method: "GET", url: "/api/catalog/extended?q=a", cookies: f.admin })).statusCode).toBe(400); // pas de listing complet
    expect((await app.inject({ method: "GET", url: "/api/catalog/extended", cookies: f.admin })).statusCode).toBe(400);

    const add = await app.inject({ method: "POST", url: "/api/products/from-extended", cookies: f.admin, payload: { extendedId: peches.id } });
    expect(add.statusCode).toBe(201);
    expect(add.json().product).toMatchObject({ name: "Pêches", category: "fruits", active: true });
    const again = await app.inject({ method: "POST", url: "/api/products/from-extended", cookies: f.admin, payload: { extendedId: peches.id } });
    expect(again.statusCode).toBe(409);
    const seen = (await app.inject({ method: "GET", url: "/api/catalog/extended?q=pêche", cookies: f.admin })).json().results.find((r: any) => r.name === "Pêches");
    expect(seen.alreadyAdded).toBe(true);
    const staffView = (await app.inject({ method: "GET", url: "/api/catalog", cookies: f.staff })).json().categories.find((c: any) => c.key === "fruits");
    expect(staffView.products.map((p: any) => p.name)).toContain("Pêches");
  });

  it("deux ajouts simultanés du même produit étendu ne créent qu'une ligne", async () => {
    const f = await newFamily();
    const id = (await app.inject({ method: "GET", url: "/api/catalog/extended?q=couscous", cookies: f.admin })).json().results[0].id;
    const rs = await Promise.all([1, 2, 3].map(() => app.inject({ method: "POST", url: "/api/products/from-extended", cookies: f.admin, payload: { extendedId: id } })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
  });

  it("les caractères spéciaux de recherche sont traités littéralement", async () => {
    const f = await newFamily();
    const r = await app.inject({ method: "GET", url: "/api/catalog/extended?q=%25%25", cookies: f.admin });
    expect(r.json().results).toEqual([]);
  });
});

describe("photos", () => {
  it("une photo familiale est normalisée, immuable, servie avec cache et isolée par famille", async () => {
    const a = await newFamily();
    const b = await newFamily();
    const p = (await app.inject({ method: "GET", url: "/api/catalog", cookies: a.admin })).json().categories[0].products[0];
    expect(p.photoUrl).toBeNull();
    const up = await app.inject({ method: "POST", url: `/api/products/${p.id}/photo`, cookies: a.admin, headers: { "content-type": "image/png" }, payload: await png("#cc2222") });
    expect(up.statusCode).toBe(200);
    const url = up.json().product.photoUrl as string;
    expect(url).toMatch(/^\/api\/photos\//);

    const img = await app.inject({ method: "GET", url, cookies: a.staff });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect(img.headers["cache-control"]).toContain("immutable");
    const meta = await sharp(img.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 512, 512]);
    expect(img.rawPayload.length).toBeLessThan(40_000);

    const cached = await app.inject({ method: "GET", url, cookies: a.staff, headers: { "if-none-match": img.headers.etag as string } });
    expect(cached.statusCode).toBe(304);

    expect((await app.inject({ method: "GET", url, cookies: b.admin })).statusCode).toBe(404); // autre famille
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);

    // changer de photo crée un nouvel enregistrement ; l'ancien reste intact (archives)
    const up2 = await app.inject({ method: "POST", url: `/api/products/${p.id}/photo`, cookies: a.admin, headers: { "content-type": "image/png" }, payload: await png("#2222cc") });
    expect(up2.json().product.photoUrl).not.toBe(url);
    expect((await app.inject({ method: "GET", url, cookies: a.admin })).statusCode).toBe(200);
  });

  it("refuse un fichier qui n'est pas une image et la modification d'un enregistrement de photo", async () => {
    const f = await newFamily();
    const p = (await app.inject({ method: "GET", url: "/api/catalog", cookies: f.admin })).json().categories[0].products[0];
    const bad = await app.inject({ method: "POST", url: `/api/products/${p.id}/photo`, cookies: f.admin, headers: { "content-type": "image/png" }, payload: Buffer.from("pas une image") });
    expect(bad.statusCode).toBe(400);
    const txt = await app.inject({ method: "POST", url: `/api/products/${p.id}/photo`, cookies: f.admin, headers: { "content-type": "text/plain" }, payload: "x" });
    expect(txt.statusCode).toBe(415);
    const staffTry = await app.inject({ method: "POST", url: `/api/products/${p.id}/photo`, cookies: f.staff, headers: { "content-type": "image/png" }, payload: await png("#000000") });
    expect(staffTry.statusCode).toBe(403);
    await expect(db.query("UPDATE photo_assets SET author = 'x'")).rejects.toThrow(/immuable/);
    await expect(db.query("DELETE FROM photo_assets")).rejects.toThrow(/immuable/);
  });
});

describe("licences et provenance", () => {
  const base = { sourceName: "Wikimedia Commons", sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg" };

  it("accepte les licences libres et calcule l'attribution", () => {
    expect(checkLicense({ ...base, license: "CC0-1.0" })).toEqual({ attributionRequired: false, attributionText: null });
    const by = checkLicense({ ...base, license: "CC-BY-SA-4.0", author: "Jean Dupont" });
    expect(by.attributionRequired).toBe(true);
    expect(by.attributionText).toContain("Jean Dupont");
    expect(checkLicense({ sourceName: "Photo familiale", license: "own" }).attributionRequired).toBe(false);
  });

  it("refuse NC/ND, licences inconnues, provenance manquante", () => {
    expect(() => checkLicense({ ...base, license: "CC-BY-NC-4.0", author: "x" })).toThrow(/refusée/);
    expect(() => checkLicense({ ...base, license: "CC-BY-ND-2.0", author: "x" })).toThrow(/refusée/);
    expect(() => checkLicense({ ...base, license: "All rights reserved" })).toThrow(/reconnue/);
    expect(() => checkLicense({ ...base, license: "CC-BY-4.0" })).toThrow(/Auteur/);
    expect(() => checkLicense({ sourceName: "X", license: "CC0-1.0" })).toThrow(/URL/);
  });

  it("les crédits listent les photos sous licence utilisées par la famille, avec leur attribution", async () => {
    const f = await newFamily();
    const prod = (await db.query("SELECT id FROM products WHERE family_id = (SELECT id FROM families WHERE code = $1) AND name = 'Tomates'", [f.familyCode])).rows[0];
    const id = await savePhotoAsset(db, store, await png("#dd3333"), { ...base, license: "CC-BY-SA-4.0", author: "Jean Dupont", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" }, { ownerFamilyId: null });
    await db.query("UPDATE products SET photo_asset_id = $2 WHERE id = $1", [prod.id, id]);
    const res = await app.inject({ method: "GET", url: "/api/credits", cookies: f.staff });
    expect(res.json().credits).toEqual([
      expect.objectContaining({ author: "Jean Dupont", license: "CC-BY-SA-4.0", attributionRequired: true, sourceName: "Wikimedia Commons" }),
    ]);
    // la photo commune est lisible par n'importe quelle famille
    const url = `/api/photos/${id}`;
    expect((await app.inject({ method: "GET", url, cookies: f.staff })).statusCode).toBe(200);
  });
});
