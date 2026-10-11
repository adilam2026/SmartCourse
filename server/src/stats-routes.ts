import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";

export const STATS_TZ = "Africa/Casablanca";

const monthOf = (d: Date): string => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: STATS_TZ, year: "numeric", month: "2-digit" }).formatToParts(d);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
};
/** Offset of the zone from UTC at instant `t` (ms), from the runtime's time-zone data (not the database's, which can differ by platform). */
const offsetAt = (t: number): number => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: STATS_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(t / 1000) * 1000;
};
/** The instant at which the month "YYYY-MM" begins in Africa/Casablanca. */
export const monthStart = (month: string): Date => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const local = Date.UTC(y, m - 1, 1);
  let t = local - offsetAt(local);
  t = local - offsetAt(t); // second pass: the offset may differ at the boundary itself
  return new Date(t);
};
const shift = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

/** Clock used by the statistics (replaceable in tests so that "this month" is deterministic). */
export const statsClock = { now: (): Date => new Date() };

/** Local (Africa/Casablanca) calendar parts of an instant. */
const partsOf = (d: Date): { y: number; m: number; d: number } => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: STATS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const n = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: n("year"), m: n("month"), d: n("day") };
};
const dayKey = (d: Date): string => {
  const p = partsOf(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};
/** The instant at which local day (y, m, d) begins; d may overflow the month (32 = the 1st of the next month). */
const dayStart = (y: number, m: number, d: number): Date => {
  const local = Date.UTC(y, m - 1, d);
  let t = local - offsetAt(local);
  t = local - offsetAt(t);
  return new Date(t);
};
const ym = (month: string): [number, number] => month.split("-").map(Number) as [number, number];

export interface Window {
  from: Date;
  to: Date; // exclusive
}
export interface Windows {
  current: Window;
  compare: Window;
  partial: boolean; // the current period is not over: it is compared with the same number of elapsed days of the previous period
}

/**
 * The compared periods are always EQUIVALENT: a full month with the previous full month; a month in progress (1st → today) with the
 * same days of the previous month; the last three months (up to today) with the three months before, up to the same day.
 */
export function windowsFor(period: "month" | "last3", month: string, now: Date): Windows {
  const nowMonth = monthOf(now);
  const today = partsOf(now);
  const endOfToday = dayStart(today.y, today.m, today.d + 1);
  if (period === "last3") {
    const first = shift(nowMonth, -2);
    const [cy, cm] = ym(shift(nowMonth, -3));
    const cmpFrom = monthStart(shift(nowMonth, -5));
    const cmpTo = new Date(Math.min(dayStart(cy, cm, today.d + 1).getTime(), monthStart(first).getTime()));
    return { current: { from: monthStart(first), to: endOfToday }, compare: { from: cmpFrom, to: cmpTo }, partial: true };
  }
  const prev = shift(month, -1);
  const [py, pm] = ym(prev);
  if (month === nowMonth) {
    const to = new Date(Math.min(endOfToday.getTime(), monthStart(shift(month, 1)).getTime()));
    const cmpTo = new Date(Math.min(dayStart(py, pm, today.d + 1).getTime(), monthStart(month).getTime()));
    return { current: { from: monthStart(month), to }, compare: { from: monthStart(prev), to: cmpTo }, partial: true };
  }
  return { current: { from: monthStart(month), to: monthStart(shift(month, 1)) }, compare: { from: monthStart(prev), to: monthStart(month) }, partial: false };
}

interface Cell {
  unit: string | null;
  purchases: number;
  quantity: number | null;
  unknownQuantity: number;
}

const norm = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

const periodSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  period: z.enum(["month", "last3"]).default("month"),
});

/** Last included local day of a window (the window end is exclusive). */
const lastDay = (w: Window): string => dayKey(new Date(w.to.getTime() - 1));

