import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createList, newFamily, uiLogin, type Family } from "./helpers";

/*
 * Notifications téléphone côté application : demande d'autorisation, état, activer/désactiver sur l'appareil, arrêt à la déconnexion,
 * au passage au rôle personnel et au changement de profil ; réception d'un push par le service worker (événement réel injecté dans
 * Chromium), notification unique par validation, ouverture de la bonne liste au toucher, y compris session expirée.
 * Le service push de Google (FCM) n'est pas joignable depuis ici : la souscription du téléphone est simulée dans la première série
 * (le serveur et le transport Web Push chiffré sont testés dans server/test/push.test.ts).
 */
const MOBILE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } as const;
const CAP = "../docs/captures";

/** Fake push subscription + scripted permission, installed before the page loads. */
const FAKE_PUSH = (initialPermission: "default" | "granted" | "denied", answer: "granted" | "denied") => `
(() => {
  let perm = ${JSON.stringify(initialPermission)};
  Object.defineProperty(Notification, "permission", { get: () => perm, configurable: true });
  Notification.requestPermission = async () => { window.__asked = (window.__asked || 0) + 1; perm = ${JSON.stringify(answer)}; return perm; };
  const rnd = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); };
  let sub = null;
  window.__push = { subscribed: () => !!sub, endpoint: () => sub && sub.endpoint, unsubscribeCalls: 0, subscribeCalls: 0 };
  const make = (key) => {
    const endpoint = "https://fcm.example.test/send/" + rnd(18);
    const s = { endpoint, options: { applicationServerKey: key.buffer },
      toJSON: () => ({ endpoint, keys: { p256dh: rnd(65), auth: rnd(16) } }),
      unsubscribe: async () => { window.__push.unsubscribeCalls++; sub = null; return true; } };
    return s;
  };
  const proto = PushManager.prototype;
  proto.getSubscription = async function () { return sub; };
  proto.subscribe = async function (o) { window.__push.subscribeCalls++; sub = make(new Uint8Array(o.applicationServerKey)); return sub; };
})();`;

const profileSheet = async (page: Page) => {
  await page.getByTestId("avatar").click();
  await expect(page.getByTestId("notif-settings")).toBeVisible();
};
const rows = (f: Family, who: "adil" | "lamiaa") => f[who].get("/api/push/config");
void rows;
const pg = async (sql: string, params: unknown[] = []) => {
  const { default: pgm } = await import("pg");
  const c = new pgm.Client({ connectionString: "postgres://smart:smart@localhost:5432/smartcourse_e2e" });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as any[];
  } finally {
    await c.end();
  }
};
const subsOf = (f: Family) => pg("SELECT p.login, s.endpoint FROM push_subscriptions s JOIN profiles p ON p.id = s.profile_id JOIN families fa ON fa.id = s.family_id WHERE fa.code = $1 ORDER BY p.login", [f.code]);

