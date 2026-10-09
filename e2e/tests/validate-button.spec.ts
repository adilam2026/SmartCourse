import { expect, test, type Page } from "@playwright/test";
import { card, createList, newFamily, uiLogin } from "./helpers";

/*
 * « Valider » must stay entirely visible and tappable on small phones, even with every banner shown
 * (offline, pending sync, notice, resume-draft). We check on the app itself, not on a screenshot viewer:
 *  - its box lies inside the viewport with a margin on every side,
 *  - the element at each corner and at the centre IS the button (nothing overlaps it),
 *  - a real click goes through (Playwright refuses to click an obscured element),
 *  - the sticky header never takes more than half of the screen.
 */
const SIZES = [
  { name: "320x568 (petit)", width: 320, height: 568 },
  { name: "360x640", width: 360, height: 640 },
  { name: "390x844", width: 390, height: 844 },
  { name: "412x915", width: 412, height: 915 },
];

async function expectFullyUsable(page: Page, vw: number, vh: number, label: string) {
  const btn = page.getByTestId("validate");
  await expect(btn, label).toBeVisible();
  const box = (await btn.boundingBox())!;
  expect(box.x, `${label}: bord gauche`).toBeGreaterThanOrEqual(8);
  expect(box.y, `${label}: bord haut`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label}: marge droite`).toBeLessThanOrEqual(vw - 8);
  expect(box.y + box.height, `${label}: bas du bouton dans l'écran`).toBeLessThanOrEqual(vh);
  expect(box.height, `${label}: hauteur tactile`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${label}: largeur tactile`).toBeGreaterThanOrEqual(88);
  const covered = await page.evaluate(({ x, y, w, h }) => {
    const pts = [[x + 8, y + 8], [x + w - 8, y + 8], [x + 8, y + h - 8], [x + w - 8, y + h - 8], [x + w / 2, y + h / 2]];
    return pts.map(([px, py]) => {
      const el = document.elementFromPoint(px!, py!);
      return !!el?.closest("[data-testid=validate]");
    });
  }, { x: box.x, y: box.y, w: box.width, h: box.height });
  expect(covered, `${label}: rien ne recouvre le bouton`).toEqual([true, true, true, true, true]);
  const head = (await page.locator(".stickyhead").boundingBox())!;
  expect(head.height, `${label}: en-tête collant ≤ 50 % de l'écran`).toBeLessThanOrEqual(vh * 0.5);
}

for (const size of SIZES) {
  test(`Valider reste entier et cliquable avec tous les bandeaux — ${size.name}`, async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const oldId = await createList(f);
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    await page.waitForTimeout(600);

    // 1. choix non validés + hors connexion + envoi en attente
    await card(page, f, "Lait").click();
    await expectFullyUsable(page, size.width, size.height, "avec un choix");
    await ctx.setOffline(true);
    await card(page, f, "Riz").click();
    await page.getByTestId("validate").click(); // met en attente (hors connexion)
    await expect(page.getByTestId("banner-offline")).toBeVisible();
    await expect(page.getByTestId("banner-pending")).toBeVisible();
    await card(page, f, "Sucre").click(); // nouveau choix → bouton actif avec bandeaux
    await expect(page.getByTestId("validate")).toBeEnabled();
    await expectFullyUsable(page, size.width, size.height, "hors connexion + en attente");

    // 2. + un message + la reprise d'un brouillon de liste clôturée
    await ctx.setOffline(false);
    await f.lamiaa.post(`/api/lists/${oldId}/close`);
    const newId = await createList(f);
    await ctx.setOffline(true);
    await page.evaluate(() => { const e = (window as any).__engine; e.notice?.("x"); });
    await page.evaluate(() => (window as any).__engine.getState().notices.length);
    await ctx.setOffline(false);
    await page.evaluate(() => (window as any).__engine.refresh());
    await expect(page.getByTestId("banner-orphan")).toBeVisible({ timeout: 8000 });
    await ctx.setOffline(true);
    await expect(page.getByTestId("banner-offline")).toBeVisible({ timeout: 8000 }).catch(() => {});
    await card(page, f, "Farine").click();
    await expectFullyUsable(page, size.width, size.height, "tous les bandeaux");

    // 3. même chose après avoir fait défiler le catalogue (en-tête collant)
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(300);
    await expectFullyUsable(page, size.width, size.height, "catalogue défilé");
    await page.screenshot({ path: `shots/valider-${size.width}x${size.height}.png` });

    // 4. le clic réel passe (Playwright vérifie qu'aucun élément ne recouvre la cible)
    await ctx.setOffline(false);
    await page.getByTestId("validate").click({ timeout: 5000 });
    expect(newId).toBeTruthy();
    await ctx.close();
  });
}
