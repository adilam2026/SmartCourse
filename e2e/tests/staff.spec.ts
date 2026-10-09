import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { card, createList, newFamily, op, uiLogin } from "./helpers";

test.describe("parcours du personnel", () => {
  test("critère 1 + aspect : le catalogue de la liste active s'affiche aussitôt après connexion", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    await expect(page.locator("[data-testid^=card-]")).toHaveCount(80);
    // deux cartes par ligne sur mobile
    const a = await card(page, f, "Tomates").boundingBox();
    const b = await card(page, f, "Pommes de terre").boundingBox();
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    expect(a!.width).toBeGreaterThan(140);
    await expect(page.getByTestId("validate")).toBeDisabled();
    await page.screenshot({ path: "shots/staff-catalog.png" });
  });

  test("sans liste active : écran simple, puis la liste apparaît toute seule", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await uiLogin(page, f);
    await expect(page.getByTestId("no-list")).toBeVisible();
    await expect(page.getByTestId("no-list")).toContainText("Aucune liste en cours");
    await expect(page.getByTestId("validate")).toHaveCount(0); // aucune action de création pour le personnel
    await page.screenshot({ path: "shots/staff-nolist.png" });
    await createList(f);
    await page.evaluate(() => (window as any).__engine.refresh());
    await expect(page.getByTestId("catalog")).toBeVisible();
  });

  test("critères 2, 3, 4 : décocher = grisé ; fermer/rouvrir conserve ; valider enregistre et grise à nouveau", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();

    // 2 : cocher puis décocher sans autre changement
    await card(page, f, "Lait").click();
    await expect(page.getByTestId("validate")).toBeEnabled();
    await card(page, f, "Lait").click();
    await expect(page.getByTestId("validate")).toBeDisabled();

    // 3 : deux choix, application fermée puis rouverte
    await card(page, f, "Lait").click();
    await card(page, f, "Riz").click();
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "unsaved");
    await page.screenshot({ path: "shots/staff-selected.png" });
    await page.reload();
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "unsaved");
    await expect(card(page, f, "Riz")).toHaveAttribute("data-state", "unsaved");
    await expect(page.getByTestId("validate")).toBeEnabled();

    // 4 : valider → visible côté parent, bouton grisé après confirmation serveur
    await page.getByTestId("validate").click();
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "saved");
    await expect(page.getByTestId("validate")).toBeDisabled();
    await expect(page.getByTestId("sync-state")).toContainText("Enregistré");
    const list = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    expect(list.items.map((i: any) => i.name).sort()).toEqual(["Lait", "Riz"]);
    await page.screenshot({ path: "shots/staff-saved.png" });
  });

  test("critère 7 : un article acheté reste coché, verrouillé, et ne peut pas être décoché", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await f.lamiaa.post(`/api/lists/${listId}/ops`, { data: { ops: [op.add(f.products["Lait"]!)] } });
    await uiLogin(page, f);
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "saved");

    const item = (await (await f.lamiaa.get("/api/lists/active")).json()).list.items[0];
    await f.adil.post(`/api/lists/${listId}/ops`, { data: { ops: [op.purchase(item.id)] } });
    await page.evaluate(() => (window as any).__engine.refresh());
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "bought");
    await card(page, f, "Lait").click();
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "bought");
    await expect(page.getByTestId("validate")).toBeDisabled();
    await expect(card(page, f, "Lait")).toContainText("Acheté");
    // le personnel ne voit pas qui a acheté
    await expect(page.locator("body")).not.toContainText("Adil");
    await page.screenshot({ path: "shots/staff-bought.png" });
  });

  test("critère 10 : hors connexion, les choix et la validation restent en attente, sans fausse confirmation ; envoi au retour du réseau", async ({ page, context, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    await page.waitForTimeout(800); // laisse le service worker prendre la main

    await context.setOffline(true);
    await card(page, f, "Lait").click();
    await card(page, f, "Sucre").click();
    await page.getByTestId("validate").click();
    await expect(page.getByTestId("banner-offline")).toBeVisible();
    await expect(page.getByTestId("banner-pending")).toBeVisible();
    await expect(page.getByTestId("sync-state")).toContainText("En attente");
    await expect(page.getByTestId("sync-state")).not.toContainText("Enregistré");
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "unsaved"); // pas « saved »
    await page.screenshot({ path: "shots/staff-offline-pending.png" });

    // l'application est rechargée toujours hors connexion : le shell, le catalogue et l'envoi en attente reviennent
    await page.reload();
    await expect(page.getByTestId("catalog")).toBeVisible();
    await expect(page.getByTestId("banner-pending")).toBeVisible();
    expect((await (await f.lamiaa.get("/api/lists/active")).json()).list.items).toEqual([]); // le serveur n'a rien reçu

    await context.setOffline(false);
    await page.evaluate(() => (window as any).__engine.retryNow());
    await expect(page.getByTestId("banner-pending")).toHaveCount(0);
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "saved");
    const names = (await (await f.lamiaa.get("/api/lists/active")).json()).list.items.map((i: any) => i.name).sort();
    expect(names).toEqual(["Lait", "Sucre"]);
  });

  test("critère 12 : liste clôturée puis nouvelle liste — le brouillon n'est pas appliqué, reprise explicite", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const oldId = await createList(f);
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    await card(page, f, "Lait").click();
    await card(page, f, "Riz").click(); // brouillon non validé

    await f.lamiaa.post(`/api/lists/${oldId}/close`);
    const newId = await createList(f);
    await page.evaluate(() => (window as any).__engine.refresh());

    await expect(page.getByTestId("banner-orphan")).toBeVisible();
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "off"); // rien d'appliqué à la nouvelle liste
    await expect(page.getByTestId("validate")).toBeDisabled();
    await page.screenshot({ path: "shots/staff-orphan.png" });
    const fresh = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    expect(fresh.id).toBe(newId);
    expect(fresh.items).toEqual([]);

    await page.getByTestId("orphan-resume").click();
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "unsaved");
    await expect(page.getByTestId("validate")).toBeEnabled();
    await page.getByTestId("validate").click();
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "saved");
    const archived = (await (await f.lamiaa.get(`/api/lists/${oldId}`)).json()).list;
    expect(archived.items).toEqual([]); // l'archive n'a pas bougé
  });

  test("critère 13 : un profil désactivé est renvoyé à la connexion", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    const profiles = (await (await f.adil.get("/api/profiles")).json()).profiles;
    const staff = profiles.find((p: any) => p.login === f.staffLogin);
    await f.adil.patch(`/api/profiles/${staff.id}`, { data: { active: false } });
    await page.evaluate(() => (window as any).__engine.refresh());
    await expect(page.getByTestId("login-submit")).toBeVisible();
  });

  test("photos : affichées, mises en cache et disponibles hors connexion", async ({ page, context, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    // une vraie image téléversée par l'administrateur
    const png = readFileSync(new URL("../fixtures/red.png", import.meta.url));
    const up = await f.adil.post(`/api/products/${f.products["Tomates"]}/photo`, { headers: { "content-type": "image/png" }, data: png });
    expect(up.status()).toBe(200);
    await uiLogin(page, f);
    const img = card(page, f, "Tomates").locator("img");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await page.waitForTimeout(1500); // préchargement + service worker
    await context.setOffline(true);
    await page.reload();
    const img2 = card(page, f, "Tomates").locator("img");
    await expect(img2).toBeVisible();
    await expect.poll(() => img2.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    // un produit sans photo : tuile neutre avec le nom, pas de fausse image
    await expect(card(page, f, "Riz").locator("img")).toHaveCount(0);
    await expect(card(page, f, "Riz")).toContainText("Riz"); // le nom reste sous la tuile
  });
});
