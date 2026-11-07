import type pg from "pg";
import type { Db } from "./db.js";

/**
 * Achats ouverts par plateforme (Android, iPhone), et appareils utilisés par chaque profil.
 *
 * - Chaque requête de l'application porte « X-Courses-Client: android/1250 » (ou « ios/12 ») : plateforme et numéro technique de
 *   version. Le serveur retient, par profil et par plateforme, la dernière version vue.
 * - Un appareil « permet d'acheter » si sa plateforme est ouverte (admin-cli purchases-open) et si sa version est au moins la
 *   première version qui sait acheter (min_version).
 * - Une famille n'est bloquée par la règle des listes gratuites que si au moins un de ses administrateurs a un tel appareil.
 */
type Q = Pick<pg.PoolClient, "query">;
export type Platform = "android" | "ios";
export interface ClientInfo {
  platform: Platform;
  version: number;
}

export function parseClient(h: unknown): ClientInfo | null {
  const m = typeof h === "string" ? /^(android|ios)\/(\d{1,9})$/.exec(h.trim()) : null;
  return m ? { platform: m[1] as Platform, version: Number(m[2]) } : null;
}

/** Retient l'appareil du profil (écriture seulement si la version change ou au plus une fois par heure). */
export async function recordClient(q: Q, profileId: string, c: ClientInfo): Promise<void> {
  await q.query(
    `INSERT INTO profile_clients (profile_id, platform, version) VALUES ($1, $2, $3)
     ON CONFLICT (profile_id, platform) DO UPDATE SET version = EXCLUDED.version, seen_at = now()
       WHERE profile_clients.version <> EXCLUDED.version OR profile_clients.seen_at < now() - interval '1 hour'`,
    [profileId, c.platform, c.version],
  );
}

export interface PlatformState {
  enabled: boolean;
  minVersion: number | null;
}

export async function platformStates(q: Q): Promise<Record<Platform, PlatformState>> {
  const out: Record<Platform, PlatformState> = { android: { enabled: false, minVersion: null }, ios: { enabled: false, minVersion: null } };
  for (const r of (await q.query("SELECT platform, enabled, min_version FROM purchase_platforms")).rows) out[r.platform as Platform] = { enabled: r.enabled, minVersion: r.min_version };
  return out;
}

/** Au moins un administrateur actif de la famille a un appareil qui permet d'acheter. */
export async function familyCanPurchase(q: Q, familyId: string): Promise<boolean> {
  return (
    await q.query(
      `SELECT EXISTS (
         SELECT 1 FROM profiles p
           JOIN profile_clients c ON c.profile_id = p.id
           JOIN purchase_platforms pp ON pp.platform = c.platform
          WHERE p.family_id = $1 AND p.role = 'admin' AND p.active AND p.deleted_at IS NULL
            AND pp.enabled AND c.version >= pp.min_version) AS ok`,
      [familyId],
    )
  ).rows[0].ok as boolean;
}

export type PurchaseHereReason = "ok" | "not_admin" | "unknown_client" | "platform_closed" | "update_required";

/** Cet appareil (cette requête) permet-il à cette personne d'acheter ? Avec la raison, pour un message clair. */
export async function purchaseHere(q: Q, role: string, client: ClientInfo | null): Promise<{ available: boolean; reason: PurchaseHereReason; platform: Platform | null }> {
  const platform = client?.platform ?? null;
  if (role !== "admin") return { available: false, reason: "not_admin", platform };
  if (!client) return { available: false, reason: "unknown_client", platform };
  const s = (await platformStates(q))[client.platform];
  if (!s.enabled) return { available: false, reason: "platform_closed", platform };
  if (s.minVersion !== null && client.version < s.minVersion) return { available: false, reason: "update_required", platform };
  return { available: true, reason: "ok", platform };
}

export async function setPlatform(db: Db, platform: Platform, enabled: boolean, minVersion: number | null, note?: string): Promise<void> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO purchase_platforms (platform, enabled, min_version) VALUES ($1, $2, $3)
       ON CONFLICT (platform) DO UPDATE SET enabled = $2, min_version = coalesce($3, purchase_platforms.min_version), updated_at = now()`,
      [platform, enabled, minVersion],
    );
    const r = (await c.query("SELECT min_version FROM purchase_platforms WHERE platform = $1", [platform])).rows[0];
    await c.query("INSERT INTO purchase_platforms_history (platform, enabled, min_version, note) VALUES ($1,$2,$3,$4)", [platform, enabled, r?.min_version ?? null, note ?? null]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
