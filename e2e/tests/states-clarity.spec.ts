import { expect, test } from "@playwright/test";
import { card, createList, newFamily, staffAdds, uiLogin } from "./helpers";

/*
 * What is on the server, what was validated but not confirmed, and what is only chosen locally
 * must never be confused — in words, in counts and in card colours.
 * Captures of the real screens are written to docs/captures/ (taken from the code under test).
 */
test("états distincts : enregistré sur le serveur / validé en attente / choisi non envoyé, y compris hors connexion", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  const id = await createList(f);
  await staffAdds(f, id, ["Lait", "Beurre"]); // déjà sur le serveur
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await uiLogin(page, f);
  await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "saved");
  await page.waitForTimeout(600);

  // 1. En ligne : deux produits enregistrés ; un choix local pas encore envoyé
  await expect(page.getByTestId("count-saved")).toContainText("2 enregistrés sur le serveur");
  await card(page, f, "Riz").click();
  await expect(page.getByTestId("sync-state")).toContainText("1 à valider");
  await expect(page.getByTestId("count-saved")).toContainText("2 enregistrés");
  await expect(page.getByTestId("count-unsaved")).toContainText("1 pas encore enregistré");
  await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "saved");
  await expect(card(page, f, "Riz")).toHaveAttribute("data-state", "unsaved");

  // 2. Hors connexion : « Valider » → validé mais pas confirmé
  await ctx.setOffline(true);
  await page.getByTestId("validate").click();
  await expect(page.getByTestId("banner-pending")).toContainText("choix validé mais pas encore enregistré sur le serveur");
  await expect(page.getByTestId("sync-state")).toContainText("En attente");
  await expect(page.getByTestId("banner-offline")).toContainText("Hors connexion");
  await expect(card(page, f, "Riz")).toHaveAttribute("data-state", "unsaved"); // ambre : jamais vert tant que le serveur n'a pas confirmé

  // 3. Hors connexion : un nouveau choix non envoyé s'ajoute, les trois états coexistent
  await card(page, f, "Sucre").click();
  await expect(page.getByTestId("sync-state")).toContainText("1 à valider");
  await expect(page.getByTestId("sync-state")).toContainText("En attente");
  await expect(page.getByTestId("count-saved")).toContainText("2 enregistrés sur le serveur"); // seuls Lait et Beurre
  await expect(page.getByTestId("count-unsaved")).toContainText("2 pas encore enregistrés"); // Riz (en attente) + Sucre (choisi)
  // aucune phrase ne prétend que c'est enregistré tant que le serveur n'a pas répondu
  await expect(page.locator(".stickyhead")).not.toContainText("Enregistré sur le serveur");
  await page.screenshot({ path: "../docs/captures/staff-hors-connexion-360x640.png" });

  // 4. Retour du réseau : tout part, puis seulement alors « Enregistré sur le serveur »
  await ctx.setOffline(false);
  await page.getByTestId("validate").click(); // envoie aussi Sucre
  await page.evaluate(() => (window as any).__engine.retryNow());
  await expect(page.getByTestId("banner-pending")).toHaveCount(0);
  await expect(page.getByTestId("sync-state")).toContainText("✓ Enregistré sur le serveur");
  await expect(card(page, f, "Riz")).toHaveAttribute("data-state", "saved");
  await expect(page.getByTestId("count-saved")).toContainText("4 enregistrés sur le serveur");
  await expect(page.getByTestId("count-unsaved")).toHaveCount(0);
  await page.screenshot({ path: "../docs/captures/staff-enregistre-360x640.png" });
  await ctx.close();
});

test("« Enregistré sur le serveur » disparaît dès que le serveur ne répond plus", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await createList(f);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await uiLogin(page, f);
  await expect(page.getByTestId("catalog")).toBeVisible();
  await card(page, f, "Lait").click();
  await page.getByTestId("validate").click();
  await expect(page.getByTestId("sync-state")).toContainText("✓ Enregistré sur le serveur");
  await ctx.setOffline(true);
  await page.evaluate(() => (window as any).__engine.refresh()); // le serveur est injoignable
  await expect(page.getByTestId("banner-offline")).toBeVisible();
  await expect(page.getByTestId("sync-state")).not.toContainText("Enregistré sur le serveur");
  await expect(page.getByTestId("sync-state")).toContainText("Dernière liste connue");
  await ctx.close();
});
