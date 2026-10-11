import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { card, createList, newFamily, uiLogin, type Family } from "./helpers";

/*
 * Présentation du catalogue, des statistiques et de la fiche produit à 360 et 390 px, avec nom long, quantité décimale,
 * unités pièce / bouteille / paquet / brique et la catégorie « Pain et petit-déjeuner ». Captures dans docs/captures/.
 */
const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const CAP = "../docs/captures";
const LONG = "Fromage de chèvre frais aux herbes de Provence et miel";

async function sql(q: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as any[];
  } finally {
    await c.end();
  }
}
const post = (f: Family, who: "staff" | "lamiaa" | "adil", listId: string, ops: object[]) => f[who].post(`/api/lists/${listId}/ops`, { data: { ops } });
const items = async (f: Family) => (await (await f.lamiaa.get("/api/lists/active")).json()).list.items as any[];

async function setup(playwright: any, baseURL: string) {
  const f = await newFamily(playwright, baseURL);
  const listId = await createList(f);
  const cat = (await (await f.adil.get("/api/catalog")).json()).categories;
  const first = (key: string) => cat.find((c: any) => c.key === key).products[0].name as string;
  await f.adil.post("/api/products", { data: { name: LONG, category: "laitages", unit: "piece" } });
  const all = (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products);
  f.products[LONG] = all.find((p: any) => p.name === LONG).id;
  await f.adil.patch(`/api/products/${f.products["Lait"]}`, { data: { unit: "brique" } });
  const drink = first("boissons");
  const pain = first("pain");
  return { f, listId, drink, pain };
}

