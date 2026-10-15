/**
 * Page /gestion : traitement des propositions au catalogue commun par les gestionnaires de Mes Courses.
 * Page autonome (aucune donnée dedans) : tout passe par /api/gestion/*, qui exige une session ET un profil gestionnaire.
 * Les textes venant des propositions sont toujours insérés comme texte (textContent), jamais comme HTML.
 */
export const gestionPage = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Gestion du catalogue · Mes Courses</title>
<style>
:root{--navy:#0B2A4A;--ink:#12304F;--teal:#14B5AE;--tealdk:#0C8F8A;--soft:#DFF6F4;--bg:#F2F7FB;--line:#DDE7F0;--muted:#64798D;--amber:#B7791F;--ambersoft:#FFF4DD;--danger:#D64545}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 Roboto,"Segoe UI",system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:24px max(16px,env(safe-area-inset-left))}
h1{font-size:22px;margin:0 0 4px}.muted{color:var(--muted);font-size:13px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin-top:14px}
label{display:block;font-size:12.5px;font-weight:700;margin:10px 0 4px}
input,select,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink)}
button{font:inherit;font-weight:700;border-radius:12px;padding:10px 16px;border:1.5px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;min-height:42px}
button.p{background:var(--teal);border-color:var(--teal);color:#fff}button.d{color:var(--danger)}
button:disabled{opacity:.5;cursor:default}
.tabs{display:flex;gap:6px;margin-top:16px;flex-wrap:wrap}.tabs button{border-radius:99px;min-height:36px;padding:6px 14px}
.tabs button.on{background:var(--teal);border-color:var(--teal);color:#fff}
.row{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.state{font-size:11px;font-weight:700;border-radius:99px;padding:3px 9px;background:var(--ambersoft);color:var(--amber)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:520px){.grid2{grid-template-columns:1fr}}
.acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px}
.err{color:var(--danger);font-size:13px;margin-top:8px}.ok{color:var(--tealdk);font-size:13px;margin-top:8px}
.res{display:flex;flex-direction:column;gap:4px;margin-top:6px}.res button{text-align:left;font-weight:500;min-height:36px}
.res button.on{border-color:var(--teal);background:var(--soft)}
code{background:var(--soft);padding:2px 6px;border-radius:6px;user-select:all}
</style></head><body><main>
<h1>Catalogue commun · propositions</h1><p class="muted" id="who">Espace réservé aux gestionnaires de Mes Courses.</p>
<div id="app"></div></main>
<script>
const $ = (t, a = {}, ...kids) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (k === "on") for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f); else if (k === "text") e.textContent = v; else e.setAttribute(k, v); } for (const c of kids) e.append(c); return e; };
const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: "same-origin", headers: opts.body ? { "content-type": "application/json" } : {}, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || "Erreur " + r.status); e.status = r.status; e.code = j.error; throw e; }
  return j;
};
const app = document.getElementById("app");
let state = { tab: "pending", data: null };

function loginView(msg) {
  const f = $("form", { class: "card" });
  const fc = $("input", { autocomplete: "organization", required: "" }), lg = $("input", { autocomplete: "username", required: "" }), sc = $("input", { type: "password", inputmode: "numeric", autocomplete: "current-password", required: "" });
  const err = $("p", { class: "err", text: msg || "" });
  const btn = $("button", { class: "p", type: "submit", text: "Se connecter" });
  f.append($("p", { class: "muted", text: "Connectez-vous avec votre profil Mes Courses habituel." }), $("label", { text: "Code famille" }), fc, $("label", { text: "Identifiant" }), lg, $("label", { text: "Code d'accès" }), sc, $("div", { class: "acts" }, btn), err);
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault(); btn.disabled = true; err.textContent = "";
    try { await api("/api/auth/login", { method: "POST", body: { familyCode: fc.value, login: lg.value, secret: sc.value } }); start(); }
    catch (e) { err.textContent = e.status === 429 ? "Trop d'essais : réessayez dans une minute." : "Connexion impossible : vérifiez le code famille, l'identifiant et le code d'accès."; btn.disabled = false; }
  });
  app.replaceChildren(f);
}

function deniedView(me) {
  app.replaceChildren($("div", { class: "card" },
    $("p", { text: "Accès réservé aux gestionnaires du catalogue de Mes Courses. Les administrateurs de famille n'y ont pas accès." }),
    $("p", { class: "muted", text: "Identifiant de votre profil (à transmettre pour demander l'accès) :" }), $("p", {}, $("code", { text: me.profileId })),
    $("div", { class: "acts" }, $("button", { text: "Se déconnecter", on: { click: async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); loginView(); } } }))));
}

async function start() {
  let me;
  try { me = await api("/api/gestion/me"); } catch (e) { return loginView(e.status === 401 ? "" : e.message); }
  document.getElementById("who").textContent = "Connecté : " + me.displayName + (me.manager ? " · gestionnaire" : "");
  if (!me.manager) return deniedView(me);
  load();
}

