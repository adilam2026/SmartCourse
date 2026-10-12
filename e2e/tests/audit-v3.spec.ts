import { devices, expect, test } from "@playwright/test";
import { newFamily, uiLogin } from "./helpers";

/* Vérifications d'audit V3 : ce qui est affirmé dans l'état des lieux est ici prouvé (ou son contraire constaté). */
const OUT = "../docs/captures/v3";
const { defaultBrowserType: _d, ...PIXEL } = devices["Pixel 7"];
const V3_ON = `try { localStorage.setItem("smartcourse.v3", "on"); } catch {}`;

test("V3 : les quantités choisies sont conservées quand on change d'affichage ou de réglage des prix ; articles sélectionnés identifiables", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  expect((await f.adil.post("/api/lists")).status()).toBe(201);
  await f.adil.put(`/api/products/${f.products["Tomates"]}/price`, { data: { amount: "8", refQty: 1, refUnit: "kg" } });
  await f.staff.put("/api/me/prefs", { data: { showPrices: false, showTotals: false } });
  const ctx = await browser.newContext({ ...PIXEL, viewport: { width: 390, height: 844 }, baseURL });
  await ctx.addInitScript(V3_ON);
  const page = await ctx.newPage();
  await uiLogin(page, f);
  const tom = page.getByTestId(`v3-${f.products["Tomates"]}`);
  await tom.click();
  await page.getByTestId("sheet-input").fill("1,5");
  await page.getByTestId("sheet-confirm").click();
  await expect(page.getByTestId(`v3qty-${f.products["Tomates"]}`)).toContainText("1,5 kg");
  for (const m of ["list", "cards", "squares"]) {
    await page.getByTestId(`v3-mode-${m}`).click();
    await expect(page.getByTestId(`v3qty-${f.products["Tomates"]}`)).toContainText("1,5 kg"); // identique dans les trois affichages
    await expect(tom).toHaveAttribute("data-state", "unsaved");
  }
  // changement du réglage des prix : la quantité ne bouge pas, le prix apparaît (unitaire seulement)
  await page.evaluate(() => (window as any).__engine.setPrefs(true, false));
  await expect(page.getByTestId(`v3price-${f.products["Tomates"]}`)).toContainText("8,00 DH / kg");
  await expect(page.getByTestId(`v3qty-${f.products["Tomates"]}`)).toContainText("1,5 kg");
  await page.evaluate(() => (window as any).__engine.setPrefs(false, false));
  await expect(page.getByTestId(`v3qty-${f.products["Tomates"]}`)).toContainText("1,5 kg");
  await page.getByTestId("v3-mode-list").click();
  await page.screenshot({ path: `${OUT}/selection-article-identifie-390.png` });
  await ctx.close();
});

test("personnel sans liste : consultation seule, aucune sélection possible (constat), aucune liste créée", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  const ctx = await browser.newContext({ ...PIXEL, viewport: { width: 390, height: 844 }, baseURL });
  await ctx.addInitScript(V3_ON);
  const page = await ctx.newPage();
  await uiLogin(page, f);
  await expect(page.getByTestId("v3-selection")).toBeVisible();
  expect(await page.locator(".v3tile").count()).toBeGreaterThan(30);
  await page.locator(".v3tile").first().click({ force: true });
  await expect(page.getByTestId("qty-sheet")).toHaveCount(0); // on ne peut pas sélectionner sans liste
  await expect(page.getByTestId("no-list")).toBeVisible();
  expect((await (await f.adil.get("/api/lists/active")).json()).list).toBeNull(); // rien n'a été créé
  await page.screenshot({ path: `${OUT}/personnel-sans-liste-390.png` });
  await ctx.close();
});

test("V3 : la vue « Par catégories » de la V2 n'existe pas (navigation par pastilles et recherche)", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  expect((await f.adil.post("/api/lists")).status()).toBe(201);
  const ctx = await browser.newContext({ ...PIXEL, viewport: { width: 390, height: 844 }, baseURL });
  await ctx.addInitScript(V3_ON);
  const page = await ctx.newPage();
  await uiLogin(page, f);
  await expect(page.getByTestId("view-categories")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Catégories" }).getByRole("button").first()).toBeVisible();
  await page.getByTestId("catalog-search").fill("lait");
  await expect(page.getByTestId("search-results").first()).toBeVisible();
  await ctx.close();
});
