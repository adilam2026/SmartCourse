import type pg from "pg";
import { withTx, type Db } from "./db.js";
import type { AuthContext } from "./auth.js";
import { HttpError } from "./errors.js";
import type { SseHub } from "./hub.js";

/*
 * Concurrency protocol (one transaction per operation):
 *   1. every mutation locks its list row FOR SHARE  -> mutations run in parallel with each other,
 *      2. then the item row FOR UPDATE                -> but are serialised per article,
 *   while closing takes the list row FOR UPDATE      -> waits for in-flight mutations, and any mutation
 *      arriving afterwards sees `archived` once the lock is granted and is rejected.
 * State checks and writes happen under those locks, in the same transaction. Lock order is always
 * list -> item -> purchase, so there is no deadlock cycle.
 */

export type Unit = "piece" | "paquet" | "bouteille" | "kg";
export const UNITS: readonly Unit[] = ["piece", "paquet", "bouteille", "kg"];

export type OpIn =
  | { opId: string; type: "add"; productId: string; quantity?: number }
  | { opId: string; type: "remove"; productId: string; baseRev: number }
  | { opId: string; type: "set_qty"; productId: string; quantity: number; baseRev: number }
  /** Explicit new request for a product that was already bought in this list (never done silently by "add"). */
  | { opId: string; type: "request_again"; productId: string; quantity?: number }
  | { opId: string; type: "purchase"; itemId: string }
  | { opId: string; type: "correct"; purchaseId: string; reason?: string | null };

/** One press on "Valider": the operations it carries share this identity, author and time. */
export interface BatchIn {
  id: string;
  /** When the person pressed Valider (device clock). Kept within a plausible window, see sanitizeAt. */
  at?: string;
}

export type RejectReason =
  | "list_closed"
  | "product_unknown"
  | "product_inactive"
  | "item_unknown"
  | "item_removed"
  | "locked_purchased"
  | "already_purchased"
  | "bad_quantity"
  | "duplicate_open"
  | "stale"
  | "purchase_unknown";

export interface OpResult {
  opId: string;
  status: "applied" | "already" | "rejected";
  reason?: RejectReason;
  /** Who/when and the current quantity, for "already …" / "changed meanwhile" answers (names are for parents only). */
  detail?: { purchasedBy?: { id: string; displayName: string }; purchasedAt?: string; quantity?: number; unit?: Unit; lastBy?: { id: string; displayName: string } };
  replay?: boolean;
}

interface Executed {
  result: Omit<OpResult, "opId">;
  itemId?: string;
}

const rejected = (reason: RejectReason, detail?: OpResult["detail"]): Executed => ({ result: { status: "rejected", reason, ...(detail ? { detail } : {}) } });

const num = (v: unknown): number => Number(v);
/** Quantities are stored with 3 decimals; whole units (piece, paquet, bouteille) must be whole numbers. */
export function normalizeQuantity(q: number | undefined, unit: Unit): number | null {
  const v = q ?? 1;
  if (!Number.isFinite(v) || v <= 0 || v > 999) return null;
  const r = Math.round(v * 1000) / 1000;
  if (unit !== "kg" && !Number.isInteger(r)) return null;
  return r;
}

/** The device clock is trusted only within a plausible window around the server's: 30 days back, 2 minutes ahead. */
export function sanitizeAt(clientAt: string | undefined, now: Date): Date {
  if (!clientAt) return now;
  const t = new Date(clientAt);
  if (Number.isNaN(t.getTime())) return now;
  if (t.getTime() > now.getTime() + 2 * 60_000) return now;
  if (t.getTime() < now.getTime() - 30 * 86_400_000) return now;
  return t;
}

async function purchaseDetail(c: pg.PoolClient, listId: string, productId: string): Promise<OpResult["detail"]> {
  const r = await c.query(
    `SELECT pu.purchased_at, pu.quantity, pu.unit, i.quantity AS item_qty, i.unit AS item_unit, pr.id, pr.display_name
       FROM purchases pu JOIN list_items i ON i.id = pu.list_item_id JOIN profiles pr ON pr.id = pu.purchased_by
      WHERE pu.list_id = $1 AND i.product_id = $2 AND pu.voided_at IS NULL ORDER BY pu.purchased_at DESC LIMIT 1`,
    [listId, productId],
  );
  const row = r.rows[0];
  return row
    ? { purchasedBy: { id: row.id, displayName: row.display_name }, purchasedAt: row.purchased_at.toISOString(), quantity: num(row.quantity ?? row.item_qty), unit: (row.unit ?? row.item_unit) as Unit }
    : undefined;
}

