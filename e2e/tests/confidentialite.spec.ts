import { devices, expect, test, type Page } from "@playwright/test";
import { expectNoInfra, newFamily, uiLogin } from "./helpers";

const OUT = "../docs/captures/play";
const { defaultBrowserType: _d, ...IPHONE } = devices["iPhone 14"];

test.describe("politique de confidentialité et suppression de compte (pages publiques)", () => {
  test("accessible sans connexion, complète, jamais dans le cache du service worker", async ({ page, context, baseURL }) => {
    // sans aucune session : la page est publique, relue à chaque fois
    const r = await context.request.get("/confidentialite.html");
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toBe("no-store");
    expect((await context.request.get("/confidentialite")).status()).toBe(200);
    expect((await context.request.get("/suppression-compte")).status()).toBe(200);
    await page.goto("/confidentialite.html");
    const text = await page.locator("main").innerText();
    for (const part of ["Données enregistrées", "Prestataires techniques", "Conservation et sauvegardes", "Supprimer vos données", "Vos droits", "Railway", "Brevo", "Firebase", "7 jours, 4 semaines, 3 mois", "user agent", "adresse IP", "Supprimer mon compte", "Ancien profil"]) expect(text, part).toContain(part);
    // aucune adresse de contact inventée : tant qu'elle n'est pas renseignée, la page le dit
    expect(text).toContain("pas encore renseigné");
    expect(text).not.toMatch(/@(?!example)[a-z0-9.-]+\.[a-z]{2,}/i);
    await page.screenshot({ path: `${OUT}/confidentialite.png`, fullPage: true });

    // le service worker est en place, et ni la page ni son contenu n'y sont gardés
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const k of await caches.keys()) for (const q of await (await caches.open(k)).keys()) urls.push(q.url);
      return urls;
    });
    expect(cached.length).toBeGreaterThan(0);
    expect(cached.filter((u) => /confidentialite|suppression-compte/.test(u))).toEqual([]);
    const resp = await page.goto("/confidentialite.html");
    expect(resp!.fromServiceWorker()).toBe(false);
    // hors connexion : la page n'est pas servie par le cache (elle est toujours lue sur le serveur)
    await context.setOffline(true);
    const off = await page.goto("/confidentialite.html").catch((e) => e);
    expect(off instanceof Error || (off && typeof off.ok === "function" && !off.ok())).toBe(true);
    await context.setOffline(false);
  });

  for (const [name, opts] of [["android", {}], ["iphone", IPHONE]] as const) {
    test(`suppression d'un seul compte depuis la page publique — ${name} : la famille et les autres profils restent`, async ({ browser, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      const ctx = await browser.newContext({ ...opts, baseURL });
      const page = await ctx.newPage();
      await page.goto("/suppression-compte.html");
      await expect(page.locator("h1")).toHaveText("Supprimer mon compte Courses");
      await expect(page.locator("#go")).toBeDisabled();
      expect(await page.locator("#secret").getAttribute("inputmode")).toBe("numeric");
      await page.screenshot({ path: `${OUT}/suppression-compte-${name}.png`, fullPage: true });
      // mauvais code : message simple, rien n'est supprimé
      await page.fill("#code", f.code.toLowerCase());
      await page.fill("#login", f.staffLogin);
      await page.fill("#secret", "000000");
      await page.check("#sure");
      await page.click("#go");
      await expect(page.locator("#err")).toContainText("Identifiants incorrects");
      await expectNoInfra(page);
      expect((await playwright.request.newContext({ baseURL }).then((c) => c.post("/api/auth/login", { data: { familyCode: f.code, login: f.staffLogin, secret: "573918" } }))).status()).toBe(200);
      // profil principal : refusé avec une explication
      await page.fill("#login", "adil");
      await page.fill("#secret", "482913");
      await page.click("#go");
      await expect(page.locator("#err")).toContainText("profil principal");
      // le bon profil
      await page.fill("#login", f.staffLogin);
      await page.fill("#secret", "573918");
      await page.click("#go");
      await expect(page.locator("#done")).toContainText("Votre compte a été supprimé");
      await page.screenshot({ path: `${OUT}/suppression-compte-faite-${name}.png`, fullPage: true });
      const c2 = await playwright.request.newContext({ baseURL });
      expect((await c2.post("/api/auth/login", { data: { familyCode: f.code, login: f.staffLogin, secret: "573918" } })).status()).toBe(401);
      expect((await c2.post("/api/auth/login", { data: { familyCode: f.code, login: "lamiaa", secret: "573918" } })).status()).toBe(200); // la famille et les autres profils sont intacts
      expect((await c2.post("/api/auth/login", { data: { familyCode: f.code, login: "adil", secret: "482913" } })).status()).toBe(200);
      await ctx.close();
    });
  }

  test("dans l'application : « Supprimer mon compte » (personnel), jamais pour le profil principal ; un administrateur supprime le profil d'un parent", async ({ page, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    // le profil principal : une explication, pas de bouton
    await uiLogin(page, f, "adil", "482913");
    await page.getByTestId("avatar").click();
    await expect(page.getByTestId("delete-account")).toHaveCount(0);
    await expect(page.getByTestId("delete-account-primary")).toContainText("supprimez toute la famille");
    await page.getByRole("button", { name: "Fermer" }).click();
    // un administrateur supprime un profil de parent
    await page.getByTestId("tab-settings").click();
    await page.getByTestId("seg-profiles").click();
    await page.getByTestId("edit-lamiaa").click();
    await page.getByTestId("delete-lamiaa").click();
    await expect(page.getByTestId("delete-confirm")).toContainText("Ancien profil");
    await page.getByTestId("delete-confirm-lamiaa").click();
    await expect(page.getByTestId("profile-lamiaa")).toHaveCount(0);
    expect((await (await playwright.request.newContext({ baseURL })).post("/api/auth/login", { data: { familyCode: f.code, login: "lamiaa", secret: "573918" } })).status()).toBe(401);
    // le personnel supprime son propre compte
    await page.context().clearCookies();
    await uiLogin(page, f);
    await page.getByTestId("avatar").click();
    await page.getByTestId("delete-account").click();
    await page.getByTestId("delete-account-secret").fill("111222");
    await page.getByTestId("delete-account-submit").click();
    await expect(page.getByTestId("delete-account-error")).toContainText("Mot de passe incorrect");
    await page.getByTestId("delete-account-secret").fill("573918");
    await page.getByTestId("delete-account-submit").click();
    await expect(page.getByTestId("login-submit")).toBeVisible();
    expect((await (await playwright.request.newContext({ baseURL })).post("/api/auth/login", { data: { familyCode: f.code, login: f.staffLogin, secret: "573918" } })).status()).toBe(401);
    expect((await f.adil.get("/api/me")).status()).toBe(200); // la famille continue
  });
});
