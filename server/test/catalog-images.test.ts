import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { SseHub } from "../src/hub.js";
import { checkLicense, processImage, savePhotoAsset, type PhotoStore } from "../src/photos.js";
import { purgeOrphanAssets, syncCatalogPhotos } from "../src/photos-import.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

const MANIFEST = path.resolve("catalog-photos/manifest.json");
let db: Db;
let app: FastifyInstance;
let hub: SseHub;
let store: PhotoStore;
let n = 0;
type Cookies = Record<string, string>;

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  store = testStore();
  hub = new SseHub();
  app = await buildApp({ db, store, hub, loginRateLimit: { max: 100_000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });

async function newFamily() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `F${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const code = res.json().familyCode as string;
  const admin = cookieOf(res);
  const mk = async (role: string, login: string) => {
    await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: login, login, role, secret: "573918" } });
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: code, login, secret: "573918" } }));
  };
  const familyId = (await db.query("SELECT id FROM families WHERE code = $1", [code])).rows[0].id as string;
  return { admin, parent: await mk("parent", "lamiaa"), staff: await mk("staff", "marie"), familyId };
}
type Fam = Awaited<ReturnType<typeof newFamily>>;

const catalog = async (c: Cookies, inactive = false) => (await app.inject({ method: "GET", url: `/api/catalog${inactive ? "?includeInactive=1" : ""}`, cookies: c })).json().categories as { key: string; products: any[] }[];
const products = async (c: Cookies, inactive = false) => (await catalog(c, inactive)).flatMap((x) => x.products);
const byName = async (c: Cookies, name: string, inactive = false) => (await products(c, inactive)).find((p) => p.name === name);
const b64 = (b: Buffer) => b.toString("base64");
const png = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const assetOfUrl = (url: string) => url.split("/").pop()!;
const op = (type: string, o: object) => ({ opId: randomUUID(), type, ...o });
const send = (c: Cookies, listId: string, ops: object[]) => app.inject({ method: "POST", url: `/api/lists/${listId}/ops`, cookies: c, payload: { ops } });
const newList = async (c: Cookies) => (await app.inject({ method: "POST", url: "/api/lists", cookies: c })).json().list.id as string;

/** Mimics the state of production before this change: Wikimedia-style pictures attached to the catalogue. */
async function seedOldCatalogue(keys: string[]) {
  const old: Record<string, string> = {};
  for (const [i, k] of keys.entries()) {
    const id = await savePhotoAsset(db, store, await png(300 + i * 40, 200, ["#c33", "#3c3", "#33c", "#cc3", "#3cc", "#c3c"][i % 6]!), { sourceName: "Wikimedia Commons", sourceUrl: `https://commons.wikimedia.org/wiki/File:${k}.jpg`, license: "CC-BY-SA-4.0", author: "Jean Dupont" }, { ownerFamilyId: null });
    await db.query("UPDATE initial_catalog SET photo_asset_id = $2 WHERE key = $1", [k, id]);
    old[k] = id;
  }
  return old;
}

describe("le pack de 80 visuels", () => {
  it("le manifeste du dépôt : 80 clés uniques, noms exacts, aucune marque, provenance « générée »", async () => {
    const m = JSON.parse(await readFile(MANIFEST, "utf8"));
    expect(m.items).toHaveLength(80);
    expect(new Set(m.items.map((i: any) => i.key)).size).toBe(80);
    const ref = (await db.query("SELECT key, name FROM initial_catalog")).rows;
    expect(ref).toHaveLength(80);
    for (const it of m.items) {
      expect(ref.find((r) => r.key === it.key)?.name).toBe(it.name); // association exacte clé ↔ nom
      expect(it.license).toBe("GENERATED");
      expect(it.sourceName).toBe("Image générée avec ChatGPT");
      expect(it.brand).toBeUndefined();
      const bytes = await readFile(path.resolve("catalog-photos", it.file));
      expect(sha(bytes)).toBe(it.sha256);
      const meta = await sharp(bytes).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", 512, 512]);
    }
    expect(ref.map((r) => r.key).sort()).toEqual(m.items.map((i: any) => i.key).sort());
  });
});

