import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import { can } from "./permissions.js";
import { savePhotoAsset, type PhotoStore } from "./photos.js";

interface Deps {
  db: Db;
  store: PhotoStore;
  guard: Guard;
}

/** Lowercase, accents and ligatures flattened: what extended_catalog.search_text holds. */
export const normalizeSearch = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/’/g, "'")
    .trim();

const photoUrl = (id: string | null) => (id ? `/api/photos/${id}` : null);

const productView = (r: any) => ({
  id: r.id,
  category: r.category,
  name: r.name,
  brand: r.brand,
  active: r.active,
  photoUrl: photoUrl(r.photo_asset_id),
});

export function catalogRoutes(app: FastifyInstance, { db, store, guard }: Deps): void {
  app.addContentTypeParser(["image/jpeg", "image/png", "image/webp"], { parseAs: "buffer", bodyLimit: 9 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  // Catalogue familial, regroupé par catégorie. Le personnel et les parents ne voient que les produits actifs.
  app.get("/api/catalog", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { includeInactive } = z.object({ includeInactive: z.enum(["0", "1"]).optional() }).parse(req.query);
    const withInactive = includeInactive === "1" && can(a.role, "family.manage");
    const [cats, prods] = await Promise.all([
      db.query("SELECT key, label FROM categories ORDER BY position"),
      db.query(
        `SELECT * FROM products WHERE family_id = $1 ${withInactive ? "" : "AND active"} ORDER BY position, lower(name)`,
        [a.familyId],
      ),
    ]);
    return {
      categories: cats.rows.map((c) => ({
        key: c.key,
        label: c.label,
        products: prods.rows.filter((p) => p.category === c.key).map(productView),
      })),
    };
  });

  app.patch("/api/products/:id", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        brand: z.string().trim().min(1).max(40).nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    try {
      // Same id before and after: renaming or deactivating never detaches history.
      const r = await db.query(
        `UPDATE products SET name = COALESCE($3, name),
                brand = CASE WHEN $4::boolean THEN $5 ELSE brand END,
                active = COALESCE($6, active)
          WHERE id = $1 AND family_id = $2 RETURNING *`,
        [id, req.auth!.familyId, body.name ?? null, body.brand !== undefined, body.brand ?? null, body.active ?? null],
      );
      if (!r.rows[0]) throw new HttpError(404, "not_found", "Produit introuvable");
      return { product: productView(r.rows[0]) };
    } catch (e: any) {
      if (e.code === "23505") throw new HttpError(409, "product_exists", "Ce produit existe déjà dans le catalogue familial");
      throw e;
    }
  });

  // Catalogue étendu : recherche seulement, jamais listé en entier, jamais exposé au personnel.
  app.get("/api/catalog/extended", { preHandler: guard("family.manage") }, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query);
    const needle = normalizeSearch(q).replace(/[\\%_]/g, (c) => `\\${c}`);
    const r = await db.query(
      `SELECT e.id, e.name, e.brand, e.category, e.photo_asset_id,
              EXISTS (SELECT 1 FROM products p WHERE p.family_id = $2
                       AND (p.extended_id = e.id OR (lower(p.name) = lower(e.name) AND coalesce(lower(p.brand),'') = coalesce(lower(e.brand),'')))) AS already_added
         FROM extended_catalog e
        WHERE e.search_text LIKE '%' || $1 || '%'
        ORDER BY (e.search_text LIKE $1 || '%') DESC, e.name
        LIMIT 20`,
      [needle, req.auth!.familyId],
    );
    return {
      results: r.rows.map((e) => ({
        id: e.id,
        name: e.name,
        brand: e.brand,
        category: e.category,
        photoUrl: photoUrl(e.photo_asset_id),
        alreadyAdded: e.already_added,
      })),
    };
  });

  app.post("/api/products/from-extended", { preHandler: guard("family.manage") }, async (req, reply) => {
    const { extendedId } = z.object({ extendedId: z.string().uuid() }).parse(req.body);
    const familyId = req.auth!.familyId;
    const product = await withTx(db, async (c) => {
      const e = (await c.query("SELECT * FROM extended_catalog WHERE id = $1", [extendedId])).rows[0];
      if (!e) throw new HttpError(404, "not_found", "Produit introuvable dans le catalogue étendu");
      const pos = (await c.query("SELECT coalesce(max(position), -1) + 1 AS p FROM products WHERE family_id = $1 AND category = $2", [familyId, e.category])).rows[0].p;
      const ins = await c.query(
        `INSERT INTO products (family_id, category, name, brand, photo_asset_id, extended_id, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING RETURNING *`,
        [familyId, e.category, e.name, e.brand, e.photo_asset_id, e.id, pos],
      );
      if (!ins.rows[0]) throw new HttpError(409, "product_exists", "Ce produit existe déjà dans le catalogue familial");
      return ins.rows[0];
    });
    return reply.code(201).send({ product: productView(product) });
  });

  // Photo prise par la famille : nouvelle ressource immuable, l'ancienne reste référencée par l'historique.
  app.post("/api/products/:id/photo", { preHandler: guard("family.manage"), bodyLimit: 9 * 1024 * 1024 }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!Buffer.isBuffer(req.body)) throw new HttpError(415, "unsupported_media_type", "Envoyer une image JPEG, PNG ou WebP");
    const familyId = req.auth!.familyId;
    const owned = await db.query("SELECT 1 FROM products WHERE id = $1 AND family_id = $2", [id, familyId]);
    if (!owned.rows[0]) throw new HttpError(404, "not_found", "Produit introuvable");
    const assetId = await savePhotoAsset(db, store, req.body, { sourceName: "Photo familiale", license: "OWN" }, { ownerFamilyId: familyId, importedBy: req.auth!.profileId });
    const r = await db.query("UPDATE products SET photo_asset_id = $3 WHERE id = $1 AND family_id = $2 RETURNING *", [id, familyId, assetId]);
    return { product: productView(r.rows[0]) };
  });

  // Les photos sont immuables : cache d'un an, validé par l'empreinte du contenu.
  app.get("/api/photos/:id", { preHandler: guard() }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const r = await db.query(
      "SELECT storage_key, content_hash FROM photo_assets WHERE id = $1 AND (owner_family_id IS NULL OR owner_family_id = $2)",
      [id, req.auth!.familyId],
    );
    const asset = r.rows[0];
    if (!asset) throw new HttpError(404, "not_found", "Photo introuvable");
    const etag = `"${asset.content_hash}"`;
    reply.header("ETag", etag).header("Cache-Control", "private, max-age=31536000, immutable");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    const file = await store.get(asset.storage_key);
    if (!file) throw new HttpError(404, "not_found", "Fichier photo introuvable");
    return reply.type(file.mime).send(file.data);
  });

  // Crédits : provenance et attribution de chaque photo utilisée par la famille.
  app.get("/api/credits", { preHandler: guard() }, async (req) => {
    const r = await db.query(
      `SELECT DISTINCT a.id, a.source_name, a.source_url, a.license, a.license_url, a.author, a.attribution_required, a.attribution_text
         FROM products p JOIN photo_assets a ON a.id = p.photo_asset_id
        WHERE p.family_id = $1 AND a.license <> 'OWN'
        ORDER BY a.source_name, a.author NULLS LAST`,
      [req.auth!.familyId],
    );
    return {
      credits: r.rows.map((a) => ({
        sourceName: a.source_name,
        sourceUrl: a.source_url,
        license: a.license,
        licenseUrl: a.license_url,
        author: a.author,
        attributionRequired: a.attribution_required,
        text: a.attribution_text,
      })),
    };
  });
}
