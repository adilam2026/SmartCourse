import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { card, createList, newFamily, uiLogin, type Family } from "./helpers";

/*
 * Améliorations de présentation et de statistiques : cartes avec compteur intégré, haut du catalogue simplifié, lignes
 * uniformes, unités adaptées, statistiques lisibles, fiche d'achats par produit, fuseau Africa/Casablanca.
 * Les captures de l'écran réel sont écrites dans docs/captures/.
 */
const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const CAP = "../docs/captures";
const MOBILE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } as const;

async function sql<T = any>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}
const add = (f: Family, name: string, quantity?: number) => ({ opId: randomUUID(), type: "add", productId: f.products[name]!, ...(quantity !== undefined ? { quantity } : {}) });
const again = (f: Family, name: string, quantity: number) => ({ opId: randomUUID(), type: "request_again", productId: f.products[name]!, quantity });
const post = (f: Family, who: "staff" | "lamiaa" | "adil", listId: string, ops: object[], batch?: { id: string; at: string }) => f[who].post(`/api/lists/${listId}/ops`, { data: { ops, ...(batch ? { batch } : {}) } });
const activeItems = async (f: Family) => (await (await f.lamiaa.get("/api/lists/active")).json()).list.items as any[];
const wrap = (page: Page, f: Family, name: string) => page.getByTestId(`wrap-${f.products[name]}`);
const pid = (f: Family, name: string) => f.products[name]!;

/** Buys `name` once per entry of `when` (ISO dates): add / request again, buy, then set the purchase date. Returns the purchase ids. */
async function buyAt(f: Family, listId: string, name: string, qty: number, when: string[], who: "adil" | "lamiaa" = "adil"): Promise<string[]> {
  const ids: string[] = [];
  for (const at of when) {
    const open = (await activeItems(f)).find((i) => i.productId === pid(f, name) && i.status === "to_buy");
    if (!open) {
      const r = await (await post(f, "lamiaa", listId, [add(f, name, qty)])).json();
      if (r.results[0].reason === "already_purchased") await post(f, "lamiaa", listId, [again(f, name, qty)]);
    }
    const line = (await activeItems(f)).find((i) => i.productId === pid(f, name) && i.status === "to_buy")!;
    await post(f, who, listId, [{ opId: randomUUID(), type: "purchase", itemId: line.id }]);
    const row = (await sql("SELECT id FROM purchases WHERE list_item_id = $1 AND voided_at IS NULL", [line.id]))[0];
    await sql("UPDATE purchases SET purchased_at = $2 WHERE id = $1", [row.id, at]);
    ids.push(row.id);
  }
  return ids;
}

