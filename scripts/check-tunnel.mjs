// Contrôle de bout en bout d'une adresse HTTPS publique (tunnel de recette), comme le ferait Chrome sur Android :
// page, manifeste, icônes, service worker, connexion (cookie Secure), flux temps réel, envoi d'une grosse image,
// puis verdict d'installabilité de Chrome (même moteur que « Installer l'application »).
// Usage : BASE=https://xxx.trycloudflare.com FAMILY=CODE node check-tunnel.mjs
import { chromium } from "playwright-core";
const BASE = process.env.BASE, FAMILY = process.env.FAMILY;
if (!BASE || !FAMILY) throw new Error("BASE et FAMILY requis");
let bad = 0;
const ok = (m) => console.log(`OK    ${m}`);
const ko = (m) => { bad++; console.log(`ÉCHEC ${m}`); };
const check = (c, m) => (c ? ok(m) : ko(m));

const get = async (p, init) => fetch(BASE + p, init);
// Le nom du tunnel peut mettre un moment à être connu du DNS : on attend qu'il réponde.
for (let i = 0; i < 45; i++) { try { if ((await fetch(BASE + "/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 2000)); }
let r = await get("/health"); check(r.status === 200, `/health via HTTPS (${r.status})`);
r = await get("/"); check(r.status === 200 && (await r.text()).includes('<div id="root">'), "page d'accueil de l'application");
r = await get("/manifest.webmanifest"); const mf = await r.json();
check(r.status === 200 && mf.display === "standalone" && mf.start_url === "/", "manifeste (display standalone)");
for (const i of mf.icons) { const x = await get(i.src); check(x.status === 200 && x.headers.get("content-type") === "image/png", `icône ${i.sizes}${i.purpose ? " " + i.purpose : ""}`); }
r = await get("/sw.js"); check(r.status === 200 && /javascript/.test(r.headers.get("content-type") ?? ""), "service worker servi");

// Connexion HTTPS : le cookie « Secure » doit être accepté et renvoyé
r = await get("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyCode: FAMILY, login: "adil", secret: "482913" }) });
const sc = r.headers.get("set-cookie") ?? "";
check(r.status === 200 && /;\s*Secure/i.test(sc) && /HttpOnly/i.test(sc), "connexion : cookie de session Secure + HttpOnly");
const cookie = sc.split(";")[0];
r = await get("/api/me", { headers: { cookie } }); check(r.status === 200, "session valide à la requête suivante");

// Flux temps réel (SSE) à travers le tunnel : l'événement « ready » doit arriver sans être retenu par un tampon
{
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10_000);
  let got = false, bytes = 0, status = "aucune réponse", ct = "", t0 = Date.now(), tHeaders = -1, tReady = -1;
  try {
    const res = await get("/api/events", { headers: { cookie }, signal: ctl.signal });
    status = String(res.status); ct = res.headers.get("content-type") ?? ""; tHeaders = Date.now() - t0;
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    while (!got) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; buf += dec.decode(value); got = /event: ready/.test(buf); }
    if (got) tReady = Date.now() - t0;
  } catch {}
  clearTimeout(t); ctl.abort();
  console.log(`      (flux : statut ${status}, type ${ct}, en-têtes après ${tHeaders} ms, ${bytes} octets reçus, ready après ${tReady} ms)`);
  if (got) ok("flux temps réel (SSE) : événement « ready » reçu à travers le tunnel");
  else console.log("AVERT flux temps réel (SSE) retenu par le tunnel : aucun octet reçu. Limite connue des tunnels gratuits Cloudflare ; l'application bascule alors sur une relecture toutes les 8 s (contrôlée plus bas).");
}

// Grosse image (photo d'appareil) : ~3 Mo de JPEG bruité, envoyée à l'API comme le fait le formulaire
{
  const { createRequire } = await import("node:module");
  const w = 1600, h = 1200, raw = Buffer.alloc(w * h * 3); for (let i = 0; i < raw.length; i++) raw[i] = (Math.random() * 256) | 0;
  const page = await (await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] })).newPage();
  const b64 = await page.evaluate(async ([w, h]) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); const d = x.createImageData(w, h); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 256; d.data[i + 1] = Math.random() * 256; d.data[i + 2] = Math.random() * 256; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); return c.toDataURL("image/jpeg", 0.95).split(",")[1]; }, [w, h]);
  await page.context().browser().close();
  const res = await get("/api/products", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Essai tunnel", category: "pain", image: b64 }) });
  check(res.status === 201, `envoi d'une image de ${(b64.length / 1e6).toFixed(1)} Mo (base64) via le tunnel (${res.status})`);
  if (res.status === 201) { const p = (await res.json()).product; const img = await get(p.photoUrl, { headers: { cookie } }); const len = (await img.arrayBuffer()).byteLength; check(img.status === 200 && len < 150_000, `image réduite côté serveur (${len} octets)`); }
}

