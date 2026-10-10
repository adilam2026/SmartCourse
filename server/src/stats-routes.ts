import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "./db.js";
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

interface Cell {
  purchases: number;
  quantity: number | null;
  unknownQuantity: number;
}

/**
 * "Statistiques d'achats" — what was bought, not what was consumed, and no spending (no price is ever entered).
 *  - source: confirmed purchases only (a corrected purchase is excluded), each one counted once;
 *  - frequency (number of purchases) and quantity (sum) are separate figures; quantities are summed per unit, never across units;
 *  - product, quantity and unit are those frozen on the purchase: renaming, deactivating or changing the unit of a product later
 *    changes nothing in the past (a unit change simply shows as another row);
 *  - months follow Africa/Casablanca.
 */
export function statsRoutes(app: FastifyInstance, { db, guard }: { db: Db; guard: Guard }): void {
  app.get("/api/stats/purchases", { preHandler: guard("stats.read") }, async (req) => {
    const q = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }).parse(req.query);
    const month = q.month ?? monthOf(new Date());
    const previous = shift(month, -1);
    const fam = req.auth!.familyId;
    const from = monthStart(previous);
    const mid = monthStart(month);
    const to = monthStart(shift(month, 1));
    const rows = (
      await db.query(
        `SELECT pu.product_id, pu.unit, (pu.purchased_at >= $3) AS is_current,
                count(*)::int AS purchases, sum(pu.quantity) AS quantity, count(*) FILTER (WHERE pu.quantity IS NULL)::int AS unknown
           FROM purchases pu
          WHERE pu.family_id = $1 AND pu.voided_at IS NULL AND pu.purchased_at >= $2 AND pu.purchased_at < $4
          GROUP BY 1, 2, 3`,
        [fam, from, mid, to],
      )
    ).rows;
    const products = (
      await db.query("SELECT p.id, p.name, p.brand, p.active, p.category, c.label AS category_label FROM products p JOIN categories c ON c.key = p.category WHERE p.family_id = $1", [fam])
    ).rows;
    const byProduct = new Map(products.map((p) => [p.id as string, p]));
    const cell = (r: { purchases: number; quantity: string | null; unknown: number }): Cell => ({ purchases: r.purchases, quantity: r.quantity === null ? null : Number(r.quantity), unknownQuantity: r.unknown });
    const table = new Map<string, { productId: string; unit: string | null; current: Cell; previous: Cell }>();
    const empty = (): Cell => ({ purchases: 0, quantity: null, unknownQuantity: 0 });
    for (const r of rows) {
      const key = `${r.product_id}|${r.unit ?? ""}`;
      const row = table.get(key) ?? { productId: r.product_id as string, unit: (r.unit ?? null) as string | null, current: empty(), previous: empty() };
      row[r.is_current ? "current" : "previous"] = cell(r);
      table.set(key, row);
    }
    const out = [...table.values()]
      .map((r) => {
        const p = byProduct.get(r.productId);
        return { ...r, name: p?.name ?? "Produit", brand: (p?.brand ?? null) as string | null, active: p?.active ?? true, category: p?.category as string, categoryLabel: p?.category_label as string };
      })
      .sort((a, b) => b.current.purchases - a.current.purchases || b.previous.purchases - a.previous.purchases || a.name.localeCompare(b.name, "fr"));
    // Months that have purchases (Africa/Casablanca) plus the current one, newest first.
    const span = (await db.query("SELECT min(purchased_at) AS lo, max(purchased_at) AS hi FROM purchases WHERE family_id = $1 AND voided_at IS NULL", [fam])).rows[0];
    const now = monthOf(new Date());
    const months = new Set<string>([now]);
    if (span?.lo) for (let m = monthOf(span.hi as Date); m >= monthOf(span.lo as Date); m = shift(m, -1)) months.add(m);
    return {
      month,
      previousMonth: previous,
      timeZone: STATS_TZ,
      months: [...months].sort().reverse(),
      rows: out,
      totals: { purchases: out.reduce((n, r) => n + r.current.purchases, 0), previousPurchases: out.reduce((n, r) => n + r.previous.purchases, 0) },
      // Never an invented figure: no price is entered anywhere, so there is no spending statistic.
      spending: null,
    };
  });
}
