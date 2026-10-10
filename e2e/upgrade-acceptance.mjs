// Recette de mise à jour sur une liste EXISTANTE, avec un profil Chrome persistant (comme l'APK) :
//   1. ancienne version (ancien serveur + ancienne application) : famille, profils, liste, achats, brouillon non validé ;
//   2. déploiement de la nouvelle version (nouveau serveur : migrations 009/010 sur la base existante) ;
//   3. la page restée ouverte, puis la relance ; captures personnel / administrateur / parent ;
//   4. déploiement d'une version plus récente encore : la page ouverte se met à jour toute seule, sans rien perdre.
// Usage : node upgrade-acceptance.mjs <web ancien> <web nouveau A> <web nouveau B>
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { chromium, devices } from "@playwright/test";

const [WEB_OLD, WEB_A, WEB_B] = process.argv.slice(2);
const SERVER_OLD = "/tmp/old-src/server";
const SERVER_NEW = path.resolve("../server");
const PORT = 3201;
const BASE = `http://127.0.0.1:${PORT}`;
const LIVE = mkdtempSync(path.join(os.tmpdir(), "live-"));
const DBN = "smartcourse_e2e_accept";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK    " : "ÉCHEC "} ${name}${extra ? " — " + extra : ""}`); };

const admin = new pg.Client({ connectionString: "postgres://smart:smart@localhost:5432/postgres" });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DBN} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DBN}`);
await admin.end();

const swapTo = (dir) => {
  rmSync(LIVE + ".next", { recursive: true, force: true });
  cpSync(dir, LIVE + ".next", { recursive: true });
  rmSync(LIVE + ".prev", { recursive: true, force: true });
  try { renameSync(LIVE, LIVE + ".prev"); } catch {}
  renameSync(LIVE + ".next", LIVE);
};
let server;
const startServer = async (cwd) => {
  server = spawn("node", ["dist/index.js"], { cwd, env: { ...process.env, PORT: String(PORT), NODE_ENV: "test", DATABASE_URL: `postgres://smart:smart@localhost:5432/${DBN}`, PHOTO_DIR: path.join(os.tmpdir(), "acc-photos"), WEB_DIR: LIVE, SCRYPT_N: "1024", LOGIN_RATE_MAX: "5000" }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {} await sleep(500); }
};
const redeploy = async (cwd, web) => { server.kill(); await sleep(700); swapTo(web); await startServer(cwd); }; // un déploiement = un nouveau serveur
process.on("exit", () => server?.kill());

swapTo(WEB_OLD);
await startServer(SERVER_OLD);

const api = async (method, url, data, cookie) => {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: data ? JSON.stringify(data) : undefined });
  return { r, j: await r.json().catch(() => ({})) };
};
const token = randomBytes(24).toString("base64url");
const d0 = new pg.Client({ connectionString: `postgres://smart:smart@localhost:5432/${DBN}` });
await d0.connect();
await d0.query("INSERT INTO install_tokens (token_hash) VALUES ($1)", [createHash("sha256").update(token).digest("hex")]);
await d0.end();
const setup = await api("POST", "/api/setup/family", { installToken: token, familyName: "Recette", admin: { displayName: "Adil", login: "adil", secret: "482913" } });
const code = setup.j.familyCode;
const adilCk = setup.r.headers.get("set-cookie").split(";")[0];
await api("POST", "/api/profiles", { displayName: "Marie", login: "marie", role: "staff", secret: "573918" }, adilCk);
await api("POST", "/api/profiles", { displayName: "Lamiaa", login: "lamiaa", role: "parent", secret: "573918" }, adilCk);
const login = async (who, secret = "573918") => (await api("POST", "/api/auth/login", { familyCode: code, login: who, secret })).r.headers.get("set-cookie").split(";")[0];
const lamiaaCk = await login("lamiaa");
const marieCk = await login("marie");
const catalog = (await api("GET", "/api/catalog", null, adilCk)).j;
const P = {};
for (const c of catalog.categories) for (const p of c.products) P[p.name] = p.id;
const list = (await api("POST", "/api/lists", {}, lamiaaCk)).j.list.id;
// Ancienne liste : ajouts du personnel (ancien format, sans quantité), un achat, tout fait avec l'ANCIEN serveur.
await api("POST", `/api/lists/${list}/ops`, { ops: ["Tomates", "Carottes", "Pommes", "Lait", "Riz", "Sucre"].map((n) => ({ opId: randomUUID(), type: "add", productId: P[n] })) }, marieCk);
const active = (await api("GET", "/api/lists/active", null, lamiaaCk)).j.list;
const lait = active.items.find((i) => i.name === "Lait");
await api("POST", `/api/lists/${list}/ops`, { ops: [{ opId: randomUUID(), type: "purchase", itemId: lait.id }] }, lamiaaCk);

