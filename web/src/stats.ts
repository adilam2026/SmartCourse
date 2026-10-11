import type { StatsUnitCell } from "./api";
import { fmtDayMonth } from "./format";
import { fmtQty } from "./units";

const plural = (n: number, one: string, many = `${one}s`) => (n > 1 ? many : one);

/**
 * What was bought of ONE product, unit by unit — never added across units:
 *   "5 briques", "2 kg + 3 paquets", "5 briques + 1 achat sans quantité", "quantité non enregistrée".
 * Purchases made before quantities existed have no quantity: it is said, never invented.
 */
export function unitsText(cells: StatsUnitCell[]): string {
  const parts: string[] = [];
  let unknown = 0;
  for (const c of cells) {
    if (c.unit !== null && c.quantity !== null) parts.push(fmtQty(c.quantity, c.unit));
    unknown += c.unknownQuantity;
  }
  if (unknown > 0) parts.push(parts.length === 0 ? "quantité non enregistrée" : `${unknown} ${plural(unknown, "achat")} sans quantité`);
  return parts.length ? parts.join(" + ") : "—";
}

/** "3 achats · 5 briques". An « achat » is one line marked « Acheté » — not a number of shop visits. */
export const purchasesLine = (purchases: number, cells: StatsUnitCell[]): string => `${purchases} ${plural(purchases, "achat")} · ${unitsText(cells)}`;

/** "Dernier achat : 10 octobre". */
export const lastPurchaseText = (iso: string | null, now = new Date()): string => (iso ? `Dernier achat : ${fmtDayMonth(iso, now)}` : "");

/** Calendar month "YYYY-MM" shifted by `delta` months. */
export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
