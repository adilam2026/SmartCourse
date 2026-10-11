import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";
import { linkTokenFor, mailsTo, newFamily, uiLogin, type Family } from "./helpers";

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

test("adresse de récupération : réglages, changement d'adresse, lien reçu qui ouvre SmartCourse, e-mail de test, état honnête de l'envoi", async ({ page, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await uiLogin(page, f, "adil", "482913");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("seg-recovery").click();
  await expect(page.getByTestId("recovery-state")).toContainText("vérifiée"); // vérifiée à l'installation
  await expect(page.getByTestId("recovery-email")).toHaveText(f.email);
  await expect(page.getByTestId("recovery-unconfigured")).toHaveCount(0); // l'envoi est configuré
  // e-mail de test : réponse réelle du service, « accepté » n'est pas « reçu »
  await page.getByTestId("recovery-test").click();
  await expect(page.getByTestId("mail-ok")).toContainText("accepté par le service d'envoi");
  await expect(page.getByTestId("mail-ok")).toContainText("réception dans la boîte n'est pas confirmée");
  expect((await mailsTo(f.email)).some((m) => m.subject.includes("test"))).toBe(true);
  // nouvelle adresse : à vérifier tant que le lien n'est pas ouvert
  const next = `adil${randomBytes(5).toString("hex")}@example.org`;
  await page.getByTestId("recovery-input").fill(next);
  await page.getByTestId("recovery-save").click();
  await expect(page.getByTestId("recovery-state")).toContainText("À vérifier");
  await expect(page.getByTestId("mail-ok")).toContainText("accepté");
  await page.screenshot({ path: `${OUT}/recuperation-390.png`, fullPage: true });
  const token = await linkTokenFor(next, "verify");
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

test("récupération : code famille et mot de passe oubliés par e-mail réel (code reçu, lien à usage unique, ancien mot de passe jamais envoyé)", async ({ page, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await page.goto("/");
  // adresse inconnue : même réponse, aucun e-mail
  await page.getByTestId("go-forgot-code").click();
  await page.getByTestId("forgot-email").fill("inconnu@example.org");
  await page.getByTestId("forgot-submit").click();
  await expect(page.getByTestId("forgot-sent")).toContainText("Si cette adresse est enregistrée et vérifiée");
  expect(await mailsTo("inconnu@example.org")).toEqual([]);
  await page.getByTestId("forgot-back").click();
  // code famille oublié : le vrai code arrive à l'adresse vérifiée
  await page.getByTestId("go-forgot-code").click();
  await page.getByTestId("forgot-email").fill(f.email);
  await page.getByTestId("forgot-submit").click();
  await expect(page.getByTestId("forgot-sent")).toBeVisible();
  await expect.poll(async () => (await mailsTo(f.email)).some((m) => m.text.includes(f.code))).toBe(true);
  expect((await mailsTo(f.email)).map((m) => m.text).join("\n")).not.toContain("482913"); // jamais un mot de passe
  await page.getByTestId("forgot-back").click();
  // mot de passe oublié
  await page.getByTestId("go-forgot-password").click();
  await page.getByTestId("forgot-email").fill(f.email);
  await page.getByTestId("forgot-family").fill(f.code);
  await page.getByTestId("forgot-submit").click();
  await expect(page.getByTestId("forgot-sent")).toContainText("Si cette adresse est enregistrée et vérifiée");
  await page.screenshot({ path: `${OUT}/mot-de-passe-oublie-390.png` });
  const session = await playwright.request.newContext({ baseURL });
  await session.post("/api/auth/login", { data: { familyCode: f.code, login: "adil", secret: "482913" } });
  expect((await session.get("/api/me")).status()).toBe(200);
  const token = await linkTokenFor(f.email, "reset");
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
  await page.goto(`/#/reset/${token}`);
  await expect(page.getByTestId("link-bad")).toBeVisible(); // usage unique
});

test("e-mail refusé : « E-mail non envoyé » avec la cause, jamais « ouvrez le lien reçu » ; réessayer ; diagnostic de la clé et de l'expéditeur", async ({ page, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  const causes: [string, string, string, string][] = [
    ["401", "unauthorized", "Key not found", "clé API refusée par Brevo"],
    ["401", "unauthorized", "We have detected you are using an unrecognised IP address 1.2.3.4", "bloque l'adresse du serveur"],
    ["403", "permission_denied", "Your account is not yet activated", "compte Brevo non autorisé"],
  ];
  await uiLogin(page, f, "adil", "482913");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("seg-recovery").click();
  const next = `adil${randomBytes(5).toString("hex")}@example.org`;
  try {
    for (const [status, code, msg, title] of causes) {
      await fetch(`http://127.0.0.1:3199/__fail?on=1&status=${status}&code=${code}&msg=${encodeURIComponent(msg)}`, { method: "POST" });
      await page.getByTestId("recovery-input").fill(next);
      await page.getByTestId("recovery-save").click();
      await expect(page.getByTestId("recovery-state")).toContainText("E-mail non envoyé");
      await expect(page.getByTestId("recovery-state")).not.toContainText("ouvrez le lien");
      await expect(page.getByTestId("mail-title")).toContainText(title);
      await expect(page.getByTestId("mail-detail")).toContainText(`HTTP ${status} ${code}`);
      await expect(page.getByTestId("recovery-resend")).toHaveText("Réessayer l'envoi");
    }
    await page.screenshot({ path: `${OUT}/email-refuse-390.png`, fullPage: true });
    // diagnostic : expéditeur absent des expéditeurs validés
    await fetch("http://127.0.0.1:3199/__senders?list=autre%40example.org", { method: "POST" });
    await page.getByTestId("mail-diagnose").click();
    await expect(page.getByTestId("mail-checks")).toContainText("n'est pas un expéditeur de ce compte Brevo");
    await page.screenshot({ path: `${OUT}/diagnostic-envoi-390.png`, fullPage: true });
    // la cause est corrigée : réessayer fonctionne, sans recréer quoi que ce soit
    await fetch("http://127.0.0.1:3199/__fail?on=0", { method: "POST" });
    await fetch("http://127.0.0.1:3199/__senders?list=noreply%40smartcourse.test", { method: "POST" });
    await page.getByTestId("recovery-resend").click();
    await expect(page.getByTestId("mail-ok")).toContainText("accepté par le service d'envoi");
    await expect(page.getByTestId("recovery-state")).toContainText("À vérifier : ouvrez le lien reçu");
    await page.getByTestId("mail-diagnose").click();
    await expect(page.getByTestId("mail-checks")).toContainText("est un expéditeur validé");
  } finally {
    await fetch("http://127.0.0.1:3199/__fail?on=0", { method: "POST" });
    await fetch("http://127.0.0.1:3199/__senders?list=noreply%40smartcourse.test", { method: "POST" });
  }
});
