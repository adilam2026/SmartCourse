import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { card, createList, newFamily, openInstall, uiLogin, type Family } from "./helpers";

/*
 * Refonte visuelle : liste des parents, catalogue, statistiques (écrans de référence) puis historique, réglages, profil, connexion.
 * À 360, 390 et 412 px, avec noms longs, quantités décimales, texte agrandi et clavier ouvert.
 * Contrôles par mesure (pas de débordement, rien de masqué par la navigation, zones tactiles ≥ 48 px) + captures dans docs/captures/refonte/.
 */
const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const OUT = "../docs/captures/refonte";
const LONG = "Fromage de chèvre frais aux herbes de Provence et miel";
const WIDTHS = [360, 390, 412];

/** Archived lists are write-protected by triggers; a test-only superuser session bypasses them to give two lists distinct closing times. */
async function sqlReplica(q: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(q, params);
    await c.query("COMMIT");
  } finally {
    await c.end();
  }
}
async function sql(q: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as any[];
  } finally {
    await c.end();
  }
}
const post = (f: Family, who: "staff" | "lamiaa" | "adil", listId: string, ops: object[], batch?: object) => f[who].post(`/api/lists/${listId}/ops`, { data: { ops, ...(batch ? { batch } : {}) } });
const add = (f: Family, name: string, quantity?: number) => ({ opId: randomUUID(), type: "add", productId: f.products[name]!, ...(quantity !== undefined ? { quantity } : {}) });
const items = async (f: Family) => (await (await f.lamiaa.get("/api/lists/active")).json()).list.items as any[];

async function family(playwright: any, baseURL: string) {
  const f = await newFamily(playwright, baseURL);
  const listId = await createList(f);
  expect((await f.adil.post("/api/products", { data: { name: LONG, category: "laitages", unit: "piece" } })).status()).toBe(201);
  f.products[LONG] = (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.name === LONG).id;
  await f.adil.patch(`/api/products/${f.products["Lait"]}`, { data: { unit: "brique" } });
  return { f, listId };
}

/** Seeds a small current list: 5 products, 2 bought. */
async function seedList(f: Family, listId: string) {
  await post(f, "staff", listId, [add(f, "Tomates", 1.5), add(f, "Pommes de terre", 2), add(f, "Carottes", 1), add(f, "Oignons", 1), add(f, LONG, 2)]);
  const it = await items(f);
  for (const n of ["Oignons", LONG]) await post(f, "adil", listId, [{ opId: randomUUID(), type: "purchase", itemId: it.find((i) => i.name === n).id }]);
}

/** Layout rules that must hold on every screen. */
async function audit(page: Page, label: string, opts: { nav?: boolean; bar?: boolean } = {}) {
  const r = await page.evaluate(() => {
    const out: Record<string, unknown> = {};
    out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const small: string[] = [];
    for (const e of document.querySelectorAll<HTMLElement>(".btn, .avatar, .backbtn, .tabbar button, .seg button, .menuitem, .qty__btn, .chip, .row__main, .card, .hcard, .monthnav__title")) {
      const b = e.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (e.closest(".sheet-backdrop") === null && getComputedStyle(e).visibility === "hidden") continue;
      if (b.height < 47.5) small.push(`${e.className} ${Math.round(b.height)}px "${(e.textContent ?? "").trim().slice(0, 20)}"`);
    }
    out.small = small;
    // text clipped by its own box (one-line ellipsis aside, names must show in full)
    const clipped: string[] = [];
    for (const e of document.querySelectorAll<HTMLElement>("h1, h2, .row__main b, .card__title, .catblock__title, .statrow .row__name b, .menuitem__text b, .qty__unit, .tabbar span")) {
      if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) clipped.push(`${e.className} "${(e.textContent ?? "").slice(0, 25)}"`);
    }
    out.clipped = clipped;
    return out;
  });
  expect(r.overflow, `${label} : aucun défilement horizontal`).toBeLessThanOrEqual(0);
  expect(r.small, `${label} : zones tactiles ≥ 48 px`).toEqual([]);
  expect(r.clipped, `${label} : aucun texte coupé`).toEqual([]);
  if (opts.nav) {
    // dernier contenu au-dessus de la navigation du bas
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    const g = await page.evaluate(() => {
      const nav = document.querySelector(".tabbar")!.getBoundingClientRect();
      const main = document.querySelector(".parent__body")!;
      const kids = [...main.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().height > 0);
      const bottom = Math.max(...kids.map((e) => e.getBoundingClientRect().bottom));
      return { bottom, navTop: nav.top };
    });
    expect(g.bottom, `${label} : rien n'est masqué par la navigation du bas`).toBeLessThanOrEqual(g.navTop + 1);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
}

