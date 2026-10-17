import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import { pricesAvailable } from "./countries.js";
import { priceCity } from "./location.js";
import type { Guard } from "./guard.js";
import type { SseHub } from "./hub.js";
import type { Unit } from "./lists.js";
import { bumpCatalogRev, loadPrices, type PriceView } from "./prices.js";
import { comparable, isComputable, type PriceRef, type RefUnit } from "./pricing.js";

/*
 * Partage communautaire des prix.
 *  - Rien n'est public tant qu'un administrateur n'a pas choisi « Partager ce prix » : une modification locale reste dans sa famille.
 *  - Sont partagés : produit (clé stable du catalogue), montant, unité, conditionnement, date, ville et magasin facultatifs.
 *    JAMAIS : nom, e-mail, code famille, historique de courses. Une empreinte opaque de la famille ne sert qu'à limiter les envois.
 *  - Une proposition est la MÉDIANE d'un format donné (au kg, au litre, ou par unité avec son conditionnement) : jamais la dernière
 *    contribution, jamais un mélange de formats. Elle exige plusieurs familles distinctes et ignore les valeurs aberrantes.
 *  - Aucun écrasement automatique : l'administrateur choisit chaque prix à appliquer.
 */
export const MIN_CONTRIBUTORS = 3;
const DAILY_LIMIT = 10;
const MONTHLY_LIMIT = 100;
const REPORTS_TO_EXCLUDE = 3;
const OUTLIER_FACTOR = 3; // au-delà de 3× ou en deçà d'un tiers de la médiane : écarté
const REFERENCE_BAND = 4; // contribution à plus de 4× (ou moins du quart) du prix de référence : refusée comme incohérente

interface Deps {
  db: Db;
  guard: Guard;
  hub: SseHub;
}

export const opaque = (familyId: string): string => createHash("sha256").update(`price-contrib:${familyId}`).digest("hex");
const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const refOf = (r: any): PriceRef => ({ amount: String(r.amount), refQty: String(Number(r.ref_qty)), refUnit: r.ref_unit as RefUnit, packaging: r.packaging ?? null, pieceWeightG: r.piece_weight_g === null ? null : String(Number(r.piece_weight_g)) });

/** Clé stable exacte du produit dans le catalogue partagé (null : produit propre à la famille, impossible à partager). */
async function stableKey(db: Pick<Db, "query">, familyId: string, productId: string): Promise<{ origin: "initial" | "extended"; key: string; unit: Unit; name: string } | null> {
  const r = (await db.query(
    `SELECT p.unit, p.name, p.catalog_key, e.key AS ext_key FROM products p LEFT JOIN extended_catalog e ON e.id = p.extended_id WHERE p.id = $1 AND p.family_id = $2`,
    [productId, familyId],
  )).rows[0];
  if (!r) throw new HttpError(404, "not_found", "Produit introuvable");
  if (r.catalog_key) return { origin: "initial", key: r.catalog_key, unit: r.unit, name: r.name };
  if (r.ext_key) return { origin: "extended", key: r.ext_key, unit: r.unit, name: r.name };
  return null;
}

export interface Proposal {
  productId: string;
  name: string;
  format: string;
  price: { amount: string; refQty: string; refUnit: RefUnit; packaging: string | null };
  contributors: number;
  min: string;
  max: string;
  latestObservedOn: string;
  current: PriceView | null;
}

