import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { MIGRATIONS_DIR, migrate } from "../src/migrate.js";
import { lineAmount, type PriceRef } from "../src/pricing.js";

/**
 * Migration 027 (correction des unités) appliquée à une base remplie comme la production en 026 : unités du catalogue et des
 * familles corrigées ; prix convertis seulement quand c'est exact, sinon conservés (à ressaisir) ; listes, achats et favoris intacts.
 */
describe("migration 027 : correction des unités sur des données existantes", () => {
  it("corrige catalogue et produits, convertit les prix exacts, conserve le reste et l'historique", async () => {
    const dbName = `sc_mig27_${Date.now()}`;
    const admin = createPool(new URL("/postgres", process.env.DATABASE_URL!).toString());
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const legacyDir = mkdtempSync(path.join(os.tmpdir(), "mig-"));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x < "027")) copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(legacyDir, f));
    const db = createPool(new URL(`/${dbName}`, process.env.DATABASE_URL!).toString());
    try {
      await migrate(db, legacyDir);
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
      const riz = await add(fam, { initial: "riz" }, "paquet");
      const pates = await add(fam, { initial: "pates" }, "paquet");
      const poulet = await add(fam, { initial: "poulet" }, "kg");
      const persil = await add(fam, { initial: "persil" }, "paquet");
      const mangues = await add(fam, { extended: "mangues" }, "piece"); // famille équipée avant 014 : unité de famille restée « pièce »
      const coco = await add(fam, { extended: "noix-de-coco" }, "piece");
      const lentilles = await add(fam, { initial: "lentilles" }, "paquet");
      const tomates = await add(fam, { initial: "tomates" }, "kg");
      const maison = await add(fam, {}, "paquet", "Riz maison"); // produit créé par la famille : jamais modifié
      const rizAutre = await add(other, { initial: "riz" }, "paquet");
      const price = (p: string, amount: number, qty: number, unit: string, packaging: string | null, w: number | null = null) =>
        db.query("INSERT INTO family_prices (family_id, product_id, amount, ref_qty, ref_unit, packaging, piece_weight_g) VALUES ($1,$2,$3,$4,$5,$6,$7)", [fam, p, amount, qty, unit, packaging, w]);
      await price(riz, 120, 1, "paquet", "1 kg");
      await price(pates, 10, 1, "paquet", "500 g");
      await price(lentilles, 9, 1, "paquet", "sachet"); // poids inconnu
      await price(coco, 15, 1, "piece", null);
      await price(poulet, 70, 1, "kg", null);
      await price(persil, 4, 1, "paquet", null);
      await price(tomates, 9.9, 1, "kg", null);
      // Historique : un achat de riz en paquets dans une liste archivée ; une liste en cours avec du riz en paquets ; un favori.
      const old = (await db.query("INSERT INTO lists (family_id, created_by) VALUES ($1,$2) RETURNING id", [fam, prof])).rows[0].id as string;
      const item = (await db.query("INSERT INTO list_items (list_id, family_id, product_id, added_by, status, quantity, unit) VALUES ($1,$2,$3,$4,'purchased',2,'paquet') RETURNING id", [old, fam, riz, prof])).rows[0].id as string;
      await db.query("INSERT INTO purchases (list_item_id, list_id, family_id, purchased_by, product_id, quantity, unit, purchased_at) VALUES ($1,$2,$3,$4,$5,2,'paquet','2026-10-01T10:00:00Z')", [item, old, fam, prof, riz]);
      await db.query("UPDATE lists SET status = 'archived', closed_by = $2, closed_at = now() WHERE id = $1", [old, prof]);
      const cur = (await db.query("INSERT INTO lists (family_id, created_by) VALUES ($1,$2) RETURNING id", [fam, prof])).rows[0].id as string;
      await db.query("INSERT INTO list_items (list_id, family_id, product_id, added_by, quantity, unit) VALUES ($1,$2,$3,$4,3,'paquet')", [cur, fam, riz, prof]);
      const tpl = (await db.query("INSERT INTO list_templates (family_id, name, created_by) VALUES ($1,'Semaine',$2) RETURNING id", [fam, prof])).rows[0].id as string;
      await db.query("INSERT INTO list_template_items (template_id, product_id, quantity, unit) VALUES ($1,$2,2,'paquet')", [tpl, riz]);
      const revBefore = Number((await db.query("SELECT catalog_rev FROM families WHERE id = $1", [other])).rows[0].catalog_rev);

      expect(await migrate(db)).toEqual(["027_unit_corrections.sql", "028_app_update.sql"]);

      // Catalogue commun
      const unitOf = async (table: string, key: string) => (await db.query(`SELECT unit FROM ${table} WHERE key = $1`, [key])).rows[0].unit;
      for (const k of ["persil", "coriandre", "menthe", "poulet"]) expect(await unitOf("initial_catalog", k)).toBe("piece");
      for (const k of ["riz", "pates", "vermicelles", "lentilles", "pois-chiches", "poivre", "cumin"]) expect(await unitOf("initial_catalog", k)).toBe("kg");
      for (const k of ["brocolis", "celeri"]) expect(await unitOf("extended_catalog", k)).toBe("piece");
      for (const k of ["fenouil", "mangues", "raisins-secs", "noix-de-coco", "fromage-en-tranches", "mozzarella", "amandes", "citrons-confits", "cornichons", "curcuma", "fecule-de-mais", "noix", "noix-de-cajou", "sucre-glace"])
        expect(await unitOf("extended_catalog", k)).toBe("kg");
      // Capture 13 en attente : inchangés
      expect(await unitOf("initial_catalog", "papier-toilette")).toBe("paquet");
      expect(await unitOf("initial_catalog", "essuie-tout")).toBe("paquet");
      expect(await unitOf("initial_catalog", "sacs-poubelle")).toBe("paquet");

      // Produits des familles
      const units = Object.fromEntries((await db.query("SELECT id, unit FROM products")).rows.map((r) => [r.id, r.unit]));
      expect(units).toMatchObject({ [riz]: "kg", [pates]: "kg", [poulet]: "piece", [persil]: "piece", [mangues]: "kg", [coco]: "kg", [lentilles]: "kg", [tomates]: "kg", [maison]: "paquet", [rizAutre]: "kg" });

      // Prix des familles : conversion exacte seulement
      const fp = Object.fromEntries((await db.query("SELECT product_id, amount, ref_qty, ref_unit, packaging, piece_weight_g FROM family_prices WHERE family_id = $1", [fam])).rows.map((r) => [r.product_id, r]));
      const ref = (r: any): PriceRef => ({ amount: r.amount, refQty: Number(r.ref_qty), refUnit: r.ref_unit, packaging: r.packaging, pieceWeightG: r.piece_weight_g });
      expect(fp[riz]).toMatchObject({ amount: "120.00", ref_unit: "kg", packaging: null });
      expect(lineAmount(ref(fp[riz]), 1, "kg")).toEqual({ ok: true, cents: 12000 }); // 120 DH le paquet de 1 kg = 120 DH/kg
      expect(fp[pates]).toMatchObject({ amount: "10.00", ref_unit: "g", packaging: null });
      expect(Number(fp[pates].ref_qty)).toBe(500);
      expect(lineAmount(ref(fp[pates]), 1, "kg")).toEqual({ ok: true, cents: 2000 }); // 10 DH / 500 g = 20 DH/kg
      expect(lineAmount(ref(fp[pates]), 0.25, "kg")).toEqual({ ok: true, cents: 500 });
      // Impossibles : conservés à l'identique, et jamais utilisés pour un montant dans la nouvelle unité
      expect(fp[lentilles]).toMatchObject({ amount: "9.00", ref_unit: "paquet", packaging: "sachet" });
      expect(fp[coco]).toMatchObject({ amount: "15.00", ref_unit: "piece" });
      expect(fp[poulet]).toMatchObject({ amount: "70.00", ref_unit: "kg" });
      expect(fp[persil]).toMatchObject({ amount: "4.00", ref_unit: "paquet" });
      expect(lineAmount(ref(fp[coco]), 1, "kg")).toEqual({ ok: false, reason: "incompatible" });
      expect(lineAmount(ref(fp[poulet]), 1, "piece")).toEqual({ ok: false, reason: "incompatible" });
      expect(lineAmount(ref(fp[lentilles]), 1, "kg")).toEqual({ ok: false, reason: "incompatible" });
      expect(fp[tomates]).toMatchObject({ amount: "9.90", ref_unit: "kg" }); // produit non concerné

      // Base commune : paquets de poids connu convertis ; pièce sans poids conservée
      const bp = Object.fromEntries((await db.query("SELECT key, amount, ref_qty, ref_unit, packaging FROM base_prices WHERE key IN ('pates','vermicelles','fromage-en-tranches','cornichons','citrons-confits','noix-de-coco','mangues','persil')")).rows.map((r) => [r.key, r]));
      expect(bp.pates).toMatchObject({ amount: "10.00", ref_unit: "g", packaging: null });
      expect(Number(bp.pates.ref_qty)).toBe(500);
      expect(bp["citrons-confits"]).toMatchObject({ amount: "23.00", ref_unit: "g" });
      expect(Number(bp["citrons-confits"].ref_qty)).toBe(950);
      expect(bp["noix-de-coco"]).toMatchObject({ amount: "14.50", ref_unit: "piece" });
      expect(bp.mangues).toMatchObject({ amount: "13.90", ref_unit: "piece" });
      expect(bp.persil).toMatchObject({ amount: "3.90", ref_unit: "paquet" });

      // Historique, liste en cours et favori : rien n'est réinterprété
      expect((await db.query("SELECT quantity, unit FROM purchases WHERE list_item_id = $1", [item])).rows[0]).toEqual({ quantity: "2.000", unit: "paquet" });
      expect((await db.query("SELECT quantity, unit FROM list_items WHERE list_id = $1", [cur])).rows[0]).toEqual({ quantity: "3.000", unit: "paquet" });
      expect((await db.query("SELECT quantity, unit FROM list_template_items WHERE template_id = $1", [tpl])).rows[0]).toEqual({ quantity: "2.000", unit: "paquet" });

      // Journal : de quoi revenir exactement en arrière
      const j = (await db.query("SELECT subject, ref, old_unit, new_unit, old_price, new_price, outcome FROM unit_corrections WHERE family_id = $1", [fam])).rows;
      expect(j.find((r) => r.subject === "product" && r.ref === riz)).toMatchObject({ old_unit: "paquet", new_unit: "kg", outcome: "unit_changed" });
      expect(j.find((r) => r.subject === "family_price" && r.ref === pates)).toMatchObject({ outcome: "price_converted", old_price: { amount: 10, refQty: 1, refUnit: "paquet", packaging: "500 g" } });
      expect(j.find((r) => r.subject === "family_price" && r.ref === coco)).toMatchObject({ outcome: "price_to_reenter", new_price: null });
      expect(j.some((r) => r.ref === tomates || r.ref === maison)).toBe(false);
      expect(Number((await db.query("SELECT catalog_rev FROM families WHERE id = $1", [other])).rows[0].catalog_rev)).toBeGreaterThan(revBefore);

      // Retour arrière documenté (docs/evolutions/unites-statistiques-mise-a-jour.md) : remet exactement les valeurs d'origine
      const doc = readFileSync(path.resolve(MIGRATIONS_DIR, "../../docs/evolutions/unites-statistiques-mise-a-jour.md"), "utf8");
      const rollback = doc.split("```sql")[1]!.split("```")[0]!;
      await db.query(rollback);
      expect((await db.query("SELECT unit FROM initial_catalog WHERE key = 'riz'")).rows[0].unit).toBe("paquet");
      expect((await db.query("SELECT unit FROM extended_catalog WHERE key = 'mangues'")).rows[0].unit).toBe("kg"); // déjà « kg » avant 027
      const back = Object.fromEntries((await db.query("SELECT id, unit FROM products WHERE family_id = $1", [fam])).rows.map((r) => [r.id, r.unit]));
      expect(back).toMatchObject({ [riz]: "paquet", [pates]: "paquet", [poulet]: "kg", [persil]: "paquet", [mangues]: "piece", [coco]: "piece", [tomates]: "kg" });
      expect((await db.query("SELECT amount, ref_qty, ref_unit, packaging FROM family_prices WHERE product_id = $1", [pates])).rows[0]).toEqual({ amount: "10.00", ref_qty: "1.000", ref_unit: "paquet", packaging: "500 g" });
      expect((await db.query("SELECT ref_qty, ref_unit, packaging FROM base_prices WHERE key = 'pates'")).rows[0]).toEqual({ ref_qty: "1.000", ref_unit: "paquet", packaging: "500 g" });
      expect((await db.query("SELECT quantity, unit FROM purchases WHERE list_item_id = $1", [item])).rows[0]).toEqual({ quantity: "2.000", unit: "paquet" });
    } finally {
      await db.end();
      await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  });
});
