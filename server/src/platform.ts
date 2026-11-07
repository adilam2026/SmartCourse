import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";

/**
 * Espace plateforme (consultation seulement) : « Photos manquantes » et « Usage de l'application ».
 *
 * Accès : seul un profil inscrit dans platform_admins (identifiant interne + sa famille, attribué côté serveur par
 * admin-cli platform-grant) y accède. Chaque route le vérifie à partir de la SESSION (jamais d'un nom ou d'un e-mail envoyé par
 * l'application). Aucun rôle de famille ne donne ce droit. Toutes les lectures se font dans une transaction en lecture seule.
 * Les familles listées dans platform_excluded_families (démonstration, vérification des stores, recette, interne) sont exclues.
 * Aucune donnée personnelle : ni nom ni code de famille, ni nom de membre, ni e-mail, ni contenu de liste, ni photo privée.
 */
type Q = Pick<pg.PoolClient, "query">;

export async function isPlatformAdmin(q: Q, profileId: string, familyId: string): Promise<boolean> {
  return Boolean((await q.query("SELECT 1 FROM platform_admins WHERE profile_id = $1 AND family_id = $2", [profileId, familyId])).rowCount);
}

async function readOnly<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("BEGIN TRANSACTION READ ONLY");
    const r = await fn(c);
    await c.query("ROLLBACK");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const EXCLUDED = "SELECT family_id FROM platform_excluded_families";

/* ───────────────────────── Photos manquantes ───────────────────────── */

/** Clés de regroupement (même logique que les audits SQL validés). k : « é » final distinct (pâté ≠ pâtes) ; k2 : confondu. */
const ACCENTS: Record<string, string> = Object.fromEntries(
  [..."àâäáãåçèéêëìíîïñòóôöõùúûüýÿ"].map((ch, i) => [ch, "aaaaaaceeeeiiiinooooouuuuyy"[i]!]),
);
function fold(s: string): string {
  const t = s.replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[àâäáãåçèéêëìíîïñòóôöõùúûüýÿ]/g, (ch) => ACCENTS[ch] ?? ch);
  return t.replace(/[^a-z0-9]+/g, " ").replace(/([a-z]{3,})[sx]( |$)/g, "$1$2").replace(/^ +| +$/g, "");
}
export function photoKeys(name: string): { k: string; k2: string } {
  const lower = name.toLowerCase();
  return { k: fold(lower.replace(/é[sx]?(\s|$)/g, "ee$1")), k2: fold(lower) };
}

export type PhotoBucket = "provide" | "reuse" | "verify";
export interface MissingPhotoRow {
  bucket: PhotoBucket;
  name: string;
  variants: string[];
  category: string | null;
  reference: { name: string; origin: "initial" | "extended"; key: string; hasPhoto: boolean } | null;
  /** Rapprochement : identique, évidente (accents/pluriel, une seule référence possible), variante, ambigu, proche, aucun,
   *  rattaché (article déjà relié à la référence). */
  matching: "identique" | "évidente" | "variante" | "ambigu" | "proche" | "aucun" | "rattaché";
  candidates: string[];
  familiesWithoutPhoto: number;
  lastAddedAt: string | null;
  linkedArticles: number;
  manualArticles: number;
}

interface Ref {
  origin: "initial" | "extended";
  key: string;
  name: string;
  category: string;
  hasPhoto: boolean;
}

