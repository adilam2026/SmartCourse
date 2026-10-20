import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import { purgeFamily } from "../src/family-purge.js";
import type { Db } from "../src/db.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

/**
 * Cible de retour arrière après la migration 026 (serveur 025 + correctif minimal) : les identifiants famille restent utilisables,
 * et un code d'accès PROVISOIRE n'ouvre jamais de session (ce serveur ne sait ni le faire expirer ni imposer le choix du code).
 */
let db: Db;
let app: FastifyInstance;
let n = 0;
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, store: testStore(), loginRateLimit: { max: 1000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
const login = (familyCode: string, login: string, secret: string) => app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login, secret } });
const key = (s: string) => createHash("sha256").update(s.toLowerCase()).digest();

async function family() {
  const installToken = await generateInstallToken(db);
  const r = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken, familyName: `Famille ${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  expect(r.statusCode).toBe(201);
  const familyId = r.json().me.familyId as string;
  const code = r.json().familyCode as string;
  // Ce qu'aurait laissé le nouveau serveur : code réservé et identifiant choisi (puis un ancien identifiant)
  await db.query("INSERT INTO family_aliases (alias_hash, alias, family_id, kind) VALUES ($1,$2,$3,'code'),($4,$5,$3,'former'),($6,$7,$3,'current')", [key(code), code, familyId, key(`Ancien_${n}`), `Ancien_${n}`, key(`Actuel_${n}`), `Actuel_${n}`]);
  return { familyId, code, admin: cookieOf(r), n };
}

describe("retour arrière : serveur 025 compatible 026", () => {
  it("connexion par code famille, identifiant actuel ou ancien identifiant (majuscules indifférentes)", async () => {
    const f = await family();
    for (const id of [f.code, `actuel_${f.n}`, `ANCIEN_${f.n}`]) expect((await login(id, "adil", "482913")).statusCode).toBe(200);
    expect((await login("Inconnu_9", "adil", "482913")).statusCode).toBe(401);
  });

  it("code provisoire non remplacé : jamais de session (même réponse qu'un code faux), membre et données intacts ; l'administrateur peut le débloquer", async () => {
    const f = await family();
    const m = await app.inject({ method: "POST", url: "/api/profiles", cookies: f.admin, payload: { displayName: "Lina", login: "lina", role: "parent", secret: "573918", secretConfirm: "573918" } });
    const id = m.json().profile.id as string;
    // Code provisoire donné par le nouveau serveur, valable, jamais utilisé
    await db.query("UPDATE profiles SET secret_temporary = true, secret_expires_at = now() + interval '7 days', secret_used_at = NULL WHERE id = $1", [id]);
    const tried = await login(f.code, "lina", "573918");
    const wrong = await login(f.code, "lina", "000111");
    expect([tried.statusCode, tried.json()]).toEqual([401, wrong.json()]);
    expect((await db.query("SELECT count(*)::int n FROM profiles WHERE id = $1 AND deleted_at IS NULL AND active", [id])).rows[0].n).toBe(1);
    // Déblocage pendant le retour arrière : l'administrateur choisit un code (comme avant) ; le statut provisoire est levé
    expect((await app.inject({ method: "POST", url: `/api/profiles/${id}/reset-secret`, cookies: f.admin, payload: { secret: "739104", secretConfirm: "739104" } })).statusCode).toBe(200);
    expect((await db.query("SELECT secret_temporary FROM profiles WHERE id = $1", [id])).rows[0].secret_temporary).toBe(false);
    expect((await login(f.code, "lina", "739104")).statusCode).toBe(200);
  });

  it("suppression d'une famille : identifiants réduits à leur empreinte, jamais réattribués", async () => {
    const f = await family();
    await purgeFamily(db, testStore(), f.familyId, f.code);
    const rows = (await db.query("SELECT alias, family_id FROM family_aliases WHERE alias_hash = ANY($1)", [[key(f.code), key(`Ancien_${f.n}`), key(`Actuel_${f.n}`)]])).rows;
    expect(rows).toEqual([{ alias: null, family_id: null }, { alias: null, family_id: null }, { alias: null, family_id: null }]);
    expect((await login(`Actuel_${f.n}`, "adil", "482913")).statusCode).toBe(401);
  });
});
