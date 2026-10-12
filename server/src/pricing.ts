/*
 * Prix indicatifs : calcul décimal exact (aucun nombre à virgule flottante dans le montant).
 * Ce fichier est IDENTIQUE côté serveur (server/src/pricing.ts) et côté application (web/src/pricing.ts) : un test le vérifie.
 *
 * Un prix = un montant en dirhams (MAD) pour une quantité de référence dans une unité (1 kg, 500 g, 1 paquet…), avec le contenu
 * de référence quand il s'agit d'un conditionnement (« paquet de 250 g »). Un prix absent n'est jamais zéro.
 */

export type Unit = "piece" | "paquet" | "bouteille" | "brique" | "pot" | "boite" | "kg" | "litre";
export type RefUnit = Unit | "g" | "ml";
export const REF_UNITS: readonly RefUnit[] = ["kg", "g", "litre", "ml", "piece", "paquet", "bouteille", "brique", "pot", "boite"];

export interface PriceRef {
  /** Montant en MAD, écrit comme « 9.90 » ou 9.9 (jamais calculé avec des nombres à virgule flottante). */
  amount: string | number;
  refQty: string | number;
  refUnit: RefUnit;
  /** Contenu de référence d'un conditionnement : « 250 g », « 1 L ». */
  packaging?: string | null;
  /** Poids connu d'une pièce, en grammes : seule base d'une conversion pièce ↔ kg. */
  pieceWeightG?: string | number | null;
}

export type LineAmount = { ok: true; cents: number } | { ok: false; reason: "no_price" | "incompatible" };

const COUNT_UNITS = new Set<string>(["piece", "paquet", "bouteille", "brique", "pot", "boite"]);
type Kind = "mass" | "volume" | `count:${string}`;

/** « 9.90 » / « 9,9 » / 9.9 → 990 centimes (entier exact). null si illisible. */
export function parseCents(v: string | number): number | null {
  const s = String(v).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [i, d = ""] = s.split(".");
  return Number(i) * 100 + Number((d + "00").slice(0, 2));
}
/** Quantités : millièmes entiers (« 0.25 » → 250). null si illisible ou plus de 3 décimales. */
export function parseMilli(v: string | number): number | null {
  const s = String(v).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const [i, d = ""] = s.split(".");
  return Number(i) * 1000 + Number((d + "000").slice(0, 3));
}

const kindOfRef = (u: RefUnit): Kind => (u === "kg" || u === "g" ? "mass" : u === "litre" || u === "ml" ? "volume" : (`count:${u}` as Kind));
const kindOfUnit = (u: Unit): Kind => (u === "kg" ? "mass" : u === "litre" ? "volume" : (`count:${u}` as Kind));

/** Quantité de référence ramenée à la base (grammes, millilitres, ou millièmes d'unités comptées). */
function refBase(p: PriceRef): bigint | null {
  const m = parseMilli(p.refQty);
  if (m === null || m <= 0) return null;
  if (p.refUnit === "g" || p.refUnit === "ml") return m % 1000 === 0 ? BigInt(m / 1000) : null; // grammes / millilitres entiers
  return BigInt(m); // kg → grammes, litre → ml, unités comptées → millièmes
}

const half = (n: bigint, d: bigint): number => Number((2n * n + d) / (2n * d)); // arrondi monétaire : à la demi-unité supérieure

/** Montant d'une ligne en centimes, ou la raison pour laquelle il n'est pas calculé (jamais 0 par défaut). */
export function lineAmount(price: PriceRef | null | undefined, qty: number | string, unit: Unit): LineAmount {
  if (!price) return { ok: false, reason: "no_price" };
  const cents = parseCents(price.amount);
  const q = parseMilli(qty);
  const ref = refBase(price);
  if (cents === null || q === null || q <= 0 || ref === null) return { ok: false, reason: "incompatible" };
  const pk = kindOfRef(price.refUnit);
  const uk = kindOfUnit(unit);
  const price$ = BigInt(cents);
  if (pk === uk) return { ok: true, cents: half(price$ * BigInt(q), ref) };
  const w = price.pieceWeightG === null || price.pieceWeightG === undefined || price.pieceWeightG === "" ? null : parseCents(price.pieceWeightG); // centièmes de gramme
  if (w === null || w <= 0) return { ok: false, reason: "incompatible" };
  // Pièces vendues au poids (prix au kg/g, ligne en pièces) : grammes = pièces × poids d'une pièce.
  if (pk === "mass" && unit === "piece") return { ok: true, cents: half(price$ * BigInt(q) * BigInt(w), ref * 100000n) };
  // Prix à la pièce, ligne en kg : pièces = grammes ÷ poids d'une pièce.
  if (price.refUnit === "piece" && unit === "kg") return { ok: true, cents: half(price$ * BigInt(q) * 100n * 1000n, BigInt(w) * ref) };
  return { ok: false, reason: "incompatible" };
}

