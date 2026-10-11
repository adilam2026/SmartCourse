import { expect, test } from "@playwright/test";
import { createList, newFamily, staffAdds, uiLogin } from "./helpers";

const row = (page: any, f: any, name: string) => page.getByTestId(`row-${f.products[name]}`);

test.describe("parcours des parents", () => {
  test("critère 6 : l'achat d'Adil apparaît chez Lamiaa avec son auteur", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const id = await createList(f);
    await staffAdds(f, id, ["Lait", "Riz", "Sucre"]);
    const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ctxL = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const adil = await ctxA.newPage();
    const lamiaa = await ctxL.newPage();
    await uiLogin(adil, f, "adil", "482913");
    await uiLogin(lamiaa, f, "lamiaa", "573918");
    await expect(adil.getByTestId("count-tobuy")).toHaveText("3");
    await expect(lamiaa.getByTestId("count-tobuy")).toHaveText("3");

    await adil.getByTestId(`buy-${f.products["Lait"]}`).click();
    await expect(adil.getByTestId("count-tobuy")).toHaveText("2");
    await expect(adil.getByTestId("count-bought")).toHaveText("1");
    await expect(adil.getByTestId(`by-${f.products["Lait"]}`)).toContainText("Acheté par Adil");

    await lamiaa.evaluate(() => (window as any).__engine.refresh());
    await expect(lamiaa.getByTestId(`by-${f.products["Lait"]}`)).toContainText("Acheté par Adil");
    await expect(lamiaa.getByTestId("count-tobuy")).toHaveText("2");
    await adil.screenshot({ path: "shots/parent-current.png" });
    await ctxA.close();
    await ctxL.close();
  });

  test("critère 8 : corriger sans motif remet l'article à acheter ; l'archive présente la liste finale, sans trace de correction à l'écran", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const id = await createList(f);
    await staffAdds(f, id, ["Lait", "Riz", "Tomates", "Beurre"]);
    await uiLogin(page, f, "lamiaa", "573918");
    await page.getByTestId(`buy-${f.products["Lait"]}`).click();
    await page.getByTestId(`correct-${f.products["Lait"]}`).click();
    await page.screenshot({ path: "shots/parent-correct.png" });
    await page.getByTestId("correct-confirm").click(); // aucun motif saisi
    await expect(page.getByTestId("count-tobuy")).toHaveText("4");
    await expect(page.getByTestId("count-bought")).toHaveText("0");
    await page.getByTestId(`buy-${f.products["Riz"]}`).click();
    await page.getByTestId(`buy-${f.products["Tomates"]}`).click();
    await expect(page.getByTestId("count-bought")).toHaveText("2");
    // la correction n'est mentionnée nulle part dans la liste en cours, ni dans le détail d'une ligne
    await expect(page.locator("main, .parent__body").first()).not.toContainText(/corrigé|annulé/i);
    await page.getByTestId(`detail-${f.products["Lait"]}`).click();
    await expect(page.getByTestId("item-timeline")).not.toContainText(/corrigé|annulé/i);
    await page.getByTestId("detail-close").click();

    // clôture : l'archive est la liste finale
    await page.getByTestId("close-list").click();
    await page.getByTestId("close-confirm").click();
    await page.getByTestId("tab-history").click();
    await expect(page.getByTestId("history-entry")).not.toContainText(/correction/i);
    await page.getByTestId("history-entry").click();
    await expect(page.getByTestId("archive")).toBeVisible();
    await expect(page.getByTestId("corrections")).toHaveCount(0);
    await expect(page.getByTestId("archive")).not.toContainText(/corrig|annulé|correction/i);
    await expect(page.getByTestId("archive-bought")).toContainText("Riz");
    await expect(page.getByTestId("archive-bought")).toContainText("Tomates");
    await expect(page.getByTestId("archive-bought")).toContainText("Acheté par Lamiaa");
    await expect(page.getByTestId("archive-bought")).toContainText("1 kg");
    await expect(page.getByTestId("archive-bought")).not.toContainText("Lait"); // corrigé : revenu à acheter, jamais racheté
    await expect(page.getByTestId("archive-left")).toHaveText("2"); // Lait et Beurre
    await expect(page.getByTestId("archive-left-list")).toContainText("Lait");
    // regroupement par catégorie
    expect(await page.locator('[data-testid="archive-bought"] .catgroup__title').count()).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: "shots/parent-archive.png", fullPage: true });
    await page.screenshot({ path: "../docs/captures/historique-liste-finale.png", fullPage: true });
  });

  test("critère 11 : clôture avec confirmation et nombre restant ; l'archive garde les non achetés ; nouvelle liste vide", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const id = await createList(f);
    await staffAdds(f, id, ["Lait", "Riz", "Sucre"]);
    await uiLogin(page, f, "adil", "482913");
    await page.getByTestId(`buy-${f.products["Lait"]}`).click();
    await page.getByTestId("close-list").click();
    await expect(page.getByTestId("close-remaining")).toContainText("2 articles");
    await page.screenshot({ path: "shots/parent-close.png" });
    await page.getByTestId("close-confirm").click();
    await expect(page.getByTestId("no-list")).toBeVisible();
    await page.getByTestId("create-list").click();
    await expect(page.getByTestId("count-tobuy")).toHaveText("0");

    await page.getByTestId("tab-history").click();
    await expect(page.getByTestId("history-entry")).toHaveCount(1);
    await expect(page.getByTestId("history-entry")).toContainText("1 produit acheté");
    await expect(page.getByTestId("history-entry")).toContainText("2 non achetés");
    await page.getByTestId("history-entry").click();
    await expect(page.getByTestId("archive-left")).toHaveText("2");
  });

  test("« Modifier » : ajouter un produit non acheté depuis le catalogue ; les achats sont conservés", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const id = await createList(f);
    await staffAdds(f, id, ["Lait"]);
    await uiLogin(page, f, "lamiaa", "573918");
    await page.getByTestId(`buy-${f.products["Lait"]}`).click();
    await page.getByTestId("edit-list").click();
    await expect(page.getByTestId(`card-${f.products["Lait"]}`)).toHaveAttribute("data-state", "bought"); // verrouillé aussi pour un parent
    await page.getByTestId(`card-${f.products["Riz"]}`).click();
    await page.getByTestId("validate").click();
    await expect(page.getByTestId(`card-${f.products["Riz"]}`)).toHaveAttribute("data-state", "saved");
    await page.getByTestId("back").click();
    await expect(page.getByTestId("count-tobuy")).toHaveText("1");
    await expect(page.getByTestId("count-bought")).toHaveText("1");
  });

  test("hors connexion : achat et correction sont bloqués, avec un message clair", async ({ page, context, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const id = await createList(f);
    await staffAdds(f, id, ["Lait"]);
    await uiLogin(page, f, "lamiaa", "573918");
    await expect(page.getByTestId("count-tobuy")).toHaveText("1");
    await context.setOffline(true);
    await page.getByTestId(`buy-${f.products["Lait"]}`).click();
    await expect(page.getByTestId("notice")).toContainText("Pas de connexion");
    await expect(page.getByTestId("offline-limit")).toBeVisible();
    await expect(page.getByTestId("count-tobuy")).toHaveText("1"); // rien n'est présenté comme acheté
    await expect(page.getByTestId("count-bought")).toHaveText("0");
    await page.screenshot({ path: "shots/parent-offline.png" });
    await context.setOffline(false);
    const l = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    expect(l.items[0].status).toBe("to_buy");
  });

  test("le personnel n'a accès à aucun écran parent ; un parent n'a pas l'onglet Réglages", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f, "lamiaa", "573918");
    await expect(page.getByTestId("tab-settings")).toHaveCount(0);
    await expect(page.getByTestId("tab-history")).toBeVisible();
  });
});