describe("remplacement des anciennes images", () => {
  let A: Fam, B: Fam;
  let old: Record<string, string>;
  let idsBefore: Record<string, string>;
  let customCarottes: string;
  let archiveId: string;
  let oldTomatoUrl: string;

  it("préparation : ancien état de production (photos Wikimedia, photo personnelle, archive)", async () => {
    old = await seedOldCatalogue(["tomates", "oignons", "carottes", "citrons", "miel", "sel"]);
    A = await newFamily();
    B = await newFamily();
    // A prend sa propre photo des carottes ; B clôture une liste qui contient les tomates (archive : photo figée)
    const carrots = await byName(A.admin, "Carottes");
    const up = await app.inject({ method: "POST", url: `/api/products/${carrots.id}/photo`, cookies: A.admin, headers: { "content-type": "image/png" }, payload: await png(800, 600, "#f80") });
    expect(up.statusCode).toBe(200);
    customCarottes = assetOfUrl(up.json().product.photoUrl);
    const tomatoes = await byName(B.admin, "Tomates");
    expect(assetOfUrl(tomatoes.photoUrl)).toBe(old["tomates"]);
    const lid = await newList(B.parent);
    await send(B.staff, lid, [op("add", { productId: tomatoes.id })]);
    expect((await app.inject({ method: "POST", url: `/api/lists/${lid}/close`, cookies: B.parent })).statusCode).toBe(200);
    archiveId = lid;
    oldTomatoUrl = (await app.inject({ method: "GET", url: `/api/lists/${lid}`, cookies: B.parent })).json().list.items[0].photoUrl;
    expect(assetOfUrl(oldTomatoUrl)).toBe(old["tomates"]);
    idsBefore = Object.fromEntries((await db.query("SELECT family_id::text || ':' || name AS k, id FROM products")).rows.map((r) => [r.k, r.id]));
  });

  let freedExpected = 0;
  it("la synchronisation remplace les 80 références sans doublon ni changement d'identifiant", async () => {
    const r = await syncCatalogPhotos(db, store, MANIFEST);
    expect(r.imported).toHaveLength(80);
    const ic = (await db.query("SELECT i.key, a.generated, a.source_sha256, a.license, a.source_name, a.author FROM initial_catalog i JOIN photo_assets a ON a.id = i.photo_asset_id")).rows;
    expect(ic).toHaveLength(80);
    const m = JSON.parse(await readFile(MANIFEST, "utf8"));
    for (const it of m.items) {
      const row = ic.find((x) => x.key === it.key)!;
      expect(row).toMatchObject({ generated: true, source_sha256: it.sha256, license: "GENERATED", source_name: "Image générée avec ChatGPT", author: null });
    }
    for (const fam of [A, B]) {
      const rows = (await db.query("SELECT id, name, catalog_key, photo_asset_id, brand FROM products WHERE family_id = $1", [fam.familyId])).rows;
      expect(rows).toHaveLength(80); // pas de doublon, pas de variante
      expect(new Set(rows.map((x) => x.name)).size).toBe(80);
      expect(rows.every((x) => x.brand === null)).toBe(true);
      for (const row of rows) expect(idsBefore[`${fam.familyId}:${row.name}`]).toBe(row.id); // mêmes identifiants
    }
    // chaque produit montre l'image de SA clé
    const mism = await db.query(`SELECT count(*)::int AS n FROM products p JOIN initial_catalog i ON i.key = p.catalog_key WHERE p.family_id = $1 AND p.photo_asset_id <> i.photo_asset_id`, [A.familyId]);
    expect(mism.rows[0].n).toBe(1); // seulement les carottes personnelles
    // la photo personnelle n'est pas écrasée
    expect(assetOfUrl((await byName(A.admin, "Carottes")).photoUrl)).toBe(customCarottes);
    expect(assetOfUrl((await byName(B.admin, "Carottes")).photoUrl)).not.toBe(old["carottes"]);
    // les anciens fichiers existent encore tant que la purge n'a pas eu lieu
    for (const id of Object.values(old)) expect(await store.get((await db.query("SELECT storage_key FROM photo_assets WHERE id = $1", [id])).rows[0].storage_key)).not.toBeNull();
    freedExpected = 0;
    for (const [k, id] of Object.entries(old)) if (k !== "tomates") freedExpected += (await db.query("SELECT bytes FROM photo_assets WHERE id = $1", [id])).rows[0].bytes;
  });

  it("purge : supprime les anciennes images inutilisées (base + fichiers), garde celle de l'archive, mesure les octets", async () => {
    const dry = await purgeOrphanAssets(db, store, { minAgeMinutes: 0, dryRun: true });
    expect(dry.assets).toBe(5); // tomates (archive) est référencée
    const keysBefore = (await db.query("SELECT id, storage_key FROM photo_assets WHERE id = ANY($1)", [Object.values(old)])).rows;
    const p = await purgeOrphanAssets(db, store, { minAgeMinutes: 0 });
    expect(p.assets).toBe(5);
    expect(p.files).toBe(5);
    expect(p.bytesFreed).toBe(freedExpected); // octets réellement retirés du stockage = octets des anciens fichiers
    expect(p.bytesFreed).toBeGreaterThan(0);
    const left = (await db.query("SELECT id FROM photo_assets WHERE id = ANY($1)", [Object.values(old)])).rows.map((r) => r.id);
    expect(left).toEqual([old["tomates"]]); // seule l'image encore affichée par l'archive reste
    for (const r of keysBefore) {
      const file = await store.get(r.storage_key);
      if (r.id === old["tomates"]) expect(file).not.toBeNull();
      else expect(file).toBeNull();
    }
  });

  it("l'archive garde exactement son apparence (nom, image d'origine) et reste lisible", async () => {
    const arch = (await app.inject({ method: "GET", url: `/api/lists/${archiveId}`, cookies: B.parent })).json().list;
    expect(arch.items[0]).toMatchObject({ name: "Tomates", photoUrl: oldTomatoUrl });
    const img = await app.inject({ method: "GET", url: oldTomatoUrl, cookies: B.parent });
    expect(img.statusCode).toBe(200);
    // la fiche actuelle, elle, montre la nouvelle image
    expect(assetOfUrl((await byName(B.admin, "Tomates")).photoUrl)).not.toBe(old["tomates"]);
  });

  it("redémarrage / réimport : rien ne change (idempotent), la photo personnelle reste", async () => {
    const countAssets = async () => (await db.query("SELECT count(*)::int AS n FROM photo_assets")).rows[0].n;
    const before = await countAssets();
    for (let i = 0; i < 3; i++) {
      const r = await syncCatalogPhotos(db, store, MANIFEST);
      expect(r.imported).toEqual([]);
      expect(r.skipped).toHaveLength(80);
      const p = await purgeOrphanAssets(db, store, { minAgeMinutes: 0 });
      expect(p.assets).toBe(0);
    }
    expect(await countAssets()).toBe(before);
    expect(assetOfUrl((await byName(A.admin, "Carottes")).photoUrl)).toBe(customCarottes);
    // même après une mise à jour du catalogue (nouvelle image pour « carottes » dans le manifeste), la photo de A reste
    const dir = await mkdtemp(path.join(os.tmpdir(), "mf-"));
    const m = JSON.parse(await readFile(MANIFEST, "utf8"));
    const it = m.items.find((x: any) => x.key === "carottes");
    const fresh = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#ffffff" } }).composite([{ input: await sharp({ create: { width: 200, height: 200, channels: 3, background: "#e60" } }).png().toBuffer(), left: 100, top: 100 }]).webp({ quality: 80 }).toBuffer();
    await writeFile(path.join(dir, "carottes.webp"), fresh);
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ items: [{ ...it, file: "carottes.webp", sha256: sha(fresh) }] }));
    const r = await syncCatalogPhotos(db, store, path.join(dir, "manifest.json"));
    expect(r.imported).toEqual(["initial:carottes"]);
    expect(assetOfUrl((await byName(A.admin, "Carottes")).photoUrl)).toBe(customCarottes); // personnalisée : intacte
    expect(assetOfUrl((await byName(B.admin, "Carottes")).photoUrl)).not.toBe(customCarottes); // les autres suivent le catalogue
  });
});

