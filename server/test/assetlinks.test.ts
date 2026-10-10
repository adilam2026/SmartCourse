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
