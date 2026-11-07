import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type pg from "pg";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { LocalPhotoStore } from "./photos.js";
import { syncCatalogPhotos } from "./photos-import.js";

/*
 * CONTRÔLE DU DÉPLOIEMENT sur une copie ISOLÉE de la sauvegarde (restauration de contrôle, base jetable supprimée ensuite).
 * Rejoue ce que fait le serveur au démarrage : migrations en attente puis synchronisation des images du catalogue (images écrites
 * dans un dossier temporaire du conteneur de vérification, JAMAIS dans le stockage de production). Sur une sauvegarde prise avant
 * le déploiement, le résultat est donc celui de la production juste après ; sur une sauvegarde postérieure, rien n'est rejoué.
 * Sortie PUBLIQUE : totaux et noms des références du catalogue commun seulement (aucune famille, aucun prix de famille).
 */
type Row = Record<string, unknown>;
const one = async (c: pg.Client, sql: string): Promise<Row> => (await c.query(sql)).rows[0] ?? {};

// Décisions d'unités validées (docs/catalogue/import-2026-11-01/UNITES-030.md), mêmes clés que les tests de la migration 030.
const PIECE = ["miel", "confiture", "sucre", "sucre-vanille", "levure-chimique", "ketchup", "sauce-barbecue", "soupe-aux-lentilles", "chips-au-fromage-et-aux-oignons", "cereales", "melon", "sel", "pain-de-mie", "lessive-en-poudre", "lait-en-poudre", "pate-a-tartiner", "pate-a-tartiner-nutella"];
const OTHER: [string, string][] = [["fromage-en-portions", "kg"], ["epinards", "botte"], ["harissa", "kg"], ["amlou", "kg"], ["beurre", "kg"], ["farine", "kg"], ["olives", "kg"], ["sole", "kg"], ["poulet", "piece"], ["lben", "litre"], ["huile-de-table", "litre"], ["the", "boite"]];

/** Empreinte anonyme des données des familles qui ne doivent JAMAIS changer (identifiants, historiques, prix, images personnelles). */
async function familySnapshot(c: pg.Client): Promise<Row> {
  return one(
    c,
    `SELECT (SELECT count(*) FROM products)::int AS products,
            (SELECT md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM products) AS product_ids,
            (SELECT md5(coalesce(string_agg(id::text || ':' || photo_asset_id::text, ',' ORDER BY id), '')) FROM products p
              WHERE photo_asset_id IN (SELECT id FROM photo_assets WHERE owner_family_id IS NOT NULL)) AS family_photos,
            (SELECT count(*) FROM family_prices)::int AS family_prices,
            (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM purchases t) AS purchases,
            (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM list_items t) AS list_items,
            (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM list_template_items t) AS templates`,
  );
}

