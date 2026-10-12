import { randomUUID } from "node:crypto";
import pg from "pg";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { createList, newFamily, uiLogin, type Family } from "./helpers";

const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const OUT = "../docs/captures/prix-favoris";
const { defaultBrowserType: _d, ...IPHONE } = devices["iPhone 14"];

async function sql<T = any>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}
/** Base initiale de test (clé stable du produit) : ne remplace jamais un prix de famille. */
async function setBase(productId: string, amount: string, refUnit = "kg", refQty = "1", packaging: string | null = null) {
  const [{ catalog_key: key }] = await sql("SELECT catalog_key FROM products WHERE id = $1", [productId]);
  await sql(
    `INSERT INTO base_prices (origin, key, amount, ref_qty, ref_unit, packaging, kind, source, observed_on) VALUES ('initial',$1,$2,$3,$4,$5,'observed','capture de test','2026-10-01')
     ON CONFLICT (origin, key) DO UPDATE SET amount = $2, ref_qty = $3, ref_unit = $4, packaging = $5`,
    [key, amount, refQty, refUnit, packaging],
  );
  await sql("UPDATE families SET catalog_rev = catalog_rev + 1");
}
const add = (f: Family, name: string, quantity?: number) => ({ opId: randomUUID(), type: "add", productId: f.products[name]!, ...(quantity ? { quantity } : {}) });
async function post(who: Family["adil"], listId: string, ops: object[]) {
  const r = await who.post(`/api/lists/${listId}/ops`, { data: { ops } });
  expect(r.status()).toBe(200);
  return (await r.json()).list;
}
const catalog = async (f: Family) => {
  const c = await (await f.adil.get("/api/catalog?includeInactive=1")).json();
  return Object.fromEntries(c.categories.flatMap((x: any) => x.products).map((p: any) => [p.name, p]));
};
test.beforeEach(async () => {
  await sql("DELETE FROM base_prices"); // ces scénarios posent leurs propres prix de base ; la base réelle est contrôlée dans prix-base-initiale.spec.ts
});
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function openList(page: Page) {
  await page.getByTestId("tab-current").click();
}

