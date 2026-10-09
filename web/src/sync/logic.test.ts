import { describe, expect, it } from "vitest";
import type { Batch, ListItem, ListView, OpResult } from "../types";
import { buildOps, cancelQueuedAdd, effectivePresence, interpretResults, normalizeToggles, toggleProduct } from "./logic";

const item = (productId: string, status: "to_buy" | "purchased" = "to_buy", rev = 1): ListItem => ({
  id: `item-${productId}`, productId, category: "c", name: productId, brand: null, photoUrl: null, productActive: true, status, rev,
});
const list = (...items: ListItem[]): ListView => ({ id: "L1", status: "active", createdAt: "", closedAt: null, items });
let n = 0;
const id = () => `op-${++n}`;

describe("brouillon", () => {
  it("critère 2 : cocher puis décocher sans autre changement ne laisse aucun changement en attente", () => {
    const l = list();
    let t = toggleProduct(l, [], {}, "lait");
    expect(Object.keys(t)).toEqual(["lait"]);
    t = toggleProduct(l, [], t, "lait");
    expect(t).toEqual({});
  });

  it("décocher un produit déjà présent puis le recocher ne laisse rien en attente", () => {
    const l = list(item("lait"));
    let t = toggleProduct(l, [], {}, "lait");
    expect(t["lait"]).toEqual({ want: false, seenRev: 1 });
    t = toggleProduct(l, [], t, "lait");
    expect(t).toEqual({});
  });

  it("critère 7 : un article acheté ne peut pas être décoché, même s'il figure dans un ancien brouillon", () => {
    const old = list(item("lait", "to_buy", 1));
    const draft = toggleProduct(old, [], {}, "lait"); // brouillon : « retirer le lait »
    const now = list(item("lait", "purchased", 2)); // un parent l'a acheté entre-temps
    expect(normalizeToggles(now, [], draft)).toEqual({});
    expect(toggleProduct(now, [], {}, "lait")).toEqual({});
    expect(buildOps(now, normalizeToggles(now, [], draft), id)).toEqual([]);
  });

  it("une demande déjà satisfaite par un autre membre disparaît du brouillon", () => {
    const draft = toggleProduct(list(), [], {}, "lait");
    const now = list(item("lait")); // quelqu'un d'autre l'a ajouté
    expect(normalizeToggles(now, [], draft)).toEqual({});
  });

  it("produit les opérations : ajout, et retrait avec la révision vue", () => {
    const l = list(item("riz", "to_buy", 3));
    let t = toggleProduct(l, [], {}, "lait");
    t = toggleProduct(l, [], t, "riz");
    const ops = buildOps(l, t, id);
    expect(ops).toEqual([
      expect.objectContaining({ type: "add", productId: "lait" }),
      expect.objectContaining({ type: "remove", productId: "riz", baseRev: 3 }),
    ]);
    expect(new Set(ops.map((o) => o.opId)).size).toBe(2);
  });

  it("le retrait garde la révision vue au moment du choix, pas celle d'après", () => {
    const seen = list(item("riz", "to_buy", 1));
    const t = toggleProduct(seen, [], {}, "riz");
    const later = list(item("riz", "to_buy", 3)); // acheté puis corrigé entre-temps
    expect(buildOps(later, normalizeToggles(later, [], t), id)).toEqual([expect.objectContaining({ baseRev: 1 })]);
  });
});

describe("file d'envoi", () => {
  const batch = (...ops: Batch["ops"]): Batch => ({ id: "b1", listId: "L1", ops, createdAt: 0 });

  it("l'état projeté inclut les envois non confirmés (le bouton reste grisé)", () => {
    const l = list();
    const b = batch({ opId: "o1", type: "add", productId: "lait" });
    expect(effectivePresence(l, [b], {}, "lait")).toBe(true);
    expect(normalizeToggles(l, [b], { lait: { want: true } })).toEqual({});
  });

  it("annuler un ajout encore en file le retire du lot", () => {
    const b = batch({ opId: "o1", type: "add", productId: "lait" }, { opId: "o2", type: "add", productId: "riz" });
    const r = cancelQueuedAdd([b], "lait");
    expect(r.ok).toBe(true);
    expect(r.batches[0]!.ops.map((o) => (o as { productId: string }).productId)).toEqual(["riz"]);
    expect(cancelQueuedAdd(r.batches, "riz").batches).toEqual([]); // lot vide supprimé
    expect(cancelQueuedAdd([b], "lait", "b1").ok).toBe(false); // lot en cours d'envoi : intouchable
  });

  it("critère 12 : une liste clôturée refuse tout ; les ajouts sont proposés pour la prochaine liste", () => {
    const b = batch({ opId: "o1", type: "add", productId: "lait" }, { opId: "o2", type: "remove", productId: "riz", baseRev: 1 });
    const results: OpResult[] = [
      { opId: "o1", status: "rejected", reason: "list_closed" },
      { opId: "o2", status: "rejected", reason: "list_closed" },
    ];
    const r = interpretResults(b, results, (p) => p);
    expect(r.orphanAdds).toEqual(["lait"]);
    expect(r.notices).toEqual(["La liste a été clôturée : vos choix n'ont pas été enregistrés."]);
  });

  it("explique un retrait périmé ou verrouillé", () => {
    const b = batch({ opId: "o1", type: "remove", productId: "lait", baseRev: 1 }, { opId: "o2", type: "remove", productId: "riz", baseRev: 1 });
    const r = interpretResults(b, [
      { opId: "o1", status: "rejected", reason: "stale" },
      { opId: "o2", status: "rejected", reason: "locked_purchased" },
    ], (p) => p.toUpperCase());
    expect(r.notices[0]).toContain("« LAIT » a changé");
    expect(r.notices[1]).toContain("« RIZ » est déjà acheté");
  });

  it("« already » et « applied » ne génèrent aucun message", () => {
    const b = batch({ opId: "o1", type: "add", productId: "lait" });
    expect(interpretResults(b, [{ opId: "o1", status: "already" }], (p) => p).notices).toEqual([]);
  });
});
