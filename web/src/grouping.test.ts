import { describe, expect, it } from "vitest";
import { eventsOfItem, groupByCategory, sectionGroups, validationGroups } from "./grouping";
import type { ListEvent, ListItem, ListView } from "./types";
import { clampQty, fmtQty, minOf, stepOf, stepQty } from "./units";
import { fmtMonth, fmtTime, fmtWhen, isLate, lateNote } from "./format";

const cats = [{ key: "legumes", label: "Légumes" }, { key: "fruits", label: "Fruits" }, { key: "epicerie", label: "Épicerie" }];
const line = (id: string, category: string, status: ListItem["status"] = "to_buy"): ListItem => ({
  id, productId: id, category, name: id, brand: null, photoUrl: null, productActive: true, status, rev: 1, quantity: 1, unit: "piece",
});
const ev = (id: string, itemId: string, validationId: string, kind: ListEvent["kind"], at: string, by = "Marie"): ListEvent => ({
  id, itemId, productId: itemId, validationId, kind, before: null, after: 1, unit: "piece", at, receivedAt: at, by: { id: by, displayName: by }, name: itemId, category: "legumes",
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

import { lastPurchaseText, purchasesLine, shiftMonth, unitsText } from "./stats";
import { fmtDayRange, fmtDayRangeShort } from "./format";

const cell = (unit: any, purchases: number, quantity: number | null, unknownQuantity = 0) => ({ unit, purchases, quantity, unknownQuantity });

describe("statistiques : textes", () => {
  it("« 3 achats · 5 briques » : une seule unité par quantité, jamais d'addition entre unités", () => {
    expect(purchasesLine(3, [cell("brique", 3, 5)])).toBe("3 achats · 5 briques");
    expect(purchasesLine(1, [cell("brique", 1, 1)])).toBe("1 achat · 1 brique");
    expect(purchasesLine(3, [cell("kg", 2, 3.5), cell("paquet", 1, 2)])).toBe("3 achats · 3,5 kg + 2 paquets");
    expect(unitsText([cell("piece", 2, 3), cell("boite", 1, 1)])).toBe("3 pièces + 1 boîte");
  });
  it("les anciens achats sans quantité sont signalés, pas inventés", () => {
    expect(unitsText([cell(null, 1, null, 1)])).toBe("quantité non enregistrée");
    expect(unitsText([cell("kg", 3, 2, 1)])).toBe("2 kg + 1 achat sans quantité");
    expect(unitsText([cell("kg", 3, 2, 2), cell(null, 2, null, 2)])).toBe("2 kg + 4 achats sans quantité");
    expect(unitsText([])).toBe("—");
  });
  it("« Dernier achat : 10 octobre » (l'année n'est ajoutée que si ce n'est pas l'année en cours)", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    expect(lastPurchaseText("2026-10-10T09:00:00Z", now)).toBe("Dernier achat : 10 octobre");
    expect(lastPurchaseText("2025-12-31T09:00:00Z", now)).toBe("Dernier achat : 31 décembre 2025");
    expect(lastPurchaseText(null)).toBe("");
  });
  it("dates comparées lisibles", () => {
    expect(fmtDayRange("2026-10-01", "2026-10-11")).toBe("du 1 au 11 octobre 2026");
    expect(fmtDayRange("2026-08-01", "2026-10-11")).toBe("du 1 août au 11 octobre 2026");
    expect(fmtDayRangeShort("2026-09-01", "2026-09-11")).toBe("1 au 11 septembre");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
  it("singulier et pluriel des unités", () => {
    expect(fmtQty(1, "boite")).toBe("1 boîte");
    expect(fmtQty(2, "boite")).toBe("2 boîtes");
    expect(fmtQty(2, "pot")).toBe("2 pots");
    expect(fmtQty(1, "brique")).toBe("1 brique");
    expect(fmtQty(6, "bouteille")).toBe("6 bouteilles");
    expect(fmtQty(1.5, "kg")).toBe("1,5 kg");
    expect(fmtQty(1, "piece")).toBe("1 pièce");
  });
});

describe("heure du téléphone et heure de réception", () => {
  it("une validation reçue longtemps après l'appui est signalée « envoyé plus tard », avec les deux heures", () => {
    const now = new Date("2026-10-12T13:30:00Z");
    expect(isLate("2026-10-12T07:00:00Z", "2026-10-12T13:12:00Z")).toBe(true);
    expect(lateNote("2026-10-12T07:00:00Z", "2026-10-12T13:12:00Z", now)).toBe("envoyé plus tard (reçu 14:12)");
  });
  it("un envoi normal (quelques secondes, ou une courte coupure) n'est pas signalé", () => {
    expect(isLate("2026-10-12T07:00:00Z", "2026-10-12T07:00:03Z")).toBe(false);
    expect(isLate("2026-10-12T07:00:00Z", "2026-10-12T07:01:30Z")).toBe(false);
    expect(lateNote("2026-10-12T07:00:00Z", "2026-10-12T07:00:03Z")).toBe("");
    expect(lateNote("2026-10-12T07:00:00Z", undefined)).toBe(""); // ancien serveur : rien d'inventé
  });
  it("le seuil est de 2 minutes", () => {
    expect(isLate("2026-10-12T07:00:00Z", "2026-10-12T07:02:00Z")).toBe(false);
    expect(isLate("2026-10-12T07:00:00Z", "2026-10-12T07:02:01Z")).toBe(true);
  });
});

describe("kg : la quantité minimale atteignable est 0,5 kg", () => {
  it("depuis 1 kg, [−] n'est pas bloqué et mène à 0,5 ; depuis 0,5 il est grisé (décocher retire l'article)", () => {
    expect(stepQty(1, "kg", -1)).toBe(0.5);
    expect(stepQty(0.5, "kg", -1)).toBeNull();
    expect(stepQty(1.5, "kg", -1)).toBe(1);
    expect(stepQty(0.5, "kg", 1)).toBe(1);
  });
  it("une saisie de 0,5 est acceptée telle quelle (0,25 aussi : le minimum absolu est 0,1)", () => {
    expect(clampQty(0.5, "kg")).toBe(0.5);
    expect(clampQty(0.25, "kg")).toBe(0.25);
    expect(clampQty(0.05, "kg")).toBe(0.1);
  });
  it("pièces : le minimum reste 1", () => {
    expect(stepQty(1, "piece", -1)).toBeNull();
  });
});
