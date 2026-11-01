import type { FastifyInstance } from "fastify";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import { createPool, type Db } from "../src/db.js";
import { MIGRATIONS_DIR, migrate } from "../src/migrate.js";
import { fmtPrice, lineAmount, type PriceRef } from "../src/pricing.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

/**
 * Migration 030 : décisions finales sur les unités (contenant ou article complet = 1 pièce ; fromage en portions au poids ;
 * épinards à la botte). Familles en production : unités venues du catalogue corrigées, unités choisies gardées ; historiques,
 * listes et favoris intacts ; prix convertis seulement quand c'est exact, sinon conservés et signalés ; retour arrière exact.
 */
const ref = (r: any): PriceRef => ({ amount: r.amount, refQty: Number(r.ref_qty), refUnit: r.ref_unit, packaging: r.packaging, pieceWeightG: r.piece_weight_g });

describe("migration 030 sur des familles en production (025 → 030)", () => {
  it("unités, noms, prix, historiques et retour arrière", async () => {
    const dbName = `sc_mig30_${Date.now()}`;
    const admin = createPool(new URL("/postgres", process.env.DATABASE_URL!).toString());
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const dirUpTo = (limit: string) => {
      const d = mkdtempSync(path.join(os.tmpdir(), "mig-"));
      for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x < limit)) copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(d, f));
      return d;
    };
    const db = createPool(new URL(`/${dbName}`, process.env.DATABASE_URL!).toString());
    try {
      await migrate(db, dirUpTo("026")); // schéma de la production
      const fam = (await db.query("INSERT INTO families (code, name) VALUES ('MIG030','Famille') RETURNING id")).rows[0].id as string;
      const other = (await db.query("INSERT INTO families (code, name) VALUES ('MIG031','Autre') RETURNING id")).rows[0].id as string;
      const prof = (await db.query("INSERT INTO profiles (family_id, display_name, login, role, secret_hash) VALUES ($1,'Adil','adil','admin','x') RETURNING id", [fam])).rows[0].id as string;
      const add = async (f: string, r: { initial?: string; extended?: string }, unit: string | null, name?: string) => {
        const src = r.initial
          ? (await db.query("SELECT name, category, unit FROM initial_catalog WHERE key = $1", [r.initial])).rows[0]
          : (await db.query("SELECT id, name, category, unit FROM extended_catalog WHERE key = $1", [r.extended])).rows[0];
        return (
          await db.query("INSERT INTO products (family_id, category, name, catalog_key, extended_id, unit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [
            f, src.category, name ?? src.name, r.initial ?? null, r.extended ? src.id : null, unit ?? src.unit,
          ])
        ).rows[0].id as string;
      };
      const price = (p: string, amount: number, qty: number, unit: string, packaging: string | null) =>
        db.query("INSERT INTO family_prices (family_id, product_id, amount, ref_qty, ref_unit, packaging) SELECT family_id, id, $2, $3, $4, $5 FROM products WHERE id = $1", [p, amount, qty, unit, packaging]);
      // Avant 027 : un prix de contenant (027 le ramène à 430 g, 030 retrouve le pot = 1 pièce)
      const confiture = await add(fam, { initial: "confiture" }, null);
      await price(confiture, 18.95, 1, "pot", "430 g");

      await migrate(db, dirUpTo("029")); // 026, 027, 028 : l'état de la base juste avant le lot catalogue
      const miel = await add(fam, { initial: "miel" }, "kg");
      await db.query("UPDATE products SET format = 'pot de 250 g' WHERE id = $1", [miel]);
      await price(miel, 90, 1, "kg", null); // prix au kg, format au poids unique : conversion exacte par le poids d'une pièce
      const sucre = await add(fam, { initial: "sucre" }, "kg");
      await price(sucre, 5.2, 1, "kg", null); // prix au kg, aucun format : à compléter
      const vanille = await add(fam, { extended: "sucre-vanille" }, "kg");
      await price(vanille, 0.6, 1, "sachet", null); // petit sachet d'un paquet de 10 : à compléter
      const sucre2 = await add(other, { initial: "sucre" }, "kg");
      await db.query("UPDATE products SET format = 'sac de 5 kg' WHERE id = $1", [sucre2]); // format saisi par la famille
      const pate = await add(fam, { extended: "pate-a-tartiner" }, "kg");
      const ketchup = await add(fam, { extended: "ketchup" }, "bouteille"); // unité choisie par la famille
      const melon = await add(fam, { extended: "melon" }, "kg");
      await price(melon, 4, 1, "kg", null);
      const portions = await add(fam, { initial: "fromage-en-portions" }, "boite");
      await price(portions, 15, 1, "boite", "120 g");
      const portions2 = await add(other, { initial: "fromage-en-portions" }, "boite");
      await price(portions2, 26, 1, "boite", "16 portions");
      const epinards = await add(fam, { extended: "epinards" }, "kg");
      const cereales = await add(fam, { extended: "cereales" }, "kg");
      const mesCereales = await add(other, { extended: "cereales" }, "kg", "Mes céréales"); // nom choisi par la famille
      const lessive = await add(fam, { extended: "lessive-en-poudre" }, "kg");
      const tomates = await add(fam, { initial: "tomates" }, "kg"); // hors décisions : jamais touché
      // Historique en kg, liste en cours, favori
      const old = (await db.query("INSERT INTO lists (family_id, created_by) VALUES ($1,$2) RETURNING id", [fam, prof])).rows[0].id as string;
      const item = (await db.query("INSERT INTO list_items (list_id, family_id, product_id, added_by, status, quantity, unit) VALUES ($1,$2,$3,$4,'purchased',0.5,'kg') RETURNING id", [old, fam, miel, prof])).rows[0].id as string;
      await db.query("INSERT INTO purchases (list_item_id, list_id, family_id, purchased_by, product_id, quantity, unit, purchased_at) VALUES ($1,$2,$3,$4,$5,0.5,'kg','2026-10-20T10:00:00Z')", [item, old, fam, prof, miel]);
      await db.query("UPDATE lists SET status = 'archived', closed_by = $2, closed_at = now() WHERE id = $1", [old, prof]);
      const cur = (await db.query("INSERT INTO lists (family_id, created_by) VALUES ($1,$2) RETURNING id", [fam, prof])).rows[0].id as string;
      await db.query("INSERT INTO list_items (list_id, family_id, product_id, added_by, quantity, unit) VALUES ($1,$2,$3,$4,1.5,'kg')", [cur, fam, sucre, prof]);
      const tpl = (await db.query("INSERT INTO list_templates (family_id, name, created_by) VALUES ($1,'Semaine',$2) RETURNING id", [fam, prof])).rows[0].id as string;
      await db.query("INSERT INTO list_template_items (template_id, product_id, quantity, unit) VALUES ($1,$2,2,'kg')", [tpl, melon]);
      const before = {
        purchases: (await db.query("SELECT * FROM purchases ORDER BY id")).rows,
        items: (await db.query("SELECT * FROM list_items ORDER BY id")).rows,
        tpl: (await db.query("SELECT * FROM list_template_items")).rows,
        ids: (await db.query("SELECT id FROM products ORDER BY id")).rows,
        snapshot028: {
          units: (await db.query("SELECT key, unit FROM initial_catalog UNION ALL SELECT key, unit FROM extended_catalog ORDER BY 1")).rows,
          products: (await db.query("SELECT id, unit, name, format FROM products ORDER BY id")).rows,
          fprices: (await db.query("SELECT product_id, amount, ref_qty, ref_unit, packaging, piece_weight_g FROM family_prices ORDER BY product_id")).rows,
          bprices: (await db.query("SELECT key, amount, ref_qty, ref_unit, packaging, piece_weight_g FROM base_prices ORDER BY origin, key")).rows,
        },
      };
      const rev = Number((await db.query("SELECT catalog_rev FROM families WHERE id = $1", [fam])).rows[0].catalog_rev);

      expect(await migrate(db)).toEqual(["029_catalogue_captures.sql", "030_unit_decisions.sql"]);

      // ---- Catalogue commun
      const unitOf = async (key: string) => (await db.query("SELECT unit FROM initial_catalog WHERE key = $1 UNION ALL SELECT unit FROM extended_catalog WHERE key = $1", [key])).rows[0]?.unit;
      for (const k of ["miel", "confiture", "sucre", "sucre-vanille", "levure-chimique", "ketchup", "sauce-barbecue", "soupe-aux-lentilles", "chips-au-fromage-et-aux-oignons", "cereales", "melon", "sel", "pain-de-mie", "lessive-en-poudre", "lait-en-poudre", "pate-a-tartiner", "pate-a-tartiner-nutella"])
        expect([k, await unitOf(k)]).toEqual([k, "piece"]);
      expect([await unitOf("fromage-en-portions"), await unitOf("epinards")]).toEqual(["kg", "botte"]);
      // Unités conservées (décisions « inchangées »)
      const kept: [string, string][] = [["harissa", "kg"], ["amlou", "kg"], ["beurre", "kg"], ["farine", "kg"], ["olives", "kg"], ["sole", "kg"], ["poulet", "piece"], ["lben", "litre"], ["huile-de-table", "litre"], ["the", "boite"]];
      for (const [k, u] of kept) expect([k, await unitOf(k)]).toEqual([k, u]);
      // Pâte à tartiner : à la pièce comme Nutella, deux références distinctes (aucun doublon créé)
      expect((await db.query("SELECT count(*)::int AS n FROM extended_catalog WHERE lower(name) = 'pâte à tartiner'")).rows[0].n).toBe(1);
      // Sucre : format de référence « paquet de 2 kg » ; le prix commun au kg n'est jamais un prix à la pièce
      expect((await db.query("SELECT format FROM initial_catalog WHERE key = 'sucre'")).rows[0].format).toBe("paquet de 2 kg");
      expect((await db.query("SELECT name, former_names FROM extended_catalog WHERE key = 'cereales'")).rows[0]).toEqual({ name: "Céréales au chocolat", former_names: ["céréales"] });
      expect((await db.query("SELECT name FROM extended_catalog WHERE key = 'chips-au-fromage-et-aux-oignons'")).rows[0].name).toBe("Chips");

      // ---- Familles : unités venues du catalogue corrigées, unité choisie conservée, identifiants et noms personnalisés gardés
      const p = Object.fromEntries((await db.query("SELECT id, unit, name FROM products")).rows.map((r) => [r.id, r]));
      expect([miel, confiture, sucre, vanille, melon, cereales, lessive].map((id) => p[id].unit)).toEqual(Array(7).fill("piece"));
      expect([p[portions].unit, p[portions2].unit, p[epinards].unit, p[tomates].unit]).toEqual(["kg", "kg", "botte", "kg"]);
      expect(p[ketchup].unit).toBe("bouteille");
      expect(p[pate].unit).toBe("piece");
      const fmt = Object.fromEntries((await db.query("SELECT id, format FROM products WHERE id = ANY($1)", [[sucre, sucre2]])).rows.map((r) => [r.id, r.format]));
      expect([fmt[sucre], fmt[sucre2], p[sucre2].unit]).toEqual(["paquet de 2 kg", "sac de 5 kg", "piece"]);
      expect([p[cereales].name, p[mesCereales].name]).toEqual(["Céréales au chocolat", "Mes céréales"]);
      expect((await db.query("SELECT id FROM products ORDER BY id")).rows).toEqual(before.ids);
      const journal = (await db.query("SELECT subject, ref, outcome, old_unit, new_unit, new_value FROM unit_corrections WHERE migration = '030'")).rows;
      expect(journal.find((j) => j.ref === ketchup)).toMatchObject({ subject: "product", outcome: "unit_kept_custom", old_unit: "bouteille", new_unit: "piece" });
      expect(journal.filter((j) => j.outcome === "unit_kept_custom").map((j) => j.ref)).toEqual([ketchup]);

      // ---- Prix des familles : exacts ou conservés et signalés
      const fp = Object.fromEntries((await db.query("SELECT product_id, amount, ref_qty, ref_unit, packaging, piece_weight_g FROM family_prices")).rows.map((r) => [r.product_id, r]));
      expect(fp[confiture]).toMatchObject({ amount: "18.95", ref_qty: "1.000", ref_unit: "piece", packaging: "430 g" }); // le pot d'origine
      expect(lineAmount(ref(fp[confiture]), 2, "piece")).toEqual({ ok: true, cents: 3790 });
      expect(fp[miel]).toMatchObject({ amount: "90.00", ref_unit: "kg", piece_weight_g: "250.00" }); // même prix au kg, pot de 250 g
      expect(lineAmount(ref(fp[miel]), 1, "piece")).toEqual({ ok: true, cents: 2250 });
      expect(fp[portions]).toMatchObject({ amount: "15.00", ref_qty: "120.000", ref_unit: "g", packaging: null });
      expect(lineAmount(ref(fp[portions]), 0.24, "kg")).toEqual({ ok: true, cents: 3000 });
      // jamais un prix au kg utilisé comme prix à la pièce : conservés tels quels, signalés à compléter
      expect(fp[sucre]).toMatchObject({ amount: "5.20", ref_qty: "1.000", ref_unit: "kg", piece_weight_g: null });
      expect(lineAmount(ref(fp[sucre]), 1, "piece")).toEqual({ ok: false, reason: "incompatible" });
      expect(fp[melon]).toMatchObject({ amount: "4.00", ref_unit: "kg" });
      expect(fp[vanille]).toMatchObject({ amount: "0.60", ref_unit: "sachet" });
      expect(fp[portions2]).toMatchObject({ amount: "26.00", ref_unit: "boite", packaging: "16 portions" });
      const toConfirm = journal.filter((j) => j.subject === "family_price" && j.outcome === "price_to_confirm").map((j) => j.ref).sort();
      expect(toConfirm).toEqual([sucre, vanille, melon, portions2].sort());

      // ---- Base commune : contenants observés = 1 pièce, montants inchangés ; prix au kg sans format conservé
      const bp = Object.fromEntries((await db.query("SELECT key, amount, ref_qty, ref_unit, packaging, piece_weight_g FROM base_prices")).rows.map((r) => [r.key, r]));
      expect(bp.miel).toMatchObject({ amount: "56.95", ref_qty: "1.000", ref_unit: "piece", packaging: "450 g" });
      expect(fmtPrice(ref({ ...bp.ketchup, piece_weight_g: null }))).toContain("14,50 DH");
      expect(bp.ketchup).toMatchObject({ ref_unit: "piece", packaging: "flacon de 310 g" });
      expect(bp.sucre).toMatchObject({ amount: "5.20", ref_unit: "kg", piece_weight_g: null });
      expect(lineAmount(ref(bp.sucre), 1, "piece")).toEqual({ ok: false, reason: "incompatible" }); // jamais 10,40 DH le paquet
      expect(bp.sucre.amount).not.toBe("9.95"); // le relevé de la capture n'est pas importé
      expect(bp["fromage-en-portions"]).toMatchObject({ amount: "26.00", ref_unit: "boite", packaging: "16 portions" });
      expect(bp.vermicelles).toMatchObject({ amount: "9.90", ref_unit: "g" }); // hors décisions : inchangé

      // ---- Historiques, liste en cours et favori : figés
      expect((await db.query("SELECT * FROM purchases ORDER BY id")).rows).toEqual(before.purchases);
      expect((await db.query("SELECT * FROM list_items ORDER BY id")).rows).toEqual(before.items);
      expect((await db.query("SELECT * FROM list_template_items")).rows).toEqual(before.tpl);
      expect(Number((await db.query("SELECT catalog_rev FROM families WHERE id = $1", [fam])).rows[0].catalog_rev)).toBeGreaterThan(rev);

      // ---- Retour arrière documenté (030 seule) : état d'avant 030, sauf ce qu'ajoute 029
      const doc = readFileSync(path.resolve(MIGRATIONS_DIR, "../../docs/catalogue/import-2026-11-01/UNITES-030.md"), "utf8");
      await db.query(doc.split("```sql")[1]!.split("```")[0]!);
      const units = (await db.query("SELECT key, unit FROM initial_catalog UNION ALL SELECT key, unit FROM extended_catalog WHERE source <> 'captures-20261101' ORDER BY 1")).rows;
      expect(units).toEqual(before.snapshot028.units);
      expect((await db.query("SELECT id, unit, name, format FROM products ORDER BY id")).rows).toEqual(before.snapshot028.products);
      expect((await db.query("SELECT format FROM initial_catalog WHERE key = 'sucre'")).rows[0].format).toBeNull();
      expect((await db.query("SELECT product_id, amount, ref_qty, ref_unit, packaging, piece_weight_g FROM family_prices ORDER BY product_id")).rows).toEqual(before.snapshot028.fprices);
      expect((await db.query("SELECT key, amount, ref_qty, ref_unit, packaging, piece_weight_g FROM base_prices ORDER BY origin, key")).rows).toEqual(before.snapshot028.bprices);
      expect((await db.query("SELECT name FROM extended_catalog WHERE key = 'cereales'")).rows[0].name).toBe("Céréales");
      expect((await db.query("SELECT * FROM purchases ORDER BY id")).rows).toEqual(before.purchases);
    } finally {
      await db.end();
      await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 120_000);
});

