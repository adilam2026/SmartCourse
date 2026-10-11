import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createECDH, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { generateInstallToken } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { SseHub } from "../src/hub.js";
import { PushService, buildMessage, type PushPayload, type PushSender } from "../src/push.js";
import { closeTestDb, resetData, testDb, testStore } from "./helpers.js";

type Cookies = { sc_session: string };
let db: Db;
let app: FastifyInstance;
let push: PushService;
let n = 0;
/** What the phones' push services received: endpoint → payloads. The status a given endpoint answers can be scripted. */
const sent: { endpoint: string; payload: PushPayload }[] = [];
const scripted = new Map<string, number[]>();
const sender: PushSender = async (sub, payload) => {
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  return { statusCode: scripted.get(sub.endpoint)?.shift() ?? 201 };
};

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  push = new PushService(db, { sender });
  app = await buildApp({ db, hub: new SseHub(), store: testStore(), push, loginRateLimit: { max: 10_000, timeWindow: "1 minute" } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeTestDb();
});

const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ sc_session: res.cookies.find((c) => c.name === "sc_session")!.value });
async function newFamily() {
  const res = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: `P${++n}`, admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
  const familyCode = res.json().familyCode as string;
  const adil = cookieOf(res);
  const profiles: Record<string, string> = {};
  const mk = async (role: string, login: string, display: string) => {
    const r = await app.inject({ method: "POST", url: "/api/profiles", cookies: adil, payload: { displayName: display, login, role, secret: "573918", secretConfirm: "573918" } });
    profiles[login] = r.json().profile.id;
    return cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode, login, secret: "573918", secretConfirm: "573918" } }));
  };
  const lamiaa = await mk("parent", "lamiaa", "Lamiaa");
  const marie = await mk("staff", "marie", "Marie");
  const products: Record<string, string> = {};
  const names: string[] = [];
  for (const c of (await app.inject({ method: "GET", url: "/api/catalog", cookies: adil })).json().categories) for (const p of c.products) (products[p.name] = p.id), names.push(p.name);
  const list = (await app.inject({ method: "POST", url: "/api/lists", cookies: lamiaa })).json().list.id as string;
  const familyId = (await db.query("SELECT id FROM families WHERE code = $1", [familyCode])).rows[0].id as string;
  return { familyCode, familyId, adil, lamiaa, marie, products, names, list, profiles };
}
type F = Awaited<ReturnType<typeof newFamily>>;

const key = () => Buffer.from(randomBytes(65)).toString("base64url");
const subscribe = (c: Cookies, endpoint: string) => app.inject({ method: "POST", url: "/api/push/subscriptions", cookies: c, payload: { endpoint, keys: { p256dh: key(), auth: Buffer.from(randomBytes(16)).toString("base64url") } } });
const ep = (label: string) => `https://push.example.test/${label}/${randomUUID()}`;
const add = (f: F, name: string, quantity?: number) => ({ opId: randomUUID(), type: "add", productId: f.products[name]!, ...(quantity !== undefined ? { quantity } : {}) });
const validate = async (f: F, who: Cookies, ops: object[], batch = { id: randomUUID() }) => {
  const r = await app.inject({ method: "POST", url: `/api/lists/${f.list}/ops`, cookies: who, payload: { ops, batch } });
  expect(r.statusCode).toBe(200);
  await push.idle();
  return r.json();
};
const view = async (f: F) => (await app.inject({ method: "GET", url: "/api/lists/active", cookies: f.adil })).json().list;
const take = () => sent.splice(0, sent.length);