describe("vérifications avant remplacement (tout ou rien)", () => {
  const writeManifest = async (mutate: (items: any[]) => any[] | void, files: Record<string, Buffer> = {}) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mf-"));
    const base = JSON.parse(await readFile(MANIFEST, "utf8")).items.slice(0, 3);
    const items = mutate(base) ?? base;
    for (const it of items) {
      const src = files[it.file] ?? (await readFile(path.resolve("catalog-photos/files", path.basename(it.file)).replace(/[^/]*$/, (f) => f)).catch(() => Buffer.alloc(0)));
      await writeFile(path.join(dir, path.basename(it.file)), src);
      it.file = path.basename(it.file);
    }
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ items }));
    return path.join(dir, "manifest.json");
  };
  const assetCount = async () => (await db.query("SELECT count(*)::int AS n FROM photo_assets")).rows[0].n;

  it("empreinte SHA-256 fausse, nom différent, clé inconnue, doublon, fichier illisible, licence inventée : rien n'est écrit", async () => {
    await db.query("UPDATE initial_catalog SET photo_asset_id = NULL"); // état neutre
    const before = await assetCount();
    const cases: [string, (items: any[]) => void, RegExp][] = [
      ["sha", (i) => (i[1].sha256 = "0".repeat(64)), /SHA-256/],
      ["nom", (i) => (i[2].name = "Autre nom"), /Nom différent/],
      ["clé", (i) => (i[2].key = "produit-inconnu"), /inconnue/],
      ["doublon", (i) => (i[2].key = i[0].key), /double/],
      ["licence inventée", (i) => (i[1].license = "CC0-1.0"), /URL d'origine/],
      ["image « générée » déguisée", (i) => (i[1].sourceUrl = "https://exemple.org/photo.jpg"), /ni auteur, ni URL/],
      ["origine manquante", (i) => (i[1].sourceName = "Photo trouvée sur Internet"), /Origine « Image générée/],
    ];
    for (const [label, mutate, re] of cases) {
      const mf = await writeManifest((items) => void mutate(items));
      await expect(syncCatalogPhotos(db, store, mf), label).rejects.toThrow(re);
    }
    const garbage = await writeManifest((items) => void items, {});
    await writeFile(path.join(path.dirname(garbage), path.basename(JSON.parse(await readFile(garbage, "utf8")).items[1].file)), Buffer.from("pas une image"));
    await expect(syncCatalogPhotos(db, store, garbage)).rejects.toThrow(/SHA-256|illisible/);
    expect(await assetCount()).toBe(before);
    expect((await db.query("SELECT count(*)::int AS n FROM initial_catalog WHERE photo_asset_id IS NOT NULL")).rows[0].n).toBe(0);
  });
});

