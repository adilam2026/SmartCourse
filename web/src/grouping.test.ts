import { describe, expect, it } from "vitest";
import { eventsOfItem, groupByCategory, sectionGroups, validationGroups } from "./grouping";
import type { ListEvent, ListItem, ListView } from "./types";
import { clampQty, fmtQty, minOf, stepOf, stepQty } from "./units";
import { fmtMonth, fmtTime, fmtWhen } from "./format";

const cats = [{ key: "legumes", label: "Légumes" }, { key: "fruits", label: "Fruits" }, { key: "epicerie", label: "Épicerie" }];
const line = (id: string, category: string, status: ListItem["status"] = "to_buy"): ListItem => ({
  id, productId: id, category, name: id, brand: null, photoUrl: null, productActive: true, status, rev: 1, quantity: 1, unit: "piece",
});
const ev = (id: string, itemId: string, validationId: string, kind: ListEvent["kind"], at: string, by = "Marie"): ListEvent => ({
  id, itemId, productId: itemId, validationId, kind, before: null, after: 1, unit: "piece", at, by: { id: by, displayName: by }, name: itemId, category: "legumes",
});

describe("liste d'achats regroupée par catégorie", () => {
  it("tous les légumes ensemble, tous les fruits ensemble, quel que soit l'ordre ou l'heure d'ajout", () => {
    const g = groupByCategory([line("carottes", "legumes"), line("pommes", "fruits"), line("tomates", "legumes"), line("riz", "epicerie"), line("bananes", "fruits")], cats);
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([["Légumes", ["carottes", "tomates"]], ["Fruits", ["pommes", "bananes"]], ["Épicerie", ["riz"]]]);
  });
  it("l'ordre des catégories est celui du catalogue et reste stable quand une ligne arrive en direct", () => {
    const before = [line("pommes", "fruits"), line("riz", "epicerie")];
    const after = [...before, line("carottes", "legumes")]; // arrivée en dernier
    expect(groupByCategory(before, cats).map((x) => x.key)).toEqual(["fruits", "epicerie"]);
    expect(groupByCategory(after, cats).map((x) => x.key)).toEqual(["legumes", "fruits", "epicerie"]);
    // les groupes déjà affichés gardent leur contenu et leur ordre interne
    expect(groupByCategory(after, cats).find((x) => x.key === "fruits")!.items.map((i) => i.id)).toEqual(["pommes"]);
  });
  it("une catégorie inconnue passe en dernier ; le regroupement ne modifie ni ne perd aucune ligne", () => {
    const items = [line("x", "mystere"), line("a", "legumes"), line("b", "fruits")];
    const g = groupByCategory(items, cats);
    expect(g.map((x) => x.key)).toEqual(["legumes", "fruits", "mystere"]);
    expect(g.flatMap((x) => x.items)).toHaveLength(items.length);
    expect(items.map((i) => i.id)).toEqual(["x", "a", "b"]); // la liste d'origine est intacte
  });
  it("« À acheter » et « Achetés » sont séparés, chacun regroupé par catégorie ; un produit acheté puis redemandé figure dans les deux", () => {
    const list: ListView = { id: "L", status: "active", createdAt: "", closedAt: null, items: [line("lait", "epicerie", "purchased"), line("lait2", "epicerie"), line("tomates", "legumes"), line("pommes", "fruits", "purchased")] };
    expect(sectionGroups(list, "to_buy", cats).map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([["legumes", ["tomates"]], ["epicerie", ["lait2"]]]);
    expect(sectionGroups(list, "purchased", cats).map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([["fruits", ["pommes"]], ["epicerie", ["lait"]]]);
  });
});

describe("historique des validations", () => {
  const list: ListView = {
    id: "L", status: "active", createdAt: "", closedAt: null, items: [],
    validations: [
      { id: "v1", at: "2026-10-12T07:00:00Z", receivedAt: "2026-10-12T07:00:01Z", by: { id: "m", displayName: "Marie" } },
      { id: "v2", at: "2026-10-12T13:00:00Z", receivedAt: "2026-10-12T13:00:01Z", by: { id: "l", displayName: "Lamiaa" } },
    ],
    events: [
      ...["a", "b", "c", "d", "e"].map((x, i) => ev(`e${i}`, x, "v1", "add", "2026-10-12T07:00:00Z")),
      ...["f", "g", "h"].map((x, i) => ev(`f${i}`, x, "v2", "add", "2026-10-12T13:00:00Z", "Lamiaa")),
      { ...ev("q1", "a", "v2", "qty", "2026-10-12T13:00:00Z", "Lamiaa"), before: 1, after: 3 },
    ],
  };
  it("retrouve le groupe de 08:00 (5 articles) et celui de 14:00 (3 ajouts + 1 modification), le plus récent d'abord", () => {
    const g = validationGroups(list);
    expect(g.map((x) => [x.validation.by.displayName, x.events.length])).toEqual([["Lamiaa", 4], ["Marie", 5]]);
    expect(fmtTime(g[1]!.validation.at)).toBe("08:00"); // 07:00 UTC = 08:00 à Casablanca
    expect(fmtTime(g[0]!.validation.at)).toBe("14:00");
  });
  it("détail d'une ligne : ajout du matin puis modification de l'après-midi, avec l'ancienne et la nouvelle valeur", () => {
    expect(eventsOfItem(list, "a").map((e) => [e.kind, e.before, e.after, e.by.displayName])).toEqual([["add", null, 1, "Marie"], ["qty", 1, 3, "Lamiaa"]]);
  });
  it("une validation sans événement n'apparaît pas", () => {
    expect(validationGroups({ ...list, events: [] })).toEqual([]);
  });
});

describe("quantités et unités", () => {
  it("pièce, paquet, bouteille : pas de 1, minimum 1, « − » indisponible à 1", () => {
    for (const u of ["piece", "paquet", "bouteille"] as const) {
      expect([stepOf(u), minOf(u)]).toEqual([1, 1]);
      expect(stepQty(1, u, -1)).toBeNull();
      expect(stepQty(1, u, 1)).toBe(2);
      expect(stepQty(5, u, -1)).toBe(4);
    }
  });
  it("kg : décimales, pas de 0,5, minimum 0,1", () => {
    expect(stepOf("kg")).toBe(0.5);
    expect(stepQty(1, "kg", 1)).toBe(1.5);
    expect(stepQty(1.5, "kg", -1)).toBe(1);
    expect(stepQty(1, "kg", -1)).toBe(0.5);
    expect(stepQty(0.5, "kg", -1)).toBeNull(); // 0 n'existe pas : décocher retire l'article
    expect(stepQty(0.25, "kg", -1)).toBeNull();
    expect(stepQty(0.1 + 0.2, "kg", 1)).toBe(0.8); // pas de dérive d'arrondi (0,30000000000000004)
  });
  it("une saisie est ramenée à une valeur acceptée", () => {
    expect(clampQty(2.6, "piece")).toBe(3);
    expect(clampQty(0, "piece")).toBe(1);
    expect(clampQty(1.256, "kg")).toBe(1.26);
    expect(clampQty(0, "kg")).toBe(0.1);
    expect(clampQty(5000, "kg")).toBe(999);
    expect(clampQty(Number.NaN, "kg")).toBe(0.1);
  });
  it("affichage : virgule française, pluriel, kg invariable", () => {
    expect(fmtQty(1, "piece")).toBe("1 pièce");
    expect(fmtQty(3, "piece")).toBe("3 pièces");
    expect(fmtQty(2, "paquet")).toBe("2 paquets");
    expect(fmtQty(1.5, "kg")).toBe("1,5 kg");
    expect(fmtQty(2, "kg")).toBe("2 kg");
    expect(fmtQty(6, "bouteille")).toBe("6 bouteilles");
  });
});

describe("dates en Africa/Casablanca", () => {
  it("l'heure affichée suit le fuseau du foyer, pas celui du téléphone", () => {
    expect(fmtTime("2026-10-12T07:00:00Z")).toBe("08:00");
    expect(fmtTime("2026-10-12T13:00:00Z")).toBe("14:00");
    // Ramadan 2026 : le Maroc repasse à UTC+0 (février-mars)
    expect(fmtTime("2026-03-01T07:00:00Z")).toBe("07:00");
  });
  it("le jour change à minuit de Casablanca", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    expect(fmtWhen("2026-10-12T07:00:00Z", now)).toBe("08:00");
    expect(fmtWhen("2026-10-11T23:30:00Z", now)).toBe("00:30"); // 00:30 le 12 à Casablanca : le même jour que maintenant
    expect(fmtWhen("2026-10-10T07:00:00Z", now)).toMatch(/10/);
    expect(fmtMonth("2026-10")).toBe("Octobre 2026");
  });
});

import { purchasesDelta, quantityText } from "./stats";

describe("statistiques : textes", () => {
  it("comparaison de fréquence avec le mois précédent", () => {
    expect(purchasesDelta(3, 1, "septembre 2026")).toBe("+2 par rapport à septembre 2026 (1)");
    expect(purchasesDelta(1, 3, "septembre 2026")).toBe("−2 par rapport à septembre 2026 (3)");
    expect(purchasesDelta(2, 2, "septembre 2026")).toBe("comme en septembre 2026 (2)");
    expect(purchasesDelta(2, 0, "septembre 2026")).toMatch(/nouveau/);
    expect(purchasesDelta(0, 4, "septembre 2026")).toMatch(/aucun achat ce mois-ci \(4/);
    expect(purchasesDelta(0, 0, "x")).toBe("");
  });
  it("quantité : une seule unité par ligne ; les achats sans quantité sont signalés, pas inventés", () => {
    expect(quantityText({ purchases: 2, quantity: 3.5, unknownQuantity: 0 }, "kg")).toBe("3,5 kg");
    expect(quantityText({ purchases: 2, quantity: 6, unknownQuantity: 0 }, "paquet")).toBe("6 paquets");
    expect(quantityText({ purchases: 1, quantity: null, unknownQuantity: 1 }, null)).toBe("quantité non enregistrée");
    expect(quantityText({ purchases: 3, quantity: 2, unknownQuantity: 1 }, "kg")).toBe("2 kg + 1 achat sans quantité");
    expect(quantityText({ purchases: 0, quantity: null, unknownQuantity: 0 }, "kg")).toBe("—");
  });
});
