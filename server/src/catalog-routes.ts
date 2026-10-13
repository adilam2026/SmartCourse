import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import { can } from "./permissions.js";
import type { SseHub } from "./hub.js";
import { UNITS, type Unit } from "./lists.js";
import { loadPrices, type PriceView } from "./prices.js";
import { insertPhotoAsset, MAX_INPUT_BYTES, preparePhoto, type PhotoStore, type PreparedPhoto } from "./photos.js";

interface Deps {
  db: Db;
  store: PhotoStore;
  guard: Guard;
  hub: SseHub;
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

/** Unit a new article starts with (same rule as the migration); the administrator can change it per article. */
export const defaultUnit = (category: string): Unit =>
  category === "legumes" || category === "fruits" || category === "viandes" ? "kg" : category === "boissons" ? "bouteille" : category === "epicerie" || category === "surgeles" ? "paquet" : "piece";

/** The shared catalogue picture matching a family article: by link, else by exact name (or a former name). Never by category. */
const catalogPhotoSql = `coalesce(
  (SELECT i.photo_asset_id FROM initial_catalog i WHERE i.key = p.catalog_key),
  (SELECT e.photo_asset_id FROM extended_catalog e WHERE e.id = p.extended_id AND e.merged_into IS NULL),
  (SELECT i.photo_asset_id FROM initial_catalog i WHERE lower(i.name) = lower(p.name) OR lower(p.name) = ANY (i.former_names) LIMIT 1),
  (SELECT e.photo_asset_id FROM extended_catalog e WHERE e.merged_into IS NULL AND ((lower(e.name) = lower(p.name) AND coalesce(lower(e.brand),'') = coalesce(lower(p.brand),'')) OR lower(p.name) = ANY (e.former_names)) LIMIT 1))`;

const photoUrl = (id: string | null) => (id ? `/api/photos/${id}` : null);

const productView = (r: any, price: PriceView | null = null) => ({
  id: r.id,
  category: r.category,
  name: r.name,
  brand: r.brand,
  active: r.active,
  unit: r.unit as Unit,
  photoUrl: photoUrl(r.photo_asset_id),
  price,
});

export function catalogRoutes(app: FastifyInstance, { db, store, guard, hub }: Deps): void {
  app.addContentTypeParser(["image/jpeg", "image/png", "image/webp"], { parseAs: "buffer", bodyLimit: 9 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  // Catalogue familial, regroupé par catégorie. Le personnel et les parents ne voient que les produits actifs.
  app.get("/api/catalog", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { includeInactive } = z.object({ includeInactive: z.enum(["0", "1"]).optional() }).parse(req.query);
    const withInactive = includeInactive === "1" && can(a.role, "family.manage");
    // Revision read FIRST: if the catalogue changes while it is being read, the client holds a revision older than its data
    // and simply downloads once more; it can never keep stale data under a fresh revision.
    const rev = Number((await db.query("SELECT catalog_rev FROM families WHERE id = $1", [a.familyId])).rows[0]?.catalog_rev ?? 0);
    const prices = await loadPrices(db, a.familyId);
    const [cats, prods] = await Promise.all([
      db.query("SELECT key, label FROM categories ORDER BY position"),
      db.query(
        `SELECT * FROM products WHERE family_id = $1 ${withInactive ? "" : "AND active"} ORDER BY position, lower(name)`,
        [a.familyId],
      ),
    ]);
    return {
      rev,
      categories: cats.rows.map((c) => ({
        key: c.key,
        label: c.label,
        products: prods.rows.filter((p) => p.category === c.key).map((p) => productView(p, prices.get(p.id) ?? null)),
      })),
    };
  });

  // ---- Ajouter / modifier un article (administrateur). Pas réservé aux 80 articles de départ.
  // L'image arrive en base64 (déjà réduite par le téléphone, puis normalisée ici : 512 px, WebP, fond blanc, sans rognage).
  const imageField = z.string().min(20).max(12_000_000);
  const categoryField = z.string().min(1).max(40);
  const decodeImage = (b64: string): Buffer => {
    const buf = Buffer.from(b64.replace(/^data:[^,]*,/, ""), "base64");
    if (buf.length === 0) throw new HttpError(400, "invalid_image", "Fichier image illisible");
    if (buf.length > MAX_INPUT_BYTES) throw new HttpError(413, "image_too_large", "Image trop volumineuse (8 Mo max)");
    return buf;
  };

  interface SaveInput {
    id?: string;
    name?: string;
    category?: string;
    brand?: string | null;
    active?: boolean;
    unit?: Unit;
    image?: Buffer;
    resetImage?: boolean;
  }

  async function saveProduct(auth: { familyId: string; profileId: string }, input: SaveInput) {
    // The picture is processed and written first (no database involved); the product row and its link to the new
    // picture are then written together, so a failure can never leave a product pointing at nothing.
    const prepared: PreparedPhoto | undefined = input.image ? await preparePhoto(store, input.image, { sourceName: "Photo familiale", license: "OWN" }) : undefined;
    try {
      return await withTx(db, async (c) => {
        if (input.category !== undefined) {
          const ok = await c.query("SELECT 1 FROM categories WHERE key = $1", [input.category]);
          if (!ok.rows[0]) throw new HttpError(400, "invalid_category", "Catégorie inconnue");
        }
        const photoId = prepared ? await insertPhotoAsset(c, prepared, { ownerFamilyId: auth.familyId, importedBy: auth.profileId }) : undefined;
        if (!input.id) {
          const category = input.category!;
          const pos = (await c.query("SELECT coalesce(max(position), -1) + 1 AS p FROM products WHERE family_id = $1 AND category = $2", [auth.familyId, category])).rows[0].p;
          const r = await c.query(
            `INSERT INTO products (family_id, category, name, brand, active, photo_asset_id, position, unit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [auth.familyId, category, input.name, input.brand ?? null, input.active ?? true, photoId ?? null, pos, input.unit ?? defaultUnit(category)],
          );
          return r.rows[0];
        }
        // Same id before and after: renaming, moving or deactivating never detaches history (archives keep their own snapshot).
        const cur = (await c.query(`SELECT p.*, ${catalogPhotoSql} AS catalog_photo FROM products p WHERE p.id = $1 AND p.family_id = $2 FOR UPDATE OF p`, [input.id, auth.familyId])).rows[0];
        if (!cur) throw new HttpError(404, "not_found", "Produit introuvable");
        const category = input.category ?? cur.category;
        const position = category !== cur.category ? (await c.query("SELECT coalesce(max(position), -1) + 1 AS p FROM products WHERE family_id = $1 AND category = $2", [auth.familyId, category])).rows[0].p : cur.position;
        let photo = cur.photo_asset_id as string | null;
        if (photoId) photo = photoId;
        else if (input.resetImage) photo = cur.catalog_photo ?? null; // back to the catalogue picture (or none for an added article)
        const r = await c.query(
          `UPDATE products SET name = $3, category = $4, position = $5, brand = $6, active = $7, photo_asset_id = $8, unit = $9 WHERE id = $1 AND family_id = $2 RETURNING *`,
          [input.id, auth.familyId, input.name ?? cur.name, category, position, input.brand !== undefined ? input.brand : cur.brand, input.active ?? cur.active, photo, input.unit ?? cur.unit],
        );
        return r.rows[0];
      });
    } catch (e: any) {
      if (e.code === "23505") throw new HttpError(409, "product_exists", "Un article de ce nom existe déjà dans le catalogue");
      throw e;
    }
  }

  app.post("/api/products", { preHandler: guard("family.manage"), bodyLimit: 14 * 1024 * 1024 }, async (req, reply) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(60), category: categoryField, image: imageField.optional(), active: z.boolean().optional(), unit: z.enum(UNITS as unknown as [Unit, ...Unit[]]).optional() })
      .parse(req.body);
    const product = await saveProduct(req.auth!, { name: body.name, category: body.category, active: body.active, unit: body.unit, image: body.image ? decodeImage(body.image) : undefined });
    hub.broadcast(req.auth!.familyId, "catalog.updated", { productId: product.id });
    return reply.code(201).send({ product: productView(product) });
  });

  app.patch("/api/products/:id", { preHandler: guard("family.manage"), bodyLimit: 14 * 1024 * 1024 }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        category: categoryField.optional(),
        brand: z.string().trim().min(1).max(40).nullable().optional(),
        active: z.boolean().optional(),
        unit: z.enum(UNITS as unknown as [Unit, ...Unit[]]).optional(),
        image: imageField.optional(),
        resetImage: z.boolean().optional(),
      })
      .parse(req.body);
    const product = await saveProduct(req.auth!, { id, ...body, image: body.image ? decodeImage(body.image) : undefined });
    hub.broadcast(req.auth!.familyId, "catalog.updated", { productId: product.id });
    return { product: productView(product) };
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
        WHERE e.merged_into IS NULL AND e.search_text LIKE '%' || $1 || '%'
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

  // Tous les produits (catalogue de départ + étendu), navigables sans recherche : par catégorie, page par page.
  // Chaque entrée dit où en est la famille : absent (Ajouter), actif (Déjà disponible), désactivé (Réactiver).
  // Parcourir ne donne aucun droit : lecture réservée à family.manage, comme le reste du catalogue.
  app.get("/api/catalog/all", { preHandler: guard("family.manage") }, async (req) => {
    const qs = z
      .object({
        category: z.string().min(1).max(40).optional(),
        q: z.string().trim().max(60).optional(),
        offset: z.coerce.number().int().min(0).max(5000).default(0),
        limit: z.coerce.number().int().min(1).max(60).default(24),
        // Filtre par état chez la famille : « todo » = à ajouter (absent ou retiré). Options de l'application Android : compteurs réels et « présents d'abord ».
        status: z.enum(["active", "inactive", "absent", "todo"]).optional(),
        counts: z.enum(["0", "1"]).optional(),
        presentFirst: z.enum(["0", "1"]).optional(),
      })
      .parse(req.query);
    const needle = qs.q ? normalizeSearch(qs.q).replace(/[\\%_]/g, (c) => `\\${c}`) : null;
    const familyId = req.auth!.familyId;
    // One row per catalogue entry. The family product is matched by link (catalog_key / extended_id) or, failing that,
    // by exact name+brand — so a product the family typed by hand shows up as already there, never as a duplicate.
    const flat = (col: string) => `replace(translate(lower(${col}), 'àâäéèêëîïôöùûüç’', 'aaaeeeeiioouuuc'''), 'œ', 'oe')`;
    const base = `
      WITH ref AS (
        SELECT 'initial'::text AS origin, i.key, i.category, i.name, NULL::text AS brand, i.photo_asset_id, i.position AS pos,
               lower(i.name) AS lname, ''::text AS lbrand, ${flat("i.name || ' ' || i.aliases")} AS stext, i.key AS catalog_key, NULL::uuid AS extended_id,
               i.former_names AS former, i.unit AS cunit
          FROM initial_catalog i
        UNION ALL
        SELECT 'extended', e.key, e.category, e.name, e.brand, e.photo_asset_id, 1000,
               lower(e.name), coalesce(lower(e.brand),''), e.search_text, NULL, e.id, e.former_names, e.unit
          FROM extended_catalog e WHERE e.merged_into IS NULL
        UNION ALL
        -- Articles propres à la famille (créés à la main) : ils apparaissent aussi, pour que la recherche soit commune.
        SELECT 'family', f.id::text, f.category, f.name, f.brand, f.photo_asset_id, 2000,
               lower(f.name), coalesce(lower(f.brand),''), ${flat("f.name")}, NULL, NULL, '{}'::text[], NULL
          FROM products f
         WHERE f.family_id = $1 AND f.catalog_key IS NULL
           AND (f.extended_id IS NULL OR EXISTS (SELECT 1 FROM extended_catalog m WHERE m.id = f.extended_id AND m.merged_into IS NOT NULL
                  AND EXISTS (SELECT 1 FROM products d WHERE d.family_id = $1 AND d.catalog_key = m.merged_into) ))
           AND NOT EXISTS (SELECT 1 FROM extended_catalog e WHERE e.merged_into IS NULL AND ((lower(e.name) = lower(f.name) AND coalesce(lower(e.brand),'') = coalesce(lower(f.brand),'')) OR lower(f.name) = ANY (e.former_names)))
           AND NOT EXISTS (SELECT 1 FROM initial_catalog i WHERE lower(f.name) = ANY (i.former_names) OR lower(i.name) = lower(f.name))
      )
      SELECT r.origin, r.key, r.category, r.name, r.brand, r.pos, r.photo_asset_id AS ref_photo, r.cunit,
             p.id AS product_id, p.active AS product_active, p.unit AS product_unit, p.photo_asset_id AS product_photo
        FROM ref r
        LEFT JOIN LATERAL (
          SELECT p.* FROM products p
           WHERE p.family_id = $1
             AND ((r.catalog_key IS NOT NULL AND p.catalog_key = r.catalog_key)
               OR (r.extended_id IS NOT NULL AND p.extended_id = r.extended_id)
               OR (r.catalog_key IS NOT NULL AND p.extended_id IN (SELECT m.id FROM extended_catalog m WHERE m.merged_into = r.catalog_key))
               OR (lower(p.name) = r.lname AND coalesce(lower(p.brand),'') = r.lbrand)
               OR lower(p.name) = ANY (r.former))
           ORDER BY (p.catalog_key = r.catalog_key OR p.extended_id = r.extended_id) DESC NULLS LAST, p.active DESC
           LIMIT 1
        ) p ON true
       WHERE ($2::text IS NULL OR r.category = $2)
         AND ($3::text IS NULL OR r.stext LIKE '%' || $3 || '%')`;
    const params = [familyId, qs.category ?? null, needle];
    const stateOf = `(CASE WHEN t.product_id IS NULL THEN 'absent' WHEN t.product_active THEN 'active' ELSE 'inactive' END)`;
    const stateWhere = !qs.status ? "TRUE" : qs.status === "todo" ? `${stateOf} <> 'active'` : `${stateOf} = '${qs.status}'`; // valeurs d'une énumération : aucune injection possible
    const presentFirst = qs.presentFirst === "1" ? `(t.product_id IS NOT NULL AND t.product_active) DESC NULLS LAST, ` : "";
    const total = Number((await db.query(`SELECT count(*) AS n FROM (${base}) t WHERE ${stateWhere}`, params)).rows[0].n);
    const r = await db.query(
      `SELECT t.* FROM (${base}) t JOIN categories c ON c.key = t.category
        WHERE ${stateWhere}
        ORDER BY ${presentFirst}c.position, (t.origin = 'initial') DESC, t.pos, lower(t.name) LIMIT $4 OFFSET $5`,
      [...params, qs.limit, qs.offset],
    );
    let counts: { active: number; inactive: number; absent: number } | undefined;
    if (qs.counts === "1") {
      const cr = await db.query(`SELECT ${stateOf} AS st, count(*)::int AS n FROM (${base}) t GROUP BY 1`, params);
      counts = { active: 0, inactive: 0, absent: 0 };
      for (const x of cr.rows) counts[x.st as "active" | "inactive" | "absent"] = x.n;
    }
    return {
      total,
      ...(counts ? { counts } : {}),
      offset: qs.offset,
      items: r.rows.map((x) => ({
        key: x.key as string,
        origin: x.origin as "initial" | "extended" | "family",
        name: x.name as string,
        brand: x.brand as string | null,
        category: x.category as string,
        // The picture the family sees: its own article's if it has one, else the catalogue's. Never another product's.
        photoUrl: photoUrl(x.product_photo ?? x.ref_photo),
        status: (x.product_id ? (x.product_active ? "active" : "inactive") : "absent") as "active" | "inactive" | "absent",
        productId: (x.product_id as string | null) ?? null,
        unit: ((x.product_unit as Unit | null) ?? (x.cunit as Unit | null) ?? defaultUnit(x.category)) as Unit,
      })),
    };
  });

  // Ajout depuis le catalogue complet par clé stable (initiale ou étendue) ; réactive plutôt que de recréer.
  app.post("/api/products/from-catalog", { preHandler: guard("family.manage") }, async (req, reply) => {
    const { origin, key } = z.object({ origin: z.enum(["initial", "extended"]), key: z.string().min(1).max(80) }).parse(req.body);
    const familyId = req.auth!.familyId;
    const out = await withTx(db, async (c) => {
      const e = (await c.query(origin === "initial" ? "SELECT * FROM initial_catalog WHERE key = $1" : "SELECT * FROM extended_catalog WHERE key = $1", [key])).rows[0];
      if (!e) throw new HttpError(404, "not_found", "Produit introuvable dans le catalogue");
      const brand: string | null = origin === "extended" ? e.brand : null;
      const link = origin === "initial" ? "catalog_key = $2 OR extended_id IN (SELECT m.id FROM extended_catalog m WHERE m.merged_into = $2)" : "extended_id = $2";
      const former: string[] = e.former_names ?? [];
      const existing = (
        await c.query(
          `SELECT * FROM products WHERE family_id = $1 AND (${link} OR (lower(name) = lower($3) AND coalesce(lower(brand),'') = coalesce(lower($4),'')) OR lower(name) = ANY ($5::text[])) ORDER BY (catalog_key IS NOT NULL OR extended_id IS NOT NULL) DESC, active DESC LIMIT 1 FOR UPDATE`,
          [familyId, origin === "initial" ? e.key : e.id, e.name, brand, former],
        )
      ).rows[0];
      if (existing) {
        if (existing.active) return { product: existing, created: false, reactivated: false };
        const r = await c.query("UPDATE products SET active = true WHERE id = $1 RETURNING *", [existing.id]);
        return { product: r.rows[0], created: false, reactivated: true };
      }
      const pos = (await c.query("SELECT coalesce(max(position), -1) + 1 AS p FROM products WHERE family_id = $1 AND category = $2", [familyId, e.category])).rows[0].p;
      const ins = await c.query(
        `INSERT INTO products (family_id, category, name, brand, photo_asset_id, ${origin === "initial" ? "catalog_key" : "extended_id"}, position, unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [familyId, e.category, e.name, brand, e.photo_asset_id, origin === "initial" ? e.key : e.id, pos, e.unit ?? defaultUnit(e.category)],
      );
      return { product: ins.rows[0], created: true, reactivated: false };
    });
    if (out.created || out.reactivated) hub.broadcast(familyId, "catalog.updated", { productId: out.product.id });
    return reply.code(out.created ? 201 : 200).send({ product: productView(out.product), created: out.created, reactivated: out.reactivated });
  });

  // Audit des articles de la famille : d'où vient la photo, laquelle est partagée par des noms différents, et la photo
  // du catalogue qui correspond au nom (jamais déduite de la catégorie) — de quoi repérer et remplacer une association erronée.
  app.get("/api/catalog/audit", { preHandler: guard("family.manage") }, async (req) => {
    const r = await db.query(
      `SELECT p.id, p.name, p.category, p.active, p.unit, p.photo_asset_id,
              CASE WHEN p.photo_asset_id IS NULL THEN 'none' WHEN a.owner_family_id IS NULL THEN 'catalogue' ELSE 'famille' END AS photo_source,
              (SELECT count(DISTINCT lower(q.name)) FROM products q WHERE q.family_id = p.family_id AND q.photo_asset_id = p.photo_asset_id) AS names_sharing,
              ${catalogPhotoSql} AS catalog_photo
         FROM products p LEFT JOIN photo_assets a ON a.id = p.photo_asset_id
        WHERE p.family_id = $1 ORDER BY p.category, lower(p.name)`,
      [req.auth!.familyId],
    );
    return {
      products: r.rows.map((x) => ({
        id: x.id as string,
        name: x.name as string,
        category: x.category as string,
        active: x.active as boolean,
        unit: x.unit as Unit,
        photoSource: x.photo_source as "none" | "catalogue" | "famille",
        sharedWithOtherNames: Number(x.names_sharing) > 1,
        /** Picture the catalogue holds for this very product, when it differs from the one shown. */
        catalogPhotoUrl: x.catalog_photo && x.catalog_photo !== x.photo_asset_id ? photoUrl(x.catalog_photo) : null,
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
        `INSERT INTO products (family_id, category, name, brand, photo_asset_id, extended_id, position, unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING RETURNING *`,
        [familyId, e.category, e.name, e.brand, e.photo_asset_id, e.id, pos, e.unit ?? defaultUnit(e.category)],
      );
      if (!ins.rows[0]) throw new HttpError(409, "product_exists", "Ce produit existe déjà dans le catalogue familial");
      return ins.rows[0];
    });
    return reply.code(201).send({ product: productView(product) });
  });

  // Photo envoyée telle quelle (JPEG/PNG/WebP) : nouvelle ressource immuable ; l'ancienne reste référencée par les archives.
  app.post("/api/products/:id/photo", { preHandler: guard("family.manage"), bodyLimit: 9 * 1024 * 1024 }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!Buffer.isBuffer(req.body)) throw new HttpError(415, "unsupported_media_type", "Envoyer une image JPEG, PNG ou WebP");
    const product = await saveProduct(req.auth!, { id, image: req.body });
    hub.broadcast(req.auth!.familyId, "catalog.updated", { productId: product.id });
    return { product: productView(product) };
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

  // Crédits : provenance et attribution des images affichées à la famille (catalogue ET archives, qui gardent leur image d'origine).
  app.get("/api/credits", { preHandler: guard() }, async (req) => {
    const r = await db.query(
      `SELECT DISTINCT a.id, a.source_name, a.source_url, a.license, a.license_url, a.author, a.attribution_required, a.attribution_text, a.generated
         FROM photo_assets a
        WHERE a.license <> 'OWN'
          AND (EXISTS (SELECT 1 FROM products p WHERE p.photo_asset_id = a.id AND p.family_id = $1)
            OR EXISTS (SELECT 1 FROM list_items li WHERE li.snapshot_photo_asset_id = a.id AND li.family_id = $1))
        ORDER BY a.source_name, a.author NULLS LAST`,
      [req.auth!.familyId],
    );
    const generated = r.rows.filter((a) => a.generated);
    return {
      // Images we generated: one line, no licence invented.
      generated: generated.length ? { count: generated.length, source: generated[0].source_name as string } : null,
      credits: r.rows
        .filter((a) => !a.generated)
        .map((a) => ({
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
