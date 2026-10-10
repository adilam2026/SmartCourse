import type { Batch, ListItem, ListView, Op, OpResult, Toggles } from "../types";
import { fmtQty } from "../units";

/*
 * Pure draft logic (no I/O) — the rules that keep choices safe across closing, reopening and reconnecting.
 *
 *   server state (list.items)  +  outbox (validated, not yet confirmed)  =  projected state
 *   toggles = choices not yet validated; each one differs from the projected state by construction.
 *
 * A product has at most ONE open line (to buy) in a list, and any number of bought lines. A bought product is locked: putting it
 * back on the list is a different, explicit act (a "new request", toggle.again) — never a side effect of a tap.
 */

/** The single line still to buy for this product. */
export const openItem = (list: ListView | null | undefined, productId: string): ListItem | undefined => list?.items.find((i) => i.productId === productId && i.status === "to_buy");
/** The most recent bought line for this product. */
export const boughtItem = (list: ListView | null | undefined, productId: string): ListItem | undefined => {
  const all = list?.items.filter((i) => i.productId === productId && i.status === "purchased") ?? [];
  return all[all.length - 1];
};

/** Is the product in the list (to buy) once the unconfirmed batches are applied? */
export function projectedPresence(list: ListView | null | undefined, batches: Batch[], productId: string): boolean {
  let present = !!openItem(list, productId);
  for (const b of batches) {
    for (const op of b.ops) {
      if ((op.type === "add" || op.type === "request_again") && op.productId === productId) present = true;
      if (op.type === "remove" && op.productId === productId) present = false;
    }
  }
  return present;
}

/** Quantity of the open line once the unconfirmed batches are applied (undefined when it is not in the list). */
export function projectedQty(list: ListView | null | undefined, batches: Batch[], productId: string): number | undefined {
  let q = openItem(list, productId)?.quantity;
  for (const b of batches) {
    for (const op of b.ops) {
      if (!("productId" in op) || op.productId !== productId) continue;
      if (op.type === "add" || op.type === "request_again") q = q ?? op.quantity ?? 1;
      else if (op.type === "set_qty") q = op.quantity;
      else if (op.type === "remove") q = undefined;
    }
  }
  return q;
}

/** Bought in this list and not (re)requested: locked. */
export const isPurchased = (list: ListView | null | undefined, productId: string, batches: Batch[] = []): boolean =>
  !!boughtItem(list, productId) && !projectedPresence(list, batches, productId);

/** How many revision steps the unconfirmed batches will add to this product's line (each applied set_qty / remove bumps it once). */
export function queuedBumps(batches: Batch[], productId: string): number {
  let n = 0;
  for (const b of batches) for (const op of b.ops) if ((op.type === "set_qty" || op.type === "remove") && op.productId === productId) n++;
  return n;
}

/** Revision the person is looking at, as it will be once their own queued changes are applied. */
const seenRevOf = (list: ListView | null | undefined, batches: Batch[], productId: string): number | undefined => {
  const line = openItem(list, productId);
  return line ? line.rev + queuedBumps(batches, productId) : undefined;
};

/** Drops toggles that no longer change anything (back to the projected state) or target a locked purchased article. */
export function normalizeToggles(list: ListView | null | undefined, batches: Batch[], toggles: Toggles): Toggles {
  const out: Toggles = {};
  for (const [productId, t] of Object.entries(toggles)) {
    const present = projectedPresence(list, batches, productId);
    const locked = isPurchased(list, productId, batches);
    if (locked && !t.again) continue; // a purchase always wins over a draft
    // The "new request" was made elsewhere meanwhile, or the bought line is gone: what remains is a plain choice.
    const tt = t.again && !locked ? { ...t, again: false } : t;
    if (tt.want === present) {
      if (!tt.want) continue; // back to the projected state: nothing to send
      if (tt.qty === undefined || tt.qty === projectedQty(list, batches, productId)) continue;
    }
    out[productId] = tt;
  }
  return out;
}

