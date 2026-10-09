import type { Batch, ListItem, ListView, Op, OpResult, Toggles } from "../types";

/*
 * Pure draft logic (no I/O) — the rules that keep choices safe across closing, reopening and reconnecting.
 *
 *   server state (list.items)  +  outbox (validated, not yet confirmed)  =  projected state
 *   toggles = choices not yet validated; each one differs from the projected state by construction.
 */

const itemFor = (list: ListView | null | undefined, productId: string): ListItem | undefined =>
  list?.items.find((i) => i.productId === productId);

/** Is the product in the list once the unconfirmed batches are applied? */
export function projectedPresence(list: ListView | null | undefined, batches: Batch[], productId: string): boolean {
  let present = !!itemFor(list, productId);
  for (const b of batches) {
    for (const op of b.ops) {
      if (op.type === "add" && op.productId === productId) present = true;
      if (op.type === "remove" && op.productId === productId) present = false;
    }
  }
  return present;
}

export const isPurchased = (list: ListView | null | undefined, productId: string): boolean =>
  itemFor(list, productId)?.status === "purchased";

/** Drops toggles that no longer change anything (back to the projected state) or target a purchased article. */
export function normalizeToggles(list: ListView | null | undefined, batches: Batch[], toggles: Toggles): Toggles {
  const out: Toggles = {};
  for (const [productId, t] of Object.entries(toggles)) {
    if (isPurchased(list, productId)) continue; // locked: a purchase always wins over a draft
    if (t.want === projectedPresence(list, batches, productId)) continue;
    out[productId] = t;
  }
  return out;
}

/** Flip the choice for a product. Toggling twice leaves no pending change. */
export function toggleProduct(list: ListView | null | undefined, batches: Batch[], toggles: Toggles, productId: string): Toggles {
  if (isPurchased(list, productId)) return toggles;
  const current = toggles[productId]?.want ?? projectedPresence(list, batches, productId);
  const next: Toggles = { ...toggles, [productId]: { want: !current, seenRev: toggles[productId]?.seenRev ?? itemFor(list, productId)?.rev } };
  return normalizeToggles(list, batches, next);
}

export const effectivePresence = (list: ListView | null | undefined, batches: Batch[], toggles: Toggles, productId: string): boolean =>
  toggles[productId]?.want ?? projectedPresence(list, batches, productId);

/**
 * Operations for the pending toggles. A removal needs the revision the person saw: if the article has
 * no server row yet (it only exists in the outbox) there is nothing safe to remove — the caller must
 * cancel the queued add instead (see cancelQueuedAdd).
 */
export function buildOps(list: ListView | null | undefined, toggles: Toggles, newId: () => string): Op[] {
  const ops: Op[] = [];
  for (const [productId, t] of Object.entries(toggles)) {
    if (t.want) ops.push({ opId: newId(), type: "add", productId });
    else {
      const rev = t.seenRev ?? itemFor(list, productId)?.rev;
      if (rev !== undefined) ops.push({ opId: newId(), type: "remove", productId, baseRev: rev });
    }
  }
  return ops;
}

/** Un-validating a product whose add is still queued: remove that add from the queued batch. */
export function cancelQueuedAdd(batches: Batch[], productId: string, inFlightBatchId?: string): { batches: Batch[]; ok: boolean } {
  const idx = batches.findIndex((b) => b.id !== inFlightBatchId && b.ops.some((o) => o.type === "add" && o.productId === productId));
  if (idx < 0) return { batches, ok: false };
  const next = batches.map((b, i) => (i === idx ? { ...b, ops: b.ops.filter((o) => !(o.type === "add" && o.productId === productId)) } : b));
  return { batches: next.filter((b) => b.ops.length > 0), ok: true };
}

export interface Interpreted {
  notices: string[];
  /** Products whose add was refused because the list was closed: offered again for the next list. */
  orphanAdds: string[];
}

const REASON_TEXT: Record<string, string> = {
  stale: "a changé entre-temps : vérifiez avant de le retirer",
  locked_purchased: "est déjà acheté : il ne peut plus être retiré",
  product_inactive: "n'est plus proposé dans le catalogue",
  product_unknown: "est introuvable",
  item_unknown: "n'est plus dans la liste",
  item_removed: "a été retiré de la liste",
};

/** Turns the server's per-operation answers into messages for the person and the products to offer again. */
export function interpretResults(batch: Batch, results: OpResult[], nameOf: (productId: string) => string): Interpreted {
  const byId = new Map(results.map((r) => [r.opId, r]));
  const notices: string[] = [];
  const orphanAdds: string[] = [];
  let closed = false;
  for (const op of batch.ops) {
    const r = byId.get(op.opId);
    if (!r || r.status !== "rejected") continue;
    if (r.reason === "list_closed") {
      closed = true;
      if (op.type === "add") orphanAdds.push(op.productId);
      continue;
    }
    if (op.type === "add" || op.type === "remove") {
      const text = REASON_TEXT[r.reason ?? ""] ?? "n'a pas pu être enregistré";
      notices.push(`« ${nameOf(op.productId)} » ${text}.`);
    }
  }
  if (closed) notices.unshift("La liste a été clôturée : vos choix n'ont pas été enregistrés.");
  return { notices, orphanAdds };
}
