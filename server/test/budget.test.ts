import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import { parseAmount } from "../src/budget.js";
import { purgeFamily } from "../src/family-purge.js";
import type { Db } from "../src/db.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
let n = 0;
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, store: testStore(), loginRateLimit: { max: 1000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => { await app.close(); await closeTestDb(); });

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
type C = { sc_session: string };
const req = (method: string, url: string, cookies: C, payload?: unknown) => app.inject({ method: method as any, url, cookies, payload: payload as any });

async function family() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `B${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const code = res.json().familyCode;
  const admin = cookieOf(res);
  const member = async (login: string, role: string) => {
    const r = await req("POST", "/api/profiles", admin, { displayName: login, login, role, secret: "573918", secretConfirm: "573918" });
    const c = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: code, login, secret: "573918" } }));
    return { c, id: r.json().profile?.id ?? r.json().id };
  };
  const parent = await member("lamiaa", "parent");
  const staff = await member("marie", "staff");
  const products = (await req("GET", "/api/catalog", admin)).json().categories.flatMap((c: any) => c.products);
  await req("POST", "/api/lists/active/ops", admin, { ops: [{ opId: randomUUID(), type: "add", productId: products.find((p: any) => p.name === "Tomates").id, quantity: 2 }] });
  const list = (await req("GET", "/api/lists/active", admin)).json().list;
  return { admin, parent, staff, listId: list.id as string, items: list.items };
}
const enable = (f: { admin: C }) => req("PUT", "/api/family/features", f.admin, { budget: true, currency: "MAD" });
const pay = (c: C, listId: string, merchant: string, amount: string, date = "2026-10-10", requestId = randomUUID()) =>
  req("POST", `/api/lists/${listId}/payments`, c, { requestId, merchant, amount, date });
const overview = async (c: C, month = "2026-10", today = "2026-10-17") => (await req("GET", `/api/budget/overview?month=${month}&today=${today}`, c)).json();

describe("montants exacts", () => {
  it("unités mineures entières selon les décimales de la devise", () => {
    expect(parseAmount("320", 2)).toBe(32000);
    expect(parseAmount("1 234,50", 2)).toBe(123450);
    expect(parseAmount("0.1", 2) + parseAmount("0.2", 2)).toBe(parseAmount("0.3", 2)); // jamais 0,30000000000000004
    expect(() => parseAmount("10,555", 2)).toThrow();
    expect(parseAmount("10,555", 3)).toBe(10555);
    expect(() => parseAmount("5,5", 0)).toThrow();
    expect(() => parseAmount("-3", 2)).toThrow();
  });
});

describe("module Budget", () => {
  it("désactivé par défaut ; activation par un administrateur avec la devise confirmée ; aucun accès financier implicite", async () => {
    const f = await family();
    expect((await req("GET", "/api/me", f.admin)).json().me.features.budget).toBe(false);
    expect((await pay(f.admin, f.listId, "BIM", "10")).json().error).toBe("budget_disabled");
    expect((await req("PUT", "/api/family/features", f.admin, { budget: true })).json().error).toBe("currency_required");
    expect((await req("PUT", "/api/family/features", f.parent.c, { budget: true, currency: "MAD" })).statusCode).toBe(403);
    expect((await enable(f)).json().features.budget).toBe(true);
    const st = (await req("GET", "/api/budget", f.admin)).json();
    expect(st).toMatchObject({ enabled: true, currency: "MAD", decimals: 2, currencyFrozen: false });
    expect(st.categories.map((c: any) => c.name)).toEqual(["Courses", "Transport", "Maison", "Autres"]);
    expect(st.merchants).toEqual(expect.arrayContaining(["BIM", "Carrefour", "Marjane", "Primeur", "Boucherie"]));
    // Un parent et le personnel n'ont aucun droit tant qu'un administrateur ne leur en donne pas.
    expect((await req("GET", "/api/budget", f.parent.c)).json().rights).toEqual({ manage: false, view: false, record: false, edit: false });
    expect((await req("GET", "/api/budget/overview?month=2026-10&today=2026-10-17", f.parent.c)).statusCode).toBe(403);
    expect((await pay(f.staff.c, f.listId, "BIM", "10")).statusCode).toBe(403);
  });

  it("paiements avant clôture (BIM 320, Primeur 130, Carrefour 450) : 900 DH ; relance sans doublon ; la clôture ne débite rien de plus", async () => {
    const f = await family();
    await enable(f);
    const rid = randomUUID();
    expect((await pay(f.admin, f.listId, "BIM", "320", "2026-10-10", rid)).statusCode).toBe(201);
    const again = await pay(f.admin, f.listId, "BIM", "320", "2026-10-10", rid); // relance réseau
    expect(again.statusCode).toBe(200);
    expect(again.json().replay).toBe(true);
    await pay(f.admin, f.listId, "Primeur", "130", "2026-10-11");
    await pay(f.admin, f.listId, "Carrefour", "450", "2026-10-11");
    let lp = (await req("GET", `/api/lists/${f.listId}/payments`, f.admin)).json();
    expect(lp.total).toBe(90000);
    expect(lp.state).toBe("to_complete");
    expect(lp.dates).toEqual(["2026-10-10", "2026-10-11"]); // dates réelles de paiement sur plusieurs jours
    expect(lp.byMerchant.map((m: any) => [m.merchant, m.total])).toEqual([["BIM", 32000], ["Primeur", 13000], ["Carrefour", 45000]]);
    // les dépenses existent AVANT la clôture
    expect((await overview(f.admin)).monthCourses).toBe(90000);
    lp = (await req("PUT", `/api/lists/${f.listId}/payments/status`, f.admin, { complete: true })).json();
    expect(lp.state).toBe("complete");
    expect((await req("POST", `/api/lists/${f.listId}/close`, f.admin, {})).statusCode).toBe(200);
    const o = await overview(f.admin);
    expect(o.monthCourses).toBe(90000);
    expect(o.monthExpenses).toBe(90000);
    expect(Number((await db.query("SELECT count(*) AS n FROM finance_operations WHERE list_id = $1", [f.listId])).rows[0].n)).toBe(3);
    // saisie ultérieure depuis l'historique : la liste reste clôturée, ses achats inchangés
    expect((await pay(f.admin, f.listId, "Boucherie", "50", "2026-10-12")).statusCode).toBe(201);
    const l = (await req("GET", `/api/lists/${f.listId}`, f.admin)).json().list;
    expect(l.status).toBe("archived");
    expect(l.items.length).toBe(f.items.length);
  });

  it("exemple de référence Budget et compte, puis correction Carrefour 450 → 400 sans nouvelle opération", async () => {
    const f = await family();
    await enable(f);
    const st = (await req("GET", "/api/budget", f.admin)).json();
    const cat = (name: string) => st.categories.find((c: any) => c.name === name).id;
    // solde initial 100 000 DH au début du 1er octobre (les opérations de ce jour comptent)
    expect((await req("PUT", "/api/budget/account", f.admin, { opening: "100000", referenceDate: "2026-10-01", today: "2026-10-17" })).statusCode).toBe(200);
    await req("PUT", "/api/budget/settings", f.admin, { budgetsEnabled: true });
    expect((await req("PUT", "/api/budget/budgets", f.admin, { month: "2026-10", categoryId: cat("Courses"), amount: "6000" })).statusCode).toBe(200);
    // définir un budget n'est ni une dépense ni un retrait
    expect((await overview(f.admin)).account.balance).toBe(10000000);
    const op = (body: any) => req("POST", "/api/budget/operations", f.admin, { requestId: randomUUID(), date: "2026-10-05", ...body });
    expect((await op({ kind: "income", amount: "5000", label: "Salaire" })).statusCode).toBe(201);
    await pay(f.admin, f.listId, "BIM", "320", "2026-10-01");
    await pay(f.admin, f.listId, "Primeur", "130");
    const carrefour = (await pay(f.admin, f.listId, "Carrefour", "450")).json().operation;
    await op({ kind: "expense", amount: "100", merchant: "Carburant", categoryId: cat("Transport") });
    await op({ kind: "expense", amount: "550", label: "Livres d'anglais", categoryId: cat("Autres") });
    await op({ kind: "expense", amount: "300", label: "Ménage", categoryId: cat("Maison") });
    let o = await overview(f.admin);
    expect(o.monthExpenses).toBe(185000);
    expect(o.monthOutsideCourses).toBe(95000);
    expect(o.monthIncomes).toBe(500000); // entrées séparées des dépenses
    expect(o.account.balance).toBe(10315000);
    expect(o.budgets.find((b: any) => b.category === "Courses")).toMatchObject({ planned: 600000, spent: 90000, remaining: 510000 });
    // filtre « Hors courses » : le total correspond au filtre
    const hc = (await req("GET", "/api/budget/operations?month=2026-10&scope=hors_courses", f.admin)).json();
    expect(hc.totals).toEqual({ expenses: 95000, incomes: 0, count: 3 });
    const before = Number((await db.query("SELECT count(*) AS n FROM finance_operations")).rows[0].n);
    const fix = await req("PATCH", `/api/budget/operations/${carrefour.id}`, f.admin, { rev: carrefour.rev, amount: "400" });
    expect(fix.statusCode).toBe(200);
    expect(fix.json().warning).toMatch(/recalculé/);
    expect(Number((await db.query("SELECT count(*) AS n FROM finance_operations")).rows[0].n)).toBe(before);
    o = await overview(f.admin);
    expect(o.monthCourses).toBe(85000);
    expect(o.monthExpenses).toBe(180000);
    expect(o.account.balance).toBe(10320000);
    expect(o.budgets.find((b: any) => b.category === "Courses").remaining).toBe(515000);
    // version périmée refusée ; trace avant / après conservée
    expect((await req("PATCH", `/api/budget/operations/${carrefour.id}`, f.admin, { rev: carrefour.rev, amount: "390" })).json().error).toBe("stale");
    const h = (await req("GET", `/api/budget/operations/${carrefour.id}/history`, f.admin)).json().history;
    expect(h.map((x: any) => x.action)).toEqual(["create", "update"]);
    expect([h[1].before.amount, h[1].after.amount]).toEqual([45000, 40000]);
    // la devise est figée depuis la première opération
    expect((await req("PUT", "/api/budget/settings", f.admin, { currency: "EUR" })).json().error).toBe("currency_frozen");
  });

  it("annulation tracée ; opérations antérieures au solde initial non retirées ; correction du solde initial justifiée", async () => {
    const f = await family();
    await enable(f);
    const autres = (await req("GET", "/api/budget", f.admin)).json().categories.find((c: any) => c.name === "Autres").id;
    await req("POST", "/api/budget/operations", f.admin, { requestId: randomUUID(), kind: "expense", amount: "200", label: "Ancienne", categoryId: autres, date: "2026-09-20" });
    const w = (await req("PUT", "/api/budget/account", f.admin, { opening: "1000", referenceDate: "2026-10-01", today: "2026-10-17" })).json();
    expect(w.account.balance).toBe(100000); // l'opération de septembre n'est pas retirée une seconde fois
    expect(w.warnings.join(" ")).toMatch(/1 opération antérieure/);
    const x = (await req("POST", "/api/budget/operations", f.admin, { requestId: randomUUID(), kind: "expense", amount: "50", label: "Erreur", categoryId: autres, date: "2026-10-01" })).json().operation;
    expect((await overview(f.admin)).account.balance).toBe(95000); // une opération de la date de référence compte
    expect((await req("POST", `/api/budget/operations/${x.id}/void`, f.admin, { rev: x.rev, reason: "saisie en double" })).json().operation.voided).toBe(true);
    expect((await overview(f.admin)).account.balance).toBe(100000);
    expect((await req("PUT", "/api/budget/account", f.admin, { opening: "1200", referenceDate: "2026-10-01", today: "2026-10-17" })).json().error).toBe("reason_required");
    await req("PUT", "/api/budget/account", f.admin, { opening: "1200", referenceDate: "2026-10-01", reason: "relevé bancaire", today: "2026-10-17" });
    const acc = (await req("GET", "/api/budget/account?today=2026-10-17", f.admin)).json();
    expect(acc.history.map((h: any) => h.opening)).toEqual([120000, 100000]);
    // le solde actuel n'est pas le solde d'un ancien mois : il est calculé à la date du jour
    expect((await overview(f.admin, "2026-09")).account.asOf).toBe("2026-10-17");
  });

  it("budgets mensuels : montant reconduit comme proposition, mois passés jamais réécrits, dépassement visible", async () => {
    const f = await family();
    await enable(f);
    await req("PUT", "/api/budget/settings", f.admin, { budgetsEnabled: true });
    const courses = (await req("GET", "/api/budget", f.admin)).json().categories.find((c: any) => c.key === "courses").id;
    await req("PUT", "/api/budget/budgets", f.admin, { month: "2026-10", categoryId: courses, amount: "100" });
    let nov = (await req("GET", "/api/budget/budgets?month=2026-11", f.admin)).json().budgets.find((b: any) => b.courses);
    expect(nov).toMatchObject({ planned: null, proposed: 10000 });
    await req("PUT", "/api/budget/budgets", f.admin, { month: "2026-11", categoryId: courses, amount: "150" });
    const oct = (await req("GET", "/api/budget/budgets?month=2026-10", f.admin)).json().budgets.find((b: any) => b.courses);
    expect(oct.planned).toBe(10000);
    await pay(f.admin, f.listId, "Marjane", "180", "2026-11-03");
    nov = (await req("GET", "/api/budget/budgets?month=2026-11", f.admin)).json().budgets.find((b: any) => b.courses);
    expect(nov).toMatchObject({ planned: 15000, spent: 18000, remaining: -3000 }); // dépassement visible, dépense enregistrée
  });

  it("droits distincts appliqués par le serveur : le personnel saisit les paiements sans voir solde, entrées ni autres dépenses", async () => {
    const f = await family();
    await enable(f);
    expect((await req("PUT", `/api/budget/rights/${f.staff.id}`, f.admin, { manage: false, view: true, record: true, edit: false })).json().error).toBe("staff_rights_limited");
    expect((await req("PUT", `/api/budget/rights/${f.staff.id}`, f.admin, { manage: false, view: false, record: true, edit: false })).statusCode).toBe(200);
    const autres = (await req("GET", "/api/budget", f.admin)).json().categories.find((c: any) => c.name === "Autres").id;
    await req("POST", "/api/budget/operations", f.admin, { requestId: randomUUID(), kind: "income", amount: "5000", label: "Salaire", date: "2026-10-02" });
    await req("POST", "/api/budget/operations", f.admin, { requestId: randomUUID(), kind: "expense", amount: "550", label: "Livres", categoryId: autres, date: "2026-10-02" });
    const adminPay = (await pay(f.admin, f.listId, "BIM", "100")).json().operation;
    const st = (await req("GET", "/api/budget", f.staff.c)).json();
    expect(st.rights).toEqual({ manage: false, view: false, record: true, edit: false });
    expect(st.categories.map((c: any) => c.key)).toEqual(["courses"]);
    const mine = (await pay(f.staff.c, f.listId, "Primeur", "130")).json().operation;
    expect(mine.canEdit).toBe(true);
    expect((await req("GET", "/api/budget/overview?month=2026-10&today=2026-10-17", f.staff.c)).statusCode).toBe(403);
    expect((await req("GET", "/api/budget/account?today=2026-10-17", f.staff.c)).statusCode).toBe(403);
    const hist = (await req("GET", "/api/budget/operations?month=2026-10", f.staff.c)).json();
    expect(hist.ownOnly).toBe(true);
    expect(hist.operations.map((o: any) => o.id)).toEqual([mine.id]);
    expect(hist.totals).toEqual({ expenses: 13000, incomes: 0, count: 1 });
    expect((await req("POST", "/api/budget/operations", f.staff.c, { requestId: randomUUID(), kind: "income", amount: "1", label: "x", date: "2026-10-02" })).statusCode).toBe(403);
    expect((await req("PATCH", `/api/budget/operations/${adminPay.id}`, f.staff.c, { rev: adminPay.rev, amount: "1" })).statusCode).toBe(403);
    expect((await req("PATCH", `/api/budget/operations/${mine.id}`, f.staff.c, { rev: mine.rev, amount: "120" })).statusCode).toBe(200);
    expect((await req("PATCH", `/api/budget/operations/${mine.id}`, f.staff.c, { rev: mine.rev + 1, categoryId: autres })).statusCode).toBe(403);
    // un parent autorisé à consulter voit tout, sans pouvoir modifier
    await req("PUT", `/api/budget/rights/${f.parent.id}`, f.admin, { manage: false, view: true, record: false, edit: false });
    const po = await overview(f.parent.c);
    expect(po.monthIncomes).toBe(500000);
    expect((await req("PATCH", `/api/budget/operations/${adminPay.id}`, f.parent.c, { rev: adminPay.rev, amount: "1" })).statusCode).toBe(403);
    // désactiver masque le module sans effacer ses données
    await req("PUT", "/api/family/features", f.admin, { budget: false });
    expect((await req("GET", "/api/budget/overview?month=2026-10&today=2026-10-17", f.admin)).json().error).toBe("budget_disabled");
    await enable(f);
    expect((await overview(f.admin)).monthExpenses).toBe(55000 + 10000 + 12000);
  });

  it("suppression définitive d'une famille : son budget part avec elle, les autres familles restent intactes", async () => {
    const keep = await family();
    await enable(keep);
    await pay(keep.admin, keep.listId, "BIM", "10");
    const gone = await family();
    await enable(gone);
    await pay(gone.admin, gone.listId, "BIM", "20");
    await req("PUT", "/api/budget/account", gone.admin, { opening: "5", referenceDate: "2026-10-01", today: "2026-10-17" });
    const me = (await req("GET", "/api/me", gone.admin)).json().me;
    const fam = (await db.query("SELECT id, code FROM families WHERE id = $1", [me.familyId])).rows[0];
    const before = Number((await db.query("SELECT count(*) AS n FROM finance_operations")).rows[0].n);
    await purgeFamily(db, testStore(), fam.id, fam.code);
    for (const t of ["finance_operations", "finance_operation_history", "finance_settings", "finance_categories", "finance_merchants", "finance_account_history"])
      expect(Number((await db.query(`SELECT count(*) AS n FROM ${t} WHERE family_id = $1`, [fam.id])).rows[0].n)).toBe(0);
    expect(Number((await db.query("SELECT count(*) AS n FROM finance_operations")).rows[0].n)).toBe(before - 1);
    expect((await overview(keep.admin)).monthCourses).toBe(1000);
  });
});