export const effectivePresence = (list: ListView | null | undefined, batches: Batch[], toggles: Toggles, productId: string): boolean =>
  toggles[productId]?.want ?? projectedPresence(list, batches, productId);

/** Quantity the card shows: the person's choice, else what the list holds, else the default (1). undefined = not in the list. */
export function effectiveQty(list: ListView | null | undefined, batches: Batch[], toggles: Toggles, productId: string): number | undefined {
  if (!effectivePresence(list, batches, toggles, productId)) return undefined;
  return toggles[productId]?.qty ?? projectedQty(list, batches, productId) ?? 1;
}

/** Flip the choice for a product. Toggling twice leaves no pending change. A bought product stays locked (see requestAgain). */
export function toggleProduct(list: ListView | null | undefined, batches: Batch[], toggles: Toggles, productId: string): Toggles {
  if (isPurchased(list, productId, batches) && !toggles[productId]?.again) return toggles;
  const current = effectivePresence(list, batches, toggles, productId);
  const prev = toggles[productId];
  const next: Toggles = { ...toggles, [productId]: { want: !current, qty: prev?.qty, again: prev?.again, seenRev: prev?.seenRev ?? seenRevOf(list, batches, productId) } };
  return normalizeToggles(list, batches, next);
}

/** Explicit "new request" for a bought product. */
export function requestAgainToggle(list: ListView | null | undefined, batches: Batch[], toggles: Toggles, productId: string, qty?: number): Toggles {
  if (!isPurchased(list, productId, batches)) return toggles;
  return { ...toggles, [productId]: { want: true, again: true, qty } };
}

/** Choose a quantity for a product that is in the list (on the server). */
export function setQuantityToggle(list: ListView | null | undefined, batches: Batch[], toggles: Toggles, productId: string, qty: number): Toggles {
  if (!effectivePresence(list, batches, toggles, productId)) return toggles;
  const prev = toggles[productId];
  const next: Toggles = { ...toggles, [productId]: { want: true, qty, again: prev?.again, seenRev: prev?.seenRev ?? seenRevOf(list, batches, productId) } };
  return normalizeToggles(list, batches, next);
}

/**
 * Operations for the pending toggles.
 *  - not in the list → add (or request_again when the person made the explicit new request);
 *  - in the list, other quantity → set_qty, valid only against the revision the person saw (a concurrent change is never overwritten);
 *  - unselected → remove, same revision rule.
 * A removal / quantity change on an article that has no server row yet (only a queued add) cannot be expressed: the caller edits or
 * cancels the queued add instead (see editQueuedAdd / cancelQueuedAdd).
 */
export function buildOps(list: ListView | null | undefined, batches: Batch[], toggles: Toggles, newId: () => string): Op[] {
  const ops: Op[] = [];
  for (const [productId, t] of Object.entries(toggles)) {
    const line = openItem(list, productId);
    const present = projectedPresence(list, batches, productId);
    if (!t.want) {
      const rev = t.seenRev ?? (line ? line.rev + queuedBumps(batches, productId) : undefined);
      if (rev !== undefined) ops.push({ opId: newId(), type: "remove", productId, baseRev: rev });
    } else if (t.again) {
      ops.push({ opId: newId(), type: "request_again", productId, ...(t.qty !== undefined ? { quantity: t.qty } : {}) });
    } else if (present && line) {
      const rev = t.seenRev ?? line.rev + queuedBumps(batches, productId);
      if (t.qty !== undefined) ops.push({ opId: newId(), type: "set_qty", productId, quantity: t.qty, baseRev: rev });
    } else {
      ops.push({ opId: newId(), type: "add", productId, ...(t.qty !== undefined ? { quantity: t.qty } : {}) });
    }
  }
  return ops;
}

