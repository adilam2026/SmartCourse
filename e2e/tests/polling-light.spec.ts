import { expect, test } from "@playwright/test";
import { createList, newFamily, uiLogin } from "./helpers";

// Flux temps réel bloqué (comme derrière un proxy qui le retient) : la synchronisation repose sur la relecture périodique.
// On vérifie qu'elle est légère (le catalogue n'est pas retéléchargé) ET qu'elle reprend ajouts, modifications et désactivations.
test("relecture périodique légère : catalogue téléchargé seulement quand il change ; ajout, modification, désactivation repris", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(150_000);
  const f = await newFamily(playwright, baseURL!);
  await createList(f);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.route("**/api/events", (r) => r.abort()); // flux SSE retenu / bloqué
  const page = await ctx.newPage();
  const calls = { catalog: 0, list: 0, bytes: 0 };
  page.on("response", (r) => {
    const u = r.url();
    if (!u.includes("/api/catalog") && !u.includes("/api/lists/active")) return;
    if (u.includes("/api/catalog")) calls.catalog++; else calls.list++;
    calls.bytes += Number(r.headers()["content-length"] ?? 0);
  });
  await uiLogin(page, f);
  await expect(page.getByTestId("catalog")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__engine.getState().live)).toBe(false);

  // 1. Rien ne change pendant ~25 s : plusieurs relectures de la liste, AUCUN téléchargement du catalogue.
  await page.waitForTimeout(1500);
  const base = { ...calls };
  await page.waitForTimeout(25_000);
  const idle = { catalog: calls.catalog - base.catalog, list: calls.list - base.list, bytes: calls.bytes - base.bytes };
  console.log(`      (25 s sans changement : ${idle.list} lecture(s) de la liste, ${idle.catalog} du catalogue, ${idle.bytes} octets)`);
  expect(idle.list).toBeGreaterThanOrEqual(2);
  expect(idle.catalog).toBe(0);
  expect(idle.bytes).toBeLessThan(2_000 * idle.list); // quelques centaines d'octets par relecture, pas 15 Ko

  // 2. Ajout par l'administrateur → apparaît chez le personnel, sans rechargement, avec un seul téléchargement du catalogue.
  await page.evaluate(() => { (window as any).__sansRechargement = 1; });
  const before = calls.catalog;
  const created = await f.adil.post("/api/products", { data: { name: "Article relecture", category: "pain" } });
  const id = (await created.json()).product.id as string;
  const card = page.getByTestId(`card-${id}`);
  await expect(card).toBeAttached({ timeout: 30_000 });
  await expect(card).toContainText("Article relecture");
  expect(calls.catalog - before).toBe(1);

  // 3. Modification (nom) → reprise.
  await f.adil.patch(`/api/products/${id}`, { data: { name: "Article relecture modifié" } });
  await expect(card).toContainText("Article relecture modifié", { timeout: 30_000 });
  expect(calls.catalog - before).toBe(2);

  // 4. Désactivation → disparaît du catalogue du personnel.
  await f.adil.patch(`/api/products/${id}`, { data: { active: false } });
  await expect(card).toHaveCount(0, { timeout: 30_000 });
  expect(calls.catalog - before).toBe(3);
  expect(await page.evaluate(() => (window as any).__sansRechargement)).toBe(1); // jamais rechargée
  await ctx.close();
});