test.describe("1 · cartes produits : compteur intégré dans le bas de la carte", () => {
  test("[−] 1 kg [+] dans la carte, centre touchable pour saisir, grille régulière, noms longs", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    const long = "Fromage de chèvre frais aux herbes de Provence et miel";
    expect((await f.adil.post("/api/products", { data: { name: long, category: "laitages", unit: "pot" } })).status()).toBe(201);
    f.products[long] = (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.name === long).id;
    const ctx = await browser.newContext(MOBILE);
    const page = await ctx.newPage();
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();

    // le compteur n'existe que sur la carte sélectionnée, et il est DANS la carte
    await expect(page.getByTestId(`qty-${pid(f, "Lait")}`)).toHaveCount(0);
    await card(page, f, "Lait").click();
    const box = (await wrap(page, f, "Lait").boundingBox())!;
    const qty = (await page.getByTestId(`qty-${pid(f, "Lait")}`).boundingBox())!;
    expect(qty.x).toBeGreaterThanOrEqual(box.x);
    expect(qty.x + qty.width).toBeLessThanOrEqual(box.x + box.width);
    expect(qty.y).toBeGreaterThanOrEqual(box.y);
    expect(qty.y + qty.height).toBeLessThanOrEqual(box.y + box.height);
    // trois zones distinctes : photo, nom, compteur — le compteur est SOUS la photo et le nom, jamais dessus
    const photo = (await card(page, f, "Lait").boundingBox())!;
    const nameBox = (await wrap(page, f, "Lait").locator(".card__name").boundingBox())!;
    expect(qty.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
    expect(qty.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1);
    for (const t of ["minus", "plus"]) {
      const b = (await page.getByTestId(`${t}-${pid(f, "Lait")}`).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }

    // grille régulière : toutes les cartes d'une même rangée ont la même hauteur, sélectionnées ou non
    const rows = await page.locator("[data-testid^=wrap-]").evaluateAll((els) => {
      const by = new Map<number, number[]>();
      for (const e of els) {
        const r = e.getBoundingClientRect();
        const k = Math.round(r.top + window.scrollY);
        by.set(k, [...(by.get(k) ?? []), Math.round(r.height)]);
      }
      return [...by.values()].filter((h) => h.length > 1);
    });
    expect(rows.length).toBeGreaterThan(10);
    for (const heights of rows) expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);

    // [+] / [−] ne désélectionnent pas ; le centre est une zone de saisie pour TOUTES les unités
    const lait = pid(f, "Lait");
    await page.getByTestId(`plus-${lait}`).click();
    await expect(page.getByTestId(`qty-input-${lait}`)).toHaveValue("2");
    await expect(page.getByTestId(`qty-unit-${lait}`)).toHaveText("pièces");
    expect(await page.getByTestId(`qty-unit-${lait}`).evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true); // unité jamais tronquée
    await page.getByTestId(`qty-input-${lait}`).tap();
    await page.getByTestId(`qty-input-${lait}`).fill("12");
    await page.getByTestId(`qty-input-${lait}`).press("Enter");
    await expect(page.getByTestId(`qty-input-${lait}`)).toHaveValue("12");
    await page.getByTestId(`qty-input-${lait}`).fill("2,7"); // pas de décimale pour des pièces : arrondi
    await page.getByTestId(`qty-input-${lait}`).press("Enter");
    await expect(page.getByTestId(`qty-input-${lait}`)).toHaveValue("3");
    await expect(card(page, f, "Lait")).toHaveAttribute("data-state", "unsaved");

    // kg : décimales
    const tom = pid(f, "Tomates");
    await card(page, f, "Tomates").click();
    await page.getByTestId(`qty-input-${tom}`).fill("1,25");
    await page.getByTestId(`qty-input-${tom}`).press("Enter");
    await expect(page.getByTestId(`qty-input-${tom}`)).toHaveValue("1,25");
    await expect(page.getByTestId(`qty-unit-${tom}`)).toHaveText("kg");

    // nom très long : la carte garde sa taille, le compteur reste utilisable, rien ne déborde
    await card(page, f, long).click();
    const lp = pid(f, long);
    await page.getByTestId(`plus-${lp}`).click();
    await expect(page.getByTestId(`qty-input-${lp}`)).toHaveValue("2");
    await expect(page.getByTestId(`qty-unit-${lp}`)).toHaveText("pots");
    const overflow = await wrap(page, f, long).evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const lbox = (await wrap(page, f, long).boundingBox())!;
    const neighbours = await page.locator("[data-testid^=wrap-]").evaluateAll((els, top) => els.filter((e) => Math.abs(e.getBoundingClientRect().top + window.scrollY - top) < 2).map((e) => Math.round(e.getBoundingClientRect().height)), lbox.y);
    expect(Math.max(...neighbours) - Math.min(...neighbours)).toBeLessThanOrEqual(1);

    // la validation envoie tout, avec les bonnes unités
    await page.getByTestId("validate").click();
    await expect(page.getByTestId("sync-state")).toHaveText("Liste à jour");
    const items = await activeItems(f);
    expect(items.find((i) => i.name === "Lait")).toMatchObject({ quantity: 3, unit: "piece" });
    expect(items.find((i) => i.name === "Tomates")).toMatchObject({ quantity: 1.25, unit: "kg" });
    expect(items.find((i) => i.name === long)).toMatchObject({ quantity: 2, unit: "pot" });

    // capture : cartes sélectionnées (laitages) dans la grille
    await wrap(page, f, "Lait").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -140));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${CAP}/amelioration-catalogue-cartes.png` });
    await ctx.close();
  });
});

test.describe("2 · haut du catalogue simplifié", () => {
  test("une seule indication d'état en mots simples ; blocs de catégories compacts avec deux photos", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await post(f, "staff", listId, [add(f, "Lait", 2)]);
    const ctx = await browser.newContext(MOBILE);
    const page = await ctx.newPage();
    await uiLogin(page, f);
    const state = page.getByTestId("sync-state");
    await expect(state).toHaveText("Liste à jour");
    await expect(page.getByTestId("count")).toHaveCount(0); // plus de ligne « enregistrés sur le serveur / pas encore enregistrés »
    await expect(page.locator(".stickyhead")).not.toContainText("serveur");
    await card(page, f, "Riz").click();
    await expect(state).toHaveText("1 modification à valider");
    await card(page, f, "Sucre").click();
    await expect(state).toHaveText("2 modifications à valider");
    await expect(state).toHaveAttribute("data-kind", "todo");
    // l'orange est réservé aux modifications en attente
    const color = (el: Element) => getComputedStyle(el).color;
    const todo = await state.evaluate(color);
    await page.getByTestId("validate").click();
    await expect(state).toHaveText("Liste à jour");
    expect(await state.evaluate(color)).not.toBe(todo);
    // hors connexion
    await ctx.setOffline(true);
    await card(page, f, "Beurre").click();
    await page.getByTestId("validate").click();
    await expect(state).toHaveText("En attente de connexion");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${CAP}/amelioration-catalogue-haut.png`, clip: { x: 0, y: 0, width: 390, height: 330 } });
    await ctx.setOffline(false);
    await page.evaluate(() => (window as any).__engine.retryNow());
    await expect(state).toHaveText("Liste à jour");

    // Par catégories : blocs bas, deux photos au plus, titre lisible, nombre de produits sélectionnés
    await page.getByTestId("view-categories").click();
    const blocks = page.locator("[data-testid^=catblock-]");
    expect(await blocks.count()).toBeGreaterThan(8);
    const dims = await blocks.evaluateAll((els) => els.map((e) => {
      const m = e.querySelector(".catblock__mosaic")!.getBoundingClientRect();
      const t = e.querySelector(".catblock__title") as HTMLElement;
      return { imgs: e.querySelectorAll("img").length, fs: parseFloat(getComputedStyle(t).fontSize), titleBelow: t.getBoundingClientRect().top >= m.bottom - 1, titleWhole: t.scrollHeight <= t.clientHeight + 1, side: Math.min(m.width / 2, m.height) };
    }));
    for (const d of dims) {
      expect(d.imgs).toBeLessThanOrEqual(2);
      expect(d.fs).toBeGreaterThanOrEqual(16);
      expect(d.titleBelow).toBe(true); // aucun texte sur les images
      expect(d.titleWhole).toBe(true); // titre jamais coupé
      expect(d.side).toBeGreaterThanOrEqual(60); // illustrations assez grandes pour être reconnues
    }
    await expect(page.getByTestId("catcount-laitages")).toContainText("sélectionné");
    await page.screenshot({ path: `${CAP}/amelioration-par-categories.png` });
    await ctx.close();
  });
});

