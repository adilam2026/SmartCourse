import type { Unit } from "./types";

export const UNITS: Unit[] = ["piece", "paquet", "bouteille", "kg"];
const SINGULAR: Record<Unit, string> = { piece: "pièce", paquet: "paquet", bouteille: "bouteille", kg: "kg" };
const PLURAL: Record<Unit, string> = { piece: "pièces", paquet: "paquets", bouteille: "bouteilles", kg: "kg" };
export const UNIT_CHOICE: Record<Unit, string> = { piece: "Pièce", paquet: "Paquet", bouteille: "Bouteille", kg: "Kilogramme (kg)" };

/** Counter step: whole units go by 1, kilograms by half a kilo (a typed value may have any decimals). */
export const stepOf = (unit: Unit): number => (unit === "kg" ? 0.5 : 1);
/** Smallest quantity: one whole unit, 100 g for kilograms. */
export const minOf = (unit: Unit): number => (unit === "kg" ? 0.1 : 1);
export const MAX_QTY = 999;

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Brings a quantity to something the server accepts for this unit (whole numbers, at most 2 decimals for kg, within limits). */
export function clampQty(q: number, unit: Unit): number {
  if (!Number.isFinite(q)) return minOf(unit);
  const v = unit === "kg" ? Math.round(q * 100) / 100 : Math.round(q);
  return Math.min(MAX_QTY, Math.max(minOf(unit), v));
}

/** The quantity after one tap on [+] (dir 1) or [−] (dir -1); null when that tap is not allowed (the button is disabled). */
export function stepQty(q: number, unit: Unit, dir: 1 | -1): number | null {
  const next = round(q + dir * stepOf(unit));
  if (next < minOf(unit) - 1e-9 || next > MAX_QTY) return null;
  return next;
}

/** "1,5 kg", "2 paquets", "1 pièce" (French decimal comma). */
export function fmtQty(q: number, unit: Unit): string {
  const n = Number.isInteger(q) ? String(q) : String(round(q)).replace(".", ",");
  return `${n} ${q > 1 && unit !== "kg" ? PLURAL[unit] : SINGULAR[unit]}`;
}

export const unitLabel = (unit: Unit): string => SINGULAR[unit];
export const unitPlural = (unit: Unit): string => PLURAL[unit];
