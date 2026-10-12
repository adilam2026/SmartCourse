import { randomUUID } from "node:crypto";
import pg from "pg";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { newFamily, pickCity, uiLogin, type Family } from "./helpers";

/*
 * Simplification de l'interface : fiche article / fenêtre Prix, ville du profil, synchronisation par ville, suppression d'une liste
 * clôturée, écrans sans liste / vide / partiel / tout acheté, invitation aux notifications. Mobile 360 et 390 px.
 * Aucune liste réelle n'est touchée : toutes les familles sont créées pour le test.
 */
const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const OUT = "../docs/captures/livraison";
const { defaultBrowserType: _d, ...PIXEL } = devices["Pixel 7"];
const SIZES = [{ name: "360", width: 360, height: 740 }, { name: "390", width: 390, height: 844 }] as const;

async function sql<T = any>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}
const add = (f: Family, name: string, quantity = 1) => ({ opId: randomUUID(), type: "add", productId: f.products[name]!, quantity });
async function ops(who: Family["adil"], listId: string, list: object[]) {
  const r = await who.post(`/api/lists/${listId}/ops`, { data: { ops: list } });
  expect(r.status()).toBe(200);
  return (await r.json()).list;
}
async function newList(f: Family): Promise<string> {
  const r = await f.adil.post("/api/lists");
  expect(r.status()).toBe(201);
  return (await r.json()).list.id;
}
/** Liste clôturée avec ces produits achetés. */
async function closedList(f: Family, names: string[]): Promise<string> {
  const id = await newList(f);
  const l = await ops(f.adil, id, names.map((n) => add(f, n)));
  for (const it of l.items) await ops(f.adil, id, [{ opId: randomUUID(), type: "purchase", itemId: it.id }]);
  expect((await f.adil.post(`/api/lists/${id}/close`)).status()).toBe(200);
  return id;
}
const prices = (f: Family) => f.adil.put("/api/me/prefs", { data: { showPrices: true, showTotals: false } });
const catalog = async (f: Family) => Object.fromEntries((await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).map((p: any) => [p.name, p]));
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function phone(browser: Browser, baseURL: string | undefined, s: (typeof SIZES)[number], init?: string) {
  const ctx = await browser.newContext({ ...PIXEL, viewport: { width: s.width, height: s.height }, baseURL });
  if (init) await ctx.addInitScript(init);
  return { ctx, page: await ctx.newPage() };
}
const FAKE_PUSH = (initial: "default" | "granted" | "denied", answer: "granted" | "denied") => `
(() => {
  let perm = (() => { try { return localStorage.getItem("__perm") || ${JSON.stringify(initial)}; } catch { return ${JSON.stringify(initial)}; } })();
  Object.defineProperty(Notification, "permission", { get: () => perm, configurable: true });
  Notification.requestPermission = async () => { try { localStorage.setItem("__asks", String(Number(localStorage.getItem("__asks") || 0) + 1)); localStorage.setItem("__perm", ${JSON.stringify(answer)}); } catch {} perm = ${JSON.stringify(answer)}; return perm; };
  const rnd = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); };
  let sub = null;
  const proto = PushManager.prototype;
  proto.getSubscription = async function () { return sub; };
  proto.subscribe = async function (o) { const endpoint = "https://fcm.example.test/send/" + rnd(18); sub = { endpoint, options: { applicationServerKey: new Uint8Array(o.applicationServerKey).buffer }, toJSON: () => ({ endpoint, keys: { p256dh: rnd(65), auth: rnd(16) } }), unsubscribe: async () => { sub = null; return true; } }; return sub; };
})();`;
const asks = (page: Page) => page.evaluate(() => Number(localStorage.getItem("__asks") || 0));

