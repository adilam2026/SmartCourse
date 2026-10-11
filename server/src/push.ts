import webpush from "web-push";
import type { AuthContext } from "./auth.js";
import type { Db } from "./db.js";

/**
 * Notifications téléphone (Web Push, standard W3C) pour les parents et administrateurs.
 *  - transport : le service push du navigateur du téléphone (Chrome → Firebase Cloud Messaging, gratuit, sans compte ni projet à créer) ;
 *    le serveur signe chaque envoi avec ses clés VAPID, créées au premier démarrage et gardées dans la base (table push_config) ;
 *  - destinataires : décidés ICI, côté serveur, à partir des profils (même famille, rôle parent ou administrateur, profil actif),
 *    jamais l'auteur de l'action, jamais le personnel ;
 *  - une notification par validation réussie, une seule fois (push_events.validation_id), calculée à partir du journal de la validation.
 */
export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushPayload {
  v: 1;
  title: string;
  body: string;
  /** Replaces a notification already shown for the same validation (a duplicate delivery never stacks). */
  tag: string;
  listId: string;
  /** Where a tap goes (the app resolves the list: active → current list, closed → its history, no session → login first). */
  url: string;
}
export type PushSender = (sub: PushSubscriptionRow, payload: string) => Promise<{ statusCode: number }>;