export async function missingPhotos(db: Db): Promise<{ rows: MissingPhotoRow[]; computedAt: string; excludedFamilies: number }> {
  return readOnly(db, async (c) => {
    const labels = new Map<string, string>((await c.query("SELECT key, label FROM categories")).rows.map((r) => [r.key, r.label]));
    // Références du catalogue commun (nom actuel + anciens noms) ; marques exclues du rapprochement par le nom.
    const refRows = (
      await c.query(
        `SELECT 'initial' AS origin, i.key, i.name, i.former_names, i.category, i.photo_asset_id IS NOT NULL AS has_photo, NULL::uuid AS id, NULL::text AS brand, NULL::text AS merged_into FROM initial_catalog i
         UNION ALL
         SELECT 'extended', coalesce(e.key, e.id::text), e.name, e.former_names, e.category, e.photo_asset_id IS NOT NULL, e.id, e.brand, e.merged_into::text FROM extended_catalog e`,
      )
    ).rows;
    const refByInitial = new Map<string, Ref>();
    const refByExtendedId = new Map<string, Ref>();
    const byK = new Map<string, { ref: Ref; names: string[] }[]>();
    const byK2 = new Map<string, Set<string>>();
    for (const r of refRows) {
      const ref: Ref = { origin: r.origin, key: r.key, name: r.name, category: r.category, hasPhoto: r.has_photo };
      if (r.origin === "initial") refByInitial.set(r.key, ref);
      else refByExtendedId.set(r.id, ref);
      if (r.origin === "extended" && (r.brand || r.merged_into)) continue;
      const names = [r.name as string, ...((r.former_names as string[] | null) ?? [])];
      for (const n of names) {
        const { k, k2 } = photoKeys(n);
        if (!byK.has(k)) byK.set(k, []);
        byK.get(k)!.push({ ref, names: names.map((x) => x.toLowerCase()) });
        if (!byK2.has(k2)) byK2.set(k2, new Set());
        byK2.get(k2)!.add(ref.name);
      }
    }
    const pickRef = (k: string): Ref | null => {
      const l = byK.get(k);
      if (!l?.length) return null;
      return [...l].sort((a, b) => Number(b.ref.origin === "initial") - Number(a.ref.origin === "initial") || Number(b.ref.hasPhoto) - Number(a.ref.hasPhoto) || a.ref.name.localeCompare(b.ref.name))[0]!.ref;
    };

    // Articles ajoutés à la main, actifs, SANS photo affichée (une photo propre à la famille les exclut du décompte).
    const manual = (
      await c.query(
        `SELECT p.family_id, regexp_replace(btrim(p.name), '\\s+', ' ', 'g') AS name, p.category, p.created_at
           FROM products p
          WHERE p.catalog_key IS NULL AND p.extended_id IS NULL AND p.active AND p.photo_asset_id IS NULL
            AND p.family_id NOT IN (${EXCLUDED})`,
      )
    ).rows;
    // Articles rattachés à une référence, actifs, sans photo enregistrée sur l'article (l'application n'affiche que celle-ci).
    const linked = (
      await c.query(
        `SELECT p.family_id, p.catalog_key, p.extended_id, p.category, p.created_at
           FROM products p
          WHERE (p.catalog_key IS NOT NULL OR p.extended_id IS NOT NULL) AND p.active AND p.photo_asset_id IS NULL
            AND p.family_id NOT IN (${EXCLUDED})`,
      )
    ).rows;

    interface Acc {
      bucket: PhotoBucket;
      ref: Ref | null;
      matching: MissingPhotoRow["matching"];
      candidates: string[];
      variants: Map<string, number>;
      families: Set<string>;
      categories: Map<string, number>;
      last: Date | null;
      linked: number;
      manual: number;
    }
    const groups = new Map<string, Acc>();
    const acc = (id: string, init: () => Omit<Acc, "variants" | "families" | "categories" | "last" | "linked" | "manual">): Acc => {
      let g = groups.get(id);
      if (!g) groups.set(id, (g = { ...init(), variants: new Map(), families: new Set(), categories: new Map(), last: null, linked: 0, manual: 0 }));
      return g;
    };
    const touch = (g: Acc, family: string, category: string | null, at: Date, variant?: string) => {
      g.families.add(family); // un ensemble : une famille n'est jamais comptée deux fois
      if (category) g.categories.set(category, (g.categories.get(category) ?? 0) + 1);
      if (!g.last || at > g.last) g.last = at;
      if (variant) g.variants.set(variant, (g.variants.get(variant) ?? 0) + 1);
    };
    const refGroup = (ref: Ref, matching: MissingPhotoRow["matching"]) =>
      acc(`ref:${ref.origin}:${ref.key}`, () => ({ bucket: ref.hasPhoto ? "reuse" : "provide", ref, matching, candidates: [] }));

    for (const l of linked) {
      const ref = l.catalog_key ? refByInitial.get(l.catalog_key) : refByExtendedId.get(l.extended_id);
      if (!ref) continue;
      const g = refGroup(ref, "rattaché");
      touch(g, l.family_id, l.category, l.created_at);
      g.linked++;
    }
    // Articles manuels : regroupés par clé stricte, puis classés selon le rapprochement.
    const manualByK = new Map<string, typeof manual>();
    for (const m of manual) {
      const { k } = photoKeys(m.name);
      if (!k) continue;
      if (!manualByK.has(k)) manualByK.set(k, []);
      manualByK.get(k)!.push(m);
    }
    for (const [k, items] of manualByK) {
      const ref = pickRef(k);
      const refNames = new Set(byK.get(k)?.filter((x) => x.ref === ref).flatMap((x) => x.names) ?? []);
      // Seules les saisies IDENTIQUES à la référence (nom actuel ou ancien, majuscules mises à part) y sont rattachées ;
      // les autres saisies de la même clé restent « à vérifier » (ex. « Pate » à côté de « Pâtes »).
      // Variante évidente (accents, pluriel, majuscules) d'une seule référence possible : rattachée aussi.
      const candAll = [...(byK2.get(photoKeys(items[0]!.name).k2) ?? new Set<string>())];
      const same = ref ? items.filter((i) => refNames.has((i.name as string).toLowerCase()) || candAll.length <= 1) : [];
      const others = items.filter((i) => !same.includes(i));
      if (ref && same.length) {
        const g = refGroup(ref, "identique"); // même référence que les articles rattachés : familles fusionnées sans doublon
        if (g.matching === "rattaché") g.matching = "identique";
        if (!same.some((i) => refNames.has((i.name as string).toLowerCase())) && g.matching === "identique") g.matching = "évidente";
        for (const i of same) {
          touch(g, i.family_id, i.category, i.created_at, i.name);
          g.manual++;
        }
      }
      if (!others.length) continue;
      const cand = [...(byK2.get(photoKeys(others[0]!.name).k2) ?? new Set<string>())].sort();
      const matching: MissingPhotoRow["matching"] = cand.length > 1 ? "ambigu" : ref ? "variante" : cand.length === 1 ? "proche" : "aucun";
      const g = acc(`k:${k}`, () => ({ bucket: matching === "aucun" ? "provide" : "verify", ref: matching === "aucun" ? null : ref, matching, candidates: cand }));
      for (const i of others) {
        touch(g, i.family_id, i.category, i.created_at, i.name);
        g.manual++;
      }
    }

    const mode = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    const rows: MissingPhotoRow[] = [...groups.values()].map((g) => {
      const top = mode(g.variants);
      const cat = g.ref?.category ?? mode(g.categories);
      return {
        bucket: g.bucket,
        name: g.ref && g.bucket !== "verify" ? g.ref.name : top ? top.charAt(0).toUpperCase() + top.slice(1) : "",
        variants: [...g.variants.keys()].sort((a, b) => a.localeCompare(b)),
        category: cat ? labels.get(cat) ?? null : null,
        reference: g.ref ? { name: g.ref.name, origin: g.ref.origin, key: g.ref.key, hasPhoto: g.ref.hasPhoto } : null,
        matching: g.matching,
        candidates: g.candidates,
        familiesWithoutPhoto: g.families.size,
        lastAddedAt: g.last ? g.last.toISOString() : null,
        linkedArticles: g.linked,
        manualArticles: g.manual,
      };
    });
    rows.sort((a, b) => b.familiesWithoutPhoto - a.familiesWithoutPhoto || (b.lastAddedAt ?? "").localeCompare(a.lastAddedAt ?? "") || a.name.localeCompare(b.name));
    const excluded = Number((await c.query("SELECT count(*)::int AS n FROM platform_excluded_families")).rows[0].n);
    return { rows, computedAt: new Date().toISOString(), excludedFamilies: excluded };
  });
}

