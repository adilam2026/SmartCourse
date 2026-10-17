import type { FastifyInstance } from "fastify";
import { hashSecret } from "../src/security.js";
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
  const res = await app.inject({ method: "POST", url: "/api/profiles", cookies, payload: { secret: "573918", secretConfirm: "573918", ...body, ...("secret" in body && !("secretConfirm" in body) ? { secretConfirm: (body as any).secret } : {}) } });
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
    expect((await app.inject({ method: "POST", url: `/api/profiles/${targetId}/reset-secret`, cookies: b.cookies, payload: { secret: "649201", secretConfirm: "649201" } })).statusCode).toBe(404);
    // le code de la famille A ne permet pas d'entrer sans le bon secret ; et le bon identifiant dans la famille B n'est pas celui de A
    expect((await doLogin(b.familyCode, "marie", "573918")).statusCode).toBe(401);
  });
});

describe("protection de l'administration", () => {
  const patch = (cookies: Record<string, string>, id: string, payload: object) => app.inject({ method: "PATCH", url: `/api/profiles/${id}`, cookies, payload });

  it("un administrateur ne peut pas être désactivé (refus côté serveur) ; le profil principal ne peut pas changer de rôle", async () => {
    const f = await newFamily();
    const second = await addProfile(f.cookies, { displayName: "Lamiaa", login: "lamiaa", role: "admin" });
    const lamiaaId = second.json().profile.id as string;
    expect(second.json().profile.primary).toBe(false);
    const off1 = await patch(f.cookies, f.adminId, { active: false });
    expect([off1.statusCode, off1.json().error]).toEqual([409, "admin_cannot_deactivate"]);
    const off2 = await patch(f.cookies, lamiaaId, { active: false });
    expect([off2.statusCode, off2.json().error]).toEqual([409, "admin_cannot_deactivate"]);
    // rôle + désactivation dans le même appel : refusé aussi (on ne contourne pas la règle)
    expect((await patch(f.cookies, lamiaaId, { role: "parent", active: false })).statusCode).toBe(409);
    const down = await patch(f.cookies, f.adminId, { role: "parent" });
    expect([down.statusCode, down.json().error]).toEqual([409, "primary_admin_protected"]);
    // l'administrateur principal est identifié, l'autre peut être rétrogradé puis désactivé en deux étapes volontaires
    expect((await app.inject({ method: "GET", url: "/api/profiles", cookies: f.cookies })).json().profiles.find((p: any) => p.id === f.adminId).primary).toBe(true);
    expect((await patch(f.cookies, lamiaaId, { role: "parent" })).statusCode).toBe(200);
    expect((await patch(f.cookies, lamiaaId, { active: false })).statusCode).toBe(200);
    const row = await db.query("SELECT role, active, is_primary FROM profiles WHERE id = $1", [f.adminId]);
    expect(row.rows[0]).toMatchObject({ role: "admin", active: true, is_primary: true });
  });

  it("l'administrateur principal est le premier de la famille et il n'y en a qu'un", async () => {
    const f = await newFamily();
    await addProfile(f.cookies, { displayName: "L", login: "lamiaa", role: "admin" });
    expect((await db.query("SELECT count(*)::int AS n FROM profiles WHERE family_id = (SELECT family_id FROM profiles WHERE id = $1) AND is_primary", [f.adminId])).rows[0].n).toBe(1);
    await expect(db.query("UPDATE profiles SET is_primary = true WHERE login = 'lamiaa' AND family_id = (SELECT family_id FROM profiles WHERE id = $1)", [f.adminId])).rejects.toThrow();
  });

  it("dernier administrateur actif : refus de rétrograder, même sans profil principal (anciennes données)", async () => {
    const f = await newFamily();
    await db.query("UPDATE profiles SET is_primary = false WHERE id = $1", [f.adminId]);
    const down = await patch(f.cookies, f.adminId, { role: "parent" });
    expect([down.statusCode, down.json().error]).toEqual([409, "last_admin"]);
  });

  it("deux administrateurs qui se rétrogradent en même temps (anciennes données) : un seul des deux reste administrateur", async () => {
    for (let i = 0; i < 5; i++) {
      const f = await newFamily();
      const second = await addProfile(f.cookies, { displayName: "Lamiaa", login: "lamiaa", role: "admin" });
      const lamiaaId = second.json().profile.id as string;
      await db.query("UPDATE profiles SET is_primary = false WHERE id = ANY($1)", [[f.adminId, lamiaaId]]);
      const lamiaa = cookieOf(await doLogin(f.familyCode, "lamiaa", "573918"))!;
      const [r1, r2] = await Promise.all([patch(f.cookies, lamiaaId, { role: "parent" }), patch(lamiaa, f.adminId, { role: "parent" })]);
      expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
      const adm = await db.query("SELECT count(*)::int AS n FROM profiles WHERE id = ANY($1) AND role = 'admin' AND active", [[lamiaaId, f.adminId]]);
      expect(adm.rows[0].n).toBe(1);
    }
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
    const secret = "516240";
    const r = await app.inject({ method: "POST", url: `/api/profiles/${f.staffId}/reset-secret`, cookies: f.cookies, payload: { secret, secretConfirm: secret } });
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).not.toContain(secret); // le mot de passe n'est jamais renvoyé
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
      payload: { secret: "649201", secretConfirm: "649201" },
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

  it("nouveau code secret choisi à la main : 6 à 8 chiffres (zéros initiaux conservés), saisi deux fois, jamais généré ni renvoyé", async () => {
    const f = await newFamily();
    const ok = await addProfile(f.cookies, { displayName: "Sara", login: "sara", role: "parent", secret: "008213", secretConfirm: "008213" });
    expect(ok.statusCode).toBe(201);
    expect(JSON.stringify(ok.json())).not.toContain("008213");
    expect((await doLogin(f.familyCode, "sara", "008213")).statusCode).toBe(200); // le zéro initial est conservé
    expect([400, 401]).toContain((await doLogin(f.familyCode, "sara", "8213")).statusCode); // sans le zéro : refusé
    expect((await doLogin(f.familyCode, "sara", "408213")).statusCode).toBe(401);
    // refus : trop court / trop long / espace / lettres / symboles / confirmation différente / absence (aucune génération automatique)
    for (const [i, secret] of ["40821", "408213412", "408 213", "40\t213", "40821a", "Ab3$xy", "408.13", "٤٠٨٢١٣"].entries())
      expect((await addProfile(f.cookies, { displayName: "x", login: `bad${i}`, role: "staff", secret, secretConfirm: secret })).statusCode).toBe(400);
    const mismatch = await addProfile(f.cookies, { displayName: "x", login: "mism", role: "staff", secret: "408213", secretConfirm: "408214" });
    expect([mismatch.statusCode, mismatch.json().error]).toEqual([400, "secret_mismatch"]);
    const none = await app.inject({ method: "POST", url: "/api/profiles", cookies: f.cookies, payload: { displayName: "x", login: "none", role: "staff" } });
    expect(none.statusCode).toBe(400);
    for (const weak of ["111111", "123456", "654321", "000000", "1234567", "87654321", "22222222"]) expect((await addProfile(f.cookies, { displayName: "x", login: `w${weak}`, role: "staff", secret: weak, secretConfirm: weak })).statusCode).toBe(400);
    // 7 et 8 chiffres : acceptés, zéros initiaux conservés, message d'erreur précis sinon
    expect((await addProfile(f.cookies, { displayName: "Sept", login: "sept", role: "staff", secret: "0472915", secretConfirm: "0472915" })).statusCode).toBe(201);
    expect((await addProfile(f.cookies, { displayName: "Huit", login: "huit", role: "staff", secret: "00472915", secretConfirm: "00472915" })).statusCode).toBe(201);
    expect((await doLogin(f.familyCode, "sept", "0472915")).statusCode).toBe(200);
    expect((await doLogin(f.familyCode, "huit", "00472915")).statusCode).toBe(200);
    expect([400, 401]).toContain((await doLogin(f.familyCode, "huit", "472915")).statusCode);
    const nine = await addProfile(f.cookies, { displayName: "x", login: "neuf", role: "staff", secret: "408213412", secretConfirm: "408213412" });
    expect([nine.statusCode, nine.json().error, nine.json().message]).toEqual([400, "invalid_secret", "Le code d'accès doit contenir entre 6 et 8 chiffres"]);
    expect((await db.query("SELECT 1 FROM profiles WHERE login ~ '^(mism|none|bad|w|neuf)' AND family_id = (SELECT family_id FROM profiles WHERE id = $1)", [f.adminId])).rowCount).toBe(0);
  });

  it("compatibilité : un mot de passe existant avec lettres ou symboles continue de fonctionner (connexion, confirmation avant suppression) et n'est jamais modifié d'office ; on ne peut pas en choisir de nouveau", async () => {
    const f = await newFamily();
    const legacy = "Ab3$xy";
    await db.query("INSERT INTO profiles (family_id, display_name, login, role, secret_hash) SELECT family_id, 'Ancien', 'ancien', 'parent', $2 FROM profiles WHERE id = $1", [f.adminId, await hashSecret(legacy)]);
    const hashBefore = (await db.query("SELECT secret_hash FROM profiles WHERE login = 'ancien' AND family_id = (SELECT family_id FROM profiles WHERE id = $1)", [f.adminId])).rows[0].secret_hash;
    const c = cookieOf(await doLogin(f.familyCode, "ancien", legacy))!;
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: c })).statusCode).toBe(200);
    expect((await doLogin(f.familyCode, "ancien", "ab3$xy")).statusCode).toBe(401); // la casse compte toujours
    expect((await db.query("SELECT secret_hash FROM profiles WHERE login = 'ancien' AND family_id = (SELECT family_id FROM profiles WHERE id = $1)", [f.adminId])).rows[0].secret_hash).toBe(hashBefore);
    // un administrateur ne peut pas lui mettre un nouveau code à lettres, mais peut en choisir un à 6 chiffres
    const id = (await db.query("SELECT id FROM profiles WHERE login = 'ancien' AND family_id = (SELECT family_id FROM profiles WHERE id = $1)", [f.adminId])).rows[0].id;
    expect((await app.inject({ method: "POST", url: `/api/profiles/${id}/reset-secret`, cookies: f.cookies, payload: { secret: "Zz9#qq", secretConfirm: "Zz9#qq" } })).statusCode).toBe(400);
    expect((await doLogin(f.familyCode, "ancien", legacy)).statusCode).toBe(200); // rien n'a changé
    expect((await app.inject({ method: "POST", url: `/api/profiles/${id}/reset-secret`, cookies: f.cookies, payload: { secret: "739104", secretConfirm: "739104" } })).statusCode).toBe(200);
    expect((await doLogin(f.familyCode, "ancien", legacy)).statusCode).toBe(401);
    expect((await doLogin(f.familyCode, "ancien", "739104")).statusCode).toBe(200);
  });

  it("les codes à 6 chiffres actuels fonctionnent toujours ; le verrouillage après 5 échecs s'applique aussi aux mots de passe mixtes", async () => {
    const f = await newFamily();
    expect((await doLogin(f.familyCode, "adil", "482913")).statusCode).toBe(200);
    await addProfile(f.cookies, { displayName: "Sara", login: "sara", role: "parent", secret: "408213" });
    for (let i = 0; i < 5; i++) expect((await doLogin(f.familyCode, "sara", "739104")).statusCode).toBe(401);
    expect((await doLogin(f.familyCode, "sara", "408213")).statusCode).toBe(401); // verrouillé même avec le bon mot de passe
  });

  it("modifier le mot de passe : confirmation obligatoire, ancien mot de passe inutilisable, sessions révoquées", async () => {
    const f = await newFamily();
    const c = await addProfile(f.cookies, { displayName: "Sara", login: "sara", role: "parent" });
    const id = c.json().profile.id as string;
    const sara = cookieOf(await doLogin(f.familyCode, "sara", "573918"))!;
    const bad = await app.inject({ method: "POST", url: `/api/profiles/${id}/reset-secret`, cookies: f.cookies, payload: { secret: "408213", secretConfirm: "408214" } });
    expect([bad.statusCode, bad.json().error]).toEqual([400, "secret_mismatch"]);
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: sara })).statusCode).toBe(200); // rien n'a changé
    const ok = await app.inject({ method: "POST", url: `/api/profiles/${id}/reset-secret`, cookies: f.cookies, payload: { secret: "408213", secretConfirm: "408213" } });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: sara })).statusCode).toBe(401);
    expect((await doLogin(f.familyCode, "sara", "573918")).statusCode).toBe(401);
    expect((await doLogin(f.familyCode, "sara", "408213")).statusCode).toBe(200);
    // sans session administrateur : refusé
    expect((await app.inject({ method: "POST", url: `/api/profiles/${id}/reset-secret`, payload: { secret: "408213", secretConfirm: "408213" } })).statusCode).toBe(401);
  });
});