// Installabilité telle que Chrome la juge (CDP), sur la vraie adresse HTTPS
{
  // Profil persistant : un contexte « newContext » est une fenêtre de navigation privée, que Chrome déclare non installable (in-incognito).
  const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "chrome-")), { executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"], viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const browser = ctx;
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload({ waitUntil: "networkidle" }); // page contrôlée par le service worker
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Page.enable");
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  check(installabilityErrors.length === 0, `Chrome juge l'application installable (erreurs : ${JSON.stringify(installabilityErrors.map((e) => e.errorId))})`);
  const { manifestUrl } = await cdp.send("Page.getAppManifest").then((m) => ({ manifestUrl: m.url, errors: m.errors })); check(!!manifestUrl, "manifeste lu par Chrome");
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), "page contrôlée par le service worker");
  // Connexion par l'interface puis rechargement hors connexion
  await page.getByTestId("login-family").fill(FAMILY); await page.getByTestId("login-id").fill("marie"); await page.getByTestId("login-secret").fill("573918"); await page.getByTestId("login-submit").click();
  await page.getByTestId("catalog").waitFor({ timeout: 20_000 }); ok("connexion par l'interface via le tunnel (personnel)");
  // Temps réel entre deux profils, À TRAVERS LE TUNNEL, sans rechargement : le personnel (page 1) voit l'article créé par l'administrateur
  // (API), puis le parent (page 2, autre profil) voit ce que le personnel vient de valider.
  {
    await page.evaluate(() => { window.__sansRechargement = 1; });
    let live = false; for (let i = 0; i < 30 && !live; i++) { live = await page.evaluate(() => (window).__engine?.getState().live === true); if (!live) await page.waitForTimeout(500); }
    if (live) ok("l'application du personnel a un flux temps réel actif (live) via le tunnel");
    else console.log("AVERT pas de flux actif (live=false) : la synchronisation passe par la relecture périodique.");
    const pb = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
    const ppage = await (await pb.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })).newPage();
    await ppage.goto(BASE + "/"); await ppage.getByTestId("login-family").fill(FAMILY); await ppage.getByTestId("login-id").fill("lamiaa"); await ppage.getByTestId("login-secret").fill("573918"); await ppage.getByTestId("login-submit").click();
    await ppage.getByTestId("to-buy").waitFor({ state: "attached", timeout: 20_000 }); ok("connexion du parent (second profil) via le tunnel");
    await ppage.evaluate(() => { window.__sansRechargement = 1; });
    const nom = `Essai direct ${Date.now() % 100000}`;
    const t1 = Date.now();
    const cr = await get("/api/products", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: nom, category: "pain" }) });
    const pid = (await cr.json()).product.id;
    const card = page.getByTestId(`card-${pid}`);
    const seen = await card.waitFor({ state: "attached", timeout: 30_000 }).then(() => true).catch(() => false);
    check(seen && (await page.evaluate(() => (window).__sansRechargement === 1)), `modification de l'administrateur visible chez le personnel sans rechargement (${seen ? Date.now() - t1 : ">30000"} ms, ${live ? "flux SSE" : "relecture périodique"})`);
    if (seen) {
      await card.scrollIntoViewIfNeeded(); await card.click(); const t2 = Date.now();
      await page.getByTestId("validate").click();
      const row = ppage.getByTestId(`row-${pid}`);
      const seen2 = await row.waitFor({ state: "attached", timeout: 30_000 }).then(() => true).catch(() => false);
      check(seen2 && (await ppage.evaluate(() => (window).__sansRechargement === 1)), `choix validé par le personnel visible chez le parent sans rechargement (${seen2 ? Date.now() - t2 : ">30000"} ms, ${live ? "flux SSE" : "relecture périodique"})`);
    }
    await pb.close();
  }
  await page.waitForTimeout(3000);
  await ctx.setOffline(true); await page.reload();
  check(await page.getByTestId("catalog").waitFor({ timeout: 10_000 }).then(() => true).catch(() => false), "après coupure du réseau : l'application et le catalogue s'ouvrent encore");
  await browser.close();
}
console.log(bad ? `\n${bad} contrôle(s) en échec` : "\nTous les contrôles sont conformes");
process.exit(bad ? 1 : 0);
