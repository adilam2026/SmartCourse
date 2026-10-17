import { randomUUID } from "node:crypto";
import pg from "pg";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { newFamily, uiLogin, type Family } from "./helpers";

/*
 * Étapes 3 et 4 : « Gestion des prix » (écran dédié) et catalogue administrateur (onglets Tous / Affichés / Masqués, interrupteurs).
 * Mobile 360 et 390 px. Aucune donnée réelle : familles créées pour le test.
 */
const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const OUT = "../docs/captures/v3";
const { defaultBrowserType: _d, ...PIXEL } = devices["Pixel 7"];
const SIZES = [{ name: "360", width: 360, height: 740 }, { name: "390", width: 390, height: 844 }] as const;

async function sql<T = any>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}
async function setBase(productId: string, amount: string, kind: "observed" | "rounded") {
  const [{ catalog_key: key }] = await sql("SELECT catalog_key FROM products WHERE id = $1", [productId]);
  await sql(
    `INSERT INTO base_prices (origin, key, amount, ref_qty, ref_unit, packaging, kind, source, observed_on) VALUES ('initial',$1,$2,1,'kg',NULL,$3,'capture de test','2026-10-01')
     ON CONFLICT (origin, key) DO UPDATE SET amount = $2, kind = $3`,
    [key, amount, kind],
  );
  await sql("UPDATE families SET catalog_rev = catalog_rev + 1");
}
async function phone(browser: Browser, baseURL: string | undefined, s: { width: number; height: number }) {
  const ctx = await browser.newContext({ ...PIXEL, viewport: { width: s.width, height: s.height }, baseURL });
  return { ctx, page: await ctx.newPage() };
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function inside(page: Page, testid: string) {
  const b = (await page.getByTestId(testid).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
}
const catalog = async (f: Family, all = false) => (await (await f.adil.get(`/api/catalog${all ? "?includeInactive=1" : ""}`)).json()).categories.flatMap((c: any) => c.products) as any[];
async function openSettings(page: Page, entry: string) {
  await page.getByTestId("tab-settings").click();
  await page.getByTestId(entry).click();
}

for (const s of SIZES) {
  test.describe(`mobile ${s.name} px`, () => {
    test("Gestion des prix : entrée du menu, lignes compactes, recherche, catégories, prix manquants, modification rapide ; archives et prix personnalisés préservés", async ({ browser, playwright, baseURL }) => {
      await sql("DELETE FROM base_prices");
      const f = await newFamily(playwright, baseURL!);
      await setBase(f.products["Tomates"]!, "9.90", "observed");
      await setBase(f.products["Pommes"]!, "25", "rounded");
      await f.adil.put(`/api/products/${f.products["Poires"]}/price`, { data: { amount: "30", refQty: 1, refUnit: "kg" } });
      // archive témoin : Tomates validée au prix de 9,90 puis liste close
      const L = (await (await f.adil.post("/api/lists")).json()).list.id as string;
      await f.adil.post(`/api/lists/${L}/ops`, { data: { ops: [{ opId: randomUUID(), type: "add", productId: f.products["Tomates"], quantity: 1 }] } });
      expect((await f.adil.post(`/api/lists/${L}/close`)).status()).toBe(200);
      const before = (await (await f.adil.get(`/api/lists/${L}`)).json()).list.items[0].price;
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f, "adil", "482913"); // les prix ne sont PAS activés dans l'affichage de ce profil
      await page.getByTestId("tab-settings").click();
      await expect(page.getByTestId("seg-pricing")).toContainText("Gestion des prix"); // entrée dédiée du menu
      await page.getByTestId("seg-pricing").click();
      await expect(page.getByTestId("prices-admin")).toBeVisible();
      // lignes compactes : photo, nom, prix et référence d'unité
      await expect(page.getByTestId("pa-amount-Tomates")).toHaveText("9,90 DH / kg");
      await expect(page.getByTestId("pa-row-Tomates")).toContainText("observé"); // nature, discrète
      await expect(page.getByTestId("pa-row-Pommes")).toContainText("estimé");
      await expect(page.getByTestId("pa-amount-Poires")).toHaveText("30,00 DH / kg");
      await expect(page.getByTestId("pa-row-Poires")).not.toContainText(/observé|estimé/); // prix de la famille
      expect((await page.getByTestId("pa-row-Tomates").boundingBox())!.height).toBeLessThanOrEqual(90);
      expect(await noOverflow(page)).toBe(true);
      // prix manquant : signalé, jamais zéro ; compteur réel
      const all = (await catalog(f)).filter((p) => p.active);
      const missing = all.filter((p) => !p.price);
      expect(missing.length).toBeGreaterThan(5);
      const miss = missing[0].name as string;
      await expect(page.getByTestId(`pa-price-${miss}`)).toContainText("Prix manquant");
      await expect(page.getByTestId(`pa-row-${miss}`)).toHaveAttribute("data-price", "missing");
      await expect(page.getByTestId("pa-todo")).toContainText(`(${all.filter((p) => !p.price).length})`);
      await page.screenshot({ path: `${OUT}/gestion-prix-${s.name}.png` });
      await page.getByTestId("pa-todo").click();
      await expect(page.getByTestId("pa-row-Tomates")).toHaveCount(0);
      await expect(page.getByTestId(`pa-row-${miss}`)).toBeVisible();
      await page.screenshot({ path: `${OUT}/gestion-prix-a-completer-${s.name}.png` });
      await page.getByTestId("pa-todo").click();
      // recherche (accents et casse indifférents) et catégories
      await page.getByTestId("pa-search").fill("tomat");
      await expect(page.getByTestId("pa-row-Tomates")).toBeVisible();
      await expect(page.getByTestId("pa-row-Poires")).toHaveCount(0);
      await page.getByTestId("pa-search").fill("");
      await page.getByTestId("pa-cat").selectOption("fruits");
      await expect(page.getByTestId("pa-row-Pommes")).toBeVisible();
      await expect(page.getByTestId("pa-row-Tomates")).toHaveCount(0);
      for (const t of ["pa-cat", "pa-todo", "pa-search", "pa-sync"]) await inside(page, t); // aucun filtre coupé
      await page.getByTestId("pa-cat").selectOption("");
      // modification rapide : la petite fenêtre garde référence et règles ; le prix manquant est comblé
      await page.getByTestId(`pa-price-${miss}`).click();
      await expect(page.getByTestId("price-ref")).toContainText(miss);
      await page.getByTestId("price-amount").fill("3,5");
      if (await page.getByTestId("price-packaging").count()) await page.getByTestId("price-packaging").fill("500 g");
      await page.screenshot({ path: `${OUT}/gestion-prix-modification-${s.name}.png` });
      await page.getByTestId("price-save").click();
      await expect(page.getByTestId("price-dialog")).toHaveCount(0);
      await expect(page.getByTestId(`pa-row-${miss}`)).not.toHaveAttribute("data-price", "missing");
      expect((await catalog(f)).find((p) => p.name === miss).price).toMatchObject({ amount: "3.50", source: "family" });
      // le prix de Tomates change : l'archive garde le sien ; le prix personnalisé de Poires est intact
      await page.getByTestId("pa-price-Tomates").click();
      await page.getByTestId("price-amount").fill("11");
      await page.getByTestId("price-save").click();
      await expect(page.getByTestId("pa-amount-Tomates")).toHaveText("11,00 DH / kg");
      expect((await (await f.adil.get(`/api/lists/${L}`)).json()).list.items[0].price.amount).toBe(before.amount); // ancienne liste inchangée
      expect((await catalog(f)).find((p) => p.name === "Poires").price).toMatchObject({ amount: "30.00", source: "family" });
      // le personnel et les autres rôles n'ont pas cet écran
      await ctx.close();
      const st = await phone(browser, baseURL, s);
      await uiLogin(st.page, f);
      await expect(st.page.getByTestId("tab-settings")).toHaveCount(0);
      await st.ctx.close();
    });

    test("catalogue administrateur : onglets Tous / Affichés / Masqués avec compteurs réels, interrupteur réversible, historiques intacts", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await f.adil.put(`/api/products/${f.products["Tomates"]}/price`, { data: { amount: "9", refQty: 1, refUnit: "kg" } });
      const L = (await (await f.adil.post("/api/lists")).json()).list.id as string;
      await f.adil.post(`/api/lists/${L}/ops`, { data: { ops: [{ opId: randomUUID(), type: "add", productId: f.products["Tomates"], quantity: 2 }] } });
      expect((await f.adil.post(`/api/lists/${L}/close`)).status()).toBe(200);
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f, "adil", "482913");
      await openSettings(page, "seg-catalog");
      const all0 = await catalog(f, true);
      const n = all0.length;
      const hidden0 = all0.filter((p) => !p.active).length;
      await expect(page.getByTestId("cat-tab-all")).toHaveText(`Tous (${n})`);
      await expect(page.getByTestId("cat-tab-shown")).toHaveText(`Affichés (${n - hidden0})`);
      await expect(page.getByTestId("cat-tab-hidden")).toHaveText(`Masqués (${hidden0})`);
      for (const t of ["cat-tab-all", "cat-tab-shown", "cat-tab-hidden", "active-Tomates", "edit-Tomates"]) await inside(page, t);
      expect(await noOverflow(page)).toBe(true);
      // interrupteur accessible, libellés orientés utilisateur
      const sw = page.getByTestId("active-Tomates");
      await expect(sw).toHaveAttribute("role", "switch");
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("state-Tomates")).toHaveText("Affiché");
      expect((await page.getByTestId("prod-Tomates").boundingBox())!.height).toBeLessThanOrEqual(120); // deux lignes compactes (nom + interrupteur, puis actions)
      await page.screenshot({ path: `${OUT}/catalogue-onglets-${s.name}.png` });
      // masquer
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await expect(page.getByTestId("state-Tomates")).toHaveText("Masqué");
      await expect(page.getByTestId("cat-tab-shown")).toHaveText(`Affichés (${n - hidden0 - 1})`);
      await expect(page.getByTestId("cat-tab-hidden")).toHaveText(`Masqués (${hidden0 + 1})`);
      await expect(page.getByTestId("cat-tab-all")).toHaveText(`Tous (${n})`); // rien n'est supprimé
      expect((await catalog(f, true)).find((p) => p.name === "Tomates").active).toBe(false);
      await page.getByTestId("cat-tab-shown").click();
      await expect(page.getByTestId("prod-Tomates")).toHaveCount(0);
      await page.getByTestId("cat-tab-hidden").click();
      await expect(page.getByTestId("prod-Tomates")).toBeVisible();
      await page.screenshot({ path: `${OUT}/catalogue-masques-${s.name}.png` });
      // masqué : plus proposé au personnel ; l'ancienne liste et le prix de la famille sont intacts
      expect((await catalog(f)).some((p) => p.name === "Tomates")).toBe(false);
      const arch = (await (await f.adil.get(`/api/lists/${L}`)).json()).list;
      expect(arch.items.map((i: any) => `${i.name}:${i.quantity}`)).toEqual(["Tomates:2"]);
      // réafficher : tout revient, prix compris
      await sw.click();
      await expect(page.getByTestId("prod-Tomates")).toHaveCount(0); // quitte l'onglet « Masqués »
      await expect(page.getByTestId("cat-tab-hidden")).toHaveText(`Masqués (${hidden0})`);
      await page.getByTestId("cat-tab-all").click();
      await expect(page.getByTestId("state-Tomates")).toHaveText("Affiché");
      const back = (await catalog(f)).find((p) => p.name === "Tomates");
      expect(back.active).toBe(true);
      expect(back.price).toMatchObject({ amount: "9.00", source: "family" });
      await ctx.close();
    });
  });
}

