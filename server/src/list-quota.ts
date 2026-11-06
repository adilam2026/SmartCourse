import type pg from "pg";
import type { Db } from "./db.js";

/**
 * Créations de listes gratuites par famille, puis droit payant (abonnement annuel ou achat à vie) partagé par toute la famille.
 *
 * - Compteur PERMANENT, au niveau de la famille, tenu par le serveur : il démarre à l'activation de la règle pour la famille
 *   (families.list_quota_since), augmente à chaque création effective de liste (même vide, même sous un droit payant) et ne baisse
 *   jamais (suppression, archivage : aucun crédit rendu).
 * - Contrôle dans la transaction de création, famille verrouillée : deux appareils qui créent en même temps sont servis l'un après
 *   l'autre ; une requête rejouée (même lot de demandes, même requestId) retrouve la création déjà faite, sans compter deux fois.
 * - Blocage seulement si la règle est active (interrupteur global ET famille démarrée), sans droit payant actif, compteur atteint.
 *   Seule la CRÉATION d'une nouvelle liste est refusée : la liste en cours, l'historique et toutes les données restent utilisables.
 */
type Q = Pick<pg.PoolClient, "query">;

export const QUOTA_CODE = "quota_reached";
export const MSG_EXPLICIT =
  "Les listes gratuites de la famille sont utilisées. Un administrateur peut débloquer Mes Courses pour toute la famille (abonnement annuel ou achat à vie) depuis l'application.";
export const MSG_IMPLICIT =
  "Les listes gratuites de la famille sont utilisées : votre demande est gardée sur le téléphone. Demandez à un administrateur de la famille de débloquer Mes Courses.";

export interface Entitlement {
  kind: "annual" | "lifetime";
  status: string;
  platform: "google" | "apple";
  expiresAt: string | null;
  autoRenewing: boolean;
}
export interface QuotaState {
  /** Règle appliquée à cette famille (interrupteur global allumé et famille démarrée). */
  quotaActive: boolean;
  freeLimit: number;
  used: number;
  freeRemaining: number;
  entitlement: Entitlement | null;
  /** Nouvelle création refusée. */
  blocked: boolean;
}

/** Droit payant en vigueur : achat à vie actif, ou abonnement dont la période payée n'est pas finie (annulé compris jusqu'à son terme). */
export async function activeEntitlement(q: Q, familyId: string): Promise<Entitlement | null> {
  const r = (
    await q.query(
      `SELECT kind, status, platform, expires_at, auto_renewing FROM family_entitlements
        WHERE family_id = $1
          AND ((kind = 'lifetime' AND status = 'active')
            OR (kind = 'annual' AND status IN ('active', 'grace', 'cancelled') AND expires_at > now()))
        ORDER BY (kind = 'lifetime') DESC, expires_at DESC NULLS FIRST LIMIT 1`,
      [familyId],
    )
  ).rows[0];
  if (!r) return null;
  return { kind: r.kind, status: r.status, platform: r.platform, expiresAt: r.expires_at ? (r.expires_at as Date).toISOString() : null, autoRenewing: r.auto_renewing };
}

async function settings(q: Q): Promise<{ enabled: boolean; freeLists: number }> {
  const s = (await q.query("SELECT enabled, free_lists FROM list_quota_settings WHERE id")).rows[0];
  return { enabled: Boolean(s?.enabled), freeLists: Number(s?.free_lists ?? 10) };
}

function state(s: { enabled: boolean; freeLists: number }, since: unknown, used: number, ent: Entitlement | null): QuotaState {
  const quotaActive = s.enabled && since != null;
  return {
    quotaActive,
    freeLimit: s.freeLists,
    used,
    freeRemaining: Math.max(0, s.freeLists - used),
    entitlement: ent,
    blocked: quotaActive && !ent && used >= s.freeLists,
  };
}

export async function quotaState(q: Q, familyId: string): Promise<QuotaState> {
  const f = (await q.query("SELECT list_quota_since, list_creations_used FROM families WHERE id = $1", [familyId])).rows[0];
  return state(await settings(q), f?.list_quota_since, Number(f?.list_creations_used ?? 0), await activeEntitlement(q, familyId));
}

