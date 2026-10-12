import { randomUUID } from "node:crypto";
import pg from "pg";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { newFamily, uiLogin, type Family } from "./helpers";

/*
 * V3 · parcours personnel complet : sélection SANS liste (brouillon), validation qui crée la liste du jour sans droit supplémentaire,
 * confirmation pour rejoindre la liste, Liste du jour (demandé / acheté / à valider, progression, filtres), validations simultanées.
 * Mobile 360 et 390 px. Aucune donnée réelle : toutes les familles sont créées pour le test.
 */
const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const OUT = "../docs/captures/v3";
const { defaultBrowserType: _d, ...PIXEL } = devices["Pixel 7"];
const SIZES = [{ name: "360", width: 360, height: 740 }, { name: "390", width: 390, height: 844 }] as const;
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
async function phone(browser: Browser, baseURL: string | undefined, s: { width: number; height: number }) {
  const ctx = await browser.newContext({ ...PIXEL, viewport: { width: s.width, height: s.height }, baseURL });
  await ctx.addInitScript(V3_ON);
  return { ctx, page: await ctx.newPage() };
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const activeList = async (f: Family) => (await (await f.adil.get("/api/lists/active")).json()).list;
const tile = (page: Page, f: Family, name: string) => page.getByTestId(`v3-${f.products[name]}`);
async function pick(page: Page, f: Family, name: string, qty?: string) {
  await tile(page, f, name).click();
  if (qty) await page.getByTestId("sheet-input").fill(qty);
  await page.getByTestId("sheet-confirm").click();
  await expect(tile(page, f, name)).toHaveAttribute("data-state", "unsaved");
}
async function setBase(productId: string, amount: string, kind: "observed" | "rounded", refUnit = "kg") {
  const [{ catalog_key: key }] = await sql("SELECT catalog_key FROM products WHERE id = $1", [productId]);
  await sql(
    `INSERT INTO base_prices (origin, key, amount, ref_qty, ref_unit, packaging, kind, source, observed_on) VALUES ('initial',$1,$2,1,$3,NULL,$4,'capture de test','2026-10-01')
     ON CONFLICT (origin, key) DO UPDATE SET amount = $2, kind = $4, ref_unit = $3`,
    [key, amount, refUnit, kind],
  );
  await sql("UPDATE families SET catalog_rev = catalog_rev + 1");
}

for (const s of SIZES) {
  test.describe(`mobile ${s.name} px`, () => {
    test("sélection sans liste en brouillon, validation qui crée la liste, confirmation, Liste du jour et progression ; aucun droit en plus", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f);
      await expect(page.getByTestId("staff-shell")).toBeVisible();
      // nombre réel d'articles accessibles (jamais un chiffre fixe)
      const cat = (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).filter((p: any) => p.active);
      await expect(page.getByTestId("v3-count")).toHaveText(`${cat.length} articles`);
      await expect(page.getByTestId("no-list-v3")).toBeVisible();
      for (const m of ["list", "squares", "cards"]) await expect(page.getByTestId(`v3-mode-${m}`)).toBeVisible(); // les trois modes restent visibles
      expect(await activeList(f)).toBeNull();
      await pick(page, f, "Tomates", "1,5");
      await pick(page, f, "Riz");
      await expect(page.getByTestId("validate")).toHaveText("Valider 2 modifications");
      expect(await activeList(f)).toBeNull(); // brouillon : aucune liste créée, aucune demande envoyée
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/personnel-sans-liste-brouillon-${s.name}.png` });
      // le brouillon survit à la fermeture de l'application
      await page.reload();
      await expect(tile(page, f, "Tomates")).toHaveAttribute("data-state", "unsaved");
      // validation : la liste est créée par le personnel, avec ses seules demandes
      await page.getByTestId("validate").click();
      await expect(page.getByTestId("v3-confirm-text")).toContainText("Demande enregistrée : 2 articles");
      await expect(page.getByTestId("v3-see-list")).toBeVisible();
      await page.screenshot({ path: `${OUT}/personnel-validation-${s.name}.png` });
      const list = await activeList(f);
      expect(list.items.map((i: any) => `${i.name}:${i.quantity}`).sort()).toEqual(["Riz:1", "Tomates:1.5"]);
      expect((await sql("SELECT p.login, p.role FROM lists l JOIN profiles p ON p.id = l.created_by WHERE l.id = $1", [list.id]))[0].role).toBe("staff");
      // aucun droit supplémentaire : ni création directe, ni clôture, ni achat
      expect((await f.staff.post("/api/lists")).status()).toBe(403);
      expect((await f.staff.post(`/api/lists/${list.id}/close`)).status()).toBe(403);
      expect((await f.staff.post(`/api/lists/${list.id}/ops`, { data: { ops: [{ opId: randomUUID(), type: "purchase", itemId: list.items[0].id }] } })).status()).toBe(403);
      // rejoindre la liste du jour
      await page.getByTestId("v3-see-list").click();
      await expect(page.getByTestId("staff-list")).toBeVisible();
      await expect(page.getByTestId("sl-progress-text")).toHaveText("0 sur 2 acheté");
      await expect(page.getByTestId("sl-pct")).toHaveText("0 %");
      await expect(page.getByTestId(`sl-badge-${f.products["Tomates"]}`)).toHaveText("Demandé");
      await expect(page.getByTestId(`sl-qty-${f.products["Tomates"]}`)).toHaveText("1,5 kg");
      await expect(page.getByTestId("sl-filter-all")).toHaveText("Tous (2)");
      await expect(page.getByTestId("sl-filter-todo")).toHaveText("À acheter (2)");
      await expect(page.getByTestId("sl-filter-done")).toHaveText("Achetés (0)");
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/liste-du-jour-demandes-${s.name}.png` });
      // un parent/administrateur marque l'achat : le personnel voit « Acheté » et la progression, sans bouton d'achat
      const it = list.items.find((i: any) => i.name === "Tomates");
      expect((await f.adil.post(`/api/lists/${list.id}/ops`, { data: { ops: [{ opId: randomUUID(), type: "purchase", itemId: it.id }] } })).status()).toBe(200);
      await expect(page.getByTestId(`sl-badge-${f.products["Tomates"]}`)).toHaveText("Acheté", { timeout: 20_000 });
      await expect(page.getByTestId("sl-progress-text")).toHaveText("1 sur 2 acheté");
      await expect(page.getByTestId("sl-pct")).toHaveText("50 %");
      expect(await page.locator("[data-testid^='buy-']").count()).toBe(0); // le personnel ne marque aucun achat
      await page.screenshot({ path: `${OUT}/liste-du-jour-progression-${s.name}.png` });
      // filtres
      await page.getByTestId("sl-filter-todo").click();
      await expect(page.getByTestId(`sl-row-${f.products["Riz"]}`)).toBeVisible();
      await expect(page.getByTestId(`sl-row-${f.products["Tomates"]}`)).toHaveCount(0);
      await page.getByTestId("sl-filter-done").click();
      await expect(page.getByTestId(`sl-row-${f.products["Tomates"]}`)).toBeVisible();
      await expect(page.getByTestId(`sl-row-${f.products["Riz"]}`)).toHaveCount(0);
      await page.getByTestId("sl-filter-all").click();
      // nouveau choix non validé : « À valider », hors progression ; puis validation depuis la liste
      await page.getByTestId("stafftab-choose").click();
      await pick(page, f, "Lait");
      await page.getByTestId("stafftab-list").click();
      await expect(page.getByTestId("sl-drafts")).toBeVisible();
      await expect(page.getByTestId(`sl-badge-${f.products["Lait"]}`)).toHaveText("À valider");
      await expect(page.getByTestId("sl-progress-text")).toHaveText("1 sur 2 acheté"); // le brouillon ne compte pas
      await page.screenshot({ path: `${OUT}/liste-du-jour-a-valider-${s.name}.png` });
      await page.getByTestId("sl-validate").click();
      await expect(page.getByTestId(`sl-badge-${f.products["Lait"]}`)).toHaveText("Demandé");
      await expect(page.getByTestId("sl-progress-text")).toHaveText("1 sur 3 acheté");
      await expect(page.getByTestId("sl-pct")).toHaveText("33 %");
      await ctx.close();
    });
  });
}

