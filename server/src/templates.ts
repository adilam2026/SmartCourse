import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import { normalizeQuantity, type Unit } from "./lists.js";

/** Favoris : modèles de liste d'une famille (produits et quantités). Un modèle n'est jamais modifié par une commande qui l'utilise. */
interface Deps {
  db: Db;
  guard: Guard;
}

const MAX_TEMPLATES = 30;
const MAX_ITEMS = 200;
const itemIn = z.object({ productId: z.string().uuid(), quantity: z.number().positive().max(999) });
const nameField = z.string().trim().min(1).max(60);

async function view(db: Db, familyId: string, id?: string) {
  const t = await db.query(`SELECT id, name, created_at, updated_at FROM list_templates WHERE family_id = $1 ${id ? "AND id = $2" : ""} ORDER BY lower(name)`, id ? [familyId, id] : [familyId]);
  const items = await db.query(
    `SELECT ti.template_id, ti.product_id, ti.quantity, ti.unit, p.name, p.brand, p.active, p.unit AS current_unit, p.category, p.photo_asset_id
       FROM list_template_items ti JOIN products p ON p.id = ti.product_id
      WHERE ti.template_id = ANY($1::uuid[]) ORDER BY ti.position, lower(p.name)`,
    [t.rows.map((r) => r.id)],
  );
  return t.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    updatedAt: (r.updated_at as Date).toISOString(),
    items: items.rows
      .filter((i) => i.template_id === r.id)
      .map((i) => ({
        productId: i.product_id as string,
        name: i.name as string,
        brand: (i.brand as string | null) ?? null,
        category: i.category as string,
        photoUrl: i.photo_asset_id ? `/api/photos/${i.photo_asset_id}` : null,
        quantity: Number(i.quantity),
        unit: i.unit as Unit,
        productActive: i.active as boolean,
        currentUnit: i.current_unit as Unit,
      })),
  }));
}

export function templateRoutes(app: FastifyInstance, { db, guard }: Deps): void {
  // Lecture : parents et administrateurs (ceux qui préparent la liste). Le personnel n'a pas besoin des favoris.
  app.get("/api/templates", { preHandler: guard("list.create") }, async (req) => ({ templates: await view(db, req.auth!.familyId) }));

  async function save(familyId: string, profileId: string, id: string | null, body: { name?: string; items?: { productId: string; quantity: number }[]; fromListId?: string }) {
    let items = body.items;
    return withTx(db, async (c) => {
      if (body.fromListId) {
        // Enregistrer la liste en cours (ou un ancien achat) comme favori : ses produits et quantités demandées.
        const own = (await c.query("SELECT id FROM lists WHERE id = $1 AND family_id = $2", [body.fromListId, familyId])).rows[0];
        if (!own) throw new HttpError(404, "not_found", "Liste introuvable");
        items = (await c.query("SELECT product_id, quantity FROM list_items WHERE list_id = $1 AND status IN ('to_buy','purchased') ORDER BY added_at", [body.fromListId])).rows.map((r) => ({ productId: r.product_id as string, quantity: Number(r.quantity) }));
        if (items.length === 0) throw new HttpError(400, "empty_template", "Cette liste est vide");
      }
      if (items && items.length > MAX_ITEMS) throw new HttpError(400, "too_many_items", "Trop de produits dans ce favori");
      let tid = id;
      if (!tid) {
        if (Number((await c.query("SELECT count(*) AS n FROM list_templates WHERE family_id = $1", [familyId])).rows[0].n) >= MAX_TEMPLATES) throw new HttpError(409, "too_many_templates", "Nombre maximal de favoris atteint");
        try {
          tid = (await c.query("INSERT INTO list_templates (family_id, name, created_by) VALUES ($1,$2,$3) RETURNING id", [familyId, body.name, profileId])).rows[0].id;
        } catch (e: any) {
          if (e.code === "23505") throw new HttpError(409, "template_exists", "Un favori porte déjà ce nom");
          throw e;
        }
      } else {
        const own = (await c.query("SELECT id FROM list_templates WHERE id = $1 AND family_id = $2 FOR UPDATE", [tid, familyId])).rows[0];
        if (!own) throw new HttpError(404, "not_found", "Favori introuvable");
        try {
          await c.query("UPDATE list_templates SET name = coalesce($2, name), updated_at = now() WHERE id = $1", [tid, body.name ?? null]);
        } catch (e: any) {
          if (e.code === "23505") throw new HttpError(409, "template_exists", "Un favori porte déjà ce nom");
          throw e;
        }
      }
      if (items) {
        await c.query("DELETE FROM list_template_items WHERE template_id = $1", [tid]);
        let pos = 0;
        const seen = new Set<string>();
        for (const it of items) {
          if (seen.has(it.productId)) continue; // jamais deux fois le même produit
          seen.add(it.productId);
          const p = (await c.query("SELECT unit FROM products WHERE id = $1 AND family_id = $2", [it.productId, familyId])).rows[0];
          if (!p) throw new HttpError(400, "product_unknown", "Produit introuvable");
          const q = normalizeQuantity(it.quantity, p.unit as Unit);
          if (q === null) throw new HttpError(400, "bad_quantity", "Quantité invalide");
          await c.query("INSERT INTO list_template_items (template_id, product_id, quantity, unit, position) VALUES ($1,$2,$3,$4,$5)", [tid, it.productId, q, p.unit, pos++]);
        }
        await c.query("UPDATE list_templates SET updated_at = now() WHERE id = $1", [tid]);
      }
      return tid!;
    });
  }

  app.post("/api/templates", { preHandler: guard("family.manage") }, async (req, reply) => {
    const b = z.object({ name: nameField, items: z.array(itemIn).optional(), fromListId: z.string().uuid().optional() }).parse(req.body);
    const id = await save(req.auth!.familyId, req.auth!.profileId, null, b);
    return reply.code(201).send({ template: (await view(db, req.auth!.familyId, id))[0] });
  });

  app.put("/api/templates/:id", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ name: nameField.optional(), items: z.array(itemIn).optional() }).parse(req.body);
    await save(req.auth!.familyId, req.auth!.profileId, id, b);
    return { template: (await view(db, req.auth!.familyId, id))[0] };
  });

  app.delete("/api/templates/:id", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await withTx(db, async (c) => {
      const own = (await c.query("SELECT id FROM list_templates WHERE id = $1 AND family_id = $2 FOR UPDATE", [id, req.auth!.familyId])).rows[0];
      if (!own) throw new HttpError(404, "not_found", "Favori introuvable");
      await c.query("DELETE FROM list_template_items WHERE template_id = $1", [id]);
      await c.query("DELETE FROM list_templates WHERE id = $1", [id]);
    });
    return { ok: true };
  });
}
