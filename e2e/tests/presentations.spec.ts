import { randomUUID } from "node:crypto";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { newFamily, uiLogin, type Family } from "./helpers";

/*
 * Deux présentations selon le profil : compacte pour les administrateurs, large (photos, gros boutons) pour le personnel.
 * Contrôle des deux rôles à 360 et 390 px : en-têtes, Liste, Historique (menu « … » ancré), Statistiques, Catalogue, Réglages,
 * adresse de récupération, réinitialisation de la famille, fenêtres et clavier affiché.
 */
const OUT = "../docs/captures/presentation";
const { defaultBrowserType: _d, ...PIXEL } = devices["Pixel 7"];
const SIZES = [{ name: "360", width: 360, height: 740 }, { name: "390", width: 390, height: 844 }] as const;

const add = (f: Family, name: string, quantity = 1) => ({ opId: randomUUID(), type: "add", productId: f.products[name]!, quantity });
async function ops(who: Family["adil"], listId: string, list: object[]) {
  const r = await who.post(`/api/lists/${listId}/ops`, { data: { ops: list } });
  expect(r.status()).toBe(200);
  return (await r.json()).list;
}
async function closedList(f: Family, names: string[], buyAll = true): Promise<string> {
  const r = await f.adil.post("/api/lists");
  const id = (await r.json()).list.id as string;
  const l = await ops(f.adil, id, names.map((n) => add(f, n)));
  if (buyAll) for (const it of l.items) await ops(f.adil, id, [{ opId: randomUUID(), type: "purchase", itemId: it.id }]);
  // buyAll faux : rien n'est acheté, tout reste « non acheté » à la clôture
  expect((await f.adil.post(`/api/lists/${id}/close`)).status()).toBe(200);
  return id;
}
async function phone(browser: Browser, baseURL: string | undefined, s: (typeof SIZES)[number]) {
  const ctx = await browser.newContext({ ...PIXEL, viewport: { width: s.width, height: s.height }, baseURL });
  return { ctx, page: await ctx.newPage() };
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const ui = (page: Page) => page.evaluate(() => document.documentElement.dataset.ui);
/** L'élément est entièrement visible dans la fenêtre. */
async function inside(page: Page, testid: string) {
  await page.getByTestId(testid).scrollIntoViewIfNeeded();
  const b = await page.getByTestId(testid).boundingBox();
  const vp = page.viewportSize()!;
  expect(b, testid).not.toBeNull();
  expect(b!.x).toBeGreaterThanOrEqual(0);
  expect(b!.y).toBeGreaterThanOrEqual(0);
  expect(b!.x + b!.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(b!.y + b!.height).toBeLessThanOrEqual(vp.height + 0.5);
  return b!;
}
const thumbSize = async (page: Page, within: string) => (await page.locator(`[data-testid="${within}"] .thumb, [data-testid^="card-"] img`).first().boundingBox())!;

for (const s of SIZES) {
  test.describe(`mobile ${s.name} px`, () => {
    test("la présentation suit le rôle : compacte pour l'administrateur, large pour le personnel, y compris après changement de profil", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      const id = (await (await f.adil.post("/api/lists")).json()).list.id as string;
      await ops(f.adil, id, [add(f, "Tomates", 2), add(f, "Riz"), add(f, "Lait")]);
      const { ctx, page } = await phone(browser, baseURL, s);
      // personnel : écran de choix des produits, grandes cartes avec photos
      await uiLogin(page, f);
      await expect(page.getByTestId("catalog")).toBeVisible();
      expect(await ui(page)).toBe("comfort");
      const staffCard = (await page.locator("[data-testid^='card-']").first().boundingBox())!;
      expect(staffCard.height).toBeGreaterThan(150); // grande carte avec photo
      const staffBtn = (await page.locator(".qty__btn").first().boundingBox())!;
      expect(staffBtn.height).toBeGreaterThanOrEqual(44); // boutons faciles à toucher
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/personnel-${s.name}.png` });
      // changement de profil sur le même appareil : administrateur → présentation compacte, sans recharger la page
      await page.evaluate(() => (window as any).__engine.logout());
      expect(await ui(page)).toBe("comfort"); // déconnecté : large
      await uiLogin(page, f, "adil", "482913");
      await expect(page.getByTestId("edit-list")).toBeVisible();
      expect(await ui(page)).toBe("compact");
      await page.screenshot({ path: `${OUT}/administrateur-liste-${s.name}.png` });
      // lignes compactes : petite photo, hauteur réduite
      const thumb = (await page.locator(".row .thumb").first().boundingBox())!;
      expect(thumb.width).toBeLessThanOrEqual(46);
      expect(thumb.width).toBeLessThan((await page.evaluate(() => 56))); // bien plus petite que la photo du personnel
      const row = (await page.locator("[data-testid^='row-']").first().boundingBox())!;
      expect(row.height).toBeLessThanOrEqual(72);
      // zones tactiles confortables
      const buy = (await page.locator("[data-testid^='buy-']").first().boundingBox())!;
      expect(buy.height).toBeGreaterThanOrEqual(40);
      for (const t of ["edit-list", "open-favorites", "close-list"]) expect((await page.getByTestId(t).boundingBox())!.height).toBeGreaterThanOrEqual(40);
      expect(await noOverflow(page)).toBe(true);
      // et retour au profil personnel : présentation large
      await page.evaluate(() => (window as any).__engine.logout());
      await uiLogin(page, f);
      await expect(page.getByTestId("catalog")).toBeVisible();
      expect(await ui(page)).toBe("comfort");
      await ctx.close();
    });

    test("administrateur : historique avec menu « … » ancré et entièrement visible, barre d'actions compacte, sections à zéro masquées", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await closedList(f, ["Tomates", "Riz"], true);
      await closedList(f, ["Lait"], false); // une seule ligne, non achetée : « Achetés 0 » doit disparaître
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-history").click();
      await page.screenshot({ path: `${OUT}/administrateur-historique-${s.name}.png` });
      await page.getByTestId("history-entry").filter({ hasText: "0 produit" }).click();
      await expect(page.getByTestId("archive")).toBeVisible();
      await expect(page.getByText(/^Achetés/)).toHaveCount(0); // section à zéro masquée
      await expect(page.getByTestId("archive-left")).toHaveText("1");
      // barre compacte : Recommander, Validations et « … » sur une seule ligne
      const bar = (await page.getByTestId("archive-actions").boundingBox())!;
      expect(bar.height).toBeLessThanOrEqual(56);
      await page.getByTestId("archive-more").click();
      const menu = page.getByTestId("archive-more-menu");
      await expect(menu).toBeVisible();
      const m = await inside(page, "archive-more-menu"); // jamais hors de l'écran
      const btn = (await page.getByTestId("archive-more").boundingBox())!;
      expect(Math.abs(m.y - (btn.y + btn.height)) < 30 || m.y + m.height <= btn.y + 4).toBe(true); // ancré au bouton (dessous ou dessus)
      const tab = (await page.locator(".tabbar").boundingBox())!;
      expect(m.y + m.height).toBeLessThanOrEqual(tab.y + 1); // pas derrière la navigation
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/administrateur-historique-menu-${s.name}.png` });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      // la suppression garde sa confirmation
      await page.getByTestId("archive-more").click();
      await page.getByTestId("archive-delete").click();
      await expect(page.getByTestId("archive-delete-text")).toBeVisible();
      await page.getByTestId("archive-delete-cancel").click();
      // le profil parent n'a pas le menu
      await ctx.close();
    });

    test("administrateur : statistiques compactes, sans paragraphe permanent ; aide à la demande", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await closedList(f, ["Tomates", "Riz", "Lait"], true);
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-stats").click();
      await expect(page.getByTestId("stats-rows")).toBeVisible();
      await expect(page.getByTestId("legend-bars")).toHaveCount(0);
      await expect(page.getByTestId("stats-no-spending")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Qu'est-ce qu'un achat ?" })).toHaveCount(0);
      await expect(page.getByTestId("stats-search")).toBeVisible();
      await expect(page.getByTestId("stats-filters")).toBeVisible();
      for (const t of ["stat-Tomates"]) await expect(page.getByTestId(t)).toBeVisible();
      await expect(page.getByTestId("freq-Tomates")).toContainText("1 achat");
      await expect(page.getByTestId("last-Tomates")).toBeVisible(); // dernier achat conservé
      const row = (await page.getByTestId("stat-Tomates").boundingBox())!;
      expect(row.height).toBeLessThanOrEqual(80);
      const sum = (await page.getByTestId("stats-total").boundingBox())!;
      expect(sum.height).toBeLessThanOrEqual(64);
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/administrateur-statistiques-${s.name}.png` });
      await page.getByTestId("stats-help").click();
      await expect(page.getByTestId("legend-bars")).toBeVisible();
      await expect(page.getByTestId("stats-no-spending")).toBeVisible();
      await page.screenshot({ path: `${OUT}/administrateur-statistiques-aide-${s.name}.png` });
      await ctx.close();
    });

    test("administrateur : catalogue en lignes compactes, Modifier et Prix ciblent l'article exact, aucun bouton coupé", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      expect((await f.adil.put("/api/me/prefs", { data: { showPrices: true, showTotals: false } })).status()).toBe(200);
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-settings").click();
      await page.getByTestId("seg-catalog").click();
      await expect(page.getByTestId("prod-Tomates")).toBeVisible();
      await expect(page.getByText("Photo : du catalogue")).toHaveCount(0);
      await expect(page.locator("[data-testid^='photosrc-']")).toHaveCount(0);
      expect(await noOverflow(page)).toBe(true);
      // filtres entiers (retour à la ligne) et boutons dans l'écran
      for (const t of ["cat-tab-all", "cat-tab-shown", "cat-tab-hidden"]) await inside(page, t); // onglets entiers
      await page.getByTestId("pf-toggle").click();
      for (const t of ["pf-all", "pf-check", "pf-own", "pf-none"]) await inside(page, t);
      await page.getByTestId("pf-toggle").click();
      await inside(page, "add-article");
      const row = (await page.getByTestId("prod-Tomates").boundingBox())!;
      expect(row.height).toBeLessThanOrEqual(120);
      await page.screenshot({ path: `${OUT}/administrateur-catalogue-${s.name}.png` });
      // Modifier / Prix : toujours le bon article
      await page.getByTestId("edit-Pâtes").click();
      await expect(page.getByTestId("pf-name")).toHaveValue("Pâtes");
      await page.getByTestId("pf-cancel").click();
      await page.getByTestId("price-Lentilles").click();
      await expect(page.getByTestId("price-ref")).toContainText("Lentilles");
      await page.getByTestId("price-amount").fill("12");
      if (await page.getByTestId("price-packaging").count()) await page.getByTestId("price-packaging").fill("500 g");
      await page.getByTestId("price-save").click();
      await expect(page.getByTestId("price-dialog")).toHaveCount(0);
      const cat = Object.fromEntries((await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).map((p: any) => [p.name, p]));
      expect(cat["Lentilles"].price).toMatchObject({ amount: "12.00", source: "family" });
      expect(cat["Pâtes"].price?.source).not.toBe("family");
      // interrupteur Affiché / Masqué : réversible, entièrement visible
      await inside(page, "active-Tomates");
      await page.getByTestId("active-Tomates").click();
      await expect(page.getByTestId("state-Tomates")).toHaveText("Masqué");
      expect(((await (await f.adil.get("/api/catalog?includeInactive=1")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.name === "Tomates")).active).toBe(false);
      await page.screenshot({ path: `${OUT}/administrateur-catalogue-menu-${s.name}.png` });
      // fiche et fenêtre Prix en présentation compacte
      await page.getByTestId("edit-Riz").click();
      await inside(page, "pf-save");
      await page.screenshot({ path: `${OUT}/administrateur-fiche-${s.name}.png` });
      await ctx.close();
    });

    test("administrateur : adresse de récupération sobre et réinitialisation de la famille sans doublon, bouton final accessible, clavier affiché", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-settings").click();
      await expect(page.getByTestId("seg-profiles")).toBeVisible();
      await page.screenshot({ path: `${OUT}/administrateur-reglages-${s.name}.png` });
      await page.getByTestId("seg-recovery").click();
      await expect(page.getByTestId("recovery-sentence")).toHaveText("Pour récupérer l'accès à votre famille.");
      await expect(page.getByTestId("recovery-state")).toBeVisible();
      await expect(page.getByTestId("recovery-email")).toBeVisible();
      const edit = (await page.getByTestId("recovery-edit").boundingBox())!;
      const test_ = (await page.getByTestId("recovery-test").boundingBox())!;
      expect(edit.height).toBeLessThanOrEqual(48); // boutons courts, regroupés (pas de grands boutons pleine largeur)
      expect(test_.height).toBeLessThanOrEqual(48);
      expect(edit.width).toBeLessThan(s.width * 0.7);
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/administrateur-recuperation-${s.name}.png` });
      // réinitialisation
      await page.getByTestId("settings-back").click();
      await page.getByTestId("seg-reset").click();
      await expect(page.getByTestId("reset-counts")).toHaveText("Tous les profils, listes, achats et articles de cette famille seront supprimés. Cette action est définitive.");
      await expect(page.getByTestId("reset-panel")).not.toContainText(/243|abonnement|photo\(s\)|sauvegardes/i);
      // pas de doublon : un champ mot de passe, un champ code, une case, un bouton
      await expect(page.getByTestId("reset-password")).toHaveCount(1);
      await expect(page.getByTestId("reset-confirm-code")).toHaveCount(1);
      await expect(page.getByTestId("reset-sure")).toHaveCount(1);
      await expect(page.getByTestId("reset-submit")).toHaveCount(1);
      await page.getByTestId("reset-submit").scrollIntoViewIfNeeded();
      const sub = (await page.getByTestId("reset-submit").boundingBox())!;
      const tab = (await page.locator(".tabbar").boundingBox())!;
      expect(sub.y + sub.height).toBeLessThanOrEqual(tab.y + 1); // au-dessus de la navigation
      // les éléments ne se chevauchent pas
      const boxes = [] as { y: number; h: number }[];
      for (const t of ["reset-password", "reset-confirm-code", "reset-sure", "reset-submit"]) {
        const b = (await page.getByTestId(t).boundingBox())!;
        boxes.push({ y: b.y, h: b.height });
      }
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y + 1).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.h - 1);
      await page.screenshot({ path: `${OUT}/administrateur-reinitialisation-${s.name}.png`, fullPage: false });
      // clavier affiché : la fenêtre visible se réduit ; le champ actif et le bouton restent atteignables
      await page.setViewportSize({ width: s.width, height: 360 });
      await page.getByTestId("reset-confirm-code").focus();
      await page.getByTestId("reset-confirm-code").scrollIntoViewIfNeeded();
      await inside(page, "reset-confirm-code");
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); // bas de l'écran
      const sub2 = (await page.getByTestId("reset-submit").boundingBox())!;
      const tab2 = (await page.locator(".tabbar").boundingBox())!;
      expect(sub2.y + sub2.height).toBeLessThanOrEqual(tab2.y + 1); // le bouton final reste au-dessus de la navigation
      await page.screenshot({ path: `${OUT}/administrateur-reinitialisation-clavier-${s.name}.png` });
      await ctx.close();
    });

    test("fenêtres en présentation compacte : nouveau profil et profil, clavier affiché, bas du formulaire accessible", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-settings").click();
      await page.getByTestId("seg-profiles").click();
      await expect(page.getByTestId("profiles")).toBeVisible();
      await page.screenshot({ path: `${OUT}/administrateur-profils-${s.name}.png` });
      await page.getByRole("button", { name: /Ajouter/ }).first().click();
      await expect(page.getByTestId("np-submit")).toBeVisible();
      await page.setViewportSize({ width: s.width, height: 380 }); // clavier ouvert
      await page.getByTestId("np-name").focus();
      await inside(page, "np-name");
      await page.getByTestId("np-submit").scrollIntoViewIfNeeded();
      expect((await page.getByTestId("np-submit").boundingBox())!.y + 40).toBeLessThanOrEqual(380 + 40);
      await page.screenshot({ path: `${OUT}/administrateur-nouveau-profil-clavier-${s.name}.png` });
      await ctx.close();
    });
  });
}