test.describe("activation, état et arrêt des notifications sur l'appareil", () => {
  test("parent : proposition, autorisation du téléphone, activation, état, désactivation ; personnel : aucune proposition", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    const ctx = await browser.newContext(MOBILE);
    await ctx.addInitScript(FAKE_PUSH("default", "granted"));
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await expect(page.getByTestId("edit-list")).toBeVisible();
    // proposition visible sur l'écran « En cours »
    await expect(page.getByTestId("notif-invite")).toBeVisible();
    await page.screenshot({ path: `${CAP}/notifications-proposition.png` });
    await profileSheet(page);
    await expect(page.getByTestId("notif-status")).toHaveAttribute("data-status", "off");
    await expect(page.getByTestId("notif-status")).toHaveText("Désactivées sur cet appareil");
    await page.getByTestId("notif-enable").click();
    await expect(page.getByTestId("notif-status")).toHaveAttribute("data-status", "on");
    await expect(page.getByTestId("notif-status")).toHaveText("Activées sur cet appareil");
    expect(await page.evaluate(() => (window as any).__asked)).toBe(1); // le téléphone a été interrogé une fois
    // enregistré chez le serveur pour Lamiaa, une fois
    expect((await subsOf(f)).map((r) => r.login)).toEqual(["lamiaa"]);
    await page.screenshot({ path: `${CAP}/notifications-reglage-active.png` });
    await page.getByRole("dialog", { name: "Mon profil" }).getByRole("button", { name: "Fermer" }).click();
    await expect(page.getByTestId("notif-invite")).toHaveCount(0); // plus de proposition quand c'est activé
    await profileSheet(page);
    await page.getByTestId("notif-disable").click();
    await expect(page.getByTestId("notif-status")).toHaveAttribute("data-status", "off");
    expect(await page.evaluate(() => (window as any).__push.unsubscribeCalls)).toBe(1);
    expect(await subsOf(f)).toEqual([]);
    await ctx.close();

    // personnel : ni proposition ni réglage, et le serveur refuse
    const sctx = await browser.newContext(MOBILE);
    await sctx.addInitScript(FAKE_PUSH("default", "granted"));
    const staff = await sctx.newPage();
    await uiLogin(staff, f);
    await expect(staff.getByTestId("catalog")).toBeVisible();
    await staff.getByTestId("avatar").click();
    await expect(staff.getByRole("dialog", { name: "Mon profil" })).toBeVisible();
    await expect(staff.getByTestId("notif-settings")).toHaveCount(0);
    await expect(staff.getByTestId("notif-invite")).toHaveCount(0);
    expect((await f.staff.post("/api/push/subscriptions", { data: { endpoint: "https://x.example.test/s", keys: { p256dh: "AAAAAAAAAA", auth: "BBBBBBBBBB" } } })).status()).toBe(403);
    await sctx.close();
  });

  test("autorisation refusée : état « bloquées » avec la marche à suivre, rien d'enregistré", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    const ctx = await browser.newContext(MOBILE);
    await ctx.addInitScript(FAKE_PUSH("default", "denied"));
    const page = await ctx.newPage();
    await uiLogin(page, f, "adil", "482913");
    await profileSheet(page);
    await page.getByTestId("notif-enable").click();
    await expect(page.getByTestId("notif-status")).toHaveAttribute("data-status", "denied");
    await expect(page.getByTestId("notif-denied-help")).toContainText("Paramètres du téléphone");
    await expect(page.getByTestId("notif-enable")).toHaveCount(0);
    expect(await subsOf(f)).toEqual([]);
    await page.screenshot({ path: `${CAP}/notifications-refusees.png` });
    await ctx.close();
  });

  test("« Plus tard » masque la proposition ; la déconnexion arrête les notifications de cet appareil ; un autre profil ne les hérite pas", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    const ctx = await browser.newContext(MOBILE);
    await ctx.addInitScript(FAKE_PUSH("default", "granted"));
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await page.getByTestId("notif-invite-dismiss").click();
    await expect(page.getByTestId("notif-invite")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("edit-list")).toBeVisible();
    await expect(page.getByTestId("notif-invite")).toHaveCount(0);
    // activer puis se déconnecter
    await profileSheet(page);
    await page.getByTestId("notif-enable").click();
    await expect(page.getByTestId("notif-status")).toHaveAttribute("data-status", "on");
    expect((await subsOf(f)).length).toBe(1);
    await page.getByTestId("logout").click();
    await expect(page.getByTestId("login-submit")).toBeVisible();
    expect(await page.evaluate(() => (window as any).__push.unsubscribeCalls)).toBe(1); // abonnement du téléphone annulé
    expect(await page.evaluate(() => (window as any).__push.subscribed())).toBe(false);
    expect(await subsOf(f)).toEqual([]); // et supprimé chez le serveur
    await ctx.close();
  });

  test("appareil resté abonné par l'ancien profil (déconnexion hors connexion) : l'appareil est libéré quand un autre profil le reprend", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    const ctx = await browser.newContext(MOBILE);
    await ctx.addInitScript(FAKE_PUSH("granted", "granted"));
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await profileSheet(page);
    await page.getByTestId("notif-enable").click();
    await expect(page.getByTestId("notif-status")).toHaveAttribute("data-status", "on");
    // déconnexion SANS réseau : ni l'abonnement du téléphone ni celui du serveur ne sont supprimés par l'application elle-même…
    const sub = await page.evaluate(() => (window as any).__push.endpoint());
    await page.evaluate(() => { (window as any).__push.keep = true; });
    await page.getByTestId("logout").click(); // (le faux téléphone se désabonne ici ; on le rétablit pour simuler l'échec)
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await ctx.close();
    // … le serveur, lui, garde l'appareil de Lamiaa tant que personne ne le reprend ; ici on le recrée à la main (cas hors connexion)
    await pg("INSERT INTO push_subscriptions (family_id, profile_id, endpoint, p256dh, auth) SELECT $2, id, $1, 'x', 'y' FROM profiles WHERE family_id = $2 AND login = 'lamiaa' ON CONFLICT DO NOTHING", [sub, (await pg("SELECT id FROM families WHERE code = $1", [f.code]))[0].id]);
    expect((await subsOf(f)).map((r) => r.login)).toEqual(["lamiaa"]);
    // Adil se connecte sur ce même téléphone (même endpoint) : le serveur libère l'appareil
    const r = await f.adil.post("/api/push/subscriptions/check", { data: { endpoint: sub } });
    expect((await r.json()).registered).toBe(false);
    expect(await subsOf(f)).toEqual([]);
  });

  test("passage au rôle personnel : les notifications de cet appareil s'arrêtent côté serveur et côté téléphone", async ({ browser, playwright, baseURL }) => {
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    const ctx = await browser.newContext(MOBILE);
    await ctx.addInitScript(FAKE_PUSH("default", "granted"));
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await profileSheet(page);
    await page.getByTestId("notif-enable").click();
    await expect(page.getByTestId("notif-status")).toHaveAttribute("data-status", "on");
    expect((await subsOf(f)).length).toBe(1);
    const id = (await (await f.adil.get("/api/profiles")).json()).profiles.find((p: any) => p.login === "lamiaa").id;
    expect((await f.adil.patch(`/api/profiles/${id}`, { data: { role: "staff" } })).status()).toBe(200);
    expect(await subsOf(f)).toEqual([]); // serveur : abonnements supprimés tout de suite
    await ctx.close();
  });
});

