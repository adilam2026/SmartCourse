import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import type { SseHub } from "./hub.js";
import { applyOps, closeList, createList, getActiveListView, getListView, listHistory, type OpIn } from "./lists.js";
import { can, type Action } from "./permissions.js";

const uuid = z.string().uuid();
const opSchema = z.discriminatedUnion("type", [
  z.object({ opId: uuid, type: z.literal("add"), productId: uuid }),
  z.object({ opId: uuid, type: z.literal("remove"), productId: uuid, baseRev: z.number().int().min(1) }),
  z.object({ opId: uuid, type: z.literal("purchase"), itemId: uuid }),
  z.object({ opId: uuid, type: z.literal("correct"), purchaseId: uuid, reason: z.string().max(300).nullish() }),
]);

const REQUIRED: Record<OpIn["type"], Action> = {
  add: "list.edit_unpurchased",
  remove: "list.edit_unpurchased",
  purchase: "purchase.record",
  correct: "purchase.correct",
};

export function listRoutes(app: FastifyInstance, { db, hub, guard }: { db: Db; hub: SseHub; guard: Guard }): void {
  // `catalogRev` lets a client that polls decide whether it must download the catalogue again (see migration 008).
  app.get("/api/lists/active", { preHandler: guard() }, async (req) => {
    const list = await getActiveListView(db, req.auth!);
    const catalogRev = Number((await db.query("SELECT catalog_rev FROM families WHERE id = $1", [req.auth!.familyId])).rows[0]?.catalog_rev ?? 0);
    return { list, catalogRev };
  });

  app.post("/api/lists", { preHandler: guard("list.create") }, async (req, reply) => {
    const { id } = await createList(db, hub, req.auth!);
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

  app.post("/api/lists/:id/ops", { preHandler: guard() }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { ops } = z.object({ ops: z.array(opSchema).min(1).max(200) }).parse(req.body);
    // Rights are checked server-side for every operation before any is applied.
    for (const op of ops) if (!can(req.auth!.role, REQUIRED[op.type])) throw new HttpError(403, "forbidden", "Action non autorisée");
    return applyOps(db, hub, req.auth!, id, ops);
  });

  app.post("/api/lists/:id/close", { preHandler: guard("list.close") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return closeList(db, hub, req.auth!, id);
  });
}