/**
 * "Statistiques d'achats" — what was bought, not what was consumed, and no spending (no price is ever entered).
 *  - "un achat" = one line marked « Acheté » (one product bought once); it is NOT a number of shop visits;
 *  - source: confirmed purchases only (a corrected purchase is excluded from every figure), each one counted once;
 *  - frequency (number of purchases) and quantity (sum) are separate; quantities are summed per unit, never across units;
 *  - product, quantity and unit are those frozen on the purchase: renaming, deactivating or changing the unit of a product later
 *    changes nothing in the past (a unit change simply shows as another unit);
 *  - months follow Africa/Casablanca; comparisons only between equivalent periods and only when the history covers them.
 */
export function statsRoutes(app: FastifyInstance, { db, guard }: { db: Db; guard: Guard }): void {
  const cellOf = (r: any): Cell => ({ unit: (r.unit ?? null) as string | null, purchases: r.purchases as number, quantity: r.quantity === null ? null : Number(r.quantity), unknownQuantity: r.unknown as number });

  /** When the family started using lists: periods before are "no history", not "no purchase". */
  const historyStart = async (fam: string): Promise<Date | null> => ((await db.query("SELECT min(created_at) AS t FROM lists WHERE family_id = $1", [fam])).rows[0]?.t ?? null) as Date | null;

  const monthsOf = async (fam: string): Promise<string[]> => {
    const span = (await db.query("SELECT min(purchased_at) AS lo, max(purchased_at) AS hi FROM purchases WHERE family_id = $1 AND voided_at IS NULL", [fam])).rows[0];
    const months = new Set<string>([monthOf(statsClock.now())]);
    if (span?.lo) for (let m = monthOf(span.hi as Date); m >= monthOf(span.lo as Date); m = shift(m, -1)) months.add(m);
    return [...months].sort().reverse();
  };

  const windowInfo = (w: Window) => ({ from: w.from.toISOString(), to: w.to.toISOString(), fromDay: dayKey(w.from), toDay: lastDay(w) });

  app.get("/api/stats/purchases", { preHandler: guard("stats.read") }, async (req) => {
    const q = periodSchema
      .extend({
        category: z.string().max(60).optional(),
        q: z.string().max(80).optional(),
        sort: z.enum(["frequency", "last", "name"]).default("frequency"),
      })
      .parse(req.query);
    const now = statsClock.now();
    const month = q.period === "last3" ? monthOf(now) : (q.month ?? monthOf(now));
    const win = windowsFor(q.period, month, now);
    const fam = req.auth!.familyId;
    const rows = (
      await db.query(
        `SELECT pu.product_id, pu.unit, (pu.purchased_at >= $3) AS is_current,
                count(*)::int AS purchases, sum(pu.quantity) AS quantity, count(*) FILTER (WHERE pu.quantity IS NULL)::int AS unknown,
                max(pu.purchased_at) AS last_at
           FROM purchases pu
          WHERE pu.family_id = $1 AND pu.voided_at IS NULL
            AND ((pu.purchased_at >= $2 AND pu.purchased_at < $4) OR (pu.purchased_at >= $5 AND pu.purchased_at < $6))
          GROUP BY 1, 2, 3`,
        [fam, win.current.from, win.current.from, win.current.to, win.compare.from, win.compare.to],
      )
    ).rows;
    const products = (
      await db.query("SELECT p.id, p.name, p.brand, p.active, p.category, p.photo_asset_id, i.photo_asset_id AS catalog_photo, c.label AS category_label FROM products p JOIN categories c ON c.key = p.category LEFT JOIN initial_catalog i ON i.key = p.catalog_key WHERE p.family_id = $1", [fam])
    ).rows;
    const byProduct = new Map(products.map((p) => [p.id as string, p]));
    const table = new Map<string, { current: Cell[]; compare: Cell[]; last: Date | null }>();
    for (const r of rows) {
      const e = table.get(r.product_id as string) ?? { current: [], compare: [], last: null };
      (r.is_current ? e.current : e.compare).push(cellOf(r));
      if (r.is_current && (!e.last || (r.last_at as Date) > e.last)) e.last = r.last_at as Date;
      table.set(r.product_id as string, e);
    }
    const hist = await historyStart(fam);
    const covered = hist !== null && hist <= win.compare.from;
    const all = [...table.entries()]
      .filter(([, e]) => e.current.length > 0)
      .map(([id, e]) => {
        const p = byProduct.get(id);
        const photo = (p?.photo_asset_id ?? p?.catalog_photo ?? null) as string | null;
        const total = (cells: Cell[]) => cells.reduce((n, c) => n + c.purchases, 0);
        return {
          productId: id,
          name: (p?.name ?? "Produit") as string,
          brand: (p?.brand ?? null) as string | null,
          active: (p?.active ?? true) as boolean,
          category: p?.category as string,
          categoryLabel: p?.category_label as string,
          photoUrl: photo ? `/api/photos/${photo}` : null,
          purchases: total(e.current),
          lastPurchaseAt: e.last ? e.last.toISOString() : null,
          units: e.current.sort((a, b) => b.purchases - a.purchases || String(a.unit).localeCompare(String(b.unit))),
          // The comparison of a product exists only when the history covers the compared period AND something was bought then:
          // no purchase recorded is not proof of anything, and nothing is ever divided by zero.
          compare: covered && e.compare.length > 0 ? { purchases: total(e.compare), units: e.compare } : null,
        };
      });
    const categories = [...new Map(all.map((r) => [r.category, r.categoryLabel])).entries()].map(([key, label]) => ({ key, label }));
    const needle = norm(q.q ?? "");
    const rowsOut = all
      .filter((r) => (!q.category || r.category === q.category) && (!needle || norm(r.name).includes(needle) || (r.brand !== null && norm(r.brand).includes(needle))))
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name, "fr");
        if (q.sort === "name") return byName;
        const byLast = (b.lastPurchaseAt ?? "").localeCompare(a.lastPurchaseAt ?? "");
        return q.sort === "last" ? byLast || byName : b.purchases - a.purchases || byLast || byName;
      });
    const compareTotal = rowsOut.reduce((n, r) => n + (r.compare?.purchases ?? 0), 0);
    return {
      period: q.period,
      month,
      currentMonth: monthOf(now),
      timeZone: STATS_TZ,
      months: await monthsOf(fam),
      window: { ...windowInfo(win.current), partial: win.partial },
      comparison: { available: covered, ...windowInfo(win.compare) },
      categories,
      rows: rowsOut,
      totals: { purchases: rowsOut.reduce((n, r) => n + r.purchases, 0), products: rowsOut.length, comparePurchases: covered ? compareTotal : null },
      // Never an invented figure: no price is entered anywhere, so there is no spending statistic.
      spending: null,
    };
  });

  /** Purchase history of ONE product over the selected period, plus six months of quantities (units kept apart). */
  app.get("/api/stats/products/:id", { preHandler: guard("stats.read") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = periodSchema.parse(req.query);
    const now = statsClock.now();
    const month = q.period === "last3" ? monthOf(now) : (q.month ?? monthOf(now));
    const win = windowsFor(q.period, month, now);
    const fam = req.auth!.familyId;
    const p = (
      await db.query("SELECT p.id, p.name, p.brand, p.active, p.category, p.photo_asset_id, i.photo_asset_id AS catalog_photo, c.label AS category_label FROM products p JOIN categories c ON c.key = p.category LEFT JOIN initial_catalog i ON i.key = p.catalog_key WHERE p.id = $1 AND p.family_id = $2", [id, fam])
    ).rows[0];
    if (!p) throw new HttpError(404, "not_found", "Produit introuvable");
    const photo = (p.photo_asset_id ?? p.catalog_photo ?? null) as string | null;
    const list = (
      await db.query(
        `SELECT pu.id, pu.purchased_at, pu.quantity, pu.unit, pu.voided_at, pu.void_reason, b.id AS buyer_id, b.display_name AS buyer, vb.display_name AS voided_by_name,
                l.id AS list_id, l.status AS list_status, l.created_at AS list_created, l.closed_at AS list_closed
           FROM purchases pu
           JOIN profiles b ON b.id = pu.purchased_by
           LEFT JOIN profiles vb ON vb.id = pu.voided_by
           JOIN lists l ON l.id = pu.list_id
          WHERE pu.family_id = $1 AND pu.product_id = $2 AND pu.purchased_at >= $3 AND pu.purchased_at < $4
          ORDER BY pu.purchased_at DESC, pu.id
          LIMIT 300`,
        [fam, id, win.current.from, win.current.to],
      )
    ).rows;
    const purchases = list.map((r) => ({
      id: r.id as string,
      at: (r.purchased_at as Date).toISOString(),
      quantity: r.quantity === null ? null : Number(r.quantity),
      unit: (r.unit ?? null) as string | null,
      by: { id: r.buyer_id as string, displayName: r.buyer as string },
      // A corrected purchase stays visible in the history but is in no total.
      corrected: r.voided_at ? { at: (r.voided_at as Date).toISOString(), by: r.voided_by_name as string, reason: (r.void_reason ?? null) as string | null } : null,
      list: { id: r.list_id as string, status: r.list_status as string, createdAt: (r.list_created as Date).toISOString(), closedAt: r.list_closed ? (r.list_closed as Date).toISOString() : null },
    }));
    // Totals per unit, confirmed purchases only.
    const totals = new Map<string, Cell>();
    for (const r of purchases) {
      if (r.corrected) continue;
      const k = r.unit ?? "";
      const c = totals.get(k) ?? { unit: r.unit, purchases: 0, quantity: null, unknownQuantity: 0 };
      c.purchases += 1;
      if (r.quantity === null) c.unknownQuantity += 1;
      else c.quantity = (c.quantity ?? 0) + r.quantity;
      totals.set(k, c);
    }
    const last = (await db.query("SELECT max(purchased_at) AS t FROM purchases WHERE family_id = $1 AND product_id = $2 AND voided_at IS NULL", [fam, id])).rows[0]?.t as Date | null;
    // Six months ending with the last month of the period.
    const lastMonth = monthOf(new Date(win.current.to.getTime() - 1));
    const first = shift(lastMonth, -5);
    const monthly = (
      await db.query(
        `SELECT pu.unit, pu.purchased_at, pu.quantity FROM purchases pu
          WHERE pu.family_id = $1 AND pu.product_id = $2 AND pu.voided_at IS NULL AND pu.purchased_at >= $3 AND pu.purchased_at < $4`,
        [fam, id, monthStart(first), monthStart(shift(lastMonth, 1))],
      )
    ).rows;
    const hist = await historyStart(fam);
    const months = Array.from({ length: 6 }, (_, i) => shift(first, i)).map((m) => {
      const cells = new Map<string, Cell>();
      for (const r of monthly) {
        if (monthOf(r.purchased_at as Date) !== m) continue;
        const k = (r.unit ?? "") as string;
        const c = cells.get(k) ?? { unit: (r.unit ?? null) as string | null, purchases: 0, quantity: null, unknownQuantity: 0 };
        c.purchases += 1;
        if (r.quantity === null) c.unknownQuantity += 1;
        else c.quantity = (c.quantity ?? 0) + Number(r.quantity);
        cells.set(k, c);
      }
      // "covered": the family was already using lists that month; before, there is simply no history.
      const covered = hist !== null && monthOf(hist) <= m;
      return { month: m, covered, units: [...cells.values()] };
    });
    return {
      product: { id: p.id as string, name: p.name as string, brand: (p.brand ?? null) as string | null, active: p.active as boolean, category: p.category as string, categoryLabel: p.category_label as string, photoUrl: photo ? `/api/photos/${photo}` : null },
      period: q.period,
      month,
      window: { ...windowInfo(win.current), partial: win.partial },
      summary: { purchases: [...totals.values()].reduce((n, c) => n + c.purchases, 0), units: [...totals.values()], lastPurchaseAt: last ? last.toISOString() : null },
      purchases,
      months,
    };
  });
}