export interface CreationCheck {
  /** Requête déjà traitée : la liste qu'elle avait créée (null si supprimée depuis). */
  replayOf?: string | null;
  state: QuotaState;
  counted: boolean;
}

/** À appeler DANS la transaction de création : verrouille la famille, reconnaît une requête rejouée, évalue la règle. */
export async function checkCreation(c: Q, familyId: string, requestKey?: string | null): Promise<CreationCheck> {
  const f = (await c.query("SELECT list_quota_since, list_creations_used FROM families WHERE id = $1 FOR UPDATE", [familyId])).rows[0];
  const st = state(await settings(c), f?.list_quota_since, Number(f?.list_creations_used ?? 0), await activeEntitlement(c, familyId));
  if (requestKey) {
    const prev = (await c.query("SELECT list_id FROM list_creations WHERE family_id = $1 AND request_key = $2", [familyId, requestKey])).rows[0];
    if (prev) return { replayOf: (prev.list_id as string | null) ?? null, state: st, counted: false };
  }
  return { state: st, counted: f?.list_quota_since != null };
}

/** Enregistre la création effective (même transaction) et augmente le compteur si la règle a démarré pour la famille. */
export async function recordCreation(
  c: Q,
  a: { familyId: string; profileId: string },
  listId: string,
  kind: "explicit" | "implicit",
  requestKey: string | null | undefined,
  check: CreationCheck,
): Promise<void> {
  await c.query(
    "INSERT INTO list_creations (family_id, list_id, created_by, request_key, kind, counted, entitled) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [a.familyId, listId, a.profileId, requestKey ?? null, kind, check.counted, check.state.entitlement != null],
  );
  if (check.counted) await c.query("UPDATE families SET list_creations_used = list_creations_used + 1 WHERE id = $1", [a.familyId]);
}

/* ───── Activation et retour arrière (commande d'administration, journalisés) ───── */

export async function quotaStatus(db: Db) {
  const s = (await db.query("SELECT enabled, free_lists, activated_at FROM list_quota_settings WHERE id")).rows[0] ?? { enabled: false, free_lists: 10, activated_at: null };
  const f = (
    await db.query(
      `SELECT count(*)::int AS families, count(list_quota_since)::int AS started,
              count(*) FILTER (WHERE list_quota_since IS NOT NULL AND list_creations_used >= $1)::int AS at_limit
         FROM families`,
      [s.free_lists],
    )
  ).rows[0];
  const e = (await db.query("SELECT count(DISTINCT family_id)::int AS n FROM family_entitlements WHERE status IN ('active','grace','cancelled')")).rows[0];
  return { enabled: s.enabled as boolean, freeLists: s.free_lists as number, activatedAt: s.activated_at, ...f, familiesWithEntitlement: e.n as number };
}

/** Active la règle : chaque famille non encore démarrée reçoit ses dix créations gratuites MAINTENANT (anciennes listes non comptées). */
export async function quotaActivate(db: Db, note?: string): Promise<{ familiesStarted: number }> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO list_quota_settings (id, enabled, activated_at) VALUES (true, true, now())
       ON CONFLICT (id) DO UPDATE SET enabled = true, activated_at = coalesce(list_quota_settings.activated_at, now()), updated_at = now()`,
    );
    const r = await c.query("UPDATE families SET list_quota_since = now(), list_creations_used = 0 WHERE list_quota_since IS NULL");
    await c.query("INSERT INTO list_quota_history (enabled, families_started, note) VALUES (true, $1, $2)", [r.rowCount ?? 0, note ?? null]);
    await c.query("COMMIT");
    return { familiesStarted: r.rowCount ?? 0 };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Retour arrière : plus aucun blocage ; compteurs et droits conservés (une réactivation reprend les mêmes compteurs). */
export async function quotaDeactivate(db: Db, note?: string): Promise<void> {
  await db.query("INSERT INTO list_quota_settings (id, enabled) VALUES (true, false) ON CONFLICT (id) DO UPDATE SET enabled = false, updated_at = now()");
  await db.query("INSERT INTO list_quota_history (enabled, families_started, note) VALUES (false, 0, $1)", [note ?? null]);
}
