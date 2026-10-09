import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";

export interface Family {
  code: string;
  adil: APIRequestContext;
  lamiaa: APIRequestContext;
  products: Record<string, string>;
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
  const setup = await adil.post("/api/setup/family", { data: { installToken: token, familyName: "Test", admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  expect(setup.status()).toBe(201);
  const code = (await setup.json()).familyCode as string;
  const staffLogin = `marie${Math.floor(Math.random() * 1e6)}`;
  for (const [login, role, display] of [["lamiaa", "parent", "Lamiaa"], [staffLogin, "staff", "Marie"]] as const) {
    const r = await adil.post("/api/profiles", { data: { displayName: display, login, role, secret: "573918" } });
    expect(r.status()).toBe(201);
  }
  const lamiaa = await playwright.request.newContext({ baseURL });
  expect((await lamiaa.post("/api/auth/login", { data: { familyCode: code, login: "lamiaa", secret: "573918" } })).status()).toBe(200);
  const cat = await (await adil.get("/api/catalog")).json();
  const products: Record<string, string> = {};
  for (const c of cat.categories) for (const p of c.products) products[p.name] = p.id;
  return { code, adil, lamiaa, products, staffLogin };
}

export async function uiLogin(page: Page, f: Family) {
  await page.goto("/");
  await page.getByTestId("login-family").fill(f.code);
  await page.getByTestId("login-id").fill(f.staffLogin);
  await page.getByTestId("login-secret").fill("573918");
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