async function load() {
  try { state.data = await api("/api/gestion/proposals?status=" + state.tab); } catch (e) { return app.replaceChildren($("p", { class: "err", text: e.message })); }
  render();
}

function render() {
  const d = state.data;
  const tabs = $("div", { class: "tabs" }, ...[["pending", "À traiter"], ["accepted", "Acceptées"], ["rejected", "Refusées"]].map(([k, l]) =>
    $("button", { class: state.tab === k ? "on" : "", text: l + (state.tab === k ? " (" + d.proposals.length + ")" : ""), on: { click: () => { state.tab = k; load(); } } })));
  const list = d.proposals.length ? d.proposals.map((p) => proposal(p, d)) : [$("p", { class: "muted card", text: "Aucune proposition." })];
  app.replaceChildren(tabs, ...list);
}

function proposal(p, d) {
  const box = $("div", { class: "card" });
  const head = $("div", { class: "row" },
    $("div", {}, $("strong", { text: p.name }), $("div", { class: "muted", text: p.categoryLabel + " · " + p.unit + " · proposé par " + p.families + " famille" + (p.families > 1 ? "s" : "") }),
      p.description ? $("div", { text: "« " + p.description + " »" }) : ""),
    $("span", { class: "state", text: p.status === "pending" ? "À traiter" : p.status === "accepted" ? "Acceptée" : "Refusée" }));
  box.append(head);
  if (p.status !== "pending") { if (p.result) box.append($("p", { class: "muted", text: "Référence : " + p.result.key })); if (p.note) box.append($("p", { class: "muted", text: "Note : " + p.note })); return box; }
  const name = $("input", { value: p.name, maxlength: "60" });
  const cat = $("select", {}, ...d.categories.map((c) => { const o = $("option", { value: c.key, text: c.label }); if (c.key === p.category) o.selected = true; return o; }));
  const unit = $("select", {}, ...d.units.map((u) => { const o = $("option", { value: u, text: u }); if (u === p.unit) o.selected = true; return o; }));
  const kw = $("input", { placeholder: "Mots de recherche (facultatif)", maxlength: "200" });
  const photo = $("input", { type: "file", accept: "image/jpeg,image/png,image/webp" });
  const search = $("input", { placeholder: "Chercher une référence existante…" });
  const res = $("div", { class: "res" });
  let link = null, timer;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(async () => {
    const q = search.value.trim(); if (q.length < 2) { res.replaceChildren(); return; }
    const r = await api("/api/gestion/catalog?q=" + encodeURIComponent(q)).catch(() => ({ results: [] }));
    res.replaceChildren(...r.results.map((x) => { const b = $("button", { type: "button", text: x.name + " (" + x.origin + " · " + x.key + ")" });
      b.addEventListener("click", () => { link = link && link.key === x.key ? null : { origin: x.origin, key: x.key }; [...res.children].forEach((c) => c.classList.remove("on")); if (link) b.classList.add("on"); acc.textContent = link ? "Rattacher à « " + x.name + " »" : "Accepter et publier"; }); return b; }));
  }, 300); });
  const msg = $("p", { class: "err" });
  const acc = $("button", { class: "p", text: "Accepter et publier" }), rej = $("button", { class: "d", text: "Refuser" });
  const busy = (b) => { acc.disabled = rej.disabled = b; };
  acc.addEventListener("click", async () => {
    busy(true); msg.textContent = "";
    try {
      const body = link ? { link } : { name: name.value, category: cat.value, unit: unit.value, keywords: kw.value || undefined };
      if (!link && photo.files[0]) body.image = await toB64(photo.files[0]);
      await api("/api/gestion/proposals/" + p.id + "/accept", { method: "POST", body });
      load();
    } catch (e) { msg.textContent = e.message; busy(false); }
  });
  rej.addEventListener("click", async () => {
    busy(true); msg.textContent = "";
    try { await api("/api/gestion/proposals/" + p.id + "/reject", { method: "POST", body: {} }); load(); } catch (e) { msg.textContent = e.message; busy(false); }
  });
  box.append($("label", { text: "Nom publié" }), name, $("div", { class: "grid2" }, $("div", {}, $("label", { text: "Catégorie" }), cat), $("div", {}, $("label", { text: "Unité" }), unit)),
    $("label", { text: "Mots de recherche" }), kw, $("label", { text: "Photo (facultative)" }), photo,
    $("label", { text: "Ou rattacher à une référence existante" }), search, res, $("div", { class: "acts" }, rej, acc), msg);
  return box;
}

// Photo réduite dans le navigateur (le serveur la normalise ensuite : 512 px, WebP, fond blanc).
function toB64(file) {
  return new Promise((ok, ko) => { const img = new Image(); img.onload = () => {
    const s = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL("image/jpeg", 0.9)); URL.revokeObjectURL(img.src);
  }; img.onerror = () => ko(new Error("Image illisible")); img.src = URL.createObjectURL(file); });
}
start();
</script></body></html>`;
