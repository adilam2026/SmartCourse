import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { card, createList, newFamily, uiLogin, type Family } from "./helpers";

const ops = (f: Family, who: "staff" | "lamiaa" | "adil", listId: string, list: object[], batch?: { id: string; at: string }) =>
  f[who].post(`/api/lists/${listId}/ops`, { data: { ops: list, ...(batch ? { batch } : {}) } });
const add = (f: Family, name: string, quantity?: number) => ({ opId: randomUUID(), type: "add", productId: f.products[name]!, ...(quantity !== undefined ? { quantity } : {}) });
const wrap = (page: Page, f: Family, name: string) => page.getByTestId(`wrap-${f.products[name]}`);
const id = (f: Family, name: string) => f.products[name]!;

test.describe("quantités sur les cartes", () => {
  test("le compteur n'apparaît que sur une carte sélectionnée ; [+] et [−] ne sélectionnent ni ne désélectionnent la carte ; [−] est grisé à 1", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    await expect(page.getByTestId(`qty-${id(f, "Lait")}`)).toHaveCount(0);
    await card(page, f, "Lait").click();
    await expect(page.getByTestId(`qty-${id(f, "Lait")}`)).toBeVisible();
    await expect(page.getByTestId(`qty-value-${id(f, "Lait")}`)).toHaveText("1");
    await expect(page.getByTestId(`minus-${id(f, "Lait")}`)).toBeDisabled();
    await page.getByTestId(`plus-${id(f, "Lait")}`).click();
    await page.getByTestId(`plus-${id(f, "Lait")}`).click();
    await expect(page.getByTestId(`qty-value-${id(f, "Lait")}`)).toHaveText("3");
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "unsaved"); // toujours sélectionnée
    await page.getByTestId(`minus-${id(f, "Lait")}`).click();
    await expect(page.getByTestId(`qty-value-${id(f, "Lait")}`)).toHaveText("2");
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "unsaved");
    // [−] à 1 reste grisé : décocher se fait en touchant la carte
    await page.getByTestId(`minus-${id(f, "Lait")}`).click();
    await expect(page.getByTestId(`minus-${id(f, "Lait")}`)).toBeDisabled();
    await card(page, f, "Lait").click();
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "off");
    await expect(page.getByTestId(`qty-${id(f, "Lait")}`)).toHaveCount(0);
    await expect(page.getByTestId("validate")).toBeDisabled();
    await page.screenshot({ path: "shots/qty-card.png" });
  });

  test("les boutons du compteur sont assez grands pour un pouce (≥ 44 px)", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f);
    await card(page, f, "Lait").click();
    for (const t of ["minus", "plus"]) {
      const b = (await page.getByTestId(`${t}-${id(f, "Lait")}`).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("kg : décimales, pas de 0,5, saisie possible ; la quantité validée arrive chez les parents avec son unité", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await uiLogin(page, f);
    const t = id(f, "Tomates");
    await card(page, f, "Tomates").click();
    await expect(page.getByTestId(`qty-input-${t}`)).toHaveValue("1");
    await page.getByTestId(`plus-${t}`).click();
    await expect(page.getByTestId(`qty-input-${t}`)).toHaveValue("1,5");
    await page.getByTestId(`qty-input-${t}`).fill("2,25");
    await page.getByTestId(`qty-input-${t}`).press("Enter");
    await expect(page.getByTestId(`qty-input-${t}`)).toHaveValue("2,25");
    await page.getByTestId("validate").click();
    await expect(card(page, f, "Tomates")).toHaveAttribute("data-state", "saved");
    const list = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    expect(list.items.find((i: any) => i.productId === t)).toMatchObject({ quantity: 2.25, unit: "kg" });
    // quantité minimale 0,1 : « − » grisé
    await page.getByTestId(`qty-input-${t}`).fill("0,5");
    await page.getByTestId(`qty-input-${t}`).press("Enter");
    await expect(page.getByTestId(`minus-${t}`)).toBeDisabled();
    expect(listId).toBeTruthy();
  });

  test("changer la quantité d'un article déjà enregistré puis valider met à jour la liste (une seule ligne)", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await ops(f, "staff", listId, [add(f, "Lait", 2)]);
    await uiLogin(page, f);
    await expect(page.getByTestId(`qty-value-${id(f, "Lait")}`)).toHaveText("2"); // quantité actuelle affichée
    await page.getByTestId(`plus-${id(f, "Lait")}`).click();
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "unsaved");
    await page.getByTestId("validate").click();
    await expect(page.getByTestId("sync-state")).toContainText("Enregistré");
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "saved");
    await expect(page.getByTestId(`qty-value-${id(f, "Lait")}`)).toHaveText("3");
    const list = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    expect(list.items.filter((i: any) => i.productId === id(f, "Lait"))).toHaveLength(1);
    expect(list.items[0].quantity).toBe(3);
  });

  test("article acheté : verrouillé, avec un bouton « Nouvelle demande » explicite ; la demande crée une nouvelle ligne sans toucher à l'achat", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await ops(f, "staff", listId, [add(f, "Lait", 2)]);
    const item = (await (await f.lamiaa.get("/api/lists/active")).json()).list.items[0];
    await ops(f, "adil", listId, [{ opId: randomUUID(), type: "purchase", itemId: item.id }]);
    await uiLogin(page, f);
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "bought");
    await card(page, f, "Lait").click(); // un appui n'annule jamais un achat
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "bought");
    await expect(page.getByTestId("validate")).toBeDisabled();
    await page.getByTestId(`again-${id(f, "Lait")}`).click();
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "unsaved");
    await expect(page.getByText("Nouvelle demande").first()).toBeVisible();
    await page.getByTestId(`plus-${id(f, "Lait")}`).click();
    await page.getByTestId("validate").click();
    await expect(page.getByTestId("sync-state")).toContainText("Enregistré");
    const list = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    const lines = list.items.filter((i: any) => i.productId === id(f, "Lait"));
    expect(lines.map((l: any) => [l.status, l.quantity]).sort()).toEqual([["purchased", 2], ["to_buy", 2]]);
  });
});