/** Contributions d'un format, privées de celles de la famille qui regarde, des signalées par elle et des valeurs aberrantes. */
async function groups(db: Pick<Db, "query">, familyId: string, origin: string, key: string, city: string) {
  const me = opaque(familyId);
  const rows = (await db.query(
    `SELECT c.* FROM price_contributions c
      WHERE c.origin = $1 AND c.key = $2 AND c.city = $4 AND NOT c.excluded AND c.contributor <> $3
        AND NOT EXISTS (SELECT 1 FROM price_reports r WHERE r.contribution_id = c.id AND r.reporter = $3)`,
    [origin, key, me, city],
  )).rows;
  const byFormat = new Map<string, { row: any; value: number }[]>();
  for (const row of rows) {
    const cmp = comparable(refOf(row));
    if (!cmp) continue;
    (byFormat.get(cmp.format) ?? byFormat.set(cmp.format, []).get(cmp.format)!).push({ row, value: cmp.centsPerBase });
  }
  const out: { format: string; rows: any[]; values: number[] }[] = [];
  for (const [format, list] of byFormat) {
    const m = median(list.map((l) => l.value));
    const kept = list.filter((l) => l.value <= m * OUTLIER_FACTOR && l.value >= m / OUTLIER_FACTOR);
    if (new Set(kept.map((l) => l.row.contributor)).size < MIN_CONTRIBUTORS) continue; // pas assez de familles : aucune proposition
    out.push({ format, rows: kept.map((l) => l.row), values: kept.map((l) => l.value) });
  }
  return out;
}

async function proposalsFor(db: Db, familyId: string, productId: string, city: string): Promise<Proposal[]> {
  const k = await stableKey(db, familyId, productId);
  if (!k) return [];
  const current = (await loadPrices(db, familyId, [productId])).get(productId) ?? null;
  const out: Proposal[] = [];
  for (const g of await groups(db, familyId, k.origin, k.key, city)) {
    const m = median(g.values);
    const sample = g.rows.sort((a, b) => String(b.observed_on).localeCompare(String(a.observed_on)))[0];
    const first = comparable(refOf(sample))!;
    const [kind] = g.format.split("|");
    const refUnit: RefUnit = kind === "kg" ? "kg" : kind === "litre" ? "litre" : (kind!.replace("count:", "") as RefUnit);
    const price = { amount: (Math.round(m) / 100).toFixed(2), refQty: "1", refUnit, packaging: first.format.includes("|") ? (sample.packaging ?? null) : null };
    // Compatible : le montant se calcule pour l'unité de ce produit (sinon : « Prix à compléter », la proposition n'est pas montrée).
    if (!isComputable(price, 1, k.unit)) continue;
    // Déjà le prix actuel (même format, même montant) : rien de nouveau à proposer.
    const cur = current ? comparable({ amount: current.amount, refQty: current.refQty, refUnit: current.refUnit, packaging: current.packaging ?? null }) : null;
    const prop = comparable(price);
    if (cur && prop && cur.format === prop.format && cur.centsPerBase === prop.centsPerBase) continue;
    // Un prix de la famille dans un format incompatible avec la proposition n'est pas comparé : l'administrateur décide.
    out.push({
      productId,
      name: k.name,
      format: g.format,
      price,
      contributors: new Set(g.rows.map((r) => r.contributor)).size,
      min: (Math.min(...g.values) / 100).toFixed(2),
      max: (Math.max(...g.values) / 100).toFixed(2),
      latestObservedOn: String(sample.observed_on instanceof Date ? sample.observed_on.toISOString().slice(0, 10) : sample.observed_on),
      current,
    });
  }
  return out;
}

/** Ville des prix communautaires : celle de la famille (Maroc confirmé), sinon celle du profil. Hors du Maroc : aucun prix local. */
async function cityOf(db: Pick<Db, "query">, familyId: string, profileId: string): Promise<string> {
  const f = (await db.query("SELECT country FROM families WHERE id = $1", [familyId])).rows[0];
  if (!pricesAvailable(f?.country)) throw new HttpError(409, "prices_unavailable", "Les prix indicatifs ne sont disponibles qu'au Maroc");
  const c = await priceCity(db, familyId, profileId);
  if (!c) throw new HttpError(409, "city_required", "Indiquez votre ville pour partager ou synchroniser les prix");
  return c;
}

const today = () => new Date().toISOString().slice(0, 10);