export interface Summary {
  /** Total connu, en centimes (somme des montants calculés, chacun arrondi). */
  cents: number;
  priced: number;
  /** Lignes sans prix ou à prix incompatible : jamais comptées comme 0. */
  unpriced: number;
  incomplete: boolean;
}
export function summarize(lines: { price?: PriceRef | null; qty: number | string; unit: Unit }[]): Summary {
  let cents = 0;
  let priced = 0;
  let unpriced = 0;
  for (const l of lines) {
    const a = lineAmount(l.price, l.qty, l.unit);
    if (a.ok) {
      cents += a.cents;
      priced++;
    } else unpriced++;
  }
  return { cents, priced, unpriced, incomplete: unpriced > 0 };
}

export const fmtMoney = (cents: number): string => `${(cents / 100).toFixed(2).replace(".", ",")} DH`;

const UNIT_SINGULAR: Record<string, string> = { piece: "pièce", paquet: "paquet", bouteille: "bouteille", brique: "brique", pot: "pot", boite: "boîte", kg: "kg", litre: "litre", g: "g", ml: "ml" };
const trimNum = (v: string | number): string => String(Number(String(v).replace(",", "."))).replace(".", ",");

/** « 9,90 DH / kg », « 12,50 DH / 500 g », « 14,00 DH / paquet de 250 g ». Seulement le prix, son unité ou son conditionnement. */
export function fmtPrice(p: PriceRef): string {
  const cents = parseCents(p.amount);
  const head = cents === null ? String(p.amount) : fmtMoney(cents);
  const q = Number(String(p.refQty).replace(",", "."));
  const u = UNIT_SINGULAR[p.refUnit] ?? p.refUnit;
  const per = q === 1 ? u : `${trimNum(p.refQty)} ${p.refUnit === "kg" || p.refUnit === "g" || p.refUnit === "ml" || p.refUnit === "litre" ? u : u + (q > 1 ? "s" : "")}`;
  const pack = p.packaging ? (COUNT_UNITS.has(p.refUnit) ? ` de ${p.packaging}` : ` (${p.packaging})`) : "";
  return `${head} / ${per}${pack}`;
}

/** Peut-on afficher un montant pour cette ligne ? (sinon « Prix à compléter » quand les prix sont activés) */
export const isComputable = (price: PriceRef | null | undefined, qty: number | string, unit: Unit): boolean => lineAmount(price, qty, unit).ok;

/**
 * Valeur comparable d'un prix, pour la mise en commun : prix au kg, au litre, ou par unité comptée (avec son contenu de référence :
 * des conditionnements différents ne se mélangent jamais). null si le format n'est pas exploitable.
 */
export function comparable(p: PriceRef): { format: string; centsPerBase: number } | null {
  const cents = parseCents(p.amount);
  const ref = refBase(p);
  if (cents === null || ref === null) return null;
  const k = kindOfRef(p.refUnit);
  if (k === "mass") return { format: "kg", centsPerBase: Number((BigInt(cents) * 1000n * 1000n) / ref) / 1000 };
  if (k === "volume") return { format: "litre", centsPerBase: Number((BigInt(cents) * 1000n * 1000n) / ref) / 1000 };
  const pack = (p.packaging ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return { format: `${k}|${pack}`, centsPerBase: Number((BigInt(cents) * 1000n * 1000n) / ref) / 1000 };
}
