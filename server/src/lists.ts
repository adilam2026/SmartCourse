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

export type OpIn =
  | { opId: string; type: "add"; productId: string }
  | { opId: string; type: "remove"; productId: string; baseRev: number }
  | { opId: string; type: "purchase"; itemId: string }
  | { opId: string; type: "correct"; purchaseId: string; reason?: string | null };

export type RejectReason =
  | "list_closed"
  | "product_unknown"
  | "product_inactive"
  | "item_unknown"
  | "item_removed"
  | "locked_purchased"
  | "stale"
  | "purchase_unknown";

export interface OpResult {
  opId: string;
  status: "applied" | "already" | "rejected";
  reason?: RejectReason;
  /** Who/when, for "already purchased by …" style answers (parents only; stripped for staff). */
  detail?: { purchasedBy?: { id: string; displayName: string }; purchasedAt?: string };
  replay?: boolean;
}

interface Executed {
  result: Omit<OpResult, "opId">;
  itemId?: string;
}

const rejected = (reason: RejectReason): Executed => ({ result: { status: "rejected", reason } });

async function purchaseDetail(c: pg.PoolClient, itemId: string): Promise<OpResult["detail"]> {
  const r = await c.query(
    `SELECT pu.purchased_at, pr.id, pr.display_name FROM purchases pu JOIN profiles pr ON pr.id = pu.purchased_by
      WHERE pu.list_item_id = $1 AND pu.voided_at IS NULL`,
    [itemId],
  );
  const row = r.rows[0];
  return row ? { purchasedBy: { id: row.id, displayName: row.display_name }, purchasedAt: row.purchased_at.toISOString() } : undefined;
}

async function execAdd(c: pg.PoolClient, a: AuthContext, listId: string, op: Extract<OpIn, { type: "add" }>): Promise<Executed> {
  const prod = (await c.query("SELECT id, active FROM products WHERE id = $1 AND family_id = $2", [op.productId, a.familyId])).rows[0];
  if (!prod) return rejected("product_unknown");
  const find = () => c.query("SELECT * FROM list_items WHERE list_id = $1 AND product_id = $2 FOR UPDATE", [listId, op.productId]);
  let item = (await find()).rows[0];
  if (!item) {
    if (!prod.active) return rejected("product_inactive");
    // If a concurrent member inserts the same product first, ON CONFLICT waits for them and inserts nothing.
    const ins = await c.query(
      `INSERT INTO list_items (list_id, family_id, product_id, added_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (list_id, product_id) DO NOTHING RETURNING id`,
      [listId, a.familyId, op.productId, a.profileId],
    );
    if (ins.rows[0]) return { result: { status: "applied" }, itemId: ins.rows[0].id };
    item = (await find()).rows[0];
  }
  if (item.status !== "removed") return { result: { status: "already" }, itemId: item.id };
  if (!prod.active) return rejected("product_inactive");
  await c.query("UPDATE list_items SET status = 'to_buy', rev = rev + 1, added_by = $2, updated_at = now() WHERE id = $1", [item.id, a.profileId]);
  return { result: { status: "applied" }, itemId: item.id };
}

async function execRemove(c: pg.PoolClient, listId: string, op: Extract<OpIn, { type: "remove" }>): Promise<Executed> {
  const item = (await c.query("SELECT * FROM list_items WHERE list_id = $1 AND product_id = $2 FOR UPDATE", [listId, op.productId])).rows[0];
  if (!item) return rejected("item_unknown");
  if (item.status === "purchased") return { ...rejected("locked_purchased"), itemId: item.id };
  if (item.status === "removed") return { result: { status: "already" }, itemId: item.id };
  // The draft was built on an older state of this article (bought then corrected, removed then re-added…).
  if (item.rev !== op.baseRev) return { ...rejected("stale"), itemId: item.id };
  await c.query("UPDATE list_items SET status = 'removed', rev = rev + 1, updated_at = now() WHERE id = $1", [item.id]);
  return { result: { status: "applied" }, itemId: item.id };
}

async function execPurchase(c: pg.PoolClient, a: AuthContext, listId: string, op: Extract<OpIn, { type: "purchase" }>): Promise<Executed> {
  const item = (await c.query("SELECT * FROM list_items WHERE id = $1 AND list_id = $2 AND family_id = $3 FOR UPDATE", [op.itemId, listId, a.familyId])).rows[0];
  if (!item) return rejected("item_unknown");
  if (item.status === "removed") return { ...rejected("item_removed"), itemId: item.id };
  if (item.status === "purchased") return { result: { status: "already", detail: await purchaseDetail(c, item.id) }, itemId: item.id };
  await c.query("INSERT INTO purchases (list_item_id, list_id, family_id, purchased_by) VALUES ($1,$2,$3,$4)", [item.id, listId, a.familyId, a.profileId]);
  await c.query("UPDATE list_items SET status = 'purchased', rev = rev + 1, updated_at = now() WHERE id = $1", [item.id]);
  return { result: { status: "applied" }, itemId: item.id };
}

