import { expect, test, type Page } from "@playwright/test";
import { createList, newFamily, uiLogin, type Family } from "./helpers";

const RED = new URL("../fixtures/red.png", import.meta.url).pathname;
// Wide picture (300 × 120, not square): checks that nothing is cropped in the preview / card.
const PAIN = new URL("../../server/catalog-photos/files/pain.webp", import.meta.url).pathname;
const WIDE_PNG = new URL("../fixtures/wide.png", import.meta.url).pathname;

async function adminCatalog(page: Page, f: Family) {
  await uiLogin(page, f, "adil", "482913");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("seg-catalog").click();
  await expect(page.getByTestId("add-article")).toBeVisible();
}

test.describe("administration du catalogue : ajouter et modifier un article", () => {
  test("ajout par la galerie, aperçu, visible tout de suite chez le personnel sans recharger", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    const staffCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const staff = await staffCtx.newPage();
    await uiLogin(staff, f);
    await expect(staff.getByTestId("catalog")).toBeVisible();

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await adminCatalog(page, f);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "../docs/captures/admin-catalogue-390x844.png" });

    await page.getByTestId("add-article").click();
    await expect(page.getByRole("dialog", { name: "Ajouter un article" })).toBeVisible();
    await expect(page.getByTestId("pf-save")).toBeDisabled(); // nom obligatoire
    await page.getByTestId("pf-name").fill("Khobz");
    await page.getByTestId("pf-category").selectOption("pain");
    await page.getByTestId("pick-gallery").setInputFiles(WIDE_PNG);
    const prev = page.getByTestId("preview-img");
    await expect(prev).toBeVisible();
    await expect(prev).toHaveCSS("object-fit", "contain");
    await page.getByTestId("pick-gallery").setInputFiles(PAIN); // image du pain rond, cohérente avec « Khobz » (remplace l'aperçu précédent)
    await page.waitForTimeout(400);
    await page.screenshot({ path: "../docs/captures/admin-ajouter-un-article-390x844.png" });
    await page.getByTestId("pf-save").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("prod-Khobz")).toBeVisible();

    // chez le personnel : l'article apparaît (événement catalog.updated), avec son image
    const added = (await (await f.staff.get("/api/catalog")).json()).categories.find((c: any) => c.key === "pain").products.find((p: any) => p.name === "Khobz");
    expect(added.photoUrl).toMatch(/^\/api\/photos\//);
    const sc = staff.getByTestId(`card-${added.id}`);
    await expect(sc).toBeAttached();
    await sc.scrollIntoViewIfNeeded(); // images en chargement différé
    await expect.poll(() => sc.locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(512);
    await expect(sc.locator("img")).toHaveCSS("object-fit", "contain");
    // et le personnel peut le sélectionner puis valider
    await sc.click();
    await staff.getByTestId("validate").click();
    await expect.poll(async () => (await (await f.lamiaa.get("/api/lists/active")).json()).list.items.some((i: any) => i.productId === added.id)).toBe(true);
    await ctx.close();
    await staffCtx.close();
  });

  test("ajout par l'appareil photo (capture) sans image : tuile neutre ; nom en double refusé", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await adminCatalog(page, f);
    await page.getByTestId("add-article").click();
    await expect(page.getByTestId("pick-camera")).toHaveAttribute("capture", "environment");
    await page.getByTestId("pf-name").fill("Harcha");
    await page.getByTestId("pick-camera").setInputFiles(RED);
    await expect(page.getByTestId("preview-img")).toBeVisible();
    await page.getByTestId("pf-save").click();
    await expect(page.getByTestId("prod-Harcha")).toBeVisible();
    // doublon
    await page.getByTestId("add-article").click();
    await page.getByTestId("pf-name").fill("harcha");
    await page.getByTestId("pf-save").click();
    await expect(page.getByTestId("pf-error")).toContainText("existe déjà");
    // fichier illisible
    await page.getByTestId("pick-gallery").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: Buffer.from("pas une image") });
    await expect(page.getByTestId("pf-error")).toContainText("illisible");
    await ctx.close();
  });

  test("modification : nom, catégorie, image, désactivation ; image d'origine ; l'archive garde l'ancien nom", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await f.staff.post(`/api/lists/${listId}/ops`, { data: { ops: [{ opId: crypto.randomUUID(), type: "add", productId: f.products["Tomates"] }] } });
    const before = (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.name === "Tomates");
    await f.lamiaa.post(`/api/lists/${listId}/close`);

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await adminCatalog(page, f);
    await page.getByTestId("edit-Tomates").click();
    await expect(page.getByRole("dialog", { name: "Modifier un article" })).toBeVisible();
    await expect(page.getByTestId("pf-name")).toHaveValue("Tomates");
    await expect(page.getByTestId("preview-img")).toHaveAttribute("src", before.photoUrl);
    await page.waitForTimeout(600);
    await page.screenshot({ path: "../docs/captures/admin-modifier-un-article-390x844.png" }); // état à l'ouverture : image actuelle
    await page.getByTestId("pf-name").fill("Tomates cerises");
    await page.getByTestId("pf-category").selectOption("epicerie");
    await page.getByTestId("pick-gallery").setInputFiles(WIDE_PNG);
    await expect(page.getByTestId("preview-img")).toHaveAttribute("src", /^blob:/);
    await page.getByTestId("pf-save").click();
    await expect(page.getByTestId("prod-Tomates cerises")).toBeVisible();

    const after = (await (await f.staff.get("/api/catalog")).json()).categories.find((c: any) => c.key === "epicerie").products.find((p: any) => p.id === before.id);
    expect(after).toMatchObject({ name: "Tomates cerises", id: before.id });
    expect(after.photoUrl).not.toBe(before.photoUrl);
    // la liste clôturée n'a pas changé
    const arch = (await (await f.lamiaa.get(`/api/lists/${listId}`)).json()).list;
    expect(arch.items[0]).toMatchObject({ name: "Tomates", category: "legumes", photoUrl: before.photoUrl });
    // retour à l'image d'origine
    await page.getByTestId("edit-Tomates cerises").click();
    await page.getByTestId("reset-image").click();
    await page.getByTestId("pf-save").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const back = (await (await f.staff.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.id === before.id);
    expect(back.photoUrl).toBe(before.photoUrl);
    // désactivation par le formulaire : disparaît pour le personnel
    await page.getByTestId("edit-Tomates cerises").click();
    await page.getByTestId("pf-active").uncheck();
    await page.getByTestId("pf-save").click();
    await expect(page.getByTestId("prod-Tomates cerises")).toContainText("désactivé");
    const staffView = (await (await f.staff.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products);
    expect(staffView.find((p: any) => p.id === before.id)).toBeUndefined();
    await ctx.close();
  });

  test("droits : seul l'administrateur ajoute ou modifie ; le personnel et les parents sont refusés", async ({ playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    for (const who of [f.staff, f.lamiaa]) {
      expect((await who.post("/api/products", { data: { name: "Pirate", category: "pain" } })).status()).toBe(403);
      expect((await who.patch(`/api/products/${f.products["Pain"]}`, { data: { name: "Pirate" } })).status()).toBe(403);
    }
    expect((await f.adil.post("/api/products", { data: { name: "Autorisé", category: "pain" } })).status()).toBe(201);
  });

  test("désactivation : plus ajoutable ; reste visible, marqué, achetable et retirable dans la liste en cours ; archives inchangées", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    const add = (id: string) => f.staff.post(`/api/lists/${listId}/ops`, { data: { ops: [{ opId: crypto.randomUUID(), type: "add", productId: id }] } });
    // archive témoin : une liste close avec Tomates
    await add(f.products["Tomates"]!);
    await f.lamiaa.post(`/api/lists/${listId}/close`);
    const oldArchive = (await (await f.lamiaa.get(`/api/lists/${listId}`)).json()).list;
    const list2 = (await (await f.lamiaa.post("/api/lists")).json()).list.id as string;
    const add2 = async (id: string) => (await (await f.staff.post(`/api/lists/${list2}/ops`, { data: { ops: [{ opId: crypto.randomUUID(), type: "add", productId: id }] } })).json()).results[0];
    expect((await add2(f.products["Tomates"]!)).status).toBe("applied");
    expect((await add2(f.products["Oignons"]!)).status).toBe("applied");

    // désactivation par le formulaire de l'administrateur
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await adminCatalog(page, f);
    await expect(page.getByTestId("edit-Tomates")).toBeVisible();
    for (const n of ["Tomates", "Oignons", "Carottes"]) {
      await page.getByTestId(`edit-${n}`).click();
      await expect(page.getByTestId("pf-rule")).toContainText("ne peut plus être ajouté");
      if (n === "Tomates") { await page.getByTestId("pf-active").uncheck(); await page.evaluate(() => document.querySelector(".sheet")!.scrollTo(0, 99999)); await page.waitForTimeout(200); await page.screenshot({ path: "../docs/captures/admin-desactiver-un-article-390x844.png" }); await page.getByTestId("pf-active").check(); }
      await page.getByTestId("pf-active").uncheck();
      await page.getByTestId("pf-save").click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByTestId(`prod-${n}`)).toContainText("désactivé");
    }
    // 1. plus ajoutable (Carottes n'était pas dans la liste)
    expect((await add2(f.products["Carottes"]!)).reason).toBe("product_inactive");
    // 2. déjà dans la liste : visible et marqué chez le personnel et chez le parent
    const staffCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const staff = await staffCtx.newPage();
    await uiLogin(staff, f);
    const tom = staff.getByTestId(`card-${f.products["Tomates"]}`);
    await expect(tom).toContainText("désactivé");
    await expect(staff.getByTestId(`card-${f.products["Carottes"]}`)).toHaveCount(0);
    const parentCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const parent = await parentCtx.newPage();
    await uiLogin(parent, f, "lamiaa", "573918");
    await expect(parent.getByTestId(`row-${f.products["Tomates"]}`)).toContainText("désactivé");
    // achetable (parent)
    await parent.getByTestId(`buy-${f.products["Tomates"]}`).click();
    await expect(parent.getByTestId(`by-${f.products["Tomates"]}`)).toContainText("Acheté par");
    // retirable tant que non acheté (personnel)
    const view = (await (await f.staff.get("/api/lists/active")).json()).list;
    const oignons = view.items.find((i: any) => i.productId === f.products["Oignons"]);
    expect(oignons.productActive).toBe(false);
    const rm = await f.staff.post(`/api/lists/${list2}/ops`, { data: { ops: [{ opId: crypto.randomUUID(), type: "remove", productId: oignons.productId, baseRev: oignons.rev }] } });
    expect((await rm.json()).results[0].status).toBe("applied");
    // 3. archives inchangées
    const after = (await (await f.lamiaa.get(`/api/lists/${listId}`)).json()).list;
    expect(after.items.map((i: any) => ({ name: i.name, category: i.category, photoUrl: i.photoUrl }))).toEqual(oldArchive.items.map((i: any) => ({ name: i.name, category: i.category, photoUrl: i.photoUrl })));
    await ctx.close();
    await staffCtx.close();
    await parentCtx.close();
  });

  test("formulaire sur mobile, clavier ouvert : champs, Enregistrer et fermeture restent accessibles", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await adminCatalog(page, f);
    await page.getByTestId("add-article").click();
    await page.getByTestId("pf-name").focus();
    await page.setViewportSize({ width: 360, height: 320 }); // clavier ouvert : il ne reste que ~320 px
    await page.waitForTimeout(300);
    const inView = async (id: string) => {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b, id).not.toBeNull();
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(321); // tolérance de 1 px (arrondis)
    };
    await page.getByTestId("pf-name").fill("Khobz");
    await page.getByTestId("pf-name").scrollIntoViewIfNeeded(); // comme le navigateur le fait à la frappe
    await inView("pf-name");
    const nameBox = (await page.getByTestId("pf-name").boundingBox())!;
    expect(nameBox.y + nameBox.height).toBeLessThanOrEqual((await page.getByTestId("pf-save").boundingBox())!.y); // pas masqué par la barre du bas
    await inView("pf-save"); // collés en bas de la feuille
    await inView("pf-cancel");
    await inView("pf-close");
    await page.screenshot({ path: "../docs/captures/admin-formulaire-clavier-360x320.png" });
    // un appui hors de la feuille ne ferme pas un formulaire commencé
    await page.mouse.click(180, 2);
    await expect(page.getByTestId("product-form")).toBeVisible();
    await page.getByTestId("pf-close").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await ctx.close();
  });

  test("Enregistrer : un seul envoi malgré le double appui ; échec = données conservées ; succès = fermeture", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await adminCatalog(page, f);
    await page.getByTestId("add-article").click();
    await page.getByTestId("pf-name").fill("Khobz");
    await page.getByTestId("pf-category").selectOption("pain");
    await page.getByTestId("pick-gallery").setInputFiles(PAIN);
    await expect(page.getByTestId("preview-img")).toHaveAttribute("src", /^blob:/);
    // 1. serveur injoignable : message, formulaire et données conservés
    await page.route("**/api/products", (r) => r.request().method() === "POST" ? r.abort("failed") : r.continue());
    await page.getByTestId("pf-save").click();
    await expect(page.getByTestId("pf-error")).toContainText("Pas de connexion");
    await expect(page.getByTestId("product-form")).toBeVisible();
    await expect(page.getByTestId("pf-name")).toHaveValue("Khobz");
    await expect(page.getByTestId("pf-category")).toHaveValue("pain");
    await expect(page.getByTestId("preview-img")).toHaveAttribute("src", /^blob:/);
    await expect(page.getByTestId("pf-save")).toBeEnabled();
    await page.unroute("**/api/products");
    // 2. double appui sur une réponse lente : un seul POST
    let posts = 0;
    await page.route("**/api/products", async (r) => {
      if (r.request().method() !== "POST") return r.continue();
      posts++;
      await new Promise((ok) => setTimeout(ok, 800));
      return r.continue();
    });
    await page.getByTestId("pf-save").dblclick();
    await expect(page.getByTestId("pf-save")).toBeDisabled();
    await expect(page.getByRole("dialog")).toHaveCount(0); // fermé après succès
    expect(posts).toBe(1);
    await expect(page.getByTestId("prod-Khobz")).toBeVisible();
    const all = (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).filter((p: any) => p.name === "Khobz");
    expect(all).toHaveLength(1);
    await ctx.close();
  });
});
