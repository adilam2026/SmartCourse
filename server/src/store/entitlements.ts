import { createHash } from "node:crypto";
import type pg from "pg";
import { withTx, type Db } from "../db.js";
import { HttpError } from "../errors.js";
import type { SseHub } from "../hub.js";
import type { EntStatus, VerifiedPurchase } from "./types.js";

/**
 * Rattachement d'un achat VÉRIFIÉ à une famille, et mise à jour de son état (renouvellement, échéance, annulation,
 * remboursement, révocation). Règles :
 * - un achat (plateforme + clé d'achat) n'est JAMAIS rattaché à deux familles (contrainte unique, ligne verrouillée) ;
 * - l'achat doit porter le jeton store de la famille qui le présente (transmis au store au moment de l'achat) ;
 * - un remboursement ou une révocation est définitif : une nouvelle présentation par l'application ne rend pas l'accès
 *   (seule une annulation du remboursement par le store, ou l'opérateur, le peut) ;
 * - l'acheteur (profil) est tracé à la première présentation ; chaque changement est journalisé dans entitlement_events,
 *   les notifications du store étant reconnues par leur identifiant (une notification rejouée ne compte qu'une fois).
 */
type Q = Pick<pg.PoolClient, "query">;

export type EventSource = "client" | "google_notification" | "apple_notification" | "reconcile" | "operator";
const STICKY: EntStatus[] = ["refunded", "revoked"];

export interface AttachInput {
  /** Famille qui présente l'achat (application) ; absente pour une notification du store. */
  familyId?: string | null;
  profileId?: string | null;
  source: EventSource;
  /** Identifiant de la notification du store (rejeu ignoré). */
  eventKey?: string | null;
  type: string;
  /** Le store annule un remboursement : l'état vérifié remplace un remboursement antérieur. */
  reinstate?: boolean;
  /** Environnements de test admis pour cette famille (recette : oui ; production : non, sauf familles listées). */
  acceptSandbox: (familyId: string) => boolean;
}

export interface AttachResult {
  entitlementId: string | null;
  familyId: string | null;
  status: EntStatus | null;
  changed: boolean;
  duplicate?: boolean;
}

/** Empreinte courte d'une clé d'achat, pour les journaux et les refus (jamais la clé elle-même). */
export const keyHash = (k: string) => createHash("sha256").update(k).digest("hex").slice(0, 16);

export class PurchaseRefused extends HttpError {
  familyId: string | null = null;
}

function refuse(familyId: string | null, code: string, message: string, status = 409): never {
  const e = new PurchaseRefused(status, code, message);
  e.familyId = familyId;
  throw e;
}

export async function attachPurchase(db: Db, hub: SseHub | undefined, v: VerifiedPurchase, a: AttachInput): Promise<AttachResult> {
  // Deux présentations simultanées du MÊME achat (deux appareils, « Restaurer » pendant l'achat) : la seconde insertion se heurte
  // à la contrainte unique ; une nouvelle tentative trouve alors la ligne et la met à jour (ou refuse s'il s'agit d'une autre famille).
  for (let attempt = 0; ; attempt++) {
    try {
      return await attachOnce(db, hub, v, a);
    } catch (e) {
      if ((e as { code?: string }).code === "23505" && attempt < 2) continue;
      throw e;
    }
  }
}

