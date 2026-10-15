import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import type { SseHub } from "./hub.js";
import { UNITS, type Unit } from "./lists.js";
import { can } from "./permissions.js";
import { insertPhotoAsset, MAX_INPUT_BYTES, preparePhoto, type PhotoStore, type PreparedPhoto } from "./photos.js";
import { gestionPage } from "./gestion-page.js";

interface Deps {
  db: Db;
  store: PhotoStore;
  guard: Guard;
  hub: SseHub;
  /** Profils gestionnaires donnés par la variable CATALOG_MANAGERS (en plus de la table catalog_managers). */
  managers?: string[];
}

/** Minuscules, sans accents ni ligatures : la forme de extended_catalog.search_text. */
const norm = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/’/g, "'").replace(/\s+/g, " ").trim();
const like = (s: string) => norm(s).replace(/[\\%_]/g, (c) => `\\${c}`);
const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "produit";
const photoUrl = (id: string | null) => (id ? `/api/photos/${id}` : null);
const unitField = z.enum(UNITS as unknown as [Unit, ...Unit[]]);

/** Unité proposée pour un produit créé : même règle que le catalogue ; « Autres » = à l'unité. */
export const familyDefaultUnit = (category: string): Unit =>
  category === "legumes" || category === "fruits" || category === "viandes" ? "kg" : category === "boissons" ? "bouteille" : category === "epicerie" || category === "surgeles" ? "paquet" : "piece";

/** Colonnes communes d'une référence (départ ou étendue). */
const REF_I = "SELECT 'initial'::text AS origin, i.key, NULL::uuid AS id, i.name, i.category, i.unit, i.photo_asset_id, i.former_names FROM initial_catalog i";
const REF_E = "SELECT 'extended'::text AS origin, e.key, e.id, e.name, e.category, e.unit, e.photo_asset_id, e.former_names FROM extended_catalog e WHERE e.merged_into IS NULL";
const refByKey = (origin: "initial" | "extended") => (origin === "initial" ? `${REF_I} WHERE i.key = $1` : `${REF_E} AND e.key = $1`);

const view = (r: any) => ({
  id: r.id,
  category: r.category,
  name: r.name,
  brand: r.brand,
  active: r.active,
  unit: r.unit as Unit,
  photoUrl: photoUrl(r.photo_asset_id),
  own: r.catalog_key == null && r.extended_id == null,
  price: null,
});

export async function isManager(db: Db, profileId: string, envManagers: string[] = []): Promise<boolean> {
  if (envManagers.includes(profileId)) return true;
  return !!(await db.query("SELECT 1 FROM catalog_managers WHERE profile_id = $1", [profileId])).rows[0];
}

/**
 * Produits propres à une famille (tous les rôles), propositions volontaires au catalogue commun, et espace des gestionnaires.
 * Créer un produit ne donne aucun autre droit : ni achats, ni validation, ni gestion des membres, ni modification du catalogue.
 */
