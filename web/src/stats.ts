import type { StatsCell } from "./api";
import type { Unit } from "./types";
import { fmtQty } from "./units";

/** Frequency comparison with the previous month, in words (never a percentage on tiny numbers). */
export function purchasesDelta(cur: number, prev: number, prevLabel: string): string {
  if (cur === 0 && prev === 0) return "";
  if (prev === 0) return `nouveau (aucun achat en ${prevLabel})`;
  if (cur === 0) return `aucun achat ce mois-ci (${prev} en ${prevLabel})`;
  const d = cur - prev;
  if (d === 0) return `comme en ${prevLabel} (${prev})`;
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} par rapport à ${prevLabel} (${prev})`;
}

/**
 * Quantity of one product in ONE unit. Quantities of different units are never added together: each unit is its own row.
 * Purchases made before quantities existed count as purchases but have no quantity: it is said, not invented.
 */
export function quantityText(cell: StatsCell, unit: Unit | null): string {
  if (cell.purchases === 0) return "—";
  if (cell.quantity === null || unit === null) return "quantité non enregistrée";
  const base = fmtQty(cell.quantity, unit);
  return cell.unknownQuantity > 0 ? `${base} + ${cell.unknownQuantity} achat${cell.unknownQuantity > 1 ? "s" : ""} sans quantité` : base;
}