/* ───────────────────────── Usage de l'application ───────────────────────── */

export const ACTIVE_DEFINITION =
  "Famille active : au moins une action enregistrée sur une de ses listes pendant la période — création ou clôture d'une liste, ajout, modification ou achat d'un article. Les actions des listes supprimées depuis ne sont plus comptées.";

async function hasTable(c: Q, name: string): Promise<boolean> {
  return Boolean((await c.query("SELECT to_regclass($1) IS NOT NULL AS ok", [name])).rows[0].ok);
}

export async function usage(db: Db, days: number) {
  return readOnly(db, async (c) => {
    const hasCreations = await hasTable(c, "list_creations");
    // Date à partir de laquelle une liste supprimée reste datée (compteur de créations, migration 031).
    const counterSince = hasCreations
      ? ((await c.query("SELECT applied_at FROM schema_migrations WHERE name = '031_list_quota.sql'")).rows[0]?.applied_at as Date | undefined) ?? null
      : null;
    const fam = (
      await c.query(
        `SELECT count(*) FILTER (WHERE setup_completed_at IS NOT NULL)::int AS registered,
                count(*) FILTER (WHERE setup_completed_at IS NULL)::int AS unfinished,
                count(*) FILTER (WHERE setup_completed_at IS NOT NULL AND created_at >= now() - interval '7 days')::int AS new7,
                count(*) FILTER (WHERE setup_completed_at IS NOT NULL AND created_at >= now() - interval '30 days')::int AS new30
           FROM families WHERE id NOT IN (${EXCLUDED})`,
      )
    ).rows[0];
    const activeSql = (n: number) => `
      SELECT count(*)::int AS n FROM families f
       WHERE f.setup_completed_at IS NOT NULL AND f.id NOT IN (${EXCLUDED}) AND (
         EXISTS (SELECT 1 FROM list_events e WHERE e.family_id = f.id AND e.at >= now() - interval '${n} days')
         OR EXISTS (SELECT 1 FROM lists l WHERE l.family_id = f.id AND (l.created_at >= now() - interval '${n} days' OR l.closed_at >= now() - interval '${n} days')))`;
    const active7 = (await c.query(activeSql(7))).rows[0].n as number;
    const active30 = (await c.query(activeSql(30))).rows[0].n as number;
    // Listes : existantes + supprimées (journalisées « list.deleted », seul moyen de supprimer une liste d'une famille qui existe encore).
    const per = (
      await c.query(
        `WITH f AS (SELECT id FROM families WHERE setup_completed_at IS NOT NULL AND id NOT IN (${EXCLUDED})),
              existing AS (SELECT family_id, count(*)::int AS n, count(*) FILTER (WHERE created_at >= now() - make_interval(days => $1))::int AS p
                             FROM lists WHERE family_id IN (SELECT id FROM f) GROUP BY family_id),
              deleted AS (SELECT family_id, count(*)::int AS n FROM audit_log WHERE action = 'list.deleted' AND family_id IN (SELECT id FROM f) GROUP BY family_id),
              deleted_dated AS (${
                hasCreations
                  ? `SELECT family_id, count(*) FILTER (WHERE created_at >= now() - make_interval(days => $1))::int AS p FROM list_creations
                      WHERE list_id IS NULL AND family_id IN (SELECT id FROM f) GROUP BY family_id`
                  : "SELECT NULL::uuid AS family_id, 0 AS p WHERE false"
              })
         SELECT 'F-' || upper(substr(md5('mes-courses-plateforme:' || f.id::text), 1, 6)) AS anon,
                coalesce(e.n, 0) + coalesce(d.n, 0) AS total, coalesce(e.p, 0) + coalesce(dd.p, 0) AS period
           FROM f LEFT JOIN existing e ON e.family_id = f.id LEFT JOIN deleted d ON d.family_id = f.id LEFT JOIN deleted_dated dd ON dd.family_id = f.id`,
        [days],
      )
    ).rows as { anon: string; total: number; period: number }[];
    const totalLists = per.reduce((s, r) => s + r.total, 0);
    const periodLists = per.reduce((s, r) => s + r.period, 0);
    const ranking = per.filter((r) => r.total > 0).sort((a, b) => b.period - a.period || b.total - a.total || a.anon.localeCompare(b.anon)).slice(0, 100);
    const excluded = Number((await c.query("SELECT count(*)::int AS n FROM platform_excluded_families")).rows[0].n);
    return {
      computedAt: new Date().toISOString(),
      days,
      families: { registered: fam.registered, unfinishedSetups: fam.unfinished, new7: fam.new7, new30: fam.new30, active7, active30 },
      activeDefinition: ACTIVE_DEFINITION,
      lists: {
        total: totalLists,
        totalLabel: "Listes créées (total exact : listes existantes et listes supprimées depuis)",
        period: periodLists,
        periodNote: counterSince
          ? `Une liste supprimée n'est datée que depuis le ${counterSince.toISOString().slice(0, 10)} : avant, elle compte dans le total mais pas dans les périodes.`
          : "Les listes supprimées ne sont pas datées : elles comptent dans le total mais pas dans les périodes.",
      },
      ranking,
      excludedFamilies: excluded,
    };
  });
}

/* ───────────────────────── Routes ───────────────────────── */

export function platformRoutes(app: FastifyInstance, deps: { db: Db; guard: Guard }) {
  const { db, guard } = deps;
  const platformGuard = async (req: FastifyRequest) => {
    await guard()(req);
    if (!(await isPlatformAdmin(db, req.auth!.profileId, req.auth!.familyId))) throw new HttpError(403, "not_platform", "Accès réservé à l'espace plateforme");
  };
  app.get("/api/platform/photos", { preHandler: platformGuard, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { sort } = z.object({ sort: z.enum(["families", "recent"]).default("families") }).parse(req.query);
    const r = await missingPhotos(db);
    if (sort === "recent") r.rows.sort((a, b) => (b.lastAddedAt ?? "").localeCompare(a.lastAddedAt ?? "") || b.familiesWithoutPhoto - a.familiesWithoutPhoto);
    reply.header("Cache-Control", "no-store");
    return r;
  });
  app.get("/api/platform/usage", { preHandler: platformGuard, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90, 365].includes(d)).default(30) }).parse(req.query);
    reply.header("Cache-Control", "no-store");
    return usage(db, days);
  });
}
