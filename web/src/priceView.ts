import { isComputable, lineAmount, summarize, type Summary } from "./pricing";
import type { Catalog, ListItem, ListView, Prefs, Price, Unit } from "./types";

export const NO_PREFS: Prefs = { showPrices: false, showTotals: false, rev: 0 };

/** Prix en vigueur de chaque produit du catalogue (celui de la famille, sinon la base initiale). */
export function priceIndex(catalog: Catalog | null | undefined): Map<string, Price | null> {
  const m = new Map<string, Price | null>();
  for (const c of catalog?.categories ?? []) for (const p of c.products) m.set(p.id, p.price ?? null);
  return m;
}

/**
 * Prix d'une ligne : celui figé à sa validation. Une ligne antérieure aux prix (rien de figé) d'une liste en cours prend le prix actuel ;
 * dans une liste archivée elle n'a pas de prix (le passé n'est jamais réévalué).
 */
export function priceOfLine(item: ListItem | undefined, productId: string, index: Map<string, Price | null>, listActive: boolean): Price | null {
  if (item?.priceFrozen) return item.price ?? null;
  if (item && !listActive) return null;
  return index.get(productId) ?? null;
}

export interface Line {
  price: Price | null;
  qty: number;
  unit: Unit;
}
export const totalOf = (lines: Line[]): Summary => summarize(lines.map((l) => ({ price: l.price, qty: l.qty, unit: l.unit })));

/** Lignes d'une liste (à acheter et achetées) avec leur prix de référence. */
export function listLines(list: ListView, index: Map<string, Price | null>): Line[] {
  return list.items
    .filter((i) => i.status === "to_buy" || i.status === "purchased")
    .map((i) => ({ price: priceOfLine(i, i.productId, index, list.status === "active"), qty: i.status === "purchased" ? (i.purchase?.quantity ?? i.quantity) : i.quantity, unit: (i.status === "purchased" ? i.purchase?.unit : null) ?? i.unit }));
}

/** Le prix existe mais ne permet pas de calculer ce montant (unité ou conditionnement incompatible). */
export const needsCompletion = (p: Price | null, qty: number, unit: Unit): boolean => !!p && !isComputable(p, qty, unit);
export { lineAmount };