async function attachOnce(db: Db, hub: SseHub | undefined, v: VerifiedPurchase, a: AttachInput): Promise<AttachResult> {
  let refusal: PurchaseRefused | null = null; // la transaction est annulée ; le refus est journalisé à part
  const r = await withTx(db, async (c) => {
    if (a.eventKey) {
      const seen = (await c.query("SELECT 1 FROM entitlement_events WHERE source = $1 AND event_key = $2", [a.source, a.eventKey])).rowCount;
      if (seen) return { entitlementId: null, familyId: null, status: null, changed: false, duplicate: true } satisfies AttachResult;
    }
    const existing = (
      await c.query("SELECT id, family_id, status, expires_at, auto_renewing FROM family_entitlements WHERE platform = $1 AND purchase_key = $2 FOR UPDATE", [v.platform, v.purchaseKey])
    ).rows[0] as { id: string; family_id: string; status: EntStatus; expires_at: Date | null; auto_renewing: boolean } | undefined;

    // Famille de l'achat : celle qui le présente (contrôlée par son jeton store) ; pour une notification, la famille déjà
    // rattachée, sinon celle dont le jeton store figure dans l'achat.
    let familyId = a.familyId ?? existing?.family_id ?? null;
    if (a.familyId) {
      const tok = (await c.query("SELECT store_account_token::text AS t FROM families WHERE id = $1", [a.familyId])).rows[0]?.t as string | undefined;
      if (existing && existing.family_id !== a.familyId)
        return refuse(a.familyId, "purchase_other_family", "Cet achat est déjà rattaché à une autre famille Mes Courses : il ne peut pas débloquer celle-ci.");
      if (!v.accountToken || v.accountToken !== tok)
        return refuse(a.familyId, "purchase_not_for_family", "Cet achat n'a pas été fait depuis cette famille Mes Courses : il ne peut pas la débloquer.");
    } else if (!familyId && v.accountToken) {
      familyId = ((await c.query("SELECT id FROM families WHERE store_account_token::text = $1", [v.accountToken])).rows[0]?.id as string | undefined) ?? null;
    }
    if (!familyId) {
      // Notification d'un achat que le serveur ne sait pas rattacher (fait hors de l'application, famille supprimée) : tracé seulement.
      await c.query("INSERT INTO entitlement_events (source, type, event_key, details) VALUES ($1, $2, $3, $4)", [
        a.source,
        `${a.type}:sans_famille`,
        a.eventKey ?? null,
        { platform: v.platform, productId: v.productId, key: keyHash(v.purchaseKey) },
      ]);
      return { entitlementId: null, familyId: null, status: null, changed: false } satisfies AttachResult;
    }
    if (v.familyShared) return refuse(familyId, "purchase_family_shared", "Achat partagé par le Partage familial Apple : l'administrateur de la famille Mes Courses doit faire l'achat lui-même.");
    if (v.environment === "sandbox" && !a.acceptSandbox(familyId)) return refuse(familyId, "purchase_sandbox", "Achat de test refusé sur ce serveur.", 403);

    let status = v.status;
    if (existing && STICKY.includes(existing.status) && !a.reinstate && !STICKY.includes(status)) status = existing.status;
    let id: string;
    let changed: boolean;
    if (existing) {
      id = existing.id;
      changed = existing.status !== status || (existing.expires_at?.getTime() ?? null) !== (v.expiresAt?.getTime() ?? null) || existing.auto_renewing !== v.autoRenewing;
      await c.query(
        `UPDATE family_entitlements SET status = $2, expires_at = $3, auto_renewing = $4, store_ref = coalesce($5, store_ref), verified_at = now(), updated_at = now(),
                buyer_profile_id = coalesce(buyer_profile_id, $6)
          WHERE id = $1`,
        [id, status, v.expiresAt, v.autoRenewing, v.storeRef, a.profileId ?? null],
      );
    } else {
      id = (
        await c.query(
          `INSERT INTO family_entitlements (family_id, platform, product_id, kind, purchase_key, buyer_profile_id, status, expires_at, auto_renewing, environment, store_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [familyId, v.platform, v.productId, v.kind, v.purchaseKey, a.profileId ?? null, status, v.expiresAt, v.autoRenewing, v.environment, v.storeRef],
        )
      ).rows[0].id as string;
      changed = true;
    }
    // Abonnement Google repris ou changé : l'ancien jeton est remplacé par celui-ci (même famille seulement).
    if (v.linkedKey && v.linkedKey !== v.purchaseKey) {
      const rep = await c.query(
        "UPDATE family_entitlements SET status = 'replaced', replaced_by = $3, auto_renewing = false, updated_at = now() WHERE platform = $1 AND purchase_key = $2 AND family_id = $4 AND status <> 'replaced'",
        [v.platform, v.linkedKey, id, familyId],
      );
      if (rep.rowCount) changed = true;
    }
    await c.query("INSERT INTO entitlement_events (entitlement_id, family_id, source, type, event_key, details) VALUES ($1,$2,$3,$4,$5,$6)", [
      id,
      familyId,
      a.source,
      a.type,
      a.eventKey ?? null,
      { status, expiresAt: v.expiresAt?.toISOString() ?? null, autoRenewing: v.autoRenewing, environment: v.environment, storeRef: v.storeRef },
    ]);
    return { entitlementId: id, familyId, status, changed } satisfies AttachResult;
  }).catch((e) => {
    if (e instanceof PurchaseRefused) {
      refusal = e;
      return null;
    }
    throw e;
  });
  if (refusal) {
    const f = refusal as PurchaseRefused;
    await db.query("INSERT INTO entitlement_events (family_id, source, type, details) VALUES ($1, 'refused', $2, $3)", [
      f.familyId ?? a.familyId ?? null,
      f.code,
      { platform: v.platform, productId: v.productId, key: keyHash(v.purchaseKey), environment: v.environment },
    ]);
    throw f;
  }
  if (r!.changed && r!.familyId) hub?.broadcast(r!.familyId, "plan.updated", { status: r!.status });
  return r!;
}

/** Forçage d'un état par une notification du store (remboursement, révocation) quand l'achat ne peut plus être interrogé. */
export async function forceStatus(
  db: Db,
  hub: SseHub | undefined,
  platform: "google" | "apple",
  purchaseKey: string,
  status: EntStatus,
  ev: { source: EventSource; type: string; eventKey?: string | null },
): Promise<boolean> {
  const r = await withTx(db, async (c) => {
    if (ev.eventKey && (await c.query("SELECT 1 FROM entitlement_events WHERE source = $1 AND event_key = $2", [ev.source, ev.eventKey])).rowCount) return null;
    const row = (await c.query("SELECT id, family_id, status FROM family_entitlements WHERE platform = $1 AND purchase_key = $2 FOR UPDATE", [platform, purchaseKey])).rows[0];
    if (!row) {
      await c.query("INSERT INTO entitlement_events (source, type, event_key, details) VALUES ($1,$2,$3,$4)", [ev.source, `${ev.type}:inconnu`, ev.eventKey ?? null, { platform, key: keyHash(purchaseKey) }]);
      return null;
    }
    await c.query("UPDATE family_entitlements SET status = $2, auto_renewing = false, updated_at = now() WHERE id = $1", [row.id, status]);
    await c.query("INSERT INTO entitlement_events (entitlement_id, family_id, source, type, event_key, details) VALUES ($1,$2,$3,$4,$5,$6)", [
      row.id,
      row.family_id,
      ev.source,
      ev.type,
      ev.eventKey ?? null,
      { from: row.status, status },
    ]);
    return row.status === status ? null : (row.family_id as string);
  });
  if (r) hub?.broadcast(r, "plan.updated", { status });
  return r != null;
}
