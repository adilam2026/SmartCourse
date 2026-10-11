import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";
import { newFamily, uiLogin, type Family } from "./helpers";

/*
 * Accès : connexion à deux parcours, mots de passe choisis à la main, protection de l'administration, récupération par e-mail.
 * L'envoi réel d'e-mails n'est pas testé ici (aucun service d'envoi dans cet environnement) : les liens sont créés en base comme
 * le serveur le fait, puis ouverts dans l'application. Captures dans docs/captures/acces/.
 */
const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const OUT = "../docs/captures/acces";
async function sql(q: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows as any[]; } finally { await c.end(); }
}
const profileId = async (f: Family, login = "adil") => (await sql("SELECT p.id FROM profiles p JOIN families fa ON fa.id = p.family_id WHERE fa.code = $1 AND p.login = $2", [f.code, login]))[0].id as string;
async function link(f: Family, purpose: "verify_email" | "reset_password", email: string, minutes = 30) {
  const token = randomBytes(24).toString("base64url");
  const id = await profileId(f);
  await sql("UPDATE profiles SET recovery_email = $2, recovery_email_verified_at = CASE WHEN $3 = 'reset_password' THEN now() ELSE NULL END WHERE id = $1", [id, email, purpose]);
  await sql("INSERT INTO auth_tokens (purpose, profile_id, email, token_hash, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5))", [purpose, id, email, createHash("sha256").update(token).digest("hex"), minutes]);
  return token;
}
const noOverflow = (page: any) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);

for (const w of [360, 390, 412]) {
  test(`connexion : deux parcours clairement séparés à ${w} px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 844 });
    await page.goto("/");
    const login = page.getByTestId("path-login");
    const setup = page.getByTestId("path-setup");
    await expect(login.getByRole("heading", { name: "Se connecter" })).toBeVisible();
    await expect(login.getByText("Code famille", { exact: true })).toBeVisible();
    await expect(login.getByText("Identifiant", { exact: true })).toBeVisible();
    await expect(login.getByText("Mot de passe", { exact: true })).toBeVisible();
    await expect(login.getByTestId("go-forgot-code")).toHaveText("Code famille oublié ?");
    await expect(login.getByTestId("go-forgot-password")).toHaveText("Mot de passe oublié ?");
    await expect(setup.getByRole("heading", { name: "Première installation" })).toBeVisible();
    await expect(setup.getByTestId("go-setup")).toHaveText("Créer ma famille");
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: `${OUT}/connexion-${w}.png`, fullPage: true });
    await setup.getByTestId("go-setup").click();
    await expect(page.getByText("Mot de passe — 6 caractères")).toBeVisible();
    await expect(page.getByText("Confirmer le mot de passe")).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    if (w === 390) await page.screenshot({ path: `${OUT}/installation-${w}.png`, fullPage: true });
  });
}

test("administration : pas de bouton Désactiver pour un administrateur, rôle du principal protégé ; création avec mot de passe choisi", async ({ page, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await f.adil.post("/api/profiles", { data: { displayName: "Lamiaa 2", login: "lamiaa2", role: "admin", secret: "573918", secretConfirm: "573918" } });
  await uiLogin(page, f, "adil", "482913");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("seg-profiles").click();
  await expect(page.getByTestId("toggle-adil")).toHaveCount(0);
  await expect(page.getByTestId("toggle-lamiaa2")).toHaveCount(0);
  await expect(page.getByTestId("primary-adil")).toContainText("Rôle protégé");
  await expect(page.getByTestId("profile-adil").locator("select")).toHaveCount(0);
  await expect(page.getByTestId("profile-lamiaa2").locator("select")).toHaveCount(1);
  await expect(page.getByTestId(`toggle-${f.staffLogin}`)).toBeVisible();
  // le serveur refuse aussi
  const lam = (await (await f.adil.get("/api/profiles")).json()).profiles.find((p: any) => p.login === "lamiaa2");
  expect((await f.adil.patch(`/api/profiles/${lam.id}`, { data: { active: false } })).status()).toBe(409);
  await page.screenshot({ path: `${OUT}/profils-390.png`, fullPage: true });

  // création : saisie manuelle, confirmation, lettres et symboles acceptés ; rien n'est généré
  await page.getByTestId("add-profile").click();
  await page.getByTestId("np-name").fill("Sara");
  await page.getByTestId("np-login").fill("sara");
  await page.getByTestId("np-role").selectOption("parent");
  await expect(page.getByText("Mot de passe — 6 caractères")).toBeVisible();
  await expect(page.getByText("Confirmer le mot de passe")).toBeVisible();
  await page.getByTestId("np-secret").fill("Ab3$xy");
  await page.getByTestId("np-secret2").fill("Ab3$xz");
  await expect(page.getByTestId("np-mismatch")).toBeVisible();
  await expect(page.getByTestId("np-submit")).toBeDisabled();
  await page.screenshot({ path: `${OUT}/nouveau-profil-390.png` });
  await page.getByTestId("np-secret2").fill("Ab3$xy");
  await page.getByTestId("np-submit").click();
  await expect(page.getByTestId("settings-notice")).toContainText("Sara");
  const ok = await playwright.request.newContext({ baseURL });
  expect((await ok.post("/api/auth/login", { data: { familyCode: f.code, login: "sara", secret: "Ab3$xy" } })).status()).toBe(200);

  // « Modifier le mot de passe » : deux champs, l'ancien reste inaccessible, sessions révoquées
  await expect(page.getByTestId("reset-sara")).toHaveText("Modifier le mot de passe");
  await page.getByTestId("reset-sara").click();
  await expect(page.getByTestId("pw-secret")).toHaveValue("");
  await page.getByTestId("pw-secret").fill("Zz9#qq");
  await page.getByTestId("pw-secret2").fill("Zz9#qq");
  await page.screenshot({ path: `${OUT}/modifier-mot-de-passe-390.png` });
  await page.getByTestId("pw-submit").click();
  await expect(page.getByTestId("settings-notice")).toContainText("modifié");
  expect((await ok.get("/api/me")).status()).toBe(401);
  const again = await playwright.request.newContext({ baseURL });
  expect((await again.post("/api/auth/login", { data: { familyCode: f.code, login: "sara", secret: "Ab3$xy" } })).status()).toBe(401);
  expect((await again.post("/api/auth/login", { data: { familyCode: f.code, login: "sara", secret: "Zz9#qq" } })).status()).toBe(200);
});

test("adresse de récupération : réglages, lien de vérification ouvrant SmartCourse, état honnête de l'envoi", async ({ page, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await uiLogin(page, f, "adil", "482913");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("seg-recovery").click();
  await expect(page.getByTestId("recovery-state")).toContainText("Aucune adresse");
  await expect(page.getByTestId("recovery-unconfigured")).toBeVisible(); // pas de service d'envoi dans cet environnement
  await page.getByTestId("recovery-input").fill("adil@example.org");
  await page.getByTestId("recovery-save").click();
  await expect(page.getByTestId("recovery-state")).toContainText("À vérifier");
  await expect(page.getByTestId("recovery-lastmail")).toContainText("non configuré"); // jamais « envoyé » à tort
  await page.screenshot({ path: `${OUT}/recuperation-390.png`, fullPage: true });
  // lien reçu par e-mail : ouvre SmartCourse
  const token = await link(f, "verify_email", "adil@example.org", 60 * 24);
  await page.goto(`/#/verify/${token}`);
  await expect(page.getByTestId("link-ok")).toContainText("Adresse confirmée");
  await page.screenshot({ path: `${OUT}/lien-verification-390.png` });
  await page.getByTestId("link-continue").click();
  expect(new URL(page.url()).hash).toBe(""); // le jeton ne reste pas dans l'adresse
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("seg-recovery").click();
  await expect(page.getByTestId("recovery-state")).toContainText("vérifiée");
  // lien déjà utilisé
  await page.goto(`/#/verify/${token}`);
  await expect(page.getByTestId("link-bad")).toBeVisible();
});

