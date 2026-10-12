import { randomUUID } from "node:crypto";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { newFamily, uiLogin, type Family } from "./helpers";

/*
 * V3 · parcours de sélection des articles (aperçu). Activation réservée à l'administrateur principal, propre à l'appareil ;
 * trois affichages mémorisés par utilisateur ; panneau inférieur de quantité ; prix unitaire sans total ; aucune donnée modifiée
 * avant « Valider ». Mobile 360 et 390 px.
 */
const OUT = "../docs/captures/v3";
const LONG = "Fromage de chèvre frais aux herbes de Provence et miel";
const { defaultBrowserType: _d, ...PIXEL } = devices["Pixel 7"];
const SIZES = [{ name: "360", width: 360, height: 740 }, { name: "390", width: 390, height: 844 }] as const;
const V3_ON = `try { localStorage.setItem("smartcourse.v3", "on"); } catch {}`;

async function phone(browser: Browser, baseURL: string | undefined, s: (typeof SIZES)[number], v3: boolean) {
  const ctx = await browser.newContext({ ...PIXEL, viewport: { width: s.width, height: s.height }, baseURL });
  if (v3) await ctx.addInitScript(V3_ON);
  return { ctx, page: await ctx.newPage() };
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const activeList = async (f: Family) => (await (await f.lamiaa.get("/api/lists/active")).json()).list;
async function openList(f: Family) {
  const r = await f.adil.post("/api/lists");
  expect(r.status()).toBe(201);
  return (await r.json()).list.id as string;
}
async function inside(page: Page, testid: string) {
  const b = (await page.getByTestId(testid).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5);
}

test("activation V3 : désactivée par défaut, réservée à l'administrateur principal, propre à l'appareil, retour immédiat à la V2", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await openList(f);
  // un second administrateur n'a pas l'aperçu
  expect((await f.adil.post("/api/profiles", { data: { displayName: "Sami", login: "sami", role: "admin", secret: "684215", secretConfirm: "684215", city: "Casablanca" } })).status()).toBe(201);
  const ctx = await browser.newContext({ ...PIXEL, viewport: { width: 390, height: 844 }, baseURL });
  const page = await ctx.newPage();
  // personnel, par défaut : V2
  await uiLogin(page, f);
  await expect(page.getByTestId("catalog")).toBeVisible();
  await expect(page.getByTestId("v3-selection")).toHaveCount(0);
  await page.evaluate(() => (window as any).__engine.logout());
  // administrateur non principal : aucun accès à l'activation
  await uiLogin(page, f, "sami", "684215");
  await page.getByTestId("tab-settings").click();
  await expect(page.getByTestId("seg-v3")).toHaveCount(0);
  await page.evaluate(() => (window as any).__engine.logout());
  // administrateur principal : active sur cet appareil
  await uiLogin(page, f, "adil", "482913");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("seg-v3").click();
  await expect(page.getByTestId("v3-scope")).toContainText("Réservé à cet appareil");
  await page.getByTestId("v3-toggle").check();
  expect(await page.evaluate(() => localStorage.getItem("smartcourse.v3"))).toBe("on");
  await page.evaluate(() => (window as any).__engine.logout());
  // le personnel de cet appareil voit la V3 (test sur le téléphone de l'administrateur) ; coupure immédiate
  await uiLogin(page, f);
  await expect(page.getByTestId("v3-selection")).toBeVisible();
  // le personnel ne peut pas activer l'aperçu : ni réglage ni option dans son profil (seul l'administrateur principal le peut)
  await page.getByTestId("avatar").click();
  await expect(page.getByRole("dialog", { name: "Mon profil" })).toBeVisible();
  await expect(page.getByTestId("v3-toggle")).toHaveCount(0);
  await expect(page.getByText("Aperçu V3")).toHaveCount(0);
  await page.getByRole("dialog", { name: "Mon profil" }).getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByTestId("tab-settings")).toHaveCount(0);
  await page.getByTestId("v3-to-v2").click();
  await expect(page.getByTestId("v3-selection")).toHaveCount(0);
  await expect(page.getByTestId("view-all")).toBeVisible(); // V2 intacte
  expect(await page.evaluate(() => localStorage.getItem("smartcourse.v3"))).toBeNull();
  await ctx.close();
  // un autre appareil (autre navigateur) n'est jamais concerné
  const other = await browser.newContext({ ...PIXEL, viewport: { width: 390, height: 844 }, baseURL });
  const op = await other.newPage();
  await uiLogin(op, f);
  await expect(op.getByTestId("catalog")).toBeVisible();
  await expect(op.getByTestId("v3-selection")).toHaveCount(0);
  await other.close();
});

