import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
let n = 0;
const rate = { max: 1000, timeWindow: "1 minute" };

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, store: testStore(), loginRateLimit: rate });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((x) => x.name === "sc_session")!.value });

async function family() {
  const r = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `F${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const code = r.json().familyCode as string;
  const admin = cookieOf(r);
  const add = async (login: string, role: string, secret = "573918") => (await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: login.toUpperCase(), login, role, secret, secretConfirm: secret } })).json().profile.id as string;
  return { code, admin, add, adminId: r.json().me.id as string };
}
const login = (code: string, l: string, secret: string) => app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: code, login: l, secret } });

describe("suppression d'un profil sans supprimer la famille", () => {
  it("page publique : identifiants vérifiés (comme la connexion), profil anonymisé, famille et autres profils intacts", async () => {
    const f = await family();
    const sara = await f.add("sara", "staff");
    await f.add("karim", "parent");
    const before = (await app.inject({ method: "GET", url: "/api/profiles", cookies: f.admin })).json().profiles.length;
    expect((await app.inject({ method: "POST", url: "/api/account/delete", payload: { familyCode: f.code, login: "sara", secret: "000000" } })).statusCode).toBe(401); // mauvais code : rien ne change
    expect((await login(f.code, "sara", "573918")).statusCode).toBe(200);
    const del = await app.inject({ method: "POST", url: "/api/account/delete", payload: { familyCode: f.code, login: "sara", secret: "573918" } });
    expect(del.statusCode).toBe(200);
    expect((await login(f.code, "sara", "573918")).statusCode).toBe(401); // plus d'accès
    const row = (await db.query("SELECT display_name, login, secret_hash, active, deleted_at FROM profiles WHERE id = $1", [sara])).rows[0];
    expect(row).toMatchObject({ display_name: "Ancien profil", secret_hash: "!", active: false });
    expect(row.login).toMatch(/^supprime-/);
    expect(row.deleted_at).not.toBeNull();
    const profiles = (await app.inject({ method: "GET", url: "/api/profiles", cookies: f.admin })).json().profiles;
    expect(profiles.length).toBe(before - 1);
    expect(profiles.map((p: any) => p.login)).not.toContain("sara");
    expect((await login(f.code, "karim", "573918")).statusCode).toBe(200); // les autres profils et la famille sont intacts
    expect((await login(f.code, "adil", "482913")).statusCode).toBe(200);
    expect((await db.query("SELECT count(*)::int AS n FROM sessions WHERE profile_id = $1 AND revoked_at IS NULL", [sara])).rows[0].n).toBe(0);
    expect((await db.query("SELECT details FROM audit_log WHERE target_profile_id = $1 AND action = 'profile.deleted'", [sara])).rows[0].details).toEqual({ how: "self_public" });
    // l'identifiant redevient disponible
    expect((await app.inject({ method: "POST", url: "/api/profiles", cookies: f.admin, payload: { displayName: "Nouvelle Sara", login: "sara", role: "staff", secret: "573918", secretConfirm: "573918" } })).statusCode).toBe(201);
  });

  it("verrouillage : les essais de la page publique comptent comme des échecs de connexion", async () => {
    const f = await family();
    await f.add("marie", "staff");
    for (let i = 0; i < 6; i++) await app.inject({ method: "POST", url: "/api/account/delete", payload: { familyCode: f.code, login: "marie", secret: "000001" } });
    expect((await app.inject({ method: "POST", url: "/api/account/delete", payload: { familyCode: f.code, login: "marie", secret: "573918" } })).statusCode).toBe(401); // verrouillée : même avec le bon code
  });

  it("dans l'application : mot de passe retapé ; session fermée ; le personnel peut aussi supprimer son compte", async () => {
    const f = await family();
    await f.add("marie", "staff");
    const l = await login(f.code, "marie", "573918");
    const c = cookieOf(l);
    expect((await app.inject({ method: "POST", url: "/api/me/delete", cookies: c, payload: { secret: "111222" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: c })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/me/delete", cookies: c, payload: { secret: "573918" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: c })).statusCode).toBe(401);
  });

  it("protections : le profil principal ne se supprime qu'avec la famille ; un administrateur n'est jamais supprimé par un autre ; le dernier administrateur est protégé", async () => {
    const f = await family();
    expect((await app.inject({ method: "POST", url: "/api/account/delete", payload: { familyCode: f.code, login: "adil", secret: "482913" } })).statusCode).toBe(409); // principal
    expect((await login(f.code, "adil", "482913")).statusCode).toBe(200); // toujours là, et aucune session de vérification ne reste ouverte
    expect((await db.query("SELECT count(*)::int AS n FROM sessions s JOIN profiles p ON p.id = s.profile_id WHERE p.id = $1 AND s.revoked_at IS NULL", [f.adminId])).rows[0].n).toBeLessThanOrEqual(2);
    const lam = await f.add("lamiaa", "admin");
    expect((await app.inject({ method: "DELETE", url: `/api/profiles/${lam}`, cookies: f.admin })).statusCode).toBe(409); // « retirez d'abord le rôle administrateur »
    await app.inject({ method: "PATCH", url: `/api/profiles/${lam}`, cookies: f.admin, payload: { role: "parent" } });
    expect((await app.inject({ method: "DELETE", url: `/api/profiles/${lam}`, cookies: f.admin })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/profiles/${f.adminId}`, cookies: f.admin })).statusCode).toBe(400); // soi-même : par « Supprimer mon compte »
    // un administrateur non principal peut supprimer son propre compte tant qu'il reste un autre administrateur actif
    const a2 = await f.add("omar", "admin");
    const o = cookieOf(await login(f.code, "omar", "573918"));
    expect((await app.inject({ method: "POST", url: "/api/me/delete", cookies: o, payload: { secret: "573918" } })).statusCode).toBe(200);
    void a2;
  });

  it("un administrateur supprime le profil d'un autre sans mot de passe ; une autre famille est intouchable", async () => {
    const f = await family();
    const g = await family();
    const kid = await f.add("kid", "staff");
    const foreign = await g.add("kid", "staff");
    expect((await app.inject({ method: "DELETE", url: `/api/profiles/${foreign}`, cookies: f.admin })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/profiles/${kid}`, cookies: f.admin })).statusCode).toBe(200);
    expect((await login(g.code, "kid", "573918")).statusCode).toBe(200);
  });
});

describe("pages publiques", () => {
  it("confidentialité et suppression : sans connexion, jamais en cache, adresse de contact seulement si configurée", async () => {
    const web = mkdtempSync(path.join(tmpdir(), "web-"));
    mkdirSync(path.join(web, "assets"));
    writeFileSync(path.join(web, "index.html"), "<html>app</html>");
    for (const p of ["confidentialite", "suppression-compte"]) writeFileSync(path.join(web, `${p}.html`), `<html><p>${p}</p><!--CONTACT--></html>`);
    const without = await buildApp({ db, store: testStore(), webDir: web });
    const withContact = await buildApp({ db, store: testStore(), webDir: web, contactEmail: "contact@example.org" });
    for (const url of ["/confidentialite", "/confidentialite.html", "/suppression-compte", "/suppression-compte.html"]) {
      const a = await without.inject({ method: "GET", url });
      expect([url, a.statusCode]).toEqual([url, 200]);
      expect(a.headers["cache-control"]).toBe("no-store");
      expect(a.body).toContain("pas encore renseigné");
      expect(a.body).not.toContain("<!--CONTACT-->");
      const b = await withContact.inject({ method: "GET", url });
      expect(b.body).toContain('<a href="mailto:contact@example.org">contact@example.org</a>');
    }
    await without.close();
    await withContact.close();
  });
});