test.describe("envoi côté serveur depuis l'application du personnel", () => {
  test("validation hors connexion puis renvoi après une réponse perdue : une seule notification, créée à l'enregistrement par le serveur", async ({ browser, playwright, baseURL }) => {
    test.setTimeout(120_000);
    const f = await newFamily(playwright, baseURL!);
    await createList(f);
    // un parent a activé les notifications (adresse fictive : le service push de Google n'est pas joignable d'ici ; l'envoi échoue, il est compté)
    expect((await f.adil.post("/api/push/subscriptions", { data: { endpoint: `https://push.example.invalid/${randomUUID()}`, keys: { p256dh: "BAAAAAAAAAAAAAAA", auth: "CCCCCCCCCCCC" } } })).status()).toBe(201);
    const ctx = await browser.newContext(MOBILE);
    const page = await ctx.newPage();
    await uiLogin(page, f);
    await expect(page.getByTestId("catalog")).toBeVisible();
    const card = (n: string) => page.getByTestId(`card-${f.products[n]}`);
    await card("Lait").click();
    await card("Riz").click();
    await ctx.setOffline(true);
    await page.getByTestId("validate").click();
    await expect(page.getByTestId("sync-state")).toHaveText("En attente de connexion");
    expect(await pg("SELECT count(*)::int AS n FROM push_events pe JOIN families fa ON fa.id = pe.family_id WHERE fa.code = $1", [f.code])).toEqual([{ n: 0 }]); // rien tant que le serveur n'a rien enregistré
    // retour du réseau ; la RÉPONSE du premier envoi est perdue (le serveur l'a pourtant enregistré) : le téléphone réessaie
    let posts = 0;
    await page.route("**/api/lists/*/ops", async (route) => {
      posts++;
      if (posts === 1) {
        await route.fetch(); // le serveur traite et enregistre…
        await route.abort("connectionreset"); // …mais le téléphone ne reçoit rien
      } else await route.continue();
    });
    await ctx.setOffline(false);
    await page.evaluate(() => (window as any).__engine.retryNow());
    await expect(page.getByTestId("sync-state")).toHaveText("Liste à jour", { timeout: 30_000 });
    expect(posts).toBeGreaterThanOrEqual(2); // il y a bien eu un renvoi
    await page.waitForTimeout(1500);
    const ev = await pg("SELECT pe.title, pe.body, pe.recipients FROM push_events pe JOIN families fa ON fa.id = pe.family_id WHERE fa.code = $1", [f.code]);
    expect(ev).toEqual([{ title: "Nouvelle liste de courses", body: "Marie a validé 2 produits", recipients: 1 }]); // une seule, malgré le renvoi
    await ctx.close();
  });
});

