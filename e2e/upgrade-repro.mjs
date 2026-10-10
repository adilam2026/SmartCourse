// Reproduit ce que voit un téléphone qui avait installé une ancienne version quand le serveur passe à une nouvelle :
// profil Chrome persistant (comme celui de l'APK), service worker actif, puis remplacement du dossier web servi.
// Usage : node upgrade-repro.mjs <dossier web ANCIEN> <dossier web NOUVEAU>
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { chromium, devices } from "@playwright/test";

const [OLD, NEW] = process.argv.slice(2);
const PORT = 3200;
const BASE = `http://127.0.0.1:${PORT}`;
const LIVE = mkdtempSync(path.join(os.tmpdir(), "live-"));
const DBN = "smartcourse_e2e_upgrade";
const admin = new pg.Client({ connectionString: "postgres://smart:smart@localhost:5432/postgres" });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DBN} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DBN}`);
await admin.end();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Remplacement quasi atomique du dossier servi (un déploiement Railway remplace le conteneur entier : jamais de moitié de fichiers).
const swapTo = (dir) => {
  rmSync(LIVE + ".next", { recursive: true, force: true });
  cpSync(dir, LIVE + ".next", { recursive: true });
  rmSync(LIVE + ".prev", { recursive: true, force: true });
  try { renameSync(LIVE, LIVE + ".prev"); } catch {}
  renameSync(LIVE + ".next", LIVE);
};
swapTo(OLD);

// Un déploiement = un NOUVEAU serveur qui démarre avec le nouveau dossier web (la liste des fichiers servis est lue au démarrage).
let server;
const startServer = async () => {
  server = spawn("node", ["dist/index.js"], {
    cwd: "../server",
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "test", DATABASE_URL: `postgres://smart:smart@localhost:5432/${DBN}`, PHOTO_DIR: path.join(os.tmpdir(), "up-photos"), WEB_DIR: LIVE, SCRYPT_N: "1024", LOGIN_RATE_MAX: "5000" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {} await sleep(500); }
};
const redeploy = async (dir) => { server.kill(); await sleep(500); swapTo(dir); await startServer(); };
await startServer();

// famille, liste et personnel
const token = randomBytes(24).toString("base64url");
const db = new pg.Client({ connectionString: `postgres://smart:smart@localhost:5432/${DBN}` });
await db.connect();
await db.query("INSERT INTO install_tokens (token_hash) VALUES ($1)", [createHash("sha256").update(token).digest("hex")]);
await db.end();
const post = async (url, data, cookie) => { const r = await fetch(BASE + url, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) }); return { r, j: await r.json().catch(() => ({})) }; };
const setup = await post("/api/setup/family", { installToken: token, familyName: "Upgrade", admin: { displayName: "Adil", login: "adil", secret: "482913" } });
const code = setup.j.familyCode;
const ck = setup.r.headers.get("set-cookie").split(";")[0];
await post("/api/profiles", { displayName: "Marie", login: "marie", role: "staff", secret: "573918" }, ck);
await post("/api/profiles", { displayName: "Lamiaa", login: "lamiaa", role: "parent", secret: "573918" }, ck);
await post("/api/lists", {}, ck);

const profile = mkdtempSync(path.join(os.tmpdir(), "chrome-profile-"));
const ctx = await chromium.launchPersistentContext(profile, { ...devices["Pixel 7"], executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"], serviceWorkers: "allow" });
const bundle = (p) => p.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => s.includes("/assets/index-"))?.split("/assets/")[1] ?? "?");
const hasCounter = (p) => p.evaluate(() => !!document.querySelector('[data-testid^="qty-"]'));
const hasSelector = (p) => p.evaluate(() => !!document.querySelector('[data-testid="view-categories"]'));
const login = async (p, who = "marie") => {
  await p.goto(BASE + "/");
  await p.getByTestId("login-family").fill(code);
  await p.getByTestId("login-id").fill(who);
  await p.getByTestId("login-secret").fill("573918");
  await p.getByTestId("login-submit").click();
  await p.getByTestId("catalog").waitFor();
};
const swInfo = (p) => p.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const keys = await caches.keys();
  const pre = keys.find((k) => k.includes("precache"));
  const entries = pre ? (await (await caches.open(pre)).keys()).map((r) => new URL(r.url).pathname).filter((x) => x.includes("assets/index")) : [];
  const html = await (await fetch("/", { cache: "no-store" })).text();
  return { active: reg?.active?.state, waiting: !!reg?.waiting, installing: !!reg?.installing, precacheIndexAssets: entries, htmlScript: (html.match(/assets\/index-[\w-]+\.js/) ?? ["?"])[0] };
});
const out = [];
const log = (s) => { out.push(s); console.log(s); };

let page = await ctx.newPage();
await login(page);
await page.evaluate(() => navigator.serviceWorker.ready.then(() => 0));
await sleep(1500);
log(`1. installation de l'ANCIENNE version : bundle ${await bundle(page)}, compteur ${await hasCounter(page)}, sélecteur ${await hasSelector(page)}`);
const oldBundle = await bundle(page);

await redeploy(NEW); // le serveur passe à la nouvelle version (comme un déploiement Railway)
await sleep(500);
// A. l'application reste ouverte au premier plan puis revient (aucune navigation)
await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await sleep(3000);
log(`2. après déploiement, application restée ouverte (retour au premier plan) : bundle ${await bundle(page)} (ancien : ${oldBundle})`);
// B. première ré-ouverture (nouvelle navigation, comme une relance de l'APK)
await page.close();
page = await ctx.newPage();
await page.goto(BASE + "/");
await page.getByTestId("catalog").waitFor();
await sleep(3000);
log(`3. 1re ré-ouverture : bundle ${await bundle(page)} ; sw ${JSON.stringify(await swInfo(page))}`);
const b1 = await bundle(page);
await page.close();
page = await ctx.newPage();
page.on("response", (r) => { const u = r.url(); if (/\/assets\/|sw\.js|\.js$/.test(u)) log(`   [réponse] ${r.status()} ${u.replace(BASE, "")} ${r.headers()["content-type"] ?? ""} ${r.fromServiceWorker() ? "(service worker)" : ""}`); });
page.on("pageerror", (e) => log("   [erreur page] " + e.message.slice(0, 200)));
page.on("console", (m) => m.type() === "error" && log("   [console] " + m.text().slice(0, 200)));
await page.goto(BASE + "/");
await sleep(4000);
await page.screenshot({ path: "shots/upgrade-second-open.png" });
log("   sw " + JSON.stringify(await swInfo(page).catch((e) => String(e))));
log("   texte à l'écran : " + (await page.evaluate(() => document.body.innerText.slice(0, 160).replace(/\n/g, " | "))));
await page.getByTestId("catalog").waitFor();
await sleep(1500);
const b2 = await bundle(page);
log(`4. 2e ré-ouverture : bundle ${b2}`);
await page.getByTestId("catalog").waitFor();
log(`   → compteur visible après sélection d'une carte : ${await (async () => { const c = page.locator('[data-testid^="card-"]').first(); await c.click(); await sleep(300); return hasCounter(page); })()}, sélecteur d'affichage ${await hasSelector(page)}`);
console.log(JSON.stringify({ old: oldBundle, afterResume: "see log", firstReopen: b1, secondReopen: b2 }));
await ctx.close();
server.kill();
rmSync(profile, { recursive: true, force: true });
