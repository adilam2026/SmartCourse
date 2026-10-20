import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Db } from "../src/db.js";
import { proposeFromName, reserveExistingCodes } from "../src/family-id.js";
import type { Mailer, OutgoingMail, SendResult } from "../src/mail.js";
import { RecoveryService } from "../src/recovery.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

/** Identifiant famille de connexion, alias permanents et codes d'accès provisoires (évolution validée sur maquette, 10 écrans). */

class RecordingMailer implements Mailer {
  enabled = true;
  sent: OutgoingMail[] = [];
  async send(m: OutgoingMail): Promise<SendResult> {
    this.sent.push(m);
    return { accepted: true, messageId: `<m${this.sent.length}@test>` };
  }
}

let db: Db;
let app: FastifyInstance;
let mailer: RecordingMailer;
let recovery: RecoveryService;
let n = 0;
const OPEN = { perIpPerHour: 1000, globalPerHour: 1000, familiesPerDay: 1000, perEmailPerDay: 1000 };
const WIDE = { max: 1000, timeWindow: "1 minute" };

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  mailer = new RecordingMailer();
  recovery = new RecoveryService(db, mailer, "https://x.example", { resendCooldownSec: 0 });
  app = await buildApp({ db, store: testStore(), recovery, loginRateLimit: WIDE, signupRateLimit: WIDE, signupVerifyRateLimit: WIDE, signupLimits: OPEN, familyIdRateLimit: WIDE, recoveryRateLimit: WIDE });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

type Cookies = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
const post = (url: string, payload: object, cookies?: Cookies) => app.inject({ method: "POST", url, payload, ...(cookies ? { cookies } : {}) });
const put = (url: string, payload: object, cookies?: Cookies) => app.inject({ method: "PUT", url, payload, ...(cookies ? { cookies } : {}) });
const get = (url: string, cookies?: Cookies) => app.inject({ method: "GET", url, ...(cookies ? { cookies } : {}) });
const login = (familyCode: string, user: string, secret: string) => post("/api/auth/login", { familyCode, login: user, secret });
const check = (id: string, cookies?: Cookies) => post("/api/family-id/check", { id }, cookies);
const codeTo = (to: string) => mailer.sent.filter((m) => m.to === to).at(-1)!.text.match(/(\d{6})/)![1]!;
const count = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0].n);

async function startSignup(familyLoginId?: string, familyName = "Famille Test") {
  const email = `fid${++n}@example.org`;
  const s = await post("/api/signup/start", { requestId: randomUUID(), familyName, displayName: "Sara", login: "sara", city: "Casablanca", email, secret: "482913", secretConfirm: "482913", ...(familyLoginId ? { familyLoginId } : {}) });
  return { s, email };
}
async function createFamily(familyLoginId?: string, familyName?: string) {
  const { s, email } = await startSignup(familyLoginId, familyName);
  expect(s.statusCode).toBe(201);
  const v = await post("/api/signup/verify", { signupId: s.json().signupId, code: codeTo(email) });
  expect(v.statusCode).toBe(201);
  const familyId = v.json().me.familyId as string;
  return { familyCode: v.json().familyCode as string, loginId: v.json().loginId as string | null, admin: cookieOf(v), familyId, email };
}
async function addMember(admin: Cookies, user: string, extra: object = {}) {
  const r = await post("/api/profiles", { displayName: user, login: user, role: "parent", ...extra }, admin);
  expect(r.statusCode).toBe(201);
  return r.json() as { profile: { id: string }; provisional?: { code: string; expiresAt: string } };
}
/** Tout ce qui appartient à une famille, pour vérifier qu'un changement d'identifiant n'y touche pas. */
const familyFootprint = async (familyId: string) =>
  (await db.query(
    `SELECT (SELECT count(*) FROM profiles WHERE family_id = $1) p, (SELECT string_agg(secret_hash, ',' ORDER BY id) FROM profiles WHERE family_id = $1) h,
            (SELECT count(*) FROM lists WHERE family_id = $1) l, (SELECT count(*) FROM list_items WHERE family_id = $1) i, (SELECT count(*) FROM products WHERE family_id = $1) pr,
            (SELECT count(*) FROM finance_operations WHERE family_id = $1) o, (SELECT code FROM families WHERE id = $1) c, (SELECT name FROM families WHERE id = $1) nm`,
    [familyId],
  )).rows[0];