const profile = mkdtempSync(path.join(os.tmpdir(), "phone-"));
const ctx = await chromium.launchPersistentContext(profile, { ...devices["Pixel 7"], executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"], serviceWorkers: "allow" });
const bundle = (p) => p.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => s.includes("/assets/index-"))?.split("/assets/")[1] ?? "?");
const has = (p, sel) => p.evaluate((s) => !!document.querySelector(s), sel);
const uiLogin = async (p, who, secret = "573918") => {
  await p.goto(BASE + "/");
  await p.getByTestId("login-family").fill(code);
  await p.getByTestId("login-id").fill(who);
  await p.getByTestId("login-secret").fill(secret);
  await p.getByTestId("login-submit").click();
};

// 1. Téléphone du personnel avec l'ANCIENNE version, brouillon non validé
let phone = await ctx.newPage();
await uiLogin(phone, "marie");
await phone.getByTestId("catalog").waitFor();
await phone.getByTestId(`card-${P["Oignons"]}`).click(); // brouillon : non validé
await sleep(1500);
const oldB = await bundle(phone);
check("ancienne version installée (aucun compteur, aucun sélecteur)", !(await has(phone, '[data-testid^="qty-"]')) && !(await has(phone, '[data-testid="view-categories"]')), oldB);
await phone.screenshot({ path: "shots/accept-0-ancienne-version.png" });

// 2. déploiement de la nouvelle version (migrations sur la base existante)
await redeploy(SERVER_NEW, WEB_A);
const health = await (await fetch(`${BASE}/health`)).json();
check("serveur redéployé : migration 010 appliquée sur la base existante", health.schema === "010_validation_times.sql", JSON.stringify(health));

// 3. page restée ouverte : l'ANCIENNE application ne peut pas se mettre à jour elle-même
await phone.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await sleep(3000);
const stillOld = (await bundle(phone)) === oldB;
check("(constat) une page ouverte avec l'ancienne version reste sur l'ancienne version", stillOld);

// relance(s) du téléphone : une nouvelle navigation suffit à passer à la nouvelle version
let launches = 0;
for (; launches < 3; ) {
  await phone.close();
  phone = await ctx.newPage();
  await phone.goto(BASE + "/");
  launches++;
  await sleep(2500);
  if ((await bundle(phone)) !== oldB) break;
}
await phone.getByTestId("catalog").waitFor();
const newB = await bundle(phone);
check(`la nouvelle version s'affiche après ${launches} ré-ouverture(s) de l'application`, newB !== oldB, newB);

// 3b. personnel : sélecteur, compteurs, ancienne liste conservée, brouillon conservé
check("personnel : sélecteur « Tous les produits / Par catégories » visible", await phone.getByTestId("view-all").isVisible() && await phone.getByTestId("view-categories").isVisible());
check("personnel : un article de l'ancienne liste affiche son compteur (quantité 1 kg, 1 paquet)", (await phone.getByTestId(`qty-input-${P["Tomates"]}`).inputValue()) === "1" && (await phone.getByTestId(`qty-value-${P["Riz"]}`).textContent()) === "1");
check("personnel : le brouillon non validé d'avant la mise à jour est conservé", (await phone.getByTestId(`card-${P["Oignons"]}`).getAttribute("data-state")) === "unsaved");
check("personnel : l'article acheté montre « Nouvelle demande »", await phone.getByTestId(`again-${P["Lait"]}`).isVisible());
await phone.getByTestId(`card-${P["Tomates"]}`).scrollIntoViewIfNeeded();
await phone.screenshot({ path: "shots/accept-1-personnel-tous.png" });
await phone.getByTestId(`plus-${P["Carottes"]}`).click();
await phone.getByTestId("view-categories").click();
await phone.getByTestId("category-blocks").waitFor();
check("personnel : « Par catégories » affiche les blocs et garde la sélection (compteur de bloc)", (await phone.getByTestId("catcount-legumes").textContent()) === "3" /* tomates, carottes, oignons */, await phone.getByTestId("catcount-legumes").textContent());
await phone.screenshot({ path: "shots/accept-2-personnel-categories.png" });
await phone.getByTestId("catblock-legumes").click();
await phone.screenshot({ path: "shots/accept-3-personnel-categorie-ouverte.png" });
check("personnel : la quantité choisie survit au changement d'affichage", (await phone.getByTestId(`qty-input-${P["Carottes"]}`).inputValue()) === "1,5");
await phone.getByTestId("cat-back").click();
await phone.getByTestId("view-all").click();
// profil → version
await phone.getByTestId("avatar").click();
const runTxt = await phone.getByTestId("version-running").textContent();
check("personnel : la version réellement chargée est affichée (fiche du profil)", /local-/.test(runTxt ?? ""), runTxt ?? "");
await sleep(800);
await phone.screenshot({ path: "shots/accept-4-personnel-version.png" });
await phone.keyboard.press("Escape");
await phone.goBack().catch(() => {});

