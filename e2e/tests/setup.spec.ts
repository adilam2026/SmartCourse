import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { linkTokenFor, MOCK } from "./helpers";

test("première installation : jeton à usage unique → famille créée → connecté en administrateur", async ({ page, playwright, baseURL }) => {
  const token = randomBytes(24).toString("base64url");
  const c = new pg.Client({ connectionString: "postgres://smart:smart@localhost:5432/smartcourse_e2e" });
  await c.connect();
  await c.query("INSERT INTO install_tokens (token_hash) VALUES ($1)", [createHash("sha256").update(token).digest("hex")]);
  await c.end();

  await page.goto("/");
  await page.getByTestId("go-setup").click();
  await page.getByTestId("setup-token").fill(token);
  await page.getByTestId("setup-family").fill("Famille Test");
  await page.getByTestId("setup-name").fill("Adil");
  await page.getByTestId("setup-login").fill("adil");
  await page.getByTestId("setup-secret").fill("482913");
  await page.getByTestId("setup-again").fill("482913");
  const email = `adil${randomBytes(5).toString("hex")}@example.org`;
  await expect(page.getByTestId("setup-submit")).toBeDisabled(); // l'adresse de récupération est obligatoire
  await page.getByTestId("setup-email").fill(email);
  await page.screenshot({ path: "shots/setup.png" });
  await page.getByTestId("setup-submit").click();
  // installation inachevée : écran d'attente, rien d'autre n'est accessible
  await expect(page.getByTestId("setup-verify")).toBeVisible();
  await expect(page.getByTestId("verify-address")).toHaveText(email);
  await expect(page.getByTestId("verify-status")).toContainText("accepté");
  await expect(page.getByTestId("tab-settings")).toHaveCount(0);
  // le lien est ouvert AILLEURS (autre appareil) : l'écran d'attente se termine tout seul
  const other = await page.context().browser()!.newContext();
  const p2 = await other.newPage();
  await p2.goto(`${baseURL}/#/verify/${await linkTokenFor(email, "verify")}`);
  await expect(p2.getByTestId("link-ok")).toBeVisible();
  await other.close();
  const code = await page.getByTestId("setup-family-code").innerText({ timeout: 15_000 });
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  await page.getByTestId("welcome-continue").click();
  await expect(page.getByTestId("tab-settings")).toBeVisible(); // connecté en administrateur

  // le jeton est consommé : une seconde création avec le même jeton est refusée
  const again = await playwright.request.newContext({ baseURL });
  const r = await again.post("/api/setup/family", { data: { installToken: token, familyName: "Autre", admin: { displayName: "X", login: "xx", secret: "482913", secretConfirm: "482913", recoveryEmail: "x@example.org" } } });
  expect(r.status()).toBe(403);
});

test("installation : échec d'envoi → on réessaie ou on change l'adresse sans recréer la famille ; jamais de compte inutilisable", async ({ page, baseURL }) => {
  const token = randomBytes(24).toString("base64url");
  const c = new pg.Client({ connectionString: "postgres://smart:smart@localhost:5432/smartcourse_e2e" });
  await c.connect();
  await c.query("INSERT INTO install_tokens (token_hash) VALUES ($1)", [createHash("sha256").update(token).digest("hex")]);
  await c.end();
  await fetch(`${MOCK}/__fail?on=1`, { method: "POST" });
  try {
    await page.goto("/");
    await page.getByTestId("go-setup").click();
    await page.getByTestId("setup-token").fill(token);
    await page.getByTestId("setup-family").fill("Famille Retry");
    await page.getByTestId("setup-name").fill("Adil");
    await page.getByTestId("setup-login").fill("adil");
    await page.getByTestId("setup-secret").fill("482913");
    await page.getByTestId("setup-again").fill("482913");
    const typo = `adil${randomBytes(5).toString("hex")}@exmaple.org`;
    await page.getByTestId("setup-email").fill(typo);
    await page.getByTestId("setup-submit").click();
    await expect(page.getByTestId("setup-verify")).toBeVisible(); // la famille existe, en attente
    await expect(page.getByTestId("verify-status")).toContainText("n'a pas pu être envoyé");
    await page.screenshot({ path: "../docs/captures/acces/installation-echec-envoi-390.png" });
    await page.getByTestId("verify-resend").click();
    await expect(page.getByTestId("verify-status")).toContainText("n'a pas pu être envoyé"); // toujours en panne : on peut réessayer, encore et encore
    await fetch(`${MOCK}/__fail?on=0`, { method: "POST" });
    const fixed = `adil${randomBytes(5).toString("hex")}@example.org`;
    await page.getByTestId("verify-change").click();
    await page.getByTestId("verify-new-email").fill(fixed);
    await page.getByTestId("verify-new-save").click();
    await expect(page.getByTestId("verify-address")).toHaveText(fixed);
    await expect(page.getByTestId("verify-status")).toContainText("accepté");
    const other = await page.context().browser()!.newContext();
    const p2 = await other.newPage();
    await p2.goto(`${baseURL}/#/verify/${await linkTokenFor(fixed, "verify")}`);
    await expect(p2.getByTestId("link-ok")).toBeVisible();
    await other.close();
    await expect(page.getByTestId("setup-family-code")).toBeVisible({ timeout: 15_000 });
    // une seule famille a été créée
    const d = new pg.Client({ connectionString: "postgres://smart:smart@localhost:5432/smartcourse_e2e" });
    await d.connect();
    expect((await d.query("SELECT count(*)::int AS n FROM families WHERE name = 'Famille Retry'")).rows[0].n).toBe(1);
    await d.end();
  } finally {
    await fetch(`${MOCK}/__fail?on=0`, { method: "POST" });
  }
});