test.describe("affichage du catalogue du personnel", () => {
  test("par défaut « Tous les produits » ; le choix est visible, change à tout moment, est mémorisé et ne perd aucune sélection ni quantité", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f);
    await expect(page.getByTestId("view-all")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-testid^=card-]")).toHaveCount(80);
    await expect(page.getByRole("heading", { name: /Légumes/ })).toBeVisible();

    await card(page, f, "Tomates").click();
    await page.getByTestId(`plus-${id(f, "Tomates")}`).click(); // 1,5 kg
    await card(page, f, "Lait").click();

    await page.getByTestId("view-categories").click();
    await expect(page.getByTestId("category-blocks")).toBeVisible();
    await expect(page.locator("[data-testid^=card-]")).toHaveCount(0);
    await expect(page.getByTestId("catcount-legumes")).toHaveText("1");
    await expect(page.getByTestId("catcount-laitages")).toHaveText("1");
    await expect(page.getByTestId("validate")).toBeEnabled(); // la validation de toute la sélection reste accessible
    await page.screenshot({ path: "shots/staff-categories.png" });

    await page.getByTestId("catblock-legumes").click();
    await expect(page.getByTestId("category-open")).toBeVisible();
    await expect(page.getByTestId("cat-back")).toBeVisible();
    await expect(page.getByTestId(`qty-input-${id(f, "Tomates")}`)).toHaveValue("1,5");
    await expect(card(page, f, "Tomates")).toHaveAttribute("data-state", "unsaved");
    await expect(card(page, f, "Lait")).toHaveCount(0); // seulement les légumes
    await page.screenshot({ path: "shots/staff-category-open.png" });
    await page.getByTestId("cat-back").click();
    await expect(page.getByTestId("category-blocks")).toBeVisible();

    // le choix est mémorisé (après rechargement) et la sélection aussi
    await page.reload();
    await expect(page.getByTestId("view-categories")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("catcount-legumes")).toHaveText("1");
    await page.getByTestId("view-all").click();
    await expect(page.locator("[data-testid^=card-]")).toHaveCount(80);
    await expect(page.getByTestId(`qty-input-${id(f, "Tomates")}`)).toHaveValue("1,5");
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "unsaved");
    await page.getByTestId("validate").click();
    await expect(page.getByTestId("sync-state")).toContainText("Enregistré");
    const list = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    expect(list.items.map((i: any) => [i.name, i.quantity]).sort()).toEqual([["Lait", 1], ["Tomates", 1.5]]);
  });

  test("le bouton Retour du téléphone ferme la catégorie ouverte avant de quitter l'écran", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f);
    await page.getByTestId("view-categories").click();
    await page.getByTestId("catblock-fruits").click();
    await expect(page.getByTestId("category-open")).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("category-blocks")).toBeVisible();
  });

  test("la recherche trouve les produits de toutes les catégories, dans les deux affichages", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f);
    for (const mode of ["view-all", "view-categories"]) {
      await page.getByTestId(mode).click();
      await page.getByTestId("catalog-search").fill("pomme");
      await expect(card(page, f, "Pommes")).toBeVisible(); // fruits
      await expect(card(page, f, "Pommes de terre")).toBeVisible(); // légumes
      await expect(card(page, f, "Lait")).toHaveCount(0);
      // on peut sélectionner depuis les résultats ; effacer la recherche garde la sélection
      await card(page, f, "Pommes").click();
      await page.getByTestId("catalog-search").fill("");
      await expect(page.getByTestId("validate")).toBeEnabled();
      await card(page, f, "Pommes").count(); // (visible seulement en mode « tous »)
      await page.getByTestId("catalog-search").fill("pomme");
      await card(page, f, "Pommes").click(); // retour à l'état initial
      await page.getByTestId("catalog-search").fill("");
    }
    await page.getByTestId("catalog-search").fill("accentué sans résultat xyz");
    await expect(page.getByTestId("search-empty")).toBeVisible();
    await page.getByTestId("catalog-search").fill("peche"); // sans accent
    await expect(page.getByText("Pêches").or(page.getByText("Aucun produit")).first()).toBeVisible();
  });
});

