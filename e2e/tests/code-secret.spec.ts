import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";
import { devices, expect, test, type Page } from "@playwright/test";
import { newFamily, uiLogin } from "./helpers";

/*
 * Code secret à 6 chiffres choisi à la main : clavier numérique, saisie masquée, exactement 6 chiffres, zéros initiaux conservés,
 * rien de généré ni suggéré par le téléphone ; anciens mots de passe (lettres, symboles) toujours acceptés à la connexion avec bascule
 * vers le clavier complet. Joué en profil Android (Pixel 7) et iPhone (iPhone 14, émulé dans Chromium : le clavier réel du système n'est
 * pas vérifiable ici — on contrôle les attributs que le système lit pour choisir le clavier).
 */
const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const OUT = "../docs/captures/acces";
const { defaultBrowserType: _ignored, ...iphone14 } = devices["iPhone 14"];
const PROFILES: [string, object][] = [["android", {}], ["iphone", iphone14]];

async function sql(q: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows as any[]; } finally { await c.end(); }
}
/** Hash au format de l'application, pour un ANCIEN mot de passe (lettres, symboles) qu'on ne peut plus choisir. */
const legacyHash = (secret: string) => {
  const salt = randomBytes(16);
  return `scrypt$1024$8$1$${salt.toString("base64")}$${scryptSync(secret, salt, 32, { N: 1024, r: 8, p: 1 }).toString("base64")}`;
};
const attrs = (page: Page, id: string) => page.getByTestId(id).evaluate((e: HTMLInputElement) => ({ type: e.type, inputmode: e.inputMode, maxlength: e.maxLength, autocomplete: e.autocomplete, pattern: e.getAttribute("pattern") }));
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);

