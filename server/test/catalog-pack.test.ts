import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateInstallToken, setupFamily } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { insertPhotoAsset, preparePhoto } from "../src/photos.js";
import { syncCatalogPhotos } from "../src/photos-import.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

/** Le vrai manifeste livré avec l'application : 80 images de départ + 163 du catalogue complémentaire. */
const MANIFEST = path.resolve(import.meta.dirname, "../catalog-photos/manifest.json");
let db: Db;
const store = testStore();
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
});
afterAll(closeTestDb);

describe("pack d'images du catalogue complémentaire", () => {
  it("intègre les 163 images par clé stable, sans doublon ni photo manquante, et relancer ne change rien", async () => {
    const fam = (await setupFamily(db, { installToken: await generateInstallToken(db), familyName: "F", admin: { displayName: "A", login: "adil", secret: "482913" } })).auth.familyId;
    const personal = await preparePhoto(store, await sharp({ create: { width: 64, height: 64, channels: 3, background: "#cc3366" } }).png().toBuffer(), { sourceName: "Photo familiale", license: "OWN" });
    const pId = await insertPhotoAsset(db as any, personal, { ownerFamilyId: fam, importedBy: null });
    const sponge = (await db.query("SELECT photo_asset_id FROM initial_catalog WHERE key = 'eponges'")).rows[0].photo_asset_id;
    // premier import : les 80 de départ puis (cas Papier cuisson) une éponge « commune » collée sur un article de même nom
    await syncCatalogPhotos(db, store, MANIFEST);
    const initialBefore = (await db.query("SELECT key, photo_asset_id FROM initial_catalog ORDER BY key")).rows;
    const spongeNow = (await db.query("SELECT photo_asset_id FROM initial_catalog WHERE key = 'eponges'")).rows[0].photo_asset_id;
    expect(sponge ?? spongeNow).toBeTruthy();
    await db.query("INSERT INTO products (family_id, category, name, photo_asset_id, position) VALUES ($1,'maison','Papier cuisson',$2,90)", [fam, spongeNow]); // éponge commune
    await db.query("INSERT INTO products (family_id, category, name, photo_asset_id, position) VALUES ($1,'maison','Boîte à tartes',$2,91)", [fam, pId]); // photo personnelle d'un autre article
    // Même nom, photo PERSONNELLE : jamais écrasée par l'import
    await db.query("INSERT INTO products (family_id, category, name, photo_asset_id, position) VALUES ($1,'fruits','Pêches',$2,92)", [fam, pId]);
    await db.query("UPDATE extended_catalog SET photo_asset_id = NULL"); // état d'avant le pack
    const r = await syncCatalogPhotos(db, store, MANIFEST);
    expect(r.imported).toHaveLength(166); // + Farine fino, Farine force, Pâte à tartiner Nutella (022)
    expect(r.imported.every((x) => x.startsWith("extended:"))).toBe(true);
    // chaque entrée visible du catalogue complémentaire a sa photo ; « Salade verte » (absorbée) n'en a pas besoin
    // Les 8 références distinctes créées par 027 (lessive en poudre, thé en vrac…) n'ont pas encore de photo.
    const missing = (await db.query("SELECT key FROM extended_catalog WHERE photo_asset_id IS NULL AND merged_into IS NULL AND source <> 'seed-v4'")).rows;
    expect(missing).toEqual([]);
    expect((await db.query("SELECT count(DISTINCT photo_asset_id)::int AS n FROM extended_catalog WHERE photo_asset_id IS NOT NULL")).rows[0].n).toBe(166);
    // les 80 de départ n'ont pas bougé
    expect((await db.query("SELECT key, photo_asset_id FROM initial_catalog ORDER BY key")).rows).toEqual(initialBefore);
    // Papier cuisson : l'éponge commune est remplacée par la bonne photo ; les photos personnelles sont intactes
    const papierPhoto = (await db.query("SELECT photo_asset_id FROM extended_catalog WHERE key = 'papier-cuisson'")).rows[0].photo_asset_id;
    const prod = async (name: string) => (await db.query("SELECT photo_asset_id FROM products WHERE family_id = $1 AND name = $2", [fam, name])).rows[0].photo_asset_id;
    expect(await prod("Papier cuisson")).toBe(papierPhoto);
    expect(await prod("Papier cuisson")).not.toBe(spongeNow);
    expect(await prod("Boîte à tartes")).toBe(pId);
    expect(await prod("Pêches")).toBe(pId);
    // aucun article n'a été activé ni créé par l'import
    expect((await db.query("SELECT count(*)::int AS n FROM products WHERE family_id = $1", [fam])).rows[0].n).toBe(83);
    // idempotent
    const again = await syncCatalogPhotos(db, store, MANIFEST);
    expect(again.imported).toEqual([]);
    expect(again.skipped).toHaveLength(246);
  });
});