test("Gestion des prix : synchronisation par ville depuis l'écran ; un prix personnalisé n'est remplacé que si on le coche", async ({ browser, playwright, baseURL }) => {
  await sql("DELETE FROM price_contributions");
  await sql("DELETE FROM base_prices");
  const viewer = await newFamily(playwright, baseURL!);
  const city = async (f: Family, c: string) => expect((await f.adil.put("/api/me/city", { data: { city: c } })).status()).toBe(200);
  await city(viewer, "Casablanca");
  await viewer.adil.put(`/api/products/${viewer.products["Pommes"]}/price`, { data: { amount: "7", refQty: 1, refUnit: "kg" } });
  for (const a of ["10", "12", "11"]) {
    const g = await newFamily(playwright, baseURL!);
    await city(g, "Casablanca");
    await g.adil.put(`/api/products/${g.products["Pommes"]}/price`, { data: { amount: a, refQty: 1, refUnit: "kg" } });
    expect((await g.adil.post("/api/prices/share", { data: { productId: g.products["Pommes"] } })).status()).toBe(201);
  }
  const { ctx, page } = await phone(browser, baseURL, SIZES[1]);
  await uiLogin(page, viewer, "adil", "482913");
  await openSettings(page, "seg-pricing");
  await expect(page.getByTestId("pa-amount-Pommes")).toHaveText("7,00 DH / kg");
  await page.getByTestId("pa-sync").click();
  await expect(page.getByTestId("sync-city")).toContainText("Casablanca");
  await expect(page.getByTestId(`proposal-${viewer.products["Pommes"]}`)).toContainText("Proposé : 11,00 DH / kg");
  await page.screenshot({ path: `${OUT}/gestion-prix-synchro-390.png` });
  // non coché : rien n'est appliqué (le prix personnalisé reste)
  await expect(page.getByTestId(`pick-${viewer.products["Pommes"]}`)).not.toBeChecked();
  await page.getByTestId("pa-sync-close").click();
  await expect(page.getByTestId("pa-amount-Pommes")).toHaveText("7,00 DH / kg");
  // coché : appliqué, l'écran se met à jour à la fermeture
  await page.getByTestId("pa-sync").click();
  await page.getByTestId(`pick-${viewer.products["Pommes"]}`).check();
  await page.getByTestId("sync-apply").click();
  await expect(page.getByTestId("sync-msg")).toContainText("1 prix appliqué");
  await page.getByTestId("pa-sync-close").click();
  await expect(page.getByTestId("pa-amount-Pommes")).toHaveText("11,00 DH / kg");
  await ctx.close();
});