test.describe("liste d'achats des parents", () => {
  test("regroupée par catégorie, À acheter / Achetés séparés, auteur, heure et quantité sur chaque ligne ; historique des validations 08:00 / 14:00", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - 1);
    const at = (h: number) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, 0, 0)).toISOString();
    // 07:00 UTC = 08:00 à Casablanca ; 13:00 UTC = 14:00. Ordre d'ajout volontairement mélangé entre catégories.
    await ops(f, "staff", listId, [add(f, "Lait", 2), add(f, "Tomates", 1.5), add(f, "Pommes"), add(f, "Carottes", 2), add(f, "Riz")], { id: randomUUID(), at: at(7) });
    await ops(f, "lamiaa", listId, [add(f, "Oignons", 1), add(f, "Bananes", 3), add(f, "Sucre")], { id: randomUUID(), at: at(13) });
    const view = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    const lait = view.items.find((i: any) => i.productId === id(f, "Lait"));
    await ops(f, "adil", listId, [{ opId: randomUUID(), type: "purchase", itemId: lait.id }]);
    await ops(f, "lamiaa", listId, [{ opId: randomUUID(), type: "set_qty", productId: id(f, "Tomates"), quantity: 3, baseRev: view.items.find((i: any) => i.productId === id(f, "Tomates")).rev }], { id: randomUUID(), at: at(13) });

    await uiLogin(page, f, "lamiaa", "573918");
    await expect(page.getByTestId("to-buy")).toBeVisible();
    const titles = await page.locator('[data-testid="to-buy"] .catgroup__title').allTextContents();
    expect(titles.map((t) => t.replace(/\s+\d+\s*$/, "").trim())).toEqual([expect.stringContaining("Légumes"), expect.stringContaining("Fruits"), expect.stringContaining("Épicerie")]);
    // tous les légumes ensemble, quelle que soit l'heure ou l'auteur
    const legumes = await page.locator('[data-testid="group-legumes"] [data-testid^=row-]').count();
    expect(legumes).toBe(3); // Tomates, Carottes, Oignons
    await expect(page.getByTestId("count-tobuy")).toHaveText("7");
    await expect(page.getByTestId("count-bought")).toHaveText("1");
    await expect(page.getByTestId("bought").getByTestId(`row-${id(f, "Lait")}`)).toBeVisible();
    await expect(page.getByTestId("to-buy").getByTestId(`row-${id(f, "Lait")}`)).toHaveCount(0);

    // quantité, auteur et heure sur la ligne ; l'heure d'ajout du matin n'est pas écrasée par la modification de l'après-midi
    const tom = page.getByTestId(`row-${id(f, "Tomates")}`);
    await expect(tom).toContainText("3 kg");
    await expect(page.getByTestId(`added-${id(f, "Tomates")}`)).toContainText("Marie");
    await expect(page.getByTestId(`added-${id(f, "Tomates")}`)).toContainText("08:00");
    await expect(page.getByTestId(`changed-${id(f, "Tomates")}`)).toContainText("Lamiaa");
    await expect(page.getByTestId(`changed-${id(f, "Tomates")}`)).toContainText("14:00");
    await expect(page.getByTestId(`added-${id(f, "Oignons")}`)).toContainText("14:00");
    await page.screenshot({ path: "shots/parent-grouped.png", fullPage: true });

    // détail des modifications d'une ligne
    await page.getByTestId(`detail-${id(f, "Tomates")}`).click();
    const tl = page.getByTestId("item-timeline");
    await expect(tl).toContainText("Ajouté");
    await expect(tl).toContainText("Quantité 1,5 → 3 kg");
    await expect(tl).toContainText("Marie");
    await expect(tl).toContainText("Lamiaa");
    await page.getByTestId("detail-close").click();

    // historique des validations : le groupe de 08:00 et celui de 14:00 sont distincts
    await page.getByTestId("open-validations").click();
    const groups = page.getByTestId("validation-group");
    await expect(groups).toHaveCount(3); // 08:00 (5 articles), 14:00 (3 ajouts), puis la modification de 14:00
    await expect(groups.nth(0)).toContainText("14:00");
    await expect(groups.nth(0)).toContainText("1,5 kg → 3 kg"); // la plus récente d'abord
    await expect(groups.nth(1)).toContainText("14:00");
    await expect(groups.nth(1)).toContainText("Lamiaa");
    await expect(groups.nth(1)).toContainText("Oignons");
    await expect(groups.nth(1)).toContainText("3 changements");
    await expect(groups.nth(2)).toContainText("08:00");
    await expect(groups.nth(2)).toContainText("Marie");
    await expect(groups.nth(2)).toContainText("Lait");
    await expect(groups.nth(2)).toContainText("5 changements");
    await page.screenshot({ path: "shots/parent-validations.png" });
    await page.getByTestId("validations-close").click();
  });

  test("le personnel ne voit pas les auteurs ni l'historique", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await ops(f, "lamiaa", listId, [add(f, "Lait", 2)]);
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    await expect(page.getByText("Ajouté par")).toHaveCount(0);
    await expect(page.getByTestId("open-validations")).toHaveCount(0);
    await expect(page.getByTestId("tab-stats")).toHaveCount(0);
  });

  test("un ajout en direct rejoint sa catégorie sans déplacer ce que le parent est en train de lire", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    const names = ["Tomates", "Carottes", "Oignons", "Courgettes", "Aubergines", "Pommes", "Bananes", "Lait", "Riz", "Sucre", "Œufs", "Pâtes"];
    await ops(f, "staff", listId, names.filter((n) => f.products[n]).map((n) => add(f, n)));
    await page.setViewportSize({ width: 390, height: 600 });
    await uiLogin(page, f, "lamiaa", "573918");
    await expect(page.getByTestId("to-buy")).toBeVisible();
    const target = page.getByTestId(`row-${id(f, "Sucre")}`);
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 120));
    const before = (await target.boundingBox())!.y;
    // un nouveau légume arrive pendant la lecture : il va dans « Légumes », au-dessus de ce qui est lu
    await ops(f, "staff", listId, [add(f, "Concombres")]);
    await expect(page.getByTestId(`row-${id(f, "Concombres")}`)).toHaveCount(1);
    await page.waitForTimeout(300);
    const after = (await target.boundingBox())!.y;
    expect(Math.abs(after - before)).toBeLessThan(6);
    const grp = await page.locator('[data-testid="group-legumes"] [data-testid^=row-]').count();
    expect(grp).toBeGreaterThanOrEqual(5);
  });

  test("les parents ajoutent et ajustent depuis « Modifier » comme le personnel ; le personnel voit la nouvelle quantité", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await ops(f, "staff", listId, [add(f, "Lait", 1)]);
    await uiLogin(page, f, "lamiaa", "573918");
    await page.getByTestId("edit-list").click();
    await expect(page.getByTestId(`qty-value-${id(f, "Lait")}`)).toHaveText("1");
    await page.getByTestId(`plus-${id(f, "Lait")}`).click();
    await card(page, f, "Riz").click();
    await page.getByTestId("validate").click();
    await expect(page.getByTestId("sync-state")).toContainText("Enregistré");
    const staffView = (await (await f.staff.get("/api/lists/active")).json()).list;
    expect(staffView.items.map((i: any) => [i.name, i.quantity]).sort()).toEqual([["Lait", 2], ["Riz", 1]]);
    // l'auteur de chaque action est conservé
    const parentView = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    expect(parentView.events.map((e: any) => [e.name, e.kind, e.by.displayName])).toEqual([["Lait", "add", "Marie"], ["Lait", "qty", "Lamiaa"], ["Riz", "add", "Lamiaa"]]);
    // Retour revient à la liste
    await page.goBack();
    await expect(page.getByTestId("to-buy")).toBeVisible();
  });
});

