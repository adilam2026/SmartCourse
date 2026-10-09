import { test } from "@playwright/test";
import { card, createList, newFamily, uiLogin } from "./helpers";

// Captures of the real staff screen with the shipped catalogue photos (written to docs/captures/).
test("captures de l'écran du personnel avec les photos du catalogue", async ({ browser, playwright, baseURL }) => {
  const f = await newFamily(playwright, baseURL!);
  await createList(f);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await uiLogin(page, f);
  await page.getByTestId("catalog").waitFor();
  await page.waitForTimeout(2500); // images
  const shot = async (name: string, anchor: string, file: string) => {
    await card(page, f, anchor).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -180));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `../docs/captures/${file}` });
  };
  await card(page, f, "Tomates").click();
  await card(page, f, "Carottes").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await page.screenshot({ path: "../docs/captures/staff-photos-legumes-390x844.png" });
  await shot("fruits", "Bananes", "staff-photos-fruits-390x844.png");
  await shot("pain", "Pain", "staff-photos-pain-390x844.png");
  await ctx.close();
});
