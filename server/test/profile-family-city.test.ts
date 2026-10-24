import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, store: testStore(), requireCity: true });
  await app.ready();
});
afterAll(async () => { await app?.close(); await closeTestDb(); });

async function family(country: string | null, city: string | null, confirmed: boolean) {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: {
    installToken: await generateInstallToken(db), familyName: "Famille recette",
    admin: { displayName: "Admin", login: "admin", secret: "482913", city: "Casablanca" },
  } });
  expect(res.statusCode).toBe(201);
  const cookies = { sc_session: res.cookies.find(c => c.name === "sc_session")!.value };
  const me = (await app.inject({ method: "GET", url: "/api/me", cookies })).json().me;
  await db.query("UPDATE families SET country=$2, city=$3, location_confirmed_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE id=$1", [me.familyId, country, city, confirmed]);
  return { cookies, familyId: me.familyId };
}
const member = { displayName: "Test", login: "test", role: "staff", secret: "573918", secretConfirm: "573918" };

describe("création de profil avec la règle de ville de production", () => {
  it.each(["staff", "parent", "admin"])("Maroc confirmé : %s hérite de la ville sans la ressaisir", async role => {
    const f = await family("MA", "Rabat", true);
    const res = await app.inject({ method: "POST", url: "/api/profiles", cookies: f.cookies, payload: { ...member, role } });
    expect(res.statusCode).toBe(201);
    expect(res.json().profile.city).toBe("Rabat");
    expect((await db.query("SELECT family_id, city FROM profiles WHERE id=$1", [res.json().profile.id])).rows[0]).toMatchObject({ family_id: f.familyId, city: "Rabat" });
  });
  it("hors Maroc confirmé : crée un membre sans ville", async () => {
    const f = await family("FR", null, true);
    const res = await app.inject({ method: "POST", url: "/api/profiles", cookies: f.cookies, payload: member });
    expect(res.statusCode).toBe(201);
    expect(res.json().profile.city).toBeNull();
  });
  it("famille non confirmée : conserve la validation existante et ne crée aucun profil en cas de refus", async () => {
    const f = await family(null, null, false);
    const res = await app.inject({ method: "POST", url: "/api/profiles", cookies: f.cookies, payload: member });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("city_required");
    expect((await db.query("SELECT count(*)::int n FROM profiles WHERE family_id=$1", [f.familyId])).rows[0].n).toBe(1);
  });
  it("valide toujours une ville explicitement saisie", async () => {
    const f = await family("MA", "Casablanca", true);
    const res = await app.inject({ method: "POST", url: "/api/profiles", cookies: f.cookies, payload: { ...member, city: "Atlantide" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_city");
  });
});