test.describe("Statistiques d'achats", () => {
  test("écran réservé aux parents : mois, fréquence et quantité séparées, unités jamais mélangées, pas de dépenses", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await ops(f, "staff", listId, [add(f, "Tomates", 2), add(f, "Lait", 3)]);
    const items = (await (await f.lamiaa.get("/api/lists/active")).json()).list.items;
    for (const it of items) await ops(f, "adil", listId, [{ opId: randomUUID(), type: "purchase", itemId: it.id }]);
    await uiLogin(page, f, "lamiaa", "573918");
    await page.getByTestId("tab-stats").click();
    await expect(page.getByTestId("stats-month")).toBeVisible();
    await expect(page.getByTestId("stats-total")).toContainText("2 achats confirmés");
    await expect(page.getByTestId("freq-Tomates")).toHaveText("1 achat");
    await expect(page.getByTestId("quant-Tomates")).toHaveText("2 kg");
    await expect(page.getByTestId("quant-Lait")).toHaveText("3 pièces");
    await expect(page.getByTestId("stats-no-spending")).toContainText("pas de statistiques de dépenses");
    await expect(page.getByText("Statistiques d'achats").first()).toBeVisible();
    await expect(page.getByTestId("stats-prev")).toBeDisabled(); // aucun mois plus ancien
    await page.screenshot({ path: "shots/stats.png" });
  });
});

