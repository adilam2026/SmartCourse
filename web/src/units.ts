import type { Unit } from "./types";

export const UNITS: Unit[] = ["piece", "paquet", "bouteille", "brique", "pot", "boite", "kg", "litre"];
const SINGULAR: Record<Unit, string> = { piece: "pièce", paquet: "paquet", bouteille: "bouteille", brique: "brique", pot: "pot", boite: "boîte", kg: "kg", litre: "litre" };
const PLURAL: Record<Unit, string> = { piece: "pièces", paquet: "paquets", bouteille: "bouteilles", brique: "briques", pot: "pots", boite: "boîtes", kg: "kg", litre: "litres" };
export const UNIT_CHOICE: Record<Unit, string> = { piece: "Pièce", paquet: "Paquet", bouteille: "Bouteille", brique: "Brique", pot: "Pot", boite: "Boîte", kg: "Kilogramme (kg)", litre: "Litre" };

/** Units sold by weight or volume: quantities may have decimals. */
export const isFractional = (unit: Unit): boolean => unit === "kg" || unit === "litre";
/**
 * Counter step: whole units go by 1, kilograms and litres by half (a typed value may have any decimals).
 * In « prix et total » mode the step is a quarter (0,25 kg, 0,25 l): the existing quantities are never rounded, only the next tap moves by it.
 */
export const stepOf = (unit: Unit, fine = false): number => (isFractional(unit) ? (fine ? 0.25 : 0.5) : 1);
/** Smallest quantity: one whole unit, 100 g (or 0,1 l) for kilograms and litres. */
export const minOf = (unit: Unit): number => (isFractional(unit) ? 0.1 : 1);
export const MAX_QTY = 999;

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Brings a quantity to something the server accepts for this unit (whole numbers, at most 2 decimals for kg, within limits). */
export function clampQty(q: number, unit: Unit): number {
  if (!Number.isFinite(q)) return minOf(unit);
  const v = isFractional(unit) ? Math.round(q * 100) / 100 : Math.round(q);
  return Math.min(MAX_QTY, Math.max(minOf(unit), v));
}

/** The quantity after one tap on [+] (dir 1) or [−] (dir -1); null when that tap is not allowed (the button is disabled). */
export function stepQty(q: number, unit: Unit, dir: 1 | -1, fine = false): number | null {
  const next = round(q + dir * stepOf(unit, fine));
  if (next < minOf(unit) - 1e-9 || next > MAX_QTY) return null;
  return next;
}

/** "1,5 kg", "2 paquets", "1 pièce" (French decimal comma). */
export function fmtQty(q: number, unit: Unit): string {
  const n = Number.isInteger(q) ? String(q) : String(round(q)).replace(".", ",");
  return `${n} ${(unit === "litre" ? q >= 2 : q > 1 && unit !== "kg") ? PLURAL[unit] : SINGULAR[unit]}`;
}

export const unitLabel = (unit: Unit): string => SINGULAR[unit];
export const unitPlural = (unit: Unit): string => PLURAL[unit];
