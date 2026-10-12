import { randomUUID } from "node:crypto";
import pg from "pg";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { newFamily, uiLogin, type Family } from "./helpers";

/*
 * V3 · personnel : isolation du brouillon (famille, profil), demandes hors connexion envoyées après la clôture ou la suppression de la liste,
 * progression sur les seuls articles enregistrés, état vide propre. Aucune donnée réelle.
 */
const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const { defaultBrowserType: _d, ...PIXEL } = devices["Pixel 7"];
const V3_ON = `try { localStorage.setItem("smartcourse.v3", "on"); } catch {}`;

async function sql<T = any>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}
async function phone(browser: Browser, baseURL: string | undefined) {
  const ctx = await browser.newContext({ ...PIXEL, viewport: { width: 390, height: 844 }, baseURL });
  await ctx.addInitScript(V3_ON);
  return { ctx, page: await ctx.newPage() };
}
const activeList = async (f: Family) => (await (await f.adil.get("/api/lists/active")).json()).list;
const tile = (page: Page, f: Family, name: string) => page.getByTestId(`v3-${f.products[name]}`);
async function pick(page: Page, f: Family, name: string, qty?: string) {
  await tile(page, f, name).click();
  if (qty) await page.getByTestId("sheet-input").fill(qty);
  await page.getByTestId("sheet-confirm").click();
  await expect(tile(page, f, name)).toHaveAttribute("data-state", "unsaved");
}
const logout = (page: Page) => page.evaluate(() => (window as any).__engine.logout());
const addOp = (f: Family, name: string, quantity = 1) => ({ opId: randomUUID(), type: "add", productId: f.products[name]!, quantity });

test("brouillon isolé par profil et par famille : aucun mélange au changement de compte, rien d'effacé sans le dire", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  expect((await f.adil.post("/api/profiles", { data: { displayName: "Paul", login: "paul", role: "staff", secret: "573918", secretConfirm: "573918", city: "Casablanca" } })).status()).toBe(201);
  const g = await newFamily(playwright, baseURL!);
  const { ctx, page } = await phone(browser, baseURL);
  await uiLogin(page, f); // marie
  await pick(page, f, "Tomates", "2");
  await logout(page);
  // un autre profil de la même famille sur le même téléphone : aucun brouillon de Marie
  await uiLogin(page, f, "paul", "573918");
  await expect(page.getByTestId("v3-selection")).toBeVisible();
  await expect(tile(page, f, "Tomates")).toHaveAttribute("data-state", "off");
  await expect(page.getByTestId("validate")).toBeDisabled();
  await pick(page, f, "Riz");
  await logout(page);
  // Marie retrouve SON brouillon, sans celui de Paul
  await uiLogin(page, f);
  await expect(tile(page, f, "Tomates")).toHaveAttribute("data-state", "unsaved");
  await expect(page.getByTestId(`v3qty-${f.products["Tomates"]}`)).toContainText("2 kg");
  await expect(tile(page, f, "Riz")).toHaveAttribute("data-state", "off");
  expect(await activeList(f)).toBeNull(); // rien n'a été envoyé par erreur
  await logout(page);
  // une AUTRE famille sur ce téléphone : rien de la première n'y entre, et l'effacement est annoncé
  await uiLogin(page, g);
  await expect(page.getByTestId("v3-selection")).toBeVisible();
  await expect(tile(page, g, "Tomates")).toHaveAttribute("data-state", "off");
  await expect(page.getByTestId("notice")).toContainText("non envoyée");
  await expect(page.getByTestId("notice")).toContainText("d'une autre famille");
  expect(await activeList(g)).toBeNull();
  expect(await activeList(f)).toBeNull();
  await ctx.close();
});

test("demande hors connexion envoyée après la clôture de la liste : rien n'est ajouté à l'archive, rien de perdu, reprise proposée", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  const L = (await (await f.adil.post("/api/lists")).json()).list.id as string;
  expect((await f.adil.post(`/api/lists/${L}/ops`, { data: { ops: [addOp(f, "Tomates")] } })).status()).toBe(200);
  const { ctx, page } = await phone(browser, baseURL);
  await uiLogin(page, f);
  await expect(page.getByTestId("v3-selection")).toBeVisible();
  await ctx.setOffline(true);
  await pick(page, f, "Lait", "2");
  await page.getByTestId("validate").click();
  await expect(page.getByTestId("v3-confirm-text")).toContainText("Envoi en attente");
  await expect(page.getByTestId("sync-state")).toHaveText("Envoi en attente");
  await expect(page.getByTestId(`v3status-${f.products["Lait"]}`)).toHaveText("Envoi en attente"); // jamais confondu avec « À acheter »
  // pendant ce temps, la liste est clôturée
  expect((await f.adil.post(`/api/lists/${L}/close`)).status()).toBe(200);
  await ctx.setOffline(false);
  await page.evaluate(() => (window as any).__engine.flush());
  await expect(page.getByTestId("banner-orphan")).toBeVisible({ timeout: 20_000 }); // la sélection n'est pas perdue : reprise proposée
  const archived = await (await f.adil.get(`/api/lists/${L}`)).json();
  expect(archived.list.status).toBe("archived");
  expect(archived.list.items.map((i: any) => i.name)).toEqual(["Tomates"]); // rien d'ajouté à l'archive
  expect(await activeList(f)).toBeNull(); // aucune liste recréée à notre insu
  // reprise explicite → sélection en cours → validation : une NOUVELLE liste, pas l'archive
  await page.getByTestId("orphan-resume").click();
  await expect(tile(page, f, "Lait")).toHaveAttribute("data-state", "unsaved");
  await page.getByTestId("validate").click();
  await expect(page.getByTestId("v3-confirm-text")).toContainText("Sélection enregistrée dans la liste");
  const now = await activeList(f);
  expect(now.id).not.toBe(L);
  expect(now.items.map((i: any) => i.name)).toEqual(["Lait"]);
  expect((await (await f.adil.get(`/api/lists/${L}`)).json()).list.items).toHaveLength(1);
  await ctx.close();
});

