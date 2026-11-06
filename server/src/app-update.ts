import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import { isManager } from "./family-products.js";

/*
 * Mise à jour de l'application (Android et iPhone, réglages séparés), décidée côté serveur sans nouvelle publication :
 *   - proposition facultative : numéro technique installé < latest_code → « Mettre à jour » / « Plus tard » ;
 *   - blocage : interrupteur required_active ET numéro installé < min_code → écran « Mise à jour nécessaire » + fiche du store.
 * Numéros TECHNIQUES : versionCode Android, CFBundleVersion (numéro de build) iPhone — jamais « 1.0.2 ».
 * Garde-fous :
 *   - rien n'est activé par défaut ni par une publication ou un envoi au store : seul un gestionnaire active le blocage, en
 *     confirmant que la version est téléchargeable par TOUTES les personnes concernées (déploiement progressif terminé, appareils
 *     compatibles) ; l'iPhone exige en plus l'adresse de la fiche App Store ;
 *   - un appareil dont le système est trop ancien pour la version exigée (min_os) n'est jamais bloqué ;
 *   - désactivation immédiate (page de gestion ou « admin-cli update-disable »), sans perdre les numéros ;
 *   - côté application : une vérification impossible (réseau, serveur) ne bloque jamais ; rien n'est effacé.
 * La lecture est publique (avant comme après connexion) et ne dit rien d'une famille.
 */

export type UpdateLevel = "none" | "recommended" | "required";
export type Platform = "android" | "ios";

export interface UpdatePolicy {
  latest: number | null;
  min: number | null;
  requiredActive: boolean;
  minOs: number | null;
}

/**
 * Niveau pour un appareil. `os` : niveau d'API Android ou version majeure d'iOS (null : non transmis, anciennes versions).
 * Système trop ancien pour la version exigée : ni blocage ni proposition (impossible à installer) ; système inconnu alors qu'un
 * minimum est fixé : jamais de blocage (au plus une proposition).
 */
export function updateLevel(versionCode: number, p: UpdatePolicy, os: number | null = null): { level: UpdateLevel; deviceUnsupported: boolean } {
  const below = (n: number | null) => n !== null && versionCode < n;
  const osTooOld = p.minOs !== null && os !== null && os < p.minOs;
  const osUnknown = p.minOs !== null && os === null;
  if (osTooOld) return { level: "none", deviceUnsupported: below(p.latest) || (p.requiredActive && below(p.min)) };
  if (p.requiredActive && below(p.min) && !osUnknown) return { level: "required", deviceUnsupported: false };
  if (below(p.latest) || (p.requiredActive && below(p.min))) return { level: "recommended", deviceUnsupported: false };
  return { level: "none", deviceUnsupported: false };
}

export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=app.smartcourse.courses.natif";
const STORE_PREFIX: Record<Platform, string> = { android: "https://play.google.com/store/apps/details?id=", ios: "https://apps.apple.com/" };
const STORE_NAME: Record<Platform, string> = { android: "Google Play", ios: "l'App Store" };

const codeIn = z.number().int().positive().max(2_000_000_000).nullable();

interface Row {
  platform: Platform;
  latest_code: number | null;
  min_code: number | null;
  required_active: boolean;
  min_os: number | null;
  store_url: string | null;
  updated_at: Date;
}

export async function readPolicy(db: Pick<Db, "query">, platform: Platform): Promise<Row | undefined> {
  return (await db.query("SELECT platform, latest_code, min_code, required_active, min_os, store_url, updated_at FROM app_update_policy WHERE platform = $1", [platform])).rows[0];
}
const policyOf = (r: Row | undefined): UpdatePolicy => ({ latest: r?.latest_code ?? null, min: r?.min_code ?? null, requiredActive: Boolean(r?.required_active), minOs: r?.min_os ?? null });

/** Désactivation immédiate du blocage (commande d'administration de secours) ; les numéros sont gardés pour une réactivation. */
export async function disableRequired(db: Db, platforms: Platform[], note: string): Promise<number> {
  let n = 0;
  await withTx(db, async (c) => {
    for (const p of platforms) {
      const r = await c.query("UPDATE app_update_policy SET required_active = false, updated_at = now() WHERE platform = $1 AND required_active RETURNING latest_code, min_code, min_os", [p]);
      if (!r.rowCount) continue;
      n++;
      const x = r.rows[0];
      await c.query("INSERT INTO app_update_history (platform, latest_code, min_code, required_active, min_os, note) VALUES ($1,$2,$3,false,$4,$5)", [p, x.latest_code, x.min_code, x.min_os, note]);
    }
  });
  return n;
}

