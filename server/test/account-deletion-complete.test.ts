import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { purgeFamily } from "../src/family-purge.js";
import { purgeOldSignups } from "../src/signup.js";
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
const login = (code: string, l: string, secret: string) => app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: code, login: l, secret } });

async function family() {
  const r = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `G${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const code = r.json().familyCode as string;
  const admin = cookieOf(r);
  const familyId = (await db.query("SELECT id FROM families WHERE code = $1", [code])).rows[0].id as string;
  const add = async (login: string, role: string, secret = "573918") =>
    (await app.inject({ method: "POST", url: "/api/profiles", cookies: admin, payload: { displayName: login.toUpperCase(), login, role, secret, secretConfirm: secret } })).json().profile.id as string;
  return { code, admin, add, familyId, adminId: r.json().me.id as string };
}

/** Une demande de création de famille rattachée (comme après une création par l'application). */
async function signupRow(familyId: string | null, profileId: string | null, email: string, ageDays = 0) {
  await db.query(
    `INSERT INTO family_signups (request_id, email, email_hash, family_name, display_name, login, city, secret_hash, code_hash, expires_at, completed_at, family_id, profile_id, created_at)
     VALUES ($1,$2,$3,'Famille','Prénom','login','Casablanca','x','y', now(), now(), $4, $5, now() - make_interval(days => $6))`,
    [randomUUID(), email, `h-${randomUUID()}`, familyId, profileId, ageDays],
  );
}

describe("suppression de compte complète", () => {
  it("compte personnel : rien de personnel ne reste rattaché (ville, jetons, journal des e-mails, demande de création)", async () => {
    const f = await family();
    const sam = await f.add("sam", "admin");
    await db.query("UPDATE profiles SET city = 'Rabat' WHERE id = $1", [sam]);
    await db.query("INSERT INTO auth_tokens (purpose, profile_id, email, token_hash, expires_at) VALUES ('verify_email', $1, 'sam@example.org', $2, now() + interval '1 hour')", [sam, `t-${randomUUID()}`]);
    await db.query("INSERT INTO email_log (kind, profile_id, recipient_hash, recipient_masked, status) VALUES ('verify_email', $1, 'h', 's***@example.org', 'accepted')", [sam]);
    await signupRow(f.familyId, sam, "sam@example.org");
    const c = cookieOf(await login(f.code, "sam", "573918"));
    expect((await app.inject({ method: "POST", url: "/api/me/delete", cookies: c, payload: { secret: "573918" } })).statusCode).toBe(200);
    const p = (await db.query("SELECT display_name, city, recovery_email, deleted_at FROM profiles WHERE id = $1", [sam])).rows[0];
    expect(p).toMatchObject({ display_name: "Ancien profil", city: null, recovery_email: null });
    for (const t of ["auth_tokens", "email_log", "family_signups"]) expect((await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE profile_id = $1`, [sam])).rows[0].n).toBe(0);
    expect((await login(f.code, "sam", "573918")).statusCode).toBe(401); // reconnexion refusée
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: c })).statusCode).toBe(401); // session fermée
    expect((await login(f.code, "adil", "482913")).statusCode).toBe(200); // les autres membres restent
  });

  it("administrateur principal : transfert du rôle à un administrateur actif, puis suppression de son seul compte", async () => {
    const f = await family();
    await db.query("UPDATE profiles SET recovery_email = 'adil@example.org', recovery_email_verified_at = now() WHERE id = $1", [f.adminId]);
    const sam = await f.add("sam", "admin");
    const lea = await f.add("lea", "parent");
    // Le profil principal ne se supprime pas seul
    expect((await app.inject({ method: "POST", url: "/api/me/delete", cookies: f.admin, payload: { secret: "482913" } })).json().error).toBe("primary_cannot_delete");
    // Transfert : code retapé, cible administrateur active de la même famille
    const t = (to: string, secret = "482913", cookies = f.admin) => app.inject({ method: "POST", url: "/api/family/transfer-primary", cookies, payload: { toProfileId: to, secret } });
    expect((await t(sam, "111222")).statusCode).toBe(403);
    expect((await t(lea)).json().error).toBe("target_not_admin");
    expect((await t(f.adminId)).json().error).toBe("same_profile");
    const other = await family();
    expect((await t(other.adminId)).statusCode).toBe(404); // autre famille : intouchable
    const samCookie = cookieOf(await login(f.code, "sam", "573918"));
    expect((await t(lea, "573918", samCookie)).statusCode).toBe(403); // un administrateur non principal ne transfère pas
    const ok = await t(sam);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().profile).toMatchObject({ id: sam, primary: true });
    const rows = (await db.query("SELECT id, is_primary, recovery_email FROM profiles WHERE id = ANY($1)", [[f.adminId, sam]])).rows;
    expect(rows.find((r) => r.id === f.adminId)).toMatchObject({ is_primary: false, recovery_email: null });
    expect(rows.find((r) => r.id === sam)).toMatchObject({ is_primary: true });
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: samCookie })).json().me.primary).toBe(true);
    // L'ancien administrateur principal peut maintenant supprimer son seul compte ; la famille et les autres restent
    expect((await app.inject({ method: "POST", url: "/api/me/delete", cookies: f.admin, payload: { secret: "482913" } })).statusCode).toBe(200);
    expect((await login(f.code, "adil", "482913")).statusCode).toBe(401);
    expect((await login(f.code, "sam", "573918")).statusCode).toBe(200);
    expect((await login(f.code, "lea", "573918")).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/profiles", cookies: samCookie })).json().profiles.map((p: any) => p.login).sort()).toEqual(["lea", "sam"]);
  });

  it("toute la famille : la demande de création (adresse, prénom) est effacée avec elle", async () => {
    const f = await family();
    await signupRow(f.familyId, f.adminId, "famille@example.org");
    const keep = await family();
    await signupRow(keep.familyId, keep.adminId, "autre@example.org");
    await purgeFamily(db, testStore(), f.familyId, f.code);
    expect((await db.query("SELECT count(*)::int AS n FROM family_signups WHERE email = 'famille@example.org'")).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM family_signups WHERE email = 'autre@example.org'")).rows[0].n).toBe(1);
  });

  it("conservation : demandes de création et e-mails de code effacés après 30 jours", async () => {
    await signupRow(null, null, "vieux@example.org", 31);
    await signupRow(null, null, "recent@example.org", 2);
    await db.query("INSERT INTO email_log (kind, recipient_hash, recipient_masked, status, created_at) VALUES ('signup_code', 'old', 'v***@example.org', 'accepted', now() - interval '31 days'), ('signup_code', 'new', 'r***@example.org', 'accepted', now())");
    await purgeOldSignups(db);
    expect((await db.query("SELECT email FROM family_signups WHERE email IN ('vieux@example.org', 'recent@example.org')")).rows.map((r) => r.email)).toEqual(["recent@example.org"]);
    expect((await db.query("SELECT recipient_hash FROM email_log WHERE kind = 'signup_code' AND recipient_hash IN ('old', 'new')")).rows.map((r) => r.recipient_hash)).toEqual(["new"]);
  });
});
