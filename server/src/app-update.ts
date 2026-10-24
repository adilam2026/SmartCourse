import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import type { Guard } from "./guard.js";
import { isManager } from "./family-products.js";

/*
 * Mise à jour de l'application Android, décidée côté serveur (sans nouvelle application) :
 *   - « conseillée » : versionCode installé < latest_code → message avec « Mettre à jour » et « Plus tard » ;
 *   - « obligatoire » : versionCode installé < min_code → écran bloquant avec « Mettre à jour » seulement.
 * Les deux sont désactivées par défaut. Publier une version ne la rend jamais obligatoire : seule la version minimale l'exige, et
 * elle ne peut pas dépasser la version conseillée. La lecture est publique (avant comme après connexion) et ne dit rien d'une famille.
 */

export type UpdateLevel = "none" | "recommended" | "required";

export function updateLevel(versionCode: number, latest: number | null, min: number | null): UpdateLevel {
  if (min !== null && versionCode < min) return "required";
  if (latest !== null && versionCode < latest) return "recommended";
  return "none";
}

export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=app.smartcourse.courses.natif";

const codeIn = z.number().int().positive().max(2_000_000_000).nullable();

export function appUpdateRoutes(app: FastifyInstance, { db, guard, managers = [] }: { db: Db; guard: Guard; managers?: string[] }): void {
  const policy = async () => (await db.query("SELECT latest_code, min_code, store_url, updated_at FROM app_update_policy WHERE platform = 'android'")).rows[0];

  app.get("/api/app/update", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const q = z.object({ platform: z.literal("android").default("android"), versionCode: z.coerce.number().int().nonnegative() }).parse(req.query);
    const p = await policy();
    reply.header("Cache-Control", "no-store");
    const latest = (p?.latest_code ?? null) as number | null;
    const min = (p?.min_code ?? null) as number | null;
    return { update: updateLevel(q.versionCode, latest, min), latestVersionCode: latest, minVersionCode: min, storeUrl: (p?.store_url ?? PLAY_STORE_URL) as string };
  });

  const managerGuard = async (req: any) => {
    await guard()(req);
    if (!(await isManager(db, req.auth.profileId, managers))) throw new HttpError(403, "not_manager", "Accès réservé aux gestionnaires de Mes Courses");
  };

  app.get("/api/gestion/app-update", { preHandler: managerGuard }, async () => {
    const p = await policy();
    const history = (
      await db.query("SELECT h.latest_code, h.min_code, h.changed_at, h.note, pr.display_name FROM app_update_history h LEFT JOIN profiles pr ON pr.id = h.changed_by ORDER BY h.id DESC LIMIT 20")
    ).rows.map((r) => ({ latestVersionCode: r.latest_code, minVersionCode: r.min_code, at: (r.changed_at as Date).toISOString(), note: r.note, by: r.display_name ?? null }));
    return { latestVersionCode: p?.latest_code ?? null, minVersionCode: p?.min_code ?? null, storeUrl: p?.store_url ?? PLAY_STORE_URL, updatedAt: p ? (p.updated_at as Date).toISOString() : null, history };
  });

  // Une obligation n'est enregistrée qu'avec la confirmation explicite que cette version est disponible sur Google Play pour les
  // personnes concernées (testeurs compris). Annuler l'obligation : minVersionCode = null (effet immédiat).
  app.put("/api/gestion/app-update", { preHandler: managerGuard }, async (req) => {
    const b = z
      .object({ latestVersionCode: codeIn, minVersionCode: codeIn, availableOnPlay: z.boolean().optional(), note: z.string().trim().max(200).optional() })
      .parse(req.body);
    if (b.minVersionCode !== null && b.latestVersionCode === null) throw new HttpError(400, "min_without_latest", "Indiquez d'abord la version conseillée");
    if (b.minVersionCode !== null && b.latestVersionCode !== null && b.minVersionCode > b.latestVersionCode)
      throw new HttpError(400, "min_above_latest", "La version minimale ne peut pas dépasser la version conseillée");
    const cur = await policy();
    const newRequirement = b.minVersionCode !== null && b.minVersionCode !== (cur?.min_code ?? null);
    if (newRequirement && b.availableOnPlay !== true)
      throw new HttpError(400, "availability_not_confirmed", "Confirmez que cette version est disponible sur Google Play pour toutes les personnes concernées");
    await withTx(db, async (c) => {
      await c.query(
        `INSERT INTO app_update_policy (platform, latest_code, min_code, store_url, updated_by) VALUES ('android',$1,$2,$4,$3)
         ON CONFLICT (platform) DO UPDATE SET latest_code = $1, min_code = $2, updated_by = $3, updated_at = now()`,
        [b.latestVersionCode, b.minVersionCode, req.auth!.profileId, PLAY_STORE_URL],
      );
      await c.query("INSERT INTO app_update_history (platform, latest_code, min_code, changed_by, note) VALUES ('android',$1,$2,$3,$4)", [b.latestVersionCode, b.minVersionCode, req.auth!.profileId, b.note || null]);
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
:root{--ink:#12304F;--teal:#14B5AE;--tealdk:#0C8F8A;--bg:#F2F7FB;--line:#DDE7F0;--muted:#64798D;--amber:#B7791F;--ambersoft:#FFF4DD;--danger:#D64545}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 Roboto,"Segoe UI",system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}.muted{color:var(--muted);font-size:13px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin-top:14px}
label{display:block;font-size:12.5px;font-weight:700;margin:12px 0 4px}input[type=number],input[type=text]{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:500;font-size:14px}
button{font:inherit;font-weight:700;border-radius:12px;padding:10px 16px;border:1.5px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;min-height:42px}
button.p{background:var(--teal);border-color:var(--teal);color:#fff}button.d{color:var(--danger);border-color:var(--danger)}
.acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}.err{color:var(--danger);font-size:13px}.ok{color:var(--tealdk);font-size:13px}
.state{display:inline-block;font-size:12px;font-weight:700;border-radius:99px;padding:3px 10px;background:var(--ambersoft);color:var(--amber)}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line)}
</style></head><body><main>
<h1>Mise à jour de l'application Android</h1>
<p class="muted">Effet immédiat sur les téléphones à leur prochaine ouverture de Mes Courses. Les numéros sont des <b>versionCode</b> Android (ex. 1195), pas « 1.0.2 ».</p>
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
async function load() {
  let d;
  try { d = await api("/api/gestion/app-update"); }
  catch (e) {
    if (e.status === 401) return app.replaceChildren($("div", { class: "card" }, $("p", { text: "Connectez-vous d'abord dans l'espace de gestion, puis revenez sur cette page." }), $("p", {}, $("a", { href: "/gestion", text: "Ouvrir /gestion" }))));
    return app.replaceChildren($("p", { class: "err", text: e.message }));
  }
  const state = d.minVersionCode ? "Mise à jour OBLIGATOIRE en dessous de " + d.minVersionCode : d.latestVersionCode ? "Mise à jour conseillée en dessous de " + d.latestVersionCode : "Aucune mise à jour demandée";
  const latest = $("input", { type: "number", min: "1", value: d.latestVersionCode ?? "" });
  const min = $("input", { type: "number", min: "1", value: d.minVersionCode ?? "" });
  const avail = $("input", { type: "checkbox" });
  const note = $("input", { type: "text", maxlength: "200", placeholder: "Facultatif : ex. version 1195 publiée en production le 24/10" });
  const msg = $("p", {});
  const save = async (body) => {
    msg.className = ""; msg.textContent = "";
    try { await api("/api/gestion/app-update", { method: "PUT", body }); await load(); }
    catch (e) { msg.className = "err"; msg.textContent = e.message; }
  };
  const form = $("div", { class: "card" },
    $("p", {}, $("span", { class: "state", text: state })),
    $("label", { text: "Version conseillée (versionCode) — message « Une nouvelle version… » avec « Plus tard »" }), latest,
    $("label", { text: "Version minimale autorisée (versionCode) — en dessous, l'accès est bloqué jusqu'à la mise à jour" }), min,
    $("p", { class: "muted", text: "Laisser vide pour désactiver. La version minimale ne peut pas dépasser la version conseillée." }),
    $("label", { class: "check" }, avail, $("span", { text: "Je confirme que cette version est disponible sur Google Play pour toutes les personnes concernées, testeurs compris, et compatible avec leurs téléphones (requis pour une nouvelle obligation)." })),
    $("label", { text: "Note" }), note,
    $("div", { class: "acts" },
      d.minVersionCode ? $("button", { class: "d", text: "Annuler l'obligation maintenant", on: { click: () => save({ latestVersionCode: d.latestVersionCode, minVersionCode: null, note: "Obligation annulée" }) } }) : "",
      $("button", { class: "p", text: "Enregistrer", on: { click: () => save({ latestVersionCode: num(latest.value), minVersionCode: num(min.value), availableOnPlay: avail.checked, note: note.value }) } })),
    msg);
  const rows = d.history.map((h) => $("tr", {}, $("td", { text: new Date(h.at).toLocaleString("fr-FR") }), $("td", { text: h.latestVersionCode ?? "—" }), $("td", { text: h.minVersionCode ?? "—" }), $("td", { text: (h.by ?? "") + (h.note ? " · " + h.note : "") })));
  const hist = $("div", { class: "card" }, $("b", { text: "Historique" }), rows.length ? $("table", {}, $("tr", {}, $("th", { text: "Date" }), $("th", { text: "Conseillée" }), $("th", { text: "Minimale" }), $("th", { text: "Par" })), ...rows) : $("p", { class: "muted", text: "Aucune modification." }));
  app.replaceChildren(form, hist);
}
load();
</script></body></html>`;
