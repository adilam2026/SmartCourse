import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify, parseCsv } from "../src/price-import.js";

const catalog = new Map<string, "initial" | "extended">();
for (const l of readFileSync("../docs/catalogue/liste-finale.csv", "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1)) {
  const c = l.split(";");
  if (c.length > 3) catalog.set(c[2]!, c[3]!.startsWith("Initial") ? "initial" : "extended");
}
const csv = () => parseCsv(readFileSync("../docs/prix/import-base.csv", "utf8"));
const sql = () => readFileSync("migrations/019_base_prices_initial.sql", "utf8");

describe("base initiale des prix (tableau validé du 12/10/2026)", () => {
  it("les 98 lignes à intégrer passent toutes les règles d'import (clé stable exacte, confirmées, complètes)", () => {
    const res = classify(csv(), catalog);
    expect(res.filter((r) => !r.retained).map((r) => [r.key, r.reasons])).toEqual([]);
    expect(res).toHaveLength(98);
    expect(new Set(res.map((r) => r.key)).size).toBe(98); // aucune clé en double
  });
  it("la migration insère exactement ces lignes, sans écrasement ; rien d'« en attente » ni de nettoyant sol", () => {
    const keys = csv().map((r) => r.cle_stable!);
    const inserted = [...sql().matchAll(/^\s+\('(initial|extended)', '([a-z0-9-]+)', /gm)].map((m) => m[2]);
    expect(inserted.sort()).toEqual([...keys].sort());
    expect(sql()).toContain("ON CONFLICT (origin, key) DO NOTHING");
    for (const k of ["riz", "huile-d-argan-alimentaire", "dinde", "nettoyant-multiusage", "desodorisant", "desinfectant-du-linge", "liquide-de-rincage-pour-lave-vaisselle", "deodorant", "shampooing", "apres-shampooing", "dentifrice", "coton", "nettoyant-sol"]) expect(inserted).not.toContain(k);
    const pending = parseCsv(readFileSync("../docs/prix/prix-en-attente.csv", "utf8"));
    expect(pending).toHaveLength(12);
    for (const p of pending) expect(inserted).not.toContain(p.cle_stable);
  });
  it("prix observés, moyennes et estimations arrondies restent distincts ; exemples du tableau", () => {
    const by = Object.fromEntries(classify(csv(), catalog).map((r) => [r.key, r.row!]));
    expect(by["tomates"]).toMatchObject({ amount: "9.90", refUnit: "kg", kind: "observed", observedOn: "2026-10-12" });
    expect(by["pommes-de-terre"]!.kind).toBe("rounded");
    expect(by["oignons"]!.kind).toBe("average");
    expect(by["thon-en-conserve"]).toMatchObject({ amount: "11.17", refUnit: "boite", packaging: "80 g", kind: "rounded" });
    expect(by["liquide-vaisselle"]).toMatchObject({ refUnit: "bouteille", packaging: "flacon de 750 ml" });
    expect(by["persil"]).toMatchObject({ amount: "3.90", refUnit: "paquet", packaging: "sachet (poids non précisé)" });
    expect(by["lait"]).toMatchObject({ amount: "11.00", refUnit: "litre" });
    expect(by["ail"]).toMatchObject({ refUnit: "kg", pieceWeightG: null }); // jamais de conversion en prix par tête sans poids
  });
});