async function execCorrect(c: pg.PoolClient, a: AuthContext, listId: string, op: Extract<OpIn, { type: "correct" }>): Promise<Executed> {
  // The purchase must belong to this family AND to this (active) list.
  const pu = (await c.query("SELECT list_item_id FROM purchases WHERE id = $1 AND family_id = $2 AND list_id = $3", [op.purchaseId, a.familyId, listId])).rows[0];
  if (!pu) return rejected("purchase_unknown");
  await c.query("SELECT 1 FROM list_items WHERE id = $1 FOR UPDATE", [pu.list_item_id]);
  const cur = (await c.query("SELECT voided_at FROM purchases WHERE id = $1 FOR UPDATE", [op.purchaseId])).rows[0];
  if (cur.voided_at) return { result: { status: "already" }, itemId: pu.list_item_id };
  const reason = op.reason?.trim() ? op.reason.trim().slice(0, 300) : null; // a missing reason never blocks
  await c.query("UPDATE purchases SET voided_by = $2, voided_at = now(), void_reason = $3 WHERE id = $1", [op.purchaseId, a.profileId, reason]);
  await c.query("UPDATE list_items SET status = 'to_buy', rev = rev + 1, updated_at = now() WHERE id = $1", [pu.list_item_id]);
  return { result: { status: "applied" }, itemId: pu.list_item_id };
}

/** Applies one idempotent operation. Replaying the same (profile, opId) returns the original result. */
async function runOp(db: Db, a: AuthContext, listId: string, op: OpIn): Promise<{ result: OpResult; itemId?: string; changed: boolean }> {
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
    else if (op.type === "add") ex = await execAdd(c, a, listId, op);
    else if (op.type === "remove") ex = await execRemove(c, listId, op);
    else if (op.type === "purchase") ex = await execPurchase(c, a, listId, op);
    else ex = await execCorrect(c, a, listId, op);

    const result: OpResult = { opId: op.opId, ...ex.result };
    await c.query("UPDATE op_log SET result = $3 WHERE profile_id = $1 AND op_id = $2", [a.profileId, op.opId, JSON.stringify(result)]);
    return { result, itemId: ex.itemId, changed: ex.result.status === "applied" };
  });
}

export async function applyOps(db: Db, hub: SseHub, a: AuthContext, listId: string, ops: OpIn[]) {
  const results: OpResult[] = [];
  const changedItems: string[] = [];
  for (const op of ops) {
    const r = await runOp(db, a, listId, op);
    results.push(a.role === "staff" ? stripDetail(r.result) : r.result);
    if (r.changed && r.itemId) changedItems.push(r.itemId);
  }
  // After commit: tell the other members something changed (they refetch the list state).
  if (changedItems.length) hub.broadcast(a.familyId, "list.updated", { listId, itemIds: changedItems });
  return { results, list: await getListView(db, a, listId) };
}

const stripDetail = (r: OpResult): OpResult => {
  const { detail: _d, ...rest } = r;
  return rest;
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
      // Freeze what the archive shows (name, brand, photo version) before the list becomes read-only.
      await c.query(
        `UPDATE list_items i SET snapshot_name = p.name, snapshot_brand = p.brand, snapshot_photo_asset_id = p.photo_asset_id
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
  const items = await db.query(
    `SELECT i.id, i.product_id, i.status, i.rev, p.category, p.active AS product_active, p.position,
            ${archived ? "coalesce(i.snapshot_name, p.name)" : "p.name"} AS name,
            ${archived ? "i.snapshot_brand" : "p.brand"} AS brand,
            ${archived ? "i.snapshot_photo_asset_id" : "p.photo_asset_id"} AS photo_asset_id,
            pu.id AS purchase_id, pu.purchased_at, pb.id AS buyer_id, pb.display_name AS buyer_name
       FROM list_items i
       JOIN products p ON p.id = i.product_id
       JOIN categories cat ON cat.key = p.category
       LEFT JOIN purchases pu ON pu.list_item_id = i.id AND pu.voided_at IS NULL
       LEFT JOIN profiles pb ON pb.id = pu.purchased_by
      WHERE i.list_id = $1 AND i.status <> 'removed'
      ORDER BY cat.position, p.position, lower(p.name)`,
    [listId],
  );
  const parentView = a.role !== "staff";
  const view: Record<string, unknown> = {
    id: l.id,
    status: l.status,
    createdAt: l.created_at.toISOString(),
    closedAt: l.closed_at?.toISOString() ?? null,
    items: items.rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      category: r.category,
      name: r.name,
      brand: r.brand,
      photoUrl: photoUrl(r.photo_asset_id),
      productActive: r.product_active,
      status: r.status,
      rev: r.rev,
      // Staff only learn "bought" (locked); who bought it is for parents.
      ...(parentView && r.purchase_id
        ? { purchase: { id: r.purchase_id, at: r.purchased_at.toISOString(), by: { id: r.buyer_id, displayName: r.buyer_name } } }
        : {}),
    })),
  };
  if (parentView) {
    const cl = await db.query(
      `SELECT pu.id, i.product_id, coalesce(i.snapshot_name, p.name) AS name, pu.purchased_at, pu.voided_at, pu.void_reason,
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