interface EventCtx {
  c: pg.PoolClient;
  a: AuthContext;
  listId: string;
  validationId: string;
  at: Date;
}

/** Creates (once) the validation a batch of operations belongs to; the first operation of the batch fixes its time. */
async function ensureValidation(c: pg.PoolClient, a: AuthContext, listId: string, batch: BatchIn | undefined, opId: string, now: Date): Promise<{ id: string; at: Date }> {
  const want = batch?.id ?? opId;
  const at = sanitizeAt(batch?.at, now);
  // What the phone announced is kept as is (even when its clock was implausible and the server's time is shown instead).
  const raw = batch?.at ? new Date(batch.at) : null;
  const clientAt = raw && !Number.isNaN(raw.getTime()) ? raw : null;
  const ins = await c.query("INSERT INTO validations (id, list_id, family_id, actor_id, at, client_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id, at", [want, listId, a.familyId, a.profileId, at, clientAt]);
  if (ins.rows[0]) return { id: want, at: ins.rows[0].at as Date };
  const cur = (await c.query("SELECT id, at, list_id, actor_id FROM validations WHERE id = $1", [want])).rows[0];
  if (cur && cur.list_id === listId && cur.actor_id === a.profileId) return { id: want, at: cur.at as Date };
  // An id already used by someone else/another list: never attach to it, fall back to the operation's own identity.
  const own = await c.query("INSERT INTO validations (id, list_id, family_id, actor_id, at, client_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET id = validations.id RETURNING id, at", [opId, listId, a.familyId, a.profileId, at, clientAt]);
  return { id: opId, at: own.rows[0].at as Date };
}