export function priceCommunityRoutes(app: FastifyInstance, { db, guard, hub }: Deps): void {
  // « Partager ce prix » : publie le prix PERSONNALISÉ de la famille pour un produit du catalogue partagé.
  app.post("/api/prices/share", { preHandler: guard("family.manage") }, async (req, reply) => {
    const a = req.auth!;
    const b = z
      .object({ productId: z.string().uuid(), observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), store: z.string().trim().max(60).optional() })
      .parse(req.body);
    const city = await cityOf(db, a.familyId, a.profileId);
    const k = await stableKey(db, a.familyId, b.productId);
    if (!k) throw new HttpError(409, "not_shareable", "Ce produit n'existe que dans votre famille : il ne peut pas être partagé");
    const fp = (await db.query("SELECT * FROM family_prices WHERE family_id = $1 AND product_id = $2 AND source = 'family'", [a.familyId, b.productId])).rows[0];
    if (!fp) throw new HttpError(409, "no_family_price", "Seul un prix que vous avez modifié peut être partagé");
    const observedOn = b.observedOn ?? today();
    if (observedOn > today() || observedOn < new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10) || Number.isNaN(Date.parse(observedOn))) throw new HttpError(400, "invalid_date", "La date du prix n'est pas valable");
    const me = opaque(a.familyId);
    const cmp = comparable(refOf(fp));
    if (!cmp) throw new HttpError(400, "invalid_price", "Ce prix ne peut pas être partagé");
    await withTx(db, async (c) => {
      const day = Number((await c.query("SELECT count(*) AS n FROM price_contributions WHERE contributor = $1 AND created_at > now() - interval '1 day'", [me])).rows[0].n);
      const month = Number((await c.query("SELECT count(*) AS n FROM price_contributions WHERE contributor = $1 AND created_at > now() - interval '30 days'", [me])).rows[0].n);
      if (day >= DAILY_LIMIT || month >= MONTHLY_LIMIT) throw new HttpError(429, "too_many_contributions", "Vous avez déjà partagé beaucoup de prix aujourd'hui. Réessayez plus tard.");
      if ((await c.query("SELECT 1 FROM price_contributions WHERE contributor = $1 AND origin = $2 AND key = $3 AND created_at > now() - interval '1 day'", [me, k.origin, k.key])).rowCount) throw new HttpError(409, "already_shared", "Ce produit a déjà été partagé aujourd'hui");
      // Incohérent avec la référence (médiane des contributions du même format, sinon base initiale du même format) : refusé.
      const others = (await c.query("SELECT * FROM price_contributions WHERE origin = $1 AND key = $2 AND NOT excluded", [k.origin, k.key])).rows
        .map((r) => comparable(refOf(r)))
        .filter((x): x is NonNullable<typeof x> => !!x && x.format === cmp.format)
        .map((x) => x.centsPerBase);
      let ref = others.length >= 3 ? median(others) : null;
      if (ref === null) {
        const bp = (await c.query("SELECT * FROM base_prices WHERE origin = $1 AND key = $2", [k.origin, k.key])).rows[0];
        const bc = bp ? comparable(refOf(bp)) : null;
        if (bc && bc.format === cmp.format) ref = bc.centsPerBase;
      }
      if (ref !== null && (cmp.centsPerBase > ref * REFERENCE_BAND || cmp.centsPerBase < ref / REFERENCE_BAND)) throw new HttpError(422, "price_inconsistent", "Ce prix semble très différent des prix connus : vérifiez le montant et l'unité avant de le partager");
      await c.query(
        `INSERT INTO price_contributions (origin, key, amount, ref_qty, ref_unit, packaging, piece_weight_g, observed_on, city, store, contributor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [k.origin, k.key, fp.amount, fp.ref_qty, fp.ref_unit, fp.packaging, fp.piece_weight_g, observedOn, city, b.store || null, me],
      );
      await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action, details) VALUES ($1,$2,'price.shared',$3)", [a.familyId, a.profileId, JSON.stringify({ productId: b.productId })]);
    });
    return reply.code(201).send({ ok: true });
  });

  // « Synchroniser les prix » : propositions compatibles, avec le prix actuel de la famille.
  app.get("/api/prices/community", { preHandler: guard("family.manage") }, async (req) => {
    const a = req.auth!;
    const city = await cityOf(db, a.familyId, a.profileId);
    const products = (await db.query("SELECT id FROM products WHERE family_id = $1 AND (catalog_key IS NOT NULL OR extended_id IS NOT NULL)", [a.familyId])).rows;
    const proposals: Proposal[] = [];
    for (const p of products) proposals.push(...(await proposalsFor(db, a.familyId, p.id, city)));
    return { proposals, city, minContributors: MIN_CONTRIBUTORS };
  });

  const choose = z.object({ productId: z.string().uuid(), format: z.string().min(1).max(120) });

  // L'administrateur applique les propositions qu'il a SÉLECTIONNÉES : chacune est recalculée côté serveur (le client n'impose jamais un prix).
  // Les prix appliqués sont communs à la famille ; rien ne s'applique tout seul.
  app.post("/api/prices/community/apply", { preHandler: guard("family.manage") }, async (req) => {
    const a = req.auth!;
    const b = z.object({ items: z.array(choose).min(1).max(100) }).parse(req.body);
    const city = await cityOf(db, a.familyId, a.profileId);
    let applied = 0;
    const gone: string[] = [];
    for (const it of b.items) {
      const prop = (await proposalsFor(db, a.familyId, it.productId, city)).find((p) => p.format === it.format);
      if (!prop) {
        gone.push(it.productId);
        continue;
      }
      await withTx(db, async (c) => {
        await c.query(
          `INSERT INTO family_prices (family_id, product_id, amount, ref_qty, ref_unit, packaging, source, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'community',$7, now())
           ON CONFLICT (family_id, product_id) DO UPDATE SET amount = $3, ref_qty = $4, ref_unit = $5, packaging = $6, piece_weight_g = NULL, source = 'community', updated_by = $7, updated_at = now()`,
          [a.familyId, it.productId, prop.price.amount, prop.price.refQty, prop.price.refUnit, prop.price.packaging, a.profileId],
        );
        await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action, details) VALUES ($1,$2,'price.community_applied',$3)", [a.familyId, a.profileId, JSON.stringify({ productId: it.productId })]);
        await bumpCatalogRev(c, a.familyId);
      });
      applied++;
    }
    if (applied) hub.broadcast(a.familyId, "catalog.updated", {});
    return { applied, gone };
  });

  // Signaler une proposition : elle disparaît pour cette famille ; assez de signalements d'autres familles écartent la contribution.
  app.post("/api/prices/community/report", { preHandler: guard("family.manage") }, async (req) => {
    const a = req.auth!;
    const b = choose.extend({ reason: z.string().trim().max(200).optional() }).parse(req.body);
    const k = await stableKey(db, a.familyId, b.productId);
    if (!k) throw new HttpError(404, "not_found", "Produit introuvable");
    const g = (await groups(db, a.familyId, k.origin, k.key, await cityOf(db, a.familyId, a.profileId))).find((x) => x.format === b.format);
    if (!g) throw new HttpError(409, "proposal_gone", "Cette proposition n'est plus disponible");
    const me = opaque(a.familyId);
    await withTx(db, async (c) => {
      for (const r of g.rows) {
        await c.query("INSERT INTO price_reports (contribution_id, reporter, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [r.id, me, b.reason ?? null]);
        await c.query("UPDATE price_contributions SET excluded = true WHERE id = $1 AND (SELECT count(*) FROM price_reports WHERE contribution_id = $1) >= $2", [r.id, REPORTS_TO_EXCLUDE]);
      }
    });
    return { ok: true };
  });
}
