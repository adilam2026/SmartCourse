import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "./db.js";
import type { Guard } from "./guard.js";
import { quotaState } from "./list-quota.js";
import { secretMatches } from "./recovery.js";
import type { StoreService } from "./store/service.js";

/**
 * Achats « Mes Courses Famille » :
 * - POST /api/family/purchases : l'application présente un achat (ou le restaure) ; le serveur le vérifie auprès du store et
 *   le rattache à la famille s'il porte son jeton store. Ouvert à tous les membres (restaurer), mais seuls les administrateurs
 *   reçoivent le jeton nécessaire pour acheter : un achat fait sans lui n'est jamais accepté.
 * - POST /api/store/google/rtdn?token=… : notifications Google Play (Pub/Sub, envoi « push »), adresse protégée par un jeton.
 * - POST /api/store/apple/notifications : notifications App Store Server v2 (signées par Apple, vérifiées).
 */
const submission = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("google"), productId: z.string().min(1).max(100), purchaseToken: z.string().min(10).max(4096) }),
  z.object({ platform: z.literal("apple"), signedTransaction: z.string().min(20).max(20_000) }),
]);

export async function familyPlan(db: Db, auth: { familyId: string; role: string }) {
  const st = await quotaState(db, auth.familyId);
  const canPurchase = auth.role === "admin";
  const token = canPurchase ? ((await db.query("SELECT store_account_token::text AS t FROM families WHERE id = $1", [auth.familyId])).rows[0]?.t as string | undefined) : undefined;
  return { ...st, canPurchase, ...(token ? { storeAccountToken: token } : {}) };
}

export function storeRoutes(app: FastifyInstance, deps: { db: Db; guard: Guard; store: StoreService; rateLimit?: { max: number; timeWindow: string } }) {
  const { db, guard, store } = deps;

  app.post("/api/family/purchases", { preHandler: guard(), config: { rateLimit: deps.rateLimit ?? { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const s = submission.parse(req.body);
    const r = await store.submit({ familyId: req.auth!.familyId, profileId: req.auth!.profileId }, s);
    return { result: { status: r.status }, plan: await familyPlan(db, req.auth!) };
  });

  app.post("/api/store/google/rtdn", async (req, reply) => {
    const tok = (req.query as { token?: string })?.token;
    const expected = store.google?.cfg.rtdnToken;
    if (!expected || !secretMatches(String(tok ?? ""), expected)) return reply.code(404).send({ error: "not_found" });
    await store.googleNotification(req.body);
    return { ok: true };
  });

  app.post("/api/store/apple/notifications", async (req, reply) => {
    if (!store.apple) return reply.code(404).send({ error: "not_found" });
    await store.appleNotification(req.body);
    return { ok: true };
  });
}
