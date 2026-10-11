import { expect, test } from "@playwright/test";
import pg from "pg";
import { newFamily, uiLogin } from "./helpers";

const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
async function sql(q: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows as any[]; } finally { await c.end(); }
}
const PNG = "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAIklEQVR4nGNcZWTEQA3ARBVTRg0aNWjUoFGDRg0aNYgiAADhrQE+TAV1OwAAAABJRU5ErkJggg==";

/*
 * Parcours « Tous les produits » : ouverture sans recherche, catégories, chargement progressif (> 20 résultats),
 * recherche commune, ajout / réactivation sans doublon, droits inchangés. Captures dans docs/captures/catalogue/.
 */
const OUT = "../docs/captures/catalogue";
const WIDTHS = [360, 390, 412];

async function openAll(page: any, f: any) {
  await uiLogin(page, f, "adil", "482913");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("seg-catalog").click();
  await page.getByTestId("cat-view-all").click();
}
/** Loads further pages (« Voir plus ») until the named product is on screen. */
async function reveal(page: any, name: string) {
  for (let i = 0; i < 20 && !(await page.getByTestId(`all-${name}`).count()); i++) {
    if (!(await page.getByTestId("all-more").count())) break;
    await page.getByTestId("all-more").click();
    await page.waitForTimeout(200);
  }
  await expect(page.getByTestId(`all-${name}`)).toBeVisible();
}
const noOverflow = (page: any) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);

