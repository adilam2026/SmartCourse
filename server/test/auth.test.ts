import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { SseHub } from "../src/hub.js";
import { operatorResetSecret } from "../src/profiles.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
let hub: SseHub;
let n = 0;

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
});
afterAll(async () => {
  await app?.close();
  await closeTestDb();
});
beforeEach(async () => {
  await app?.close();
  hub = new SseHub();
  app = await buildApp({ db, store: testStore(), hub, loginRateLimit: { max: 1000, timeWindow: "1 minute" }, sseRevalidateMs: 100 });
  await app.ready();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
  const c = res.cookies.find((x) => x.name === "sc_session");
  return c ? { sc_session: c.value } : undefined;
};

async function newFamily(adminLogin = "adil") {
  const installToken = await generateInstallToken(db);
  const res = await app.inject({
    method: "POST",
    url: "/api/setup/family",
    payload: { installToken, familyName: `Famille ${++n}`, admin: { displayName: "Adil", login: adminLogin, secret: "482913" } },
  });
  expect(res.statusCode).toBe(201);
  return { familyCode: res.json().familyCode as string, cookies: cookieOf(res)!, adminId: res.json().me.id as string };
}

async function addProfile(cookies: Record<string, string>, body: object) {
  const res = await app.inject({ method: "POST", url: "/api/profiles", cookies, payload: body });
  return res;
}

async function doLogin(familyCode: string, login: string, secret: string) {
  return app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login, secret } });
}

describe("jeton d'installation", () => {
  it("n'autorise qu'une seule création même avec des appels simultanés", async () => {
    const installToken = await generateInstallToken(db);
    const mk = (i: number) =>
      app.inject({
        method: "POST",
        url: "/api/setup/family",
        payload: { installToken, familyName: `Race ${i}`, admin: { displayName: "A", login: `admin${i}`, secret: "482913" } },
      });
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(mk));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 403, 403, 403, 403, 403]);
    const fams = await db.query("SELECT count(*)::int AS n FROM families WHERE name LIKE 'Race %'");
    expect(fams.rows[0].n).toBe(1);
  });

  it("refuse un jeton inconnu ou déjà utilisé", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/setup/family",
      payload: { installToken: "x".repeat(40), familyName: "Nope", admin: { displayName: "A", login: "aa", secret: "482913" } },
    });
    expect(bad.statusCode).toBe(403);
  });

  it("un échec après consommation annule la consommation (transaction)", async () => {
    const installToken = await generateInstallToken(db);
    const bad = await app.inject({
      method: "POST",
      url: "/api/setup/family",
      payload: { installToken, familyName: "X", admin: { displayName: "A", login: "aa", secret: "123456" } },
    });
    expect(bad.statusCode).toBe(400); // code trop simple
    const ok = await app.inject({
      method: "POST",
      url: "/api/setup/family",
      payload: { installToken, familyName: "X", admin: { displayName: "A", login: "aa", secret: "482913" } },
    });
    expect(ok.statusCode).toBe(201);
  });
});

describe("connexion", () => {
  it("connecte avec code famille + identifiant + code, session par cookie httpOnly", async () => {
    const f = await newFamily();
    const res = await doLogin(f.familyCode, "adil", "482913");
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === "sc_session")!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Strict");
    const me = await app.inject({ method: "GET", url: "/api/me", cookies: cookieOf(res)! });
    expect(me.json().me.role).toBe("admin");
    expect(me.json().me.family.code).toBe(f.familyCode);
  });

  it("répond de façon identique pour profil inconnu, mauvais code, famille inconnue", async () => {
    const f = await newFamily();
    const a = await doLogin(f.familyCode, "adil", "000111");
    const b = await doLogin(f.familyCode, "inconnu", "482913");
    const c = await doLogin("ZZZZZZZZ", "adil", "482913");
    for (const r of [a, b, c]) expect(r.statusCode).toBe(401);
    expect(a.body).toBe(b.body);
    expect(b.body).toBe(c.body);
  });

  it("verrouille le profil après 5 échecs, même avec le bon code ensuite", async () => {
    const f = await newFamily();
    for (let i = 0; i < 5; i++) expect((await doLogin(f.familyCode, "adil", "000111")).statusCode).toBe(401);
    const res = await doLogin(f.familyCode, "adil", "482913");
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain("invalid_credentials");
  });

  it("des tentatives parallèles ne contournent pas le verrouillage", async () => {
    const f = await newFamily();
    await Promise.all(Array.from({ length: 12 }, () => doLogin(f.familyCode, "adil", "000111")));
    const row = await db.query("SELECT failed_attempts, locked_until > now() AS locked FROM profiles WHERE id = $1", [f.adminId]);
    // 5 essais comptés puis verrou : les 7 suivants ont été refusés sans être évalués. Sans sérialisation, les 12 passeraient.
    expect(row.rows[0].failed_attempts).toBe(5);
    expect(row.rows[0].locked).toBe(true);
  });

  it("limite les requêtes par IP sur la route de connexion", async () => {
    await app.close();
    app = await buildApp({ db, store: testStore(), loginRateLimit: { max: 3, timeWindow: "1 minute" } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await doLogin("AAAAAAAA", "x1", "482913")).statusCode);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it("la déconnexion révoque la session", async () => {
    const f = await newFamily();
    const out = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: f.cookies });
    expect(out.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: f.cookies })).statusCode).toBe(401);
  });
});