test("deux appareils qui valident en même temps sans liste : une seule liste, aucune demande perdue", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  expect((await f.adil.post("/api/profiles", { data: { displayName: "Paul", login: "paul", role: "staff", secret: "573918", secretConfirm: "573918", city: "Casablanca" } })).status()).toBe(201);
  const a = await phone(browser, baseURL, SIZES[1]);
  const b = await phone(browser, baseURL, SIZES[1]);
  await uiLogin(a.page, f);
  await uiLogin(b.page, f, "paul", "573918");
  await pick(a.page, f, "Tomates", "2");
  await pick(b.page, f, "Riz");
  await pick(b.page, f, "Lait");
  await Promise.all([a.page.getByTestId("validate").click(), b.page.getByTestId("validate").click()]);
  await expect(a.page.getByTestId("v3-confirm")).toBeVisible();
  await expect(b.page.getByTestId("v3-confirm")).toBeVisible();
  const [fam] = await sql("SELECT family_id FROM profiles WHERE login = 'paul' ORDER BY created_at DESC LIMIT 1");
  expect(await sql("SELECT id FROM lists WHERE family_id = $1 AND status = 'active'", [fam.family_id])).toHaveLength(1); // jamais deux listes en cours
  expect((await activeList(f)).items.map((i: any) => i.name).sort()).toEqual(["Lait", "Riz", "Tomates"]); // aucune demande perdue
  // les deux téléphones voient la même liste
  await a.page.getByTestId("v3-see-list").click();
  await expect(a.page.getByTestId("sl-filter-all")).toHaveText("Tous (3)", { timeout: 20_000 });
  await a.ctx.close();
  await b.ctx.close();
});