describe("identifiant famille : création", () => {
  it("proposition à partir du nom : accents retirés, mots collés avec majuscule, complétée si trop courte", () => {
    expect(proposeFromName("Famille Taha")).toBe("FamilleTaha");
    expect(proposeFromName("Les Taha")).toBe("LesTaha");
    expect(proposeFromName("Famille Hélène-Éa")).toBe("FamilleHeleneEa");
    expect(proposeFromName("Al")).toBe("FamilleAl");
    expect(proposeFromName("x".repeat(50))).toHaveLength(30);
  });

  it("création avec un identifiant choisi : connexion par l'identifiant (majuscules indifférentes) ET par le code famille", async () => {
    const f = await createFamily("LesTaha04", "Famille Taha");
    expect(f.loginId).toBe("LesTaha04");
    for (const id of ["LesTaha04", "lestaha04", "LESTAHA04", " LesTaha04 ", f.familyCode, f.familyCode.toLowerCase()]) expect((await login(id, "sara", "482913")).statusCode).toBe(200);
    const me = (await get("/api/me", f.admin)).json().me;
    expect(me.family).toMatchObject({ loginId: "LesTaha04", code: f.familyCode, name: "Famille Taha" });
    expect(me.mustChangeSecret).toBe(false);
  });

  it("disponibilité : règles de format, insensible à la casse, propositions disponibles ; rien sur la famille qui l'utilise", async () => {
    await createFamily("Dispo_Test");
    for (const bad of ["abc", "a".repeat(31), "Famille Taha", "Hélène", "taha-04", "taha.04", ""]) expect((await check(bad)).json()).toMatchObject({ valid: false, available: false });
    expect((await check("Libre_2026")).json()).toEqual({ valid: true, available: true, suggestions: [] });
    const taken = (await check("dispo_TEST")).json();
    expect(Object.keys(taken).sort()).toEqual(["available", "message", "suggestions", "valid"]);
    expect(taken).toMatchObject({ valid: true, available: false, message: "Cet identifiant famille est déjà utilisé" });
    expect(taken.suggestions).toHaveLength(3);
    for (const s of taken.suggestions) {
      expect(s).toMatch(/^[A-Za-z0-9_]{4,30}$/);
      expect((await check(s)).json().available).toBe(true);
    }
  });

  it("identifiant déjà pris au démarrage : 409 avec propositions, aucun e-mail envoyé", async () => {
    await createFamily("PrisAuDepart");
    const before = mailer.sent.length;
    const { s } = await startSignup("prisaudepart");
    expect([s.statusCode, s.json().error, s.json().message]).toEqual([409, "family_id_taken", "Cet identifiant famille est déjà utilisé"]);
    expect(s.json().suggestions).toHaveLength(3);
    expect(mailer.sent.length).toBe(before);
  });

  it("identifiant pris entre la demande et la validation : rien n'est créé, propositions renvoyées, la demande reste ouverte", async () => {
    const a = await startSignup("CourseAuNom");
    const b = await startSignup("courseaunom");
    expect([a.s.statusCode, b.s.statusCode]).toEqual([201, 201]); // libre au moment des deux demandes
    const families = await count("SELECT count(*) n FROM families");
    expect((await post("/api/signup/verify", { signupId: a.s.json().signupId, code: codeTo(a.email) })).statusCode).toBe(201);
    const late = await post("/api/signup/verify", { signupId: b.s.json().signupId, code: codeTo(b.email) });
    expect([late.statusCode, late.json().error]).toEqual([409, "family_id_taken"]);
    expect(late.json().suggestions.length).toBeGreaterThan(0);
    expect(await count("SELECT count(*) n FROM families")).toBe(families + 1);
    const row = (await db.query("SELECT completed_at, attempts FROM family_signups WHERE id = $1", [b.s.json().signupId])).rows[0];
    expect(row).toEqual({ completed_at: null, attempts: 0 });
  });

  it("validations simultanées de deux familles avec le même identifiant : une seule réussit", async () => {
    const a = await startSignup("EnMemeTemps");
    const b = await startSignup("ENMEMETEMPS");
    const [ra, rb] = await Promise.all([
      post("/api/signup/verify", { signupId: a.s.json().signupId, code: codeTo(a.email) }),
      post("/api/signup/verify", { signupId: b.s.json().signupId, code: codeTo(b.email) }),
    ]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([201, 409]);
    expect(await count("SELECT count(*) n FROM family_aliases WHERE alias_hash = sha256(convert_to('enmemetemps','UTF8'))")).toBe(1);
  });

  it("ancienne application (sans identifiant) : la famille est créée comme avant et pourra choisir son identifiant plus tard", async () => {
    const f = await createFamily(undefined, "Famille Ancienne");
    expect(f.loginId).toBeNull();
    expect((await login(f.familyCode, "sara", "482913")).statusCode).toBe(200);
    expect((await get("/api/family/login-id", f.admin)).json()).toMatchObject({ loginId: null, code: f.familyCode, proposal: "FamilleAncienne" });
  });

  it("un identifiant ne peut pas reprendre le code famille d'une autre famille (et inversement, les codes sont réservés)", async () => {
    const other = await createFamily();
    expect((await check(other.familyCode.toLowerCase())).json().available).toBe(false);
    const { s } = await startSignup(other.familyCode);
    expect(s.statusCode).toBe(409);
    expect(await count("SELECT count(*) n FROM families f WHERE NOT EXISTS (SELECT 1 FROM family_aliases a WHERE a.family_id = f.id AND a.kind = 'code' AND a.alias = f.code)")).toBe(0);
  });
});

describe("identifiant famille : familles existantes, changement et alias permanents", () => {
  it("choix puis changements : anciens identifiants et code famille restent valables ; membres, listes, budget et historique intacts", async () => {
    const f = await createFamily(undefined, "Famille Martin");
    const m = await addMember(f.admin, "karim", { secret: "573918", secretConfirm: "573918" });
    expect(m.provisional).toBeUndefined();
    await post("/api/lists", {}, f.admin);
    const before = await familyFootprint(f.familyId);
    expect((await put("/api/family/login-id", { loginId: "Martin_2026" }, f.admin)).json()).toEqual({ loginId: "Martin_2026" });
    expect((await put("/api/family/login-id", { loginId: "LesMartin" }, f.admin)).json()).toEqual({ loginId: "LesMartin" });
    for (const id of ["LesMartin", "martin_2026", f.familyCode]) {
      expect((await login(id, "karim", "573918")).statusCode).toBe(200);
      expect((await login(id, "sara", "482913")).statusCode).toBe(200);
    }
    expect(await familyFootprint(f.familyId)).toEqual(before);
    expect((await db.query("SELECT kind, alias FROM family_aliases WHERE family_id = $1 ORDER BY created_at", [f.familyId])).rows.map((r) => `${r.kind}:${r.alias}`)).toEqual([`code:${f.familyCode}`, "former:Martin_2026", "current:LesMartin"]);
    // Ancien identifiant : jamais disponible pour une autre famille, toujours libre pour la sienne
    const intruder = await createFamily();
    expect((await check("Martin_2026", intruder.admin)).json().available).toBe(false);
    const steal = await put("/api/family/login-id", { loginId: "martin_2026" }, intruder.admin);
    expect([steal.statusCode, steal.json().error, steal.json().suggestions.length]).toEqual([409, "family_id_taken", 3]);
    expect((await check("Martin_2026", f.admin)).json().available).toBe(true);
    expect((await put("/api/family/login-id", { loginId: "Martin_2026" }, f.admin)).json()).toEqual({ loginId: "Martin_2026" });
    expect((await db.query("SELECT kind, alias FROM family_aliases WHERE family_id = $1 AND kind <> 'code' ORDER BY alias", [f.familyId])).rows.map((r) => `${r.kind}:${r.alias}`)).toEqual(["former:LesMartin", "current:Martin_2026"]);
    // Changement de majuscules seulement : même identifiant, aucune nouvelle ligne
    expect((await put("/api/family/login-id", { loginId: "MARTIN_2026" }, f.admin)).json()).toEqual({ loginId: "MARTIN_2026" });
    expect(await count("SELECT count(*) n FROM family_aliases WHERE family_id = $1", [f.familyId])).toBe(3);
    // Le code famille d'origine ne peut pas devenir l'identifiant (il l'est déjà, à part)
    expect((await put("/api/family/login-id", { loginId: f.familyCode }, f.admin)).statusCode).toBe(409);
    expect((await get("/api/family/login-id", f.admin)).json().loginId).toBe("MARTIN_2026");
    expect(await count("SELECT count(*) n FROM audit_log WHERE family_id = $1 AND action = 'family.login_id_set'", [f.familyId])).toBe(4);
  });

  it("deux familles demandent le même identifiant au même moment : une seule l'obtient", async () => {
    const fams = await Promise.all([createFamily(), createFamily(), createFamily(), createFamily()]);
    const res = await Promise.all(fams.map((f) => put("/api/family/login-id", { loginId: "Course_Rapide" }, f.admin)));
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 409, 409, 409]);
    expect(await count("SELECT count(*) n FROM family_aliases WHERE lower(alias) = 'course_rapide'")).toBe(1);
  });

  it("réservé aux administrateurs ; un membre ou une autre famille ne peut rien changer", async () => {
    const f = await createFamily();
    const m = await addMember(f.admin, "lea", { secret: "573918", secretConfirm: "573918" });
    expect(m.profile.id).toBeTruthy();
    const lea = cookieOf(await login(f.familyCode, "lea", "573918"));
    expect((await put("/api/family/login-id", { loginId: "PasLeDroit" }, lea)).statusCode).toBe(403);
    expect((await get("/api/family/login-id", lea)).statusCode).toBe(403);
    expect((await put("/api/family/login-id", { loginId: "PasLeDroit" })).statusCode).toBe(401);
    expect((await put("/api/family/login-id", { loginId: "é_invalide" }, f.admin)).json().error).toBe("invalid_family_id");
  });

  it("isolation : connaître l'identifiant d'une famille ne donne aucun accès ; message générique identique", async () => {
    const a = await createFamily("Isole_A");
    const b = await createFamily("Isole_B");
    await addMember(b.admin, "intrus", { secret: "573918", secretConfirm: "573918" });
    const wrongFamily = await login("Isole_A", "intrus", "573918"); // membre de B, identifiant de A
    const wrongCode = await login("Isole_A", "sara", "999999");
    const unknownFamily = await login("Inconnue_42", "sara", "482913");
    for (const r of [wrongFamily, wrongCode, unknownFamily]) expect([r.statusCode, r.json()]).toEqual([401, { error: "invalid_credentials", message: "Identifiants invalides ou accès temporairement bloqué" }]);
    // Une session de A ne voit que A
    const profilesA = (await get("/api/profiles", a.admin)).json().profiles.map((p: { login: string }) => p.login);
    expect(profilesA).toEqual(["sara"]);
    expect((await get("/api/family/login-id", a.admin)).json().loginId).toBe("Isole_A");
  });

  it("suppression d'une famille : seule l'empreinte de ses identifiants reste, ils ne sont jamais réattribués", async () => {
    const f = await createFamily("Disparue_1");
    await put("/api/family/login-id", { loginId: "Disparue_2" }, f.admin);
    const r = await post("/api/family/reset", { password: "482913", confirmCode: f.familyCode }, f.admin);
    expect(r.statusCode).toBe(200);
    expect((await db.query("SELECT alias, family_id FROM family_aliases WHERE alias_hash IN (sha256(convert_to('disparue_1','UTF8')), sha256(convert_to('disparue_2','UTF8')), sha256(convert_to(lower($1),'UTF8')))", [f.familyCode])).rows).toEqual([
      { alias: null, family_id: null },
      { alias: null, family_id: null },
      { alias: null, family_id: null },
    ]);
    expect((await login("Disparue_1", "sara", "482913")).statusCode).toBe(401);
    expect((await check("Disparue_2")).json().available).toBe(false);
  });

  it("retour arrière : une famille créée par l'ancien serveur (sans alias) se connecte avec son code et est réservée au redémarrage", async () => {
    const f = await createFamily();
    await db.query("DELETE FROM family_aliases WHERE family_id = $1", [f.familyId]); // ce que laisserait l'ancien serveur
    expect((await login(f.familyCode, "sara", "482913")).statusCode).toBe(200);
    expect(await reserveExistingCodes(db)).toBe(1);
    expect(await reserveExistingCodes(db)).toBe(0); // idempotent
    expect((await check(f.familyCode)).json().available).toBe(false);
  });

  it("vérifications de disponibilité limitées par adresse IP", async () => {
    const limited = await buildApp({ db, store: testStore(), recovery, familyIdRateLimit: { max: 3, timeWindow: "1 minute" } });
    await limited.ready();
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await limited.inject({ method: "POST", url: "/api/family-id/check", payload: { id: `Essai_${i}` } })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
    await limited.close();
  });
});

