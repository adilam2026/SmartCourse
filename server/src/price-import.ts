import { parseCents, parseMilli, REF_UNITS, type RefUnit } from "./pricing.js";

/*
 * Import de la base initiale des prix depuis le tableau validé (CSV, séparateur « ; », UTF-8).
 * Colonnes reconnues (en-têtes insensibles à la casse et aux accents) :
 *   cle_stable ; origine (initial | etendu) ; produit_observe ; montant ; quantite_reference ; unite_reference ; conditionnement ;
 *   poids_piece_g ; nature (observation | moyen | arrondi) ; source ; date_capture (AAAA-MM-JJ) ; statut (confirme | a confirmer) ;
 *   remise_conditionnelle (oui | non) ; valide_pour_generique (oui | non) ; remarque
 * Une ligne n'est retenue que si elle est confirmée, complète, sans remise conditionnelle et représentative du produit générique.
 * Rien n'est jamais deviné ni complété : une ligne douteuse est EXCLUE avec sa raison.
 */

export interface PriceRow {
  line: number;
  key: string;
  origin: "initial" | "extended";
  observed: string;
  amount: string;
  refQty: string;
  refUnit: RefUnit;
  packaging: string | null;
  pieceWeightG: string | null;
  kind: "observed" | "average" | "rounded";
  source: string;
  observedOn: string;
  note: string | null;
}
export interface Classified {
  line: number;
  key: string;
  retained: boolean;
  reasons: string[];
  row?: PriceRow;
  raw: Record<string, string>;
}

const flat = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const split = (l: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]!;
      if (q) {
        if (ch === '"' && l[i + 1] === '"') (cur += '"'), i++;
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ";") (out.push(cur), (cur = ""));
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]!).map(flat);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i] ?? `col${i}`, v.trim()])));
}

/** Produits dont un prix observé ne représente pas le produit générique, quoi que dise le reste de la ligne. */
const NEVER: Record<string, string> = {
  "nettoyant-sol": "le nettoyant sol reste sans prix (le prix observé concernait un nettoyant four)",
};
/** Libellé observé qui ne représente pas le produit générique (clé du catalogue → motif). */
const NOT_GENERIC: Record<string, RegExp> = {
  dinde: /brochette/,
  riz: /basmati/,
};
const DISCOUNT = /cashback|remise|promo|reduction|coupon|offre|fidelite|-\s?\d+\s?%/;

const yes = (v: string | undefined) => ["oui", "yes", "true", "1", "x"].includes(flat(v ?? ""));
const COUNT_REFS = new Set(["paquet", "bouteille", "brique", "pot", "boite"]);

export function classify(rows: Record<string, string>[], catalog: Map<string, "initial" | "extended">): Classified[] {
  return rows.map((raw, idx) => {
    const line = idx + 2;
    const key = (raw.cle_stable ?? "").trim();
    const reasons: string[] = [];
    const originRaw = flat(raw.origine ?? "");
    const origin: "initial" | "extended" | undefined = originRaw.startsWith("init") ? "initial" : originRaw.startsWith("etend") || originRaw.startsWith("compl") ? "extended" : catalog.get(key);
    const known = catalog.get(key);
    if (!key || !known) reasons.push("clé stable inconnue du catalogue : le prix ne peut pas être associé à un produit");
    else if (origin && origin !== known) reasons.push(`origine « ${raw.origine} » différente de celle du catalogue (${known})`);
    if (key in NEVER) reasons.push(NEVER[key]!);
    if (!["confirme", "confirmee", "confirmed", "valide"].includes(flat(raw.statut ?? ""))) reasons.push("à confirmer : non importé comme définitif");
    const cents = parseCents(raw.montant ?? "");
    if (cents === null || cents <= 0) reasons.push("montant absent ou illisible (en dirhams, 2 décimales au plus)");
    const q = parseMilli(raw.quantite_reference ?? "");
    const unit = flat(raw.unite_reference ?? "") === "l" ? "litre" : flat(raw.unite_reference ?? "");
    if (q === null || q <= 0) reasons.push("quantité de référence absente");
    if (!(REF_UNITS as readonly string[]).includes(unit)) reasons.push("unité de référence absente ou inconnue");
    else {
      if ((unit === "g" || unit === "ml") && q !== null && q % 1000 !== 0) reasons.push("en g ou ml, la quantité de référence doit être un nombre entier");
      if (COUNT_REFS.has(unit) && !(raw.conditionnement ?? "").trim()) reasons.push("format incomplet : prix par conditionnement sans contenu de référence (« paquet de … »)");
    }
    const nature = flat(raw.nature ?? "");
    const kind = nature.startsWith("obs") ? "observed" : nature.startsWith("moy") ? "average" : nature.startsWith("arr") ? "rounded" : undefined;
    if (!kind) reasons.push("nature du prix inconnue (observation d'une capture, prix moyen ou prix arrondi)");
    if (!/^\d{4}-\d{2}-\d{2}$/.test((raw.date_capture ?? "").trim())) reasons.push("date de capture absente (AAAA-MM-JJ)");
    if (!(raw.source ?? "").trim()) reasons.push("source absente");
    if (yes(raw.remise_conditionnelle) || DISCOUNT.test(flat(`${raw.remarque ?? ""} ${raw.produit_observe ?? ""}`))) reasons.push("remise ou cashback conditionnel : jamais déduit ni importé comme prix");
    const generic = NOT_GENERIC[key];
    if (generic && generic.test(flat(raw.produit_observe ?? "")) && !yes(raw.valide_pour_generique)) reasons.push("la référence observée ne représente pas le produit générique (validation spécifique nécessaire)");
    if (reasons.length > 0) return { line, key, retained: false, reasons, raw };
    return {
      line,
      key,
      retained: true,
      reasons: [],
      raw,
      row: {
        line,
        key,
        origin: known!,
        observed: (raw.produit_observe ?? "").trim(),
        amount: (cents! / 100).toFixed(2),
        refQty: String(q! / 1000),
        refUnit: unit as RefUnit,
        packaging: (raw.conditionnement ?? "").trim() || null,
        pieceWeightG: (raw.poids_piece_g ?? "").trim() ? ((parseCents(raw.poids_piece_g!) ?? 0) / 100).toFixed(2) : null,
        kind: kind!,
        source: (raw.source ?? "").trim(),
        observedOn: raw.date_capture!.trim(),
        note: (raw.remarque ?? "").trim() || null,
      },
    };
  });
}

/** Tableau de revue : lignes retenues et exclues, avec la raison de chaque exclusion. */
export function reportMarkdown(rows: Classified[]): string {
  const kept = rows.filter((r) => r.retained);
  const out = rows.filter((r) => !r.retained);
  const esc = (s: string) => s.replace(/\|/g, "/");
  const lines = [`## Lignes retenues (${kept.length})`, "", "| Ligne | Clé stable | Prix | Nature | Source | Capture |", "|---|---|---|---|---|---|"];
  for (const r of kept) lines.push(`| ${r.line} | ${r.key} | ${r.row!.amount} DH / ${r.row!.refQty} ${r.row!.refUnit}${r.row!.packaging ? ` (${esc(r.row!.packaging)})` : ""} | ${r.row!.kind} | ${esc(r.row!.source)} | ${r.row!.observedOn} |`);
  lines.push("", `## Lignes exclues (${out.length})`, "", "| Ligne | Clé stable | Raison(s) |", "|---|---|---|");
  for (const r of out) lines.push(`| ${r.line} | ${r.key || "—"} | ${esc(r.reasons.join(" ; "))} |`);
  return lines.join("\n") + "\n";
}