/** Un-validating a product whose add is still queued: remove that add from the queued batch. */
export function cancelQueuedAdd(batches: Batch[], productId: string, inFlightBatchId?: string): { batches: Batch[]; ok: boolean } {
  const idx = batches.findIndex((b) => b.id !== inFlightBatchId && b.ops.some((o) => (o.type === "add" || o.type === "request_again") && o.productId === productId));
  if (idx < 0) return { batches, ok: false };
  const next = batches.map((b, i) => (i === idx ? { ...b, ops: b.ops.filter((o) => !((o.type === "add" || o.type === "request_again") && o.productId === productId)) } : b));
  return { batches: next.filter((b) => b.ops.length > 0), ok: true };
}

/** Changing the quantity of an article that exists only as a queued add: rewrites that add (never a second add). */
export function editQueuedAdd(batches: Batch[], productId: string, qty: number, inFlightBatchId?: string): { batches: Batch[]; ok: boolean } {
  const idx = batches.findIndex((b) => b.id !== inFlightBatchId && b.ops.some((o) => (o.type === "add" || o.type === "request_again") && o.productId === productId));
  if (idx < 0) return { batches, ok: false };
  const next = batches.map((b, i) => (i === idx ? { ...b, ops: b.ops.map((o) => ((o.type === "add" || o.type === "request_again") && o.productId === productId ? { ...o, quantity: qty } : o)) } : b));
  return { batches: next, ok: true };
}

export interface Interpreted {
  notices: string[];
  /** Products whose add was refused because the list was closed: offered again for the next list. */
  orphanAdds: string[];
}

const REASON_TEXT: Record<string, string> = {
  stale: "a changé entre-temps : vérifiez avant de le retirer",
  locked_purchased: "est déjà acheté : il ne peut plus être modifié",
  product_inactive: "est désactivé : il ne peut plus être ajouté",
  product_unknown: "est introuvable",
  item_unknown: "n'est plus dans la liste",
  item_removed: "a été retiré de la liste",
  bad_quantity: "a une quantité invalide",
};

/** Turns the server's per-operation answers into messages for the person and the products to offer again. */
export function interpretResults(batch: Batch, results: OpResult[], nameOf: (productId: string) => string): Interpreted {
  const byId = new Map(results.map((r) => [r.opId, r]));
  const notices: string[] = [];
  const orphanAdds: string[] = [];
  let closed = false;
  for (const op of batch.ops) {
    const r = byId.get(op.opId);
    if (!r) continue;
    if (op.type === "purchase" || op.type === "correct") continue;
    const name = nameOf(op.productId);
    const cur = r.detail?.quantity !== undefined && r.detail.unit ? fmtQty(r.detail.quantity, r.detail.unit) : null;
    if (r.status === "already") {
      // Nothing was duplicated; say what the list already holds when it differs from what was asked.
      if ((op.type === "add" || op.type === "request_again") && cur && op.quantity !== undefined && r.detail && op.quantity !== r.detail.quantity) notices.push(`« ${name} » était déjà dans la liste (${cur}) : la quantité n'a pas été changée.`);
      continue;
    }
    if (r.status !== "rejected") continue;
    if (r.reason === "list_closed") {
      closed = true;
      if (op.type === "add" || op.type === "request_again") orphanAdds.push(op.productId);
      continue;
    }
    if (r.reason === "already_purchased") {
      notices.push(`« ${name} » est déjà acheté${cur ? ` (${cur})` : ""}. Utilisez « Nouvelle demande » si vous en voulez encore.`);
    } else if (r.reason === "stale" && op.type === "set_qty") {
      const who = r.detail?.lastBy ? ` par ${r.detail.lastBy.displayName}` : "";
      notices.push(`« ${name} » a été modifié${who} entre-temps${cur ? ` (maintenant ${cur})` : ""} : votre changement n'a pas été appliqué.`);
    } else {
      notices.push(`« ${name} » ${REASON_TEXT[r.reason ?? ""] ?? "n'a pas pu être enregistré"}.`);
    }
  }
  if (closed) notices.unshift("La liste a été clôturée : vos choix n'ont pas été enregistrés.");
  return { notices, orphanAdds };
}