// ---- Réception réelle par le service worker (événement push injecté dans Chromium) -----------------------------------------------
async function withServiceWorker(ctx: BrowserContext, page: Page) {
  const cdp = await ctx.newCDPSession(page);
  const regs: { registrationId: string; scopeURL: string }[] = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", (e: any) => regs.push(...e.registrations));
  await cdp.send("ServiceWorker.enable");
  await expect.poll(() => regs.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const registrationId = () => regs.at(-1)!.registrationId; // la plus récente (le service worker a pu être remplacé par une mise à jour)
  const sw = async () => {
    for (let i = 0; i < 50; i++) {
      const w = ctx.serviceWorkers().find((x) => x.url().endsWith("/sw.js"));
      if (w) return w;
      await page.waitForTimeout(200);
    }
    throw new Error("service worker introuvable");
  };
  return {
    push: async (payload: object) => {
      await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(page.url()).origin, registrationId: registrationId(), data: JSON.stringify(payload) });
    },
    shown: async () => (await sw()).evaluate(async () => (await (self as any).registration.getNotifications()).map((n: any) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data }))),
    tap: async () => (await sw()).evaluate(async () => {
      const [n] = await (self as any).registration.getNotifications();
      (self as any).dispatchEvent(new (self as any).NotificationEvent("notificationclick", { notification: n, action: "" }));
      return !!n;
    }),
  };
}

