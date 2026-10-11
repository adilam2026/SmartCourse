// Interroge la page affichée par l'application Android (Chrome DevTools, via `adb forward tcp:9222 localabstract:chrome_devtools_remote`).
// Usage : node scripts/android-cdp.mjs <hôte> '<expression JavaScript>'   (affiche le résultat en JSON, utile aux recettes d'émulateur)
const [host, expression] = process.argv.slice(2);
const pages = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = pages.find((p) => p.type === "page" && String(p.url).includes(host)) ?? pages.find((p) => p.type === "page");
if (!page) throw new Error("aucune page ouverte dans Chrome");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("connexion DevTools impossible")); });
const result = await new Promise((res, rej) => {
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) res(d); };
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true, userGesture: true } }));
  setTimeout(() => rej(new Error("délai dépassé")), 20000);
});
ws.close();
if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails));
console.log(JSON.stringify({ pageUrl: page.url, pageTitle: page.title, value: result.result?.result?.value }));
