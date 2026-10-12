import { createHash } from "node:crypto";
import { withTx, type Db } from "./db.js";
import { generateInstallToken } from "./auth.js";
import { opaque } from "./price-community.js";
import { HttpError } from "./errors.js";
import type { PhotoStore } from "./photos.js";

/** Tables carrying family_id : counted for identification, deleted, and compared before/after for the OTHER families. */
const FAMILY_TABLES = ["profiles", "products", "lists", "list_items", "purchases", "validations", "list_events", "push_subscriptions", "push_events", "family_prices", "list_templates", "audit_log"] as const;

export interface FamilyIdentity {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  setupCompleted: boolean;
  profiles: { displayName: string; login: string; role: string; primary: boolean; active: boolean }[];
}

export interface PurgeCounts {
  profiles: number;
  sessions: number;
  pushSubscriptions: number;
  recoveryAddresses: number;
  recoveryTokens: number;
  emailLogs: number;
  lists: number;
  listItems: number;
  purchases: number;
  validations: number;
  listEvents: number;
  products: number;
  ownedPhotos: number;
  auditRows: number;
}

export async function findFamilyByCode(db: Db, code: string): Promise<FamilyIdentity | null> {
  const f = (await db.query("SELECT id, code, name, created_at, setup_completed_at FROM families WHERE code = $1", [code.trim().toUpperCase()])).rows[0];
  if (!f) return null;
  return identity(db, f);
}

export async function identifyFamily(db: Db, familyId: string): Promise<FamilyIdentity> {
  const f = (await db.query("SELECT id, code, name, created_at, setup_completed_at FROM families WHERE id = $1", [familyId])).rows[0];
  if (!f) throw new HttpError(404, "not_found", "Famille introuvable");
  return identity(db, f);
}

async function identity(db: Db, f: any): Promise<FamilyIdentity> {
  const p = (await db.query("SELECT display_name, login, role, is_primary, active FROM profiles WHERE family_id = $1 AND deleted_at IS NULL ORDER BY created_at, login", [f.id])).rows;
  return {
    id: f.id,
    code: f.code,
    name: f.name,
    createdAt: new Date(f.created_at).toISOString(),
    setupCompleted: !!f.setup_completed_at,
    profiles: p.map((r) => ({ displayName: r.display_name, login: r.login, role: r.role, primary: r.is_primary, active: r.active })),
  };
}

export async function countFamilyData(db: Db, familyId: string): Promise<PurgeCounts> {
  const one = async (sql: string) => Number((await db.query(sql, [familyId])).rows[0].n);
  const inFam = "profile_id IN (SELECT id FROM profiles WHERE family_id = $1)";
  return {
    profiles: await one("SELECT count(*) AS n FROM profiles WHERE family_id = $1 AND deleted_at IS NULL"),
    sessions: await one(`SELECT count(*) AS n FROM sessions WHERE ${inFam}`),
    pushSubscriptions: await one("SELECT count(*) AS n FROM push_subscriptions WHERE family_id = $1"),
    recoveryAddresses: await one("SELECT count(*) AS n FROM profiles WHERE family_id = $1 AND recovery_email IS NOT NULL"),
    recoveryTokens: await one(`SELECT count(*) AS n FROM auth_tokens WHERE ${inFam}`),
    emailLogs: await one(`SELECT count(*) AS n FROM email_log WHERE ${inFam}`),
    lists: await one("SELECT count(*) AS n FROM lists WHERE family_id = $1"),
    listItems: await one("SELECT count(*) AS n FROM list_items WHERE family_id = $1"),
    purchases: await one("SELECT count(*) AS n FROM purchases WHERE family_id = $1"),
    validations: await one("SELECT count(*) AS n FROM validations WHERE family_id = $1"),
    listEvents: await one("SELECT count(*) AS n FROM list_events WHERE family_id = $1"),
    products: await one("SELECT count(*) AS n FROM products WHERE family_id = $1"),
    ownedPhotos: await one("SELECT count(*) AS n FROM photo_assets WHERE owner_family_id = $1"),
    auditRows: await one("SELECT count(*) AS n FROM audit_log WHERE family_id = $1"),
  };
}

export interface PurgeReport {
  family: { code: string; name: string };
  deleted: PurgeCounts;
  photoFilesRemoved: number;
  otherFamiliesUntouched: number;
  /** Nouveau jeton d'installation, à usage unique (affiché une seule fois). */
  installToken: string;
  profileIds: string[];
}

const snapshot = async (c: { query: Db["query"] }, familyId: string) => {
  const out: Record<string, number> = {};
  const mine = "(SELECT id FROM profiles WHERE family_id = $1)";
  for (const t of FAMILY_TABLES) {
    const where = t === "audit_log" ? `NOT (coalesce(family_id = $1, false) OR coalesce(actor_profile_id IN ${mine}, false) OR coalesce(target_profile_id IN ${mine}, false))` : "family_id IS DISTINCT FROM $1";
    out[t] = Number((await c.query(`SELECT count(*) AS n FROM ${t} WHERE ${where}`, [familyId])).rows[0].n);
  }
  out.families = Number((await c.query("SELECT count(*) AS n FROM families WHERE id <> $1", [familyId])).rows[0].n);
  out.sessions = Number((await c.query("SELECT count(*) AS n FROM sessions WHERE profile_id NOT IN (SELECT id FROM profiles WHERE family_id = $1)", [familyId])).rows[0].n);
  out.photoAssets = Number((await c.query("SELECT count(*) AS n FROM photo_assets WHERE owner_family_id IS DISTINCT FROM $1", [familyId])).rows[0].n);
  out.auth_tokens = Number((await c.query("SELECT count(*) AS n FROM auth_tokens WHERE profile_id NOT IN (SELECT id FROM profiles WHERE family_id = $1)", [familyId])).rows[0].n);
  return out;
};