export function appUpdateRoutes(app: FastifyInstance, { db, guard, managers = [] }: { db: Db; guard: Guard; managers?: string[] }): void {
  app.get("/api/app/update", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const q = z
      .object({ platform: z.enum(["android", "ios"]).default("android"), versionCode: z.coerce.number().int().nonnegative(), os: z.coerce.number().int().positive().max(1000).optional() })
      .parse(req.query);
    const r = await readPolicy(db, q.platform);
    const p = policyOf(r);
    const { level, deviceUnsupported } = updateLevel(q.versionCode, p, q.os ?? null);
    reply.header("Cache-Control", "no-store");
    const storeUrl = r?.store_url ?? (q.platform === "android" ? PLAY_STORE_URL : null);
    return {
      // Sans fiche connue (iPhone pas encore sur l'App Store), aucune proposition : il n'y aurait rien à ouvrir.
      update: storeUrl ? level : "none",
      deviceUnsupported,
      latestVersionCode: p.latest,
      // Version minimale publiée seulement quand le blocage est actif (sinon null, comme avant).
      minVersionCode: p.requiredActive ? p.min : null,
      storeUrl,
    };
  });

  const managerGuard = async (req: any) => {
    await guard()(req);
    if (!(await isManager(db, req.auth.profileId, managers))) throw new HttpError(403, "not_manager", "Accès réservé aux gestionnaires de Mes Courses");
  };

  const view = (r: Row | undefined, platform: Platform) => ({
    platform,
    latestVersionCode: r?.latest_code ?? null,
    minVersionCode: r?.min_code ?? null,
    requiredActive: Boolean(r?.required_active),
    minOs: r?.min_os ?? null,
    storeUrl: r?.store_url ?? (platform === "android" ? PLAY_STORE_URL : null),
    updatedAt: r ? r.updated_at.toISOString() : null,
  });

  app.get("/api/gestion/app-update", { preHandler: managerGuard }, async () => {
    const android = await readPolicy(db, "android");
    const ios = await readPolicy(db, "ios");
    const history = (
      await db.query(
        `SELECT h.platform, h.latest_code, h.min_code, h.required_active, h.min_os, h.changed_at, h.note, pr.display_name
           FROM app_update_history h LEFT JOIN profiles pr ON pr.id = h.changed_by ORDER BY h.id DESC LIMIT 40`,
      )
    ).rows.map((r) => ({
      platform: r.platform,
      latestVersionCode: r.latest_code,
      minVersionCode: r.min_code,
      requiredActive: r.required_active ?? r.min_code !== null,
      minOs: r.min_os,
      at: (r.changed_at as Date).toISOString(),
      note: r.note,
      by: r.display_name ?? null,
    }));
    // Champs Android à la racine : compatibilité avec la page et les contrôles d'avant l'iPhone.
    return { ...view(android, "android"), platforms: { android: view(android, "android"), ios: view(ios, "ios") }, history };
  });

  // Activer le blocage exige la confirmation explicite que la version est téléchargeable par toutes les personnes concernées
  // (disponible dans le store, déploiement progressif terminé à 100 %, appareils compatibles). Le désactiver : requiredActive = false
  // (ou minVersionCode = null), effet immédiat, sans confirmation.
  app.put("/api/gestion/app-update", { preHandler: managerGuard }, async (req) => {
    const b = z
      .object({
        platform: z.enum(["android", "ios"]).default("android"),
        latestVersionCode: codeIn,
        minVersionCode: codeIn,
        requiredActive: z.boolean().optional(),
        minOs: z.number().int().positive().max(1000).nullable().optional(),
        storeUrl: z.string().trim().max(300).nullable().optional(),
        availableOnStore: z.boolean().optional(),
        availableOnPlay: z.boolean().optional(), // ancien nom (Android)
        rolloutComplete: z.boolean().optional(),
        note: z.string().trim().max(200).optional(),
      })
      .parse(req.body);
    const cur = await readPolicy(db, b.platform);
    const requiredActive = b.requiredActive ?? b.minVersionCode !== null;
    if (b.minVersionCode !== null && b.latestVersionCode === null) throw new HttpError(400, "min_without_latest", "Indiquez d'abord la dernière version disponible");
    if (b.minVersionCode !== null && b.latestVersionCode !== null && b.minVersionCode > b.latestVersionCode)
      throw new HttpError(400, "min_above_latest", "La version minimale ne peut pas dépasser la dernière version disponible");
    if (requiredActive && b.minVersionCode === null) throw new HttpError(400, "min_required", "Indiquez la version minimale autorisée");
    let storeUrl = b.platform === "android" ? PLAY_STORE_URL : (b.storeUrl === undefined ? cur?.store_url ?? null : b.storeUrl || null);
    if (storeUrl && !storeUrl.startsWith(STORE_PREFIX[b.platform]))
      throw new HttpError(400, "store_url_invalid", `Adresse de la fiche invalide : elle doit commencer par ${STORE_PREFIX[b.platform]}`);
    if (requiredActive && !storeUrl) throw new HttpError(400, "store_url_missing", "Indiquez d'abord l'adresse de la fiche App Store");
    const minOs = b.minOs === undefined ? cur?.min_os ?? null : b.minOs;
    // Nouvelle obligation : activation, autre version minimale ou système minimal assoupli.
    const newRequirement =
      requiredActive && (!cur?.required_active || b.minVersionCode !== (cur?.min_code ?? null) || (cur?.min_os ?? null) !== minOs);
    if (newRequirement && (b.availableOnStore ?? b.availableOnPlay) !== true)
      throw new HttpError(400, "availability_not_confirmed", `Confirmez que cette version est disponible sur ${STORE_NAME[b.platform]} pour toutes les personnes concernées`);
    if (newRequirement && b.rolloutComplete !== true)
      throw new HttpError(400, "rollout_not_confirmed", "Confirmez que le déploiement progressif est terminé (100 %) et que les appareils concernés peuvent installer cette version");
    await withTx(db, async (c) => {
      await c.query(
        `INSERT INTO app_update_policy (platform, latest_code, min_code, required_active, min_os, store_url, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (platform) DO UPDATE SET latest_code = $2, min_code = $3, required_active = $4, min_os = $5, store_url = $6, updated_by = $7, updated_at = now()`,
        [b.platform, b.latestVersionCode, b.minVersionCode, requiredActive, minOs, storeUrl, req.auth!.profileId],
      );
      await c.query("INSERT INTO app_update_history (platform, latest_code, min_code, required_active, min_os, changed_by, note) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
        b.platform,
        b.latestVersionCode,
        b.minVersionCode,
        requiredActive,
        minOs,
        req.auth!.profileId,
        b.note || null,
      ]);
    });
    return { ok: true };
  });

  app.get("/gestion/mise-a-jour", async (_req, reply) =>
    reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex").header("X-Frame-Options", "DENY").type("text/html; charset=utf-8").send(updatePage),
  );
}