test("Tous les produits : ouvert sans recherche, catégories, plus de 20 résultats, sans doublon", async ({ page, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await openAll(page, f);
  await expect(page.getByTestId("all-list")).toBeVisible();
  await expect(page.getByTestId("all-count")).toContainText("produits");
  const total = Number((await page.getByTestId("all-count").innerText()).match(/\d+/)![0]);
  expect(total).toBeGreaterThanOrEqual(180);
  // plus de 20 résultats : « Voir plus » jusqu'au bout, aucune ligne en double
  while (await page.getByTestId("all-more").count()) await page.getByTestId("all-more").click({ trial: false }).then(() => page.waitForTimeout(150));
  const names = await page.locator('[data-testid="all-list"] .allrow').evaluateAll((els) => els.map((e) => (e.querySelector(".row__name") as HTMLElement).innerText.split("\n")[0]));
  expect(names.length).toBe(total);
  expect(new Set(names).size).toBe(names.length);
  // une catégorie
  await page.getByTestId("allcat-fruits").click();
  await expect(page.getByTestId("all-Tomates")).toHaveCount(0);
  await reveal(page, "Pêches");
  await expect(page.getByTestId("all-Tomates")).toHaveCount(0);
  // pas de photo : état explicite, jamais la photo d'un autre produit
  await expect(page.getByTestId("photo-todo-Pêches")).toContainText("Photo à venir");
});

test("ajout, déjà disponible, réactivation sans recréer ; recherche commune", async ({ page, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await openAll(page, f);
  await page.getByTestId("all-search").fill("couscous");
  await page.getByTestId("all-add-Couscous").click();
  await expect(page.getByTestId("all-have-Couscous")).toContainText("Déjà disponible");
  // article de départ désactivé puis réactivé depuis « Tous les produits »
  const before = (await (await f.adil.get("/api/catalog?includeInactive=1")).json()).categories.flatMap((c: any) => c.products).length;
  await page.getByTestId("all-search").fill("tomates");
  await expect(page.getByTestId("all-have-Tomates")).toBeVisible();
  await page.getByTestId("cat-view-mine").click();
  await page.getByTestId("active-Tomates").click();
  await page.getByTestId("cat-view-all").click();
  await page.getByTestId("all-search").fill("tomates");
  await page.getByTestId("all-react-Tomates").click();
  await expect(page.getByTestId("all-have-Tomates")).toBeVisible();
  const after = (await (await f.adil.get("/api/catalog?includeInactive=1")).json()).categories.flatMap((c: any) => c.products);
  expect(after.length).toBe(before); // aucun article recréé
  expect(after.filter((p: any) => p.name === "Tomates")).toHaveLength(1);
  expect(after.find((p: any) => p.name === "Tomates").active).toBe(true);
  // article familial saisi à la main : trouvé par la même recherche
  await f.adil.post("/api/products", { data: { name: "Papier cuisson", category: "maison" } });
  await page.getByTestId("all-search").fill("papier cuisson");
  await expect(page.getByTestId("all-have-Papier cuisson")).toBeVisible();
});

test("le personnel n'a aucun accès au catalogue complet", async ({ playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  expect((await f.staff.get("/api/catalog/all")).status()).toBe(403);
});

for (const w of WIDTHS) {
  test(`captures et lisibilité à ${w} px`, async ({ page, playwright, baseURL }) => {
    await page.setViewportSize({ width: w, height: 800 });
    const f = await newFamily(playwright, baseURL!);
    await f.adil.post("/api/products", { data: { name: "Fromage de chèvre frais aux herbes de Provence", category: "laitages" } });
    await openAll(page, f);
    await expect(page.getByTestId("all-Tomates")).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: `${OUT}/tous-les-produits-${w}.png` });
    await page.getByTestId("allcat-epicerie").click();
    await reveal(page, "Couscous");
    await page.screenshot({ path: `${OUT}/categorie-epicerie-${w}.png` });
    await page.getByTestId("allcat-all").click();
    await page.getByTestId("all-search").fill("fromage de chèvre");
    const row = page.getByTestId("all-Fromage de chèvre frais aux herbes de Provence");
    await expect(row).toBeVisible();
    // nom entier visible, rien ne dépasse de la ligne
    const ok = await row.evaluate((r) => [...r.children].every((c) => (c as HTMLElement).getBoundingClientRect().right <= r.getBoundingClientRect().right + 1));
    expect(ok).toBe(true);
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: `${OUT}/recherche-nom-long-${w}.png` });
    // zones tactiles
    for (const b of await page.locator('[data-testid="all-list"] button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(47);
  });
}

test("Laitue trouvable par « salade » ; « Boisson végétale » par « soja » (recherche commune, au clic)", async ({ page, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await openAll(page, f);
  await page.getByTestId("all-search").fill("salade verte");
  await expect(page.getByTestId("all-Laitue")).toBeVisible();
  await expect(page.locator('[data-testid="all-list"] .allrow')).toHaveCount(1);
  await page.getByTestId("all-search").fill("soja");
  await expect(page.getByTestId("all-Boisson végétale")).toBeVisible();
  await expect(page.getByTestId("all-add-Boisson végétale")).toBeVisible(); // jamais activée d'office
});

test("photo erronée d'un article : repérée, comparée, remplacée par la photo du catalogue du même nom ; les autres photos intactes", async ({ page, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await f.adil.post("/api/products", { data: { name: "Papier cuisson", category: "maison", image: PNG } });
  await f.adil.post("/api/products", { data: { name: "Boîte à gâteaux", category: "maison", image: PNG } });
  const asset = (await sql("INSERT INTO photo_assets (owner_family_id, storage_key, content_hash, mime, width, height, bytes, source_name, license) VALUES (NULL,'t','t','image/png',1,1,1,'test','GENERATED') RETURNING id"))[0].id;
  await sql("UPDATE extended_catalog SET photo_asset_id = $1 WHERE key = 'papier-cuisson'", [asset]);
  try {
    await uiLogin(page, f, "adil", "482913");
    await page.getByTestId("tab-settings").click();
    await page.getByTestId("seg-catalog").click();
    await expect(page.getByTestId("photosrc-Papier cuisson")).toContainText("de la famille");
    await page.getByTestId("pf-check").click();
    await expect(page.getByTestId("prod-Papier cuisson")).toBeVisible();
    await expect(page.getByTestId("prod-Boîte à gâteaux")).toHaveCount(0); // pas d'approximation par catégorie
    await page.getByTestId("usecat-Papier cuisson").click();
    await expect(page.getByTestId("photo-compare")).toBeVisible();
    await page.screenshot({ path: `${OUT}/photo-comparer-390.png` });
    await page.getByTestId("usecat-confirm").click();
    await page.getByTestId("pf-all").click();
    await expect(page.getByTestId("photosrc-Papier cuisson")).toContainText("du catalogue");
    await page.getByTestId("pf-all").click();
    await expect(page.getByTestId("photosrc-Boîte à gâteaux")).toContainText("de la famille");
  } finally {
    await sql("UPDATE extended_catalog SET photo_asset_id = NULL WHERE key = 'papier-cuisson'");
  }
});
