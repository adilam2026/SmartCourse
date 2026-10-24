import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { MIGRATIONS_DIR, migrate } from "../src/migrate.js";
import { fmtPrice, lineAmount, type PriceRef } from "../src/pricing.js";
import { previewUnitMigration } from "../src/migration-preview.js";
import pg from "pg";

/**
 * Migration 027 (tableau des unités validé) appliquée à une base remplie comme la production en 025, avec 026 et 028 dans l'ordre :
 * unités venues du catalogue corrigées, unités personnalisées conservées et signalées, prix convertis seulement quand la quantité
 * de référence est connue, références distinctes, historiques intacts, retour arrière exact.
 */
describe("migration 027 : unités du tableau validé sur une base en production (025)", () => {
  it("anciennes familles, personnalisations, prix, formats, historiques et retour arrière", async () => {
    const dbName = `sc_mig27_${Date.now()}`;
    const admin = createPool(new URL("/postgres", process.env.DATABASE_URL!).toString());
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const legacyDir = mkdtempSync(path.join(os.tmpdir(), "mig-"));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x < "026")) copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(legacyDir, f));
    const db = createPool(new URL(`/${dbName}`, process.env.DATABASE_URL!).toString());
    try {
      await migrate(db, legacyDir); // schéma 025, comme la production
      const fam = (await db.query("INSERT INTO families (code, name) VALUES ('MIG027','Famille') RETURNING id")).rows[0].id as string;
      const other = (await db.query("INSERT INTO families (code, name) VALUES ('MIG028','Autre') RETURNING id")).rows[0].id as string;
      const prof = (await db.query("INSERT INTO profiles (family_id, display_name, login, role, secret_hash) VALUES ($1,'Adil','adil','admin','x') RETURNING id", [fam])).rows[0].id as string;
      const add = async (f: string, ref: { initial?: string; extended?: string }, unit: string, name?: string) => {
        const src = ref.initial
          ? (await db.query("SELECT name, category FROM initial_catalog WHERE key = $1", [ref.initial])).rows[0]
          : ref.extended
            ? (await db.query("SELECT id, name, category FROM extended_catalog WHERE key = $1", [ref.extended])).rows[0]
            : { name, category: "epicerie" };
        return (
          await db.query("INSERT INTO products (family_id, category, name, catalog_key, extended_id, unit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [
            f, src.category, name ?? src.name, ref.initial ?? null, ref.extended ? src.id : null, unit,
          ])
        ).rows[0].id as string;
      };
      // Unités venues du catalogue : actuelle, ancienne valeur de départ du rayon (009), cas particulier 009
      const riz = await add(fam, { initial: "riz" }, "paquet");
      const pates = await add(fam, { initial: "pates" }, "paquet");
      const vermicelles = await add(fam, { initial: "vermicelles" }, "paquet");
      const huile = await add(fam, { initial: "huile-de-table" }, "paquet"); // départ du rayon avant 014
      const huileOlive = await add(other, { initial: "huile-d-olive" }, "bouteille"); // catalogue depuis 014
      const persil = await add(fam, { initial: "persil" }, "paquet");
      const poulet = await add(fam, { initial: "poulet" }, "kg");
      const pq = await add(fam, { initial: "papier-toilette" }, "paquet");
      const lessive = await add(fam, { initial: "lessive" }, "bouteille");
      const lessiveAutre = await add(other, { initial: "lessive" }, "bouteille", "Ma lessive"); // nom choisi par la famille
      const coco = await add(fam, { extended: "noix-de-coco" }, "piece");
      const melon = await add(fam, { extended: "melon" }, "kg");
      // Unités choisies par la famille (aucune valeur du catalogue) : conservées et signalées
      const sucre = await add(fam, { initial: "sucre" }, "pot");
      const lait = await add(other, { initial: "lait" }, "litre"); // déjà l'unité retenue : rien à faire
      const tomates = await add(fam, { initial: "tomates" }, "kg");
      const maison = await add(fam, {}, "paquet", "Riz maison"); // produit créé par la famille : jamais modifié
      const price = (p: string, amount: number, qty: number, unit: string, packaging: string | null) =>
        db.query("INSERT INTO family_prices (family_id, product_id, amount, ref_qty, ref_unit, packaging) SELECT family_id, id, $2, $3, $4, $5 FROM products WHERE id = $1", [p, amount, qty, unit, packaging]);
      await price(pates, 10, 1, "paquet", "500 g");
      await price(vermicelles, 9.9, 1, "paquet", "500 g");
      await price(riz, 120, 1, "paquet", "sachet"); // quantité de référence inconnue
      await price(huile, 18, 1, "paquet", "flacon de 1 litre");
      await price(poulet, 70, 1, "kg", null); // prix au kg d'un poulet : pas de prix « par poulet entier »
      await price(pq, 30, 1, "paquet", "6 rouleaux");
      await price(sucre, 5.2, 1, "kg", null);
      await price(tomates, 9.9, 1, "kg", null);
      // Historique : achat de riz en paquets (liste archivée), liste en cours, favori
      const old = (await db.query("INSERT INTO lists (family_id, created_by) VALUES ($1,$2) RETURNING id", [fam, prof])).rows[0].id as string;
      const item = (await db.query("INSERT INTO list_items (list_id, family_id, product_id, added_by, status, quantity, unit) VALUES ($1,$2,$3,$4,'purchased',2,'paquet') RETURNING id", [old, fam, riz, prof])).rows[0].id as string;
      await db.query("INSERT INTO purchases (list_item_id, list_id, family_id, purchased_by, product_id, quantity, unit, purchased_at) VALUES ($1,$2,$3,$4,$5,2,'paquet','2026-10-01T10:00:00Z')", [item, old, fam, prof, riz]);
      const lessItem = (await db.query("INSERT INTO list_items (list_id, family_id, product_id, added_by, status, quantity, unit) VALUES ($1,$2,$3,$4,'purchased',1,'bouteille') RETURNING id", [old, fam, lessive, prof])).rows[0].id as string;
      await db.query("INSERT INTO purchases (list_item_id, list_id, family_id, purchased_by, product_id, quantity, unit, purchased_at) VALUES ($1,$2,$3,$4,$5,1,'bouteille','2026-10-01T10:00:00Z')", [lessItem, old, fam, prof, lessive]);
      await db.query("UPDATE lists SET status = 'archived', closed_by = $2, closed_at = now() WHERE id = $1", [old, prof]);
      const cur = (await db.query("INSERT INTO lists (family_id, created_by) VALUES ($1,$2) RETURNING id", [fam, prof])).rows[0].id as string;
      await db.query("INSERT INTO list_items (list_id, family_id, product_id, added_by, quantity, unit) VALUES ($1,$2,$3,$4,3,'paquet')", [cur, fam, riz, prof]);
      const tpl = (await db.query("INSERT INTO list_templates (family_id, name, created_by) VALUES ($1,'Semaine',$2) RETURNING id", [fam, prof])).rows[0].id as string;
      await db.query("INSERT INTO list_template_items (template_id, product_id, quantity, unit) VALUES ($1,$2,2,'paquet')", [tpl, riz]);
      const before = { purchases: (await db.query("SELECT * FROM purchases ORDER BY id")).rows, items: (await db.query("SELECT * FROM list_items ORDER BY id")).rows };

      // 026, 027 et 028 dans l'ordre, depuis 025
      expect(await migrate(db)).toEqual(["026_family_identifier.sql", "027_unit_corrections.sql", "028_app_update.sql"]);

      const unitOf = async (table: string, key: string) => (await db.query(`SELECT unit FROM ${table} WHERE key = $1`, [key])).rows[0]?.unit;
      // Catalogue : décisions confirmées et arbitrages
      expect(await unitOf("initial_catalog", "riz")).toBe("kg");
      expect(await unitOf("initial_catalog", "huile-de-table")).toBe("litre");
      expect(await unitOf("initial_catalog", "persil")).toBe("botte");
      expect(await unitOf("extended_catalog", "celeri")).toBe("botte");
      expect(await unitOf("extended_catalog", "brocolis")).toBe("kg");
      expect(await unitOf("extended_catalog", "noix-de-coco")).toBe("piece");
      expect(await unitOf("extended_catalog", "papaye")).toBe("piece");
      expect(await unitOf("extended_catalog", "melon")).toBe("kg");
      expect(await unitOf("initial_catalog", "papier-toilette")).toBe("rouleau");
      expect(await unitOf("extended_catalog", "bouillon")).toBe("cube");
      expect(await unitOf("initial_catalog", "thon-en-conserve")).toBe("boite");
      expect(await unitOf("initial_catalog", "yaourt-a-boire")).toBe("piece");
      expect(await unitOf("initial_catalog", "yaourt-nature")).toBe("pot");
      expect(await unitOf("extended_catalog", "pate-a-tartiner-nutella")).toBe("piece");
      expect(await unitOf("initial_catalog", "poulet")).toBe("piece");
      expect(await unitOf("initial_catalog", "the")).toBe("boite"); // ancienne référence conservée telle quelle
      // Références distinctes : même identifiant pour la forme que l'ancienne désignait ; nouvelles formes créées
      expect((await db.query("SELECT name, unit FROM initial_catalog WHERE key = 'lessive'")).rows[0]).toEqual({ name: "Lessive liquide", unit: "litre" });
      expect((await db.query("SELECT key, unit FROM extended_catalog WHERE source = 'seed-v4' ORDER BY key")).rows.map((r) => `${r.key}:${r.unit}`)).toEqual([
        "capsules-de-lessive:piece", "glace-en-bac:litre", "lessive-en-poudre:kg", "savon-noir-en-pate:kg", "the-en-sachets:sachet", "the-en-vrac:kg", "tisane-en-sachets:sachet", "tisane-en-vrac:kg",
      ]);

      // Familles : unité venue du catalogue corrigée, unité personnalisée conservée et signalée
      const p = Object.fromEntries((await db.query("SELECT id, unit, name FROM products")).rows.map((r) => [r.id, r]));
      expect([riz, pates, vermicelles].map((id) => p[id].unit)).toEqual(["kg", "kg", "kg"]);
      expect([huile, huileOlive].map((id) => p[id].unit)).toEqual(["litre", "litre"]);
      expect([persil, poulet, pq, coco, melon].map((id) => p[id].unit)).toEqual(["botte", "piece", "rouleau", "piece", "kg"]);
      expect(p[lessive]).toMatchObject({ unit: "litre", name: "Lessive liquide" });
      expect(p[lessiveAutre]).toMatchObject({ unit: "litre", name: "Ma lessive" }); // nom de la famille gardé
      expect(p[sucre].unit).toBe("pot"); // personnalisée : conservée
      expect(p[lait].unit).toBe("litre");
      expect(p[maison].unit).toBe("paquet");
      const journal = (await db.query("SELECT family_id, subject, ref, old_unit, new_unit, outcome, old_value, new_value FROM unit_corrections WHERE subject IN ('product','family_price')")).rows;
      expect(journal.find((j) => j.ref === sucre)).toMatchObject({ outcome: "unit_kept_custom", old_unit: "pot", new_unit: "kg" });
      expect(journal.filter((j) => j.outcome === "unit_kept_custom").map((j) => j.ref)).toEqual([sucre]);
      expect(journal.some((j) => j.ref === lait || j.ref === tomates || j.ref === maison)).toBe(false);

      // Prix personnels : convertis seulement quand la quantité de référence est connue, montants jamais arrondis
      const fp = Object.fromEntries((await db.query("SELECT product_id, amount, ref_qty, ref_unit, packaging FROM family_prices")).rows.map((r) => [r.product_id, r]));
      const ref = (r: any): PriceRef => ({ amount: r.amount, refQty: Number(r.ref_qty), refUnit: r.ref_unit, packaging: r.packaging });
      expect(lineAmount(ref(fp[pates]), 1, "kg")).toEqual({ ok: true, cents: 2000 }); // 10 DH / 500 g = 20 DH/kg
      expect(lineAmount(ref(fp[vermicelles]), 1, "kg")).toEqual({ ok: true, cents: 1980 }); // 19,80 DH/kg, pas 20
      expect(fmtPrice(ref(fp[vermicelles]))).toBe("9,90 DH / 500 g");
      expect(lineAmount(ref(fp[huile]), 1, "litre")).toEqual({ ok: true, cents: 1800 });
      expect(lineAmount(ref(fp[pq]), 1, "rouleau")).toEqual({ ok: true, cents: 500 }); // 30 DH / 6 rouleaux
      // Impossibles : conservés à l'identique, signalés, jamais utilisés pour un montant
      expect(fp[riz]).toMatchObject({ amount: "120.00", ref_unit: "paquet", packaging: "sachet" });
      expect(fp[poulet]).toMatchObject({ amount: "70.00", ref_unit: "kg" });
      expect(lineAmount(ref(fp[poulet]), 1, "piece")).toEqual({ ok: false, reason: "incompatible" });
      expect(journal.find((j) => j.subject === "family_price" && j.ref === poulet)).toMatchObject({ outcome: "price_to_confirm", new_value: null });
      expect(fp[sucre]).toMatchObject({ amount: "5.20", ref_unit: "kg" }); // produit personnalisé : prix intact
      // Base commune : montants et dates conservés ; prix proposés non vérifiés non importés
      const bp = Object.fromEntries((await db.query("SELECT key, amount, ref_qty, ref_unit, packaging, observed_on FROM base_prices")).rows.map((r) => [r.key, r]));
      expect(bp.vermicelles).toMatchObject({ amount: "9.90", ref_unit: "g" });
      expect(bp["huile-d-olive"]).toMatchObject({ amount: "47.45", ref_unit: "litre" }); // pas 80
      expect(bp["creme-fraiche"]).toMatchObject({ amount: "12.95", ref_unit: "pot", packaging: "200 ml" }); // à confirmer
      expect(bp["papier-cuisson"]).toMatchObject({ amount: "42.95", ref_unit: "rouleau", packaging: "rouleau de 20 mètres" });
      expect(bp.riz).toBeUndefined();
      expect(bp["sardines-en-conserve"]).toBeUndefined();

      // Historiques, liste en cours et favori : rien ne change de sens
      expect((await db.query("SELECT * FROM purchases ORDER BY id")).rows).toEqual(before.purchases);
      expect((await db.query("SELECT * FROM list_items ORDER BY id")).rows).toEqual(before.items);
      expect((await db.query("SELECT quantity, unit FROM list_template_items WHERE template_id = $1", [tpl])).rows[0]).toEqual({ quantity: "2.000", unit: "paquet" });

      // Format du produit : facultatif, n'entraîne aucune conversion
      await db.query("UPDATE products SET format = 'pot de 350 g' WHERE id = $1", [sucre]);
      await expect(db.query("UPDATE products SET format = $2 WHERE id = $1", [sucre, "x".repeat(61)])).rejects.toThrow();

      // Retour arrière documenté : valeurs d'origine rétablies (noms, unités, prix convertis)
      const doc = readFileSync(path.resolve(MIGRATIONS_DIR, "../../docs/evolutions/unites-statistiques-mise-a-jour.md"), "utf8");
      await db.query(doc.split("```sql")[1]!.split("```")[0]!);
      expect((await db.query("SELECT name, unit FROM initial_catalog WHERE key = 'lessive'")).rows[0]).toEqual({ name: "Lessive", unit: "bouteille" });
      expect(await unitOf("initial_catalog", "riz")).toBe("paquet");
      expect(await unitOf("extended_catalog", "melon")).toBe("kg");
      const back = Object.fromEntries((await db.query("SELECT id, unit, name FROM products")).rows.map((r) => [r.id, r]));
      expect([riz, huile, huileOlive, persil, poulet, pq, coco, sucre].map((id) => back[id].unit)).toEqual(["paquet", "paquet", "bouteille", "paquet", "kg", "paquet", "piece", "pot"]);
      expect(back[lessive]).toMatchObject({ unit: "bouteille", name: "Lessive" });
      expect((await db.query("SELECT amount, ref_qty, ref_unit, packaging FROM family_prices WHERE product_id = $1", [vermicelles])).rows[0]).toEqual({ amount: "9.90", ref_qty: "1.000", ref_unit: "paquet", packaging: "500 g" });
      expect((await db.query("SELECT ref_qty, ref_unit, packaging FROM base_prices WHERE key = 'papier-cuisson'")).rows[0]).toEqual({ ref_qty: "1.000", ref_unit: "piece", packaging: "rouleau de 20 mètres" });
      expect((await db.query("SELECT * FROM purchases ORDER BY id")).rows).toEqual(before.purchases);
    } finally {
      await db.end();
      await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it("aperçu sur une copie en 025 : totaux anonymes, transaction annulée (rien n'est écrit)", async () => {
    const dbName = `sc_prev27_${Date.now()}`;
    const admin = createPool(new URL("/postgres", process.env.DATABASE_URL!).toString());
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const legacyDir = mkdtempSync(path.join(os.tmpdir(), "mig-"));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x < "026")) copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(legacyDir, f));
    const db = createPool(new URL(`/${dbName}`, process.env.DATABASE_URL!).toString());
    const c = new pg.Client({ connectionString: new URL(`/${dbName}`, process.env.DATABASE_URL!).toString() });
    try {
      await migrate(db, legacyDir);
      const fam = (await db.query("INSERT INTO families (code, name) VALUES ('PRV027','Famille Secrète') RETURNING id")).rows[0].id as string;
      await db.query("INSERT INTO products (family_id, category, name, catalog_key, unit) VALUES ($1,'epicerie','Sucre','sucre','pot'), ($1,'epicerie','Riz','riz','paquet')", [fam]);
      const before = (await db.query("SELECT id, unit FROM products ORDER BY id")).rows;
      await c.connect();
      const lines = await previewUnitMigration(c, path.join(MIGRATIONS_DIR, "027_unit_corrections.sql"));
      const text = lines.join("\n");
      expect(text).toContain("product / unit_changed : 1 (1 famille(s))");
      expect(text).toContain("Sucre : pot conservé (unité retenue : kg) — 1 famille(s)");
      expect(text).not.toMatch(/PRV027|Secrète|[0-9a-f]{8}-[0-9a-f]{4}/); // ni famille, ni identifiant
      expect((await db.query("SELECT id, unit FROM products ORDER BY id")).rows).toEqual(before);
      expect((await db.query("SELECT to_regclass('unit_corrections') AS t")).rows[0].t).toBeNull();
    } finally {
      await c.end().catch(() => {});
      await db.end();
      await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  });
});