test("demande hors connexion envoyée après la suppression de la liste : aucune recréation, aucune perte silencieuse", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  const L = (await (await f.adil.post("/api/lists")).json()).list.id as string;
  expect((await f.adil.post(`/api/lists/${L}/ops`, { data: { ops: [addOp(f, "Tomates")] } })).status()).toBe(200);
  const { ctx, page } = await phone(browser, baseURL);
  await uiLogin(page, f);
  await expect(page.getByTestId("v3-selection")).toBeVisible();
  await ctx.setOffline(true);
  await pick(page, f, "Riz");
  await page.getByTestId("validate").click();
  await expect(page.getByTestId("sync-state")).toHaveText("Envoi en attente");
  // clôture puis SUPPRESSION de la liste (administrateur)
  const items = (await (await f.adil.get(`/api/lists/${L}`)).json()).list.items;
  await f.adil.post(`/api/lists/${L}/ops`, { data: { ops: [{ opId: randomUUID(), type: "purchase", itemId: items[0].id }] } });
  expect((await f.adil.post(`/api/lists/${L}/close`)).status()).toBe(200);
  expect((await f.adil.delete(`/api/lists/${L}`)).status()).toBe(200);
  await ctx.setOffline(false);
  await page.evaluate(() => (window as any).__engine.flush());
  await expect(page.getByTestId("notice")).toContainText("n'existe plus", { timeout: 20_000 }); // dit clairement ce qui s'est passé
  await expect(page.getByTestId("banner-orphan")).toBeVisible(); // et propose de reprendre
  expect((await sql("SELECT count(*)::int AS n FROM lists WHERE id = $1", [L]))[0].n).toBe(0); // la liste supprimée n'est jamais recréée
  expect(await activeList(f)).toBeNull(); // aucune nouvelle liste non demandée
  await page.getByTestId("orphan-resume").click();
  await expect(tile(page, f, "Riz")).toHaveAttribute("data-state", "unsaved");
  await ctx.close();
});

test("progression sur les seuls articles enregistrés, état vide propre ; envoi en attente non compté", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  const { ctx, page } = await phone(browser, baseURL);
  await uiLogin(page, f);
  await page.getByTestId("stafftab-list").click();
  // aucun article : message simple, ni barre, ni filtre, ni pourcentage
  await expect(page.getByTestId("sl-empty")).toBeVisible();
  for (const t of ["sl-progress", "sl-filter-all", "sl-pct"]) await expect(page.getByTestId(t)).toHaveCount(0);
  // liste en cours mais vide : même état vide
  expect((await f.adil.post("/api/lists")).status()).toBe(201);
  await expect(page.getByTestId("sl-empty")).toBeVisible();
  await expect(page.getByTestId("sl-progress")).toHaveCount(0);
  // un brouillon seul : « Sélection en cours », pas de progression
  await page.getByTestId("stafftab-choose").click();
  await pick(page, f, "Tomates");
  await page.getByTestId("stafftab-list").click();
  await expect(page.getByTestId(`sl-badge-${f.products["Tomates"]}`)).toHaveText("Sélection en cours");
  await expect(page.getByTestId("sl-progress")).toHaveCount(0);
  await expect(page.getByTestId("sl-empty")).toHaveCount(0);
  // validé hors connexion : « Envoi en attente », toujours pas de progression
  await ctx.setOffline(true);
  await page.getByTestId("sl-validate").click();
  await expect(page.getByTestId("sl-pending")).toBeVisible();
  await expect(page.getByTestId(`sl-badge-${f.products["Tomates"]}`)).toHaveText("Envoi en attente");
  await expect(page.getByTestId("sl-progress")).toHaveCount(0);
  await expect(page.getByTestId("sl-pending-note")).toContainText("envoyé dès le retour du réseau");
  expect((await activeList(f)).items).toHaveLength(0); // le serveur n'a rien reçu
  // retour du réseau : enregistré, compté
  await ctx.setOffline(false);
  await page.evaluate(() => (window as any).__engine.flush());
  await expect(page.getByTestId(`sl-badge-${f.products["Tomates"]}`)).toHaveText("À acheter", { timeout: 20_000 });
  await expect(page.getByTestId("sl-progress-text")).toHaveText("0 sur 1 acheté");
  await expect(page.getByTestId("sl-pending")).toHaveCount(0);
  await ctx.close();
});