export interface ValidationSummary {
  added: number;
  modified: number;
  removed: number;
  first: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** « Nouvelle liste de courses — Marie a validé 5 produits » / « Liste mise à jour — Marie a ajouté 3 produits et modifié 2 quantités ». */
export function buildMessage(name: string, s: ValidationSummary): { title: string; body: string } | null {
  if (s.added + s.modified + s.removed === 0) return null; // nothing changed: nothing is sent
  if (s.first && s.added > 0) return { title: "Nouvelle liste de courses", body: `${name} a validé ${plural(s.added, "produit")}` };
  const parts: string[] = [];
  if (s.added) parts.push(`ajouté ${plural(s.added, "produit")}`);
  if (s.modified) parts.push(`modifié ${plural(s.modified, "quantité")}`);
  if (s.removed) parts.push(`retiré ${plural(s.removed, "produit")}`);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}` : parts[0]!;
  return { title: "Liste mise à jour", body: `${name} a ${text}` };
}

export class PushService {
  private pending = new Set<Promise<unknown>>();
  private keys: { publicKey: string; privateKey: string } | null = null;
  private send: PushSender;

  constructor(
    private db: Db,
    opts: { sender?: PushSender; subject?: string } = {},
  ) {
    this.subject = opts.subject ?? process.env.VAPID_SUBJECT ?? `https://${process.env.RAILWAY_PUBLIC_DOMAIN ?? "smartcourse-production-c7ce.up.railway.app"}`;
    this.send = opts.sender ?? ((sub, payload) => this.webPushSend(sub, payload));
  }
  private subject: string;

  /** The public key the phones subscribe with; created once (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY can override). */
  async publicKey(): Promise<string> {
    return (await this.loadKeys()).publicKey;
  }

  private async loadKeys() {
    if (this.keys) return this.keys;
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return (this.keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY });
    const cur = (await this.db.query("SELECT public_key, private_key FROM push_config WHERE id")).rows[0];
    if (cur) return (this.keys = { publicKey: cur.public_key, privateKey: cur.private_key });
    const k = webpush.generateVAPIDKeys();
    // Two servers starting together: the first insert wins, the other reads it back.
    await this.db.query("INSERT INTO push_config (id, public_key, private_key) VALUES (true, $1, $2) ON CONFLICT DO NOTHING", [k.publicKey, k.privateKey]);
    const row = (await this.db.query("SELECT public_key, private_key FROM push_config WHERE id")).rows[0];
    return (this.keys = { publicKey: row.public_key, privateKey: row.private_key });
  }

  private async webPushSend(sub: PushSubscriptionRow, payload: string): Promise<{ statusCode: number }> {
    const k = await this.loadKeys();
    try {
      const r = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
        vapidDetails: { subject: this.subject, publicKey: k.publicKey, privateKey: k.privateKey },
        TTL: 24 * 3600, // the push service keeps it a day when the phone is off or offline, then drops it
        urgency: "high",
        timeout: 10_000,
      });
      return { statusCode: r.statusCode };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status) return { statusCode: status };
      throw e;
    }
  }

  /** Runs `fn` in the background; tests (and shutdown) can wait for it with idle(). A failure never reaches the request that triggered it. */
  enqueue(fn: () => Promise<unknown>): void {
    const p: Promise<unknown> = fn()
      .catch((e) => console.error(`Notification : ${(e as Error).message}`))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** What a validation did, from its journal entries (family-scoped). Corrections of purchases are not list changes. */
  async summarize(familyId: string, validationId: string): Promise<(ValidationSummary & { listId: string; actorId: string }) | null> {
    const ev = (
      await this.db.query(
        `SELECT list_id, actor_id, product_id, kind FROM list_events WHERE family_id = $1 AND validation_id = $2 AND kind IN ('add','request_again','qty','remove')`,
        [familyId, validationId],
      )
    ).rows;
    if (!ev.length) return null;
    const addedIds = new Set<string>(ev.filter((e) => e.kind === "add" || e.kind === "request_again").map((e) => e.product_id));
    const modified = new Set<string>(ev.filter((e) => e.kind === "qty" && !addedIds.has(e.product_id)).map((e) => e.product_id));
    const removed = new Set<string>(ev.filter((e) => e.kind === "remove" && !addedIds.has(e.product_id)).map((e) => e.product_id));
    const v = (await this.db.query("SELECT received_at FROM validations WHERE id = $1 AND family_id = $2", [validationId, familyId])).rows[0];
    // « First » = no earlier validation of this list produced any change.
    const earlier = (
      await this.db.query(
        `SELECT 1 FROM validations o WHERE o.list_id = $1 AND o.id <> $2 AND o.received_at < $3
            AND EXISTS (SELECT 1 FROM list_events e WHERE e.validation_id = o.id AND e.kind IN ('add','request_again','qty','remove')) LIMIT 1`,
        [ev[0].list_id, validationId, v.received_at],
      )
    ).rows[0];
    return { listId: ev[0].list_id, actorId: ev[0].actor_id, added: addedIds.size, modified: modified.size, removed: removed.size, first: !earlier };
  }

  /**
   * After a validation was committed: one summary notification to the OTHER parents and administrators of the family.
   * Idempotent: the claim on push_events.validation_id makes a replayed or retried synchronisation send nothing more.
   */
  async notifyValidation(actor: AuthContext, validationId: string): Promise<void> {
    const sum = await this.summarize(actor.familyId, validationId);
    if (!sum) return;
    const msg = buildMessage(actor.displayName, sum);
    if (!msg) return;
    const claimed = await this.db.query(
      "INSERT INTO push_events (validation_id, family_id, list_id, actor_id, title, body) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING validation_id",
      [validationId, actor.familyId, sum.listId, actor.profileId, msg.title, msg.body],
    );
    if (!claimed.rows[0]) return;
    // Recipients: same family, parent or administrator, active, never the author (on any of their devices).
    const subs = (
      await this.db.query(
        `SELECT s.id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s JOIN profiles p ON p.id = s.profile_id
          WHERE s.family_id = $1 AND p.family_id = $1 AND p.active AND p.role IN ('parent','admin') AND s.profile_id <> $2`,
        [actor.familyId, actor.profileId],
      )
    ).rows as PushSubscriptionRow[];
    const payload: PushPayload = { v: 1, title: msg.title, body: msg.body, tag: validationId, listId: sum.listId, url: `/?open=${sum.listId}` };
    const body = JSON.stringify(payload);
    let delivered = 0;
    let failed = 0;
    await Promise.all(
      subs.map(async (s) => {
        const attempt = async () => this.send(s, body);
        let status = 0;
        try {
          status = (await attempt()).statusCode;
          if (status >= 500 || status === 429) status = (await attempt()).statusCode; // one more try for a passing server problem
        } catch {
          status = 0;
        }
        if (status >= 200 && status < 300) {
          delivered++;
          await this.db.query("UPDATE push_subscriptions SET last_success_at = now(), failures = 0 WHERE id = $1", [s.id]);
        } else if (status === 404 || status === 410) {
          failed++;
          await this.db.query("DELETE FROM push_subscriptions WHERE id = $1", [s.id]); // the phone no longer exists / was unsubscribed
        } else {
          failed++;
          await this.db.query("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1", [s.id]);
        }
      }),
    );
    await this.db.query("UPDATE push_events SET recipients = $2, delivered = $3, failed = $4 WHERE validation_id = $1", [validationId, subs.length, delivered, failed]);
  }
}
