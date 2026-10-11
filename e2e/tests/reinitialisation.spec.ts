import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { card, createList, linkTokenFor, newFamily, uiLogin } from "./helpers";

/*
 * Réinitialisation définitive de MA famille : confirmation par mot de passe ET code, suppression de cette seule famille,
 * accès fermés, données locales effacées sur chaque téléphone à sa reconnexion, nouvelle installation avec le jeton neuf.
 */
const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const OUT = "../docs/captures/acces";
async function sql(q: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows as any[]; } finally { await c.end(); }
}
const idb = (page: Page) =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open("smartcourse"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const out: Record<string, any[]> = {};
    for (const n of Array.from(db.objectStoreNames)) out[n] = await new Promise<any[]>((res) => { const q = db.transaction(n).objectStore(n).getAll(); q.onsuccess = () => res(q.result as any[]); });
    db.close();
    return out;
  });

test("réinitialiser ma famille : suppression de cette famille seulement, accès fermés, données locales effacées, nouvelle installation", async ({ page, playwright, baseURL, browser }) => {
  const A = await newFamily(playwright, baseURL!);
  const B = await newFamily(playwright, baseURL!);
  const listB = await createList(B);
  const countsB = async () => (await sql("SELECT (SELECT count(*) FROM profiles WHERE family_id = f.id)::int AS p, (SELECT count(*) FROM products WHERE family_id = f.id)::int AS pr, (SELECT count(*) FROM lists WHERE family_id = f.id)::int AS l FROM families f WHERE f.code = $1", [B.code]))[0];
  const bBefore = await countsB();
  const sharedBefore = (await sql("SELECT (SELECT count(*) FROM initial_catalog)::int AS i, (SELECT count(*) FROM extended_catalog)::int AS e, (SELECT count(*) FROM photo_assets WHERE owner_family_id IS NULL)::int AS ph"))[0];
  expect(listB).toBeTruthy();

  // un second téléphone d'une personne de la famille A garde un brouillon local
  const listA = await createList(A);
  expect(listA).toBeTruthy();
  const ctx2 = await browser.newContext({ baseURL: baseURL!, viewport: { width: 390, height: 844 } });
  const phone2 = await ctx2.newPage();
  await uiLogin(phone2, A, A.staffLogin);
  await card(phone2, A, "Tomates").click();
  await expect.poll(async () => ((await idb(phone2)).drafts ?? []).length).toBeGreaterThan(0);
  const oldFamilyId = (await sql("SELECT id FROM families WHERE code = $1", [A.code]))[0].id as string;

  // premier téléphone : l'administrateur principal
  await uiLogin(page, A, "adil", "482913");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("seg-reset").click();
  await expect(page.getByTestId("reset-code")).toHaveText(A.code);
  await expect(page.getByTestId("reset-counts")).toContainText("3 profil(s)");
  await expect(page.getByTestId("reset-submit")).toBeDisabled();
  await page.getByTestId("reset-password").fill("000111");
  await page.getByTestId("reset-confirm-code").fill(A.code);
  await page.getByTestId("reset-sure").check();
  await page.screenshot({ path: `${OUT}/reinitialiser-390.png`, fullPage: true });
  await page.getByTestId("reset-submit").click();
  await expect(page.getByTestId("reset-error")).toContainText("Mot de passe incorrect"); // rien n'est supprimé
  expect((await sql("SELECT count(*)::int AS n FROM families WHERE code = $1", [A.code]))[0].n).toBe(1);
  await page.getByTestId("reset-password").fill("482913");
  await page.getByTestId("reset-submit").click();
  // la famille est supprimée : l'application revient seule à l'installation, jeton neuf prérempli
  await expect(page.getByTestId("reset-banner")).toContainText("supprimée définitivement");
  const token = (await page.getByTestId("setup-token").inputValue()).trim();
  expect(token.length).toBeGreaterThan(20);
  await page.screenshot({ path: `${OUT}/reinitialiser-termine-390.png`, fullPage: true });

  // côté base : A a disparu, B et le catalogue partagé sont identiques
  expect((await sql("SELECT count(*)::int AS n FROM families WHERE code = $1", [A.code]))[0].n).toBe(0);
  expect((await sql("SELECT count(*)::int AS n FROM profiles WHERE family_id = $1", [oldFamilyId]))[0].n).toBe(0);
  expect(await countsB()).toEqual(bBefore);
  expect((await sql("SELECT (SELECT count(*) FROM initial_catalog)::int AS i, (SELECT count(*) FROM extended_catalog)::int AS e, (SELECT count(*) FROM photo_assets WHERE owner_family_id IS NULL)::int AS ph"))[0]).toEqual(sharedBefore);
  expect((await B.adil.get("/api/me")).status()).toBe(200);
  // accès fermés
  expect((await A.lamiaa.get("/api/me")).status()).toBe(401);
  expect((await A.staff.get("/api/me")).status()).toBe(401);

  // retour à l'installation : jeton neuf prérempli, données locales du premier téléphone effacées
  await page.reload(); // le jeton survit à une fermeture de l'application
  await expect(page.getByTestId("setup-token")).toHaveValue(token); // l'installation s'ouvre directement avec le jeton
  const local = await idb(page);
  expect(Object.values(local).flat()).toEqual([]);

  // nouvelle installation avec ce jeton (e-mail obligatoire, vérifié)
  const email = `adil${randomBytes(5).toString("hex")}@example.org`;
  await page.getByTestId("setup-family").fill("Nouvelle famille");
  await page.getByTestId("setup-name").fill("Adil");
  await page.getByTestId("setup-login").fill("adil");
  await page.getByTestId("setup-secret").fill("Ab3$xy");
  await page.getByTestId("setup-again").fill("Ab3$xy");
  await page.getByTestId("setup-email").fill(email);
  await page.getByTestId("setup-submit").click();
  await expect(page.getByTestId("setup-verify")).toBeVisible();
  await page.goto(`/#/verify/${await linkTokenFor(email, "verify")}`);
  await page.getByTestId("link-continue").click();
  await expect(page.getByTestId("setup-family-code")).toBeVisible({ timeout: 15_000 });
  const newCode = await page.getByTestId("setup-family-code").innerText();
  expect(newCode).not.toBe(A.code);
  // le jeton ne sert qu'une fois
  expect((await (await playwright.request.newContext({ baseURL })).post("/api/setup/family", { data: { installToken: token, familyName: "Encore", admin: { displayName: "X", login: "xx", secret: "482913", secretConfirm: "482913", recoveryEmail: "y@example.org" } } })).status()).toBe(403);

  // second téléphone : à la reconnexion à la NOUVELLE famille, rien de l'ancienne n'est conservé ni réinjecté
  await phone2.reload();
  await expect(phone2.getByTestId("login-submit")).toBeVisible(); // ancienne session fermée
  await phone2.getByTestId("login-family").fill(newCode);
  await phone2.getByTestId("login-id").fill("adil");
  await phone2.getByTestId("login-secret").fill("Ab3$xy");
  await phone2.getByTestId("login-submit").click();
  await expect(phone2.getByTestId("tab-settings")).toBeVisible();
  const after = await idb(phone2);
  for (const rows of Object.values(after)) for (const r of rows) expect(JSON.stringify(r)).not.toContain(oldFamilyId);
  await ctx2.close();
});