for (const s of SIZES) {
  test.describe(`mobile ${s.name} px`, () => {
    test("trois affichages : changement immédiat, mémorisés par utilisateur ; photos larges ; sans débordement", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await openList(f);
      expect((await f.adil.post("/api/products", { data: { name: LONG, category: "laitages", unit: "piece" } })).status()).toBe(201);
      const { ctx, page } = await phone(browser, baseURL, s, true);
      await uiLogin(page, f);
      await expect(page.getByTestId("v3-selection")).toBeVisible();
      // par défaut : carrés à deux colonnes
      await expect(page.getByTestId("v3-mode-squares")).toHaveAttribute("aria-selected", "true");
      const t1 = (await page.locator("[data-testid^='v3-']").filter({ has: page.locator(".v3tile__photo") }).first().boundingBox())!;
      const tiles = page.locator(".v3tile");
      const a = (await tiles.nth(0).boundingBox())!;
      const b = (await tiles.nth(1).boundingBox())!;
      expect(Math.abs(a.y - b.y)).toBeLessThan(2); // deux colonnes côte à côte
      expect(a.width).toBeGreaterThan(s.width / 2 - 24);
      const ph = (await tiles.nth(0).locator(".v3tile__photo").boundingBox())!;
      expect(ph.width).toBeGreaterThanOrEqual(150); // photo large
      expect(t1.width).toBeGreaterThan(0);
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/carres-${s.name}.png` });
      // liste visuelle
      await page.getByTestId("v3-mode-list").click();
      await expect(page.getByTestId("v3-mode-list")).toHaveAttribute("aria-selected", "true");
      const l0 = (await tiles.nth(0).boundingBox())!;
      const l1 = (await tiles.nth(1).boundingBox())!;
      expect(l1.y).toBeGreaterThan(l0.y + l0.height - 2); // une ligne par article
      expect((await tiles.nth(0).locator(".v3tile__photo").boundingBox())!.width).toBeGreaterThanOrEqual(70);
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/liste-${s.name}.png` });
      // grandes cartes
      await page.getByTestId("v3-mode-cards").click();
      const c0 = (await tiles.nth(0).locator(".v3tile__photo").boundingBox())!;
      expect(c0.width).toBeGreaterThan(s.width - 48); // photo pleine largeur
      expect(c0.height).toBeGreaterThan(200);
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/grandes-cartes-${s.name}.png` });
      // nom très long : lisible, rien de coupé hors de la carte
      await page.getByTestId("catalog-search").fill("Fromage de chèvre");
      await expect(page.locator(".v3tile").first()).toContainText(LONG);
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/nom-long-${s.name}.png` });
      await page.getByTestId("catalog-search").fill("");
      // mémorisé par utilisateur : rechargement, autre profil, retour
      await page.reload();
      await expect(page.getByTestId("v3-mode-cards")).toHaveAttribute("aria-selected", "true");
      await page.evaluate(() => (window as any).__engine.logout());
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-current").click();
      await page.getByTestId("edit-list").click();
      await expect(page.getByTestId("v3-mode-squares")).toHaveAttribute("aria-selected", "true"); // autre utilisateur : son propre choix (défaut)
      await page.getByTestId("v3-mode-list").click();
      await page.evaluate(() => (window as any).__engine.logout());
      await uiLogin(page, f);
      await expect(page.getByTestId("v3-mode-cards")).toHaveAttribute("aria-selected", "true"); // le personnel retrouve le sien
      await ctx.close();
    });

    test("panneau de quantité : ouverture au toucher, +/−, saisie directe et décimales, unité, prix unitaire sans total, clavier", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      const listId = await openList(f);
      // le profil personnel choisit d'afficher les prix indicatifs
      await f.staff.put("/api/me/prefs", { data: { showPrices: true, showTotals: false } });
      await f.adil.put(`/api/products/${f.products["Tomates"]}/price`, { data: { amount: "8", refQty: 1, refUnit: "kg" } });
      const { ctx, page } = await phone(browser, baseURL, s, true);
      await uiLogin(page, f);
      const tom = page.getByTestId(`v3-${f.products["Tomates"]}`);
      await expect(tom).toBeVisible();
      await expect(tom).toContainText("8,00 DH / kg"); // prix indicatif unitaire sur la carte
      await tom.click();
      const sheet = page.getByTestId("qty-sheet");
      await expect(sheet).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Tomates" })).toBeVisible();
      await expect(page.getByTestId("sheet-price")).toContainText("Prix indicatif : 8,00 DH / kg");
      await expect(sheet).not.toContainText(/=\s*\d|Total/); // jamais de total par article
      await expect(page.getByTestId("sheet-unit")).toHaveText("kg");
      await expect(page.getByTestId("sheet-input")).toHaveValue("1");
      await expect(page.getByTestId("sheet-confirm")).toHaveText("Ajouter à la liste");
      await page.screenshot({ path: `${OUT}/panneau-quantite-${s.name}.png` });
      // boutons +/− (pas d'un demi-kilo) puis saisie directe avec décimale
      await page.getByTestId("sheet-plus").click();
      await expect(page.getByTestId("sheet-input")).toHaveValue("1,5");
      await page.getByTestId("sheet-minus").click();
      await page.getByTestId("sheet-minus").click();
      await expect(page.getByTestId("sheet-input")).toHaveValue("0,5");
      await expect(page.getByTestId("sheet-minus")).toBeDisabled(); // minimum : 0,5 kg avec les boutons
      await page.getByTestId("sheet-input").fill("1,25");
      await page.getByTestId("sheet-input").blur();
      await expect(page.getByTestId("sheet-input")).toHaveValue("1,25");
      await page.getByTestId("sheet-input").fill("abc"); // saisie illisible : retour à la valeur en cours
      await page.getByTestId("sheet-input").blur();
      await expect(page.getByTestId("sheet-input")).toHaveValue("1,25");
      // clavier affiché : le panneau reste dans la zone visible et le bouton atteignable
      await page.setViewportSize({ width: s.width, height: 420 });
      await page.getByTestId("sheet-input").focus();
      await inside(page, "sheet-input");
      await page.getByTestId("sheet-confirm").scrollIntoViewIfNeeded();
      await inside(page, "sheet-confirm");
      await page.screenshot({ path: `${OUT}/panneau-clavier-${s.name}.png` });
      await page.setViewportSize({ width: s.width, height: s.height });
      // ajout : confirmation, choix en cours (rien n'est envoyé avant « Valider »)
      await page.getByTestId("sheet-confirm").click();
      await expect(page.getByTestId("qty-sheet")).toHaveCount(0);
      await expect(page.getByTestId("v3-toast")).toContainText("Tomates ajouté à la sélection");
      await expect(tom).toHaveAttribute("data-state", "unsaved");
      await expect(page.getByTestId(`v3qty-${f.products["Tomates"]}`)).toContainText("1,25 kg");
      expect((await activeList(f)).items).toHaveLength(0); // le serveur n'a encore rien reçu
      await expect(page.getByTestId("validate")).toHaveText("Valider 1 modification");
      await page.screenshot({ path: `${OUT}/article-ajoute-${s.name}.png` });
      // article déjà sélectionné : le panneau montre la quantité choisie ; mise à jour
      await tom.click();
      await expect(page.getByTestId("sheet-input")).toHaveValue("1,25");
      await expect(page.getByTestId("sheet-confirm")).toHaveText("Mettre à jour la quantité");
      await expect(page.getByTestId("sheet-confirm")).toBeDisabled(); // rien n'a changé
      await page.getByTestId("sheet-plus").click();
      await page.getByTestId("sheet-confirm").click();
      await expect(page.getByTestId(`v3qty-${f.products["Tomates"]}`)).toContainText("1,75 kg");
      // retrait
      await tom.click();
      await page.getByTestId("sheet-remove").click();
      await expect(tom).toHaveAttribute("data-state", "off");
      await expect(page.getByTestId("validate")).toBeDisabled();
      // validation : mêmes droits et même résultat qu'en V2 (une ligne, bonne quantité)
      await tom.click();
      await page.getByTestId("sheet-input").fill("2");
      await page.getByTestId("sheet-confirm").click(); // la saisie non validée est prise en compte
      await page.getByTestId("validate").click();
      await expect.poll(async () => ((await activeList(f)).items as any[]).map((i) => `${i.name}:${i.quantity}`)).toEqual(["Tomates:2"]);
      // acheté : verrouillé, « Nouvelle demande » explicite
      const item = (await activeList(f)).items[0];
      await f.adil.post(`/api/lists/${listId}/ops`, { data: { ops: [{ opId: randomUUID(), type: "purchase", itemId: item.id }] } });
      await expect(tom).toHaveAttribute("data-state", "bought", { timeout: 15_000 });
      await tom.click();
      await expect(page.getByTestId("sheet-bought")).toContainText("Déjà acheté : 2 kg");
      await page.getByTestId("sheet-again").click();
      await expect(tom).toHaveAttribute("data-state", "unsaved");
      expect(await noOverflow(page)).toBe(true);
      await ctx.close();
    });

    test("unités : kg/g et L/ml avec conversion exacte ; jamais « pièce » pour un produit au kilo ; compatible V2", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await openList(f);
      const cat = Object.fromEntries((await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).map((p: any) => [p.name, p]));
      const litre = "Huile d'essai";
      expect((await f.adil.post("/api/products", { data: { name: litre, category: "epicerie", unit: "litre" } })).status()).toBe(201);
      f.products[litre] = (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.name === litre).id;
      const counted = Object.keys(cat).find((n) => ["piece", "paquet", "bouteille", "brique", "pot", "boite"].includes(cat[n].unit))!;
      const { ctx, page } = await phone(browser, baseURL, s, true);
      await uiLogin(page, f);
      const tom = page.getByTestId(`v3-${f.products["Tomates"]}`);
      await tom.click();
      // l'unité du produit par défaut ; kg et g seulement (pas de « pièce »)
      await expect(page.getByTestId("sheet-unit-base")).toHaveText("kg");
      await expect(page.getByTestId("sheet-unit-small")).toHaveText("g");
      await expect(page.getByRole("dialog")).not.toContainText(/pièce/i);
      await page.screenshot({ path: `${OUT}/panneau-unites-${s.name}.png` });
      await page.getByTestId("sheet-unit-small").click();
      await expect(page.getByTestId("sheet-input")).toHaveValue("1000"); // 1 kg = 1000 g
      await expect(page.getByTestId("sheet-unit")).toHaveText("g");
      await page.getByTestId("sheet-plus").click();
      await expect(page.getByTestId("sheet-input")).toHaveValue("1100");
      await page.getByTestId("sheet-input").fill("250");
      await page.getByTestId("sheet-input").blur();
      await page.getByTestId("sheet-unit-base").click();
      await expect(page.getByTestId("sheet-input")).toHaveValue("0,25"); // 250 g = 0,25 kg
      await expect(page.getByTestId("sheet-unit")).toHaveText("kg");
      // saisie invalide en g : message, rien n'est converti ni enregistré
      await page.getByTestId("sheet-unit-small").click();
      await page.getByTestId("sheet-input").fill("12,5");
      await page.getByTestId("sheet-input").blur();
      await expect(page.getByTestId("sheet-problem")).toContainText("nombre entier de grammes");
      await expect(page.getByTestId("sheet-confirm")).toBeDisabled();
      await page.getByTestId("sheet-unit-base").click(); // changer d'unité ne convertit pas une saisie invalide
      await expect(page.getByTestId("sheet-unit-small")).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("sheet-input").fill("125"); // 125 g : exactement 0,125 kg (3 décimales gardées par le serveur)
      await page.getByTestId("sheet-input").blur();
      await expect(page.getByTestId("sheet-problem")).toHaveCount(0);
      await page.screenshot({ path: `${OUT}/panneau-grammes-${s.name}.png` });
      await page.getByTestId("sheet-confirm").click();
      await expect(page.getByTestId(`v3qty-${f.products["Tomates"]}`)).toContainText("0,125 kg");
      await page.getByTestId("validate").click();
      await expect.poll(async () => ((await activeList(f)).items as any[]).map((i) => Number(i.quantity))).toEqual([0.125]);
      expect(((await activeList(f)).items[0]).unit).toBe("kg"); // stocké dans l'unité du produit
      // la V2 lit la même quantité
      await page.getByTestId("v3-to-v2").click();
      await expect(page.getByTestId(`qty-input-${f.products["Tomates"]}`)).toHaveValue("0,125");
      await ctx.close();
      // volume : L / ml ; unités comptées : aucune petite unité
      const c2 = await phone(browser, baseURL, s, true);
      await uiLogin(c2.page, f);
      await c2.page.getByTestId(`v3-${f.products[litre]}`).click();
      await expect(c2.page.getByTestId("sheet-unit-base")).toHaveText("L");
      await expect(c2.page.getByTestId("sheet-unit-small")).toHaveText("ml");
      await c2.page.getByTestId("sheet-unit-small").click();
      await c2.page.getByTestId("sheet-input").fill("750");
      await c2.page.getByTestId("sheet-input").blur();
      await c2.page.getByTestId("sheet-unit-base").click();
      await expect(c2.page.getByTestId("sheet-input")).toHaveValue("0,75");
      await c2.page.getByTestId("sheet-confirm").click();
      await expect(c2.page.getByTestId(`v3qty-${f.products[litre]}`)).toContainText("0,75");
      await c2.page.getByTestId(`v3-${f.products[counted]}`).click();
      await expect(c2.page.getByTestId("sheet-unit-small")).toHaveCount(0);
      await expect(c2.page.getByTestId("sheet-unit-base")).toHaveCount(0);
      await c2.ctx.close();
    });

    test("unités adaptées au produit et sans liste en cours", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      const { ctx, page } = await phone(browser, baseURL, s, true);
      await uiLogin(page, f);
      // sans liste : les produits actifs sont visibles et se choisissent (brouillon) ; rien n'est créé avant « Valider »
      await expect(page.getByTestId("v3-selection")).toBeVisible();
      expect(await page.locator(".v3tile").count()).toBeGreaterThan(30);
      await page.locator(".v3tile").first().click();
      await expect(page.getByTestId("qty-sheet")).toBeVisible();
      expect((await (await f.adil.get("/api/lists/active")).json()).list).toBeNull();
      await ctx.close();
      await openList(f);
      const c2 = await phone(browser, baseURL, s, true);
      await uiLogin(c2.page, f);
      // pièce / paquet / litre : entiers pour les unités comptées
      const cat = Object.fromEntries((await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).map((p: any) => [p.name, p]));
      const countedName = Object.keys(cat).find((n) => ["piece", "paquet", "bouteille", "brique", "pot", "boite"].includes(cat[n].unit))!;
      await c2.page.getByTestId(`v3-${cat[countedName].id}`).click();
      await c2.page.getByTestId("sheet-plus").click();
      await expect(c2.page.getByTestId("sheet-input")).toHaveValue("2");
      await expect(c2.page.getByTestId("sheet-unit")).not.toHaveText("kg");
      await c2.page.getByTestId("sheet-input").fill("2,7"); // une unité comptée n'a pas de décimales
      await c2.page.getByTestId("sheet-input").blur();
      await expect(c2.page.getByTestId("sheet-input")).toHaveValue("3");
      await c2.ctx.close();
    });
  });
}