for (const width of [360, 390]) {
  test(`${width} px : cartes en trois zones, unités entières, blocs de catégories lisibles, Pain et petit-déjeuner`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(120_000);
    const { f, drink } = await setup(playwright, baseURL!);
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    const pick = async (name: string, qty: string) => {
      await card(page, f, name).scrollIntoViewIfNeeded();
      await card(page, f, name).click();
      const input = page.getByTestId(`qty-input-${f.products[name]}`);
      await input.fill(qty);
      await input.press("Enter");
    };
    await pick("Lait", "3"); // brique
    await pick("Beurre", "1"); // pièce
    await pick(drink, "6"); // bouteille
    await pick("Riz", "2"); // paquet
    await pick("Tomates", "1,25"); // kg décimal
    await pick(LONG, "2"); // nom long

    const units: Record<string, string> = { Lait: "briques", Beurre: "pièce", [drink]: "bouteilles", Riz: "paquets", Tomates: "kg", [LONG]: "pièces" };
    for (const [name, unit] of Object.entries(units)) {
      const id = f.products[name]!;
      const w = page.getByTestId(`wrap-${id}`);
      await expect(page.getByTestId(`qty-unit-${id}`)).toHaveText(unit);
      // valeur saisie jamais coupée (« 1,25 » en entier) et unité jamais coupée
      expect(await page.getByTestId(`qty-input-${id}`).evaluate((e: HTMLInputElement) => e.scrollWidth <= e.clientWidth)).toBe(true);
      expect(await page.getByTestId(`qty-unit-${id}`).evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1)).toBe(true);
      // trois zones, l'une sous l'autre, sans chevauchement ; compteur dans la carte
      const z = await w.evaluate((e) => {
        const r = (sel: string) => e.querySelector(sel)!.getBoundingClientRect();
        const box = e.getBoundingClientRect();
        const photo = r(".card__photo"), nm = r(".card__name"), q = r(".qty");
        return { photoBottom: photo.bottom, nameTop: nm.top, nameBottom: nm.bottom, qTop: q.top, qBottom: q.bottom, boxBottom: box.bottom, overflowX: e.scrollWidth - e.clientWidth, nameWhole: (e.querySelector(".card__title") as HTMLElement).scrollHeight <= (e.querySelector(".card__title") as HTMLElement).clientHeight + 1 };
      });
      expect(z.nameTop).toBeGreaterThanOrEqual(z.photoBottom - 1);
      expect(z.qTop).toBeGreaterThanOrEqual(z.nameBottom - 1);
      expect(z.qBottom).toBeLessThanOrEqual(z.boxBottom);
      expect(z.overflowX).toBeLessThanOrEqual(1);
      expect(z.nameWhole).toBe(true); // nom long affiché en entier (sur plusieurs lignes)
      for (const t of ["minus", "plus"]) {
        const b = (await page.getByTestId(`${t}-${id}`).boundingBox())!;
        expect(b.width).toBeGreaterThanOrEqual(44);
        expect(b.height).toBeGreaterThanOrEqual(44);
      }
    }
    // deux colonnes sur mobile
    const cols = await page.locator("[data-testid^=wrap-]").evaluateAll((els) => new Set(els.slice(0, 8).map((e) => Math.round(e.getBoundingClientRect().left))).size);
    expect(cols).toBe(2);
    await expect(page.getByTestId(`qty-input-${f.products["Tomates"]}`)).toHaveValue("1,25");

    await card(page, f, "Lait").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${CAP}/design-${width}-cartes-laitages.png` });
    await card(page, f, LONG).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -200));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${CAP}/design-${width}-cartes-nom-long.png` });
    await card(page, f, "Tomates").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -200));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${CAP}/design-${width}-cartes-kg-decimal.png` });

    // par catégories
    await page.getByTestId("view-categories").click();
    await expect(page.getByTestId("category-blocks")).toBeVisible();
    await page.waitForTimeout(800);
    const blocks = await page.locator("[data-testid^=catblock-]").evaluateAll((els) =>
      els.map((e) => {
        const m = e.querySelector(".catblock__mosaic")!.getBoundingClientRect();
        const t = e.querySelector(".catblock__title") as HTMLElement;
        const imgs = [...e.querySelectorAll("img")] as HTMLImageElement[];
        const sub = e.querySelector(".catblock__count, .catblock__none")!.getBoundingClientRect();
        return { key: (e as HTMLElement).dataset.testid, side: Math.min(m.width / 2, m.height), titleBelow: t.getBoundingClientRect().top >= m.bottom - 1, countBelow: sub.top >= t.getBoundingClientRect().bottom - 1, whole: t.scrollHeight <= t.clientHeight + 1, imgs: imgs.length, loaded: imgs.every((i) => i.complete && i.naturalWidth > 0), lines: Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)) };
      }),
    );
    for (const b of blocks) {
      expect(b.titleBelow, b.key).toBe(true); // aucun texte sur les images
      expect(b.countBelow, b.key).toBe(true);
      expect(b.whole, b.key).toBe(true); // titre jamais coupé
      expect(b.side, b.key).toBeGreaterThanOrEqual(60);
      expect(b.imgs, b.key).toBeLessThanOrEqual(2);
      expect(b.loaded, b.key).toBe(true);
      expect(b.lines, b.key).toBeLessThanOrEqual(3);
    }
    const pain = blocks.find((b) => b.key === "catblock-pain")!;
    expect(pain.imgs).toBe(2); // « Pain et petit-déjeuner » : deux photos reconnaissables
    await page.screenshot({ path: `${CAP}/design-${width}-categories-haut.png` });
    await page.getByTestId("catblock-pain").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -260));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${CAP}/design-${width}-categories-pain.png` });
    await page.getByTestId("catblock-pain").click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${CAP}/design-${width}-categorie-pain-ouverte.png` });
    await ctx.close();
  });

  test(`${width} px : statistiques (filtres lisibles sur deux lignes) et fiche produit (mois en cours signalé incomplet)`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(120_000);
    const { f, listId } = await setup(playwright, baseURL!);
    const now = new Date();
    const at = (monthOffset: number, day: number, hour = 9) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day, hour)).toISOString();
    await sql("UPDATE lists SET created_at = $2 WHERE id = $1", [listId, at(-4, 3)]);
    const buy = async (name: string, qty: number, when: string[]) => {
      for (const t of when) {
        const open = (await items(f)).find((i) => i.name === name && i.status === "to_buy");
        if (!open) {
          const r = await (await post(f, "lamiaa", listId, [{ opId: randomUUID(), type: "add", productId: f.products[name], quantity: qty }])).json();
          if (r.results[0].reason === "already_purchased") await post(f, "lamiaa", listId, [{ opId: randomUUID(), type: "request_again", productId: f.products[name], quantity: qty }]);
        }
        const line = (await items(f)).find((i) => i.name === name && i.status === "to_buy")!;
        await post(f, "adil", listId, [{ opId: randomUUID(), type: "purchase", itemId: line.id }]);
        await sql("UPDATE purchases SET purchased_at = $2 WHERE list_item_id = $1 AND voided_at IS NULL", [line.id, t]);
      }
    };
    await buy("Lait", 2, [at(0, 1, 8), at(0, 1, 11)]);
    await buy("Lait", 6, [at(-1, 12), at(-2, 20)]);
    await buy("Tomates", 1.5, [at(0, 1, 12)]);
    await buy(LONG, 3, [at(0, 1, 13), at(-1, 1, 13)]);
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await page.getByTestId("tab-stats").click();
    await expect(page.getByTestId("stats-rows")).toBeVisible();
    // « Catégorie » et « Trier par » : deux lignes distinctes, valeur entièrement lisible
    const cat = (await page.getByTestId("stats-category").boundingBox())!;
    const sort = (await page.getByTestId("stats-sort").boundingBox())!;
    expect(sort.y).toBeGreaterThanOrEqual(cat.y + cat.height - 1);
    expect(cat.width).toBeGreaterThanOrEqual(width - 40);
    expect(sort.width).toBeGreaterThanOrEqual(width - 40);
    await page.getByTestId("stats-sort").selectOption("last");
    expect(await page.getByTestId("stats-sort").evaluate((e: HTMLSelectElement) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    await page.getByTestId("stats-sort").selectOption("frequency");
    await expect(page.getByTestId("stats-sort").locator("option:checked")).toHaveText("Fréquence d'achat");
    await expect(page.getByTestId(`freq-${LONG}`)).toBeVisible(); // nom long
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${CAP}/design-${width}-statistiques.png` });

    await page.getByTestId("stat-Lait").click();
    await expect(page.getByTestId("pstats")).toBeVisible();
    // en tête : photo et nom bien visibles
    const head = await page.locator(".phead").evaluate((e) => {
      const img = e.querySelector(".thumb")!.getBoundingClientRect();
      const nm = (e.querySelector(".phead__name") as HTMLElement);
      return { w: img.width, name: nm.textContent, whole: nm.scrollHeight <= nm.clientHeight + 1 };
    });
    expect(head.w).toBeGreaterThanOrEqual(70);
    expect(head.name).toBe("Lait");
    // le mois en cours est signalé incomplet ; les mois passés ne le sont pas
    const last = page.locator('[data-testid^="bar-"]').last();
    await expect(last).toHaveAttribute("data-incomplete", "true");
    await expect(page.locator('[data-incomplete="true"]')).toHaveCount(1);
    await expect(page.getByTestId("pstats-charts")).toContainText("en cours");
    await expect(page.getByTestId("pstats-charts")).toContainText("mois en cours, incomplet");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${CAP}/design-${width}-fiche-produit-haut.png` });
    await page.getByTestId("pstats-charts").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${CAP}/design-${width}-fiche-produit-graphique.png` });
    await page.getByTestId("pstats-close").click();
    await page.getByTestId(`stat-${LONG}`).click();
    await expect(page.locator(".phead__name")).toHaveText(LONG); // nom long entier
    await page.screenshot({ path: `${CAP}/design-${width}-fiche-produit-nom-long.png` });
    // mois passé : aucun mois incomplet
    await page.getByTestId("pstats-close").click();
    await page.getByTestId("period-previous").click();
    await page.getByTestId("stat-Lait").click();
    await expect(page.locator('[data-incomplete="true"]')).toHaveCount(0);
    await ctx.close();
  });
}
