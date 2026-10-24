import { readFile } from "node:fs/promises";
import type pg from "pg";

/*
 * Aperçu de la migration 027 sur une copie ISOLÉE de la production (restauration de contrôle d'une sauvegarde) :
 * la migration est jouée dans une transaction ANNULÉE, puis seuls des totaux sont lus dans son journal.
 * Rien n'est écrit (ni sur la copie, ni ailleurs). Le rapport est public (journal GitHub) : aucun nom ou identifiant de famille,
 * de profil ou de produit n'y figure ; seulement des références du catalogue commun et des nombres.
 */
export async function previewUnitMigration(c: pg.Client, sqlPath: string): Promise<string[]> {
  const sql = await readFile(sqlPath, "utf8");
  const out: string[] = [];
  await c.query("BEGIN");
  try {
    await c.query(sql);
    const by = (await c.query("SELECT subject, outcome, count(*)::int AS n, count(DISTINCT family_id)::int AS f FROM unit_corrections GROUP BY 1, 2 ORDER BY 1, 2")).rows;
    out.push("APERÇU 027 (transaction annulée, rien n'est écrit) :");
    for (const r of by) out.push(`  ${r.subject} / ${r.outcome} : ${r.n}${r.subject === "product" || r.subject === "family_price" ? ` (${r.f} famille(s))` : ""}`);
    // Unités choisies par les familles, conservées : par référence du catalogue commun (aucune famille nommée)
    const custom = (
      await c.query(
        `SELECT coalesce(i.name, e.name) AS ref, uc.old_unit, uc.new_unit, count(DISTINCT uc.family_id)::int AS f
           FROM unit_corrections uc JOIN products p ON p.id::text = uc.ref
           LEFT JOIN initial_catalog i ON i.key = p.catalog_key LEFT JOIN extended_catalog e ON e.id = p.extended_id
          WHERE uc.subject = 'product' AND uc.outcome = 'unit_kept_custom' GROUP BY 1, 2, 3 ORDER BY 1, 2`,
      )
    ).rows;
    out.push(`Unités personnalisées conservées (cas à examiner) : ${custom.length === 0 ? "aucune" : ""}`);
    for (const r of custom) out.push(`  ${r.ref} : ${r.old_unit} conservé (unité retenue : ${r.new_unit}) — ${r.f} famille(s)`);
    // Prix personnels : convertis ou à confirmer, par référence
    const prices = (
      await c.query(
        `SELECT coalesce(i.name, e.name) AS ref, uc.outcome, count(*)::int AS n
           FROM unit_corrections uc JOIN products p ON p.id::text = uc.ref
           LEFT JOIN initial_catalog i ON i.key = p.catalog_key LEFT JOIN extended_catalog e ON e.id = p.extended_id
          WHERE uc.subject = 'family_price' GROUP BY 1, 2 ORDER BY 2, 1`,
      )
    ).rows;
    out.push(`Prix personnels concernés : ${prices.length === 0 ? "aucun" : ""}`);
    for (const r of prices) out.push(`  ${r.ref} : ${r.outcome === "price_converted" ? "converti exactement" : "conservé, à confirmer"} (${r.n})`);
    const renamed = (await c.query("SELECT count(*)::int AS n FROM unit_corrections WHERE subject = 'product' AND outcome = 'renamed'")).rows[0].n;
    out.push(`Articles de famille renommés (nom resté celui du catalogue) : ${renamed}`);
  } finally {
    await c.query("ROLLBACK");
  }
  return out;
}
