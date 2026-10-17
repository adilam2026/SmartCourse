import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import type { SseHub } from "./hub.js";
import type { PushService } from "./push.js";
import { applyOps, closeList, createList, deleteArchivedList, ensureActiveList, getActiveListView, getListView, listHistory, openLists, repriceList, type OpIn } from "./lists.js";
import { can, type Action } from "./permissions.js";

const uuid = z.string().uuid();
const quantity = z.number().positive().max(999);
const opSchema = z.discriminatedUnion("type", [
  z.object({ opId: uuid, type: z.literal("add"), productId: uuid, quantity: quantity.optional() }),
  z.object({ opId: uuid, type: z.literal("set_qty"), productId: uuid, quantity, baseRev: z.number().int().min(1) }),
  z.object({ opId: uuid, type: z.literal("request_again"), productId: uuid, quantity: quantity.optional() }),
  z.object({ opId: uuid, type: z.literal("remove"), productId: uuid, baseRev: z.number().int().min(1) }),
  z.object({ opId: uuid, type: z.literal("purchase"), itemId: uuid }),
  z.object({ opId: uuid, type: z.literal("correct"), purchaseId: uuid, reason: z.string().max(300).nullish() }),
]);

const REQUIRED: Record<OpIn["type"], Action> = {
  add: "list.edit_unpurchased",
  set_qty: "list.edit_unpurchased",
  request_again: "list.edit_unpurchased",
  remove: "list.edit_unpurchased",
  purchase: "purchase.record",
  correct: "purchase.correct",
};

export function listRoutes(app: FastifyInstance, { db, hub, guard, push }: { db: Db; hub: SseHub; guard: Guard; push?: PushService }): void {
  // `catalogRev` lets a client that polls decide whether it must download the catalogue again (see migration 008).
  app.get("/api/lists/active", { preHandler: guard() }, async (req) => {
    const list = await getActiveListView(db, req.auth!);
    const catalogRev = Number((await db.query("SELECT catalog_rev FROM families WHERE id = $1", [req.auth!.familyId])).rows[0]?.catalog_rev ?? 0);
    const prefsRev = Number((await db.query("SELECT prefs_rev FROM profiles WHERE id = $1", [req.auth!.profileId])).rows[0]?.prefs_rev ?? 0);
    return { list, catalogRev, prefsRev };
  });

  // Supprimer une liste clôturée et ses achats (administrateur, liste de sa famille seulement).
  app.delete("/api/lists/:id", { preHandler: guard("family.manage") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await deleteArchivedList(db, hub, req.auth!, id);
    return { ok: true, ...r };
  });

  // Réévaluer une liste en cours avec les prix actuels (action explicite d'un parent ou d'un administrateur).
  app.post("/api/lists/:id/reprice", { preHandler: guard("list.create") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const updated = await repriceList(db, hub, req.auth!, id);
    return { updated, list: await getListView(db, req.auth!, id) };
  });

  // Listes en cours (plusieurs seulement si la famille a activé l'option) et choix de la liste consultée par ce profil.
  app.get("/api/lists/open", { preHandler: guard() }, async (req) => ({ lists: await openLists(db, req.auth!) }));
  app.put("/api/me/current-list", { preHandler: guard() }, async (req) => {
    const { listId } = z.object({ listId: uuid }).parse(req.body ?? {});
    const ok = (await db.query("SELECT 1 FROM lists WHERE id = $1 AND family_id = $2 AND status = 'active'", [listId, req.auth!.familyId])).rows[0];
    if (!ok) throw new HttpError(404, "not_found", "Liste introuvable ou terminée");
    await db.query("UPDATE profiles SET current_list_id = $2 WHERE id = $1", [req.auth!.profileId, listId]);
    return { list: await getListView(db, req.auth!, listId) };
  });
  app.patch("/api/lists/:id", { preHandler: guard("list.create") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { name } = z.object({ name: z.string().trim().min(1).max(40).nullable() }).parse(req.body ?? {});
    const r = await db.query("UPDATE lists SET name = $3 WHERE id = $1 AND family_id = $2 AND status = 'active' RETURNING id", [id, req.auth!.familyId, name]);
    if (!r.rows[0]) throw new HttpError(404, "not_found", "Liste introuvable ou terminée");
    hub.broadcast(req.auth!.familyId, "list.updated", { listId: id });
    return { list: await getListView(db, req.auth!, id) };
  });

  app.post("/api/lists", { preHandler: guard("list.create") }, async (req, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(40).optional() }).parse(req.body ?? {});
    const { id } = await createList(db, hub, req.auth!, name);
    return reply.code(201).send({ list: await getListView(db, req.auth!, id) });
  });

  app.get("/api/lists", { preHandler: guard("history.read") }, async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.string().datetime().optional() }).parse(req.query);
    return { lists: await listHistory(db, req.auth!, q.limit, q.before) };
  });

  app.get("/api/lists/:id", { preHandler: guard("history.read") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return { list: await getListView(db, req.auth!, id) };
  });

  // Demandes sur « la liste en cours », sans en connaître l'identifiant : la liste est créée si elle n'existe pas encore (personnel compris).
  // Seules des demandes d'articles peuvent la créer ; les droits de chaque opération restent vérifiés comme partout ailleurs.
  app.post("/api/lists/active/ops", { preHandler: guard() }, async (req) => {
    const { ops, batch } = z.object({ ops: z.array(opSchema).min(1).max(200), batch: z.object({ id: uuid, at: z.string().datetime({ offset: true }).optional() }).optional() }).parse(req.body);
    for (const op of ops) if (!can(req.auth!.role, REQUIRED[op.type])) throw new HttpError(403, "forbidden", "Action non autorisée");
    const current = (await getActiveListView(db, req.auth!)) as { id: string } | null;
    if (!current && !ops.some((o) => o.type === "add" || o.type === "request_again")) throw new HttpError(404, "not_found", "Liste introuvable");
    const id = current?.id ?? (await ensureActiveList(db, hub, req.auth!));
    return applyOps(db, hub, req.auth!, id, ops, batch, push);
  });

  app.post("/api/lists/:id/ops", { preHandler: guard() }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { ops, batch } = z.object({ ops: z.array(opSchema).min(1).max(200), batch: z.object({ id: uuid, at: z.string().datetime({ offset: true }).optional() }).optional() }).parse(req.body);
    // Rights are checked server-side for every operation before any is applied.
    for (const op of ops) if (!can(req.auth!.role, REQUIRED[op.type])) throw new HttpError(403, "forbidden", "Action non autorisée");
    return applyOps(db, hub, req.auth!, id, ops, batch, push);
  });

  app.post("/api/lists/:id/close", { preHandler: guard("list.close") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return closeList(db, hub, req.auth!, id);
  });
}
