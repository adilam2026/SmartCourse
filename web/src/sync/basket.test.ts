import { describe, expect, it } from "vitest";
import type { ListItem, ListView, Unit } from "../types";
import { buildOps, planBasket } from "./logic";

const item = (productId: string, quantity: number, unit: Unit, status: ListItem["status"] = "to_buy", rev = 1): ListItem => ({
  id: `i-${productId}-${status}`, productId, category: "x", name: productId, brand: null, photoUrl: null, productActive: true, status, rev, quantity, unit,
});
const list = (items: ListItem[]): ListView => ({ id: "L", status: "active", createdAt: "", closedAt: null, items });
const catalog: Record<string, { active: boolean; unit: Unit }> = {
  tomates: { active: true, unit: "kg" },
  lait: { active: true, unit: "bouteille" },
  riz: { active: true, unit: "paquet" },
  vieux: { active: false, unit: "piece" },
  huile: { active: true, unit: "litre" },
};
const product = (id: string) => catalog[id];
const ops = (l: ListView, t: any) => buildOps(l, [], t, () => "id").map((o) => ({ type: o.type, productId: (o as any).productId, q: (o as any).quantity }));

describe("favoris et recommander : préparation d'une liste modifiable", () => {
  it("liste vide : tout est ajouté avec ses quantités ; les produits désactivés sont signalés, jamais réactivés", () => {
    const l = list([]);
    const r = planBasket({ list: l, batches: [], toggles: {}, mode: "add", product, items: [
      { productId: "tomates", name: "Tomates", quantity: 1.5, unit: "kg" },
      { productId: "vieux", name: "Vieux", quantity: 2, unit: "piece" },
      { productId: "lait", name: "Lait", quantity: 6, unit: "bouteille" },
    ] });
    expect(r.report).toMatchObject({ added: ["Tomates", "Lait"], inactive: ["Vieux"] });
    expect(ops(l, r.toggles)).toEqual([{ type: "add", productId: "tomates", q: 1.5 }, { type: "add", productId: "lait", q: 6 }]);
  });
  it("ajouter à la liste actuelle : pas de doublon, quantités additionnées seulement pour des unités compatibles", () => {
    const l = list([item("tomates", 1, "kg", "to_buy", 3), item("lait", 2, "bouteille", "to_buy", 2), item("riz", 1, "paquet", "to_buy", 1)]);
    const r = planBasket({ list: l, batches: [], toggles: {}, mode: "add", product, items: [
      { productId: "tomates", name: "Tomates", quantity: 0.25, unit: "kg" },
      { productId: "lait", name: "Lait", quantity: 6, unit: "litre" }, // unité différente : ni conversion ni somme
      { productId: "riz", name: "Riz", quantity: 2, unit: "paquet" },
    ] });
    expect(r.report).toMatchObject({ summed: ["Tomates", "Riz"], unitMismatch: ["Lait"], added: [] });
    expect(ops(l, r.toggles)).toEqual([{ type: "set_qty", productId: "tomates", q: 1.25 }, { type: "set_qty", productId: "riz", q: 3 }]);
  });
  it("remplacer : les lignes à acheter prennent le contenu ; les lignes achetées restent verrouillées ; rien n'est envoyé avant validation", () => {
    const l = list([item("tomates", 1, "kg", "to_buy", 4), item("lait", 2, "bouteille", "to_buy", 2), item("riz", 1, "paquet", "purchased")]);
    const r = planBasket({ list: l, batches: [], toggles: {}, mode: "replace", product, items: [
      { productId: "tomates", name: "Tomates", quantity: 3, unit: "kg" },
      { productId: "riz", name: "Riz", quantity: 1, unit: "paquet" },
      { productId: "huile", name: "Huile", quantity: 1.5, unit: "litre" },
    ] });
    expect(r.report).toMatchObject({ set: ["Tomates"], removed: ["lait"], added: ["Huile"] });
    expect(r.report.purchased).toEqual(["Riz"]); // déjà acheté dans cette liste : signalé, laissé tel quel
    const o = ops(l, r.toggles);
    expect(o).toEqual(expect.arrayContaining([{ type: "set_qty", productId: "tomates", q: 3 }, { type: "remove", productId: "lait", q: undefined }, { type: "add", productId: "huile", q: 1.5 }]));
    expect(o.some((x) => x.productId === "riz")).toBe(false);
  });
  it("le modèle n'est jamais modifié et un second ajout identique ne crée aucun doublon", () => {
    const items = [{ productId: "tomates", name: "Tomates", quantity: 1, unit: "kg" as Unit }];
    const snapshot = JSON.stringify(items);
    const l = list([]);
    const a = planBasket({ list: l, batches: [], toggles: {}, mode: "add", product, items });
    const b = planBasket({ list: l, batches: [], toggles: a.toggles, mode: "replace", product, items });
    expect(Object.keys(b.toggles)).toEqual(["tomates"]);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});
