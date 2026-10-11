// Faux service Brevo pour les tests de bout en bout : même contrat que POST /v3/smtp/email (clé en en-tête, 201 + messageId).
// Le vrai client d'envoi de l'application est donc exercé ; seuls les messages ne quittent pas la machine.
import http from "node:http";
const PORT = Number(process.env.MOCK_BREVO_PORT ?? 3199);
const KEY = "cle-de-test";
const sent = [];
let fail = false;
let n = 0;
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && url.pathname === "/__sent") {
      const to = url.searchParams.get("to");
      return json(200, sent.filter((m) => !to || m.to === to));
    }
    if (req.method === "POST" && url.pathname === "/__fail") return json(200, { fail: (fail = url.searchParams.get("on") === "1") });
    if (req.method === "POST" && url.pathname === "/__reset") { sent.length = 0; return json(200, {}); }
    if (req.method === "POST" && url.pathname === "/v3/smtp/email") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.headers["api-key"] !== KEY) return json(401, { code: "unauthorized", message: "Key not found" });
        if (fail) return json(400, { code: "invalid_parameter", message: "refus simulé" });
        const m = JSON.parse(body);
        sent.push({ to: m.to[0].email, subject: m.subject, text: m.textContent, at: Date.now() });
        json(201, { messageId: `<${++n}.mock@smtp-relay.test>` });
      });
      return;
    }
    json(404, {});
  })
  .listen(PORT, "127.0.0.1", () => console.log(`faux Brevo sur ${PORT}`));
