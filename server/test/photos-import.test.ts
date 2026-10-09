import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateInstallToken, setupFamily } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { savePhotoAsset } from "../src/photos.js";
import { importManifest } from "../src/photos-import.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
const store = testStore();

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
});
afterAll(closeTestDb);

async function manifestDir(items: Record<string, unknown>[]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "catphotos-"));
  await mkdir(path.join(dir, "files"));
  for (const [i, color] of ["#d33", "#3a3", "#33d"].entries()) {
    await sharp({ create: { width: 700, height: 600, channels: 3, background: color } }).jpeg().toFile(path.join(dir, "files", `${i}.jpg`));
  }
  const file = path.join(dir, "manifest.json");
  await writeFile(file, JSON.stringify({ items }));
  return file;
}
const item = (key: string, n: number, over: Record<string, unknown> = {}) => ({
  target: "initial", key, file: `files/${n}.jpg`, sourceName: "Wikimedia Commons",
  sourceUrl: `https://commons.wikimedia.org/wiki/File:${key}.jpg`, license: "CC-BY-SA-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", author: "Jean Dupont", ...over,
});
const photoOf = async (familyId: string, key: string) => (await db.query("SELECT photo_asset_id FROM products WHERE family_id = $1 AND catalog_key = $2", [familyId, key])).rows[0].photo_asset_id as string | null;
const newFamily = async () => {
  const r = await setupFamily(db, { installToken: await generateInstallToken(db), familyName: "F", admin: { displayName: "A", login: "adil", secret: "482913" } });
  return r.auth.familyId;
};

describe("import des photos du catalogue", () => {
  it("importe avec provenance, relie les produits des familles existantes et des nouvelles", async () => {
    const before = await newFamily(); // famille créée avant l'import
    const m = await manifestDir([item("tomates", 0), item("citrons", 1)]);
    const r = await importManifest(db, store, m);
    expect(r.imported.sort()).toEqual(["initial:citrons", "initial:tomates"]);
    expect(await photoOf(before, "tomates")).toBeTruthy();
    const after = await newFamily(); // famille créée après l'import : copie la photo du catalogue initial
    expect(await photoOf(after, "tomates")).toBe(await photoOf(before, "tomates"));
    const a = (await db.query("SELECT * FROM photo_assets WHERE id = $1", [await photoOf(before, "tomates")])).rows[0];
    expect(a).toMatchObject({ license: "CC-BY-SA-4.0", author: "Jean Dupont", source_name: "Wikimedia Commons", attribution_required: true, width: 480, height: 480 });
    expect(a.attribution_text).toContain("Jean Dupont");
  });

  it("au redémarrage (onlyMissing) : rien n'est réimporté ni dupliqué", async () => {
    const m = await manifestDir([item("tomates", 0), item("oignons", 2)]);
    const n = (await db.query("SELECT count(*)::int AS n FROM photo_assets")).rows[0].n;
    const r = await importManifest(db, store, m, { onlyMissing: true });
    expect(r.skipped).toEqual(["initial:tomates"]);
    expect(r.imported).toEqual(["initial:oignons"]);
    expect((await db.query("SELECT count(*)::int AS n FROM photo_assets")).rows[0].n).toBe(n + 1);
    const again = await importManifest(db, store, m, { onlyMissing: true });
    expect(again.imported).toEqual([]);
  });

  it("une photo prise par la famille n'est jamais écrasée par une mise à jour du catalogue", async () => {
    const fam = await newFamily();
    const own = await savePhotoAsset(db, store, await sharp({ create: { width: 600, height: 600, channels: 3, background: "#fff" } }).png().toBuffer(), { sourceName: "Photo familiale", license: "OWN" }, { ownerFamilyId: fam });
    await db.query("UPDATE products SET photo_asset_id = $2 WHERE family_id = $1 AND catalog_key = 'carottes'", [fam, own]);
    const m = await manifestDir([item("carottes", 0)]);
    await importManifest(db, store, m);
    expect(await photoOf(fam, "carottes")).toBe(own);
    const other = await newFamily();
    expect(await photoOf(other, "carottes")).not.toBe(own); // les autres familles reçoivent la photo du catalogue
    expect(await photoOf(other, "carottes")).toBeTruthy();
  });

  it("une entrée refusée (licence NC, auteur manquant, clé inconnue) n'importe rien", async () => {
    const n = (await db.query("SELECT count(*)::int AS n FROM photo_assets")).rows[0].n;
    await expect(importManifest(db, store, await manifestDir([item("poires", 0), item("pommes", 1, { license: "CC-BY-NC-4.0" })]))).rejects.toThrow(/refusée/);
    await expect(importManifest(db, store, await manifestDir([item("poires", 0), item("pommes", 1, { author: null })]))).rejects.toThrow(/Auteur/);
    await expect(importManifest(db, store, await manifestDir([item("poires", 0), item("inconnu-xyz", 1)]))).rejects.toThrow(/inconnue/);
    expect((await db.query("SELECT count(*)::int AS n FROM photo_assets")).rows[0].n).toBe(n);
    expect((await db.query("SELECT photo_asset_id FROM initial_catalog WHERE key = 'poires'")).rows[0].photo_asset_id).toBeNull();
  });
});
