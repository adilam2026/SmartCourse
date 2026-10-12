import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";

export const MOCK = "http://127.0.0.1:3199";
/** Messages « envoyés » au faux service Brevo pour une adresse. */
export async function mailsTo(to: string): Promise<{ to: string; subject: string; text: string }[]> {
  return (await fetch(`${MOCK}/__sent?to=${encodeURIComponent(to)}`)).json() as Promise<{ to: string; subject: string; text: string }[]>;
}
/** Jeton du dernier lien (verify/reset) reçu à cette adresse : le même parcours que le clic dans l'e-mail. */
export async function linkTokenFor(to: string, kind: "verify" | "reset"): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const m = (await mailsTo(to)).filter((x) => x.text.includes(`#/${kind}/`)).at(-1);
    if (m) return decodeURIComponent(m.text.match(new RegExp(`#/${kind}/([^\\s]+)`))![1]!);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`aucun e-mail ${kind} pour ${to}`);
}

export interface Family {
  email: string;
  code: string;
  adil: APIRequestContext;
  lamiaa: APIRequestContext;
  products: Record<string, string>;
  staff: APIRequestContext;
  staffLogin: string;
}

/** A brand-new family with an admin (Adil), a parent (Lamiaa) and a staff member (Marie). */
export async function newFamily(playwright: { request: { newContext(o: object): Promise<APIRequestContext> } }, baseURL: string): Promise<Family> {
  const token = randomBytes(24).toString("base64url");
  const client = new pg.Client({ connectionString: DB });
  await client.connect();
  await client.query("INSERT INTO install_tokens (token_hash) VALUES ($1)", [createHash("sha256").update(token).digest("hex")]);
  await client.end();

  const adil = await playwright.request.newContext({ baseURL });
  const email = `adil${randomBytes(6).toString("hex")}@example.org`;
  const setup = await adil.post("/api/setup/family", { data: { installToken: token, familyName: "Test", admin: { displayName: "Adil", login: "adil", secret: "482913", secretConfirm: "482913", recoveryEmail: email, city: "Casablanca" } } });
  expect(setup.status()).toBe(201);
  // Installation en deux temps : la famille n'existe pour de bon qu'une fois le lien reçu par e-mail ouvert.
  expect((await adil.post("/api/auth/verify-email", { data: { token: await linkTokenFor(email, "verify") } })).status()).toBe(200);
  const code = (await setup.json()).familyCode as string;
  const staffLogin = `marie${Math.floor(Math.random() * 1e6)}`;
  for (const [login, role, display] of [["lamiaa", "parent", "Lamiaa"], [staffLogin, "staff", "Marie"]] as const) {
    const r = await adil.post("/api/profiles", { data: { displayName: display, login, role, secret: "573918", secretConfirm: "573918", city: "Casablanca" } });
    expect(r.status()).toBe(201);
  }
  const lamiaa = await playwright.request.newContext({ baseURL });
  expect((await lamiaa.post("/api/auth/login", { data: { familyCode: code, login: "lamiaa", secret: "573918" } })).status()).toBe(200);
  const staff = await playwright.request.newContext({ baseURL });
  expect((await staff.post("/api/auth/login", { data: { familyCode: code, login: staffLogin, secret: "573918" } })).status()).toBe(200);
  const cat = await (await adil.get("/api/catalog")).json();
  const products: Record<string, string> = {};
  for (const c of cat.categories) for (const p of c.products) products[p.name] = p.id;
  return { email, code, adil, lamiaa, staff, products, staffLogin };
}

export async function uiLogin(page: Page, f: Family, login = f.staffLogin, secret = "573918") {
  await page.goto("/");
  await page.getByTestId("login-family").fill(f.code);
  await page.getByTestId("login-id").fill(login);
  await page.getByTestId("login-secret").fill(secret);
  await page.getByTestId("login-submit").click();
}

export const op = {
  add: (productId: string) => ({ opId: randomUUID(), type: "add", productId }),
  purchase: (itemId: string) => ({ opId: randomUUID(), type: "purchase", itemId }),
};

export async function createList(f: Family): Promise<string> {
  const r = await f.lamiaa.post("/api/lists");
  expect(r.status()).toBe(201);
  return (await r.json()).list.id;
}

export const card = (page: Page, f: Family, name: string) => page.getByTestId(`card-${f.products[name]}`);

/** Staff adds products through the API (what "Valider" does), returns the list view. */
export async function staffAdds(f: Family, listId: string, names: string[]) {
  const r = await f.staff.post(`/api/lists/${listId}/ops`, { data: { ops: names.map((n) => op.add(f.products[n]!)) } });
  expect(r.status()).toBe(200);
  return (await r.json()).list;
}

export const MAIL_FAILED = "L’e-mail n’a pas pu être envoyé. Veuillez réessayer dans quelques instants.";
/** Aucune information d'infrastructure à l'écran : fournisseur d'envoi, hébergeur, adresse IP, HTTPS, statut HTTP, configuration. */
export const INFRA = /brevo|railway|https?|\bip\b|\bHTTP\b|BREVO_|unauthorized|clé API|expéditeur|configur|serveur|\bAPI\b|\bSQL\b|migration|commit|jeton|diagnostic|détails techniques|Africa\/|fuseau/i;
export async function expectNoInfra(page: Page) {
  const text = await page.locator("main, .app, body").first().innerText();
  expect(text).not.toMatch(INFRA);
}

/** Autorisation d'installation neuve (usage unique) posée en base, comme le ferait l'exploitant ; renvoie le lien à ouvrir. */
export async function installLink(): Promise<{ token: string; path: string }> {
  const token = randomBytes(24).toString("base64url");
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  await c.query("INSERT INTO install_tokens (token_hash) VALUES ($1)", [createHash("sha256").update(token).digest("hex")]);
  await c.end();
  return { token, path: `/#/install/${token}` };
}
/** Ouvre l'application par un lien d'installation : le formulaire de création s'affiche, sans aucun champ d'autorisation. */
export async function openInstall(page: Page): Promise<string> {
  const { token, path } = await installLink();
  await page.goto("/");
  await page.goto(path);
  await expect(page.getByTestId("setup-submit")).toBeVisible();
  return token;
}

/** Choisit une ville dans la liste cherchable (champ « Ville »). */
export async function pickCity(page: Page, testid: string, city: string) {
  await page.getByTestId(`${testid}-input`).fill(city);
  // Un nom saisi en entier est déjà reconnu : la liste de suggestions se referme alors d'elle-même.
  const opt = page.getByTestId(`${testid}-opt-${city}`);
  if (await opt.count()) await opt.click();
}