describe("codes d'accès provisoires des nouveaux membres", () => {
  it("création sans code : code provisoire de 6 chiffres renvoyé une seule fois, valable 7 jours ; première connexion limitée au choix du code", async () => {
    const f = await createFamily("Provisoire_1");
    const m = await addMember(f.admin, "karim");
    expect(m.provisional!.code).toMatch(/^\d{6}$/);
    const days = (Date.parse(m.provisional!.expiresAt) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect(JSON.stringify((await get("/api/profiles", f.admin)).json())).not.toContain(m.provisional!.code);
    const first = await login("Provisoire_1", "karim", m.provisional!.code);
    expect(first.statusCode).toBe(200);
    expect(first.json().me.mustChangeSecret).toBe(true);
    const k = cookieOf(first);
    expect((await get("/api/me", k)).json().me.mustChangeSecret).toBe(true);
    for (const url of ["/api/lists/active", "/api/catalog", "/api/budget"]) expect((await get(url, k)).json().error).toBe("secret_change_required");
    // usage unique : le même code ne permet pas une seconde connexion
    expect((await login("Provisoire_1", "karim", m.provisional!.code)).statusCode).toBe(401);
    // choix du code personnel
    expect((await post("/api/me/secret", { secret: m.provisional!.code, secretConfirm: m.provisional!.code }, k)).json().error).toBe("same_as_provisional");
    expect((await post("/api/me/secret", { secret: "70315826", secretConfirm: "70315827" }, k)).json().error).toBe("secret_mismatch");
    expect((await post("/api/me/secret", { secret: "123456", secretConfirm: "123456" }, k)).json().error).toBe("weak_secret");
    expect((await post("/api/me/secret", { secret: "70315826", secretConfirm: "70315826" }, k)).statusCode).toBe(200);
    expect((await get("/api/lists/active", k)).statusCode).toBe(200); // même session, désormais complète
    expect((await get("/api/me", k)).json().me.mustChangeSecret).toBe(false);
    expect((await login("provisoire_1", "karim", "70315826")).statusCode).toBe(200);
    expect((await login("provisoire_1", "karim", m.provisional!.code)).statusCode).toBe(401);
    expect((await post("/api/me/secret", { secret: "70315829", secretConfirm: "70315829" }, k)).json().error).toBe("no_provisional_code");
    // le code personnel n'est jamais renvoyé ni stocké en clair
    expect(await count("SELECT count(*) n FROM profiles WHERE secret_hash LIKE '%70315826%'")).toBe(0);
  });

  it("famille au pays confirmé (règle de production : ville obligatoire) : un membre ajouté sans ville hérite de celle de la famille", async () => {
    const strict = await buildApp({ db, store: testStore(), recovery, requireCity: true, loginRateLimit: WIDE });
    await strict.ready();
    const f = await createFamily(); // créée au Maroc, Casablanca : pays confirmé
    const r = await strict.inject({ method: "POST", url: "/api/profiles", cookies: f.admin, payload: { displayName: "Sami", login: "sami", role: "staff" } });
    expect([r.statusCode, r.json().profile?.city, /^\d{6}$/.test(r.json().provisional?.code ?? "")]).toEqual([201, "Casablanca", true]);
    // Pays non confirmé (famille ancienne) : la ville reste demandée, comme avant
    await db.query("UPDATE families SET location_confirmed_at = NULL WHERE id = $1", [f.familyId]);
    const r2 = await strict.inject({ method: "POST", url: "/api/profiles", cookies: f.admin, payload: { displayName: "Sara2", login: "sara2", role: "staff" } });
    expect([r2.statusCode, r2.json().error]).toEqual([400, "city_required"]);
    await strict.close();
  });

  it("connexions simultanées avec le même code provisoire : une seule réussit", async () => {
    const f = await createFamily();
    const m = await addMember(f.admin, "nadia");
    const res = await Promise.all(Array.from({ length: 6 }, () => login(f.familyCode, "nadia", m.provisional!.code)));
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(res.filter((r) => r.statusCode === 401)).toHaveLength(5);
  });

  it("expiration après 7 jours : même message générique qu'un code faux", async () => {
    const f = await createFamily();
    const m = await addMember(f.admin, "omar");
    await db.query("UPDATE profiles SET secret_expires_at = now() - interval '1 minute' WHERE id = $1", [m.profile.id]);
    const r = await login(f.familyCode, "omar", m.provisional!.code);
    expect([r.statusCode, r.json().error]).toEqual([401, "invalid_credentials"]);
  });

  it("nouveau code provisoire : l'ancien (provisoire ou personnel) cesse aussitôt de fonctionner, les sessions du membre sont fermées", async () => {
    const f = await createFamily();
    const m = await addMember(f.admin, "yasmine");
    const r1 = await post(`/api/profiles/${m.profile.id}/provisional-code`, {}, f.admin);
    expect(r1.statusCode).toBe(200);
    const p1 = r1.json().provisional.code as string;
    expect((await login(f.familyCode, "yasmine", m.provisional!.code)).statusCode).toBe(401); // l'ancien provisoire, jamais utilisé
    const s = cookieOf(await login(f.familyCode, "yasmine", p1));
    expect((await post("/api/me/secret", { secret: "48153926", secretConfirm: "48153926" }, s)).statusCode).toBe(200);
    // code personnel oublié : l'administrateur génère un nouveau code provisoire
    const p2 = (await post(`/api/profiles/${m.profile.id}/provisional-code`, {}, f.admin)).json().provisional.code as string;
    expect((await get("/api/me", s)).statusCode).toBe(401); // session fermée
    expect((await login(f.familyCode, "yasmine", "48153926")).statusCode).toBe(401); // code personnel remplacé
    expect((await login(f.familyCode, "yasmine", p1)).statusCode).toBe(401);
    expect((await login(f.familyCode, "yasmine", p2)).json().me.mustChangeSecret).toBe(true);
  });

  it("protections : pas pour soi-même, jamais pour une autre famille, jamais par un non-administrateur", async () => {
    const a = await createFamily();
    const b = await createFamily();
    const mb = await addMember(b.admin, "ines");
    const adminA = (await get("/api/me", a.admin)).json().me.id;
    expect((await post(`/api/profiles/${adminA}/provisional-code`, {}, a.admin)).json().error).toBe("use_own_code");
    expect((await post(`/api/profiles/${mb.profile.id}/provisional-code`, {}, a.admin)).statusCode).toBe(404);
    const ma = await addMember(a.admin, "rayan", { role: "parent", secret: "573918", secretConfirm: "573918" });
    const parent = cookieOf(await login(a.familyCode, "rayan", "573918"));
    expect((await post(`/api/profiles/${ma.profile.id}/provisional-code`, {}, parent)).statusCode).toBe(403);
  });

  it("compatibilité : un administrateur de l'ancienne application choisit encore un code permanent ; les comptes existants ne changent pas", async () => {
    const f = await createFamily();
    const m = await addMember(f.admin, "ancien", { secret: "573918", secretConfirm: "573918" });
    expect(m.provisional).toBeUndefined();
    const r = await login(f.familyCode, "ancien", "573918");
    expect(r.json().me.mustChangeSecret).toBe(false);
    expect((await login(f.familyCode, "ancien", "573918")).statusCode).toBe(200); // pas d'usage unique pour un code permanent
    expect((await get("/api/lists/active", cookieOf(r))).statusCode).toBe(200);
  });
});

describe("récupération par e-mail (inchangée, identifiant en plus)", () => {
  it("le code famille reçu par e-mail mentionne l'identifiant ; « code oublié » accepte l'identifiant ou le code", async () => {
    const f = await createFamily("Rappel_Mail");
    mailer.sent.length = 0;
    await post("/api/auth/forgot-family-code", { email: f.email });
    await recovery.idle();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.text).toContain("Rappel_Mail");
    expect(mailer.sent[0]!.text).toContain(f.familyCode);
    for (const familyCode of ["rappel_mail", f.familyCode]) {
      mailer.sent.length = 0;
      await post("/api/auth/forgot-password", { email: f.email, familyCode });
      await recovery.idle();
      expect(mailer.sent.map((m) => m.to)).toEqual([f.email]);
    }
    mailer.sent.length = 0;
    await post("/api/auth/forgot-password", { email: f.email, familyCode: "Autre_Famille" });
    await recovery.idle();
    expect(mailer.sent).toHaveLength(0);
  });
});