for (const w of WIDTHS) {
  test.describe(`${w} px`, () => {
    const ctxOpts = { viewport: { width: w, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } as const;

    test("liste des parents, historique, réglages, profil : mise en page, tactile, navigation", async ({ browser, playwright, baseURL }) => {
      test.setTimeout(150_000);
      const { f, listId } = await family(playwright, baseURL!);
      await seedList(f, listId);
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      await uiLogin(page, f, "adil", "482913");
      await expect(page.getByTestId("progress")).toBeVisible();
      // titre, date, progression, actions
      await expect(page.locator("h1")).toHaveText("Les courses du jour");
      await expect(page.getByTestId("progress-text")).toHaveText("2 produits sur 5 achetés");
      await expect(page.getByTestId("edit-list")).toContainText("Ajouter / modifier");
      await expect(page.getByTestId("close-list")).toContainText("Clôturer");
      await expect(page.getByTestId(`buy-${f.products["Tomates"]}`)).toContainText("Acheté"); // coche accompagnée d'un libellé
      await expect(page.getByTestId("open-validations")).toBeVisible(); // action secondaire, pas un grand lien central
      // quantités, unités, nom long
      await expect(page.getByTestId(`qty-${f.products["Tomates"]}`)).toHaveText("1,5 kg");
      await expect(page.getByTestId(`row-${f.products[LONG]}`)).toContainText(LONG);
      await page.getByTestId("notif-invite-dismiss").click();
      await audit(page, "liste", { nav: true });
      await page.screenshot({ path: `${OUT}/${w}-liste-parent.png` });
      await page.screenshot({ path: `${OUT}/${w}-liste-parent-complete.png`, fullPage: true });
      // Clôturer demande confirmation
      await page.getByTestId("close-list").click();
      await expect(page.getByTestId("close-confirm")).toBeVisible();
      await page.screenshot({ path: `${OUT}/${w}-cloture-confirmation.png` });
      await page.getByRole("button", { name: "Annuler" }).click();
      expect((await post(f, "adil", listId, [])).status()).toBeGreaterThan(0);

      // détail d'une ligne, correction : fenêtres
      await page.getByTestId(`correct-${f.products["Oignons"]}`).click();
      await expect(page.getByTestId("correct-confirm")).toBeVisible();
      await page.screenshot({ path: `${OUT}/${w}-correction.png` });
      await page.getByRole("button", { name: "Annuler" }).click();

      // historique : deux listes clôturées le même jour, distinguables par l'heure
      await f.lamiaa.post(`/api/lists/${listId}/close`);
      const second = await createList(f);
      await post(f, "staff", second, [add(f, "Riz", 2), add(f, "Sucre", 1)]);
      const it2 = await items(f);
      await post(f, "adil", second, [{ opId: randomUUID(), type: "purchase", itemId: it2.find((i) => i.name === "Riz").id }]);
      await f.lamiaa.post(`/api/lists/${second}/close`);
      await sqlReplica("UPDATE lists SET closed_at = closed_at - interval '3 hours' WHERE id = $1", [listId]); // même jour, autre heure
      await page.getByTestId("tab-history").click();
      await expect(page.getByTestId("history-entry")).toHaveCount(2);
      const times = await page.getByTestId("history-time").allTextContents();
      expect(new Set(times).size).toBe(2); // date ET heure de clôture distinguent les deux cartes
      expect(times[0]).toMatch(/\d{2}:\d{2}/);
      await expect(page.getByTestId("history")).not.toContainText(/correction/i);
      await expect(page.locator(".hcard img.thumb").first()).toBeVisible(); // miniatures
      await audit(page, "historique", { nav: true });
      await page.screenshot({ path: `${OUT}/${w}-historique.png` });
      await page.getByTestId("history-entry").nth(1).click();
      await expect(page.getByTestId("archive")).toBeVisible();
      await expect(page.getByTestId("archive")).not.toContainText(/corrig|correction|annulé/i);
      await expect(page.getByTestId("archive-bought").locator(".catgroup__title").first()).toBeVisible();
      await audit(page, "archive");
      await page.screenshot({ path: `${OUT}/${w}-historique-detail.png`, fullPage: true });
      await page.getByTestId("archive-back").click();

      // réglages : rubriques
      await page.getByTestId("tab-settings").click();
      for (const id of ["seg-profiles", "seg-catalog", "seg-notifications", "seg-backups", "seg-about"]) await expect(page.getByTestId(id)).toBeVisible();
      await audit(page, "réglages", { nav: true });
      await page.screenshot({ path: `${OUT}/${w}-reglages.png` });
      await page.getByTestId("seg-backups").click();
      await expect(page.getByTestId("backup-state")).toBeVisible();
      await page.screenshot({ path: `${OUT}/${w}-sauvegardes.png` });
      await page.getByTestId("settings-back").click();
      await page.getByTestId("seg-profiles").click();
      await expect(page.getByTestId("add-profile")).toBeVisible(); // aucune commande d'administration masquée
      await audit(page, "profils");
      await page.screenshot({ path: `${OUT}/${w}-profils.png` });
      await page.getByTestId("settings-back").click();
      await page.getByTestId("seg-catalog").click();
      await expect(page.getByTestId("add-article")).toBeVisible();
      await page.screenshot({ path: `${OUT}/${w}-catalogue-admin.png` });
      await page.getByTestId("settings-back").click();
      await page.getByTestId("seg-notifications").click();
      await expect(page.getByTestId("notif-settings")).toBeVisible();
      await page.getByTestId("settings-back").click();
      await page.getByTestId("seg-about").click();
      await expect(page.getByTestId("version-info")).toBeVisible();
      await page.getByTestId("settings-back").click();

      // profil : notifications, crédits, déconnexion, version en section secondaire
      await page.getByTestId("avatar").click();
      await expect(page.getByTestId("notif-settings")).toBeVisible();
      await expect(page.getByTestId("logout")).toBeVisible();
      await expect(page.getByRole("button", { name: "Crédits photos" })).toBeVisible();
      await expect(page.getByRole("region", { name: "À propos" })).toBeVisible();
      await page.screenshot({ path: `${OUT}/${w}-profil.png` });
      await ctx.close();
    });

    test("catalogue du personnel : cartes, compteur, barre Valider fixe, clavier ouvert, texte agrandi", async ({ browser, playwright, baseURL }) => {
      test.setTimeout(150_000);
      const { f } = await family(playwright, baseURL!);
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      await uiLogin(page, f);
      await expect(page.getByTestId("catalog")).toBeVisible();
      await expect(page.locator("h1")).toHaveText("Préparer les courses");
      await expect(page.getByTestId("validate")).toBeDisabled();
      await expect(page.getByTestId("validate")).toHaveText("Aucune modification à valider");
      const pick = async (n: string, q?: string) => {
        await card(page, f, n).scrollIntoViewIfNeeded();
        await card(page, f, n).click();
        if (q) {
          const input = page.getByTestId(`qty-input-${f.products[n]}`);
          await input.fill(q);
          await input.press("Enter");
        }
      };
      await pick("Tomates", "1,25");
      await pick("Lait", "3");
      await pick("Riz", "2");
      await pick(LONG, "2");
      await expect(page.getByTestId("validate")).toHaveText("Valider 4 modifications");
      // identifiables autrement que par la couleur : libellé « À valider » + coche
      await expect(page.getByTestId(`tag-${f.products["Tomates"]}`)).toHaveText("● À valider");
      await expect(page.getByTestId(`qty-input-${f.products["Tomates"]}`)).toHaveValue("1,25");
      expect(await page.getByTestId(`qty-input-${f.products["Tomates"]}`).evaluate((e: HTMLInputElement) => e.scrollWidth <= e.clientWidth + 2)).toBe(true);
      await audit(page, "catalogue");
      await card(page, f, "Tomates").scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -260));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${w}-catalogue.png` });
      await card(page, f, LONG).scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${w}-catalogue-nom-long.png` });
      // la barre fixe est entièrement visible, au bas de l'écran
      const bar = (await page.getByTestId("validate").boundingBox())!;
      expect(bar.y + bar.height).toBeLessThanOrEqual(820);
      expect(bar.height).toBeGreaterThanOrEqual(48);
      // par catégories
      await page.getByTestId("view-categories").click();
      await expect(page.getByTestId("category-blocks")).toBeVisible();
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo(0, 0));
      await audit(page, "par catégories");
      await page.screenshot({ path: `${OUT}/${w}-categories.png` });
      await page.getByTestId("catblock-pain").scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -240));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${w}-categories-pain.png` });
      await page.getByTestId("view-all").click();

      // clavier ouvert : la barre fixe s'efface, le champ reste visible et utilisable
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByTestId("catalog-search").focus();
      await page.evaluate(() => {
        const vv = window.visualViewport!;
        Object.defineProperty(vv, "height", { configurable: true, get: () => 330 });
        vv.dispatchEvent(new Event("resize"));
      });
      await expect(page.getByTestId("actionbar")).toHaveClass(/actionbar--hidden/);
      await page.getByTestId("catalog-search").fill("pomme");
      await expect(page.getByTestId("catalog-search")).toBeInViewport();
      await page.screenshot({ path: `${OUT}/${w}-catalogue-clavier.png` });
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport!, "height", { configurable: true, get: () => window.innerHeight });
        window.visualViewport!.dispatchEvent(new Event("resize"));
        (document.activeElement as HTMLElement)?.blur();
      });
      await page.getByTestId("catalog-search").fill("");
      await expect(page.getByTestId("actionbar")).not.toHaveClass(/actionbar--hidden/);

      // texte agrandi (réglage Android « taille de police » ≈ 150 %)
      await page.addStyleTag({ content: "html { font-size: 150% !important; }" });
      await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(0, 0));
      // une colonne quand le texte est très agrandi (au lieu de cartes écrasées)
      const cols = await page.locator("[data-testid^=wrap-]").evaluateAll((els) => new Set(els.slice(0, 6).map((e) => Math.round(e.getBoundingClientRect().left))).size);
      expect(cols).toBe(1);
      await audit(page, "texte agrandi (catalogue)");
      const big = await page.evaluate(() => ({ w: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      expect(big.w).toBeLessThanOrEqual(0);
      await page.getByTestId(`qty-input-${f.products["Tomates"]}`).scrollIntoViewIfNeeded();
      await expect(page.getByTestId(`qty-input-${f.products["Tomates"]}`)).toBeInViewport();
      expect(await page.getByTestId(`qty-input-${f.products["Tomates"]}`).evaluate((e: HTMLInputElement) => e.scrollWidth <= e.clientWidth + 2)).toBe(true);
      await page.screenshot({ path: `${OUT}/${w}-catalogue-texte-agrandi.png` });
      await ctx.close();
    });

    test("statistiques : synthèse, plus achetés, filtres, fiche produit", async ({ browser, playwright, baseURL }) => {
      test.setTimeout(150_000);
      const { f, listId } = await family(playwright, baseURL!);
      await sql("UPDATE lists SET created_at = now() - interval '120 days' WHERE id = $1", [listId]);
      const now = new Date();
      const at = (mo: number, d: number, h = 9) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + mo, d, h)).toISOString();
      const buy = async (n: string, q: number, when: string[]) => {
        for (const t of when) {
          const open = (await items(f)).find((i) => i.name === n && i.status === "to_buy");
          if (!open) {
            const r = await (await post(f, "lamiaa", listId, [add(f, n, q)])).json();
            if (r.results[0].reason === "already_purchased") await post(f, "lamiaa", listId, [{ opId: randomUUID(), type: "request_again", productId: f.products[n], quantity: q }]);
          }
          const line = (await items(f)).find((i) => i.name === n && i.status === "to_buy")!;
          await post(f, "adil", listId, [{ opId: randomUUID(), type: "purchase", itemId: line.id }]);
          await sql("UPDATE purchases SET purchased_at = $2 WHERE list_item_id = $1 AND voided_at IS NULL", [line.id, t]);
        }
      };
      await buy("Pommes de terre", 2, [at(0, 1, 8), at(0, 1, 9), at(0, 1, 10), at(0, 1, 11)]);
      await buy("Lait", 1, [at(0, 1, 8), at(0, 1, 9), at(0, 1, 10)]);
      await buy("Tomates", 1.5, [at(0, 1, 8), at(0, 1, 9)]);
      await buy(LONG, 2, [at(0, 1, 8)]);
      await buy("Lait", 6, [at(-1, 4)]);
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("notif-invite-dismiss").click().catch(() => {});
      await page.getByTestId("tab-stats").click();
      await expect(page.locator("h1")).toHaveText("Vos achats");
      await expect(page.getByTestId("stats-window")).toContainText("du 1");
      await expect(page.getByTestId("sum-purchases")).toHaveText("10");
      await expect(page.getByTestId("sum-products")).toHaveText("4");
      await expect(page.getByTestId("legend-bars")).toContainText("nombre d'achats"); // mesure commune des barres
      // barres : une même mesure (fréquence) → la plus longue = le produit le plus acheté
      const widths = await page.locator('[data-testid^="statbar-"]').evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.testid, (e as HTMLElement).getBoundingClientRect().width]));
      const byName = Object.fromEntries(widths.map(([k, v]) => [String(k).replace("statbar-", ""), Number(v)]));
      expect(byName["Pommes de terre"]).toBeGreaterThan(byName["Lait"]!);
      expect(byName["Lait"]).toBeGreaterThan(byName["Tomates"]!);
      await expect(page.getByTestId(`stat-${LONG}`)).toBeVisible();
      await expect(page.getByTestId("freq-Tomates")).toHaveText("2 achats · 3 kg");
      await audit(page, "statistiques", { nav: true });
      await page.screenshot({ path: `${OUT}/${w}-statistiques.png` });
      await page.screenshot({ path: `${OUT}/${w}-statistiques-complete.png`, fullPage: true });
      // filtres : panneau, filtres actifs visibles et réinitialisables
      await page.getByTestId("stats-filters").click();
      await page.screenshot({ path: `${OUT}/${w}-statistiques-filtres.png` });
      await page.getByTestId("stats-category").selectOption("laitages");
      await page.getByTestId("stats-sort").selectOption("name");
      await page.getByTestId("filters-done").click();
      await expect(page.getByTestId("active-filters")).toContainText("Laitages");
      await expect(page.getByTestId("active-filters")).toContainText("Tri : nom");
      await expect(page.getByTestId("stats-filters")).toContainText("(2)");
      await page.screenshot({ path: `${OUT}/${w}-statistiques-filtres-actifs.png` });
      await page.getByTestId("stats-reset").click();
      await expect(page.getByTestId("active-filters")).toHaveCount(0);
      // fiche produit
      await page.getByTestId("stat-Lait").click();
      await expect(page.getByTestId("pstats")).toBeVisible();
      await audit(page, "fiche produit");
      await page.screenshot({ path: `${OUT}/${w}-fiche-produit.png` });
      await ctx.close();
    });

    test("connexion et première installation", async ({ browser, baseURL }) => {
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      await page.goto(`${baseURL}/`);
      await expect(page.getByTestId("login-submit")).toBeVisible();
      await expect(page.locator(".auth__logo img")).toBeVisible();
      await audit(page, "connexion");
      await page.screenshot({ path: `${OUT}/${w}-connexion.png` });
      await openInstall(page);
      await audit(page, "installation");
      await page.screenshot({ path: `${OUT}/${w}-installation.png`, fullPage: true });
      await ctx.close();
    });
  });
}