export async function controleDeploiement(scratch: pg.Client, scratchUrl: string, manifestPath: string): Promise<{ lines: string[]; problems: string[] }> {
  const lines: string[] = [];
  const problems: string[] = [];
  const check = (ok: boolean, label: string) => {
    lines.push(`  ${ok ? "OK " : "ÉCHEC"} ${label}`);
    if (!ok) problems.push(label);
  };
  const startSchema = String((await one(scratch, "SELECT max(name) AS m FROM schema_migrations")).m);
  const before = await familySnapshot(scratch);

  // 1. Ce que fait le serveur au démarrage : migrations, puis images du catalogue (stockage local jetable).
  const pool = createPool(scratchUrl, { max: 2 });
  const dir = mkdtempSync(path.join(os.tmpdir(), "controle-images-"));
  let applied: string[] = [];
  let images = { imported: 0, skipped: 0 };
  try {
    applied = await migrate(pool);
    const r = await syncCatalogPhotos(pool, new LocalPhotoStore(dir), manifestPath);
    images = { imported: r.imported.length, skipped: r.skipped.length };
  } finally {
    await pool.end();
    rmSync(dir, { recursive: true, force: true });
  }
  const after = await familySnapshot(scratch);
  const endSchema = String((await one(scratch, "SELECT max(name) AS m FROM schema_migrations")).m);
  lines.push(`CONTRÔLE DU DÉPLOIEMENT (copie isolée, supprimée ensuite) : schéma de la sauvegarde ${startSchema} → ${endSchema}`);
  lines.push(`  Migrations rejouées comme au démarrage du serveur : ${applied.length ? applied.join(", ") : "aucune (sauvegarde déjà à jour)"}`);

  // 2. Migrations
  check(endSchema >= "035_platform_space.sql", `migrations appliquées jusqu'à 035_platform_space.sql au moins (${endSchema})`);

  // 3. Personnalisations des familles intactes (empreintes anonymes)
  for (const k of ["products", "product_ids", "family_photos", "family_prices", "purchases", "list_items", "templates"])
    check(before[k] === after[k], `familles : ${k} inchangé(s)${k === "products" || k === "family_prices" ? ` (${after[k]})` : ""}`);
  const journal = (await scratch.query("SELECT migration, subject, outcome, count(*)::int AS n FROM unit_corrections GROUP BY 1, 2, 3 ORDER BY 1, 2, 3")).rows;
  lines.push("  Journal des corrections (totaux, toutes familles confondues) :");
  for (const r of journal) lines.push(`    ${r.migration} / ${r.subject} / ${r.outcome} : ${r.n}`);
  const kept = Number((await one(scratch, "SELECT count(*)::int AS n FROM unit_corrections WHERE outcome = 'unit_kept_custom'")).n);
  lines.push(`  Unités personnalisées des familles conservées (à vérifier plus tard dans le rapport foyer) : ${kept}`);

  // 4. Images du catalogue
  lines.push(`  Images du catalogue : ${images.imported} ajoutée(s) ou remplacée(s), ${images.skipped} déjà à jour`);
  const noImg = (
    await scratch.query(
      `SELECT name FROM initial_catalog WHERE photo_asset_id IS NULL
       UNION ALL SELECT name FROM extended_catalog WHERE photo_asset_id IS NULL AND merged_into IS NULL ORDER BY 1`,
    )
  ).rows.map((r) => r.name as string);
  const totals = await one(scratch, "SELECT (SELECT count(*) FROM initial_catalog)::int AS i, (SELECT count(*) FROM extended_catalog WHERE merged_into IS NULL)::int AS e");
  lines.push(`  Catalogue commun : ${totals.i} références de départ, ${totals.e} références étendues ; sans image : ${noImg.length}${noImg.length ? ` (${noImg.slice(0, 25).join(", ")}${noImg.length > 25 ? ", …" : ""})` : ""}`);
  const broken = Number((await one(scratch, `SELECT count(*)::int AS n FROM (SELECT photo_asset_id FROM initial_catalog UNION ALL SELECT photo_asset_id FROM extended_catalog) x
                                              WHERE photo_asset_id IS NOT NULL AND photo_asset_id NOT IN (SELECT id FROM photo_assets)`)).n);
  check(broken === 0, "aucune référence du catalogue vers une image inexistante");
  const flour = (
    await scratch.query(`SELECT key, photo_asset_id IS NOT NULL AS img FROM initial_catalog WHERE key ~ '^(farine|semoule)'
                         UNION ALL SELECT key, photo_asset_id IS NOT NULL FROM extended_catalog WHERE key ~ '^(farine|semoule)' AND merged_into IS NULL ORDER BY 1`)
  ).rows;
  lines.push(`  Farines et semoules : ${flour.map((r) => `${r.key}${r.img ? "" : " (sans image)"}`).join(", ")}`);
  // 5. Classement
  const dupInitial = Number((await one(scratch, "SELECT count(*)::int AS n FROM (SELECT category, position FROM initial_catalog GROUP BY 1, 2 HAVING count(*) > 1) d")).n);
  check(dupInitial === 0, "catalogue de départ : aucune position en double dans une catégorie");
  const dupFamily = Number((await one(scratch, "SELECT count(*)::int AS n FROM (SELECT family_id, category, position FROM products WHERE active GROUP BY 1, 2, 3 HAVING count(*) > 1) d")).n);
  lines.push(`  Articles de familles partageant une position (ordre départagé par le nom, non bloquant) : ${dupFamily} groupe(s)`);
  for (const k of ["raisins-secs", "cereales"]) {
    const r = await one(scratch, `SELECT name, category FROM initial_catalog WHERE key = '${k}' UNION ALL SELECT name, category FROM extended_catalog WHERE key = '${k}'`);
    lines.push(`  ${k} : ${r.name ?? "?"} → catégorie ${r.category ?? "?"}`);
  }
  const chips = String((await one(scratch, "SELECT name FROM extended_catalog WHERE key = 'chips-au-fromage-et-aux-oignons'")).name);
  const cereales = String((await one(scratch, "SELECT name FROM extended_catalog WHERE key = 'cereales'")).name);
  check(chips === "Chips" && cereales === "Céréales au chocolat", "noms « Chips » et « Céréales au chocolat »");

  // 6. Unités du catalogue commun
  const unitOf = async (k: string) => (await scratch.query("SELECT unit FROM initial_catalog WHERE key = $1 UNION ALL SELECT unit FROM extended_catalog WHERE key = $1", [k])).rows[0]?.unit;
  const wrong: string[] = [];
  for (const k of PIECE) if ((await unitOf(k)) !== "piece") wrong.push(`${k}=${await unitOf(k)}`);
  for (const [k, u] of OTHER) if ((await unitOf(k)) !== u) wrong.push(`${k}=${await unitOf(k)} (attendu ${u})`);
  check(wrong.length === 0, `unités décidées appliquées (${PIECE.length + OTHER.length} références)${wrong.length ? ` : ${wrong.join(", ")}` : ""}`);
  const sucreFmt = (await one(scratch, "SELECT format FROM initial_catalog WHERE key = 'sucre'")).format;
  check(sucreFmt === "paquet de 2 kg", "Sucre : format « paquet de 2 kg »");
  const pate = Number((await one(scratch, "SELECT count(*)::int AS n FROM extended_catalog WHERE lower(name) = 'pâte à tartiner'")).n);
  check(pate === 1, "Pâte à tartiner : une seule référence (aucun doublon)");

  // 7. Prix
  const sucreBase = await one(scratch, "SELECT amount::text AS a, ref_unit AS u FROM base_prices WHERE key = 'sucre' LIMIT 1");
  check(sucreBase.u !== "piece" && sucreBase.a !== "9.95", "Sucre : aucun prix au kg converti en prix du paquet, relevé 9,95 DH non importé");
  const sucreConv = Number((await one(scratch, `SELECT count(*)::int AS n FROM unit_corrections uc JOIN products p ON p.id::text = uc.ref
                                               WHERE uc.subject = 'family_price' AND uc.outcome = 'price_converted' AND p.catalog_key = 'sucre' AND uc.migration LIKE '030%'`)).n);
  check(sucreConv === 0, "Sucre : aucun prix de famille converti par la 030 (prix à compléter)");
  const toConfirm = Number((await one(scratch, "SELECT count(*)::int AS n FROM unit_corrections WHERE subject = 'family_price' AND outcome = 'price_to_confirm' AND migration LIKE '030%'")).n);
  const converted = Number((await one(scratch, "SELECT count(*)::int AS n FROM unit_corrections WHERE subject = 'family_price' AND outcome = 'price_converted' AND migration LIKE '030%'")).n);
  lines.push(`  Prix de familles (030) : ${converted} converti(s) exactement, ${toConfirm} conservé(s) et à compléter`);

  // 8. Monétisation, mise à jour et espace plateforme (031 à 035) : présents mais INACTIFS après le déploiement
  if (endSchema >= "035_platform_space.sql") {
    const q = await one(scratch, "SELECT coalesce(bool_or(enabled), false) AS on FROM list_quota_settings");
    const started = Number((await one(scratch, "SELECT count(*)::int AS n FROM families WHERE list_quota_since IS NOT NULL")).n);
    check(!q.on && started === 0, "listes gratuites : règle désactivée, aucune famille démarrée (aucun blocage)");
    const ent = Number((await one(scratch, "SELECT count(*)::int AS n FROM family_entitlements")).n);
    check(ent === 0, "droits payants : aucun");
    const open = Number((await one(scratch, "SELECT count(*)::int AS n FROM purchase_platforms WHERE enabled")).n);
    check(open === 0, "achats : fermés sur Android et sur iPhone");
    const req = Number((await one(scratch, "SELECT count(*)::int AS n FROM app_update_policy WHERE required_active")).n);
    check(req === 0, "mise à jour obligatoire : désactivée (Android et iPhone)");
    const pa = Number((await one(scratch, "SELECT count(*)::int AS n FROM platform_admins")).n);
    check(pa === 0, "espace plateforme : aucun droit attribué");
    const tok = await one(scratch, "SELECT count(*)::int AS n, count(DISTINCT store_account_token)::int AS d, count(*) FILTER (WHERE store_account_token IS NULL)::int AS z FROM families");
    check(tok.n === tok.d && tok.z === 0, `jeton store : un par famille, tous distincts (${tok.n} familles)`);
  }
  return { lines, problems };
}