async function logEvent(e: EventCtx, itemId: string, productId: string, kind: "add" | "qty" | "remove" | "request_again" | "correct" | "merge", before: number | null, after: number | null, unit: Unit) {
  await e.c.query(
    `INSERT INTO list_events (list_id, family_id, item_id, product_id, validation_id, kind, qty_before, qty_after, unit, actor_id, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [e.listId, e.a.familyId, itemId, productId, e.validationId, kind, before, after, unit, e.a.profileId, e.at],
  );
}

// "Open" lines: the single line per product that is still to buy (or was removed and can be revived).
const OPEN = "status IN ('to_buy','removed')";

async function execAdd(e: EventCtx, op: Extract<OpIn, { type: "add" }>): Promise<Executed> {
  const { c, a, listId } = e;
  const prod = (await c.query("SELECT id, active, unit FROM products WHERE id = $1 AND family_id = $2", [op.productId, a.familyId])).rows[0];
  if (!prod) return rejected("product_unknown");
  const unit = prod.unit as Unit;
  const q = normalizeQuantity(op.quantity, unit);
  if (q === null) return rejected("bad_quantity");
  const find = () => c.query(`SELECT * FROM list_items WHERE list_id = $1 AND product_id = $2 AND ${OPEN} FOR UPDATE`, [listId, op.productId]);
  let item = (await find()).rows[0];
  if (!item) {
    // Bought earlier in this list and nothing open: a plain "add" must NOT silently put it back to buy.
    const bought = await purchaseDetail(c, listId, op.productId);
    if (bought) return rejected("already_purchased", bought);
    if (!prod.active) return rejected("product_inactive");
    // If a concurrent member inserts the same product first, ON CONFLICT waits for them and inserts nothing.
    const ins = await c.query(
      `INSERT INTO list_items (list_id, family_id, product_id, added_by, quantity, unit) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (list_id, product_id) WHERE status IN ('to_buy','removed') DO NOTHING RETURNING id`,
      [listId, a.familyId, op.productId, a.profileId, q, unit],
    );
    if (ins.rows[0]) {
      await logEvent(e, ins.rows[0].id, op.productId, "add", null, q, unit);
      return { result: { status: "applied" }, itemId: ins.rows[0].id };
    }
    item = (await find()).rows[0];
  }
  if (item.status !== "removed") return { result: { status: "already", detail: { quantity: num(item.quantity), unit: item.unit } }, itemId: item.id };
  if (!prod.active) return rejected("product_inactive");
  await c.query("UPDATE list_items SET status = 'to_buy', rev = rev + 1, added_by = $2, added_at = $3, updated_at = now(), quantity = $4, unit = $5 WHERE id = $1", [item.id, a.profileId, e.at, q, unit]);
  await logEvent(e, item.id, op.productId, "add", null, q, unit);
  return { result: { status: "applied" }, itemId: item.id };
}

async function execRequestAgain(e: EventCtx, op: Extract<OpIn, { type: "request_again" }>): Promise<Executed> {
  const { c, a, listId } = e;
  const prod = (await c.query("SELECT id, active, unit FROM products WHERE id = $1 AND family_id = $2", [op.productId, a.familyId])).rows[0];
  if (!prod) return rejected("product_unknown");
  const unit = prod.unit as Unit;
  const q = normalizeQuantity(op.quantity, unit);
  if (q === null) return rejected("bad_quantity");
  const open = (await c.query(`SELECT * FROM list_items WHERE list_id = $1 AND product_id = $2 AND ${OPEN} FOR UPDATE`, [listId, op.productId])).rows[0];
  if (open && open.status === "to_buy") return { result: { status: "already", detail: { quantity: num(open.quantity), unit: open.unit } }, itemId: open.id };
  if (!prod.active) return rejected("product_inactive");
  if (open) {
    // A removed line of this product exists (unique per list while not purchased): revive it as the new request.
    await c.query("UPDATE list_items SET status = 'to_buy', rev = rev + 1, added_by = $2, added_at = $3, updated_at = now(), quantity = $4, unit = $5 WHERE id = $1", [open.id, a.profileId, e.at, q, unit]);
    await logEvent(e, open.id, op.productId, "request_again", null, q, unit);
    return { result: { status: "applied" }, itemId: open.id };
  }
  const bought = await purchaseDetail(c, listId, op.productId);
  if (!bought) return rejected("item_unknown"); // nothing was bought: a request again makes no sense, use "add"
  const ins = await c.query(
    `INSERT INTO list_items (list_id, family_id, product_id, added_by, quantity, unit) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (list_id, product_id) WHERE status IN ('to_buy','removed') DO NOTHING RETURNING id`,
    [listId, a.familyId, op.productId, a.profileId, q, unit],
  );
  if (!ins.rows[0]) {
    const cur = (await c.query(`SELECT id, quantity, unit FROM list_items WHERE list_id = $1 AND product_id = $2 AND ${OPEN}`, [listId, op.productId])).rows[0];
    return { result: { status: "already", detail: { quantity: num(cur.quantity), unit: cur.unit } }, itemId: cur.id };
  }
  await logEvent(e, ins.rows[0].id, op.productId, "request_again", null, q, unit);
  return { result: { status: "applied" }, itemId: ins.rows[0].id };
}

async function lastEditor(c: pg.PoolClient, itemId: string): Promise<{ id: string; displayName: string } | undefined> {
  const r = (await c.query("SELECT pr.id, pr.display_name FROM list_events ev JOIN profiles pr ON pr.id = ev.actor_id WHERE ev.item_id = $1 ORDER BY ev.seq DESC LIMIT 1", [itemId])).rows[0];
  return r ? { id: r.id, displayName: r.display_name } : undefined;
}

async function execRemove(e: EventCtx, op: Extract<OpIn, { type: "remove" }>): Promise<Executed> {
  const { c, listId } = e;
  const item = (await c.query(`SELECT * FROM list_items WHERE list_id = $1 AND product_id = $2 AND ${OPEN} FOR UPDATE`, [listId, op.productId])).rows[0];
  if (!item) {
    const bought = await purchaseDetail(c, listId, op.productId);
    return bought ? rejected("locked_purchased", bought) : rejected("item_unknown");
  }
  if (item.status === "removed") return { result: { status: "already" }, itemId: item.id };
  // The draft was built on an older state of this article (quantity changed by someone else, bought then corrected…).
  if (item.rev !== op.baseRev) return { ...rejected("stale", { quantity: num(item.quantity), unit: item.unit, lastBy: await lastEditor(c, item.id) }), itemId: item.id };
  await c.query("UPDATE list_items SET status = 'removed', rev = rev + 1, updated_at = now() WHERE id = $1", [item.id]);
  await logEvent(e, item.id, op.productId, "remove", num(item.quantity), null, item.unit);
  return { result: { status: "applied" }, itemId: item.id };
}

async function execSetQty(e: EventCtx, op: Extract<OpIn, { type: "set_qty" }>): Promise<Executed> {
  const { c, listId } = e;
  const item = (await c.query(`SELECT * FROM list_items WHERE list_id = $1 AND product_id = $2 AND ${OPEN} FOR UPDATE`, [listId, op.productId])).rows[0];
  if (!item) {
    const bought = await purchaseDetail(c, listId, op.productId);
    return bought ? rejected("locked_purchased", bought) : rejected("item_unknown");
  }
  if (item.status === "removed") return { ...rejected("item_removed"), itemId: item.id };
  const q = normalizeQuantity(op.quantity, item.unit as Unit);
  if (q === null) return rejected("bad_quantity");
  // Optimistic concurrency: the quantity was chosen on revision baseRev. If someone changed the article since, nothing is overwritten.
  if (item.rev !== op.baseRev) {
    if (num(item.quantity) === q) return { result: { status: "already", detail: { quantity: q, unit: item.unit } }, itemId: item.id }; // same value: nothing to lose
    return { ...rejected("stale", { quantity: num(item.quantity), unit: item.unit, lastBy: await lastEditor(c, item.id) }), itemId: item.id };
  }
  if (num(item.quantity) === q) return { result: { status: "already", detail: { quantity: q, unit: item.unit } }, itemId: item.id };
  await c.query("UPDATE list_items SET quantity = $2, rev = rev + 1, updated_at = now() WHERE id = $1", [item.id, q]);
  await logEvent(e, item.id, op.productId, "qty", num(item.quantity), q, item.unit);
  return { result: { status: "applied" }, itemId: item.id };
}

async function execPurchase(c: pg.PoolClient, a: AuthContext, listId: string, op: Extract<OpIn, { type: "purchase" }>): Promise<Executed> {
  const item = (await c.query("SELECT * FROM list_items WHERE id = $1 AND list_id = $2 AND family_id = $3 FOR UPDATE", [op.itemId, listId, a.familyId])).rows[0];
  if (!item) return rejected("item_unknown");
  if (item.status === "removed") return { ...rejected("item_removed"), itemId: item.id };
  if (item.status === "purchased") return { result: { status: "already", detail: await purchaseDetail(c, listId, item.product_id) }, itemId: item.id };
  // Product, quantity and unit are frozen on the purchase: statistics never depend on later renames or unit changes.
  await c.query("INSERT INTO purchases (list_item_id, list_id, family_id, purchased_by, product_id, quantity, unit) VALUES ($1,$2,$3,$4,$5,$6,$7)", [item.id, listId, a.familyId, a.profileId, item.product_id, item.quantity, item.unit]);
  await c.query("UPDATE list_items SET status = 'purchased', rev = rev + 1, updated_at = now() WHERE id = $1", [item.id]);
  return { result: { status: "applied" }, itemId: item.id };
}

async function execCorrect(e: EventCtx, op: Extract<OpIn, { type: "correct" }>): Promise<Executed> {
  const { c, a, listId } = e;
  // The purchase must belong to this family AND to this (active) list.
  const pu = (await c.query("SELECT list_item_id FROM purchases WHERE id = $1 AND family_id = $2 AND list_id = $3", [op.purchaseId, a.familyId, listId])).rows[0];
  if (!pu) return rejected("purchase_unknown");
  const item = (await c.query("SELECT * FROM list_items WHERE id = $1 FOR UPDATE", [pu.list_item_id])).rows[0];
  const cur = (await c.query("SELECT voided_at FROM purchases WHERE id = $1 FOR UPDATE", [op.purchaseId])).rows[0];
  if (cur.voided_at) return { result: { status: "already" }, itemId: pu.list_item_id };
  const open = (await c.query(`SELECT * FROM list_items WHERE list_id = $1 AND product_id = $2 AND ${OPEN} AND id <> $3 FOR UPDATE`, [listId, item.product_id, item.id])).rows[0];
  if (open && open.status === "to_buy" && open.unit !== item.unit) return rejected("duplicate_open", { quantity: num(open.quantity), unit: open.unit });
  const reason = op.reason?.trim() ? op.reason.trim().slice(0, 300) : null; // a missing reason never blocks
  await c.query("UPDATE purchases SET voided_by = $2, voided_at = now(), void_reason = $3 WHERE id = $1", [op.purchaseId, a.profileId, reason]);
  if (open && open.status === "to_buy") {
    // A new request for the same product is already waiting: the corrected quantity joins it (one open line per product).
    const merged = Math.min(999, Math.round((num(open.quantity) + num(item.quantity)) * 1000) / 1000);
    await c.query("UPDATE list_items SET status = 'corrected', rev = rev + 1, updated_at = now() WHERE id = $1", [item.id]);
    await c.query("UPDATE list_items SET quantity = $2, rev = rev + 1, updated_at = now() WHERE id = $1", [open.id, merged]);
    // Nothing is lost: the purchase stays in the corrections (buyer, time, quantity), the quantity joins the open line, and the event
    // keeps the quantity before and after with the person who corrected.
    await logEvent(e, open.id, open.product_id, "merge", num(open.quantity), merged, open.unit);
    return { result: { status: "applied" }, itemId: open.id };
  }
  if (open) {
    // A removed line occupies the single open slot: it takes over, the corrected line is retired.
    await c.query("UPDATE list_items SET status = 'corrected', rev = rev + 1, updated_at = now() WHERE id = $1", [item.id]);
    await c.query("UPDATE list_items SET status = 'to_buy', quantity = $2, unit = $3, rev = rev + 1, updated_at = now() WHERE id = $1", [open.id, item.quantity, item.unit]);
    await logEvent(e, open.id, open.product_id, "correct", null, num(item.quantity), item.unit);
    return { result: { status: "applied" }, itemId: open.id };
  }
  await c.query("UPDATE list_items SET status = 'to_buy', rev = rev + 1, updated_at = now() WHERE id = $1", [item.id]);
  await logEvent(e, item.id, item.product_id, "correct", null, num(item.quantity), item.unit);
  return { result: { status: "applied" }, itemId: item.id };
}

/** Applies one idempotent operation. Replaying the same (profile, opId) returns the original result. */
async function runOp(db: Db, a: AuthContext, listId: string, op: OpIn, batch?: BatchIn): Promise<{ result: OpResult; itemId?: string; changed: boolean }> {
  return withTx(db, async (c) => {
    const claimed = await c.query(
      "INSERT INTO op_log (profile_id, op_id, type, list_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING op_id",
      [a.profileId, op.opId, op.type, listId],
    );
    if (!claimed.rows[0]) {
      // The conflicting insert (if still in flight) has been waited for: its result is visible now.
      const prev = (await c.query("SELECT result FROM op_log WHERE profile_id = $1 AND op_id = $2", [a.profileId, op.opId])).rows[0];
      if (prev?.result) return { result: { ...(prev.result as OpResult), replay: true }, changed: false };
      throw new HttpError(409, "op_in_progress", "Opération déjà en cours");
    }
    const list = (await c.query("SELECT status FROM lists WHERE id = $1 AND family_id = $2 FOR SHARE", [listId, a.familyId])).rows[0];
    if (!list) throw new HttpError(404, "not_found", "Liste introuvable");

    let ex: Executed;
    if (list.status === "archived") ex = rejected("list_closed");
    else if (op.type === "purchase") ex = await execPurchase(c, a, listId, op);
    else {
      // Every other operation writes events: they belong to the validation (one press on "Valider") that carried them.
      const v = await ensureValidation(c, a, listId, batch, op.opId, new Date());
      const e: EventCtx = { c, a, listId, validationId: v.id, at: v.at };
      if (op.type === "add") ex = await execAdd(e, op);
      else if (op.type === "remove") ex = await execRemove(e, op);
      else if (op.type === "set_qty") ex = await execSetQty(e, op);
      else if (op.type === "request_again") ex = await execRequestAgain(e, op);
      else ex = await execCorrect(e, op);
    }

    const result: OpResult = { opId: op.opId, ...ex.result };
    await c.query("UPDATE op_log SET result = $3 WHERE profile_id = $1 AND op_id = $2", [a.profileId, op.opId, JSON.stringify(result)]);
    return { result, itemId: ex.itemId, changed: ex.result.status === "applied" };
  });
}

export async function applyOps(db: Db, hub: SseHub, a: AuthContext, listId: string, ops: OpIn[], batch?: BatchIn) {
  const results: OpResult[] = [];
  const changedItems: string[] = [];
  for (const op of ops) {
    const r = await runOp(db, a, listId, op, batch);
    results.push(a.role === "staff" ? stripDetail(r.result) : r.result);
    if (r.changed && r.itemId) changedItems.push(r.itemId);
  }
  // After commit: tell the other members something changed (they refetch the list state).
  if (changedItems.length) hub.broadcast(a.familyId, "list.updated", { listId, itemIds: changedItems });
  return { results, list: await getListView(db, a, listId) };
}

/** Staff learn the current quantity, never who bought or edited. */
const stripDetail = (r: OpResult): OpResult => {
  if (!r.detail) return r;
  const { purchasedBy: _p, purchasedAt: _t, lastBy: _l, ...safe } = r.detail;
  const { detail: _d, ...rest } = r;
  return Object.keys(safe).length ? { ...rest, detail: safe } : rest;
};

// ------------------------------------------------------------------------------------------------

export async function createList(db: Db, hub: SseHub, a: AuthContext): Promise<{ id: string }> {
  try {
    const r = await db.query<{ id: string }>("INSERT INTO lists (family_id, created_by) VALUES ($1,$2) RETURNING id", [a.familyId, a.profileId]);
    hub.broadcast(a.familyId, "list.created", { listId: r.rows[0]!.id });
    return r.rows[0]!;
  } catch (e: any) {
    if (e.code === "23505") {
      const cur = await db.query("SELECT id FROM lists WHERE family_id = $1 AND status = 'active'", [a.familyId]);
      throw new HttpError(409, "active_exists", `Une liste est déjà en cours (${cur.rows[0]?.id ?? "?"})`);
    }
    throw e;
  }
}

export interface CloseResult {
  status: "applied" | "already";
  remaining: number;
  purchased: number;
}

export async function closeList(db: Db, hub: SseHub, a: AuthContext, listId: string): Promise<CloseResult> {
  const out = await withTx(db, async (c) => {
    // FOR UPDATE: waits for every in-flight mutation (they hold FOR SHARE) and blocks new ones until commit.
    const list = (await c.query("SELECT status FROM lists WHERE id = $1 AND family_id = $2 FOR UPDATE", [listId, a.familyId])).rows[0];
    if (!list) throw new HttpError(404, "not_found", "Liste introuvable");
    let status: CloseResult["status"] = "already";
    if (list.status === "active") {
      // Freeze what the archive shows (name, brand, category, photo version) before the list becomes read-only.
      await c.query(
        `UPDATE list_items i SET snapshot_name = p.name, snapshot_brand = p.brand, snapshot_photo_asset_id = p.photo_asset_id,
                snapshot_category = p.category
           FROM products p WHERE p.id = i.product_id AND i.list_id = $1`,
        [listId],
      );
      await c.query("UPDATE lists SET status = 'archived', closed_by = $2, closed_at = now() WHERE id = $1", [listId, a.profileId]);
      await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action, details) VALUES ($1,$2,'list.closed',$3)", [a.familyId, a.profileId, JSON.stringify({ listId })]);
      status = "applied";
    }
    const counts = (await c.query(
      `SELECT count(*) FILTER (WHERE status = 'to_buy')::int AS remaining, count(*) FILTER (WHERE status = 'purchased')::int AS purchased
         FROM list_items WHERE list_id = $1`,
      [listId],
    )).rows[0];
    return { status, ...counts } as CloseResult;
  });
  if (out.status === "applied") hub.broadcast(a.familyId, "list.closed", { listId });
  return out;
}

// ------------------------------------------------------------------------------------------------
// Views

const photoUrl = (id: string | null) => (id ? `/api/photos/${id}` : null);

export async function getListView(db: Db, a: AuthContext, listId: string) {
  const l = (await db.query("SELECT * FROM lists WHERE id = $1 AND family_id = $2", [listId, a.familyId])).rows[0];
  if (!l) throw new HttpError(404, "not_found", "Liste introuvable");
  const archived = l.status === "archived";
  const parentView = a.role !== "staff";
  const items = await db.query(
    `SELECT i.id, i.product_id, i.status, i.rev, i.quantity, i.unit, i.added_at, cat.key AS category, p.active AS product_active, p.position,
            ${archived ? "coalesce(i.snapshot_name, p.name)" : "p.name"} AS name,
            ${archived ? "i.snapshot_brand" : "p.brand"} AS brand,
            ${archived ? "i.snapshot_photo_asset_id" : "p.photo_asset_id"} AS photo_asset_id,
            pu.id AS purchase_id, pu.purchased_at, pu.quantity AS purchase_qty, pu.unit AS purchase_unit, pb.id AS buyer_id, pb.display_name AS buyer_name,
            ab.id AS adder_id, ab.display_name AS adder_name
       FROM list_items i
       JOIN products p ON p.id = i.product_id
       JOIN categories cat ON cat.key = ${archived ? "coalesce(i.snapshot_category, p.category)" : "p.category"}
       JOIN profiles ab ON ab.id = i.added_by
       LEFT JOIN purchases pu ON pu.list_item_id = i.id AND pu.voided_at IS NULL
       LEFT JOIN profiles pb ON pb.id = pu.purchased_by
      WHERE i.list_id = $1 AND i.status NOT IN ('removed','corrected')
      ORDER BY cat.position, ${archived ? "lower(coalesce(i.snapshot_name, p.name))" : "p.position, lower(p.name)"}, i.added_at`,
    [listId],
  );
  // Journal of the list (parents only): who changed what, and when. Staff only see the resulting quantity.
  const ev = parentView
    ? (await db.query(
        `SELECT ev.id, ev.seq, ev.item_id, ev.product_id, ev.validation_id, ev.kind, ev.qty_before, ev.qty_after, ev.unit, ev.at, va.received_at, ev.actor_id, pr.display_name AS actor_name,
                ${archived ? "coalesce(i.snapshot_name, p.name)" : "p.name"} AS name, cat.key AS category
           FROM list_events ev
           JOIN list_items i ON i.id = ev.item_id
           JOIN products p ON p.id = ev.product_id
           JOIN categories cat ON cat.key = ${archived ? "coalesce(i.snapshot_category, p.category)" : "p.category"}
           JOIN profiles pr ON pr.id = ev.actor_id
           JOIN validations va ON va.id = ev.validation_id
          WHERE ev.list_id = $1 ORDER BY ev.seq`,
        [listId],
      )).rows
    : [];
  const events = ev.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    productId: r.product_id,
    validationId: r.validation_id,
    kind: r.kind as string,
    before: r.qty_before === null ? null : num(r.qty_before),
    after: r.qty_after === null ? null : num(r.qty_after),
    unit: r.unit as Unit,
    at: r.at.toISOString(),
    receivedAt: r.received_at.toISOString(),
    by: { id: r.actor_id as string, displayName: r.actor_name as string },
    name: r.name as string,
    category: r.category as string,
  }));
  const lastOf = new Map<string, (typeof events)[number]>();
  const startOf = new Map<string, (typeof events)[number]>();
  for (const e of events) {
    lastOf.set(e.itemId, e);
    if (e.kind === "add" || e.kind === "request_again") startOf.set(e.itemId, e);
  }
  const view: Record<string, unknown> = {
    id: l.id,
    status: l.status,
    createdAt: l.created_at.toISOString(),
    closedAt: l.closed_at?.toISOString() ?? null,
    items: items.rows.map((r) => {
      const start = startOf.get(r.id);
      const last = lastOf.get(r.id);
      return {
        id: r.id,
        productId: r.product_id,
        category: r.category,
        name: r.name,
        brand: r.brand,
        photoUrl: photoUrl(r.photo_asset_id),
        productActive: r.product_active,
        status: r.status,
        rev: r.rev,
        quantity: num(r.quantity),
        unit: r.unit as Unit,
        // Staff only learn "bought" (locked); who bought / who added is for parents.
        ...(parentView && r.purchase_id
          ? { purchase: { id: r.purchase_id, at: r.purchased_at.toISOString(), by: { id: r.buyer_id, displayName: r.buyer_name }, quantity: r.purchase_qty === null ? null : num(r.purchase_qty), unit: (r.purchase_unit ?? null) as Unit | null } }
          : {}),
        ...(parentView
          ? {
              addedBy: start?.by ?? { id: r.adder_id, displayName: r.adder_name },
              addedAt: start?.at ?? r.added_at.toISOString(),
              addedReceivedAt: start?.receivedAt ?? r.added_at.toISOString(),
              // The latest change, only when it is not the creation itself: shown on the line, details on tap.
              ...(last && last.id !== start?.id ? { lastChange: { kind: last.kind, by: last.by, at: last.at, receivedAt: last.receivedAt, before: last.before, after: last.after } } : {}),
            }
          : {}),
      };
    }),
  };
  if (parentView) {
    view.events = events;
    const vs = await db.query(
      `SELECT v.id, v.at, v.received_at, v.client_at, pr.id AS actor_id, pr.display_name FROM validations v JOIN profiles pr ON pr.id = v.actor_id
        WHERE v.list_id = $1 AND EXISTS (SELECT 1 FROM list_events e WHERE e.validation_id = v.id) ORDER BY v.at, v.received_at`,
      [listId],
    );
    view.validations = vs.rows.map((v) => ({ id: v.id, at: v.at.toISOString(), receivedAt: v.received_at.toISOString(), clientAt: v.client_at ? (v.client_at as Date).toISOString() : null, by: { id: v.actor_id, displayName: v.display_name } }));
    const cl = await db.query(
      `SELECT pu.id, i.product_id, coalesce(i.snapshot_name, p.name) AS name, pu.purchased_at, pu.voided_at, pu.void_reason, pu.quantity AS purchase_qty, pu.unit AS purchase_unit,
              pb.id AS buyer_id, pb.display_name AS buyer_name, vb.id AS voider_id, vb.display_name AS voider_name
         FROM purchases pu
         JOIN list_items i ON i.id = pu.list_item_id
         JOIN products p ON p.id = i.product_id
         JOIN profiles pb ON pb.id = pu.purchased_by
         JOIN profiles vb ON vb.id = pu.voided_by
        WHERE pu.list_id = $1 AND pu.voided_at IS NOT NULL
        ORDER BY pu.voided_at`,
      [listId],
    );
    view.corrections = cl.rows.map((r) => ({
      purchaseId: r.id,
      productId: r.product_id,
      name: r.name,
      purchasedBy: { id: r.buyer_id, displayName: r.buyer_name },
      purchasedAt: r.purchased_at.toISOString(),
      quantity: r.purchase_qty === null ? null : num(r.purchase_qty),
      unit: (r.purchase_unit ?? null) as Unit | null,
      correctedBy: { id: r.voider_id, displayName: r.voider_name },
      correctedAt: r.voided_at.toISOString(),
      reason: r.void_reason,
    }));
    if (archived) {
      const cb = (await db.query("SELECT id, display_name FROM profiles WHERE id = $1", [l.closed_by])).rows[0];
      view.closedBy = { id: cb.id, displayName: cb.display_name };
    }
  }
  return view;
}

export async function getActiveListView(db: Db, a: AuthContext) {
  const r = await db.query("SELECT id FROM lists WHERE family_id = $1 AND status = 'active'", [a.familyId]);
  return r.rows[0] ? getListView(db, a, r.rows[0].id) : null;
}

export async function listHistory(db: Db, a: AuthContext, limit: number, before?: string) {
  const r = await db.query(
    `SELECT l.id, l.created_at, l.closed_at, pb.display_name AS closed_by_name, pb.id AS closed_by_id,
            count(i.*) FILTER (WHERE i.status = 'purchased')::int AS purchased,
            count(i.*) FILTER (WHERE i.status = 'to_buy')::int AS remaining,
            (SELECT count(*)::int FROM purchases pu WHERE pu.list_id = l.id AND pu.voided_at IS NOT NULL) AS corrections
       FROM lists l
       JOIN profiles pb ON pb.id = l.closed_by
       LEFT JOIN list_items i ON i.list_id = l.id
      WHERE l.family_id = $1 AND l.status = 'archived' AND ($3::timestamptz IS NULL OR l.closed_at < $3)
      GROUP BY l.id, pb.id
      ORDER BY l.closed_at DESC
      LIMIT $2`,
    [a.familyId, limit, before ?? null],
  );
  return r.rows.map((x) => ({
    id: x.id,
    createdAt: x.created_at.toISOString(),
    closedAt: x.closed_at.toISOString(),
    closedBy: { id: x.closed_by_id, displayName: x.closed_by_name },
    purchased: x.purchased,
    remaining: x.remaining,
    corrections: x.corrections,
  }));
}