describe("messages", () => {
  it("première validation, mises à jour, singulier/pluriel, rien à dire sans changement", () => {
    expect(buildMessage("Marie", { added: 5, modified: 0, removed: 0, first: true })).toEqual({ title: "Nouvelle liste de courses", body: "Marie a validé 5 produits" });
    expect(buildMessage("Marie", { added: 1, modified: 0, removed: 0, first: true })?.body).toBe("Marie a validé 1 produit");
    expect(buildMessage("Marie", { added: 3, modified: 2, removed: 0, first: false })).toEqual({ title: "Liste mise à jour", body: "Marie a ajouté 3 produits et modifié 2 quantités" });
    expect(buildMessage("Marie", { added: 0, modified: 1, removed: 0, first: false })?.body).toBe("Marie a modifié 1 quantité");
    expect(buildMessage("Marie", { added: 2, modified: 1, removed: 1, first: false })?.body).toBe("Marie a ajouté 2 produits, modifié 1 quantité et retiré 1 produit");
    expect(buildMessage("Lamiaa", { added: 0, modified: 0, removed: 0, first: false })).toBeNull();
  });
});

describe("abonnements : permissions, appareils, propriétaire", () => {
  it("réservés aux parents et administrateurs ; clé publique stable et conservée", async () => {
    const f = await newFamily();
    expect((await app.inject({ method: "GET", url: "/api/push/config", cookies: f.marie })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/push/config" })).statusCode).toBe(401);
    const k1 = (await app.inject({ method: "GET", url: "/api/push/config", cookies: f.lamiaa })).json().publicKey as string;
    const k2 = (await app.inject({ method: "GET", url: "/api/push/config", cookies: f.adil })).json().publicKey as string;
    expect(k1).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(k2).toBe(k1);
    // une autre instance du serveur relit la même clé en base (pas de nouvelle clé à chaque démarrage)
    expect(await new PushService(db).publicKey()).toBe(k1);
    expect((await subscribe(f.marie, ep("staff"))).statusCode).toBe(403);
    expect((await db.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE family_id = $1", [f.familyId])).rows[0].n).toBe(0);
  });

  it("adresse https obligatoire, clés valides ; plusieurs appareils par profil ; un appareil n'a qu'un propriétaire", async () => {
    const f = await newFamily();
    expect((await app.inject({ method: "POST", url: "/api/push/subscriptions", cookies: f.lamiaa, payload: { endpoint: "http://x.test/a", keys: { p256dh: key(), auth: "abcdefgh" } } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/push/subscriptions", cookies: f.lamiaa, payload: { endpoint: ep("a"), keys: { p256dh: "!!", auth: "x" } } })).statusCode).toBe(400);
    const a = ep("tel1");
    expect((await subscribe(f.lamiaa, a)).statusCode).toBe(201);
    expect((await subscribe(f.lamiaa, ep("tel2"))).statusCode).toBe(201);
    expect((await db.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE profile_id = $1", [f.profiles["lamiaa"]])).rows[0].n).toBe(2);
    // le même appareil enregistré par un autre profil change de propriétaire (jamais deux)
    expect((await subscribe(f.adil, a)).statusCode).toBe(201);
    const owners = (await db.query("SELECT profile_id FROM push_subscriptions WHERE endpoint = $1", [a])).rows;
    expect(owners).toHaveLength(1);
    expect(owners[0].profile_id).not.toBe(f.profiles["lamiaa"]);
  });

  it("désactiver sur cet appareil ne supprime que l'appareil du profil connecté ; « check » libère un appareil repris par un autre profil", async () => {
    const f = await newFamily();
    const a = ep("tel");
    await subscribe(f.lamiaa, a);
    // un autre profil ne peut pas supprimer l'appareil de Lamiaa avec DELETE
    expect((await app.inject({ method: "DELETE", url: "/api/push/subscriptions", cookies: f.adil, payload: { endpoint: a } })).json().removed).toBe(0);
    // mais l'appareil, repris par Adil (connecté sur ce téléphone), n'est plus rattaché à Lamiaa
    expect((await app.inject({ method: "POST", url: "/api/push/subscriptions/check", cookies: f.adil, payload: { endpoint: a } })).json().registered).toBe(false);
    expect((await db.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = $1", [a])).rows[0].n).toBe(0);
    await subscribe(f.adil, a);
    expect((await app.inject({ method: "POST", url: "/api/push/subscriptions/check", cookies: f.adil, payload: { endpoint: a } })).json().registered).toBe(true);
    expect((await app.inject({ method: "DELETE", url: "/api/push/subscriptions", cookies: f.adil, payload: { endpoint: a } })).json().removed).toBe(1);
    // le personnel n'a jamais d'appareil enregistré
    await db.query("INSERT INTO push_subscriptions (family_id, profile_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,'x','y')", [f.familyId, f.profiles["marie"], ep("legacy")]);
    const legacy = (await db.query("SELECT endpoint FROM push_subscriptions WHERE profile_id = $1", [f.profiles["marie"]])).rows[0].endpoint as string;
    expect((await app.inject({ method: "POST", url: "/api/push/subscriptions/check", cookies: f.marie, payload: { endpoint: legacy } })).json().registered).toBe(false);
    expect((await db.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = $1", [legacy])).rows[0].n).toBe(0);
  });
});

describe("notifications : destinataires, contenu, une seule fois", () => {
  it("première validation du personnel, puis mise à jour ; parents et administrateurs de la famille seulement ; jamais le personnel ; jamais une autre famille", async () => {
    take();
    const f = await newFamily();
    const g = await newFamily(); // autre famille
    const adil1 = ep("adil1"), adil2 = ep("adil2"), lam = ep("lamiaa"), other = ep("autre-famille");
    await subscribe(f.adil, adil1);
    await subscribe(f.adil, adil2);
    await subscribe(f.lamiaa, lam);
    await subscribe(g.adil, other);
    // 1re validation : 5 produits
    const first = f.names.slice(0, 5);
    await validate(f, f.marie, first.map((x) => add(f, x)));
    let got = take();
    expect(got.map((x) => x.endpoint).sort()).toEqual([adil1, adil2, lam].sort()); // 3 appareils, pas l'autre famille
    expect(new Set(got.map((x) => x.payload.title))).toEqual(new Set(["Nouvelle liste de courses"]));
    expect(got[0]!.payload.body).toBe("Marie a validé 5 produits");
    expect(got[0]!.payload).toMatchObject({ v: 1, listId: f.list, url: `/?open=${f.list}` });
    // validation suivante : 3 produits ajoutés et 2 quantités modifiées
    const v = await view(f);
    const rev = (name: string) => v.items.find((i: any) => i.name === name).rev as number;
    await validate(f, f.marie, [
      ...f.names.slice(5, 8).map((x) => add(f, x)),
      { opId: randomUUID(), type: "set_qty", productId: f.products[first[0]!], quantity: first[0] === "Tomates" ? 2.5 : 2, baseRev: rev(first[0]!) },
      { opId: randomUUID(), type: "set_qty", productId: f.products[first[1]!], quantity: 3, baseRev: rev(first[1]!) },
    ]);
    got = take();
    expect(got).toHaveLength(3);
    expect(got[0]!.payload).toMatchObject({ title: "Liste mise à jour", body: "Marie a ajouté 3 produits et modifié 2 quantités" });
    // exactement une ligne de journal par validation, avec le décompte des appareils
    const ev = (await db.query("SELECT title, recipients, delivered, failed FROM push_events WHERE family_id = $1 ORDER BY created_at", [f.familyId])).rows;
    expect(ev).toEqual([
      { title: "Nouvelle liste de courses", recipients: 3, delivered: 3, failed: 0 },
      { title: "Liste mise à jour", recipients: 3, delivered: 3, failed: 0 },
    ]);
    expect((await db.query("SELECT count(*)::int AS n FROM push_events WHERE family_id = $1", [g.familyId])).rows[0].n).toBe(0);
  });

  it("une validation d'un parent prévient les AUTRES parents et administrateurs, pas lui-même (aucun de ses appareils)", async () => {
    take();
    const f = await newFamily();
    const lam1 = ep("lam1"), lam2 = ep("lam2"), adil = ep("adil");
    await subscribe(f.lamiaa, lam1);
    await subscribe(f.lamiaa, lam2);
    await subscribe(f.adil, adil);
    await validate(f, f.lamiaa, [add(f, f.names[0]!), add(f, f.names[1]!)]);
    const got = take();
    expect(got.map((x) => x.endpoint)).toEqual([adil]);
    expect(got[0]!.payload.body).toBe("Lamiaa a validé 2 produits");
    // et inversement
    await validate(f, f.adil, [add(f, f.names[2]!)]);
    expect(take().map((x) => x.endpoint).sort()).toEqual([lam1, lam2].sort());
  });

  it("aucun changement = aucune notification : produit déjà présent, opération refusée, achat, liste clôturée", async () => {
    take();
    const f = await newFamily();
    await subscribe(f.adil, ep("adil"));
    await validate(f, f.marie, [add(f, f.names[0]!)]);
    take();
    await validate(f, f.marie, [add(f, f.names[0]!)]); // déjà dans la liste
    await validate(f, f.marie, [{ opId: randomUUID(), type: "set_qty", productId: f.products[f.names[0]!], quantity: 1, baseRev: 1 }]); // même quantité
    await validate(f, f.marie, [{ opId: randomUUID(), type: "remove", productId: f.products[f.names[1]!], baseRev: 1 }]); // pas dans la liste
    const line = (await view(f)).items[0];
    await validate(f, f.adil, [{ opId: randomUUID(), type: "purchase", itemId: line.id }]); // un achat n'est pas une modification de la liste
    expect(take()).toEqual([]);
    await app.inject({ method: "POST", url: `/api/lists/${f.list}/close`, cookies: f.lamiaa });
    await app.inject({ method: "POST", url: `/api/lists/${f.list}/ops`, cookies: f.marie, payload: { ops: [add(f, f.names[3]!)] } });
    await push.idle();
    expect(take()).toEqual([]);
  });

  it("une synchronisation répétée ne notifie qu'une fois : même lot rejoué, lot hors connexion renvoyé après réponse perdue", async () => {
    take();
    const f = await newFamily();
    await subscribe(f.adil, ep("adil"));
    const batch = { id: randomUUID() };
    const ops = [add(f, f.names[0]!), add(f, f.names[1]!)];
    await validate(f, f.marie, ops, batch);
    expect(take()).toHaveLength(1);
    // le téléphone n'a pas reçu la réponse : il renvoie exactement le même lot (mêmes opérations, même identifiant de validation)
    for (let i = 0; i < 3; i++) await validate(f, f.marie, ops, batch);
    expect(take()).toEqual([]);
    expect((await db.query("SELECT count(*)::int AS n FROM push_events WHERE family_id = $1", [f.familyId])).rows[0].n).toBe(1);
    // appels concurrents du même lot (deux synchronisations en même temps) : toujours une seule notification
    const f2 = await newFamily();
    await subscribe(f2.adil, ep("adil2"));
    const b2 = { id: randomUUID() };
    const o2 = [add(f2, f2.names[0]!)];
    await Promise.all([1, 2, 3].map(() => app.inject({ method: "POST", url: `/api/lists/${f2.list}/ops`, cookies: f2.marie, payload: { ops: o2, batch: b2 } })));
    await push.idle();
    expect(take()).toHaveLength(1);
  });

  it("une validation envoyée plus tard (hors connexion) notifie à l'enregistrement par le serveur, avec l'heure du téléphone conservée", async () => {
    take();
    const f = await newFamily();
    await subscribe(f.adil, ep("adil"));
    const pressed = new Date(Date.now() - 3 * 3_600_000).toISOString();
    await validate(f, f.marie, [add(f, f.names[0]!)], { id: randomUUID(), at: pressed } as any);
    const got = take();
    expect(got).toHaveLength(1); // envoyé quand le serveur l'a enregistré, pas à l'heure de l'appui
    expect((await db.query("SELECT created_at FROM push_events WHERE family_id = $1", [f.familyId])).rows[0].created_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("appareil disparu (410) supprimé ; panne passagère (500) réessayée une fois ; échec définitif compté sans bloquer la validation", async () => {
    take();
    const f = await newFamily();
    const gone = ep("gone"), flaky = ep("flaky"), down = ep("down");
    for (const e of [gone, flaky, down]) await subscribe(f.adil, e);
    scripted.set(gone, [410]);
    scripted.set(flaky, [500, 201]);
    scripted.set(down, [500, 503]);
    await validate(f, f.marie, [add(f, f.names[0]!)]);
    const got = take();
    expect(got.filter((x) => x.endpoint === flaky)).toHaveLength(2); // une seconde tentative
    expect(got.filter((x) => x.endpoint === gone)).toHaveLength(1);
    const left = (await db.query("SELECT endpoint, failures FROM push_subscriptions WHERE family_id = $1 ORDER BY endpoint", [f.familyId])).rows.map((r) => [r.endpoint, r.failures]);
    expect(left.map((x) => x[0])).not.toContain(gone);
    expect(left.find((x) => x[0] === down)![1]).toBe(1);
    expect(left.find((x) => x[0] === flaky)![1]).toBe(0);
    expect((await db.query("SELECT recipients, delivered, failed FROM push_events WHERE family_id = $1", [f.familyId])).rows[0]).toEqual({ recipients: 3, delivered: 1, failed: 2 });
  });

  it("profil devenu personnel ou désactivé : plus aucune notification ; l'autre famille n'est jamais touchée", async () => {
    take();
    const f = await newFamily();
    const g = await newFamily();
    const lam = ep("lam"), adil = ep("adil"), gAdil = ep("g-adil");
    await subscribe(f.lamiaa, lam);
    await subscribe(f.adil, adil);
    await subscribe(g.adil, gAdil);
    // Lamiaa devient personnel : ses appareils sont supprimés
    await app.inject({ method: "PATCH", url: `/api/profiles/${f.profiles["lamiaa"]}`, cookies: f.adil, payload: { role: "staff" } });
    expect((await db.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE profile_id = $1", [f.profiles["lamiaa"]])).rows[0].n).toBe(0);
    await validate(f, f.marie, [add(f, f.names[0]!)]);
    expect(take().map((x) => x.endpoint)).toEqual([adil]);
    // un administrateur supprimé du rôle par la base (cas extrême : abonnement resté) n'est pas notifié non plus
    await db.query("INSERT INTO push_subscriptions (family_id, profile_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,'x','y')", [f.familyId, f.profiles["marie"], ep("reste")]);
    await validate(f, f.adil, [add(f, f.names[1]!)]);
    expect(take()).toEqual([]); // l'auteur (Adil) exclu ; Marie (personnel) jamais
    // profil désactivé
    await app.inject({ method: "POST", url: "/api/profiles", cookies: f.adil, payload: { displayName: "Sophie", login: "sophie", role: "parent", secret: "573918", secretConfirm: "573918" } });
    const sophie = cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: f.familyCode, login: "sophie", secret: "573918", secretConfirm: "573918" } }));
    await subscribe(sophie, ep("sophie"));
    const sid = (await db.query("SELECT id FROM profiles WHERE family_id = $1 AND login = 'sophie'", [f.familyId])).rows[0].id;
    await app.inject({ method: "PATCH", url: `/api/profiles/${sid}`, cookies: f.adil, payload: { active: false } });
    await validate(f, f.marie, [add(f, f.names[2]!)]);
    expect(take().map((x) => x.endpoint)).toEqual([adil]);
    expect(take()).toEqual([]);
    expect((await db.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE family_id = $1", [g.familyId])).rows[0].n).toBe(1);
  });
});

// ---- le vrai transport : requête Web Push chiffrée, signée VAPID, reçue par un faux service push ----------------------------------------
const b64 = (b: Buffer) => b.toString("base64url");
const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, len: number) => {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
};
/** RFC 8291 (aes128gcm) decryption on the receiving side, to prove what a phone would read. */
function decrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const secret = ecdh.computeSecret(asPublic);
  const ikm = hkdf(auth, secret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString("utf8"); // strip the padding delimiter
}
void createCipheriv;

describe("transport Web Push réel (faux service push local)", () => {
  it("la requête est signée VAPID avec la clé du serveur et le contenu, chiffré pour l'appareil, se déchiffre en notification attendue", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tls-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
    const received: { headers: Record<string, string | string[] | undefined>; body: Buffer; url: string }[] = [];
    const server = https.createServer({ key: readFileSync(path.join(dir, "k.pem")), cert: readFileSync(path.join(dir, "c.pem")) }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks), url: req.url! });
        res.writeHead(201).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // certificat de test auto-signé, uniquement dans ce test
    try {
      const real = new PushService(db); // l'envoi réel (bibliothèque web-push)
      const realApp = await buildApp({ db, hub: new SseHub(), store: testStore(), push: real, loginRateLimit: { max: 10_000, timeWindow: "1 minute" } });
      const f = await (async () => {
        const res = await realApp.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: "Réel", admin: { displayName: "Adil", login: "adil", secret: "482913" } } });
        const adil = cookieOf(res);
        await realApp.inject({ method: "POST", url: "/api/profiles", cookies: adil, payload: { displayName: "Marie", login: "marie", role: "staff", secret: "573918", secretConfirm: "573918" } });
        const marie = cookieOf(await realApp.inject({ method: "POST", url: "/api/auth/login", payload: { familyCode: res.json().familyCode, login: "marie", secret: "573918", secretConfirm: "573918" } }));
        const cat = (await realApp.inject({ method: "GET", url: "/api/catalog", cookies: adil })).json().categories;
        const list = (await realApp.inject({ method: "POST", url: "/api/lists", cookies: adil })).json().list.id;
        return { adil, marie, list, products: cat.flatMap((c: any) => c.products.slice(0, 2)).slice(0, 3).map((p: any) => p.id) as string[] };
      })();
      // « téléphone » : sa paire de clés P-256 et son secret d'authentification
      const ua = createECDH("prime256v1");
      ua.generateKeys();
      const auth = randomBytes(16);
      const sub = await realApp.inject({ method: "POST", url: "/api/push/subscriptions", cookies: f.adil, payload: { endpoint: `https://127.0.0.1:${port}/send/abc`, keys: { p256dh: b64(ua.getPublicKey()), auth: b64(auth) } } });
      expect(sub.statusCode).toBe(201);
      // Adil (admin) est l'auteur d'une validation : il ne reçoit rien. Marie (personnel) valide : Adil reçoit.
      const r = await realApp.inject({ method: "POST", url: `/api/lists/${f.list}/ops`, cookies: f.marie, payload: { ops: f.products.map((id) => ({ opId: randomUUID(), type: "add", productId: id })), batch: { id: randomUUID() } } });
      expect(r.statusCode).toBe(200);
      await real.idle();
      expect(received).toHaveLength(1);
      const h = received[0]!.headers;
      expect(received[0]!.url).toBe("/send/abc");
      expect(h["content-encoding"]).toBe("aes128gcm");
      expect(h["ttl"]).toBe("86400");
      expect(h["urgency"]).toBe("high");
      // signature VAPID : « vapid t=<jwt>, k=<clé publique du serveur> »
      const m = /^vapid t=([^,]+), k=(.+)$/.exec(String(h["authorization"]));
      expect(m).not.toBeNull();
      expect(m![2]).toBe(await real.publicKey());
      const claims = JSON.parse(Buffer.from(m![1]!.split(".")[1]!, "base64url").toString());
      expect(claims.aud).toBe(`https://127.0.0.1:${port}`);
      expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
      // contenu lisible par le seul téléphone
      const note = JSON.parse(decrypt(received[0]!.body, ua.getPrivateKey(), ua.getPublicKey(), auth)) as PushPayload;
      expect(note).toMatchObject({ title: "Nouvelle liste de courses", body: "Marie a validé 3 produits", listId: f.list, url: `/?open=${f.list}` });
      await realApp.close();
    } finally {
      if (prevTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
      server.close();
    }
  });
});