for (const s of SIZES) {
  test.describe(`mobile ${s.name} px`, () => {
    test("fiche article compacte et fenêtre Prix : la bonne fiche s'ouvre, le bon article est modifié", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await prices(f);
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-settings").click();
      await page.getByTestId("seg-catalog").click();
      // fiche : seulement photo, nom, catégorie, unité, état actif ; aucun texte explicatif ni technique
      await page.getByTestId("edit-Pâtes").click();
      const form = page.getByTestId("product-form");
      await expect(page.getByTestId("pf-name")).toHaveValue("Pâtes");
      await expect(form.locator("input:not([type=file]):not([type=checkbox]), select")).toHaveCount(3); // nom, catégorie, unité
      for (const t of ["pf-unit-hint", "pf-rule", "price-amount", "product-price"]) await expect(page.getByTestId(t)).toHaveCount(0);
      await expect(form).not.toContainText(/convertit|archiv|réduite automatiquement/i);
      await expect(page.getByTestId("pf-save")).toHaveText("Enregistrer");
      await expect(page.getByTestId("pf-cancel")).toHaveText("Annuler");
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/fiche-article-${s.name}.png` });
      // capture d'ancien état : la fiche « Pâtes » ne doit jamais rester derrière celle de « Lentilles »
      await page.getByTestId("pf-cancel").click();
      await page.getByTestId("edit-Lentilles").click();
      await expect(page.getByTestId("pf-name")).toHaveValue("Lentilles");
      await page.getByTestId("pf-name").fill("Lentilles vertes");
      await page.getByTestId("pf-save").click();
      await expect(page.getByTestId("product-form")).toHaveCount(0);
      const cat = await catalog(f);
      expect(cat["Lentilles vertes"]).toBeTruthy();
      expect(cat["Pâtes"]).toBeTruthy(); // l'autre article n'a pas bougé
      expect(cat["Lentilles"]).toBeUndefined();
      // fenêtre Prix : petite, un seul champ, référence courte ; modifie le bon article
      await page.getByTestId("price-Pâtes").click();
      const dlg = page.getByTestId("price-dialog");
      await expect(dlg).toBeVisible();
      await expect(page.getByTestId("price-ref")).toContainText("Pâtes");
      await expect(dlg.getByRole("button", { name: "Enregistrer" })).toHaveCount(1);
      await page.getByTestId("price-amount").fill("");
      await expect(page.getByTestId("price-save")).toBeDisabled(); // pas de prix saisi
      if (await page.getByTestId("price-packaging").count()) { // information manquante : seulement le contenu est demandé
        await expect(dlg.locator("input")).toHaveCount(2);
        await page.getByTestId("price-packaging").fill("500 g");
      }
      await page.getByTestId("price-amount").fill("8,5");
      await expect(page.getByTestId("price-format-open")).toBeVisible(); // « Modifier le format », discret
      await page.screenshot({ path: `${OUT}/fenetre-prix-${s.name}.png` });
      await page.getByTestId("price-save").click();
      await expect(page.getByTestId("price-dialog")).toHaveCount(0);
      const after = await catalog(f);
      expect(after["Pâtes"].price).toMatchObject({ amount: "8.50", source: "family" });
      expect(after["Lentilles vertes"].price?.source).not.toBe("family"); // l'autre article n'a pas de prix de famille
      await page.screenshot({ path: `${OUT}/catalogue-${s.name}.png` });
      // un profil qui n'a pas activé les prix ne voit aucun bouton Prix
      await f.adil.put("/api/me/prefs", { data: { showPrices: false, showTotals: false } });
      await page.reload();
      await page.getByTestId("tab-settings").click();
      await page.getByTestId("seg-catalog").click();
      await expect(page.getByTestId("price-Pâtes")).toHaveCount(0);
      await ctx.close();
    });

    test("ville : obligatoire, cherchable, préremplie pour les autres profils, modifiable ; profil sans ville invité sans blocage", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await sql("UPDATE profiles SET city = 'Rabat' WHERE login = 'adil' AND family_id = (SELECT id FROM families WHERE code = $1)", [f.code]);
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-settings").click();
      await page.getByTestId("seg-profiles").click();
      await page.getByRole("button", { name: /Ajouter/ }).first().click();
      // préremplie avec la ville de l'administrateur principal, modifiable
      await expect(page.getByTestId("np-city-input")).toHaveValue("Rabat");
      await page.getByTestId("np-name").fill("Nadia");
      await page.getByTestId("np-login").fill("nadia");
      await page.getByTestId("np-secret").fill("684215");
      await page.getByTestId("np-secret2").fill("684215");
      await page.getByTestId("np-city-input").fill("");
      await expect(page.getByTestId("np-submit")).toBeDisabled(); // ville obligatoire
      await page.getByTestId("np-city-input").fill("Mekn");
      await expect(page.getByTestId("np-city-opt-Meknès")).toBeVisible();
      await page.screenshot({ path: `${OUT}/ville-nouveau-profil-${s.name}.png` });
      await page.getByTestId("np-city-opt-Meknès").click();
      await page.getByTestId("np-submit").click();
      await expect(page.getByText("Profil créé : Nadia.")).toBeVisible();
      expect((await sql("SELECT city FROM profiles WHERE login = 'nadia' AND family_id = (SELECT id FROM families WHERE code = $1)", [f.code]))[0].city).toBe("Meknès");
      // le serveur refuse aussi une création sans ville ou hors liste (sans le réglage de test)
      // profil existant sans ville : l'usage normal n'est pas bloqué ; la ville est demandée à la première synchronisation
      await sql("UPDATE profiles SET city = NULL WHERE login = 'adil' AND family_id = (SELECT id FROM families WHERE code = $1)", [f.code]);
      await page.reload();
      await expect(page.getByTestId("tab-current")).toBeVisible();
      await page.getByTestId("tab-settings").click();
      await page.getByTestId("seg-prices").click();
      await expect(page.getByTestId("sync-need-city")).toBeVisible();
      await page.screenshot({ path: `${OUT}/ville-demandee-${s.name}.png` });
      await page.getByTestId("city-prompt-later").click(); // « Plus tard » : rien de bloqué
      await page.getByTestId("settings-back").click();
      await expect(page.getByTestId("seg-prices")).toBeVisible();
      // changer sa ville depuis « Mon profil »
      await page.getByTestId("avatar").click();
      await pickCity(page, "me-city", "Tanger");
      await page.getByTestId("me-city-save").click();
      await expect(page.getByTestId("me-city-msg")).toHaveText("Ville enregistrée.");
      expect((await sql("SELECT city FROM profiles WHERE login = 'adil' AND family_id = (SELECT id FROM families WHERE code = $1)", [f.code]))[0].city).toBe("Tanger");
      await ctx.close();
    });

    test("synchronisation : seulement les prix de la ville et du format compatible ; choix explicite ; prix appliqués à la famille", async ({ browser, playwright, baseURL }) => {
      await sql("DELETE FROM price_contributions");
      const viewer = await newFamily(playwright, baseURL!);
      const city = async (f: Family, c: string) => expect((await f.adil.put("/api/me/city", { data: { city: c } })).status()).toBe(200);
      await city(viewer, "Casablanca");
      await viewer.adil.put(`/api/products/${viewer.products["Pommes"]}/price`, { data: { amount: "7", refQty: 1, refUnit: "kg" } });
      await prices(viewer);
      const share = async (f: Family, name: string, amount: string, c: string, refUnit = "kg", packaging?: string) => {
        await city(f, c);
        await f.adil.put(`/api/products/${f.products[name]}/price`, { data: { amount, refQty: 1, refUnit, ...(packaging ? { packaging } : {}) } });
        expect((await f.adil.post("/api/prices/share", { data: { productId: f.products[name] } })).status()).toBe(201);
      };
      for (const a of ["10", "12", "11"]) await share(await newFamily(playwright, baseURL!), "Pommes", a, "Casablanca"); // 3 familles de la ville
      for (const a of ["30", "31", "32"]) await share(await newFamily(playwright, baseURL!), "Poires", a, "Rabat"); // autre ville : jamais proposé
      for (const a of ["2", "2", "2"]) await share(await newFamily(playwright, baseURL!), "Riz", a, "Casablanca", "paquet", "500 g"); // format paquet de 500 g
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, viewer, "adil", "482913");
      await page.getByTestId("tab-settings").click();
      await page.getByTestId("seg-prices").click();
      await expect(page.getByTestId("sync-city")).toContainText("Casablanca");
      await expect(page.getByTestId(`proposal-${viewer.products["Pommes"]}`)).toContainText("Proposé : 11,00 DH / kg");
      await expect(page.getByTestId(`proposal-${viewer.products["Poires"]}`)).toHaveCount(0); // prix d'une autre ville
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/synchro-prix-${s.name}.png` });
      // rien d'appliqué tout seul
      expect((await catalog(viewer))["Pommes"].price.amount).toBe("7.00");
      await page.getByTestId(`pick-${viewer.products["Pommes"]}`).check();
      await expect(page.getByTestId(`pick-${viewer.products["Riz"]}`)).toBeChecked(); // sans prix personnel : coché d'office, décochable
      await page.getByTestId("sync-apply").click();
      await expect(page.getByTestId("sync-msg")).toContainText("2 prix appliqués");
      expect((await catalog(viewer))["Pommes"].price).toMatchObject({ amount: "11.00", source: "community" });
      expect((await catalog(viewer))["Riz"].price).toMatchObject({ amount: "2.00", refUnit: "paquet", packaging: "500 g" });
      // un autre profil de la famille voit le même prix (prix de la famille)
      expect((await (await viewer.lamiaa.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.name === "Pommes").price.amount).toBe("11.00");
      await expect(page.getByTestId("sync-empty")).toHaveText("Aucun nouveau prix disponible dans votre ville.");
      await ctx.close();
    });

    test("suppression d'une liste clôturée : administrateur seulement, confirmation, statistiques recalculées, autres listes et familles intactes ; action hors connexion sans erreur 500", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      const g = await newFamily(playwright, baseURL!);
      const keep = await closedList(f, ["Tomates"]);
      const doomed = await closedList(f, ["Oignons", "Carottes"]);
      const foreign = await closedList(g, ["Oignons"]);
      const stats = async () => JSON.stringify(await (await f.adil.get("/api/stats/purchases")).json());
      expect(await stats()).toContain("Oignons");
      // le profil parent n'a pas la commande
      const { ctx: pctx, page: parentPage } = await phone(browser, baseURL, s);
      await uiLogin(parentPage, f, "lamiaa", "573918");
      await parentPage.getByTestId("tab-history").click();
      await parentPage.getByTestId("history-entry").first().click();
      await expect(parentPage.getByTestId("archive")).toBeVisible();
      await expect(parentPage.getByTestId("archive-more")).toHaveCount(0);
      expect((await f.lamiaa.delete(`/api/lists/${doomed}`)).status()).toBe(403);
      await pctx.close();
      // administrateur : menu discret, confirmation, suppression
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-history").click();
      await expect(page.getByTestId("history-entry")).toHaveCount(2);
      await page.getByTestId("history-entry").filter({ hasText: "2 produits achetés" }).click();
      await expect(page.getByTestId("archive-delete")).toHaveCount(0); // discret : dans le menu
      await page.getByTestId("archive-more").click();
      await page.screenshot({ path: `${OUT}/historique-menu-${s.name}.png` });
      await page.getByTestId("archive-delete").click();
      await expect(page.getByTestId("archive-delete-text")).toHaveText("Supprimer cette liste et ses achats de l'historique ? Cette action est définitive.");
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/historique-suppression-${s.name}.png` });
      await page.getByTestId("archive-delete-cancel").click();
      expect((await f.adil.get(`/api/lists/${doomed}`)).status()).toBe(200); // annuler ne supprime rien
      await page.getByTestId("archive-more").click();
      await page.getByTestId("archive-delete").click();
      await page.getByTestId("archive-delete-confirm").click();
      await expect(page.getByTestId("history-entry")).toHaveCount(1);
      expect((await f.adil.get(`/api/lists/${doomed}`)).status()).toBe(404);
      expect((await f.adil.get(`/api/lists/${keep}`)).status()).toBe(200);
      expect((await g.adil.get(`/api/lists/${foreign}`)).status()).toBe(200);
      const after = await stats();
      expect(after).not.toContain("Oignons");
      expect(after).toContain("Tomates");
      expect((await catalog(f))["Oignons"]).toBeTruthy(); // le catalogue reste
      // ancienne action hors connexion sur la liste supprimée : réponse contrôlée, jamais 500, liste non recréée
      const late = await f.adil.post(`/api/lists/${doomed}/ops`, { data: { ops: [add(f, "Tomates")] } });
      expect(late.status()).toBe(404);
      expect((await sql("SELECT count(*)::int AS n FROM lists WHERE id = $1", [doomed]))[0].n).toBe(0);
      // une liste en cours ne se supprime pas
      const active = await newList(f);
      expect((await f.adil.delete(`/api/lists/${active}`)).status()).toBe(409);
      await ctx.close();
    });

    test("écran de la liste : aucune liste, liste vide, partiellement achetée, tout acheté", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      const { ctx, page } = await phone(browser, baseURL, s);
      await uiLogin(page, f, "adil", "482913");
      // aucune liste : une phrase, rien à zéro, et ouvrir l'écran ne crée rien
      await expect(page.getByTestId("empty-text")).toHaveText("Préparez votre liste de courses.");
      const body = await page.locator("main, .parent").first().innerText();
      expect(body).not.toMatch(/À acheter|Déjà achetés|Clôturer|\b0 produit/);
      for (const t of ["count-tobuy", "count-bought", "progress", "close-list"]) await expect(page.getByTestId(t)).toHaveCount(0);
      await expect(page.getByTestId("edit-list")).toBeVisible();
      await expect(page.getByTestId("open-favorites")).toBeVisible();
      expect((await (await f.adil.get("/api/lists/active")).json()).list).toBeNull();
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/liste-vide-${s.name}.png` });
      // le personnel voit les produits actifs sans attendre la création d'une liste
      const { ctx: sctx, page: staff } = await phone(browser, baseURL, s);
      await uiLogin(staff, f);
      await expect(staff.getByTestId("catalog")).toBeVisible();
      expect(await staff.locator("[data-testid^='card-']").count()).toBeGreaterThan(30);
      await sctx.close();
      // « Ajouter / modifier » crée la liste à ce moment-là
      await page.getByTestId("edit-list").click();
      await expect(page.getByTestId("catalog")).toBeVisible();
      const listId = (await (await f.adil.get("/api/lists/active")).json()).list.id as string;
      await page.getByRole("button", { name: /Retour à la liste/ }).click();
      await expect(page.getByTestId("empty-text")).toBeVisible(); // liste vide : même écran
      await expect(page.getByTestId("close-list")).toHaveCount(0);
      // partiellement acheté : les deux sections et la progression
      const l = await ops(f.adil, listId, [add(f, "Tomates"), add(f, "Riz")]);
      await expect(page.getByTestId("count-tobuy")).toHaveText("2");
      await expect(page.getByTestId("count-bought")).toHaveCount(0); // aucune section « Déjà achetés » vide
      await ops(f.adil, listId, [{ opId: randomUUID(), type: "purchase", itemId: l.items[0].id }]);
      await expect(page.getByTestId("count-bought")).toHaveText("1");
      await expect(page.getByTestId("progress")).toBeVisible();
      await expect(page.getByTestId("close-list")).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/liste-partielle-${s.name}.png` });
      // tout acheté : message, plus de section « À acheter », clôture possible
      await ops(f.adil, listId, [{ opId: randomUUID(), type: "purchase", itemId: l.items[1].id }]);
      await expect(page.getByTestId("all-bought")).toContainText("Tous les articles sont achetés");
      await expect(page.getByTestId("count-tobuy")).toHaveCount(0);
      await expect(page.getByTestId("count-bought")).toHaveText("2");
      await page.screenshot({ path: `${OUT}/liste-tout-achete-${s.name}.png` });
      await page.getByTestId("close-list").click();
      await page.getByTestId("close-confirm").click();
      await expect(page.getByTestId("empty-text")).toBeVisible();
      await ctx.close();
    });

    test("notifications : une seule invitation, « Plus tard », fermeture et refus ne reviennent pas (navigation, réouverture, mise à jour) ; accord sans bandeau", async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await newList(f);
      // « Plus tard » : plus jamais d'invitation sur cet appareil, même après navigation, réouverture, déconnexion et autre profil
      const a = await phone(browser, baseURL, s, FAKE_PUSH("default", "granted"));
      await uiLogin(a.page, f, "lamiaa", "573918");
      await expect(a.page.getByTestId("notif-invite")).toBeVisible();
      expect(await asks(a.page)).toBe(0); // rien n'est demandé au téléphone avant le clic
      expect(await noOverflow(a.page)).toBe(true);
      await a.page.screenshot({ path: `${OUT}/notifications-invitation-${s.name}.png` });
      await a.page.getByTestId("notif-invite-dismiss").click();
      await a.page.getByTestId("tab-history").click();
      await a.page.getByTestId("tab-current").click();
      await expect(a.page.getByTestId("notif-invite")).toHaveCount(0);
      await a.page.reload(); // réouverture / mise à jour de l'application : le choix est conservé
      await expect(a.page.getByTestId("edit-list")).toBeVisible();
      await expect(a.page.getByTestId("notif-invite")).toHaveCount(0);
      expect(await asks(a.page)).toBe(0);
      await a.page.evaluate(() => (window as any).__engine.logout());
      await uiLogin(a.page, f, "adil", "482913");
      await expect(a.page.getByTestId("tab-current")).toBeVisible();
      await expect(a.page.getByTestId("notif-invite")).toHaveCount(0); // appareil, pas profil
      await a.page.getByTestId("avatar").click(); // reste activable depuis le profil
      await expect(a.page.getByTestId("notif-enable")).toBeVisible();
      await a.ctx.close();

      // fermeture (✕) : même effet
      const b = await phone(browser, baseURL, s, FAKE_PUSH("default", "granted"));
      await uiLogin(b.page, f, "lamiaa", "573918");
      await b.page.getByTestId("notif-invite-close").click();
      await b.page.reload();
      await expect(b.page.getByTestId("edit-list")).toBeVisible();
      await expect(b.page.getByTestId("notif-invite")).toHaveCount(0);
      await b.ctx.close();

      // refus du téléphone : une seule demande, plus d'invitation, aide seulement sur demande dans le profil
      const c = await phone(browser, baseURL, s, FAKE_PUSH("default", "denied"));
      await uiLogin(c.page, f, "lamiaa", "573918");
      await c.page.getByTestId("notif-invite-enable").click();
      await expect(c.page.getByTestId("notif-invite")).toHaveCount(0);
      expect(await asks(c.page)).toBe(1);
      await c.page.reload();
      await expect(c.page.getByTestId("edit-list")).toBeVisible();
      await expect(c.page.getByTestId("notif-invite")).toHaveCount(0);
      expect(await asks(c.page)).toBe(1); // jamais redemandé
      await c.page.getByTestId("avatar").click();
      await expect(c.page.getByTestId("notif-status")).toHaveAttribute("data-status", "denied");
      await expect(c.page.getByTestId("notif-denied-help")).toHaveCount(0);
      await c.page.getByTestId("notif-howto").click();
      await expect(c.page.getByTestId("notif-denied-help")).toBeVisible();
      expect(await sql("SELECT 1 FROM push_subscriptions s JOIN families fa ON fa.id = s.family_id WHERE fa.code = $1", [f.code])).toEqual([]);
      await c.ctx.close();

      // accord : état réel « activées », plus de bandeau, abonnement enregistré pour cet appareil seulement
      const d = await phone(browser, baseURL, s, FAKE_PUSH("default", "granted"));
      await uiLogin(d.page, f, "lamiaa", "573918");
      await d.page.getByTestId("notif-invite-enable").click();
      await expect(d.page.getByTestId("notif-invite")).toHaveCount(0);
      await d.page.getByTestId("avatar").click();
      await expect(d.page.getByTestId("notif-status")).toHaveAttribute("data-status", "on");
      expect((await sql("SELECT p.login FROM push_subscriptions s JOIN profiles p ON p.id = s.profile_id JOIN families fa ON fa.id = s.family_id WHERE fa.code = $1", [f.code])).map((r) => r.login)).toEqual(["lamiaa"]);
      await d.ctx.close();
    });
  });
}
