import { devices, expect, test, type Page } from "@playwright/test";
import { expectNoInfra, newFamily, uiLogin, type Family } from "./helpers";

const OUT = "../docs/captures/profils";
const profiles = [{ name: "360", viewport: { width: 360, height: 780 } }, { name: "390", viewport: { width: 390, height: 844 } }];

async function open(page: Page, f: Family) {
  await uiLogin(page, f, "adil", "482913");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("seg-profiles").click();
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
/** Intercepte l'ouverture de WhatsApp : rien n'est envoyé, on lit l'adresse prévue. */
async function trapWhatsApp(page: Page): Promise<() => Promise<string | null>> {
  await page.addInitScript(() => {
    (window as any).__wa = null;
    window.open = (u?: string | URL) => ((window as any).__wa = String(u), null);
  });
  return () => page.evaluate(() => (window as any).__wa as string | null);
}

for (const v of profiles) {
  test.describe(`profils et partage — ${v.name} px`, () => {
    test.use({ viewport: v.viewport });

    test("création → partager (WhatsApp prérempli) ; annuler le partage garde le profil ; copie ; code jamais stocké", async ({ page, context, playwright, baseURL }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const f = await newFamily(playwright, baseURL!);
      const wa = await trapWhatsApp(page);
      await open(page, f);
      await page.getByTestId("add-profile").click();
      await page.getByTestId("np-name").fill("Sara");
      await page.getByTestId("np-login").fill("sara");
      await page.getByTestId("np-secret").fill("007319");
      await page.getByTestId("np-secret2").fill("007319");
      await page.getByTestId("np-submit").click();
      // confirmation courte avec l'action de partage
      const notice = page.getByTestId("settings-notice");
      await expect(notice).toContainText("Profil créé : Sara.");
      await expect(page.getByTestId("share-open")).toHaveText("Partager les accès");
      await expect(notice).not.toContainText("007319");
      // partage annulé : le profil reste créé et l'accès fonctionne
      await page.getByTestId("share-open").click();
      const expected = `Voici tes accès à Courses :\nLien : ${new URL(baseURL!).origin}\nCode famille : ${f.code}\nIdentifiant : sara\nCode secret : 007319\nConnecte-toi avec ces informations.`;
      await expect(page.getByTestId("share-preview")).toHaveText(expected);
      await page.screenshot({ path: `${OUT}/partage-${v.name}.png` });
      await page.getByTestId("share-copy").click();
      await expect(page.getByTestId("share-copied")).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
      await page.getByTestId("share-whatsapp").click();
      expect(await wa()).toBe(`https://wa.me/?text=${encodeURIComponent(expected)}`);
      await page.getByTestId("share-close").click();
      await expect(page.getByTestId("profile-sara")).toBeVisible();
      await expect(page.getByTestId("share-open")).toHaveCount(0); // le récapitulatif fermé, le code est effacé de la mémoire de l'écran
      const ok = await playwright.request.newContext({ baseURL });
      expect((await ok.post("/api/auth/login", { data: { familyCode: f.code, login: "sara", secret: "007319" } })).status()).toBe(200);
      // jamais de code en clair dans le stockage local ni dans le texte de la page
      const stored = await page.evaluate(async () => {
        const out: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
        for (const d of (await indexedDB.databases?.()) ?? []) {
          const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(d.name!); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
          for (const name of Array.from(db.objectStoreNames)) {
            out.push(JSON.stringify(await new Promise((res) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res(null); })));
          }
          db.close();
        }
        return out.join("\n");
      });
      expect(stored).not.toContain("007319");
      expect(await page.locator("body").innerText()).not.toContain("007319");
      await expectNoInfra(page);
    });

    test("profil existant : accès sans code secret ; « Définir un nouveau code et partager » ; le code fourni est utilisé une fois", async ({ page, context, playwright, baseURL }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const f = await newFamily(playwright, baseURL!);
      await f.adil.post("/api/profiles", { data: { displayName: "Karim", login: "karim", role: "staff", secret: "516240", secretConfirm: "516240" } });
      const wa = await trapWhatsApp(page);
      await open(page, f);
      const before = await (await f.adil.get("/api/profiles")).json();
      await page.getByTestId("share-karim").click();
      const noSecret = `Voici tes accès à Courses :\nLien : ${new URL(baseURL!).origin}\nCode famille : ${f.code}\nIdentifiant : karim\nTon code secret te sera communiqué séparément.`;
      await expect(page.getByTestId("share-preview")).toHaveText(noSecret);
      await expect(page.getByTestId("share-preview")).not.toContainText("516240");
      await expect(page.getByTestId("share-nosecret")).toContainText("ne peut pas être retrouvé");
      await page.screenshot({ path: `${OUT}/partage-existant-${v.name}.png` });
      await page.getByTestId("share-whatsapp").click();
      expect(await wa()).toBe(`https://wa.me/?text=${encodeURIComponent(noSecret)}`);
      // l'ancien code n'a pas bougé
      const ok = await playwright.request.newContext({ baseURL });
      expect((await ok.post("/api/auth/login", { data: { familyCode: f.code, login: "karim", secret: "516240" } })).status()).toBe(200);
      // nouveau code, puis accès complets
      await page.getByTestId("share-newcode").click();
      await page.getByTestId("pw-secret").fill("284061");
      await page.getByTestId("pw-secret2").fill("284061");
      await page.getByTestId("pw-submit").click();
      const full = `Voici tes accès à Courses :\nLien : ${new URL(baseURL!).origin}\nCode famille : ${f.code}\nIdentifiant : karim\nCode secret : 284061\nConnecte-toi avec ces informations.`;
      await expect(page.getByTestId("share-preview")).toHaveText(full);
      await page.getByTestId("share-whatsapp").click();
      expect(await wa()).toBe(`https://wa.me/?text=${encodeURIComponent(full)}`);
      await page.getByTestId("share-close").click();
      expect((await (await playwright.request.newContext({ baseURL })).post("/api/auth/login", { data: { familyCode: f.code, login: "karim", secret: "284061" } })).status()).toBe(200);
      expect(before.profiles.length).toBe((await (await f.adil.get("/api/profiles")).json()).profiles.length); // aucun profil créé ni supprimé
      await expect(page.locator("body")).not.toContainText("284061");
    });

    test("échec d'enregistrement : aucun partage proposé ; annuler « nouveau code » ne change rien", async ({ page, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await f.adil.post("/api/profiles", { data: { displayName: "Karim", login: "karim", role: "staff", secret: "516240", secretConfirm: "516240" } });
      await open(page, f);
      await page.getByTestId("add-profile").click();
      await page.getByTestId("np-name").fill("Autre");
      await page.getByTestId("np-login").fill("karim"); // identifiant déjà pris
      await page.getByTestId("np-secret").fill("739104");
      await page.getByTestId("np-secret2").fill("739104");
      await page.getByTestId("np-submit").click();
      await expect(page.getByTestId("np-error")).toBeVisible();
      await expect(page.getByTestId("share-open")).toHaveCount(0);
      await page.getByRole("button", { name: "Annuler" }).click();
      await page.getByTestId("share-karim").click();
      await page.getByTestId("share-newcode").click();
      await page.getByRole("button", { name: "Annuler" }).click();
      await expect(page.getByTestId("share-open")).toHaveCount(0);
      expect((await (await playwright.request.newContext({ baseURL })).post("/api/auth/login", { data: { familyCode: f.code, login: "karim", secret: "516240" } })).status()).toBe(200);
    });

    test("cartes compactes : nom, identifiant et rôle, actions sur une ligne, zones de 44 px, sans débordement", async ({ page, playwright, baseURL }) => {
      const f = await newFamily(playwright, baseURL!);
      await f.adil.post("/api/profiles", { data: { displayName: "Lamiaa Alaoui", login: "lamiaa2", role: "admin", secret: "573918", secretConfirm: "573918" } });
      await f.adil.post("/api/profiles", { data: { displayName: "Karim", login: "karim", role: "staff", secret: "516240", secretConfirm: "516240" } });
      await open(page, f);
      const card = page.getByTestId("profile-adil");
      await expect(card).toContainText("Principal");
      await expect(card).toContainText("@adil");
      await expect(card.getByRole("button", { name: "Modifier le code" })).toBeVisible();
      await expect(card.getByRole("button", { name: "Partager" })).toBeVisible();
      await page.screenshot({ path: `${OUT}/profils-${v.name}.png`, fullPage: true });
      for (const c of [card, page.getByTestId("profile-karim")]) {
        const actions = c.locator(".row__actions").getByRole("button");
        for (const b of await c.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        const boxes = await Promise.all((await actions.all()).map((b) => b.boundingBox()));
        expect(new Set(boxes.map((b) => Math.round(b!.y))).size).toBe(1); // une seule ligne d'actions
        expect((await c.boundingBox())!.height).toBeLessThan(150);
      }
      expect((await page.getByTestId("add-profile").boundingBox())!.height).toBeLessThan(60);
      expect(await noOverflow(page)).toBe(true);
      await expect(page.locator("body")).not.toContainText("mot de passe");
      await page.screenshot({ path: `${OUT}/profils-${v.name}.png`, fullPage: true });
      await page.getByTestId("edit-karim").click();
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${OUT}/modifier-profil-${v.name}.png` });
    });
  });
}
