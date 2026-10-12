import { devices, expect, test, type Page } from "@playwright/test";
import { expectNoInfra, installLink, newFamily, openInstall, uiLogin, pickCity } from "./helpers";

const { defaultBrowserType: _d, ...IPHONE } = devices["iPhone 14"];
const OUT = "../docs/captures/nettoyage";
const profiles = [{ name: "android", opts: {} }, { name: "iphone", opts: IPHONE }];

for (const p of profiles) {
  test.describe(`nettoyage de l'interface — ${p.name}`, () => {
    test.use(p.opts);

    test("installation par lien : aucun champ ni mot « jeton » ; chaque champ une seule fois ; autorisation absente ou refusée expliquée", async ({ page, browser, baseURL }) => {
      // sans lien : une explication et une action, jamais un champ technique
      await page.goto("/");
      await page.getByTestId("go-setup").click();
      await expect(page.getByTestId("setup-blocked")).toContainText("Un lien d'installation est nécessaire");
      await expect(page.getByTestId("setup-family")).toHaveCount(0);
      await expect(page.getByTestId("setup-token")).toHaveCount(0);
      await expectNoInfra(page);
      await page.screenshot({ path: `${OUT}/installation-sans-lien-${p.name}.png`, fullPage: true });
      await page.getByTestId("setup-back").click();
      await expect(page.getByTestId("login-submit")).toBeVisible();

      // avec un lien : le formulaire, sans champ d'autorisation, chaque champ une seule fois
      await openInstall(page);
      await expect(page.locator("main label")).toHaveText([/Nom de la famille/, /Votre nom affiché/, /Votre identifiant/, /Code secret — 6 chiffres/, /Confirmer le code secret/, /Ville/, /E-mail de récupération/]);
      for (const id of ["setup-family", "setup-name", "setup-login", "setup-secret", "setup-again", "setup-city-input", "setup-email"]) await expect(page.getByTestId(id)).toHaveCount(1);
      await expectNoInfra(page);
      expect(page.url()).not.toMatch(/install\//);
      await page.screenshot({ path: `${OUT}/installation-${p.name}.png`, fullPage: true });

      // lien déjà utilisé / expiré : explication simple, aucun champ ; le serveur refuse vraiment
      const { token } = await installLink();
      const other = await browser.newContext({ ...p.opts, baseURL });
      const used = await other.newPage();
      await used.goto("/");
      await used.goto(`/#/install/${token}`);
      await used.request.post("/api/setup/family", { data: { installToken: token, familyName: "A", admin: { displayName: "A", login: "aa", secret: "482913", secretConfirm: "482913", recoveryEmail: "a@example.org" } } }); // consomme l'autorisation (envoi du mail simulé)
      await used.getByTestId("setup-family").fill("Famille Deux");
      await used.getByTestId("setup-name").fill("Adil");
      await used.getByTestId("setup-login").fill("adilb");
      await used.getByTestId("setup-secret").fill("482913");
      await used.getByTestId("setup-again").fill("482913");
      await pickCity(used, "setup-city", "Fès");
      await used.getByTestId("setup-email").fill("deux@example.org");
      await used.getByTestId("setup-submit").click();
      await expect(used.getByTestId("setup-blocked")).toContainText("Ce lien d'installation n'est plus valable");
      await expect(used.getByTestId("setup-blocked")).toContainText("Demandez un nouveau lien");
      await expectNoInfra(used);
      await used.screenshot({ path: `${OUT}/installation-lien-refuse-${p.name}.png`, fullPage: true });
      await other.close();
    });

    test("À propos : seulement l'état de mise à jour ; réglages sans information technique ; erreurs sans infrastructure", async ({ page, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-settings").click();
      for (const seg of ["seg-about", "seg-backups", "seg-profiles", "seg-recovery", "seg-reset", "seg-notifications"]) {
        await page.getByTestId(seg).click();
        await expect(page.locator("main, .app, body").first()).toBeVisible();
        await expectNoInfra(page);
        if (seg === "seg-about") {
          await expect(page.getByTestId("version-status")).toHaveText("Application à jour");
          await expect(page.getByTestId("update-check")).toHaveText("Vérifier les mises à jour");
          const text = await page.locator("main, .app, body").first().innerText();
          expect(text).not.toMatch(/[0-9a-f]{7,}|build|commit|Casablanca|fuseau|serveur/i);
          await page.screenshot({ path: `${OUT}/a-propos-${p.name}.png` });
        }
        if (seg === "seg-backups") await page.screenshot({ path: `${OUT}/sauvegarde-${p.name}.png` });
        await page.getByTestId("settings-back").click();
      }
      // une erreur du serveur n'affiche jamais son contenu brut
      await page.route("**/api/profiles", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal_error", message: "SQL error connect ECONNREFUSED 10.1.2.3" }) }));
      await page.getByTestId("seg-profiles").click();
      await expect(page.locator(".error, .empty").first()).toContainText(/Réessayez|problème|connexion/i);
      await expectNoInfra(page);
      await expect(page.locator("body")).not.toContainText(/ECONN|SQL|10\.1\.2\.3|500/);
    });
  });
}
