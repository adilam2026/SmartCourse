import { createHash } from "node:crypto";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "./auth.js";
import { withTx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import { COOKIE, type Guard } from "./guard.js";
import type { SseHub } from "./hub.js";

/**
 * Identifiant famille de connexion (ex. LesTaha04) : choisi par l'administrateur, unique, insensible à la casse.
 * Tout ce qui désigne une famille à la connexion partage un seul espace de noms (table family_aliases) : le code famille
 * d'origine, l'identifiant actuel et les anciens identifiants. Rien n'y est jamais réattribué à une autre famille.
 */
export const FAMILY_ID_PATTERN = /^[A-Za-z0-9_]{4,30}$/;
export const FAMILY_ID_RULE = "Lettres sans accents, chiffres et « _ », de 4 à 30 caractères";
export const TAKEN_MESSAGE = "Cet identifiant famille est déjà utilisé";

export const aliasKey = (name: string): Buffer => createHash("sha256").update(name.trim().toLowerCase()).digest();

/** Proposition à partir du nom affiché : accents retirés, mots collés avec une majuscule (« Famille Hélène » → « FamilleHelene »). */
export function proposeFromName(name: string): string {
  const words = name.normalize("NFD").replace(/\p{M}/gu, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  let id = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  if (id.length < 4) id = `Famille${id}`;
  return id.slice(0, 30);
}

type Q = Pick<pg.PoolClient, "query">;

/** Famille désignée par un nom de connexion (identifiant actuel, ancien identifiant ou code famille), ou null. */
export async function familyIdFor(q: Q, name: string): Promise<string | null> {
  const r = await q.query("SELECT family_id FROM family_aliases WHERE alias_hash = $1", [aliasKey(name)]);
  return (r.rows[0]?.family_id as string | undefined) ?? null;
}

/** Libre pour cette famille : jamais utilisé, ou déjà à elle (son identifiant actuel ou un ancien, sauf son code d'origine). */
async function availableFor(q: Q, name: string, familyId: string | null): Promise<boolean> {
  const r = (await q.query("SELECT family_id, kind FROM family_aliases WHERE alias_hash = $1", [aliasKey(name)])).rows[0];
  return !r || (!!familyId && r.family_id === familyId && r.kind !== "code");
}

/** Trois variantes disponibles, construites à partir de ce qui a été saisi (ou du nom de la famille). */
export async function suggestions(q: Q, wanted: string, familyId: string | null): Promise<string[]> {
  const base = (FAMILY_ID_PATTERN.test(wanted) ? wanted : proposeFromName(wanted)).replace(/_+$/, "").slice(0, 24);
  const year = new Date().getFullYear();
  const rnd = (n: number) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");
  const candidates = [`${base}${rnd(2)}`, `${base}_${year}`, /^famille/i.test(base) ? `${base}_${rnd(3)}` : `Famille_${base}`.slice(0, 30)];
  for (let i = 0; i < 6; i++) candidates.push(`${base}${rnd(i < 3 ? 2 : 3)}`);
  const out: string[] = [];
  for (const c of [...new Set(candidates)]) {
    if (out.length >= 3) break;
    if (FAMILY_ID_PATTERN.test(c) && !out.some((o) => o.toLowerCase() === c.toLowerCase()) && (await availableFor(q, c, familyId))) out.push(c);
  }
  return out;
}

export class FamilyIdTaken extends HttpError {
  constructor(public suggestions: string[]) {
    super(409, "family_id_taken", TAKEN_MESSAGE);
  }
}

export function checkFormat(name: string): string {
  const v = name.trim();
  if (!FAMILY_ID_PATTERN.test(v)) throw new HttpError(400, "invalid_family_id", FAMILY_ID_RULE);
  return v;
}

/** Contrôle de disponibilité (création, réglages) : ne dit que « libre ou non », jamais à qui il appartient. */
export async function checkAvailability(q: Q, name: string, familyId: string | null): Promise<{ valid: boolean; available: boolean; suggestions: string[]; message?: string }> {
  const v = name.trim();
  if (!FAMILY_ID_PATTERN.test(v)) return { valid: false, available: false, suggestions: [], message: FAMILY_ID_RULE };
  if (await availableFor(q, v, familyId)) return { valid: true, available: true, suggestions: [] };
  return { valid: true, available: false, suggestions: await suggestions(q, v, familyId), message: TAKEN_MESSAGE };
}

/** Réserve le code famille d'une nouvelle famille dans l'espace de noms (false : déjà pris, en tirer un autre). */
export async function reserveCode(c: pg.PoolClient, code: string): Promise<boolean> {
  return !!(await c.query("INSERT INTO family_aliases (alias_hash, alias, kind) VALUES ($1, $2, 'code') ON CONFLICT (alias_hash) DO NOTHING RETURNING 1", [aliasKey(code), code])).rowCount;
}

/** Rattrapage idempotent (démarrage) : tout code famille sans alias est réservé. Une collision avec un identifiant existant est ignorée (la famille garde son code). */
export async function reserveExistingCodes(db: Db): Promise<number> {
  const r = await db.query(
    `INSERT INTO family_aliases (alias_hash, alias, family_id, kind)
     SELECT sha256(convert_to(lower(f.code), 'UTF8')), f.code, f.id, 'code' FROM families f
      WHERE NOT EXISTS (SELECT 1 FROM family_aliases a WHERE a.family_id = f.id AND a.kind = 'code')
     ON CONFLICT (alias_hash) DO NOTHING`,
  );
  return r.rowCount ?? 0;
}

export async function currentFamilyId(q: Q, familyId: string): Promise<string | null> {
  return ((await q.query("SELECT alias FROM family_aliases WHERE family_id = $1 AND kind = 'current'", [familyId])).rows[0]?.alias as string | undefined) ?? null;
}

/**
 * Choisit (ou change) l'identifiant de la famille, dans la transaction de l'appelant, famille verrouillée.
 * L'identifiant remplacé reste un alias permanent de la famille. Deux familles qui demandent le même nom en même temps :
 * la clé primaire n'en laisse passer qu'une, l'autre reçoit 409 avec des propositions.
 */
export async function assignFamilyId(c: pg.PoolClient, familyId: string, wanted: string, by: string | null): Promise<{ loginId: string; previous: string | null }> {
  const name = checkFormat(wanted);
  const key = aliasKey(name);
  const previous = await currentFamilyId(c, familyId);
  const existing = (await c.query("SELECT family_id, kind FROM family_aliases WHERE alias_hash = $1 FOR UPDATE", [key])).rows[0];
  if (existing && (existing.family_id !== familyId || existing.kind === "code")) throw new FamilyIdTaken(await suggestions(c, name, familyId));
  if (existing?.kind === "current") {
    // Même identifiant (changement de majuscules seulement) : seule la forme affichée change.
    await c.query("UPDATE family_aliases SET alias = $2 WHERE alias_hash = $1", [key, name]);
    return { loginId: name, previous };
  }
  await c.query("UPDATE family_aliases SET kind = 'former' WHERE family_id = $1 AND kind = 'current'", [familyId]);
  if (existing) {
    await c.query("UPDATE family_aliases SET kind = 'current', alias = $2 WHERE alias_hash = $1", [key, name]); // un ancien identifiant redevient l'actuel
  } else {
    const ins = await c.query("INSERT INTO family_aliases (alias_hash, alias, family_id, kind, created_by) VALUES ($1, $2, $3, 'current', $4) ON CONFLICT (alias_hash) DO NOTHING RETURNING 1", [key, name, familyId, by]);
    if (!ins.rowCount) throw new FamilyIdTaken(await suggestions(c, name, familyId));
  }
  return { loginId: name, previous };
}

export function familyIdRoutes(app: FastifyInstance, deps: { db: Db; guard: Guard; hub: SseHub; checkLimit: { max: number; timeWindow: string } }): void {
  const { db, guard, hub } = deps;

  // Disponibilité : sans session (création de famille) ou avec (réglages : les identifiants de sa propre famille restent libres pour elle).
  app.post("/api/family-id/check", { config: { rateLimit: deps.checkLimit } }, async (req) => {
    const { id } = z.object({ id: z.string().max(60) }).parse(req.body ?? {});
    const auth = await authenticate(db, req.cookies[COOKIE]).catch(() => null);
    const own = auth && !auth.mustChangeSecret && auth.role === "admin" ? auth.familyId : null;
    return checkAvailability(db, id, own);
  });

  app.get("/api/family/login-id", { preHandler: guard("family.manage") }, async (req) => {
    const f = (await db.query("SELECT code, name FROM families WHERE id = $1", [req.auth!.familyId])).rows[0];
    return { loginId: await currentFamilyId(db, req.auth!.familyId), code: f.code, name: f.name, proposal: proposeFromName(f.name) };
  });

  app.put("/api/family/login-id", { preHandler: guard("family.manage"), config: { rateLimit: deps.checkLimit } }, async (req) => {
    const { loginId } = z.object({ loginId: z.string().max(60) }).parse(req.body ?? {});
    const a = req.auth!;
    const r = await withTx(db, async (c) => {
      await c.query("SELECT 1 FROM families WHERE id = $1 FOR UPDATE", [a.familyId]);
      const out = await assignFamilyId(c, a.familyId, loginId, a.profileId);
      if (out.previous !== out.loginId)
        await c.query("INSERT INTO audit_log (family_id, actor_profile_id, action, details) VALUES ($1, $2, 'family.login_id_set', $3)", [a.familyId, a.profileId, JSON.stringify({ from: out.previous, to: out.loginId })]);
      return out;
    });
    hub.broadcast(a.familyId, "prefs.updated", {});
    return { loginId: r.loginId };
  });
}