export function familyProductRoutes(app: FastifyInstance, { db, store, guard, hub, managers = [] }: Deps): void {
  // ---- Références proches (tous les rôles, lecture seule) : produits de la famille et références du catalogue commun ----
  app.get("/api/catalog/suggest", { preHandler: guard() }, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query);
    const familyId = req.auth!.familyId;
    const words = norm(q).split(" ").filter((w) => w.length >= 3).slice(0, 4);
    const needles = [like(q), ...words.map((w) => like(w))];
    const flat = (col: string) => `replace(translate(lower(${col}), 'àâäéèêëîïôöùûüç’', 'aaaeeeeiioouuuc'''), 'œ', 'oe')`;
    const r = await db.query(
      `WITH ref AS (
         SELECT 'initial'::text AS origin, i.key, i.name, i.category, i.photo_asset_id, ${flat("i.name || ' ' || i.aliases")} AS stext, i.key AS ck, NULL::uuid AS eid, i.former_names AS former, lower(i.name) AS lname, ''::text AS lbrand
           FROM initial_catalog i
         UNION ALL
         SELECT 'extended', e.key, e.name, e.category, e.photo_asset_id, e.search_text, NULL, e.id, e.former_names, lower(e.name), coalesce(lower(e.brand),'')
           FROM extended_catalog e WHERE e.merged_into IS NULL
       )
       SELECT r.origin, r.key, r.name, r.category, r.photo_asset_id, p.id AS product_id, p.active AS product_active,
              (r.stext LIKE $2 || '%') AS prefix
         FROM ref r
         LEFT JOIN LATERAL (
           SELECT p.id, p.active FROM products p
            WHERE p.family_id = $1 AND ((r.ck IS NOT NULL AND p.catalog_key = r.ck) OR (r.eid IS NOT NULL AND p.extended_id = r.eid)
               OR (lower(p.name) = r.lname AND coalesce(lower(p.brand),'') = r.lbrand) OR lower(p.name) = ANY (r.former))
            ORDER BY p.active DESC LIMIT 1) p ON true
        WHERE r.stext LIKE ANY (SELECT '%' || n || '%' FROM unnest($3::text[]) n)
        ORDER BY (r.stext LIKE '%' || $2 || '%') DESC, prefix DESC, r.name
        LIMIT 6`,
      [familyId, like(q), needles],
    );
    return {
      results: r.rows.map((x) => ({
        origin: x.origin as "initial" | "extended",
        key: x.key as string,
        name: x.name as string,
        category: x.category as string,
        photoUrl: photoUrl(x.photo_asset_id),
        status: (x.product_id ? (x.product_active ? "active" : "inactive") : "absent") as "active" | "inactive" | "absent",
        productId: (x.product_id as string | null) ?? null,
      })),
    };
  });

  // ---- Créer un produit pour sa famille (tous les rôles) — ou prendre la référence commune choisie ----
  // Idempotent : un second envoi (double appui, réseau qui renvoie) retrouve le produit actif du même nom au lieu d'en créer un autre.
  app.post("/api/products/family", { preHandler: guard(), config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const a = req.auth!;
    const body = z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        category: z.string().min(1).max(40).optional(),
        unit: unitField.optional(),
        ref: z.object({ origin: z.enum(["initial", "extended"]), key: z.string().min(1).max(80) }).optional(),
      })
      .refine((b) => b.name || b.ref, { message: "Nom obligatoire" })
      .parse(req.body);
    const out = await withTx(db, async (c) => {
      // 1. Référence commune : choisie explicitement, ou de même nom exact (pas de doublon d'une référence existante).
      let ref = body.ref ? (await c.query(refByKey(body.ref.origin), [body.ref.key])).rows[0] : undefined;
      if (body.ref && !ref) throw new HttpError(404, "not_found", "Produit introuvable dans le catalogue");
      const name = (ref?.name as string | undefined) ?? body.name!.replace(/\s+/g, " ");
      if (!ref) {
        ref = (
          await c.query(
            `${REF_I} WHERE lower(i.name) = lower($1) OR lower($1) = ANY (i.former_names)
             UNION ALL
             ${REF_E} AND e.brand IS NULL AND (lower(e.name) = lower($1) OR lower($1) = ANY (e.former_names))
             LIMIT 1`,
            [name],
          )
        ).rows[0];
      }
      // 2. Déjà dans la famille ?
      const existing = (
        await c.query(
          `SELECT * FROM products WHERE family_id = $1 AND (
              ($2::text IS NOT NULL AND catalog_key = $2) OR ($3::uuid IS NOT NULL AND extended_id = $3)
              OR (lower(name) = lower($4) AND brand IS NULL) OR ($5::text[] IS NOT NULL AND lower(name) = ANY ($5::text[])))
            ORDER BY active DESC LIMIT 1 FOR UPDATE`,
          [a.familyId, ref?.origin === "initial" ? ref.key : null, ref?.origin === "extended" ? ref.id : null, ref?.name ?? name, ref?.former_names ?? null],
        )
      ).rows[0];
      if (existing) {
        if (existing.active) return { product: existing, created: false };
        // Masqué volontairement : seul un administrateur peut le remettre (la création ne donne pas ce droit au reste de la famille).
        if (!can(a.role, "family.manage")) throw new HttpError(409, "product_hidden", "Ce produit a été retiré du catalogue par un administrateur de la famille");
        const r = await c.query("UPDATE products SET active = true WHERE id = $1 RETURNING *", [existing.id]);
        return { product: r.rows[0], created: false };
      }
      const category = ref?.category ?? body.category ?? "autres";
      if (!(await c.query("SELECT 1 FROM categories WHERE key = $1", [category])).rows[0]) throw new HttpError(400, "invalid_category", "Catégorie inconnue");
      const unit: Unit = ref ? ((ref.unit as Unit | null) ?? familyDefaultUnit(category)) : (body.unit ?? familyDefaultUnit(category));
      const pos = (await c.query("SELECT coalesce(max(position), -1) + 1 AS p FROM products WHERE family_id = $1 AND category = $2", [a.familyId, category])).rows[0].p;
      const ins = await c.query(
        `INSERT INTO products (family_id, category, name, photo_asset_id, catalog_key, extended_id, position, unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [a.familyId, category, name, ref?.photo_asset_id ?? null, ref?.origin === "initial" ? ref.key : null, ref?.origin === "extended" ? ref.id : null, pos, unit],
      );
      return { product: ins.rows[0], created: true };
    });
    hub.broadcast(a.familyId, "catalog.updated", { productId: out.product.id });
    return reply.code(out.created ? 201 : 200).send({ product: view(out.product), created: out.created });
  });

  // ---- Proposer un produit de la famille au catalogue commun (tous les rôles, facultatif, jamais bloquant) ----
  app.post("/api/products/:id/propose", { preHandler: guard(), config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const a = req.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { description } = z.object({ description: z.string().trim().max(300).optional() }).parse(req.body ?? {});
    const p = (await db.query("SELECT * FROM products WHERE id = $1 AND family_id = $2", [id, a.familyId])).rows[0];
    if (!p) throw new HttpError(404, "not_found", "Produit introuvable");
    if (p.catalog_key || p.extended_id) throw new HttpError(409, "already_common", "Ce produit fait déjà partie du catalogue commun");
    const pending = (await db.query("SELECT id FROM catalog_proposals WHERE product_id = $1 AND status = 'pending'", [id])).rows[0];
    if (pending) return reply.code(200).send({ proposalId: pending.id, created: false });
    const n = Number((await db.query("SELECT count(*) AS n FROM catalog_proposals WHERE family_id = $1 AND status = 'pending'", [a.familyId])).rows[0].n);
    if (n >= 30) throw new HttpError(429, "too_many_proposals", "Trop de propositions en attente pour votre famille");
    const r = await db.query(
      `INSERT INTO catalog_proposals (family_id, product_id, proposed_by, name, category, unit, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
      [a.familyId, id, a.profileId, p.name, p.category, p.unit, description || null],
    );
    const pid = r.rows[0]?.id ?? (await db.query("SELECT id FROM catalog_proposals WHERE product_id = $1 AND status = 'pending'", [id])).rows[0].id;
    return reply.code(r.rows[0] ? 201 : 200).send({ proposalId: pid, created: !!r.rows[0] });
  });

  // ================= Espace des gestionnaires (/gestion) =================
  const managerGuard = async (req: any) => {
    await guard()(req);
    if (!(await isManager(db, req.auth.profileId, managers)))
      throw new HttpError(403, "not_manager", "Accès réservé aux gestionnaires du catalogue de Mes Courses");
  };

  app.get("/gestion", async (_req, reply) =>
    reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex").header("X-Frame-Options", "DENY").type("text/html; charset=utf-8").send(gestionPage),
  );

  // Qui suis-je ? Toujours permis à une personne connectée : affiche son identifiant de profil pour qu'on puisse lui ouvrir l'accès.
  app.get("/api/gestion/me", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    return { profileId: a.profileId, displayName: a.displayName, manager: await isManager(db, a.profileId, managers) };
  });

  // Les propositions ne montrent jamais la famille : seulement ce qui a été envoyé, et combien de familles ont proposé le même nom.
  app.get("/api/gestion/proposals", { preHandler: managerGuard }, async (req) => {
    const { status } = z.object({ status: z.enum(["pending", "accepted", "rejected"]).default("pending") }).parse(req.query);
    const r = await db.query(
      `SELECT p.id, p.name, p.category, c.label AS category_label, p.unit, p.description, p.status, p.created_at, p.decided_at, p.result_origin, p.result_key, p.note,
              (SELECT count(DISTINCT q.family_id) FROM catalog_proposals q WHERE lower(q.name) = lower(p.name) AND q.status = 'pending') AS families
         FROM catalog_proposals p JOIN categories c ON c.key = p.category
        WHERE p.status = $1 ORDER BY ${status === "pending" ? "p.created_at" : "p.decided_at DESC"} LIMIT 200`,
      [status],
    );
    const cats = await db.query("SELECT key, label FROM categories ORDER BY position");
    return {
      categories: cats.rows,
      units: UNITS,
      proposals: r.rows.map((x) => ({
        id: x.id,
        name: x.name,
        category: x.category,
        categoryLabel: x.category_label,
        unit: x.unit,
        description: x.description,
        status: x.status,
        createdAt: x.created_at,
        decidedAt: x.decided_at,
        result: x.result_key ? { origin: x.result_origin, key: x.result_key } : null,
        note: x.note,
        families: Number(x.families),
      })),
    };
  });

  app.get("/api/gestion/catalog", { preHandler: managerGuard }, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query);
    const r = await db.query(
      `SELECT 'initial' AS origin, key, name, category FROM initial_catalog WHERE ${"replace(translate(lower(name || ' ' || aliases), 'àâäéèêëîïôöùûüç’', 'aaaeeeeiioouuuc'''), 'œ', 'oe')"} LIKE '%' || $1 || '%'
       UNION ALL
       SELECT 'extended', key, name, category FROM extended_catalog WHERE merged_into IS NULL AND search_text LIKE '%' || $1 || '%'
       ORDER BY name LIMIT 20`,
      [like(q)],
    );
    return { results: r.rows };
  });

  // Accepter : publier une nouvelle référence commune, OU rattacher à une référence existante. Le produit de la famille qui a proposé
  // garde son identifiant, son nom, ses quantités, ses prix et son historique : seul le lien vers la référence (et la photo s'il n'en a pas) change.
  app.post("/api/gestion/proposals/:id/accept", { preHandler: managerGuard, bodyLimit: 14 * 1024 * 1024 }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        category: z.string().min(1).max(40).optional(),
        unit: unitField.optional(),
        keywords: z.string().trim().max(200).optional(),
        image: z.string().min(20).max(12_000_000).optional(),
        link: z.object({ origin: z.enum(["initial", "extended"]), key: z.string().min(1).max(80) }).optional(),
      })
      .parse(req.body ?? {});
    let prepared: PreparedPhoto | undefined;
    if (body.image && !body.link) {
      const buf = Buffer.from(body.image.replace(/^data:[^,]*,/, ""), "base64");
      if (!buf.length) throw new HttpError(400, "invalid_image", "Fichier image illisible");
      if (buf.length > MAX_INPUT_BYTES) throw new HttpError(413, "image_too_large", "Image trop volumineuse (8 Mo max)");
      prepared = await preparePhoto(store, buf, { sourceName: "Photo du catalogue Mes Courses", license: "OWN" });
    }
    const out = await withTx(db, async (c) => {
      const p = (await c.query("SELECT * FROM catalog_proposals WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!p) throw new HttpError(404, "not_found", "Proposition introuvable");
      if (p.status !== "pending") throw new HttpError(409, "already_decided", "Proposition déjà traitée");
      let ref: any;
      if (body.link) {
        ref = (await c.query(refByKey(body.link.origin), [body.link.key])).rows[0];
        if (!ref) throw new HttpError(404, "not_found", "Référence introuvable");
      } else {
        const name = (body.name ?? p.name).replace(/\s+/g, " ");
        const category = body.category ?? p.category;
        if (!(await c.query("SELECT 1 FROM categories WHERE key = $1", [category])).rows[0]) throw new HttpError(400, "invalid_category", "Catégorie inconnue");
        const dup = (await c.query("SELECT key FROM extended_catalog WHERE lower(name) = lower($1) AND brand IS NULL AND merged_into IS NULL UNION ALL SELECT key FROM initial_catalog WHERE lower(name) = lower($1)", [name])).rows[0];
        if (dup) throw new HttpError(409, "reference_exists", `Une référence « ${name} » existe déjà : rattachez la proposition à celle-ci`);
        let key = slug(name);
        for (let i = 2; (await c.query("SELECT 1 FROM extended_catalog WHERE key = $1", [key])).rows[0]; i++) key = `${slug(name)}-${i}`;
        const photoId = prepared ? await insertPhotoAsset(c, prepared, { ownerFamilyId: null, importedBy: req.auth!.profileId }) : null;
        ref = (
          await c.query(
            `INSERT INTO extended_catalog (category, name, search_text, source, key, unit, photo_asset_id)
             VALUES ($1,$2,$3,'proposal',$4,$5,$6) RETURNING 'extended' AS origin, key, id, name, category, unit, photo_asset_id`,
            [category, name, norm(`${name} ${body.keywords ?? ""}`), key, body.unit ?? p.unit, photoId],
          )
        ).rows[0];
      }
      // Rattacher le produit de la famille si rien d'autre dans cette famille ne porte déjà ce lien (sinon on n'y touche pas).
      const linkCol = ref.origin === "initial" ? "catalog_key" : "extended_id";
      const linkVal = ref.origin === "initial" ? ref.key : ref.id;
      const taken = (await c.query(`SELECT 1 FROM products WHERE family_id = $1 AND ${linkCol} = $2 AND id <> $3`, [p.family_id, linkVal, p.product_id])).rows[0];
      if (!taken)
        await c.query(
          `UPDATE products SET ${linkCol} = $2, photo_asset_id = coalesce(photo_asset_id, $3) WHERE id = $1 AND catalog_key IS NULL AND extended_id IS NULL`,
          [p.product_id, linkVal, ref.photo_asset_id ?? null],
        );
      await c.query(
        "UPDATE catalog_proposals SET status = 'accepted', decided_at = now(), decided_by = $2, result_origin = $3, result_key = $4 WHERE id = $1",
        [id, req.auth!.profileId, ref.origin, ref.key],
      );
      return { familyId: p.family_id as string, ref: { origin: ref.origin as string, key: ref.key as string, name: ref.name as string } };
    });
    hub.broadcast(out.familyId, "catalog.updated", {});
    return { accepted: true, reference: out.ref };
  });

  app.post("/api/gestion/proposals/:id/reject", { preHandler: managerGuard }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { note } = z.object({ note: z.string().trim().max(300).optional() }).parse(req.body ?? {});
    const r = await db.query(
      "UPDATE catalog_proposals SET status = 'rejected', decided_at = now(), decided_by = $2, note = $3 WHERE id = $1 AND status = 'pending' RETURNING id",
      [id, req.auth!.profileId, note || null],
    );
    if (!r.rows[0]) throw new HttpError(409, "already_decided", "Proposition introuvable ou déjà traitée");
    return { rejected: true };
  });
}
