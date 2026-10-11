// Prépare une famille d'essai pour la recette (base JETABLE) : admin, parent, personnel, et une liste en cours.
// Usage : BASE=http://127.0.0.1:3000 INSTALL_TOKEN=... node recette-seed.mjs
const base = process.env.BASE ?? "http://127.0.0.1:3000";
const token = process.env.INSTALL_TOKEN;
if (!token) throw new Error("INSTALL_TOKEN manquant");
const j = (r) => r.json();
const setup = await fetch(`${base}/api/setup/family`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ installToken: token, familyName: "Recette", admin: { displayName: "Adil", login: "adil", secret: "482913", secretConfirm: "482913", recoveryEmail: "recette@example.org" } }) });
if (setup.status !== 201) throw new Error(`création de la famille : ${setup.status} ${await setup.text()}`);
const { familyCode } = await j(setup);
const cookie = setup.headers.get("set-cookie").split(";")[0];
// Installation en deux temps : le lien « reçu » (faux service d'envoi du conteneur) est ouvert.
const sent = await (await fetch("http://127.0.0.1:3199/__sent?to=recette%40example.org")).json();
const verify = decodeURIComponent(sent.at(-1).text.match(/#\/verify\/([^\s]+)/)[1]);
const v = await fetch(`${base}/api/auth/verify-email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: verify }) });
if (v.status !== 200) throw new Error(`vérification de l'adresse : ${v.status}`);
for (const [displayName, login, role] of [["Lamiaa", "lamiaa", "parent"], ["Marie", "marie", "staff"]]) {
  const r = await fetch(`${base}/api/profiles`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ displayName, login, role, secret: "573918", secretConfirm: "573918" }) });
  if (r.status !== 201) throw new Error(`profil ${login} : ${r.status}`);
}
const l = await fetch(`${base}/api/lists`, { method: "POST", headers: { cookie } });
if (l.status !== 201) throw new Error(`liste : ${l.status}`);
console.log(JSON.stringify({ familyCode }));
