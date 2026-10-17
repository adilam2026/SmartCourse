// Génère les cas de test du port Kotlin de pricing.ts à partir du code TypeScript lui-même.
// Usage : node --experimental-strip-types scripts/gen-pricing-vectors.mjs > android-native/app/src/test/java/app/smartcourse/courses/nativeproto/net/PricingVectors.kt
import { lineAmount, fmtPrice, parseCents, parseMilli } from "../server/src/pricing.ts";

const prices = [
  { amount: "9.90", refQty: "1", refUnit: "kg" },
  { amount: "12.50", refQty: "500", refUnit: "g" },
  { amount: "3.80", refQty: "1", refUnit: "litre" },
  { amount: "2.50", refQty: "250", refUnit: "ml" },
  { amount: "1.50", refQty: "1", refUnit: "piece" },
  { amount: "14.00", refQty: "1", refUnit: "paquet", packaging: "250 g" },
  { amount: "10.95", refQty: "1", refUnit: "bouteille", packaging: "flacon de 750 ml" },
  { amount: "18.00", refQty: "1", refUnit: "boite" },
  { amount: "3.33", refQty: "0.25", refUnit: "kg" },
  { amount: "6.00", refQty: "12", refUnit: "piece" },
  { amount: "2.99", refQty: "2", refUnit: "brique" },
  { amount: "35.00", refQty: "1", refUnit: "kg", pieceWeightG: "250" },
  { amount: "1.50", refQty: "1", refUnit: "piece", pieceWeightG: "60.5" },
  { amount: "7.25", refQty: "1", refUnit: "pot", packaging: "125 g" },
  { amount: "0.99", refQty: "1", refUnit: "kg" },
];
const lines = [["1", "kg"], ["0.5", "kg"], ["0.125", "kg"], ["2.345", "kg"], ["1", "litre"], ["1.5", "litre"], ["0.333", "litre"], ["1", "piece"], ["12", "piece"], ["3", "piece"], ["2", "paquet"], ["1", "bouteille"], ["1", "boite"], ["4", "brique"], ["2", "pot"], ["0.75", "kg"], ["999", "kg"]];

const q = (s) => (s === null || s === undefined ? "null" : JSON.stringify(s).replace(/\$/g, "\\$"));
let out = `package app.smartcourse.courses.nativeproto.net\n\n// Fichier généré par scripts/gen-pricing-vectors.mjs à partir de server/src/pricing.ts — ne pas modifier à la main.\n\n`;
out += `data class PriceVector(val price: PriceRef, val qty: String, val unit: String, val ok: Boolean, val cents: Long, val reason: String)\n\n`;
out += `val PRICE_VECTORS: List<PriceVector> = listOf(\n`;
let n = 0;
for (const p of prices) for (const [qty, unit] of lines) {
  const a = lineAmount(p, qty, unit);
  out += `    PriceVector(PriceRef(${q(p.amount)}, ${q(p.refQty)}, ${q(p.refUnit)}, ${q(p.packaging)}, ${q(p.pieceWeightG)}), ${q(qty)}, ${q(unit)}, ${a.ok}, ${a.ok ? a.cents : 0}L, ${q(a.ok ? "" : a.reason)}),\n`;
  n++;
}
out += `)\n\nval FMT_VECTORS: List<Pair<PriceRef, String>> = listOf(\n`;
for (const p of prices) out += `    PriceRef(${q(p.amount)}, ${q(p.refQty)}, ${q(p.refUnit)}, ${q(p.packaging)}, ${q(p.pieceWeightG)}) to ${q(fmtPrice(p))},\n`;
out += `)\n\nval PARSE_VECTORS: List<Triple<String, Long?, Long?>> = listOf(\n`;
for (const s of ["9.90", "9,9", "0", "abc", "12.345", "1.5", ".5", "5.", "10", " 7.05 "]) out += `    Triple(${q(s)}, ${parseCents(s)}${parseCents(s) === null ? "" : "L"}, ${parseMilli(s)}${parseMilli(s) === null ? "" : "L"}),\n`;
out += `)\n`;
process.stdout.write(out);
console.error(`${n} cas`);
