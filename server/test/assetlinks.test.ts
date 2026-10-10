import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { closeTestDb, testDb, testStore } from "./helpers.js";

afterAll(closeTestDb);

describe("Digital Asset Links (application Android sans barre d'adresse)", () => {
  const links = JSON.parse(readFileSync(path.resolve("assetlinks.json"), "utf8"));
  it("le fichier du dépôt déclare le paquet Android et une empreinte SHA-256 valide", () => {
    expect(links[0].relation).toContain("delegate_permission/common.handle_all_urls");
    expect(links[0].target.namespace).toBe("android_app");
    expect(links[0].target.package_name).toBe("app.smartcourse.courses");
    for (const f of links[0].target.sha256_cert_fingerprints) expect(f).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
  it("est servi en JSON à /.well-known/assetlinks.json, sans connexion, et n'est pas remplacé par la page d'accueil", async () => {
    const web = mkdtempSync(path.join(os.tmpdir(), "web-"));
    writeFileSync(path.join(web, "index.html"), "<html>app</html>");
    const app = await buildApp({ db: await testDb(), store: testStore(), webDir: web, assetLinks: links });
    const r = await app.inject({ method: "GET", url: "/.well-known/assetlinks.json" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect(r.json()).toEqual(links);
    await app.close();
  });
  it("sans fichier configuré, l'adresse ne renvoie pas la page d'accueil (404)", async () => {
    const web = mkdtempSync(path.join(os.tmpdir(), "web-"));
    writeFileSync(path.join(web, "index.html"), "<html>app</html>");
    const app = await buildApp({ db: await testDb(), store: testStore(), webDir: web });
    const r = await app.inject({ method: "GET", url: "/.well-known/assetlinks.json" });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("fichiers de l'application web", () => {
  const mk = async () => {
    const web = mkdtempSync(path.join(os.tmpdir(), "web-"));
    writeFileSync(path.join(web, "index.html"), "<html>app</html>");
    writeFileSync(path.join(web, "version.json"), JSON.stringify({ id: "abc-1" }));
    return buildApp({ db: await testDb(), store: testStore(), webDir: web });
  };
  it("une page inconnue renvoie l'application (200) ; un fichier manquant renvoie 404, jamais la page d'accueil", async () => {
    const app = await mk();
    expect((await app.inject({ method: "GET", url: "/historique" })).statusCode).toBe(200);
    for (const u of ["/assets/index-ancien.js", "/assets/style-ancien.css", "/icons/absent.png", "/sw-absent.js"]) {
      const r = await app.inject({ method: "GET", url: u });
      expect(r.statusCode, u).toBe(404);
      expect(r.body).not.toContain("<html>"); // sinon le service worker mettrait la page en cache comme si c'était ce fichier
    }
    await app.close();
  });
  it("/version.json est publié et jamais mis en cache durablement", async () => {
    const app = await mk();
    const r = await app.inject({ method: "GET", url: "/version.json" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: "abc-1" });
    expect(r.headers["cache-control"]).toBe("no-cache");
    await app.close();
  });
});
