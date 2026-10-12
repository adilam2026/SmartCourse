import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { withTx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import type { SseHub } from "./hub.js";
import { parseCents, parseMilli, REF_UNITS, type PriceRef, type RefUnit } from "./pricing.js";

type Q = Pick<Db, "query"> | pg.PoolClient;

export interface PriceView extends PriceRef {
  amount: string;
  refQty: string;
  packaging: string | null;
  pieceWeightG: string | null;
  /** Où le prix de ce produit se lit : base initiale commune, prix de la famille, ou prix communautaire appliqué par un administrateur. */
  source: "base" | "family" | "community";
  /** Base initiale seulement : observation d'une capture ou prix moyen / arrondi proposé, et la date de la capture. */
  basis?: { kind: "observed" | "average" | "rounded"; source: string; observedOn: string };
  updatedAt?: string;
}

const view = (r: any): PriceView | null =>
  r.amount === null || r.amount === undefined
    ? null
    : {
        amount: String(r.amount),
        refQty: String(Number(r.ref_qty)),
        refUnit: r.ref_unit as RefUnit,
        packaging: r.packaging ?? null,
        pieceWeightG: r.piece_weight_g === null || r.piece_weight_g === undefined ? null : String(Number(r.piece_weight_g)),
        source: r.price_source,
        ...(r.price_source === "base" ? { basis: { kind: r.kind, source: r.basis_source, observedOn: r.observed_on instanceof Date ? r.observed_on.toISOString().slice(0, 10) : String(r.observed_on) } } : {}),
        ...(r.updated_at ? { updatedAt: (r.updated_at as Date).toISOString() } : {}),
      };

/**
 * Prix en vigueur des produits d'une famille : le prix de la famille s'il existe, sinon la base initiale (par clé stable exacte
 * du catalogue). La base ne copie ni n'écrase jamais rien : un prix personnalisé reste le sien quoi qu'on importe ensuite.
 */
export async function loadPrices(q: Q, familyId: string, productIds?: string[]): Promise<Map<string, PriceView | null>> {
  const r = await q.query(
    `SELECT p.id AS product_id,
            coalesce(fp.amount, bp.amount) AS amount, coalesce(fp.ref_qty, bp.ref_qty) AS ref_qty, coalesce(fp.ref_unit, bp.ref_unit) AS ref_unit,
            CASE WHEN fp.product_id IS NOT NULL THEN fp.packaging ELSE bp.packaging END AS packaging,
            CASE WHEN fp.product_id IS NOT NULL THEN fp.piece_weight_g ELSE bp.piece_weight_g END AS piece_weight_g,
            CASE WHEN fp.product_id IS NOT NULL THEN fp.source WHEN bp.key IS NOT NULL THEN 'base' END AS price_source,
            bp.kind, bp.source AS basis_source, bp.observed_on, fp.updated_at
       FROM products p
       LEFT JOIN extended_catalog e ON e.id = p.extended_id
       LEFT JOIN family_prices fp ON fp.family_id = p.family_id AND fp.product_id = p.id
       LEFT JOIN base_prices bp ON fp.product_id IS NULL
                               AND ((p.catalog_key IS NOT NULL AND bp.origin = 'initial' AND bp.key = p.catalog_key)
                                 OR (p.extended_id IS NOT NULL AND bp.origin = 'extended' AND bp.key = e.key))
      WHERE p.family_id = $1 ${productIds ? "AND p.id = ANY($2::uuid[])" : ""}`,
    productIds ? [familyId, productIds] : [familyId],
  );
  const out = new Map<string, PriceView | null>();
  for (const row of r.rows) out.set(row.product_id, view(row));
  return out;
}

/**
 * Fige sur une ligne de liste le prix de référence en vigueur (appelé à chaque validation qui crée ou modifie la ligne, et lors d'une
 * réévaluation explicite). Aucun prix connu : les colonnes restent vides, ce qui n'est jamais « 0 ».
 */
export async function snapshotPrice(c: pg.PoolClient, familyId: string, itemId: string): Promise<void> {
  const it = (await c.query("SELECT product_id FROM list_items WHERE id = $1", [itemId])).rows[0];
  if (!it) return;
  const p = (await loadPrices(c, familyId, [it.product_id])).get(it.product_id) ?? null;
  await c.query(
    `UPDATE list_items SET price_amount = $2, price_ref_qty = $3, price_ref_unit = $4, price_packaging = $5, price_weight_g = $6, price_source = $7 WHERE id = $1`,
    [itemId, p?.amount ?? null, p?.refQty ?? null, p?.refUnit ?? null, p?.packaging ?? null, p?.pieceWeightG ?? null, p?.source ?? "none"],
  );
}

/** Prix figé d'une ligne ; `frozen` : false pour les lignes antérieures à cette fonction (aucun prix n'y a jamais été figé). */
export const priceOfItem = (r: any): PriceView | null =>
  r.price_amount === null || r.price_amount === undefined
    ? null
    : {
        amount: String(r.price_amount),
        refQty: String(Number(r.price_ref_qty)),
        refUnit: r.price_ref_unit,
        packaging: r.price_packaging ?? null,
        pieceWeightG: r.price_weight_g === null ? null : String(Number(r.price_weight_g)),
        source: r.price_source,
      };

const priceBody = z.object({
  amount: z.union([z.string(), z.number()]),
  refQty: z.union([z.string(), z.number()]),
  refUnit: z.enum(REF_UNITS as unknown as [RefUnit, ...RefUnit[]]),
  packaging: z.string().trim().max(60).nullish(),
  pieceWeightG: z.union([z.string(), z.number()]).nullish(),
});

/** Valide un prix saisi : montant en dirhams (2 décimales), quantité de référence (3 décimales), unité connue. */
export function checkPrice(b: z.infer<typeof priceBody>): { amount: string; refQty: string; refUnit: RefUnit; packaging: string | null; pieceWeightG: string | null } {
  const cents = parseCents(b.amount);
  if (cents === null || cents <= 0 || cents > 9_999_999) throw new HttpError(400, "invalid_price", "Le prix doit être un montant en dirhams (2 décimales au plus)");
  const q = parseMilli(b.refQty);
  if (q === null || q <= 0 || q > 9_999_000) throw new HttpError(400, "invalid_price_ref", "La quantité de référence est invalide");
  if ((b.refUnit === "g" || b.refUnit === "ml") && q % 1000 !== 0) throw new HttpError(400, "invalid_price_ref", "En grammes ou millilitres, la quantité de référence est un nombre entier");
  let w: string | null = null;
  if (b.pieceWeightG !== undefined && b.pieceWeightG !== null && String(b.pieceWeightG).trim() !== "") {
    const wc = parseCents(b.pieceWeightG);
    if (wc === null || wc <= 0 || wc > 99_999_99) throw new HttpError(400, "invalid_price_ref", "Le poids d'une pièce est invalide");
    w = (wc / 100).toFixed(2);
  }
  return { amount: (cents / 100).toFixed(2), refQty: (q / 1000).toString(), refUnit: b.refUnit, packaging: b.packaging ? b.packaging : null, pieceWeightG: w };
}

export const bumpCatalogRev = (q: Q, familyId: string) => q.query("UPDATE families SET catalog_rev = catalog_rev + 1 WHERE id = $1", [familyId]);

interface Deps {
  db: Db;
  guard: Guard;
  hub: SseHub;
}

export function priceRoutes(app: FastifyInstance, { db, guard, hub }: Deps): void {
  // ---- Préférences d'affichage, propres à chaque profil, synchronisées sur ses appareils. Désactivées par défaut.
  app.put("/api/me/prefs", { preHandler: guard() }, async (req) => {
    const b = z.object({ showPrices: z.boolean(), showTotals: z.boolean() }).parse(req.body);
    const showTotals = b.showTotals; // activer les montants implique d'afficher les prix
    const showPrices = b.showPrices || showTotals;
    const a = req.auth!;
    const r = await db.query("UPDATE profiles SET show_prices = $2, show_totals = $3, prefs_rev = prefs_rev + 1 WHERE id = $1 RETURNING prefs_rev", [a.profileId, showPrices, showTotals]);
    hub.broadcast(a.familyId, "prefs.updated", { profileId: a.profileId }); // les autres appareils de ce profil relisent ; les autres profils l'ignorent
    return { prefs: { showPrices, showTotals, rev: r.rows[0].prefs_rev as number } };
  });

  // ---- Prix d'un produit de la famille (administrateur). Reste dans la famille ; la base initiale ne l'écrase jamais.
  app.put("/api/products/:id/price", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = checkPrice(priceBody.parse(req.body));
    const a = req.auth!;
    await withTx(db, async (c) => {
      const p = (await c.query("SELECT id FROM products WHERE id = $1 AND family_id = $2", [id, a.familyId])).rows[0];
      if (!p) throw new HttpError(404, "not_found", "Produit introuvable");
      await c.query(
        `INSERT INTO family_prices (family_id, product_id, amount, ref_qty, ref_unit, packaging, piece_weight_g, source, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'family',$8, now())
         ON CONFLICT (family_id, product_id) DO UPDATE SET amount = $3, ref_qty = $4, ref_unit = $5, packaging = $6, piece_weight_g = $7, source = 'family', updated_by = $8, updated_at = now()`,
        [a.familyId, id, body.amount, body.refQty, body.refUnit, body.packaging, body.pieceWeightG, a.profileId],
      );
      await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action, details) VALUES ($1,$2,'price.set',$3)", [a.familyId, a.profileId, JSON.stringify({ productId: id })]);
      await bumpCatalogRev(c, a.familyId);
    });
    hub.broadcast(a.familyId, "catalog.updated", {});
    return { price: (await loadPrices(db, a.familyId, [id])).get(id) ?? null };
  });

  // « Rétablir le prix initial » : retire le prix personnalisé (la base initiale reprend). Les commandes archivées gardent le leur.
  app.delete("/api/products/:id/price", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const a = req.auth!;
    await withTx(db, async (c) => {
      const d = await c.query("DELETE FROM family_prices WHERE family_id = $1 AND product_id = $2", [a.familyId, id]);
      if (d.rowCount) {
        await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action, details) VALUES ($1,$2,'price.reset',$3)", [a.familyId, a.profileId, JSON.stringify({ productId: id })]);
        await bumpCatalogRev(c, a.familyId);
      }
    });
    hub.broadcast(a.familyId, "catalog.updated", {});
    return { price: (await loadPrices(db, a.familyId, [id])).get(id) ?? null };
  });
}