for (const [name, device] of PROFILES) {
  test.describe(`code secret — ${name}`, () => {
    test.use(device);

    test("connexion : clavier numérique d'abord, bascule vers le clavier complet ; un ancien mot de passe à lettres fonctionne", async ({ page, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      const legacy = "Ab3$xy";
      const famId = (await sql("SELECT id FROM families WHERE code = $1", [f.code]))[0].id;
      await sql("INSERT INTO profiles (family_id, display_name, login, role, secret_hash) VALUES ($1,'Ancien','ancien','parent',$2)", [famId, legacyHash(legacy)]);
      await page.goto("/");
      expect(await attrs(page, "login-secret")).toMatchObject({ type: "password", inputmode: "numeric", maxlength: 6, autocomplete: "current-password" });
      await expect(page.getByTestId("login-secret-kb")).toHaveText("Clavier complet");
      await page.screenshot({ path: `${OUT}/connexion-clavier-${name}.png` });
      await page.getByTestId("login-secret-kb").click();
      expect((await attrs(page, "login-secret")).inputmode).toBe("text");
      await expect(page.getByTestId("login-secret-kb")).toHaveText("Clavier numérique");
      await page.getByTestId("login-secret-kb").click();
      expect((await attrs(page, "login-secret")).inputmode).toBe("numeric");
      // l'ancien mot de passe (lettres + symbole) : bascule vers le clavier complet puis connexion
      await page.getByTestId("login-family").fill(f.code);
      await page.getByTestId("login-id").fill("ancien");
      await page.getByTestId("login-secret-kb").click();
      await page.getByTestId("login-secret").fill(legacy);
      await expect(page.getByTestId("login-secret")).toHaveValue(legacy);
      await page.getByTestId("login-submit").click();
      await expect(page.getByTestId("tab-current")).toBeVisible();
      // un code à 6 chiffres existant fonctionne toujours
      await page.context().clearCookies();
      await uiLogin(page, f, "adil", "482913");
      await expect(page.getByTestId("tab-settings")).toBeVisible();
      // aucun accès existant n'a été modifié d'office
      expect((await sql("SELECT secret_hash FROM profiles WHERE login = 'ancien' AND family_id = $1", [famId]))[0].secret_hash.startsWith("scrypt$1024$")).toBe(true);
    });

    test("première installation : « Code secret — 6 chiffres » / « Confirmer le code secret », chiffres seulement, 6 maximum, zéros conservés, masqué", async ({ page }) => {
      await page.goto("/");
      await page.getByTestId("go-setup").click();
      await expect(page.getByText("Code secret — 6 chiffres")).toBeVisible();
      await expect(page.getByText("Confirmer le code secret")).toBeVisible();
      for (const id of ["setup-secret", "setup-again"]) expect(await attrs(page, id)).toMatchObject({ type: "password", inputmode: "numeric", maxlength: 6, autocomplete: "off", pattern: "[0-9]*" }); // « off » : jamais de mot de passe suggéré ou généré
      await expect(page.getByTestId("setup-secret-kb")).toHaveCount(0); // pas de clavier complet pour un NOUVEAU code
      const secret = page.getByTestId("setup-secret");
      await secret.pressSequentially("ab1c2d3");
      await expect(secret).toHaveValue("123"); // les lettres sont ignorées
      await secret.fill("");
      await secret.pressSequentially("00421399");
      await expect(secret).toHaveValue("004213"); // 6 chiffres au plus, zéros initiaux conservés
      await page.getByTestId("setup-again").pressSequentially("004214");
      await expect(page.getByText("Les deux codes secrets ne sont pas identiques.")).toBeVisible();
      await page.getByTestId("setup-again").fill("");
      await page.getByTestId("setup-again").pressSequentially("004213");
      await expect(page.getByText("Les deux codes secrets ne sont pas identiques.")).toHaveCount(0);
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/installation-code-${name}.png`, fullPage: true });
    });

    test("nouveau profil et changement de code : mêmes règles ; zéro initial conservé jusqu'à la connexion ; ancien mot de passe d'un profil non modifié", async ({ page, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-settings").click();
      await page.getByTestId("seg-profiles").click();
      await page.getByTestId("add-profile").click();
      await expect(page.getByText("Code secret — 6 chiffres")).toBeVisible();
      await expect(page.getByText("Confirmer le code secret")).toBeVisible();
      for (const id of ["np-secret", "np-secret2"]) expect(await attrs(page, id)).toMatchObject({ type: "password", inputmode: "numeric", maxlength: 6, autocomplete: "off" });
      await page.getByTestId("np-name").fill("Sara");
      await page.getByTestId("np-login").fill("sara");
      await page.getByTestId("np-role").selectOption("parent");
      await page.getByTestId("np-secret").pressSequentially("00A731");
      await expect(page.getByTestId("np-secret")).toHaveValue("00731");
      await expect(page.getByTestId("np-submit")).toBeDisabled(); // 5 chiffres seulement
      await page.getByTestId("np-secret").pressSequentially("9");
      await expect(page.getByTestId("np-secret")).toHaveValue("007319");
      await page.getByTestId("np-secret2").pressSequentially("007318");
      await expect(page.getByTestId("np-submit")).toBeDisabled(); // confirmation différente
      await page.getByTestId("np-secret2").fill("");
      await page.getByTestId("np-secret2").pressSequentially("007319");
      await page.screenshot({ path: `${OUT}/nouveau-profil-code-${name}.png` });
      await page.getByTestId("np-submit").click();
      await expect(page.getByTestId("settings-notice")).toContainText("code secret");
      const ok = await playwright.request.newContext({ baseURL });
      expect((await ok.post("/api/auth/login", { data: { familyCode: f.code, login: "sara", secret: "007319" } })).status()).toBe(200);
      expect((await ok.post("/api/auth/login", { data: { familyCode: f.code, login: "sara", secret: "7319" } })).status()).toBeGreaterThanOrEqual(400);
      // changement de code
      await page.getByTestId("reset-sara").click();
      await expect(page.getByText("Code secret — 6 chiffres")).toBeVisible();
      for (const id of ["pw-secret", "pw-secret2"]) expect(await attrs(page, id)).toMatchObject({ inputmode: "numeric", maxlength: 6, autocomplete: "off" });
      await page.getByTestId("pw-secret").pressSequentially("000941");
      await page.getByTestId("pw-secret2").pressSequentially("000941");
      await page.getByTestId("pw-submit").click();
      await expect(page.getByTestId("settings-notice")).toContainText("modifié");
      const again = await playwright.request.newContext({ baseURL });
      expect((await again.post("/api/auth/login", { data: { familyCode: f.code, login: "sara", secret: "007319" } })).status()).toBe(401);
      expect((await again.post("/api/auth/login", { data: { familyCode: f.code, login: "sara", secret: "000941" } })).status()).toBe(200);
      // le serveur refuse aussi une saisie qui contournerait l'interface
      const sara = (await (await f.adil.get("/api/profiles")).json()).profiles.find((p: any) => p.login === "sara");
      for (const secret of ["Ab3$xy", "12345", "1234567", "111111"]) expect((await f.adil.post(`/api/profiles/${sara.id}/reset-secret`, { data: { secret, secretConfirm: secret } })).status()).toBe(400);
    });

    test("confirmation du mot de passe actuel (suppression de la famille) : clavier numérique d'abord, bascule vers le clavier complet", async ({ page, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await uiLogin(page, f, "adil", "482913");
      await page.getByTestId("tab-settings").click();
      await page.getByTestId("seg-reset").click();
      expect(await attrs(page, "reset-password")).toMatchObject({ type: "password", inputmode: "numeric", autocomplete: "current-password" });
      await page.getByTestId("reset-password-kb").click();
      expect((await attrs(page, "reset-password")).inputmode).toBe("text");
      await expect(page.getByTestId("reset-password-kb")).toHaveText("Clavier numérique");
    });
  });
}
