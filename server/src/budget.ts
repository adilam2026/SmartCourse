import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { AuthContext } from "./auth.js";
import { COUNTRIES } from "./countries.js";
import { withTx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import type { SseHub } from "./hub.js";

/*
 * Module Budget (option familiale « Gestion du budget », désactivée par défaut).
 * - Montants : entiers en unités mineures de la devise (centimes…), jamais de nombres flottants.
 * - Une dépense a UNE catégorie, donc consomme au plus UN budget mensuel. Définir un budget n'est jamais une dépense.
 * - Mon compte : solde = solde initial (argent disponible au DÉBUT de la date de référence) + entrées − dépenses datées de cette
 *   date ou après. Les opérations antérieures restent dans l'historique sans être retirées une seconde fois.
 * - Chaque saisie porte un identifiant (requestId) : une relance réseau rend l'opération déjà créée, jamais un doublon.
 * - Corrections : la même opération est modifiée (rev), chaque état est conservé ; une annulation est explicite et tracée.
 * - Droits financiers distincts, vérifiés ICI (pas seulement dans l'application) ; rien n'est exposé à /gestion.
 */

export interface FinanceRights { manage: boolean; view: boolean; record: boolean; edit: boolean }
const NONE: FinanceRights = { manage: false, view: false, record: false, edit: false };
const ALL: FinanceRights = { manage: true, view: true, record: true, edit: true };

export const DEFAULT_MERCHANTS = ["BIM", "Carrefour", "Marjane", "Primeur", "Boucherie"];
const SYSTEM_CATEGORIES: { key: string; name: string; position: number }[] = [
  { key: "courses", name: "Courses", position: 1 },
  { key: "transport", name: "Transport", position: 2 },
  { key: "maison", name: "Maison", position: 3 },
  { key: "autres", name: "Autres", position: 99 },
];

/** Devises proposées (celles des pays proposés), avec leurs décimales. */
export const CURRENCIES: Record<string, number> = Object.fromEntries(COUNTRIES.map((c) => [c.currency, c.decimals]));

// ---- montants et dates -----------------------------------------------------------------------------------------------

/** « 1 234,50 », « 1234.5 », « 900 » → unités mineures entières. Refuse plus de décimales que la devise n'en a. */
export function parseAmount(input: string | number, decimals: number): number {
  const s = String(input).replace(/[\s  ]/g, "").replace(",", ".");
  const m = /^(\d{1,12})(?:\.(\d*))?$/.exec(s);
  if (!m) throw new HttpError(400, "invalid_amount", "Montant invalide");
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > decimals) throw new HttpError(400, "invalid_amount", decimals === 0 ? "Montant sans décimales pour cette devise" : `Montant : ${decimals} décimale${decimals > 1 ? "s" : ""} au plus`);
  const minor = Number(m[1]) * 10 ** decimals + Number(frac.padEnd(decimals, "0") || "0");
  if (!Number.isSafeInteger(minor) || minor >= 1e12) throw new HttpError(400, "invalid_amount", "Montant trop élevé");
  return minor;
}

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d && d >= "2000-01-01" && d <= "2100-12-31";
}, "Date invalide");
const monthField = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const amountField = z.union([z.string().max(20), z.number().nonnegative()]);
const nameField = z.string().trim().min(1).max(40);
const firstOfMonth = (m: string) => `${m}-01`;
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};
const iso = (d: unknown) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : String(d));
/** Lundi de la semaine d'une date AAAA-MM-JJ. */
function mondayOf(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

// ---- état et droits ----------------------------------------------------------------------------------------------------

type Q = Pick<Db, "query"> | pg.PoolClient;

export async function financeRights(db: Q, a: AuthContext): Promise<FinanceRights> {
  if (a.role === "admin") return ALL;
  const r = (await db.query("SELECT can_manage, can_view, can_record, can_edit FROM finance_rights WHERE profile_id = $1 AND family_id = $2", [a.profileId, a.familyId])).rows[0];
  if (!r) return NONE;
  // Le personnel ne peut recevoir que la saisie des paiements de courses (jamais le solde, les entrées ni les autres dépenses).
  if (a.role === "staff") return { ...NONE, record: !!r.can_record };
  return { manage: !!r.can_manage, view: !!r.can_view || !!r.can_manage, record: !!r.can_record, edit: !!r.can_edit };
}

interface Settings { currency: string; decimals: number; budgetsEnabled: boolean; accountEnabled: boolean }

async function settingsOf(db: Q, familyId: string): Promise<(Settings & { enabled: boolean }) | null> {
  const r = (await db.query(
    `SELECT f.budget_enabled, s.currency, s.decimals, s.budgets_enabled, s.account_enabled
       FROM families f LEFT JOIN finance_settings s ON s.family_id = f.id WHERE f.id = $1`,
    [familyId],
  )).rows[0];
  if (!r?.currency) return null;
  return { enabled: !!r.budget_enabled, currency: r.currency, decimals: Number(r.decimals), budgetsEnabled: !!r.budgets_enabled, accountEnabled: !!r.account_enabled };
}

/** Module actif et droit demandé, sinon refus serveur. */
async function need(db: Q, a: AuthContext, test: (r: FinanceRights) => boolean): Promise<{ s: Settings; rights: FinanceRights }> {
  const s = await settingsOf(db, a.familyId);
  if (!s?.enabled) throw new HttpError(409, "budget_disabled", "La gestion du budget n'est pas activée pour cette famille");
  const rights = await financeRights(db, a);
  if (!test(rights)) throw new HttpError(403, "finance_forbidden", "Accès au budget non autorisé pour ce profil");
  return { s, rights };
}

const frozen = async (db: Q, familyId: string) => (await db.query("SELECT 1 FROM finance_operations WHERE family_id = $1 LIMIT 1", [familyId])).rowCount! > 0;

/** Activation / désactivation de l'option (Paramètres avancés). La première activation exige la devise confirmée. */
export async function setBudgetEnabled(c: pg.PoolClient, a: AuthContext, on: boolean, currency?: string): Promise<void> {
  if (on) {
    const cur = (await c.query("SELECT currency FROM finance_settings WHERE family_id = $1", [a.familyId])).rows[0];
    if (!cur) {
      if (!currency) throw new HttpError(400, "currency_required", "Confirmez la devise du budget");
      if (!(currency in CURRENCIES)) throw new HttpError(400, "invalid_currency", "Devise non proposée");
      await c.query("INSERT INTO finance_settings (family_id, currency, decimals, updated_by) VALUES ($1,$2,$3,$4)", [a.familyId, currency, CURRENCIES[currency], a.profileId]);
    } else if (currency && currency !== cur.currency) {
      await changeCurrency(c, a, currency);
    }
    for (const k of SYSTEM_CATEGORIES)
      await c.query(
        `INSERT INTO finance_categories (family_id, system_key, name, position, created_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [a.familyId, k.key, k.name, k.position, a.profileId],
      );
  }
  await c.query("UPDATE families SET budget_enabled = $2, features_updated_at = now(), features_updated_by = $3 WHERE id = $1", [a.familyId, on, a.profileId]);
}

async function changeCurrency(c: pg.PoolClient, a: AuthContext, currency: string) {
  if (!(currency in CURRENCIES)) throw new HttpError(400, "invalid_currency", "Devise non proposée");
  if (await frozen(c, a.familyId)) throw new HttpError(409, "currency_frozen", "La devise est figée depuis la première opération enregistrée");
  await c.query("UPDATE finance_settings SET currency = $2, decimals = $3, updated_at = now(), updated_by = $4 WHERE family_id = $1", [a.familyId, currency, CURRENCIES[currency], a.profileId]);
}

// ---- opérations -------------------------------------------------------------------------------------------------------

export interface OperationInput {
  requestId: string;
  kind: "expense" | "income";
  amount: string | number;
  date: string;
  categoryId?: string | null;
  merchant?: string | null;
  label?: string | null;
  note?: string | null;
  listId?: string | null;
  source: "list_payment" | "manual";
}

async function merchantId(c: pg.PoolClient, familyId: string, name: string | null | undefined): Promise<string | null> {
  const n = name?.trim();
  if (!n) return null;
  if (n.length > 40) throw new HttpError(400, "invalid_merchant", "Nom de commerce trop long (40 caractères au plus)");
  const r = await c.query(
    `INSERT INTO finance_merchants (family_id, name, uses) VALUES ($1,$2,1)
     ON CONFLICT (family_id, lower(btrim(name))) DO UPDATE SET uses = finance_merchants.uses + 1, last_used_at = now()
     RETURNING id`,
    [familyId, n],
  );
  return r.rows[0].id;
}

async function categoryOk(c: Q, familyId: string, id: string): Promise<void> {
  const r = (await c.query("SELECT archived_at FROM finance_categories WHERE id = $1 AND family_id = $2", [id, familyId])).rows[0];
  if (!r) throw new HttpError(400, "invalid_category", "Catégorie introuvable");
  if (r.archived_at) throw new HttpError(409, "category_archived", "Cette catégorie est archivée");
}
async function coursesCategory(c: Q, familyId: string): Promise<string> {
  return (await c.query("SELECT id FROM finance_categories WHERE family_id = $1 AND system_key = 'courses'", [familyId])).rows[0].id;
}
async function listOk(c: Q, familyId: string, listId: string): Promise<void> {
  if (!(await c.query("SELECT 1 FROM lists WHERE id = $1 AND family_id = $2", [listId, familyId])).rowCount) throw new HttpError(404, "not_found", "Liste introuvable");
}

const OP_SELECT = `SELECT o.*, c.name AS category_name, c.system_key, m.name AS merchant_name, l.name AS list_name, l.created_at AS list_created_at,
                          pc.display_name AS created_by_name, pu.display_name AS updated_by_name
                     FROM finance_operations o
                     LEFT JOIN finance_categories c ON c.id = o.category_id
                     LEFT JOIN finance_merchants m ON m.id = o.merchant_id
                     LEFT JOIN lists l ON l.id = o.list_id
                     JOIN profiles pc ON pc.id = o.created_by
                     JOIN profiles pu ON pu.id = o.updated_by`;

function opView(o: Record<string, any>, a: AuthContext, rights: FinanceRights) {
  const mine = o.created_by === a.profileId;
  return {
    id: o.id as string, kind: o.kind as string, amount: Number(o.amount_minor), currency: o.currency as string, date: iso(o.op_date),
    categoryId: o.category_id as string | null, category: o.category_name as string | null, courses: o.system_key === "courses",
    merchant: o.merchant_name as string | null, label: o.label as string | null, note: o.note as string | null,
    listId: o.list_id as string | null, listName: o.list_name as string | null, listCreatedAt: o.list_created_at ? (o.list_created_at as Date).toISOString() : null,
    source: o.source as string, rev: o.rev as number,
    createdAt: (o.created_at as Date).toISOString(), createdBy: o.created_by_name as string,
    updatedAt: (o.updated_at as Date).toISOString(), updatedBy: o.updated_by_name as string,
    voided: !!o.voided_at, voidedAt: o.voided_at ? (o.voided_at as Date).toISOString() : null, voidReason: o.void_reason as string | null,
    mine, canEdit: !o.voided_at && (rights.edit || (rights.record && mine && o.source === "list_payment")),
  };
}

async function loadOp(c: Q, a: AuthContext, id: string, rights: FinanceRights) {
  const o = (await c.query(`${OP_SELECT} WHERE o.id = $1 AND o.family_id = $2`, [id, a.familyId])).rows[0];
  if (!o) throw new HttpError(404, "not_found", "Opération introuvable");
  return opView(o, a, rights);
}

/** Crée une opération, ou rend celle déjà créée avec le même requestId (relance réseau : jamais de doublon). */
export async function createOperation(db: Db, hub: SseHub, a: AuthContext, input: OperationInput, rights: FinanceRights, s: Settings) {
  const out = await withTx(db, async (c) => {
    const prev = (await c.query("SELECT id FROM finance_operations WHERE family_id = $1 AND request_id = $2", [a.familyId, input.requestId])).rows[0];
    if (prev) return { id: prev.id as string, replay: true };
    const amount = parseAmount(input.amount, s.decimals);
    if (amount <= 0) throw new HttpError(400, "invalid_amount", "Le montant doit être supérieur à zéro");
    let categoryId: string | null = null;
    let merchant: string | null = null;
    if (input.kind === "expense") {
      if (input.source === "list_payment") categoryId = await coursesCategory(c, a.familyId);
      else {
        if (!input.categoryId) throw new HttpError(400, "category_required", "Choisissez une catégorie");
        await categoryOk(c, a.familyId, input.categoryId);
        categoryId = input.categoryId;
      }
      if (input.listId) await listOk(c, a.familyId, input.listId);
      merchant = await merchantId(c, a.familyId, input.merchant);
      if (!merchant && !input.label?.trim()) throw new HttpError(400, "label_required", input.source === "list_payment" ? "Indiquez le commerce" : "Indiquez un libellé ou un commerce");
    } else if (!input.label?.trim()) throw new HttpError(400, "label_required", "Indiquez un libellé");
    const r = await c.query(
      `INSERT INTO finance_operations (family_id, kind, amount_minor, currency, category_id, merchant_id, label, note, op_date, list_id, source, request_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       ON CONFLICT (family_id, request_id) DO NOTHING RETURNING id`,
      [a.familyId, input.kind, amount, s.currency, categoryId, merchant, input.label?.trim() || null, input.note?.trim() || null, input.date,
        input.kind === "expense" ? input.listId ?? null : null, input.source, input.requestId, a.profileId],
    );
    if (!r.rows[0]) return { id: (await c.query("SELECT id FROM finance_operations WHERE family_id = $1 AND request_id = $2", [a.familyId, input.requestId])).rows[0].id as string, replay: true };
    const id = r.rows[0].id as string;
    await c.query("INSERT INTO finance_operation_history (family_id, operation_id, action, by_profile, after) VALUES ($1,$2,'create',$3,$4)",
      [a.familyId, id, a.profileId, JSON.stringify({ amount, date: input.date, categoryId, merchantId: merchant, listId: input.listId ?? null, label: input.label ?? null })]);
    return { id, replay: false };
  });
  if (!out.replay) hub.broadcast(a.familyId, "budget.updated", {});
  return { operation: await loadOp(db, a, out.id, rights), replay: out.replay };
}

// ---- calculs ---------------------------------------------------------------------------------------------------------

async function sums(db: Q, familyId: string, where: string, params: unknown[]): Promise<{ expenses: number; incomes: number; count: number }> {
  const r = (await db.query(
    `SELECT coalesce(sum(o.amount_minor) FILTER (WHERE o.kind = 'expense'), 0)::bigint AS e,
            coalesce(sum(o.amount_minor) FILTER (WHERE o.kind = 'income'), 0)::bigint AS i, count(*)::int AS n
       FROM finance_operations o LEFT JOIN finance_categories c ON c.id = o.category_id
      WHERE o.family_id = $1 AND o.voided_at IS NULL ${where}`,
    [familyId, ...params],
  )).rows[0];
  return { expenses: Number(r.e), incomes: Number(r.i), count: r.n };
}

export async function accountState(db: Q, familyId: string, today: string) {
  const h = (await db.query("SELECT opening_minor, reference_date, at, reason FROM finance_account_history WHERE family_id = $1 ORDER BY id DESC LIMIT 1", [familyId])).rows[0];
  if (!h) return null;
  const ref = iso(h.reference_date);
  const t = await sums(db, familyId, "AND o.op_date >= $2 AND o.op_date <= $3", [ref, today]);
  const before = (await db.query("SELECT count(*)::int AS n FROM finance_operations WHERE family_id = $1 AND voided_at IS NULL AND op_date < $2", [familyId, ref])).rows[0].n as number;
  const later = (await db.query("SELECT count(*)::int AS n FROM finance_operations WHERE family_id = $1 AND voided_at IS NULL AND op_date > $2", [familyId, today])).rows[0].n as number;
  return {
    balance: Number(h.opening_minor) + t.incomes - t.expenses, opening: Number(h.opening_minor), referenceDate: ref, asOf: today,
    incomesSinceReference: t.incomes, expensesSinceReference: t.expenses, operationsBeforeReference: before, futureOperations: later,
  };
}

async function budgetsOf(db: Q, familyId: string, month: string) {
  const from = firstOfMonth(month), to = firstOfMonth(nextMonth(month));
  const rows = (await db.query(
    `SELECT c.id, c.name, c.system_key, c.position, c.archived_at,
            b.amount_minor AS planned,
            (SELECT b2.amount_minor FROM finance_budgets b2 WHERE b2.family_id = c.family_id AND b2.category_id = c.id AND b2.month < $2 ORDER BY b2.month DESC LIMIT 1) AS proposed,
            coalesce((SELECT sum(o.amount_minor) FROM finance_operations o WHERE o.family_id = c.family_id AND o.category_id = c.id AND o.kind = 'expense'
                       AND o.voided_at IS NULL AND o.op_date >= $2 AND o.op_date < $3), 0)::bigint AS spent
       FROM finance_categories c LEFT JOIN finance_budgets b ON b.category_id = c.id AND b.month = $2
      WHERE c.family_id = $1 ORDER BY c.position, c.name`,
    [familyId, from, to],
  )).rows;
  return rows
    .filter((r) => !r.archived_at || r.planned != null || Number(r.spent) > 0)
    .map((r) => {
      const planned = r.planned == null ? null : Number(r.planned);
      const spent = Number(r.spent);
      return { categoryId: r.id as string, category: r.name as string, courses: r.system_key === "courses", planned, proposed: r.proposed == null ? null : Number(r.proposed), spent, remaining: planned == null ? null : planned - spent };
    });
}

/** État des paiements d'une liste : non renseignés (aucun), à compléter (saisis, non confirmés), complets (confirmés). */
async function listPayments(db: Q, a: AuthContext, listId: string, rights: FinanceRights) {
  await listOk(db, a.familyId, listId);
  const ops = (await db.query(`${OP_SELECT} WHERE o.family_id = $1 AND o.list_id = $2 AND o.kind = 'expense' AND o.voided_at IS NULL ORDER BY o.op_date, o.created_at`, [a.familyId, listId])).rows
    .map((o) => opView(o, a, rights));
  const st = (await db.query("SELECT complete_at, p.display_name FROM list_payment_status s JOIN profiles p ON p.id = s.complete_by WHERE s.list_id = $1", [listId])).rows[0];
  const byMerchant = new Map<string, { merchant: string; total: number; count: number; dates: Set<string> }>();
  for (const o of ops) {
    const k = (o.merchant ?? o.label ?? "—").toLowerCase();
    const e = byMerchant.get(k) ?? { merchant: o.merchant ?? o.label ?? "—", total: 0, count: 0, dates: new Set<string>() };
    e.total += o.amount; e.count++; e.dates.add(o.date);
    byMerchant.set(k, e);
  }
  const l = (await db.query("SELECT status, name, created_at, closed_at FROM lists WHERE id = $1", [listId])).rows[0];
  return {
    listId, listStatus: l.status as string, listName: l.name as string | null,
    payments: ops,
    byMerchant: [...byMerchant.values()].map((e) => ({ merchant: e.merchant, total: e.total, count: e.count, dates: [...e.dates].sort() })),
    total: ops.reduce((t, o) => t + o.amount, 0),
    dates: [...new Set(ops.map((o) => o.date))].sort(),
    state: st ? "complete" : ops.length ? "to_complete" : "none",
    completeAt: st ? (st.complete_at as Date).toISOString() : null, completeBy: st?.display_name ?? null,
  };
}

// ---- routes ------------------------------------------------------------------------------------------------------------

const opCreate = z.object({
  requestId: z.string().uuid(), kind: z.enum(["expense", "income"]), amount: amountField, date: dateField,
  categoryId: z.string().uuid().nullish(), merchant: z.string().max(40).nullish(), label: z.string().max(80).nullish(),
  note: z.string().max(300).nullish(), listId: z.string().uuid().nullish(),
}).strict();
const opPatch = z.object({
  rev: z.number().int().min(1), amount: amountField.optional(), date: dateField.optional(), categoryId: z.string().uuid().optional(),
  merchant: z.string().max(40).nullish(), label: z.string().max(80).nullish(), note: z.string().max(300).nullish(), listId: z.string().uuid().nullish(),
}).strict();

export function budgetRoutes(app: FastifyInstance, { db, guard, hub }: { db: Db; guard: Guard; hub: SseHub }): void {
  /** État du module pour CE profil (toujours lisible : un profil sans droit voit seulement qu'il n'a pas accès). */
  app.get("/api/budget", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const s = await settingsOf(db, a.familyId);
    const rights = s?.enabled ? await financeRights(db, a) : NONE;
    const fam = (await db.query("SELECT country FROM families WHERE id = $1", [a.familyId])).rows[0];
    const proposedCurrency = COUNTRIES.find((c) => c.code === fam?.country)?.currency ?? null;
    if (!s?.enabled || !(rights.view || rights.record || rights.edit || rights.manage))
      return { enabled: !!s?.enabled, rights, currency: s?.currency ?? null, decimals: s?.decimals ?? null, proposedCurrency, currencies: CURRENCIES };
    const cats = (await db.query("SELECT id, name, system_key, position, archived_at FROM finance_categories WHERE family_id = $1 ORDER BY position, name", [a.familyId])).rows;
    const merchants = (await db.query("SELECT name FROM finance_merchants WHERE family_id = $1 ORDER BY uses DESC, last_used_at DESC LIMIT 30", [a.familyId])).rows.map((r) => r.name as string);
    const lower = new Set(merchants.map((m) => m.toLowerCase()));
    return {
      enabled: true, rights, currency: s.currency, decimals: s.decimals, proposedCurrency, currencies: CURRENCIES,
      currencyFrozen: await frozen(db, a.familyId), budgetsEnabled: s.budgetsEnabled, accountEnabled: s.accountEnabled,
      categories: rights.view || rights.edit || rights.manage
        ? cats.map((c) => ({ id: c.id, name: c.name, key: c.system_key, archived: !!c.archived_at }))
        : cats.filter((c) => c.system_key === "courses").map((c) => ({ id: c.id, name: c.name, key: c.system_key, archived: false })),
      merchants: [...merchants, ...DEFAULT_MERCHANTS.filter((m) => !lower.has(m.toLowerCase()))],
    };
  });

  app.put("/api/budget/settings", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const b = z.object({ currency: z.string().regex(/^[A-Z]{3}$/).optional(), budgetsEnabled: z.boolean().optional(), accountEnabled: z.boolean().optional() }).strict().parse(req.body ?? {});
    await need(db, a, (r) => r.manage);
    await withTx(db, async (c) => {
      await c.query("SELECT 1 FROM finance_settings WHERE family_id = $1 FOR UPDATE", [a.familyId]);
      if (b.currency) await changeCurrency(c, a, b.currency);
      if (b.accountEnabled === true && !(await c.query("SELECT 1 FROM finance_account_history WHERE family_id = $1 LIMIT 1", [a.familyId])).rowCount)
        throw new HttpError(409, "account_opening_required", "Saisissez d'abord le solde initial et sa date de référence");
      if (b.budgetsEnabled !== undefined) await c.query("UPDATE finance_settings SET budgets_enabled = $2, updated_at = now(), updated_by = $3 WHERE family_id = $1", [a.familyId, b.budgetsEnabled, a.profileId]);
      if (b.accountEnabled !== undefined) await c.query("UPDATE finance_settings SET account_enabled = $2, updated_at = now(), updated_by = $3 WHERE family_id = $1", [a.familyId, b.accountEnabled, a.profileId]);
    });
    hub.broadcast(a.familyId, "budget.updated", {});
    return { ok: true };
  });

  // Droits financiers par profil (administrateurs : tous les droits, non modifiables ici).
  app.get("/api/budget/rights", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    await need(db, a, (r) => r.manage);
    const rows = (await db.query(
      `SELECT p.id, p.display_name, p.role, p.active, r.can_manage, r.can_view, r.can_record, r.can_edit
         FROM profiles p LEFT JOIN finance_rights r ON r.profile_id = p.id
        WHERE p.family_id = $1 AND p.deleted_at IS NULL ORDER BY p.role, p.display_name`,
      [a.familyId],
    )).rows;
    return {
      profiles: rows.map((p) => ({
        profileId: p.id, displayName: p.display_name, role: p.role, active: p.active, fixed: p.role === "admin",
        rights: p.role === "admin" ? ALL : p.role === "staff" ? { ...NONE, record: !!p.can_record } : { manage: !!p.can_manage, view: !!p.can_view || !!p.can_manage, record: !!p.can_record, edit: !!p.can_edit },
      })),
    };
  });

  app.put("/api/budget/rights/:profileId", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { profileId } = z.object({ profileId: z.string().uuid() }).parse(req.params);
    const b = z.object({ manage: z.boolean(), view: z.boolean(), record: z.boolean(), edit: z.boolean() }).strict().parse(req.body);
    await need(db, a, (r) => r.manage);
    const t = (await db.query("SELECT role FROM profiles WHERE id = $1 AND family_id = $2 AND deleted_at IS NULL", [profileId, a.familyId])).rows[0];
    if (!t) throw new HttpError(404, "not_found", "Profil introuvable");
    if (t.role === "admin") throw new HttpError(409, "admin_rights_fixed", "Un administrateur a tous les droits financiers");
    if (t.role === "staff" && (b.manage || b.view || b.edit))
      throw new HttpError(409, "staff_rights_limited", "Le personnel peut seulement saisir les paiements des courses (sans voir le solde, les entrées ni les autres dépenses)");
    await db.query(
      `INSERT INTO finance_rights (profile_id, family_id, can_manage, can_view, can_record, can_edit, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (profile_id) DO UPDATE SET can_manage = $3, can_view = $4, can_record = $5, can_edit = $6, updated_at = now(), updated_by = $7`,
      [profileId, a.familyId, b.manage, b.view || b.manage, b.record, b.edit, a.profileId],
    );
    await db.query("INSERT INTO audit_log (family_id, actor_profile_id, action, target_profile_id, details) VALUES ($1,$2,'finance.rights',$3,$4)", [a.familyId, a.profileId, profileId, JSON.stringify(b)]);
    hub.broadcast(a.familyId, "budget.updated", {});
    return { ok: true };
  });

  // Catégories financières (distinctes des catégories de produits).
  app.post("/api/budget/categories", { preHandler: guard() }, async (req, reply) => {
    const a = req.auth!;
    const { name } = z.object({ name: nameField }).strict().parse(req.body);
    await need(db, a, (r) => r.manage);
    const r = await db.query(
      `INSERT INTO finance_categories (family_id, name, position, created_by) VALUES ($1,$2,50,$3) ON CONFLICT DO NOTHING RETURNING id`,
      [a.familyId, name, a.profileId],
    );
    if (!r.rows[0]) throw new HttpError(409, "category_exists", "Cette catégorie existe déjà");
    hub.broadcast(a.familyId, "budget.updated", {});
    return reply.code(201).send({ id: r.rows[0].id });
  });

  app.patch("/api/budget/categories/:id", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ name: nameField.optional(), archived: z.boolean().optional() }).strict().parse(req.body);
    await need(db, a, (r) => r.manage);
    const c = (await db.query("SELECT system_key FROM finance_categories WHERE id = $1 AND family_id = $2", [id, a.familyId])).rows[0];
    if (!c) throw new HttpError(404, "not_found", "Catégorie introuvable");
    if (c.system_key === "courses" && b.archived) throw new HttpError(409, "category_protected", "La catégorie Courses est nécessaire aux paiements des listes");
    try {
      if (b.name) await db.query("UPDATE finance_categories SET name = $3 WHERE id = $1 AND family_id = $2", [id, a.familyId, b.name]);
    } catch (e: any) {
      if (e.code === "23505") throw new HttpError(409, "category_exists", "Cette catégorie existe déjà");
      throw e;
    }
    if (b.archived !== undefined) await db.query("UPDATE finance_categories SET archived_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1 AND family_id = $2", [id, a.familyId, b.archived]);
    hub.broadcast(a.familyId, "budget.updated", {});
    return { ok: true };
  });

  // Opérations libres (dépense ou entrée d'argent).
  app.post("/api/budget/operations", { preHandler: guard() }, async (req, reply) => {
    const a = req.auth!;
    const b = opCreate.parse(req.body);
    const { s, rights } = await need(db, a, (r) => r.edit);
    const r = await createOperation(db, hub, a, { ...b, source: "manual" }, rights, s);
    return reply.code(r.replay ? 200 : 201).send(r);
  });

  /** Historique filtré : les totaux renvoyés correspondent EXACTEMENT aux filtres ; dépenses et entrées restent séparées. */
  app.get("/api/budget/operations", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const q = z.object({
      month: monthField.optional(), type: z.enum(["all", "expense", "income"]).default("all"), scope: z.enum(["all", "courses", "hors_courses"]).default("all"),
      categoryId: z.string().uuid().optional(), merchant: z.string().max(40).optional(), listId: z.string().uuid().optional(), voided: z.enum(["0", "1"]).default("0"),
    }).parse(req.query);
    const { rights } = await need(db, a, (r) => r.view || r.record);
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => (params.push(v), `$${params.length + 1}`);
    // Saisie des paiements seulement : ses propres paiements de courses, rien d'autre de l'historique familial.
    if (!rights.view) where.push(`o.created_by = ${p(a.profileId)} AND o.source = 'list_payment'`);
    if (q.month) where.push(`o.op_date >= ${p(firstOfMonth(q.month))} AND o.op_date < ${p(firstOfMonth(nextMonth(q.month)))}`);
    if (q.type !== "all") where.push(`o.kind = ${p(q.type)}`);
    if (q.scope === "courses") where.push(`o.kind = 'expense' AND c.system_key = 'courses'`);
    if (q.scope === "hors_courses") where.push(`o.kind = 'expense' AND c.system_key IS DISTINCT FROM 'courses'`);
    if (q.categoryId) where.push(`o.category_id = ${p(q.categoryId)}`);
    if (q.merchant) where.push(`lower(m.name) = lower(${p(q.merchant)})`);
    if (q.listId) where.push(`o.list_id = ${p(q.listId)}`);
    const w = where.length ? ` AND ${where.join(" AND ")}` : "";
    const rows = (await db.query(`${OP_SELECT} WHERE o.family_id = $1 ${q.voided === "1" ? "" : "AND o.voided_at IS NULL"} ${w} ORDER BY o.op_date DESC, o.created_at DESC LIMIT 500`, [a.familyId, ...params])).rows;
    const t = await sums(db, a.familyId, w.replace(/\bm\.name\b/g, "(SELECT name FROM finance_merchants WHERE id = o.merchant_id)"), params);
    return { operations: rows.map((o) => opView(o, a, rights)), totals: { expenses: t.expenses, incomes: t.incomes, count: t.count }, filters: q, ownOnly: !rights.view };
  });

  app.get("/api/budget/operations/:id/history", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await need(db, a, (r) => r.view);
    const rows = (await db.query(
      `SELECT h.action, h.at, p.display_name, h.before, h.after FROM finance_operation_history h JOIN profiles p ON p.id = h.by_profile
        WHERE h.operation_id = $1 AND h.family_id = $2 ORDER BY h.id`, [id, a.familyId])).rows;
    return { history: rows.map((h) => ({ action: h.action, at: (h.at as Date).toISOString(), by: h.display_name, before: h.before, after: h.after })) };
  });

  /** Correction : ajuste CETTE opération (aucune nouvelle opération), avec contrôle de version et trace avant / après. */
  app.patch("/api/budget/operations/:id", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = opPatch.parse(req.body);
    const { s, rights } = await need(db, a, (r) => r.edit || r.record);
    let warning: string | null = null;
    await withTx(db, async (c) => {
      const o = (await c.query("SELECT * FROM finance_operations WHERE id = $1 AND family_id = $2 FOR UPDATE", [id, a.familyId])).rows[0];
      if (!o) throw new HttpError(404, "not_found", "Opération introuvable");
      if (o.voided_at) throw new HttpError(409, "operation_voided", "Cette opération est annulée");
      const own = rights.record && o.created_by === a.profileId && o.source === "list_payment";
      if (!rights.edit && !own) throw new HttpError(403, "finance_forbidden", "Vous pouvez corriger seulement vos propres paiements de courses");
      if (!rights.edit && (b.categoryId !== undefined || b.listId !== undefined || b.label !== undefined)) throw new HttpError(403, "finance_forbidden", "Correction limitée au montant, au commerce, à la date et à la note");
      if (o.rev !== b.rev) throw new HttpError(409, "stale", "Cette opération a été modifiée entre-temps : actualisez avant de la corriger");
      const amount = b.amount !== undefined ? parseAmount(b.amount, s.decimals) : Number(o.amount_minor);
      if (amount <= 0) throw new HttpError(400, "invalid_amount", "Le montant doit être supérieur à zéro");
      let categoryId = o.category_id as string | null;
      if (b.categoryId !== undefined) {
        if (o.kind !== "expense") throw new HttpError(400, "invalid_category", "Une entrée d'argent n'a pas de catégorie");
        if (o.source === "list_payment") throw new HttpError(409, "category_protected", "Un paiement de liste reste dans la catégorie Courses");
        await categoryOk(c, a.familyId, b.categoryId);
        categoryId = b.categoryId;
      }
      let listId = o.list_id as string | null;
      if (b.listId !== undefined) {
        if (o.kind !== "expense") throw new HttpError(400, "invalid_list", "Une entrée d'argent n'est pas rattachée à une liste");
        if (b.listId) await listOk(c, a.familyId, b.listId);
        listId = b.listId ?? null;
      }
      const merchant = b.merchant !== undefined ? (o.kind === "expense" ? await merchantId(c, a.familyId, b.merchant) : null) : (o.merchant_id as string | null);
      const label = b.label !== undefined ? b.label?.trim() || null : (o.label as string | null);
      if (o.kind === "income" && !label) throw new HttpError(400, "label_required", "Indiquez un libellé");
      if (o.kind === "expense" && !merchant && !label) throw new HttpError(400, "label_required", "Indiquez un libellé ou un commerce");
      const date = b.date ?? iso(o.op_date);
      const note = b.note !== undefined ? b.note?.trim() || null : (o.note as string | null);
      const st = await settingsOf(c, a.familyId);
      if (st?.accountEnabled) {
        const ref = (await c.query("SELECT reference_date FROM finance_account_history WHERE family_id = $1 ORDER BY id DESC LIMIT 1", [a.familyId])).rows[0];
        if (ref) {
          const r0 = iso(ref.reference_date);
          const wasIn = iso(o.op_date) >= r0, isIn = date >= r0;
          if (wasIn !== isIn) warning = isIn ? "Cette opération entre désormais dans le calcul du solde de Mon compte." : "Cette opération sort du calcul du solde de Mon compte (date antérieure au solde initial).";
          else if (isIn && amount !== Number(o.amount_minor)) warning = "Le solde de Mon compte est recalculé avec ce nouveau montant.";
        }
      }
      const before = { amount: Number(o.amount_minor), date: iso(o.op_date), categoryId: o.category_id, merchantId: o.merchant_id, listId: o.list_id, label: o.label, note: o.note };
      const after = { amount, date, categoryId, merchantId: merchant, listId, label, note };
      await c.query(
        `UPDATE finance_operations SET amount_minor = $3, op_date = $4, category_id = $5, merchant_id = $6, list_id = $7, label = $8, note = $9,
                rev = rev + 1, updated_at = now(), updated_by = $10 WHERE id = $1 AND family_id = $2`,
        [id, a.familyId, amount, date, categoryId, merchant, listId, label, note, a.profileId],
      );
      await c.query("INSERT INTO finance_operation_history (family_id, operation_id, action, by_profile, before, after) VALUES ($1,$2,'update',$3,$4,$5)", [a.familyId, id, a.profileId, JSON.stringify(before), JSON.stringify(after)]);
    });
    hub.broadcast(a.familyId, "budget.updated", {});
    return { operation: await loadOp(db, a, id, rights), warning };
  });

  /** Annulation explicite et tracée (jamais d'effacement) : l'opération ne compte plus nulle part. */
  app.post("/api/budget/operations/:id/void", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ rev: z.number().int().min(1), reason: z.string().trim().max(200).optional() }).strict().parse(req.body);
    const { rights } = await need(db, a, (r) => r.edit || r.record);
    await withTx(db, async (c) => {
      const o = (await c.query("SELECT * FROM finance_operations WHERE id = $1 AND family_id = $2 FOR UPDATE", [id, a.familyId])).rows[0];
      if (!o) throw new HttpError(404, "not_found", "Opération introuvable");
      if (o.voided_at) return;
      if (!rights.edit && !(rights.record && o.created_by === a.profileId && o.source === "list_payment")) throw new HttpError(403, "finance_forbidden", "Vous pouvez annuler seulement vos propres paiements de courses");
      if (o.rev !== b.rev) throw new HttpError(409, "stale", "Cette opération a été modifiée entre-temps : actualisez avant de l'annuler");
      await c.query("UPDATE finance_operations SET voided_at = now(), voided_by = $3, void_reason = $4, rev = rev + 1 WHERE id = $1 AND family_id = $2", [id, a.familyId, a.profileId, b.reason || null]);
      await c.query("INSERT INTO finance_operation_history (family_id, operation_id, action, by_profile, before) VALUES ($1,$2,'void',$3,$4)", [a.familyId, id, a.profileId, JSON.stringify({ amount: Number(o.amount_minor), date: iso(o.op_date), reason: b.reason ?? null })]);
    });
    hub.broadcast(a.familyId, "budget.updated", {});
    return { operation: await loadOp(db, a, id, rights) };
  });

  // Paiements d'une liste : saisis pendant les courses, ou plus tard depuis l'historique (la liste n'est jamais rouverte).
  app.post("/api/lists/:id/payments", { preHandler: guard() }, async (req, reply) => {
    const a = req.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ requestId: z.string().uuid(), merchant: z.string().trim().min(1).max(40), amount: amountField, date: dateField, note: z.string().max(300).nullish() }).strict().parse(req.body);
    const { s, rights } = await need(db, a, (r) => r.record || r.edit);
    await listOk(db, a.familyId, id);
    const r = await createOperation(db, hub, a, { requestId: b.requestId, kind: "expense", amount: b.amount, date: b.date, merchant: b.merchant, note: b.note, listId: id, source: "list_payment" }, rights, s);
    return reply.code(r.replay ? 200 : 201).send(r);
  });

  app.get("/api/lists/:id/payments", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rights } = await need(db, a, (r) => r.record || r.view || r.edit);
    return listPayments(db, a, id, rights);
  });

  /** « Confirmer » : les montants de la liste sont déclarés complets (aucun débit supplémentaire : les paiements existent déjà). */
  app.put("/api/lists/:id/payments/status", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { complete } = z.object({ complete: z.boolean() }).strict().parse(req.body);
    const { rights } = await need(db, a, (r) => r.record || r.edit);
    await listOk(db, a.familyId, id);
    if (complete)
      await db.query("INSERT INTO list_payment_status (list_id, family_id, complete_by) VALUES ($1,$2,$3) ON CONFLICT (list_id) DO NOTHING", [id, a.familyId, a.profileId]);
    else await db.query("DELETE FROM list_payment_status WHERE list_id = $1 AND family_id = $2", [id, a.familyId]);
    hub.broadcast(a.familyId, "budget.updated", {});
    return listPayments(db, a, id, rights);
  });

  /** Vue d'ensemble : solde ACTUEL (à la date du jour) distinct des totaux du mois choisi. */
  app.get("/api/budget/overview", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const q = z.object({ month: monthField, today: dateField }).parse(req.query);
    const { s } = await need(db, a, (r) => r.view);
    const from = firstOfMonth(q.month), to = firstOfMonth(nextMonth(q.month));
    const month = await sums(db, a.familyId, "AND o.op_date >= $2 AND o.op_date < $3", [from, to]);
    const courses = await sums(db, a.familyId, "AND o.op_date >= $2 AND o.op_date < $3 AND c.system_key = 'courses'", [from, to]);
    const monday = mondayOf(q.today);
    const week = await sums(db, a.familyId, "AND o.op_date >= $2 AND o.op_date <= $3", [monday, q.today]);
    const lists = (await db.query(
      `SELECT l.id, l.name, l.created_at, l.closed_at,
              (SELECT count(*)::int FROM finance_operations o WHERE o.list_id = l.id AND o.voided_at IS NULL) AS n,
              (SELECT coalesce(sum(amount_minor), 0)::bigint FROM finance_operations o WHERE o.list_id = l.id AND o.voided_at IS NULL) AS total
         FROM lists l
        WHERE l.family_id = $1 AND l.status = 'archived' AND l.closed_at > now() - interval '90 days'
          AND NOT EXISTS (SELECT 1 FROM list_payment_status s WHERE s.list_id = l.id)
          AND EXISTS (SELECT 1 FROM list_items i WHERE i.list_id = l.id AND i.status = 'purchased')
        ORDER BY l.closed_at DESC LIMIT 20`,
      [a.familyId],
    )).rows;
    return {
      month: q.month, today: q.today, currency: s.currency, decimals: s.decimals,
      account: s.accountEnabled ? await accountState(db, a.familyId, q.today) : null,
      monthExpenses: month.expenses, monthIncomes: month.incomes, monthCourses: courses.expenses, monthOutsideCourses: month.expenses - courses.expenses,
      week: { from: monday, to: q.today, expenses: week.expenses },
      budgets: s.budgetsEnabled ? await budgetsOf(db, a.familyId, q.month) : null,
      listsToComplete: lists.map((l) => ({ listId: l.id, name: l.name, createdAt: (l.created_at as Date).toISOString(), closedAt: (l.closed_at as Date).toISOString(), state: l.n > 0 ? "to_complete" : "none", recorded: Number(l.total) })),
    };
  });

  app.get("/api/budget/budgets", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { month } = z.object({ month: monthField }).parse(req.query);
    await need(db, a, (r) => r.view);
    return { month, budgets: await budgetsOf(db, a.familyId, month) };
  });

  /** Montant prévu d'UN mois (les autres mois ne changent pas) ; null = retirer le budget de ce mois. */
  app.put("/api/budget/budgets", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const b = z.object({ month: monthField, categoryId: z.string().uuid(), amount: amountField.nullable() }).strict().parse(req.body);
    const { s } = await need(db, a, (r) => r.manage);
    await categoryOk(db, a.familyId, b.categoryId);
    if (b.amount === null) await db.query("DELETE FROM finance_budgets WHERE family_id = $1 AND category_id = $2 AND month = $3", [a.familyId, b.categoryId, firstOfMonth(b.month)]);
    else
      await db.query(
        `INSERT INTO finance_budgets (family_id, category_id, month, amount_minor, updated_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (family_id, category_id, month) DO UPDATE SET amount_minor = $4, updated_at = now(), updated_by = $5`,
        [a.familyId, b.categoryId, firstOfMonth(b.month), parseAmount(b.amount, s.decimals), a.profileId],
      );
    hub.broadcast(a.familyId, "budget.updated", {});
    return { month: b.month, budgets: await budgetsOf(db, a.familyId, b.month) };
  });

  // Mon compte : solde initial (au début de la date de référence) ; chaque correction est conservée.
  app.get("/api/budget/account", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const { today } = z.object({ today: dateField }).parse(req.query);
    await need(db, a, (r) => r.view);
    const hist = (await db.query(
      `SELECT h.opening_minor, h.reference_date, h.reason, h.at, p.display_name FROM finance_account_history h JOIN profiles p ON p.id = h.by_profile
        WHERE h.family_id = $1 ORDER BY h.id DESC LIMIT 20`, [a.familyId])).rows;
    return {
      account: await accountState(db, a.familyId, today),
      history: hist.map((h) => ({ opening: Number(h.opening_minor), referenceDate: iso(h.reference_date), reason: h.reason, at: (h.at as Date).toISOString(), by: h.display_name })),
    };
  });

  app.put("/api/budget/account", { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    const b = z.object({ opening: z.union([z.string().max(20), z.number()]), referenceDate: dateField, reason: z.string().trim().max(200).optional(), today: dateField }).strict().parse(req.body);
    const { s } = await need(db, a, (r) => r.manage);
    const neg = String(b.opening).trim().startsWith("-");
    const opening = (neg ? -1 : 1) * parseAmount(String(b.opening).trim().replace(/^-/, ""), s.decimals);
    const warnings: string[] = [];
    await withTx(db, async (c) => {
      await c.query("SELECT 1 FROM finance_settings WHERE family_id = $1 FOR UPDATE", [a.familyId]);
      const prev = (await c.query("SELECT reference_date FROM finance_account_history WHERE family_id = $1 ORDER BY id DESC LIMIT 1", [a.familyId])).rows[0];
      if (prev && !b.reason) throw new HttpError(400, "reason_required", "Indiquez la raison de la correction du solde initial (elle est conservée)");
      if (prev && iso(prev.reference_date) !== b.referenceDate) warnings.push("La date de référence change : les opérations comptées dans le solde changent aussi.");
      await c.query("INSERT INTO finance_account_history (family_id, opening_minor, reference_date, reason, by_profile) VALUES ($1,$2,$3,$4,$5)", [a.familyId, opening, b.referenceDate, b.reason || null, a.profileId]);
      await c.query("UPDATE finance_settings SET account_enabled = true, updated_at = now(), updated_by = $2 WHERE family_id = $1", [a.familyId, a.profileId]);
      const before = (await c.query("SELECT count(*)::int AS n FROM finance_operations WHERE family_id = $1 AND voided_at IS NULL AND op_date < $2", [a.familyId, b.referenceDate])).rows[0].n as number;
      if (before > 0) warnings.push(`${before} opération${before > 1 ? "s" : ""} antérieure${before > 1 ? "s" : ""} à cette date reste${before > 1 ? "nt" : ""} dans l'historique sans être retirée${before > 1 ? "s" : ""} du solde.`);
    });
    hub.broadcast(a.familyId, "budget.updated", {});
    return { account: await accountState(db, a.familyId, b.today), warnings };
  });
}
