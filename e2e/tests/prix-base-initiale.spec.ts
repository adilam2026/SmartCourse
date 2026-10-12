import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { devices, expect, test } from "@playwright/test";
import { createList, newFamily, uiLogin } from "./helpers";

const DB = "postgres://smart:smart@localhost:5432/smartcourse_e2e";
const OUT = "../docs/captures/prix-favoris";
async function sqlRun(q: string): Promise<any[]> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return ((await c.query(q)) as any).rows ?? [];
  } finally {
    await c.end();
  }
}
/** Réapplique la migration réelle de la base initiale (idempotente) sur une table vide. */
async function loadRealBase() {
  await sqlRun("DELETE FROM base_prices");
  await sqlRun(readFileSync("../server/migrations/019_base_prices_initial.sql", "utf8"));
}

test.describe("base initiale réelle des prix (captures du 12/10/2026)", () => {
  test("98 prix intégrés, en attente et nettoyant sol sans prix, prix masqués par défaut, 0,25 kg × 9,90 DH = 2,48 DH, unités incompatibles non calculées, prix de famille jamais écrasé", async ({ browser, playwright, baseURL }) => {
    await loadRealBase();
    expect((await sqlRun("SELECT count(*)::int AS n FROM base_prices"))[0].n).toBe(98);
    const f = await newFamily(playwright, baseURL!);
    const cat = (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products) as any[];
    const by = Object.fromEntries(cat.map((p) => [p.name, p]));
    expect(by["Tomates"].price).toMatchObject({ amount: "9.90", refQty: "1", refUnit: "kg", source: "base", basis: { kind: "observed", observedOn: "2026-10-12", source: "captures du 12/10/2026" } });
    expect(by["Pommes de terre"].price.basis.kind).toBe("rounded"); // estimation arrondie, distincte d'une observation
    expect(by["Oignons"].price.basis.kind).toBe("average");
    expect(by["Liquide vaisselle"].price).toMatchObject({ amount: "10.95", refUnit: "bouteille", packaging: "flacon de 750 ml" });
    // en attente, sans activation : aucun prix ; nettoyant sol : aucun prix ; non listés : aucun prix (jamais zéro)
    for (const n of ["Riz", "Dinde", "Nettoyant multiusage", "Désodorisant", "Dentifrice", "Coton", "Nettoyant sol", "Coriandre"]) expect([n, by[n]?.price ?? null]).toEqual([n, null]);

    const listId = await createList(f);
    const items = [
      { opId: randomUUID(), type: "add", productId: by["Tomates"].id, quantity: 0.25 },
      { opId: randomUUID(), type: "add", productId: by["Lait"].id, quantity: 2 }, // prix au litre, quantité en pièces : incompatible
      { opId: randomUUID(), type: "add", productId: by["Coriandre"].id, quantity: 1 }, // aucun prix (non listé)
    ];
    expect((await f.adil.post(`/api/lists/${listId}/ops`, { data: { ops: items } })).status()).toBe(200);
    const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL });
    const page = await ctx.newPage();
    await uiLogin(page, f, "adil", "482913");
    // masqués par défaut
    await expect(page.getByTestId(`row-${by["Tomates"].id}`)).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/DH|Prix à compléter/);
    await page.getByTestId("avatar").click();
    await page.getByTestId("pref-totals").check();
    await page.getByRole("button", { name: "Fermer" }).click();
    await expect(page.getByTestId(`price-${by["Tomates"].id}`)).toContainText("0,25 kg × 9,90 DH / kg = 2,48 DH");
    await expect(page.getByTestId(`price-${by["Lait"].id}`)).toContainText("11,00 DH / litre");
    await expect(page.getByTestId(`price-${by["Lait"].id}`)).toContainText("Prix à compléter"); // aucun montant calculé
    await expect(page.getByTestId(`price-${by["Coriandre"].id}`)).toHaveText("Prix à compléter");
    await expect(page.getByTestId("estimate-amount")).toHaveText("2,48 DH");
    await expect(page.getByTestId("estimate-incomplete")).toHaveText("Estimation incomplète — 2 articles sans prix");
    await page.screenshot({ path: `${OUT}/base-reelle-total.png`, fullPage: true });

    // un prix personnalisé n'est jamais écrasé par un nouvel import de la base
    await f.adil.put(`/api/products/${by["Tomates"].id}/price`, { data: { amount: "11.5", refQty: 1, refUnit: "kg" } });
    await sqlRun(readFileSync("../server/migrations/019_base_prices_initial.sql", "utf8"));
    const after = (await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.id === by["Tomates"].id);
    expect(after.price).toMatchObject({ amount: "11.50", source: "family" });
    // les unités des familles n'ont pas changé
    expect(by["Lait"].unit).toBe((await (await f.adil.get("/api/catalog")).json()).categories.flatMap((c: any) => c.products).find((p: any) => p.id === by["Lait"].id).unit);
    await ctx.close();
  });
});