describe("unités finales dans l'application : quantités, synchronisation, statistiques", () => {
  let db: Db;
  let app: FastifyInstance;
  type Cookies = Record<string, string>;
  const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
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

  it("le téléphone reçoit les unités finales ; quantités entières à la pièce ; achats passés en kg gardés à part dans les statistiques", async () => {
    const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: "Unités", admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
    const A = cookieOf(res);
    const fam = (await db.query("SELECT id FROM families WHERE name = 'Unités'")).rows[0].id as string;
    const cat = (await app.inject({ method: "GET", url: "/api/catalog", cookies: A })).json();
    const prod = (name: string) => cat.categories.flatMap((c: any) => c.products).find((p: any) => p.name === name);
    expect([prod("Sucre").format, prod("Miel").format]).toEqual(["paquet de 2 kg", null]); // format de référence copié à la création
    expect([prod("Miel").unit, prod("Sucre").unit, prod("Confiture").unit, prod("Sel alimentaire").unit, prod("Fromage en portions").unit, prod("Riz").unit])
      .toEqual(["piece", "piece", "piece", "piece", "kg", "kg"]);
    const added = (await app.inject({ method: "POST", url: "/api/products/from-catalog", cookies: A, payload: { origin: "extended", key: "soupe-de-legumes" } })).json().product;
    expect(added.unit).toBe("piece");
    // Synchronisation : la révision du catalogue avance quand il change ; le téléphone relit les unités
    const rev = cat.rev as number;
    expect((await app.inject({ method: "GET", url: "/api/catalog", cookies: A })).json().rev).toBeGreaterThan(rev);

    const miel = prod("Miel").id as string;
    const list = (await app.inject({ method: "POST", url: "/api/lists", cookies: A })).json().list.id as string;
    const ops = (o: any[]) => app.inject({ method: "POST", url: `/api/lists/${list}/ops`, cookies: A, payload: { ops: o.map((x) => ({ opId: randomUUID(), ...x })) } });
    const bad = (await ops([{ type: "add", productId: miel, quantity: 1.5 }])).json().results[0];
    expect(bad.status).not.toBe("applied"); // 1,5 pot : refusé (quantité entière à la pièce)
    expect((await ops([{ type: "add", productId: miel, quantity: 2 }])).json().results[0].status).toBe("applied");
    const item = (await app.inject({ method: "GET", url: `/api/lists/${list}`, cookies: A })).json().list.items.find((i: any) => i.productId === miel);
    expect([Number(item.quantity), item.unit]).toEqual([2, "piece"]);
    expect((await ops([{ type: "purchase", itemId: item.id }])).json().results[0].status).toBe("applied");
    // Achat d'avant le changement d'unité : 0,5 kg (figé)
    const prof = (await db.query("SELECT id FROM profiles WHERE family_id = $1", [fam])).rows[0].id;
    // (liste archivée : ses gardes sont suspendues le temps de reconstituer cet achat ancien, base de test uniquement)
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL session_replication_role = replica");
      const old = (await c.query("INSERT INTO lists (family_id, created_by, status, closed_by, closed_at) VALUES ($1,$2,'archived',$2,now()) RETURNING id", [fam, prof])).rows[0].id;
      const oi = (await c.query("INSERT INTO list_items (list_id, family_id, product_id, added_by, status, quantity, unit) VALUES ($1,$2,$3,$4,'purchased',0.5,'kg') RETURNING id", [old, fam, miel, prof])).rows[0].id;
      await c.query("INSERT INTO purchases (list_item_id, list_id, family_id, purchased_by, product_id, quantity, unit, purchased_at) VALUES ($1,$2,$3,$4,$5,0.5,'kg',now() - interval '2 days')", [oi, old, fam, prof, miel]);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
    const st = (await app.inject({ method: "GET", url: `/api/stats/products/${miel}?period=all`, cookies: A })).json();
    const units = st.summary.units.map((u: any) => `${u.unit}:${u.quantity}:${u.purchases}`).sort();
    expect(units).toEqual(["kg:0.5:1", "piece:2:1"]); // jamais additionnés
  });
});