const updatePage = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Mise à jour de l'application · Mes Courses</title>
<style>
:root{--ink:#12304F;--teal:#14B5AE;--tealdk:#0C8F8A;--bg:#F2F7FB;--line:#DDE7F0;--muted:#64798D;--amber:#B7791F;--ambersoft:#FFF4DD;--danger:#D64545;--dangersoft:#FDECEC}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 Roboto,"Segoe UI",system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:0}.muted{color:var(--muted);font-size:13px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin-top:14px}
label{display:block;font-size:12.5px;font-weight:700;margin:12px 0 4px}input[type=number],input[type=text]{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:500;font-size:14px}
button{font:inherit;font-weight:700;border-radius:12px;padding:10px 16px;border:1.5px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;min-height:42px}
button.p{background:var(--teal);border-color:var(--teal);color:#fff}button.d{color:#fff;background:var(--danger);border-color:var(--danger)}
.acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}.err{color:var(--danger);font-size:13px}
.state{display:inline-block;font-size:12px;font-weight:700;border-radius:99px;padding:3px 10px;background:var(--ambersoft);color:var(--amber);margin-top:6px}
.state.on{background:var(--dangersoft);color:var(--danger)}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line)}
</style></head><body><main>
<h1>Mise à jour de l'application</h1>
<p class="muted">Effet sur les téléphones à leur prochaine ouverture de Mes Courses ou à leur retour au premier plan. Numéros <b>techniques</b> : versionCode Android (ex. 1195), numéro de build iPhone (CFBundleVersion) — jamais « 1.0.2 ». Une vérification impossible (réseau, serveur) ne bloque jamais personne.</p>
<div id="app"><p class="muted">Chargement…</p></div></main>
<script>
const $ = (t, a = {}, ...kids) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (k === "on") for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f); else if (k === "text") e.textContent = v; else e.setAttribute(k, v); } for (const c of kids) e.append(c); return e; };
const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: "same-origin", headers: opts.body ? { "content-type": "application/json" } : {}, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || "Erreur " + r.status); e.status = r.status; throw e; }
  return j;
};
const app = document.getElementById("app");
const num = (v) => (v.trim() === "" ? null : Number(v));
const NAMES = { android: ["Android", "Google Play", "niveau d'API Android, ex. 26"], ios: ["iPhone", "l'App Store", "version d'iOS, ex. 16"] };
function section(d, msgs) {
  const [label, store, osHint] = NAMES[d.platform];
  const state = d.requiredActive ? "BLOCAGE ACTIF en dessous de " + d.minVersionCode : d.latestVersionCode ? "Proposition facultative en dessous de " + d.latestVersionCode + (d.minVersionCode ? " · blocage préparé (" + d.minVersionCode + "), désactivé" : "") : "Aucune mise à jour proposée";
  const latest = $("input", { type: "number", min: "1", value: d.latestVersionCode ?? "" });
  const min = $("input", { type: "number", min: "1", value: d.minVersionCode ?? "" });
  const minOs = $("input", { type: "number", min: "1", value: d.minOs ?? "", placeholder: osHint });
  const url = $("input", { type: "text", value: d.storeUrl ?? "", placeholder: "https://apps.apple.com/app/id…" });
  if (d.platform === "android") url.setAttribute("disabled", "");
  const active = $("input", { type: "checkbox" }); if (d.requiredActive) active.checked = true;
  const avail = $("input", { type: "checkbox" });
  const rollout = $("input", { type: "checkbox" });
  const note = $("input", { type: "text", maxlength: "200", placeholder: "Facultatif : ex. build 1195 en production à 100 % le 24/10" });
  const msg = $("p", {});
  const save = async (body) => {
    msg.className = ""; msg.textContent = "";
    try { await api("/api/gestion/app-update", { method: "PUT", body: { platform: d.platform, ...body } }); await load(); }
    catch (e) { msg.className = "err"; msg.textContent = e.message; }
  };
  return $("div", { class: "card" },
    $("h2", { text: label }), $("span", { class: "state" + (d.requiredActive ? " on" : ""), text: state }),
    $("label", { text: "Dernière version disponible — en dessous : proposition facultative (« Plus tard » possible)" }), latest,
    $("label", { text: "Version minimale autorisée — en dessous : écran « Mise à jour nécessaire », seulement si le blocage est activé" }), min,
    $("label", { text: "Système minimal de cette version (facultatif) — un appareil plus ancien n'est jamais bloqué" }), minOs,
    $("label", { text: "Fiche officielle (" + store + ")" }), url,
    $("label", { class: "check" }, active, $("span", { text: "Activer le blocage des versions inférieures à la version minimale" })),
    $("label", { class: "check" }, avail, $("span", { text: "Je confirme que cette version est réellement téléchargeable sur " + store + " par toutes les personnes concernées (testeurs compris)." })),
    $("label", { class: "check" }, rollout, $("span", { text: "Je confirme que le déploiement progressif est terminé (100 %) et que les appareils concernés peuvent l'installer." })),
    $("p", { class: "muted", text: "Les deux confirmations ne sont exigées que pour activer (ou durcir) un blocage. Laisser un numéro vide le désactive." }),
    $("label", { text: "Note" }), note,
    $("div", { class: "acts" },
      d.requiredActive ? $("button", { class: "d", text: "Désactiver le blocage maintenant", on: { click: () => save({ latestVersionCode: d.latestVersionCode, minVersionCode: d.minVersionCode, requiredActive: false, note: "Blocage désactivé" }) } }) : "",
      $("button", { class: "p", text: "Enregistrer", on: { click: () => save({ latestVersionCode: num(latest.value), minVersionCode: num(min.value), requiredActive: active.checked, minOs: num(minOs.value), storeUrl: d.platform === "ios" ? url.value.trim() || null : undefined, availableOnStore: avail.checked, rolloutComplete: rollout.checked, note: note.value }) } })),
    msg);
}
async function load() {
  let d;
  try { d = await api("/api/gestion/app-update"); }
  catch (e) {
    if (e.status === 401) return app.replaceChildren($("div", { class: "card" }, $("p", { text: "Connectez-vous d'abord dans l'espace de gestion, puis revenez sur cette page." }), $("p", {}, $("a", { href: "/gestion", text: "Ouvrir /gestion" }))));
    return app.replaceChildren($("p", { class: "err", text: e.message }));
  }
  const rows = d.history.map((h) => $("tr", {}, $("td", { text: new Date(h.at).toLocaleString("fr-FR") }), $("td", { text: h.platform === "ios" ? "iPhone" : "Android" }), $("td", { text: h.latestVersionCode ?? "—" }), $("td", { text: (h.minVersionCode ?? "—") + (h.minVersionCode ? (h.requiredActive ? " (actif)" : " (désactivé)") : "") }), $("td", { text: (h.by ?? "") + (h.note ? " · " + h.note : "") })));
  const hist = $("div", { class: "card" }, $("b", { text: "Historique" }), rows.length ? $("table", {}, $("tr", {}, $("th", { text: "Date" }), $("th", { text: "Plateforme" }), $("th", { text: "Dernière" }), $("th", { text: "Minimale" }), $("th", { text: "Par" })), ...rows) : $("p", { class: "muted", text: "Aucune modification." }));
  app.replaceChildren(section(d.platforms.android), section(d.platforms.ios), hist);
}
load();
</script></body></html>`;