describe("droits et isolation", () => {
  it("refuse sans session (401) et selon le rôle (403)", async () => {
    const f = await newFamily();
    expect((await app.inject({ method: "GET", url: "/api/profiles" })).statusCode).toBe(401);
    for (const role of ["parent", "staff"]) {
      await addProfile(f.cookies, { displayName: role, login: `u-${role}`, role, secret: "573918" });
      const s = cookieOf(await doLogin(f.familyCode, `u-${role}`, "573918"))!;
      expect((await app.inject({ method: "GET", url: "/api/profiles", cookies: s })).statusCode).toBe(403);
      expect((await addProfile(s, { displayName: "x", login: "xx", role: "staff" })).statusCode).toBe(403);
    }
  });

  it("deux personnes peuvent avoir le même nom affiché, pas le même identifiant", async () => {
    const f = await newFamily();
    expect((await addProfile(f.cookies, { displayName: "Adil", login: "adil2", role: "parent" })).statusCode).toBe(201);
    expect((await addProfile(f.cookies, { displayName: "Adil", login: "adil2", role: "parent" })).statusCode).toBe(409);
  });

  it("une famille ne voit ni ne modifie les profils d'une autre", async () => {
    const a = await newFamily("adil");
    const b = await newFamily("adil");
    const created = await addProfile(a.cookies, { displayName: "Marie", login: "marie", role: "staff", secret: "573918" });
    const targetId = created.json().profile.id as string;

    const list = await app.inject({ method: "GET", url: "/api/profiles", cookies: b.cookies });
    expect(list.json().profiles.map((p: any) => p.id)).not.toContain(targetId);
    expect((await app.inject({ method: "PATCH", url: `/api/profiles/${targetId}`, cookies: b.cookies, payload: { active: false } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/profiles/${targetId}/reset-secret`, cookies: b.cookies, payload: {} })).statusCode).toBe(404);
    // le code de la famille A ne permet pas d'entrer sans le bon secret ; et le bon identifiant dans la famille B n'est pas celui de A
    expect((await doLogin(b.familyCode, "marie", "573918")).statusCode).toBe(401);
  });
});

describe("dernier administrateur", () => {
  it("refuse de désactiver ou rétrograder le dernier administrateur actif", async () => {
    const f = await newFamily();
    const off = await app.inject({ method: "PATCH", url: `/api/profiles/${f.adminId}`, cookies: f.cookies, payload: { active: false } });
    expect(off.statusCode).toBe(409);
    expect(off.json().error).toBe("last_admin");
    const down = await app.inject({ method: "PATCH", url: `/api/profiles/${f.adminId}`, cookies: f.cookies, payload: { role: "parent" } });
    expect(down.statusCode).toBe(409);
  });

  it("deux administrateurs qui se désactivent en même temps : un seul reste actif", async () => {
    const f = await newFamily();
    const second = await addProfile(f.cookies, { displayName: "Lamiaa", login: "lamiaa", role: "admin", secret: "573918" });
    const lamiaaId = second.json().profile.id as string;
    const lamiaa = cookieOf(await doLogin(f.familyCode, "lamiaa", "573918"))!;
    const [r1, r2] = await Promise.all([
      app.inject({ method: "PATCH", url: `/api/profiles/${lamiaaId}`, cookies: f.cookies, payload: { active: false } }),
      app.inject({ method: "PATCH", url: `/api/profiles/${f.adminId}`, cookies: lamiaa, payload: { active: false } }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    const act = await db.query("SELECT count(*)::int AS n FROM profiles WHERE id = ANY($1) AND active", [[lamiaaId, f.adminId]]);
    expect(act.rows[0].n).toBe(1);
  });
});

describe("désactivation et réinitialisation", () => {
  async function familyWithStaff() {
    const f = await newFamily();
    const c = await addProfile(f.cookies, { displayName: "Marie", login: "marie", role: "staff", secret: "573918" });
    const staffId = c.json().profile.id as string;
    const staff = cookieOf(await doLogin(f.familyCode, "marie", "573918"))!;
    return { ...f, staffId, staff };
  }

  it("un profil désactivé perd l'accès immédiatement et ne peut plus se connecter", async () => {
    const f = await familyWithStaff();
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: f.staff })).statusCode).toBe(200);
    await app.inject({ method: "PATCH", url: `/api/profiles/${f.staffId}`, cookies: f.cookies, payload: { active: false } });
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: f.staff })).statusCode).toBe(401);
    expect((await doLogin(f.familyCode, "marie", "573918")).statusCode).toBe(401);
    // réactivé, l'ancienne session reste révoquée mais une nouvelle connexion fonctionne
    await app.inject({ method: "PATCH", url: `/api/profiles/${f.staffId}`, cookies: f.cookies, payload: { active: true } });
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: f.staff })).statusCode).toBe(401);
    expect((await doLogin(f.familyCode, "marie", "573918")).statusCode).toBe(200);
  });

  it("la désactivation coupe le flux SSE ouvert", async () => {
    const f = await familyWithStaff();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie: `sc_session=${f.staff.sc_session}` } });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("retry");
    expect(hub.size).toBe(1);

    await app.inject({ method: "PATCH", url: `/api/profiles/${f.staffId}`, cookies: f.cookies, payload: { active: false } });
    const ended = await Promise.race([
      (async () => {
        for (;;) if ((await reader.read()).done) return true;
      })(),
      new Promise((r) => setTimeout(() => r(false), 2000)),
    ]);
    expect(ended).toBe(true);
    expect(hub.size).toBe(0);
  });

  it("une révocation faite hors de l'application ferme aussi le flux (revérification périodique)", async () => {
    const f = await familyWithStaff();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie: `sc_session=${f.staff.sc_session}` } });
    const reader = res.body!.getReader();
    await reader.read();
    await db.query("UPDATE profiles SET active = false WHERE id = $1", [f.staffId]);
    const ended = await Promise.race([
      (async () => {
        for (;;) if ((await reader.read()).done) return true;
      })(),
      new Promise((r) => setTimeout(() => r(false), 3000)),
    ]);
    expect(ended).toBe(true);
  });

  it("la réinitialisation révoque les sessions, remplace le code et lève le verrou", async () => {
    const f = await familyWithStaff();
    for (let i = 0; i < 5; i++) await doLogin(f.familyCode, "marie", "000111");
    const r = await app.inject({ method: "POST", url: `/api/profiles/${f.staffId}/reset-secret`, cookies: f.cookies, payload: {} });
    const secret = r.json().secret as string;
    expect(secret).toMatch(/^\d{6}$/);
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: f.staff })).statusCode).toBe(401);
    expect((await doLogin(f.familyCode, "marie", "573918")).statusCode).toBe(401);
    expect((await doLogin(f.familyCode, "marie", secret)).statusCode).toBe(200);
  });

  it("un administrateur peut réinitialiser le code d'un autre administrateur", async () => {
    const f = await newFamily();
    const second = await addProfile(f.cookies, { displayName: "Lamiaa", login: "lamiaa", role: "admin", secret: "573918" });
    const r = await app.inject({
      method: "POST",
      url: `/api/profiles/${second.json().profile.id}/reset-secret`,
      cookies: f.cookies,
      payload: { secret: "649201" },
    });
    expect(r.statusCode).toBe(200);
    expect((await doLogin(f.familyCode, "lamiaa", "649201")).statusCode).toBe(200);
  });

  it("la procédure de secours de l'exploitant fonctionne et est journalisée", async () => {
    const f = await newFamily();
    const code = await operatorResetSecret(db, f.familyCode, "adil");
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: f.cookies })).statusCode).toBe(401);
    expect((await doLogin(f.familyCode, "adil", code)).statusCode).toBe(200);
    const log = await db.query("SELECT action FROM audit_log WHERE target_profile_id = $1 ORDER BY id", [f.adminId]);
    expect(log.rows.map((r) => r.action)).toContain("profile.secret_reset_by_operator");
  });
});

describe("codes secrets", () => {
  it("n'est jamais stocké en clair et refuse les codes triviaux", async () => {
    const f = await newFamily();
    const row = await db.query("SELECT secret_hash FROM profiles WHERE id = $1", [f.adminId]);
    expect(row.rows[0].secret_hash).toMatch(/^scrypt\$/);
    expect(row.rows[0].secret_hash).not.toContain("482913");
    for (const weak of ["111111", "123456", "654321"]) {
      expect((await addProfile(f.cookies, { displayName: "x", login: `w${weak}`, role: "staff", secret: weak })).statusCode).toBe(400);
    }
    expect((await addProfile(f.cookies, { displayName: "x", login: "wshort", role: "staff", secret: "12ab" })).statusCode).toBe(400);
  });
});
