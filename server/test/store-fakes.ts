import { X509Certificate, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Stores simulés pour les tests : aucun appel réseau, aucune clé réelle.
 * - Apple : une chaîne racine → intermédiaire → feuille construite avec openssl, portant les mêmes marqueurs (OID) que celle
 *   d'Apple ; le serveur l'accepte seulement parce que les tests lui donnent l'empreinte de CETTE racine.
 * - Google : réponses de l'API Google Play Developer tenues en mémoire (fetch simulé), compte de service jetable.
 */
export interface TestChain {
  rootFingerprint: string;
  x5c: string[];
  leafKey: string;
  /** Autre chaîne, d'une racine inconnue du serveur. */
  foreign: { x5c: string[]; leafKey: string };
}

function makeChain(dir: string, tag: string): { x5c: string[]; leafKey: string; rootFp: string } {
  const run = (...a: string[]) => execFileSync("openssl", a, { cwd: dir, stdio: "pipe" });
  const f = (n: string) => `${tag}-${n}`;
  for (const n of ["root", "int", "leaf"]) run("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", f(`${n}.key`));
  run("req", "-new", "-x509", "-key", f("root.key"), "-out", f("root.pem"), "-days", "30", "-subj", `/CN=Test Root ${tag}`, "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
  writeFileSync(path.join(dir, f("int.ext")), "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n1.2.840.113635.100.6.2.1=DER:05:00\n");
  run("req", "-new", "-key", f("int.key"), "-out", f("int.csr"), "-subj", `/CN=Test Intermediate ${tag}`);
  run("x509", "-req", "-in", f("int.csr"), "-CA", f("root.pem"), "-CAkey", f("root.key"), "-CAcreateserial", "-out", f("int.pem"), "-days", "30", "-extfile", f("int.ext"));
  writeFileSync(path.join(dir, f("leaf.ext")), "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.6.11.1=DER:05:00\n");
  run("req", "-new", "-key", f("leaf.key"), "-out", f("leaf.csr"), "-subj", `/CN=Test Leaf ${tag}`);
  run("x509", "-req", "-in", f("leaf.csr"), "-CA", f("int.pem"), "-CAkey", f("int.key"), "-CAcreateserial", "-out", f("leaf.pem"), "-days", "30", "-extfile", f("leaf.ext"));
  const der = (n: string) => new X509Certificate(readFileSync(path.join(dir, f(`${n}.pem`)))).raw.toString("base64");
  const root = new X509Certificate(readFileSync(path.join(dir, f("root.pem"))));
  return { x5c: [der("leaf"), der("int"), der("root")], leafKey: readFileSync(path.join(dir, f("leaf.key")), "utf8"), rootFp: root.fingerprint256 };
}

export function testAppleChain(): TestChain {
  const dir = mkdtempSync(path.join(tmpdir(), "sc-apple-"));
  try {
    const a = makeChain(dir, "a");
    const b = makeChain(dir, "b");
    return { rootFingerprint: a.rootFp, x5c: a.x5c, leafKey: a.leafKey, foreign: { x5c: b.x5c, leafKey: b.leafKey } };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function signJws(payload: unknown, chain: { x5c: string[]; leafKey: string }): string {
  const h = Buffer.from(JSON.stringify({ alg: "ES256", x5c: chain.x5c })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s = sign("sha256", Buffer.from(`${h}.${p}`), { key: chain.leafKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${h}.${p}.${s}`;
}

export function testServiceAccount() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { client_email: "verif@test.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), token_uri: "https://oauth.test/token" };
}

/** API Google Play Developer simulée. */
export class FakeGoogle {
  subs = new Map<string, any>();
  products = new Map<string, any>();
  voided: any[] = [];
  acks: string[] = [];
  down = false;
  calls = 0;
  fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    this.calls++;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url === "https://oauth.test/token") return json(200, { access_token: "fake-access", expires_in: 3600 });
    if (this.down) return json(503, { error: "unavailable" });
    let m = /\/purchases\/subscriptionsv2\/tokens\/([^/?]+)$/.exec(url);
    if (m) {
      const s = this.subs.get(decodeURIComponent(m[1]!));
      return s ? json(200, s) : json(404, { error: "not found" });
    }
    m = /\/purchases\/(subscriptions|products)\/([^/]+)\/tokens\/([^/:]+):acknowledge$/.exec(url);
    if (m && init?.method === "POST") {
      const tok = decodeURIComponent(m[3]!);
      this.acks.push(tok);
      const p = this.products.get(tok);
      if (p) p.acknowledgementState = 1;
      const s = this.subs.get(tok);
      if (s) s.acknowledgementState = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
      return new Response("", { status: 200 });
    }
    m = /\/purchases\/products\/([^/]+)\/tokens\/([^/?]+)$/.exec(url);
    if (m) {
      const p = this.products.get(decodeURIComponent(m[2]!));
      return p && p.productId === decodeURIComponent(m[1]!) ? json(200, p) : json(404, { error: "not found" });
    }
    if (/\/purchases\/voidedpurchases\?/.test(url)) return json(200, { voidedPurchases: this.voided });
    return json(404, { error: "unexpected " + url });
  }) as typeof fetch;

  lifetime(token: string, accountToken: string | null, o: { state?: number; test?: boolean } = {}) {
    this.products.set(token, {
      productId: "courses_famille_a_vie",
      purchaseState: o.state ?? 0,
      acknowledgementState: 0,
      ...(o.test ? { purchaseType: 0 } : {}),
      ...(accountToken ? { obfuscatedExternalAccountId: accountToken } : {}),
      orderId: `GPA.${token}`,
    });
  }

  annual(token: string, accountToken: string | null, o: { state?: string; expiry?: Date; autoRenew?: boolean; linked?: string; test?: boolean } = {}) {
    this.subs.set(token, {
      subscriptionState: o.state ?? "SUBSCRIPTION_STATE_ACTIVE",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
      latestOrderId: `GPA.${token}`,
      lineItems: [{ productId: "courses_famille_annuel", expiryTime: (o.expiry ?? new Date(Date.now() + 365 * 86400_000)).toISOString(), autoRenewingPlan: { autoRenewEnabled: o.autoRenew ?? true } }],
      ...(o.linked ? { linkedPurchaseToken: o.linked } : {}),
      ...(o.test ? { testPurchase: {} } : {}),
      ...(accountToken ? { externalAccountIdentifiers: { obfuscatedExternalAccountId: accountToken } } : {}),
    });
  }
}

export function rtdn(messageId: string, payload: Record<string, unknown>, packageName = "app.smartcourse.courses.natif") {
  return { message: { messageId, data: Buffer.from(JSON.stringify({ version: "1.0", packageName, eventTimeMillis: String(Date.now()), ...payload })).toString("base64") }, subscription: "projects/x/subscriptions/y" };
}