test.describe("personnel : catalogue permanent", () => {
  test("tous les produits actifs dès la connexion, sans liste ; rien de sélectionné ; la sélection d'un administrateur apparaît ; sélectionné ≠ acheté ; aucun droit de validation ajouté", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await uiLogin(page, f); // personnel, sans aucune liste en cours
    await expect(page.getByTestId("catalog")).toBeVisible();
    await expect(page.getByTestId("no-list")).toContainText("Aucune liste en cours");
    const cards = page.locator("[data-testid^='card-']");
    expect(await cards.count()).toBeGreaterThan(30); // tous les produits actifs de sa famille
    expect(await page.locator("[data-testid^='card-'][data-state='off']").count()).toBe(await cards.count()); // aucun produit sélectionné
    await expect(page.getByTestId("validate")).toHaveCount(0); // pas de barre de validation sans liste
    const tomates = page.getByTestId(`card-${f.products["Tomates"]}`);
    await tomates.click({ force: true });
    await expect(tomates).toHaveAttribute("data-state", "off"); // lecture seule : rien ne se sélectionne
    await page.screenshot({ path: `${OUT}/personnel-sans-liste.png` });

    // un administrateur ouvre une liste et sélectionne Tomates ×2 : la sélection et la quantité arrivent sur le téléphone du personnel
    const listId = await createList(f);
    await post(f.adil, listId, [add(f, "Tomates", 2), add(f, "Oignons", 1)]);
    await expect(tomates).toHaveAttribute("data-state", "saved", { timeout: 15_000 });
    await expect(tomates).toHaveAttribute("aria-label", /sélectionné pour acheter/);
    await expect(page.getByTestId(`qty-input-${f.products["Tomates"]}`)).toHaveValue("2");
    await expect(page.getByTestId(`tag-${f.products["Tomates"]}`)).toHaveText("✓ À acheter");
    await expect(page.getByTestId("no-list")).toHaveCount(0);
    // acheté : un état clairement différent, verrouillé
    const items = (await (await f.adil.get("/api/lists/active")).json()).list.items;
    await post(f.adil, listId, [{ opId: randomUUID(), type: "purchase", itemId: items.find((i: any) => i.productId === f.products["Tomates"]).id }]);
    await expect(tomates).toHaveAttribute("data-state", "bought", { timeout: 15_000 });
    await expect(tomates).toHaveAttribute("aria-label", /acheté, verrouillé/);
    await expect(tomates).not.toHaveAttribute("aria-label", /sélectionné pour acheter/);
    await expect(page.getByTestId(`wrap-${f.products["Tomates"]}`)).toContainText("Acheté");
    await page.screenshot({ path: `${OUT}/personnel-selectionne-achete.png` });
    // droits inchangés : le personnel ne peut ni acheter, ni créer, ni clôturer
    const row = items.find((i: any) => i.productId === f.products["Oignons"]);
    expect((await f.staff.post(`/api/lists/${listId}/ops`, { data: { ops: [{ opId: randomUUID(), type: "purchase", itemId: row.id }] } })).status()).toBe(403);
    expect((await f.staff.post("/api/lists")).status()).toBe(403);
    expect((await f.staff.post(`/api/lists/${listId}/close`)).status()).toBe(403);
    await expect(page.getByTestId("close-list")).toHaveCount(0);
  });

  test("le catalogue d'une autre famille ne s'affiche jamais ; produit désactivé absent du catalogue sans liste", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const g = await newFamily(playwright, baseURL!);
    await g.adil.post("/api/products", { data: { name: "Produit secret de G", category: "epicerie" } });
    await f.adil.patch(`/api/products/${f.products["Lait"]}`, { data: { active: false } });
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    await expect(page.getByText("Produit secret de G")).toHaveCount(0);
    await expect(page.getByTestId(`card-${f.products["Lait"]}`)).toHaveCount(0);
    await expect(page.getByTestId(`card-${f.products["Tomates"]}`)).toBeVisible();
  });
});