test.describe("3 · liste des parents : lignes uniformes", () => {
  test("nom, quantité dessous au même endroit, auteur et heure en secondaire, bouton Acheté à droite ; titres de catégories conservés", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    const long = "Fromage de chèvre frais aux herbes de Provence et miel";
    await f.adil.post("/api/products", { data: { name: long, category: "laitages", unit: "pot" } });
    f.products[long] = (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.name === long).id;
    await post(f, "staff", listId, [add(f, "Lait", 2), add(f, "Tomates", 1.5), add(f, "Riz", 1), add(f, long, 12), add(f, "Beurre", 1)]);
    const items = await activeItems(f);
    await post(f, "adil", listId, [{ opId: randomUUID(), type: "purchase", itemId: items.find((i) => i.name === "Beurre").id }]);
    const ctx = await browser.newContext(MOBILE);
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await expect(page.getByTestId("to-buy")).toBeVisible();
    await expect(page.getByTestId("to-buy").locator("h3").first()).toBeVisible(); // titres de catégories
    await expect(page.getByTestId("bought").locator("h3").first()).toBeVisible();
    const geo = await page.locator('[data-testid="to-buy"] li.row').evaluateAll((rows) =>
      rows.map((r) => {
        const rb = r.getBoundingClientRect();
        const name = r.querySelector(".row__main b")!.getBoundingClientRect();
        const q = r.querySelector(".rowqty")!.getBoundingClientRect();
        const meta = r.querySelector("small")!.getBoundingClientRect();
        const buy = r.querySelector("button.btn")!.getBoundingClientRect();
        return { left: Math.round(name.left), qLeft: Math.round(q.left), qBelow: q.top >= name.bottom - 1, metaBelow: meta.top >= q.bottom - 1, buyRight: Math.round(rb.right - buy.right), h: Math.round(rb.height) };
      }),
    );
    expect(geo.length).toBe(4);
    for (const g of geo) {
      expect(g.qLeft).toBe(g.left); // quantité alignée sous le nom
      expect(g.qBelow).toBe(true);
      expect(g.metaBelow).toBe(true);
      expect(g.buyRight).toBeLessThanOrEqual(14); // Acheté à droite
    }
    expect(new Set(geo.map((g) => g.left)).size).toBe(1);
    // quantités avec unité, décimales, nom long coupé proprement
    await expect(page.getByTestId(`qty-${pid(f, "Tomates")}`)).toHaveText("1,5 kg");
    await expect(page.getByTestId(`qty-${pid(f, long)}`)).toHaveText("12 pots");
    await expect(page.getByTestId(`row-${pid(f, "Lait")}`)).toContainText("Ajouté par Marie");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${CAP}/amelioration-liste-parents.png`, fullPage: true });
    await ctx.close();
  });
});

test.describe("4 · unités adaptées", () => {
  test("brique, pot, boîte : singulier/pluriel ; l'ancienne « pièce » n'est jamais convertie ; réglage par produit", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    // une ancienne demande en « pièces », achetée
    await post(f, "staff", listId, [add(f, "Lait", 2)]);
    const old = (await activeItems(f))[0];
    await post(f, "adil", listId, [{ opId: randomUUID(), type: "purchase", itemId: old.id }]);

    const ctx = await browser.newContext(MOBILE);
    const admin = await ctx.newPage();
    await uiLogin(admin, f, "adil", "482913");
    await admin.getByTestId("tab-settings").click();
    await admin.getByTestId("seg-catalog").click();
    await admin.getByTestId("edit-Lait").click();
    const options = await admin.getByTestId("pf-unit").locator("option").allTextContents();
    expect(options).toEqual(["Pièce", "Paquet", "Bouteille", "Brique", "Pot", "Boîte", "Kilogramme (kg)"]);
    await expect(admin.getByTestId("pf-unit-hint")).toContainText("brique");
    await admin.getByTestId("pf-unit").selectOption("brique");
    await admin.screenshot({ path: `${CAP}/amelioration-unites-reglage.png` });
    await admin.getByTestId("pf-save").click();
    await expect(admin.getByTestId("prod-Lait")).toContainText("Unité : brique");

    // nouvelle demande : en briques ; l'achat passé reste en pièces
    await post(f, "staff", listId, [again(f, "Lait", 1)]);
    await admin.getByTestId("tab-current").click();
    await expect(admin.getByTestId(`qty-${pid(f, "Lait")}`)).toHaveText("1 brique");
    await expect(admin.getByTestId("bought")).toContainText("2 pièces");
    const lines = (await activeItems(f)).filter((i) => i.name === "Lait").map((i) => [i.status, i.quantity, i.unit]).sort();
    expect(lines).toEqual([["purchased", 2, "piece"], ["to_buy", 1, "brique"]]);
    // boîte et pot au singulier / pluriel
    for (const [name, unit, q, text] of [["Riz", "boite", 1, "1 boîte"], ["Sucre", "boite", 3, "3 boîtes"], ["Beurre", "pot", 1, "1 pot"], ["Miel", "pot", 4, "4 pots"]] as const) {
      if (!f.products[name]) continue;
      await f.adil.patch(`/api/products/${pid(f, name)}`, { data: { unit } });
      await post(f, "staff", listId, [add(f, name, q)]);
      await expect(admin.getByTestId(`qty-${pid(f, name)}`)).toHaveText(text);
    }
    await ctx.close();
  });
});

test.describe("5 et 6 · statistiques lisibles et fiche d'achats par produit", () => {
  test("périodes, mois choisi directement, filtres, tri, comparaison prudente, fiche produit avec graphique", async ({ browser, playwright, baseURL }) => {
    test.setTimeout(180_000);
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    const long = "Fromage de chèvre frais aux herbes de Provence et miel";
    await f.adil.post("/api/products", { data: { name: long, category: "laitages", unit: "pot" } });
    f.products[long] = (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.name === long).id;
    await f.adil.patch(`/api/products/${pid(f, "Lait")}`, { data: { unit: "brique" } });

    // historique daté : le foyer utilise l'application depuis 4 mois ; achats ce mois-ci et le mois précédent
    const now = new Date();
    const at = (monthOffset: number, day: number, hour = 9) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day, hour)).toISOString();
    await sql("UPDATE lists SET created_at = $2 WHERE family_id = (SELECT family_id FROM lists WHERE id = $1)", [listId, at(-4, 3)]);
    const laitIds = [
      ...(await buyAt(f, listId, "Lait", 2, [at(0, 1, 8), at(0, 1, 11)])),
      ...(await buyAt(f, listId, "Lait", 1, [at(0, 1, 15)], "lamiaa")),
      ...(await buyAt(f, listId, "Lait", 3, [at(-1, 1, 10)])), // même période, mois précédent
      ...(await buyAt(f, listId, "Lait", 6, [at(-2, 20, 10)])), // il y a deux mois
    ];
    expect(laitIds.length).toBe(5);
    await buyAt(f, listId, "Tomates", 1.5, [at(0, 1, 12)]); // rien à la même période avant : pas de « nouveau »
    await buyAt(f, listId, "Riz", 1, [at(-1, 1, 12), at(0, 1, 13)]);
    const [ancien] = await buyAt(f, listId, "Beurre", 1, [at(0, 1, 14)]);
    await sql("UPDATE purchases SET quantity = NULL, unit = NULL WHERE id = $1", [ancien]); // achat d'avant les quantités
    const [fromage] = await buyAt(f, listId, long, 12, [at(0, 1, 9)]);
    expect(fromage).toBeTruthy();
    const [corr] = await buyAt(f, listId, "Sucre", 2, [at(0, 1, 10)]);
    await post(f, "lamiaa", listId, [{ opId: randomUUID(), type: "correct", purchaseId: corr, reason: "mauvais produit" }]);

    const ctx = await browser.newContext(MOBILE);
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await page.getByTestId("tab-stats").click();
    await expect(page.getByTestId("stats-rows")).toBeVisible();

    // période « Ce mois » par défaut ; dates affichées ; aucun filtre actif
    await expect(page.getByTestId("active-filters")).toHaveCount(0);
    await page.getByTestId("stats-filters").click();
    await expect(page.getByTestId("period-current")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("filters-done").click();
    await expect(page.getByTestId("stats-window")).toContainText("du 1");
    await expect(page.getByTestId("stats-window")).toContainText("(mois en cours)");
    // produit : « 3 achats · 5 briques », dernier achat, aucune phrase « nouveau »
    await expect(page.getByTestId("freq-Lait")).toHaveText("3 achats · 5 briques");
    await expect(page.getByTestId("last-Lait")).toContainText("Dernier achat : 1");
    await expect(page.getByText(/nouveau/i)).toHaveCount(0);
    await expect(page.getByTestId("cmp-Lait")).toContainText("Même période avant : 1 achat · 3 briques");
    await expect(page.getByTestId("cmp-Tomates")).toHaveCount(0); // pas de référence : pas de comparaison
    await expect(page.getByTestId("stats-compare-total")).toContainText("Même période avant");
    // ancien achat sans quantité : signalé comme inconnu
    await expect(page.getByTestId("freq-Beurre")).toHaveText("1 achat · quantité non enregistrée");
    // achat corrigé : ne compte pas
    await expect(page.getByTestId("stat-Sucre")).toHaveCount(0);
    // nom long et quantité décimale
    await expect(page.getByTestId("freq-Tomates")).toHaveText("1 achat · 1,5 kg");
    await expect(page.getByTestId(`freq-${long}`)).toHaveText("1 achat · 12 pots");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${CAP}/amelioration-statistiques.png` });

    // tri, recherche, catégorie
    const order = async () => (await page.locator('[data-testid^="stat-"] .row__name b').allTextContents());
    expect((await order())[0]).toBe("Lait"); // le plus souvent acheté
    await page.getByTestId("stats-filters").click();
    await page.getByTestId("stats-sort").selectOption("name");
    await expect.poll(async () => (await order())[0]).toBe("Beurre");
    await page.getByTestId("stats-sort").selectOption("last");
    await expect.poll(async () => (await order()).length).toBeGreaterThan(3);
    await page.getByTestId("filters-done").click();
    await expect(page.getByTestId("active-filters")).toContainText("Tri : dernier achat"); // filtre actif visible
    await page.getByTestId("stats-search").fill("TOMA");
    await expect.poll(order).toEqual(["Tomates"]);
    await page.getByTestId("stats-search").fill("");
    await page.getByTestId("stats-filters").click();
    await page.getByTestId("stats-category").selectOption("laitages");
    await page.getByTestId("filters-done").click();
    await expect.poll(async () => (await order()).includes("Tomates")).toBe(false);
    await expect(page.getByTestId("stat-Lait")).toBeVisible();
    await expect(page.getByTestId("active-filters")).toContainText("Laitages");
    // un seul geste remet tout à zéro
    await page.getByTestId("stats-reset").click();
    await expect(page.getByTestId("active-filters")).toHaveCount(0);
    await expect.poll(async () => (await order())[0]).toBe("Lait");

    // mois précédent, puis trois derniers mois
    await page.getByTestId("stats-filters").click();
    await page.getByTestId("period-previous").click();
    await expect(page.getByTestId("period-previous")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("filters-done").click();
    await expect(page.getByTestId("freq-Lait")).toHaveText("1 achat · 3 briques");
    await expect(page.getByTestId("stats-window")).not.toContainText("(mois en cours)");
    await page.getByTestId("stats-filters").click();
    await page.getByTestId("period-last3").click();
    await page.getByTestId("filters-done").click();
    await expect(page.getByTestId("freq-Lait")).toHaveText("5 achats · 14 briques"); // 5 + 3 + 6 : trois mois, une seule unité
    await page.getByTestId("stats-reset").click();

    // choisir directement un mois et une année
    await page.getByTestId("stats-month").click();
    await expect(page.getByTestId("picker-year")).toHaveText(String(now.getUTCFullYear()));
    await page.screenshot({ path: `${CAP}/amelioration-choix-mois.png` });
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 15));
    const key = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
    if (target.getUTCFullYear() !== now.getUTCFullYear()) await page.getByTestId("picker-prev-year").click();
    await page.getByTestId(`pick-${key}`).click();
    await expect(page.getByTestId("freq-Lait")).toHaveText("1 achat · 6 briques");

    // fiche d'un produit
    await page.getByTestId("stats-reset").click();
    await page.getByTestId("stat-Lait").click();
    const sheet = page.getByTestId("pstats");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("pstats-count")).toContainText("3 achats");
    await expect(page.getByTestId("pstats-units")).toContainText("5 briques");
    await expect(page.getByTestId("pstats-last")).toContainText("Dernier achat");
    const times = await page.getByTestId("pstats-purchase").evaluateAll((els) => els.map((e) => e.querySelector("small")!.textContent));
    expect(times.length).toBe(3);
    expect(times[0]).toContain("Lamiaa"); // le plus récent (15 h) d'abord, acheteur indiqué
    expect(times[2]).toContain("Adil");
    await expect(page.getByTestId("chart-brique")).toBeVisible();
    // 6 mois : avant le début de l'historique = « pas de données », mois couvert sans achat = zéro
    const states = await page.locator('[data-testid^="bar-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
    expect(states).toHaveLength(6);
    expect(states.at(-1)).toBe("value");
    expect(states).toContain("zero");
    await expect(page.getByText("pas des achats réels", { exact: false })).toHaveCount(0);
    await expect(page.getByText("pas une mesure de la consommation réelle")).toBeVisible();
    await sheet.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${CAP}/amelioration-fiche-produit.png` });
    // accès à la liste d'origine (liste en cours)
    await page.getByTestId("pstats-open-list").first().click();
    await expect(page.getByTestId("to-buy")).toBeVisible();

    // achat corrigé : visible dans la fiche, jamais compté
    await page.getByTestId("tab-stats").click();
    await page.getByTestId("stats-search").fill("Sucre");
    await expect(page.getByTestId("stats-empty")).toBeVisible(); // aucun achat confirmé : Sucre n'est pas une ligne
    await page.getByTestId("stats-search").fill("");
    await ctx.close();

    // liste clôturée : « Voir la liste du … » ouvre l'archive
    expect((await f.lamiaa.post(`/api/lists/${listId}/close`)).status()).toBe(200);
    const ctx2 = await browser.newContext(MOBILE);
    const p2 = await ctx2.newPage();
    await uiLogin(p2, f, "lamiaa", "573918");
    await p2.getByTestId("tab-stats").click();
    await p2.getByTestId("stat-Tomates").click();
    await expect(p2.getByTestId("pstats-open-list").first()).toContainText("Voir la liste du");
    await p2.getByTestId("pstats-open-list").first().click();
    await expect(p2.getByTestId("archive")).toBeVisible();
    await ctx2.close();
  });

  test("fiche produit : historique incomplet (quantités inconnues), achat corrigé absent de l'historique sans double comptage", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    const now = new Date();
    const at = (monthOffset: number, day: number, hour = 9) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day, hour)).toISOString();
    await sql("UPDATE lists SET created_at = $2 WHERE id = $1", [listId, at(-1, 2)]);
    const [a] = await buyAt(f, listId, "Tomates", 2, [at(0, 1, 9)]);
    await sql("UPDATE purchases SET quantity = NULL, unit = NULL WHERE id = $1", [a]);
    const [b] = await buyAt(f, listId, "Tomates", 3, [at(0, 1, 10)]);
    await post(f, "lamiaa", listId, [{ opId: randomUUID(), type: "correct", purchaseId: b, reason: "erreur" }]);
    await buyAt(f, listId, "Tomates", 3, [at(0, 1, 11)]); // la correction a remis la ligne à acheter (3 kg) : on la rachète
    const ctx = await browser.newContext(MOBILE);
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await page.getByTestId("tab-stats").click();
    await expect(page.getByTestId("freq-Tomates")).toHaveText("2 achats · 3 kg + 1 achat sans quantité");
    await page.getByTestId("stat-Tomates").click();
    await expect(page.getByTestId("pstats-count")).toContainText("2 achats");
    await expect(page.getByTestId("pstats-history")).toContainText("Quantité non enregistrée");
    // l'achat annulé par « Corriger » n'apparaît pas : ni ligne barrée, ni mention de correction
    await expect(page.getByTestId("pstats-history")).not.toContainText("corrigé");
    await expect(page.getByTestId("pstats-history")).not.toContainText("erreur");
    await expect(page.getByTestId("pstats-history")).not.toContainText("Lamiaa");
    expect(await page.getByTestId("pstats-purchase").count()).toBe(2); // exactement les 2 achats comptés
    await expect(page.getByTestId("chart-kg")).toBeVisible();
    await expect(page.getByTestId("chart-kg").locator("text.chart__val")).toHaveText(["3"]); // l'achat corrigé (3 kg) n'est pas ajouté au rachat (3 kg) : 3, pas 6
    await ctx.close();
  });
});

test.describe("fuseau Africa/Casablanca : l'heure affichée ne dépend pas du fuseau du téléphone", () => {
  test("même heure affichée avec quatre fuseaux de téléphone ; le diagnostic signale un fuseau différent", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    const pressed = new Date(Date.now() - 5 * 60_000);
    await post(f, "staff", listId, [add(f, "Lait", 1)], { id: randomUUID(), at: pressed.toISOString() });
    const expected = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", hour: "2-digit", minute: "2-digit" }).format(pressed);
    const shown: Record<string, string> = {};
    for (const tz of ["Africa/Casablanca", "Europe/Paris", "America/New_York", "Asia/Tokyo"]) {
      const ctx = await browser.newContext({ ...MOBILE, timezoneId: tz });
      const page = await ctx.newPage();
      await uiLogin(page, f, "lamiaa", "573918");
      const added = await page.getByTestId(`added-${pid(f, "Lait")}`).textContent();
      shown[tz] = added!.match(/\d{2}:\d{2}/)![0];
      await page.getByTestId("avatar").click();
      await expect(page.getByTestId("clock-zone")).toContainText("Africa/Casablanca");
      await expect(page.getByTestId("clock-zone")).toContainText(tz);
      if (tz === "Africa/Casablanca") await expect(page.getByTestId("clock-zone-diff")).toHaveCount(0);
      else await expect(page.getByTestId("clock-zone-diff")).toBeVisible();
      if (tz === "Europe/Paris") await page.screenshot({ path: `${CAP}/amelioration-fuseau-diagnostic.png` });
      await ctx.close();
    }
    for (const tz of Object.keys(shown)) expect(shown[tz]).toBe(expected);
  });
});