// 3c. administrateur (profil Chrome différent = autre téléphone) : Modifier la liste + Réglages
const adminCtx = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), "phone-adm-")), { ...devices["Pixel 7"], executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"], serviceWorkers: "allow" });
const adm = await adminCtx.newPage();
await uiLogin(adm, "adil", "482913");
await adm.getByTestId("to-buy").waitFor();
const groups = await adm.locator('[data-testid="to-buy"] .catgroup__title').allTextContents();
check("administrateur : « À acheter » avec un titre par catégorie", groups.length >= 3 && groups.some((g) => g.includes("Légumes")) && groups.some((g) => g.includes("Épicerie")), groups.map((g) => g.trim()).join(" | "));
const boughtGroups = await adm.locator('[data-testid="bought"] .catgroup__title').allTextContents();
check("administrateur : « Déjà achetés » avec un titre par catégorie", boughtGroups.length === 1 && boughtGroups[0].includes("Laitages"), boughtGroups.join(" | "));
check("administrateur : quantité et unité sur les lignes (ancienne liste : 1 kg, 1 pièce…)", (await adm.getByTestId(`row-${P["Tomates"]}`).textContent()).includes("1 kg") && (await adm.getByTestId(`row-${P["Riz"]}`).textContent()).includes("1 paquet"));
await adm.screenshot({ path: "shots/accept-5-admin-en-cours.png", fullPage: false });
await adm.getByTestId("edit-list").click();
await adm.getByTestId("catalog").waitFor();
check("administrateur : « Modifier la liste » affiche le sélecteur et les compteurs", await adm.getByTestId("view-categories").isVisible() && (await adm.getByTestId(`qty-input-${P["Tomates"]}`).inputValue()) === "1");
await adm.screenshot({ path: "shots/accept-6-admin-modifier.png" });
await adm.goBack();
await adm.getByTestId("tab-settings").click();
await adm.getByTestId("version-info").waitFor();
check("administrateur : la version chargée est affichée dans Réglages", /local-/.test((await adm.getByTestId("version-running").textContent()) ?? ""));
await adm.screenshot({ path: "shots/accept-7-admin-reglages.png" });

// 3d. parent
const parCtx = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), "phone-par-")), { ...devices["Pixel 7"], executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"], serviceWorkers: "allow" });
const par = await parCtx.newPage();
await uiLogin(par, "lamiaa");
await par.getByTestId("to-buy").waitFor();
check("parent : titres de catégories et quantités sur les lignes", (await par.locator('[data-testid="to-buy"] .catgroup__title').count()) >= 3 && (await par.getByTestId(`row-${P["Pommes"]}`).textContent()).includes("1 kg"));
await par.screenshot({ path: "shots/accept-8-parent-en-cours.png" });
await par.getByTestId("avatar").click();
check("parent : la version chargée est affichée (fiche du profil)", await par.getByTestId("version-running").isVisible());
await par.keyboard.press("Escape");

// 4. mise à jour AUTOMATIQUE de la page restée ouverte, sans perte (envoi hors connexion compris)
await phone.getByTestId("card-" + P["Sucre"]).scrollIntoViewIfNeeded();
await ctx.setOffline(true);
await phone.getByTestId(`card-${P["Bananes"]}`).click();
await phone.getByTestId("validate").click(); // validé hors connexion : file d'envoi
await sleep(800);
await phone.getByTestId(`card-${P["Courgettes"]}`).click(); // brouillon non validé
const before = await bundle(phone);
await ctx.setOffline(false);
await redeploy(SERVER_NEW, WEB_B);
await phone.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
let after = before;
for (let i = 0; i < 30 && after === before; i++) { await sleep(1000); after = await bundle(phone).catch(() => before); }
await phone.getByTestId("catalog").waitFor();
check("page déjà ouverte : mise à jour automatique vers la version publiée, sans réinstaller", after !== before, `${before} → ${after}`);
check("après mise à jour : le brouillon non validé est conservé", (await phone.getByTestId(`card-${P["Courgettes"]}`).getAttribute("data-state")) === "unsaved");
await sleep(2500);
const lst = (await api("GET", "/api/lists/active", null, lamiaaCk)).j.list;
check("après mise à jour : l'envoi fait hors connexion est arrivé une seule fois", lst.items.filter((i) => i.name === "Bananes").length === 1 && lst.items.find((i) => i.name === "Bananes").quantity === 1);
// La validation hors connexion emportait tout ce que la personne avait choisi avant : Oignons (brouillon d'avant la mise à jour),
// Carottes passées à 1,5 kg et Bananes. Rien d'autre, et le brouillon fait après (Courgettes) n'est pas parti.
check("après mise à jour : liste d'avant intacte, choix validés arrivés (6 + Oignons + Bananes, Carottes 1,5 kg), brouillon ultérieur non envoyé", lst.items.length === 8 && lst.items.filter((i) => i.status === "purchased").length === 1 && lst.items.find((i) => i.name === "Carottes").quantity === 1.5 && !lst.items.some((i) => i.name === "Courgettes"));
await phone.screenshot({ path: "shots/accept-9-apres-mise-a-jour-automatique.png" });

await ctx.close();
await adminCtx.close();
await parCtx.close();
server.kill();
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} contrôle(s) en échec` : `\nTous les contrôles passent (${results.length}).`);
process.exit(bad.length ? 1 : 0);