test("récupération : code famille et mot de passe oubliés (réponse neutre), nouveau mot de passe par lien à usage unique", async ({ page, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await page.goto("/");
  await page.getByTestId("go-forgot-code").click();
  await page.getByTestId("forgot-email").fill("inconnu@example.org");
  await page.getByTestId("forgot-submit").click();
  await expect(page.getByTestId("forgot-sent")).toContainText("Si cette adresse est enregistrée et vérifiée");
  await page.getByTestId("forgot-back").click();
  await page.getByTestId("go-forgot-password").click();
  await page.getByTestId("forgot-email").fill("inconnu@example.org");
  await page.getByTestId("forgot-submit").click();
  await expect(page.getByTestId("forgot-sent")).toContainText("Si cette adresse est enregistrée et vérifiée");
  await page.screenshot({ path: `${OUT}/mot-de-passe-oublie-390.png` });

  const session = await playwright.request.newContext({ baseURL });
  await session.post("/api/auth/login", { data: { familyCode: f.code, login: "adil", secret: "482913" } });
  expect((await session.get("/api/me")).status()).toBe(200);
  const token = await link(f, "reset_password", "adil@example.org");
  await page.goto(`/#/reset/${token}`);
  await expect(page.getByText("Nouveau mot de passe — 6 caractères")).toBeVisible();
  await page.getByTestId("reset-new").fill("Ab3$xy");
  await page.getByTestId("reset-confirm").fill("Ab3$xz");
  await expect(page.getByTestId("reset-submit")).toBeDisabled();
  await page.getByTestId("reset-confirm").fill("Ab3$xy");
  await page.screenshot({ path: `${OUT}/nouveau-mot-de-passe-390.png` });
  await page.getByTestId("reset-submit").click();
  await expect(page.getByTestId("reset-saved")).toBeVisible();
  expect((await session.get("/api/me")).status()).toBe(401); // sessions révoquées
  await page.getByTestId("link-continue").click();
  await uiLogin(page, f, "adil", "Ab3$xy");
  await expect(page.getByTestId("tab-settings")).toBeVisible();
  // le lien ne sert qu'une fois
  await page.goto(`/#/reset/${token}`);
  await expect(page.getByTestId("link-bad")).toBeVisible();
});