describe("purge : jamais d'image encore utilisée", () => {
  it("garde les images référencées par un produit (autre famille), le catalogue étendu, une archive ; épargne les récentes", async () => {
    const F = await newFamily();
    const mkAsset = async (bg: string) => savePhotoAsset(db, store, await png(120, 90, bg), { sourceName: "Photo familiale", license: "OWN" }, { ownerFamilyId: null });
    const a = await mkAsset("#101010"); // produit d'une famille
    const b = await mkAsset("#202020"); // catalogue étendu
    const c = await mkAsset("#303030"); // snapshot d'archive
    const d = await mkAsset("#404040"); // orpheline
    const e = await mkAsset("#505050"); // orpheline mais toute récente
    const p = await byName(F.admin, "Poires");
    const G = await newFamily();
    const pg = await byName(G.admin, "Poires");
    await db.query("UPDATE products SET photo_asset_id = $2 WHERE id = $1", [pg.id, a]); // utilisé par une autre famille
    await db.query("UPDATE extended_catalog SET photo_asset_id = $1 WHERE name = 'Melon'", [b]);
    const lid = await newList(F.parent);
    await send(F.staff, lid, [op("add", { productId: p.id })]);
    await app.inject({ method: "POST", url: `/api/lists/${lid}/close`, cookies: F.parent });
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // test only: forge the snapshot reference
      await client.query("UPDATE list_items SET snapshot_photo_asset_id = $2 WHERE list_id = $1", [lid, c]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const r = await purgeOrphanAssets(db, store, { minAgeMinutes: 0 });
    const alive = new Set((await db.query("SELECT id FROM photo_assets WHERE id = ANY($1)", [[a, b, c, d, e]])).rows.map((x) => x.id));
    expect([...alive].sort()).toEqual([a, b, c].sort());
    expect(r.assets).toBeGreaterThanOrEqual(2); // d et e
    // la protection d'âge : une image toute neuve non liée n'est pas supprimée avec le réglage par défaut
    const f = await mkAsset("#606060");
    const r2 = await purgeOrphanAssets(db, store);
    expect((await db.query("SELECT 1 FROM photo_assets WHERE id = $1", [f])).rowCount).toBe(1);
    expect(r2.keys).not.toContain((await db.query("SELECT storage_key FROM photo_assets WHERE id = $1", [f])).rows[0].storage_key);
  });

  it("la base refuse toute suppression ou modification d'image en dehors de la purge", async () => {
    const id = await savePhotoAsset(db, store, await png(60, 60, "#777"), { sourceName: "Photo familiale", license: "OWN" }, { ownerFamilyId: null });
    await expect(db.query("DELETE FROM photo_assets WHERE id = $1", [id])).rejects.toThrow(/immuable/);
    await expect(db.query("UPDATE photo_assets SET author = 'x' WHERE id = $1", [id])).rejects.toThrow(/immuable/);
  });
});

describe("ajouter et modifier un article (administrateur)", () => {
  it("ajoute un article libre : nom, catégorie, image ; l'image est optimisée, sur fond blanc, sans rognage", async () => {
    const F = await newFamily();
    // 2:1, moitié gauche rouge, moitié droite bleue : si l'image était rognée, une moitié disparaîtrait
    const wide = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#ff0000" } })
      .composite([{ input: await png(800, 800, "#0000ff"), left: 800, top: 0 }]).jpeg({ quality: 95 }).toBuffer();
    const res = await app.inject({ method: "POST", url: "/api/products", cookies: F.admin, payload: { name: "Baguette de Meknès", category: "pain", image: b64(wide) } });
    expect(res.statusCode).toBe(201);
    const p = res.json().product;
    expect(p).toMatchObject({ name: "Baguette de Meknès", category: "pain", active: true });
    const img = await app.inject({ method: "GET", url: p.photoUrl, cookies: F.staff });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    const { data, info } = await sharp(img.rawPayload).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([512, 512]);
    const px = (x: number, y: number) => [...data.subarray((y * 512 + x) * info.channels, (y * 512 + x) * info.channels + 3)];
    const near = (c: number[], t: number[]) => c.every((v, i) => Math.abs(v - t[i]!) < 40);
    expect(near(px(5, 5), [255, 255, 255])).toBe(true); // bandes en haut/bas : blanc
    expect(near(px(256, 5), [255, 255, 255])).toBe(true);
    expect(near(px(8, 256), [255, 0, 0])).toBe(true); // bord gauche conservé (rouge)
    expect(near(px(503, 256), [0, 0, 255])).toBe(true); // bord droit conservé (bleu)
    expect(img.rawPayload.length).toBeLessThan(30_000); // optimisé : bien moins que l'original
    expect(img.rawPayload.length).toBeLessThan(wide.length / 2);
    // visible chez le personnel et chez les parents, dans la bonne catégorie, à la fin
    for (const who of [F.staff, F.parent]) {
      const cat = (await catalog(who)).find((c) => c.key === "pain")!;
      expect(cat.products.at(-1).name).toBe("Baguette de Meknès");
    }
    // le personnel peut le sélectionner (droit de sélection conservé)
    const lid = await newList(F.parent);
    const r = await send(F.staff, lid, [op("add", { productId: p.id })]);
    expect(r.json().results[0].status).toBe("applied");
  });

  it("modifie un article : nom, catégorie, image, état ; mêmes identifiant ; l'ancienne image personnelle est purgée seulement si plus utilisée", async () => {
    const F = await newFamily();
    const created = (await app.inject({ method: "POST", url: "/api/products", cookies: F.admin, payload: { name: "Dattes Mejhoul", category: "fruits", image: b64(await png(900, 600, "#a52")) } })).json().product;
    const lid = await newList(F.parent);
    await send(F.staff, lid, [op("add", { productId: created.id })]);
    await app.inject({ method: "POST", url: `/api/lists/${lid}/close`, cookies: F.parent });
    const archBefore = (await app.inject({ method: "GET", url: `/api/lists/${lid}`, cookies: F.parent })).json().list.items[0];

    const patched = await app.inject({ method: "PATCH", url: `/api/products/${created.id}`, cookies: F.admin, payload: { name: "Dattes Medjool", category: "epicerie", active: false, image: b64(await png(700, 700, "#111")) } });
    expect(patched.statusCode).toBe(200);
    const p = patched.json().product;
    expect(p).toMatchObject({ id: created.id, name: "Dattes Medjool", category: "epicerie", active: false });
    expect(p.photoUrl).not.toBe(created.photoUrl);
    expect(await byName(F.staff, "Dattes Medjool")).toBeUndefined(); // désactivé : masqué du personnel
    expect((await byName(F.admin, "Dattes Medjool", true)).active).toBe(false);
    await app.inject({ method: "PATCH", url: `/api/products/${created.id}`, cookies: F.admin, payload: { active: true } });
    expect((await catalog(F.staff)).find((c) => c.key === "epicerie")!.products.at(-1).name).toBe("Dattes Medjool");

    // l'archive n'a pas bougé : ancien nom, ancienne catégorie, ancienne image
    const archAfter = (await app.inject({ method: "GET", url: `/api/lists/${lid}`, cookies: F.parent })).json().list.items[0];
    expect(archAfter).toMatchObject({ name: "Dattes Mejhoul", category: "fruits", photoUrl: archBefore.photoUrl });
    expect((await app.inject({ method: "GET", url: archBefore.photoUrl, cookies: F.parent })).statusCode).toBe(200);

    // purge : l'ancienne image est encore utilisée par l'archive → conservée ; une image remplacée sans archive → supprimée
    const second = await app.inject({ method: "PATCH", url: `/api/products/${created.id}`, cookies: F.admin, payload: { image: b64(await png(640, 640, "#2a2")) } });
    const mid = assetOfUrl(p.photoUrl);
    const purge = await purgeOrphanAssets(db, store, { minAgeMinutes: 0 });
    expect(purge.assets).toBeGreaterThanOrEqual(1);
    expect((await db.query("SELECT 1 FROM photo_assets WHERE id = $1", [mid])).rowCount).toBe(0); // remplacée, aucune archive : supprimée
    expect((await db.query("SELECT 1 FROM photo_assets WHERE id = $1", [assetOfUrl(archBefore.photoUrl)])).rowCount).toBe(1); // archive : conservée
    expect(second.statusCode).toBe(200);
  });

  it("« image du catalogue » : revient à l'image du catalogue ; un article ajouté revient sans image", async () => {
    await syncCatalogPhotos(db, store, MANIFEST);
    const F = await newFamily();
    const t = await byName(F.admin, "Tomates");
    const catalogUrl = t.photoUrl;
    expect(catalogUrl).toBeTruthy();
    const custom = (await app.inject({ method: "PATCH", url: `/api/products/${t.id}`, cookies: F.admin, payload: { image: b64(await png(500, 500, "#f00")) } })).json().product;
    expect(custom.photoUrl).not.toBe(catalogUrl);
    expect((await app.inject({ method: "PATCH", url: `/api/products/${t.id}`, cookies: F.admin, payload: { resetImage: true } })).json().product.photoUrl).toBe(catalogUrl);
    const added = (await app.inject({ method: "POST", url: "/api/products", cookies: F.admin, payload: { name: "Article libre", category: "maison", image: b64(await png(300, 300, "#0f0")) } })).json().product;
    expect((await app.inject({ method: "PATCH", url: `/api/products/${added.id}`, cookies: F.admin, payload: { resetImage: true } })).json().product.photoUrl).toBeNull();
  });

  it("validations : nom, catégorie, image illisible ou trop lourde, doublon", async () => {
    const F = await newFamily();
    const post = (payload: object) => app.inject({ method: "POST", url: "/api/products", cookies: F.admin, payload });
    expect((await post({ name: "  ", category: "pain" })).statusCode).toBe(400);
    expect((await post({ name: "X", category: "inconnue" })).statusCode).toBe(400);
    expect((await post({ name: "Sans catégorie" })).statusCode).toBe(400);
    expect((await post({ name: "Image cassée", category: "pain", image: b64(Buffer.from("ceci n'est pas une image du tout")) })).statusCode).toBe(400);
    expect((await post({ name: "Énorme", category: "pain", image: b64(randomBytes(8.5 * 1024 * 1024)) })).statusCode).toBe(413);
    expect((await post({ name: "Pain", category: "pain" })).statusCode).toBe(409); // « Pain » existe déjà
    expect((await post({ name: "pain", category: "boissons" })).statusCode).toBe(409); // insensible à la casse
    expect((await byName(F.admin, "Image cassée", true))).toBeUndefined(); // rien n'a été créé à moitié
    const ok = await post({ name: "Sans image", category: "pain" });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().product.photoUrl).toBeNull();
  });

  it("droits : administration du catalogue réservée à l'administrateur ; isolation entre familles", async () => {
    const A = await newFamily();
    const B = await newFamily();
    const t = await byName(A.admin, "Tomates");
    for (const who of [A.parent, A.staff]) {
      expect((await app.inject({ method: "POST", url: "/api/products", cookies: who, payload: { name: "Interdit", category: "pain" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "PATCH", url: `/api/products/${t.id}`, cookies: who, payload: { name: "Piraté" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: `/api/products/${t.id}/photo`, cookies: who, headers: { "content-type": "image/png" }, payload: await png(100, 100, "#000") })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "POST", url: "/api/products", payload: { name: "Anonyme", category: "pain" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "PATCH", url: `/api/products/${t.id}`, cookies: B.admin, payload: { name: "Autre famille", image: b64(await png(100, 100, "#000")) } })).statusCode).toBe(404);
    expect((await byName(A.admin, "Tomates")).name).toBe("Tomates");
    // le personnel et les parents peuvent toujours lire le catalogue et sélectionner
    const lid = await newList(A.parent);
    expect((await send(A.staff, lid, [op("add", { productId: t.id })])).json().results[0].status).toBe("applied");
  });

  it("synchronisation : les autres profils de la famille reçoivent un événement « catalogue modifié », pas les autres familles", async () => {
    const A = await newFamily();
    const B = await newFamily();
    const got: string[] = [];
    const fa = (await db.query("SELECT id FROM families ORDER BY created_at DESC LIMIT 2")).rows.map((r) => r.id as string);
    const offs = [A.familyId, B.familyId].map((fid) => hub.add({ familyId: fid, profileId: randomUUID(), sessionId: randomUUID(), send: (e) => got.push(`${fid === A.familyId ? "A" : "B"}:${e}`), close() {} }));
    expect(fa).toHaveLength(2);
    const p = (await app.inject({ method: "POST", url: "/api/products", cookies: A.admin, payload: { name: "Nouveauté", category: "pain" } })).json().product;
    await app.inject({ method: "PATCH", url: `/api/products/${p.id}`, cookies: A.admin, payload: { name: "Nouveauté 2" } });
    offs.forEach((o) => o());
    expect(got).toEqual(["A:catalog.updated", "A:catalog.updated"]);
    // et la lecture suivante par un autre profil montre bien l'article
    expect((await byName(A.staff, "Nouveauté 2")).id).toBe(p.id);
    expect(await byName(B.staff, "Nouveauté 2")).toBeUndefined();
  });
});

describe("traitement de l'image et provenance", () => {
  it("fond blanc, sans rognage, transparence aplatie, taille réduite", async () => {
    const tall = await sharp({ create: { width: 400, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await png(400, 300, "#ff0000"), top: 0, left: 0 }, { input: await png(400, 300, "#0000ff"), top: 900, left: 0 }]).png().toBuffer();
    const out = await processImage(tall);
    const { data, info } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [...data.subarray((y * 512 + x) * info.channels, (y * 512 + x) * info.channels + 3)];
    expect(px(5, 256)).toEqual([255, 255, 255]); // bande latérale : blanc (la transparence devient blanche, pas noire)
    expect(px(256, 5).map((v, i) => Math.abs(v - [255, 0, 0][i]!) < 40)).toEqual([true, true, true]); // haut conservé
    expect(px(256, 506).map((v, i) => Math.abs(v - [0, 0, 255][i]!) < 40)).toEqual([true, true, true]); // bas conservé
    expect(out.data.length).toBeLessThan(20_000);
  });

  it("un WebP 512×512 léger est conservé tel quel (pas de seconde compression)", async () => {
    const webp = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#fff" } }).webp({ quality: 85 }).toBuffer();
    const out = await processImage(webp);
    expect(out.data.equals(webp)).toBe(true);
    expect(out.hash).toBe(sha(webp));
    expect(out.sourceSha256).toBe(sha(webp));
  });

  it("« Image générée » n'est acceptée qu'avec son origine explicite, sans auteur ni URL ; les licences externes restent contrôlées", () => {
    expect(checkLicense({ sourceName: "Image générée avec ChatGPT", license: "GENERATED" })).toEqual({ attributionRequired: false, attributionText: null });
    expect(() => checkLicense({ sourceName: "Wikimedia Commons", license: "GENERATED" })).toThrow(/Origine/);
    expect(() => checkLicense({ sourceName: "Image générée avec ChatGPT", license: "GENERATED", author: "X" })).toThrow(/ni auteur/);
    expect(() => checkLicense({ sourceName: "Wikimedia Commons", sourceUrl: "https://x.org/f.jpg", license: "CC-BY-NC-4.0", author: "x" })).toThrow(/refusée/);
    expect(() => checkLicense({ sourceName: "Wikimedia Commons", license: "CC0-1.0" })).toThrow(/URL/);
  });

  it("crédits : les images générées en une ligne, sans licence inventée ; les anciennes attributions restent pour les archives", async () => {
    await syncCatalogPhotos(db, store, MANIFEST);
    const F = await newFamily();
    const res = (await app.inject({ method: "GET", url: "/api/credits", cookies: F.staff })).json();
    expect(res.generated).toMatchObject({ source: "Image générée avec ChatGPT" });
    expect(res.generated.count).toBeGreaterThanOrEqual(80);
    expect(res.credits.some((c: any) => c.license === "GENERATED")).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/Wikimedia|CC BY|CC0/); // cette famille n'a aucune archive avec une ancienne image
  });
});