test.describe("réception et toucher (service worker réel)", () => {
  test("le push s'affiche ; une même validation ne s'empile pas ; le toucher ouvre la liste en cours puis une liste clôturée", async ({ browser, playwright, baseURL }) => {
    test.setTimeout(120_000);
    const f = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    const ctx = await browser.newContext({ ...MOBILE, permissions: ["notifications"] });
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await expect(page.getByTestId("edit-list")).toBeVisible();
    await page.waitForTimeout(1500); // service worker actif
    const sw = await withServiceWorker(ctx, page);
    const validationId = randomUUID();
    const note = { v: 1, title: "Nouvelle liste de courses", body: "Marie a validé 5 produits", tag: validationId, listId, url: `/?open=${listId}` };
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await sw.push(note);
    // le même identifiant de validation ne s'affiche qu'une fois : on peut donc redonner l'événement si le worker n'était pas encore prêt
    await expect.poll(async () => { if (!(await sw.shown()).length) await sw.push(note); return (await sw.shown()).length; }, { timeout: 15_000 }).toBe(1);
    expect((await sw.shown())[0]).toMatchObject({ title: "Nouvelle liste de courses", body: "Marie a validé 5 produits", tag: validationId });
    await sw.push(note); // livraison en double de la même validation
    await page.waitForTimeout(800);
    expect(await sw.shown()).toHaveLength(1); // remplacée, pas empilée
    await sw.push({ ...note, title: "Liste mise à jour", body: "Marie a ajouté 3 produits et modifié 2 quantités", tag: randomUUID() });
    await expect.poll(async () => (await sw.shown()).length).toBe(2);

    // toucher : liste en cours → onglet « En cours » (même si l'utilisateur était ailleurs)
    await page.getByTestId("tab-stats").click();
    await expect(page.getByTestId("stats-month")).toBeVisible();
    expect(await sw.tap()).toBe(true);
    await expect(page.getByTestId("edit-list")).toBeVisible();

    // liste clôturée → son historique
    await f.staff.post(`/api/lists/${listId}/ops`, { data: { ops: [{ opId: randomUUID(), type: "add", productId: f.products["Lait"]! }] } });
    expect((await f.lamiaa.post(`/api/lists/${listId}/close`)).status()).toBe(200);
    await page.getByTestId("tab-stats").click();
    await sw.push({ ...note, tag: randomUUID() });
    await expect.poll(async () => (await sw.shown()).length).toBeGreaterThan(0);
    expect(await sw.tap()).toBe(true);
    await expect(page.getByTestId("archive")).toBeVisible();
    await page.screenshot({ path: `${CAP}/notifications-ouverture-liste-cloturee.png` });
    await ctx.close();
  });

  test("application fermée : le toucher ouvre ?open=<liste> ; session expirée : connexion demandée puis la liste s'ouvre ; autre famille : rien ne s'ouvre", async ({ browser, playwright, baseURL }) => {
    test.setTimeout(120_000);
    const f = await newFamily(playwright, baseURL!);
    const other = await newFamily(playwright, baseURL!);
    const listId = await createList(f);
    const otherList = await createList(other);
    // clôture la liste de f pour distinguer « historique » de « en cours »
    await f.staff.post(`/api/lists/${listId}/ops`, { data: { ops: [{ opId: randomUUID(), type: "add", productId: f.products["Lait"]! }] } });
    await f.lamiaa.post(`/api/lists/${listId}/close`);

    // 1. session valide, application fermée : ouverture directe par l'adresse de la notification
    const ctx = await browser.newContext(MOBILE);
    const page = await ctx.newPage();
    await uiLogin(page, f, "lamiaa", "573918");
    await expect(page.getByTestId("no-list")).toBeVisible(); // aucune liste en cours : la liste est clôturée
    await page.goto(`/?open=${listId}`);
    await expect(page.getByTestId("archive")).toBeVisible();
    expect(new URL(page.url()).search).toBe(""); // l'adresse est nettoyée : recharger ne rouvre rien
    // 2. session expirée : la connexion est demandée, puis la liste s'ouvre
    await ctx.clearCookies();
    await page.goto(`/?open=${listId}`);
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await page.getByTestId("login-family").fill(f.code);
    await page.getByTestId("login-id").fill("lamiaa");
    await page.getByTestId("login-secret").fill("573918");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("archive")).toBeVisible();
    await page.screenshot({ path: `${CAP}/notifications-ouverture-apres-connexion.png` });
    // 3. une liste d'une autre famille ne s'ouvre jamais (le serveur répond 404, rien n'est affiché)
    await page.goto(`/?open=${otherList}`);
    await expect(page.getByTestId("tab-current")).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByTestId("archive")).toHaveCount(0);
    // 4. le personnel n'ouvre aucune liste
    const sctx = await browser.newContext(MOBILE);
    const staff = await sctx.newPage();
    await uiLogin(staff, f);
    await staff.goto(`/?open=${listId}`);
    await expect(staff.getByTestId("archive")).toHaveCount(0);
    await ctx.close();
    await sctx.close();
  });
});