test("validation hors connexion sans liste : demande gardée sur le téléphone, envoyée une seule fois au retour du réseau", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  const { ctx, page } = await phone(browser, baseURL, SIZES[1]);
  await uiLogin(page, f);
  await expect(page.getByTestId("v3-selection")).toBeVisible();
  await ctx.setOffline(true);
  await pick(page, f, "Tomates", "1,25");
  await page.getByTestId("validate").click();
  await expect(page.getByTestId("v3-confirm-text")).toContainText("gardé sur ce téléphone"); // jamais annoncé comme enregistré
  expect(await activeList(f)).toBeNull();
  await ctx.setOffline(false);
  await page.evaluate(() => (window as any).__engine.flush());
  await expect.poll(async () => ((await activeList(f))?.items ?? []).map((i: any) => `${i.name}:${i.quantity}`), { timeout: 30_000 }).toEqual(["Tomates:1.25"]);
  await expect(page.getByTestId("v3-confirm-text")).toContainText("Demande enregistrée", { timeout: 20_000 });
  await page.evaluate(() => (window as any).__engine.flush());
  expect((await activeList(f)).items).toHaveLength(1); // une seule fois
  await ctx.close();
});

test("nature du prix : pastille « observé » / « estimé » discrète, détail à la demande ; prix de la famille sans pastille", async ({ browser, playwright, baseURL }) => {
  await sql("DELETE FROM base_prices");
  const f = await newFamily(playwright, baseURL!);
  await setBase(f.products["Tomates"]!, "9.90", "observed");
  await setBase(f.products["Pommes"]!, "25", "rounded");
  expect((await f.adil.put("/api/me/prefs", { data: { showPrices: true, showTotals: false } })).status()).toBe(200);
  expect((await f.staff.put("/api/me/prefs", { data: { showPrices: true, showTotals: false } })).status()).toBe(200);
  await f.adil.put(`/api/products/${f.products["Poires"]}/price`, { data: { amount: "30", refQty: 1, refUnit: "kg" } });
  const { ctx, page } = await phone(browser, baseURL, SIZES[1]);
  await uiLogin(page, f, "adil", "482913");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("seg-catalog").click();
  await page.getByTestId("price-Tomates").click();
  await expect(page.getByTestId("price-nature")).toHaveText("observé");
  await expect(page.getByTestId("price-nature-detail")).toHaveCount(0); // détail seulement à la demande
  await page.getByTestId("price-nature-more").click();
  await expect(page.getByTestId("price-nature-detail")).toContainText("Prix observé le 01/10/2026");
  await page.screenshot({ path: `${OUT}/prix-nature-observe-390.png` });
  await page.mouse.click(10, 10); // toucher hors de la fenêtre la ferme
  await page.getByTestId("price-Pommes").click();
  await expect(page.getByTestId("price-nature")).toHaveText("estimé");
  await page.getByTestId("price-nature-more").click();
  await expect(page.getByTestId("price-nature-detail")).toContainText("Estimation arrondie");
  await page.screenshot({ path: `${OUT}/prix-nature-estime-390.png` });
  await page.mouse.click(10, 10);
  await page.getByTestId("price-Poires").click();
  await expect(page.getByTestId("price-nature")).toHaveCount(0); // prix de la famille : pas de pastille
  await page.getByTestId("price-nature-more").click();
  await expect(page.getByTestId("price-nature-detail")).toHaveText("Prix saisi par votre famille.");
  await ctx.close();
  // la pastille aussi dans le panneau de quantité (V3), pour le personnel
  expect((await f.adil.post("/api/lists")).status()).toBe(201);
  const st = await phone(browser, baseURL, SIZES[1]);
  await uiLogin(st.page, f);
  await tile(st.page, f, "Pommes").click();
  await expect(st.page.getByTestId("sheet-nature")).toHaveText("estimé");
  await st.ctx.close();
});