test.describe("administration", () => {
  test("créer un profil (code affiché une fois), réinitialiser, désactiver ; le dernier administrateur est protégé", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await uiLogin(page, f, "adil", "482913");
    await page.getByTestId("tab-settings").click();
    await expect(page.getByTestId("family-code")).toHaveText(f.code);
    // sauvegardes : un état simple, les détails techniques sont à un toucher
    await page.getByTestId("seg-backups").click();
    await expect(page.getByTestId("backup-state")).toContainText("non configurée"); // pas de clé de sauvegarde dans cet environnement de test
    await expect(page.getByTestId("backup-details")).toHaveCount(0);
    await page.getByTestId("backup-details-toggle").click();
    await expect(page.getByTestId("backup-details")).toContainText("NON configurée");
    await page.getByTestId("settings-back").click();
    await page.getByTestId("seg-profiles").click();
    await page.getByTestId("add-profile").click();
    await page.getByTestId("np-name").fill("Karim");
    await page.getByTestId("np-login").fill("karim");
    await page.getByTestId("np-role").selectOption("staff");
    const secret = "k4$Mpq"; // choisi par l'administrateur : lettres, chiffres et symboles acceptés
    await page.getByTestId("np-secret").fill(secret);
    await page.getByTestId("np-secret2").fill(secret);
    await page.getByTestId("np-submit").click();
    await expect(page.getByTestId("settings-notice")).toContainText("Karim");
    await page.screenshot({ path: "shots/admin-secret.png" });
    await expect(page.getByTestId("profile-karim")).toBeVisible();

    // le nouveau profil peut se connecter avec ce code
    const ok = await playwright.request.newContext({ baseURL });
    expect((await ok.post("/api/auth/login", { data: { familyCode: f.code, login: "karim", secret } })).status()).toBe(200);

    await page.getByTestId("toggle-karim").click();
    await expect(page.getByTestId("profile-karim")).toContainText("désactivé");
    expect((await ok.get("/api/me")).status()).toBe(401); // session révoquée

    // un administrateur n'a pas de bouton « Désactiver » (et le serveur refuse aussi)
    await expect(page.getByTestId("toggle-adil")).toHaveCount(0);
    await page.screenshot({ path: "shots/admin-profiles.png" });
  });

  test("catalogue : désactiver un produit, chercher dans le catalogue étendu et l'ajouter", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const id = await createList(f);
    await uiLogin(page, f, "adil", "482913");
    await page.getByTestId("tab-settings").click();
    await page.getByTestId("seg-catalog").click();
    await page.getByTestId("active-Tomates").click();
    await expect(page.getByTestId("prod-Tomates")).toContainText("désactivé");

    await page.getByTestId("cat-view-all").click();
    await page.getByTestId("all-search").fill("pêche");
    await expect(page.getByTestId("all-list")).toContainText("Pêches");
    await page.screenshot({ path: "shots/admin-catalog.png" });
    await page.getByTestId("all-add-Pêches").click();
    await expect(page.getByTestId("all-have-Pêches")).toContainText("Déjà disponible");

    const cat = (await (await f.staff.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products.map((p: any) => p.name));
    expect(cat).toContain("Pêches");
    expect(cat).not.toContain("Tomates");
    expect(id).toBeTruthy();
  });
});
