import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";

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
  await page.screenshot({ path: "shots/setup.png" });
  await page.getByTestId("setup-submit").click();
  const code = await page.getByTestId("setup-family-code").innerText();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  await page.getByTestId("welcome-continue").click();
  await expect(page.getByTestId("tab-settings")).toBeVisible(); // connecté en administrateur

  // le jeton est consommé : une seconde création avec le même jeton est refusée
  const again = await playwright.request.newContext({ baseURL });
  const r = await again.post("/api/setup/family", { data: { installToken: token, familyName: "Autre", admin: { displayName: "X", login: "xx", secret: "482913" } } });
  expect(r.status()).toBe(403);
});