/**
 * Definitive deletion of ONE family and everything that belongs to it. Nothing else is touched: the shared catalogue, its pictures,
 * the migrations and every other family stay exactly as they are (checked before the transaction commits: any difference rolls
 * everything back). The family is identified by its id AND must be confirmed by its code.
 * Returns a new single-use installation token (the consumed one never works again).
 */
export async function purgeFamily(db: Db, store: PhotoStore, familyId: string, expectedCode: string): Promise<PurgeReport> {
  const fam = await identifyFamily(db, familyId);
  if (fam.code !== expectedCode.trim().toUpperCase()) throw new HttpError(400, "code_mismatch", "Le code famille saisi ne correspond pas");
  const deleted = await countFamilyData(db, familyId);
  const profileIds = (await db.query("SELECT id FROM profiles WHERE family_id = $1", [familyId])).rows.map((r) => r.id as string);

  const keys = await withTx(db, async (c) => {
    await c.query("SELECT 1 FROM families WHERE id = $1 FOR UPDATE", [familyId]);
    await c.query("SET LOCAL app.family_purge = 'on'"); // la seule porte à travers l'immutabilité des archives
    await c.query("SET LOCAL app.photo_purge = 'on'");
    const others = await snapshot(c, familyId);
    const mine = "(SELECT id FROM profiles WHERE family_id = $1)";
    const steps: string[] = [
      "DELETE FROM push_events WHERE family_id = $1",
      "DELETE FROM push_subscriptions WHERE family_id = $1",
      "DELETE FROM list_events WHERE family_id = $1",
      "DELETE FROM purchases WHERE family_id = $1",
      "DELETE FROM validations WHERE family_id = $1",
      `DELETE FROM op_log WHERE profile_id IN ${mine}`,
      "DELETE FROM list_items WHERE family_id = $1",
      "DELETE FROM lists WHERE family_id = $1",
      "DELETE FROM list_template_items WHERE template_id IN (SELECT id FROM list_templates WHERE family_id = $1)",
      "DELETE FROM list_templates WHERE family_id = $1",
      "DELETE FROM family_prices WHERE family_id = $1",
      "DELETE FROM products WHERE family_id = $1",
      `DELETE FROM sessions WHERE profile_id IN ${mine}`,
      `DELETE FROM auth_tokens WHERE profile_id IN ${mine}`,
      `DELETE FROM email_log WHERE profile_id IN ${mine}`,
      `DELETE FROM audit_log WHERE family_id = $1 OR actor_profile_id IN ${mine} OR target_profile_id IN ${mine}`,
    ];
    for (const s of steps) await c.query(s, [familyId]);
    // Prix partagés à la communauté par cette famille (empreinte opaque, jamais son identité) : retirés avec elle.
    await c.query("DELETE FROM price_reports WHERE reporter = $1", [opaque(familyId)]);
    await c.query("DELETE FROM price_contributions WHERE contributor = $1", [opaque(familyId)]);
    // Pictures that belong to this family (never a shared catalogue picture): every reference to them is gone by now.
    const photos = (await c.query("DELETE FROM photo_assets WHERE owner_family_id = $1 RETURNING storage_key", [familyId])).rows.map((r) => r.storage_key as string);
    await c.query("UPDATE install_tokens SET family_id = NULL WHERE family_id = $1", [familyId]); // the consumed token stays consumed
    await c.query("DELETE FROM profiles WHERE family_id = $1", [familyId]);
    await c.query("DELETE FROM families WHERE id = $1", [familyId]);
    // Verification before commit: nothing of this family is left, nothing of any other family has changed.
    const left = (await c.query("SELECT (SELECT count(*) FROM profiles WHERE family_id = $1) + (SELECT count(*) FROM products WHERE family_id = $1) + (SELECT count(*) FROM lists WHERE family_id = $1) + (SELECT count(*) FROM photo_assets WHERE owner_family_id = $1) AS n", [familyId])).rows[0].n;
    if (Number(left) !== 0) throw new Error("suppression incomplète : annulée");
    const after = await snapshot(c, familyId);
    for (const [k, v] of Object.entries(others)) if (after[k] !== v) throw new Error(`une autre famille aurait été touchée (${k}) : suppression annulée`);
    // Trace d'exploitation sans donnée personnelle : empreinte du code, volumes supprimés.
    await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action, details) VALUES (NULL, NULL, 'family.purged', $1)", [
      JSON.stringify({ codeHash: createHash("sha256").update(fam.code).digest("hex"), deleted }),
    ]);
    return { photos, others: others.families ?? 0 };
  });

  // Picture files: only those no remaining asset still uses (content-addressed keys can be shared).
  let removed = 0;
  for (const key of new Set(keys.photos)) {
    if ((await db.query("SELECT 1 FROM photo_assets WHERE storage_key = $1 LIMIT 1", [key])).rowCount) continue;
    if ((await store.delete(key)) > 0) removed++;
  }
  const installToken = await generateInstallToken(db);
  return { family: { code: fam.code, name: fam.name }, deleted, photoFilesRemoved: removed, otherFamiliesUntouched: keys.others, installToken, profileIds };
}
