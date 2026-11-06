import { generateKeyPairSync, randomUUID, verify } from "node:crypto";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApnsClient, apnsBody, apnsConfigFromEnv, apnsEndpoint, parseApnsEndpoint } from "../src/apns.js";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { SseHub } from "../src/hub.js";
import { PushService, type PushPayload, type PushSender } from "../src/push.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

type Cookies = { sc_session: string };
let db: Db;
let app: FastifyInstance;
let push: PushService;
let n = 0;
const web: { endpoint: string }[] = [];
const iphone: { endpoint: string; payload: PushPayload }[] = [];
const scripted = new Map<string, number[]>();
const sender: PushSender = async (sub) => (web.push({ endpoint: sub.endpoint }), { statusCode: 201 });
const apnsSender: PushSender = async (sub, payload) => {
  iphone.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  return { statusCode: scripted.get(sub.endpoint)?.shift() ?? 200 };
};

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  push = new PushService(db, { sender, apnsSender });
  app = await buildApp({ db, hub: new SseHub(), store: testStore(), push, loginRateLimit: { max: 10_000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
async function newFamily() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `A${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const familyCode = res.json().familyCode as string;
  const adil = cookieOf(res);
  const mk = async (role: string, login: string, display: string) => {
    await app.inject({ method: "POST", url: "/api/profiles", cookies: adil, payload: { displayName: display, login, role, secret: "573918", secretConfirm: "573918" } });
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login, secret: "573918" } }));
  };
  const lamiaa = await mk("parent", "lamiaa", "Lamiaa");
  const marie = await mk("staff", "marie", "Marie");
  const products: Record<string, string> = {};
  for (const c of (await app.inject({ method: "GET", url: "/api/catalog", cookies: adil })).json().categories) for (const p of c.products) products[p.name] = p.id;
  const list = (await app.inject({ method: "POST", url: "/api/lists", cookies: lamiaa })).json().list.id as string;
  return { adil, lamiaa, marie, products, list };
}
type F = Awaited<ReturnType<typeof newFamily>>;
const tok = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const register = (c: Cookies, token: string, environment = "sandbox") => app.inject({ method: "POST", url: "/api/push/apns", cookies: c, payload: { token, environment } });
const validate = async (f: F, who: Cookies, name: string) => {
  const r = await app.inject({ method: "POST", url: `/api/lists/${f.list}/ops`, cookies: who, payload: { ops: [{ opId: randomUUID(), type: "add", productId: f.products[name] }], batch: { id: randomUUID() } } });
  expect(r.statusCode).toBe(200);
  await push.idle();
};

describe("APNs : adresses et contenu", () => {
  it("adresse « apns:<environnement>:<jeton> », contenu iPhone avec titre, texte et liste à ouvrir", () => {
    const t = tok();
    expect(parseApnsEndpoint(apnsEndpoint("production", t.toUpperCase()))).toEqual({ env: "production", token: t });
    expect(parseApnsEndpoint("https://push.example.test/x")).toBeNull();
    const body = JSON.parse(apnsBody({ v: 1, title: "Liste mise à jour", body: "Marie a ajouté 1 produit", tag: "v1", listId: "L1", url: "/?open=L1" }));
    expect(body).toEqual({ aps: { alert: { title: "Liste mise à jour", body: "Marie a ajouté 1 produit" }, sound: "default", "thread-id": "L1" }, listId: "L1", url: "/?open=L1", tag: "v1" });
  });
  it("configuration absente ou incomplète = aucun envoi ; « \\n » accepté dans la clé", () => {
    expect(apnsConfigFromEnv({})).toBeNull();
    expect(apnsConfigFromEnv({ APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_TOPIC: "app" })).toBeNull();
    expect(apnsConfigFromEnv({ APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_TOPIC: "app", APNS_KEY_P8: "a\\nb" })?.key).toBe("a\nb");
  });
});

describe("APNs : enregistrement des iPhones", () => {
  it("parents et administrateurs seulement ; jeton hexadécimal ; un iPhone n'a qu'un propriétaire ; « check » et retrait", async () => {
    const f = await newFamily();
    const t = tok();
    expect((await register(f.marie, t)).statusCode).toBe(403);
    expect((await register(f.lamiaa, "pas-un-jeton")).statusCode).toBe(400);
    expect((await register(f.lamiaa, t, "autre")).statusCode).toBe(400);
    expect((await register(f.lamiaa, t)).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/push/apns/check", cookies: f.lamiaa, payload: { token: t } })).json()).toEqual({ registered: true });
    // le même iPhone, connecté ensuite sous un autre profil : il lui appartient désormais, à lui seul
    expect((await app.inject({ method: "POST", url: "/api/push/apns/check", cookies: f.adil, payload: { token: t } })).json()).toEqual({ registered: false });
    expect((await db.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint LIKE $1", [`%${t}`])).rows[0].n).toBe(0);
    expect((await register(f.adil, t)).statusCode).toBe(201);
    expect((await app.inject({ method: "DELETE", url: "/api/push/apns", cookies: f.lamiaa, payload: { token: t } })).json()).toEqual({ removed: 0 });
    expect((await app.inject({ method: "DELETE", url: "/api/push/apns", cookies: f.adil, payload: { token: t } })).json()).toEqual({ removed: 1 });
  });
});

describe("APNs : envoi", () => {
  it("même notification que Web Push, aux mêmes destinataires ; iPhone désinstallé (410) oublié", async () => {
    const f = await newFamily();
    const t1 = tok();
    const t2 = tok();
    await register(f.lamiaa, t1);
    await register(f.adil, t2, "production");
    await app.inject({ method: "POST", url: "/api/push/subscriptions", cookies: f.adil, payload: { endpoint: `https://push.example.test/${randomUUID()}`, keys: { p256dh: Buffer.alloc(65, 1).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } } });
    iphone.length = 0;
    web.length = 0;
    await validate(f, f.marie, "Tomates");
    expect(iphone.map((s) => s.endpoint).sort()).toEqual([apnsEndpoint("production", t2), apnsEndpoint("sandbox", t1)].sort());
    expect(web).toHaveLength(1); // le navigateur de l'administrateur reçoit toujours la sienne
    expect(iphone[0]!.payload).toMatchObject({ title: "Nouvelle liste de courses", body: "Marie a validé 1 produit", listId: f.list });
    // l'auteur n'est jamais prévenu
    iphone.length = 0;
    scripted.set(apnsEndpoint("sandbox", t1), [410]);
    await validate(f, f.adil, "Oignons");
    expect(iphone.map((s) => s.endpoint)).toEqual([apnsEndpoint("sandbox", t1)]);
    expect((await db.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = $1", [apnsEndpoint("sandbox", t1)])).rows[0].n).toBe(0);
  });

  it("requête Apple : HTTP/2, jeton ES256 signé par la clé, en-têtes APNs ; jeton refusé par Apple ramené à 410", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const seen: { headers: http2.IncomingHttpHeaders; body: string }[] = [];
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream, headers) => {
      let body = "";
      stream.setEncoding("utf8");
      stream.on("data", (c) => (body += c));
      stream.on("end", () => {
        seen.push({ headers, body });
        const bad = String(headers[":path"]).endsWith("/bad");
        stream.respond({ ":status": bad ? 400 : 200, "content-type": "application/json" });
        stream.end(bad ? JSON.stringify({ reason: "BadDeviceToken" }) : "");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const client = new ApnsClient({ keyId: "KEY1234567", teamId: "TEAM123456", key: privateKey.export({ type: "pkcs8", format: "pem" }) as string, topic: "app.smartcourse.courses" }, { sandbox: url, production: url });
    const body = apnsBody({ v: 1, title: "T", body: "B", tag: "tag-1", listId: "L", url: "/" });
    expect(await client.send("sandbox", "abc", body, "tag-1")).toMatchObject({ statusCode: 200 });
    expect(await client.send("sandbox", "bad", body, "tag-1")).toMatchObject({ statusCode: 410, reason: "BadDeviceToken" });
    const h = seen[0]!.headers;
    expect(h[":path"]).toBe("/3/device/abc");
    expect(h["apns-topic"]).toBe("app.smartcourse.courses");
    expect(h["apns-push-type"]).toBe("alert");
    expect(h["apns-collapse-id"]).toBe("tag-1");
    expect(JSON.parse(seen[0]!.body).aps.alert).toEqual({ title: "T", body: "B" });
    const [head, claims, sig] = String(h.authorization).replace(/^bearer /, "").split(".");
    expect(JSON.parse(Buffer.from(head!, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString()).iss).toBe("TEAM123456");
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig!, "base64url"))).toBe(true);
    server.close();
  });
});