test.describe("vérifications demandées : kg, heures, corrections", () => {
  test("kg : depuis 1 kg le bouton « − » n'est pas bloqué et mène à 0,5 kg ; à 0,5 kg il est grisé", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    await uiLogin(page, f);
    const t = id(f, "Tomates");
    await card(page, f, "Tomates").click();
    await expect(page.getByTestId(`qty-input-${t}`)).toHaveValue("1");
    await expect(page.getByTestId(`minus-${t}`)).toBeEnabled();
    await page.getByTestId(`minus-${t}`).click();
    await expect(page.getByTestId(`qty-input-${t}`)).toHaveValue("0,5");
    await expect(page.getByTestId(`minus-${t}`)).toBeDisabled();
    await page.getByTestId("validate").click();
    await expect(page.getByTestId("sync-state")).toContainText("Enregistré");
    const list = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    expect(list.items[0]).toMatchObject({ quantity: 0.5, unit: "kg" });
    await page.screenshot({ path: "shots/kg-half.png" });
  });

  test("hors connexion : l'heure du téléphone et l'heure de réception sont toutes deux conservées ; « envoyé plus tard » seulement quand c'est vrai", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    const pressed = new Date(Date.now() - 3 * 3_600_000);
    await ops(f, "staff", listId, [add(f, "Lait", 2)], { id: randomUUID(), at: pressed.toISOString() }); // validé il y a 3 h, reçu maintenant
    await ops(f, "lamiaa", listId, [add(f, "Riz")], { id: randomUUID(), at: new Date().toISOString() }); // envoi immédiat
    await uiLogin(page, f, "lamiaa", "573918");
    await expect(page.getByTestId(`late-${id(f, "Lait")}`)).toContainText("envoyé plus tard");
    await expect(page.getByTestId(`late-${id(f, "Lait")}`)).toContainText("reçu");
    await expect(page.getByTestId(`late-${id(f, "Riz")}`)).toHaveCount(0);
    await page.getByTestId("open-validations").click();
    await expect(page.getByTestId("validation-late")).toHaveCount(1); // une seule validation en retard
    await expect(page.getByTestId("validation-late")).toContainText("validé sur le téléphone");
    await page.screenshot({ path: "shots/late.png" });
    // les deux heures existent côté serveur
    const view = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    const v = view.validations.find((x: any) => x.by.displayName === "Marie");
    expect(new Date(v.clientAt).getTime()).toBe(pressed.getTime());
    expect(new Date(v.receivedAt).getTime()).toBeGreaterThan(pressed.getTime() + 2.9 * 3_600_000);
  });

  test("corriger un achat avec une nouvelle demande de même unité : quantités regroupées, historique, auteur de l'achat et de la correction conservés", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await ops(f, "staff", listId, [add(f, "Tomates", 2)]);
    const bought = (await (await f.lamiaa.get("/api/lists/active")).json()).list.items[0];
    await ops(f, "adil", listId, [{ opId: randomUUID(), type: "purchase", itemId: bought.id }]);
    await ops(f, "staff", listId, [{ opId: randomUUID(), type: "request_again", productId: id(f, "Tomates"), quantity: 1.5 }]);
    await uiLogin(page, f, "lamiaa", "573918");
    await expect(page.getByTestId("count-tobuy")).toHaveText("1");
    await page.getByTestId(`correct-${id(f, "Tomates")}`).click();
    await page.getByTestId("correct-confirm").click();
    await expect(page.getByTestId("count-bought")).toHaveText("0");
    const row = page.getByTestId("to-buy").getByTestId(`row-${id(f, "Tomates")}`);
    await expect(row).toContainText("3,5 kg"); // 2 + 1,5 : rien perdu
    await page.getByTestId(`detail-${id(f, "Tomates")}`).click();
    const tl = page.getByTestId("item-timeline");
    await expect(tl).toContainText("Nouvelle demande · 1,5 kg");
    await expect(tl).toContainText("quantité reportée 1,5 kg → 3,5 kg");
    await expect(page.getByTestId("item-correction")).toContainText("2 kg");
    await expect(page.getByTestId("item-correction")).toContainText("Acheté par Adil");
    await expect(page.getByTestId("item-correction")).toContainText("corrigé par Lamiaa");
    await page.screenshot({ path: "shots/correction-merge.png" });
  });

  test("corriger un achat avec une nouvelle demande dans une autre unité : refus clair, kg et pièces jamais additionnés", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await ops(f, "staff", listId, [add(f, "Tomates", 2)]);
    const bought = (await (await f.lamiaa.get("/api/lists/active")).json()).list.items[0];
    await ops(f, "adil", listId, [{ opId: randomUUID(), type: "purchase", itemId: bought.id }]);
    expect((await f.adil.patch(`/api/products/${id(f, "Tomates")}`, { data: { unit: "piece" } })).status()).toBe(200); // l'unité du produit change
    await ops(f, "staff", listId, [{ opId: randomUUID(), type: "request_again", productId: id(f, "Tomates"), quantity: 4 }]);
    await uiLogin(page, f, "lamiaa", "573918");
    await page.getByTestId(`correct-${id(f, "Tomates")}`).click();
    await page.getByTestId("correct-confirm").click();
    await expect(page.getByText(/autre unité/)).toBeVisible();
    await expect(page.getByText(/4 pièces/).first()).toBeVisible();
    await expect(page.getByTestId("count-bought")).toHaveText("1"); // l'achat est intact
    await expect(page.getByTestId("count-tobuy")).toHaveText("1");
    const list = (await (await f.lamiaa.get("/api/lists/active")).json()).list;
    expect(list.items.map((i: any) => [i.status, i.quantity, i.unit]).sort()).toEqual([["purchased", 2, "kg"], ["to_buy", 4, "piece"]]);
    await page.screenshot({ path: "shots/correction-units.png" });
  });
});

