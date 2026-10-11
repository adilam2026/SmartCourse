import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "./db.js";
import type { Guard } from "./guard.js";
import type { PushService } from "./push.js";

const b64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).min(8).max(256);
const subscription = z.object({
  endpoint: z.string().url().startsWith("https://").max(2048),
  keys: z.object({ p256dh: b64url, auth: b64url }),
  userAgent: z.string().max(300).optional(),
});
const MAX_DEVICES = 10;

/** Subscriptions of the signed-in parent / administrator. Staff never register (and are never notified). */
export function pushRoutes(app: FastifyInstance, { db, guard, push }: { db: Db; guard: Guard; push: PushService }): void {
  // « history.read » is what separates parents and administrators from staff.
  app.get("/api/push/config", { preHandler: guard("history.read") }, async () => ({ publicKey: await push.publicKey() }));

  app.post("/api/push/subscriptions", { preHandler: guard("history.read") }, async (req, reply) => {
    const a = req.auth!;
    const s = subscription.parse(req.body);
    // The device (endpoint) belongs to ONE profile at a time: registering it here takes it over from whoever used it before.
    await db.query(
      `INSERT INTO push_subscriptions (family_id, profile_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (endpoint) DO UPDATE SET family_id = EXCLUDED.family_id, profile_id = EXCLUDED.profile_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
                                            user_agent = EXCLUDED.user_agent, failures = 0`,
      [a.familyId, a.profileId, s.endpoint, s.keys.p256dh, s.keys.auth, s.userAgent ?? null],
    );
    // A reasonable number of phones per person: the oldest registrations beyond that are dropped.
    await db.query(
      `DELETE FROM push_subscriptions WHERE id IN (
         SELECT id FROM push_subscriptions WHERE profile_id = $1 ORDER BY created_at DESC OFFSET $2)`,
      [a.profileId, MAX_DEVICES],
    );
    return reply.code(201).send({ ok: true });
  });

  // Turning notifications off on this phone, or signing out: removes this device for the signed-in profile only.
  app.delete("/api/push/subscriptions", { preHandler: guard() }, async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().url().max(2048) }).parse(req.body);
    const r = await db.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND profile_id = $2", [endpoint, req.auth!.profileId]);
    return { removed: r.rowCount ?? 0 };
  });

  // « This phone is now used by me »: any registration of the same device that is not mine is dropped (an earlier profile that
  // could not unsubscribe, e.g. signed out while offline), and a staff profile keeps none. Answers whether this device is registered for me.
  app.post("/api/push/subscriptions/check", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { endpoint } = z.object({ endpoint: z.string().url().max(2048) }).parse(req.body);
    await db.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND profile_id <> $2", [endpoint, a.profileId]);
    if (a.role === "staff") await db.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
    const mine = (await db.query("SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND profile_id = $2", [endpoint, a.profileId])).rows.length > 0;
    return { registered: mine };
  });
}