test.describe("favoris", () => {
  test("administrateur : créer, nommer, modifier, supprimer ; parent : utiliser ; la commande modifiée ne change jamais le favori", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const ctxA = await browser.newContext({ baseURL });
    const admin = await ctxA.newPage();
    await uiLogin(admin, f, "adil", "482913");
    await openList(admin);
    await admin.getByTestId("open-favorites").click();
    await expect(admin.getByTestId("favorites-empty")).toBeVisible();
    await admin.getByTestId("favorite-new").click();
    await admin.getByTestId("favorite-name").fill("Semaine");
    for (const n of ["Tomates", "Oignons"]) {
      await admin.getByTestId("favorite-search").fill(n);
      await admin.getByTestId(`favorite-pick-${f.products[n]}`).click();
    }
    await admin.getByTestId(`plus-${f.products["Tomates"]}`).click(); // 1 → 1,5 kg
    await admin.screenshot({ path: `${OUT}/favori-editeur.png` });
    await admin.getByTestId("favorite-save").click();
    await expect(admin.getByTestId("favorite-Semaine")).toContainText("2 produits");
    // renommer et modifier
    await admin.getByTestId("edit-favorite-Semaine").click();
    await admin.getByTestId("favorite-name").fill("Semaine type");
    await admin.getByTestId("favorite-save").click();
    await expect(admin.getByTestId("favorite-Semaine type")).toBeVisible();
    const t = (await (await f.adil.get("/api/templates")).json()).templates[0];
    expect(t.items.map((i: any) => [i.name, i.quantity]).sort()).toEqual([["Oignons", 1], ["Tomates", 1.5]]);

    // parent, sans liste : « Utiliser cette liste » prépare une liste modifiable (rien n'est enregistré avant « Valider »)
    const ctxP = await browser.newContext({ baseURL });
    const parent = await ctxP.newPage();
    await uiLogin(parent, f, "lamiaa", "573918");
    await parent.getByTestId("open-favorites").click();
    await expect(parent.getByTestId("edit-favorite-Semaine type")).toHaveCount(0); // seul un administrateur modifie
    await parent.getByTestId("use-Semaine type").click();
    await expect(parent.getByTestId(`card-${f.products["Tomates"]}`)).toHaveAttribute("data-state", "unsaved");
    await expect(parent.getByTestId(`qty-input-${f.products["Tomates"]}`)).toHaveValue("1,5");
    expect(((await (await f.adil.get("/api/lists/active")).json()).list.items as any[]).length).toBe(0); // pas encore validé
    // le parent modifie la commande avant validation : le favori ne change pas
    await parent.getByTestId(`plus-${f.products["Tomates"]}`).click();
    await parent.getByTestId("validate").click();
    await expect.poll(async () => ((await (await f.adil.get("/api/lists/active")).json()).list.items as any[]).map((i) => [i.name, i.quantity]).sort().join()).toBe("Oignons,1,Tomates,2");
    const after = (await (await f.adil.get("/api/templates")).json()).templates[0];
    expect(after.items.map((i: any) => [i.name, i.quantity]).sort()).toEqual([["Oignons", 1], ["Tomates", 1.5]]);

    // supprimer
    await admin.reload();
    await openList(admin);
    await admin.getByTestId("open-favorites").click();
    await admin.getByTestId("delete-favorite-Semaine type").click();
    await admin.getByTestId("favorite-delete-confirm").click();
    await expect(admin.getByTestId("favorites-empty")).toBeVisible();
    await ctxA.close();
    await ctxP.close();
  });

  test("liste déjà en cours : ajouter (sans doublon, quantités additionnées si unité compatible) ou remplacer (avec confirmation) ; produit désactivé signalé, jamais réactivé", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    await post(f.adil, listId, [add(f, "Tomates", 1), add(f, "Carottes", 2)]);
    const made = await f.adil.post("/api/templates", { data: { name: "Fête", items: [{ productId: f.products["Tomates"], quantity: 0.5 }, { productId: f.products["Oignons"], quantity: 3 }, { productId: f.products["Pommes"], quantity: 1 }] } });
    expect(made.status()).toBe(201);
    await f.adil.patch(`/api/products/${f.products["Pommes"]}`, { data: { active: false } });
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await page.getByTestId("open-favorites").click();
    await page.getByTestId("use-Fête").click();
    await expect(page.getByTestId("basket-choice")).toContainText("Une liste est déjà en cours");
    await page.screenshot({ path: `${OUT}/favori-liste-en-cours.png` });
    await page.getByTestId("basket-add").click();
    // ajoutés sans doublon : Tomates 1 + 0,5 = 1,5 ; Oignons 3 ; Carottes inchangées ; Pommes désactivées non réactivées
    await expect(page.getByTestId(`qty-input-${f.products["Tomates"]}`)).toHaveValue("1,5");
    await expect(page.getByTestId(`qty-input-${f.products["Oignons"]}`)).toHaveValue("3");
    await expect(page.getByTestId(`qty-input-${f.products["Carottes"]}`)).toHaveValue("2");
    await expect(page.getByTestId("banners")).toContainText("désactivés (non réactivés) : Pommes").catch(async () => expect(page.locator("body")).toContainText("désactivés (non réactivés) : Pommes"));
    expect((await catalog(f))["Pommes"].active).toBe(false);
    await page.getByTestId("validate").click();
    await expect.poll(async () => ((await (await f.adil.get("/api/lists/active")).json()).list.items as any[]).length).toBe(3);

    // remplacer : confirmation obligatoire, Carottes retirées, le reste remplacé
    await page.getByTestId("back").first().click().catch(() => void 0);
    await page.goto("/");
    await page.getByTestId("open-favorites").click();
    await page.getByTestId("use-Fête").click();
    await page.getByTestId("basket-replace").click();
    await expect(page.getByTestId("basket-confirm")).toContainText("Remplacer le contenu de la liste actuelle ?");
    await page.getByTestId("basket-replace-confirm").click();
    await expect(page.getByTestId(`card-${f.products["Carottes"]}`)).toHaveAttribute("data-state", "removing");
    await expect(page.getByTestId(`qty-input-${f.products["Tomates"]}`)).toHaveValue("0,5");
    // rien n'a changé côté serveur avant « Valider » ; le favori reste identique
    const before = ((await (await f.adil.get("/api/lists/active")).json()).list.items as any[]).map((i) => [i.name, i.quantity]).sort().join();
    expect(before).toBe("Carottes,2,Oignons,3,Tomates,1.5");
    await page.getByTestId("validate").click();
    await expect.poll(async () => ((await (await f.adil.get("/api/lists/active")).json()).list.items as any[]).map((i) => [i.name, i.quantity]).sort().join()).toBe("Oignons,3,Tomates,0.5");
    const t = (await (await f.adil.get("/api/templates")).json()).templates[0];
    expect(t.items.map((i: any) => [i.name, i.quantity]).sort()).toEqual([["Oignons", 3], ["Pommes", 1], ["Tomates", 0.5]]);
    await ctx.close();
  });

  test("Recommander : reprend produits et quantités d'une ancienne commande, achats réinitialisés, ancienne commande intacte, prix actuels", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await setBase(f.products["Tomates"]!, "9.90");
    const listId = await createList(f);
    const l1 = await post(f.adil, listId, [add(f, "Tomates", 0.25), add(f, "Oignons", 2)]);
    await post(f.adil, listId, [{ opId: randomUUID(), type: "purchase", itemId: l1.items.find((i: any) => i.name === "Tomates").id }]);
    expect((await f.adil.post(`/api/lists/${listId}/close`)).status()).toBe(200);
    await f.adil.put(`/api/products/${f.products["Tomates"]}/price`, { data: { amount: "12", refQty: 1, refUnit: "kg" } }); // le prix change après la commande
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await page.getByTestId("tab-history").click();
    await page.getByTestId("history-entry").first().click();
    await page.getByTestId("reorder").click();
    // nouvelle liste modifiable : tout est « à valider », rien d'acheté
    await expect(page.getByTestId(`card-${f.products["Tomates"]}`)).toHaveAttribute("data-state", "unsaved");
    await expect(page.getByTestId(`qty-input-${f.products["Tomates"]}`)).toHaveValue("0,25");
    await expect(page.getByTestId(`qty-input-${f.products["Oignons"]}`)).toHaveValue("2");
    await page.getByTestId("validate").click();
    await expect.poll(async () => ((await (await f.adil.get("/api/lists/active")).json()).list?.items as any[] | undefined)?.length).toBe(2);
    const fresh = (await (await f.adil.get("/api/lists/active")).json()).list;
    expect(fresh.items.every((i: any) => i.status === "to_buy")).toBe(true); // états d'achat réinitialisés
    expect(fresh.items.find((i: any) => i.name === "Tomates").price).toMatchObject({ amount: "12.00", source: "family" }); // prix actuels
    // l'ancienne commande n'a pas changé : achat et prix d'alors
    const old = (await (await f.adil.get(`/api/lists/${listId}`)).json()).list;
    expect(old.items.find((i: any) => i.name === "Tomates")).toMatchObject({ status: "purchased", price: { amount: "9.90", source: "base" } });
    expect(old.items.find((i: any) => i.name === "Oignons")).toMatchObject({ status: "to_buy", quantity: 2 });
    await ctx.close();
  });
});

