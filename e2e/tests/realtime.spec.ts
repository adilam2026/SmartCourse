import { expect, test } from "@playwright/test";
import { card, createList, newFamily, staffAdds, uiLogin } from "./helpers";

test.describe("temps réel (SSE)", () => {
  test("critère 4/6 : une validation du personnel apparaît chez le parent, sans rechargement manuel", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const id = await createList(f);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const parent = await ctx.newPage();
    await uiLogin(parent, f, "lamiaa", "573918");
    await expect(parent.getByTestId("count-tobuy")).toHaveText("0");
    await expect.poll(() => parent.evaluate(() => (window as any).__engine.getState().live)).toBe(true);

    await staffAdds(f, id, ["Lait", "Riz"]); // le personnel valide
    await expect(parent.getByTestId("count-tobuy")).toHaveText("2"); // aucun rafraîchissement manuel
    await ctx.close();
  });

  test("l'achat d'un parent arrive chez l'autre parent et verrouille la carte chez le personnel, en direct", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const id = await createList(f);
    await staffAdds(f, id, ["Lait"]);
    const c1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const c3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const adil = await c1.newPage();
    const lamiaa = await c2.newPage();
    const marie = await c3.newPage();
    await uiLogin(adil, f, "adil", "482913");
    await uiLogin(lamiaa, f, "lamiaa", "573918");
    await uiLogin(marie, f);
    await expect(card(marie, f, "Lait")).toHaveAttribute("data-state", "saved");
    for (const p of [adil, lamiaa, marie]) await expect.poll(() => p.evaluate(() => (window as any).__engine.getState().live)).toBe(true);

    await adil.getByTestId(`buy-${f.products["Lait"]}`).click();
    await expect(lamiaa.getByTestId(`by-${f.products["Lait"]}`)).toContainText("Acheté par Adil");
    await expect(card(marie, f, "Lait")).toHaveAttribute("data-state", "bought");

    await lamiaa.getByTestId(`correct-${f.products["Lait"]}`).click();
    await lamiaa.getByTestId("correct-confirm").click();
    await expect(adil.getByTestId("count-tobuy")).toHaveText("1");
    await expect(card(marie, f, "Lait")).toHaveAttribute("data-state", "saved"); // la correction déverrouille
    await c1.close(); await c2.close(); await c3.close();
  });

  test("la création d'une liste fait apparaître le catalogue au personnel qui attendait", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await uiLogin(page, f);
    await expect(page.getByTestId("no-list")).toBeVisible();
    await createList(f);
    await expect(page.getByTestId("catalog")).toBeVisible(); // sans action
  });

  test("critère 13 : la désactivation d'un profil le déconnecte immédiatement, flux ouvert compris", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__engine.getState().live)).toBe(true);
    const staff = (await (await f.adil.get("/api/profiles")).json()).profiles.find((p: any) => p.login === f.staffLogin);
    await f.adil.patch(`/api/profiles/${staff.id}`, { data: { active: false } });
    await expect(page.getByTestId("login-submit")).toBeVisible({ timeout: 8000 }); // aucune action de la personne
  });

  test("coupure puis retour du réseau : l'état se remet à jour tout seul", async ({ page, context, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const id = await createList(f);
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__engine.getState().live)).toBe(true);
    await context.setOffline(true);
    await staffAdds(f, id, ["Lait"]); // pendant la coupure, un autre membre ajoute
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "off");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "saved", { timeout: 10000 });
  });
});
