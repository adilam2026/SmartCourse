import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

let db: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  app = await buildApp({ db, store: testStore(), loginRateLimit: { max: 1000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => { await app.close(); await closeTestDb(); });

// Retour arrière vers l'ancien serveur sur le schéma 025, famille ayant activé « plusieurs listes » avec deux listes en cours.
it("ancien serveur : toujours la liste en cours la plus récente ; l'autre liste et ses articles restent intacts", async () => {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: "Retour", admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const c = { sc_session: res.cookies.find((x) => x.name === "sc_session")!.value };
  const products = (await app.inject({ method: "GET", url: "/api/catalog", cookies: c })).json().categories.flatMap((x: any) => x.products);
  const tom = products.find((p: any) => p.name === "Tomates").id;
  await app.inject({ method: "POST", url: "/api/lists/active/ops", cookies: c, payload: { ops: [{ opId: randomUUID(), type: "add", productId: tom, quantity: 2 }] } });
  const first = (await app.inject({ method: "GET", url: "/api/lists/active", cookies: c })).json().list.id;
  const fam = (await db.query("SELECT family_id, created_by FROM lists WHERE id = $1", [first])).rows[0];
  await db.query("UPDATE families SET multi_lists_enabled = true WHERE id = $1", [fam.family_id]);
  const second = (await db.query("INSERT INTO lists (family_id, status, created_by, created_at, name) VALUES ($1,'active',$2, now() + interval '1 minute','Souk') RETURNING id", [fam.family_id, fam.created_by])).rows[0].id;
  for (let i = 0; i < 5; i++) expect((await app.inject({ method: "GET", url: "/api/lists/active", cookies: c })).json().list.id).toBe(second);
  await app.inject({ method: "POST", url: "/api/lists/active/ops", cookies: c, payload: { ops: [{ opId: randomUUID(), type: "add", productId: tom, quantity: 1 }] } });
  const count = async (id: string) => Number((await db.query("SELECT count(*) AS n FROM list_items WHERE list_id = $1", [id])).rows[0].n);
  expect(await count(first)).toBe(1); // intacte
  expect(await count(second)).toBe(1);
  expect((await db.query("SELECT status FROM lists WHERE id = $1", [first])).rows[0].status).toBe("active");
});
