import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { comparable, fmtMoney, fmtPrice, lineAmount, parseCents, summarize, type PriceRef } from "../src/pricing.js";

const kg = (amount: string, refQty: string | number = 1): PriceRef => ({ amount, refQty, refUnit: "kg" });
const cents = (p: PriceRef | null, q: number | string, u: any) => {
  const r = lineAmount(p, q, u);
  return r.ok ? r.cents : r.reason;
};

describe("calcul décimal des prix", () => {
  it("0,25 kg × 9,90 DH/kg = 2,48 DH (arrondi monétaire à la demi-unité supérieure)", () => {
    expect(cents(kg("9.90"), 0.25, "kg")).toBe(248);
    expect(fmtMoney(248)).toBe("2,48 DH");
  });
  it("aucune dérive des nombres à virgule flottante", () => {
    expect(cents(kg("0.10"), 3, "kg")).toBe(30); // 0,1 × 3 ≠ 0,30000000000000004
    expect(cents(kg("1.15"), 3, "kg")).toBe(345);
    expect(cents(kg("19.99"), 0.333, "kg")).toBe(666); // 6,65667 → 6,66
    expect(parseCents("9,90")).toBe(990);
    expect(parseCents("9.999")).toBeNull();
  });
  it("conversions kg ↔ g et litre ↔ ml ; pas de pièce ↔ kg sans poids connu", () => {
    expect(cents({ amount: "12.50", refQty: 500, refUnit: "g" }, 1.5, "kg")).toBe(3750);
    expect(cents({ amount: "32.00", refQty: 500, refUnit: "ml" }, 0.25, "litre")).toBe(1600);
    expect(cents(kg("20"), 3, "piece")).toBe("incompatible");
    expect(cents({ amount: "2", refQty: 1, refUnit: "piece" }, 1.5, "kg")).toBe("incompatible");
    expect(cents({ ...kg("20"), pieceWeightG: 150 }, 4, "piece")).toBe(1200); // 4 × 150 g = 600 g à 20 DH/kg
    expect(cents({ amount: "2", refQty: 1, refUnit: "piece", pieceWeightG: 200 }, 1, "kg")).toBe(1000); // 5 pièces de 200 g
  });
  it("un prix par paquet ne s'applique qu'à des paquets ; unités comptées différentes incompatibles", () => {
    const p: PriceRef = { amount: "14", refQty: 1, refUnit: "paquet", packaging: "250 g" };
    expect(cents(p, 3, "paquet")).toBe(4200);
    expect(cents(p, 1, "piece")).toBe("incompatible");
    expect(cents(p, 1, "kg")).toBe("incompatible");
    expect(cents(kg("9"), 1, "paquet")).toBe("incompatible");
  });
  it("un prix absent n'est jamais zéro ; le total connu signale l'estimation incomplète", () => {
    expect(cents(null, 2, "kg")).toBe("no_price");
    const s = summarize([
      { price: kg("9.90"), qty: 0.25, unit: "kg" },
      { price: null, qty: 1, unit: "piece" },
      { price: kg("10"), qty: 1, unit: "paquet" },
    ]);
    expect(s).toEqual({ cents: 248, priced: 1, unpriced: 2, incomplete: true });
  });
  it("affichage : prix avec unité ou conditionnement seulement", () => {
    expect(fmtPrice(kg("9.90"))).toBe("9,90 DH / kg");
    expect(fmtPrice({ amount: "12.5", refQty: 500, refUnit: "g" })).toBe("12,50 DH / 500 g");
    expect(fmtPrice({ amount: "14", refQty: 1, refUnit: "paquet", packaging: "250 g" })).toBe("14,00 DH / paquet de 250 g");
    expect(fmtPrice({ amount: "10.95", refQty: 1, refUnit: "bouteille", packaging: "flacon de 750 ml" })).toBe("10,95 DH / flacon de 750 ml");
    expect(fmtPrice({ amount: "42.95", refQty: 1, refUnit: "piece", packaging: "rouleau de 20 mètres" })).toBe("42,95 DH / rouleau de 20 mètres");
  });
  it("prix comparables : formats différents jamais mélangés", () => {
    expect(comparable(kg("10", 1))!.centsPerBase).toBe(comparable({ amount: "5", refQty: 500, refUnit: "g" })!.centsPerBase);
    expect(comparable({ amount: "14", refQty: 1, refUnit: "paquet", packaging: "250 g" })!.format).not.toBe(comparable({ amount: "14", refQty: 1, refUnit: "paquet", packaging: "500 g" })!.format);
    expect(comparable(kg("10"))!.format).toBe("kg");
  });
  it("le module est identique côté serveur et côté application", () => {
    expect(readFileSync("../web/src/pricing.ts", "utf8")).toBe(readFileSync("src/pricing.ts", "utf8"));
  });
});