async function setPrefs(page: Page, prices: boolean, totals: boolean) {
  await page.getByTestId("avatar").click();
  const p = page.getByTestId("pref-prices");
  const t = page.getByTestId("pref-totals");
  if (totals) await t.check();
  else {
    if (await t.isChecked()) await t.uncheck();
    if (prices) await p.check();
    else if (await p.isChecked()) await p.uncheck();
  }
  await page.getByRole("button", { name: "Fermer" }).click();
}
const text = (page: Page) => page.locator("body").innerText();

test.describe("affichage des prix : trois modes par profil", () => {
  test("simple par défaut, identique à la vue actuelle ; prix indicatifs ; prix et total (0,25 kg × 9,90 DH/kg = 2,48 DH) ; incompatibilités, prix absents ; deux profils, deux modes ; quantités jamais modifiées", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await setBase(f.products["Tomates"]!, "9.90");
    // Carottes : prix « par paquet » alors que la quantité est en kg → incompatible, jamais calculé ; Lait : aucun prix
    await f.adil.put(`/api/products/${f.products["Carottes"]}/price`, { data: { amount: "2", refQty: 1, refUnit: "paquet", packaging: "500 g" } });
    const listId = await createList(f);
    await post(f.adil, listId, [add(f, "Tomates", 0.25), add(f, "Carottes", 1), add(f, "Lait", 1)]);

    const ctxA = await browser.newContext({ ...devices["Pixel 7"], baseURL });
    const ctxL = await browser.newContext({ ...devices["Pixel 7"], baseURL });
    const adil = await ctxA.newPage();
    const lam = await ctxL.newPage();
    await uiLogin(adil, f, "adil", "482913");
    await uiLogin(lam, f, "lamiaa", "573918");
    const tomRow = (p: Page) => p.getByTestId(`row-${f.products["Tomates"]}`);
    // mode simple (défaut) : aucune trace de prix, quantités actuelles
    for (const p of [adil, lam]) {
      await expect(tomRow(p)).toBeVisible();
      await expect(tomRow(p)).toContainText("0,25 kg");
      expect(await text(p)).not.toMatch(/DH|Prix|Total estimé|Estimation/);
      await expect(p.getByTestId("estimate")).toHaveCount(0);
    }
    await lam.screenshot({ path: `${OUT}/mode-simple.png` });

    // prix indicatifs : seulement le prix et son unité, aucun montant ni total
    await setPrefs(lam, true, false);
    await expect(lam.getByTestId(`price-${f.products["Tomates"]}`)).toHaveText("9,90 DH / kg");
    await expect(lam.getByTestId(`price-${f.products["Carottes"]}`)).toContainText("Prix à compléter"); // paquet ≠ kg
    expect(await text(lam)).not.toContain("2,48");
    await expect(lam.getByTestId("estimate")).toHaveCount(0);
    await lam.screenshot({ path: `${OUT}/mode-prix.png` });

    // prix et total : quantité, prix unitaire, montant par article, total estimé ; l'incomplet est dit
    await setPrefs(lam, true, true);
    await expect(lam.getByTestId(`price-${f.products["Tomates"]}`)).toContainText("0,25 kg × 9,90 DH / kg = 2,48 DH");
    await expect(lam.getByTestId(`price-${f.products["Carottes"]}`)).toContainText("Prix à compléter");
    await expect(lam.getByTestId(`price-${f.products["Lait"]}`)).toContainText("Prix à compléter"); // absent : jamais zéro
    await expect(lam.getByTestId("estimate-amount")).toHaveText("2,48 DH");
    await expect(lam.getByTestId("estimate")).toContainText("Sous-total connu");
    await expect(lam.getByTestId("estimate-incomplete")).toHaveText("Estimation incomplète — 2 articles sans prix");
    await expect(lam.getByTestId("estimate")).toContainText("pas une dépense réellement payée");
    await lam.screenshot({ path: `${OUT}/mode-total.png` });
    // l'autre profil reste en vue simple, sur la même liste
    expect(await text(adil)).not.toMatch(/DH|Prix à compléter|Estimation/);
    await expect(tomRow(adil)).toContainText("0,25 kg");
    // les préférences sont propres au profil et suivent ses appareils : rechargement = même choix
    await lam.reload();
    await expect(lam.getByTestId("estimate-amount")).toHaveText("2,48 DH");
    await adil.reload();
    await expect(tomRow(adil)).toBeVisible();
    expect(await text(adil)).not.toContain("DH");

    // pas de quart de kilo en vue simple, quart de kilo en « prix et total » ; les quantités existantes ne sont jamais arrondies
    await lam.getByTestId("edit-list").click();
    const qty = (p: Page) => p.getByTestId(`qty-input-${f.products["Tomates"]}`);
    await expect(qty(lam)).toHaveValue("0,25");
    await lam.getByTestId(`plus-${f.products["Tomates"]}`).click();
    await expect(qty(lam)).toHaveValue("0,5");
    await lam.getByTestId(`plus-${f.products["Tomates"]}`).click();
    await expect(qty(lam)).toHaveValue("0,75"); // pas de 0,25 kg en mode total
    await expect(lam.getByTestId("estimate-amount")).toHaveText(/DH/);
    await lam.getByTestId(`minus-${f.products["Tomates"]}`).click();
    await lam.getByTestId(`minus-${f.products["Tomates"]}`).click();
    await expect(qty(lam)).toHaveValue("0,25");
    await lam.getByRole("button", { name: /Retour/ }).click().catch(() => void 0);
    // retour en vue simple : la quantité décimale reste (pour tous les profils)
    await lam.goto("/");
    await setPrefs(lam, false, false);
    await expect(tomRow(lam)).toContainText("0,25 kg");
    expect(await text(lam)).not.toContain("DH");
    const items = (await (await f.adil.get("/api/lists/active")).json()).list.items;
    expect(items.find((i: any) => i.name === "Tomates").quantity).toBe(0.25);
    await lam.getByTestId("edit-list").click();
    await lam.getByTestId(`plus-${f.products["Tomates"]}`).click();
    await expect(qty(lam)).toHaveValue("0,75"); // vue simple : pas de 0,5 kg ajouté d'un quart de kilo (0,25 + 0,5)
    await ctxA.close();
    await ctxL.close();
  });

  for (const w of [360, 390]) {
    test(`mise en page à ${w} px : prix, total, favoris et fenêtres sans débordement`, async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await setBase(f.products["Tomates"]!, "9.90");
      const listId = await createList(f);
      await post(f.adil, listId, [add(f, "Tomates", 1.25), add(f, "Carottes", 1), add(f, "Lait", 1), add(f, "Oignons", 2)]);
      await f.adil.post("/api/templates", { data: { name: "Un favori au nom volontairement assez long pour la largeur", items: [{ productId: f.products["Tomates"], quantity: 1 }] } });
      const ctx = await browser.newContext({ viewport: { width: w, height: 780 }, hasTouch: true, baseURL });
      const page = await ctx.newPage();
      await uiLogin(page, f, "adil", "482913");
      await setPrefs(page, true, true);
      await expect(page.getByTestId("estimate")).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/liste-total-${w}.png`, fullPage: true });
      await page.getByTestId("edit-list").click();
      await expect(page.getByTestId(`price-${f.products["Tomates"]}`)).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/preparer-total-${w}.png` });
      await page.goto("/");
      await page.getByTestId("open-favorites").click();
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/favoris-${w}.png` });
      for (const b of await page.locator(".sheet button").all()) if (await b.isVisible()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(43);
      await ctx.close();
    });
  }

  test("les préférences suivent le profil sur ses autres appareils, sans toucher aux autres profils", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await setBase(f.products["Tomates"]!, "9.90");
    const listId = await createList(f);
    await post(f.adil, listId, [add(f, "Tomates", 1)]);
    const mk = async (login: string, secret: string) => {
      const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL });
      const page = await ctx.newPage();
      await uiLogin(page, f, login, secret);
      await expect(page.getByTestId(`row-${f.products["Tomates"]}`)).toBeVisible();
      return { ctx, page };
    };
    const phoneA = await mk("lamiaa", "573918");
    const phoneB = await mk("lamiaa", "573918"); // même profil, autre téléphone
    const other = await mk("adil", "482913");
    await setPrefs(phoneA.page, true, false);
    await expect(phoneB.page.getByTestId(`price-${f.products["Tomates"]}`)).toHaveText("9,90 DH / kg", { timeout: 20_000 }); // sans rechargement
    await expect(other.page.getByTestId(`price-${f.products["Tomates"]}`)).toHaveCount(0);
    for (const x of [phoneA, phoneB, other]) await x.ctx.close();
  });

  test("le personnel est aussi en trois modes ; un autre profil garde le sien", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await setBase(f.products["Tomates"]!, "9.90");
    const listId = await createList(f);
    await post(f.adil, listId, [add(f, "Tomates", 0.25)]);
    const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL });
    const staff = await ctx.newPage();
    await uiLogin(staff, f);
    const price = staff.getByTestId(`price-${f.products["Tomates"]}`);
    await expect(price).toHaveCount(0);
    await setPrefs(staff, true, true);
    await expect(price).toContainText("0,25 kg × 9,90 DH / kg = 2,48 DH");
    await expect(staff.getByTestId("estimate-amount")).toHaveText("2,48 DH");
    await staff.screenshot({ path: `${OUT}/personnel-total.png` });
    await ctx.close();
  });
});

test.describe("prix de la famille, base initiale, synchronisation", () => {
  test("un prix personnalisé n'est jamais écrasé par la base ; les commandes archivées gardent leur prix ; réévaluation explicite", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const id = f.products["Tomates"]!;
    await setBase(id, "9.90");
    const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL });
    const page = await ctx.newPage();
    await uiLogin(page, f, "adil", "482913");
    await page.getByTestId("tab-settings").click();
    await page.getByTestId("seg-catalog").click();
    await page.getByTestId(`edit-Tomates`).click();
    await expect(page.getByTestId("price-current")).toContainText("9,90 DH / kg");
    await expect(page.getByTestId("price-current")).toContainText("Prix initial");
    await page.getByTestId("price-amount").fill("11,5");
    await page.getByTestId("price-save").click();
    await expect(page.getByTestId("price-msg")).toContainText("Prix enregistré pour votre famille");
    await expect(page.getByTestId("price-current")).toContainText("11,50 DH / kg");
    await expect(page.getByTestId("price-current")).toContainText("Prix de votre famille");
    await page.screenshot({ path: `${OUT}/prix-produit.png` });
    // la base initiale est réimportée avec un autre prix : celui de la famille reste
    await setBase(id, "8.00");
    const eff = async () => (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.id === id).price;
    expect(await eff()).toMatchObject({ amount: "11.50", source: "family" });
    // commande validée avec ce prix, clôturée, puis prix modifié : la commande archivée garde 11,50
    const listId = await createList(f);
    await post(f.adil, listId, [add(f, "Tomates", 1)]);
    await f.adil.post(`/api/lists/${listId}/close`);
    await f.adil.put(`/api/products/${id}/price`, { data: { amount: "20", refQty: 1, refUnit: "kg" } });
    expect(((await (await f.adil.get(`/api/lists/${listId}`)).json()).list.items[0]).price.amount).toBe("11.50");
    // « Rétablir le prix initial » → la base (8,00) ; l'archive ne bouge pas
    await page.reload();
    await page.getByTestId("tab-settings").click();
    await page.getByTestId("seg-catalog").click();
    await page.getByTestId("edit-Tomates").click();
    await page.getByTestId("price-reset").click();
    await expect(page.getByTestId("price-current")).toContainText("8,00 DH / kg");
    expect(((await (await f.adil.get(`/api/lists/${listId}`)).json()).list.items[0]).price.amount).toBe("11.50");
    await ctx.close();
  });

  test("« Partager ce prix » puis « Synchroniser les prix » : propositions compatibles, choix de l'administrateur, signalement ; rien d'automatique", async ({ browser, playwright, baseURL }) => {
    await sql("DELETE FROM price_contributions");
    const viewer = await newFamily(playwright, baseURL!);
    const vid = viewer.products["Pommes"]!;
    await viewer.adil.put(`/api/products/${vid}/price`, { data: { amount: "7", refQty: 1, refUnit: "kg" } });
    for (const amount of ["10", "12", "11"]) {
      const g = await newFamily(playwright, baseURL!);
      await g.adil.put(`/api/products/${g.products["Pommes"]}/price`, { data: { amount, refQty: 1, refUnit: "kg" } });
      expect((await g.adil.post("/api/prices/share", { data: { productId: g.products["Pommes"] } })).status()).toBe(201);
    }
    const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL });
    const page = await ctx.newPage();
    await uiLogin(page, viewer, "adil", "482913");
    // « Partager ce prix » depuis la fiche du produit : unité, conditionnement, date ; ville et magasin facultatifs ; aucune identité
    await page.getByTestId("tab-settings").click();
    await page.getByTestId("seg-catalog").click();
    await page.getByTestId("edit-Pommes").click();
    await page.getByTestId("price-share").click();
    await expect(page.getByTestId("share-summary")).toContainText("7,00 DH / kg");
    await expect(page.getByRole("dialog", { name: "Partager ce prix" })).toContainText("Jamais : votre nom, votre e-mail, le code famille ni votre historique de courses");
    await page.getByTestId("share-city").fill("Casablanca");
    await page.getByTestId("share-confirm").click();
    await expect(page.getByTestId("price-msg")).toContainText("ce prix est partagé");
    const row = (await sql("SELECT * FROM price_contributions WHERE city = 'Casablanca'"))[0];
    expect(JSON.stringify(row)).not.toMatch(new RegExp(`${viewer.code}|Adil|${viewer.email}`));
    await page.getByRole("button", { name: "Fermer" }).first().click().catch(() => void 0);
    await page.goto("/");
    await page.getByTestId("tab-settings").click();
    await page.getByTestId("seg-prices").click();
    const prop = page.getByTestId(`proposal-${vid}`);
    await expect(prop).toContainText("Actuel : 7,00 DH / kg (prix de votre famille)");
    await expect(prop).toContainText("Proposé : 11,00 DH / kg");
    await expect(prop).toContainText("3 familles");
    await page.screenshot({ path: `${OUT}/synchroniser-prix.png` });
    expect((await (await viewer.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.id === vid).price.amount).toBe("7.00"); // rien d'automatique
    await page.getByTestId(`apply-${vid}`).click(); // remplace un prix de la famille : confirmation
    await expect(page.getByTestId("sync-confirm")).toContainText("Les commandes déjà validées gardent leur prix");
    await page.getByTestId("sync-confirm-apply").click();
    await expect(page.getByTestId("sync-msg")).toContainText("Prix appliqué");
    expect((await (await viewer.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.id === vid).price).toMatchObject({ amount: "11.00", source: "community" });
    await ctx.close();
  });
});

test.describe("hors connexion", () => {
  test("choix du personnel validés hors connexion : envoyés une seule fois au retour du réseau, sans perte ni doublon", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL });
    const page = await ctx.newPage();
    await uiLogin(page, f);
    await expect(page.getByTestId(`card-${f.products["Tomates"]}`)).toHaveAttribute("data-state", "off");
    await ctx.setOffline(true);
    await page.getByTestId(`card-${f.products["Tomates"]}`).click();
    await page.getByTestId(`card-${f.products["Oignons"]}`).click();
    await page.getByTestId("validate").click();
    await expect(page.getByTestId("sync-state")).toHaveAttribute("data-kind", /waiting|offline/);
    await ctx.setOffline(false);
    await expect.poll(async () => ((await (await f.adil.get("/api/lists/active")).json()).list.items as any[]).map((i) => i.name).sort().join(), { timeout: 30_000 }).toBe("Oignons,Tomates");
    await page.waitForTimeout(1500);
    expect(((await (await f.adil.get("/api/lists/active")).json()).list.items as any[]).length).toBe(2); // aucun doublon
    void listId;
    await ctx.close();
  });
});
