import { X509Certificate, sign, verify } from "node:crypto";
import { kindOf, type StoreEnv, type VerifiedPurchase } from "./types.js";

/**
 * App Store (StoreKit 2) : vérification par le serveur.
 *
 * - Les transactions et notifications Apple sont des JWS signés (ES256) ; l'en-tête x5c porte la chaîne de certificats
 *   feuille → intermédiaire Apple → racine. Le serveur vérifie la chaîne jusqu'à « Apple Root CA - G3 » (empreinte épinglée,
 *   aucun fichier à télécharger), les marqueurs Apple des certificats (OID), leurs dates, puis la signature.
 * - L'API App Store Server (facultative : clé « In-App Purchase » .p8) donne l'état à jour d'un abonnement (renouvellement
 *   automatique, période de grâce) et sert au rapprochement. Sans elle, le serveur s'appuie sur les transactions et notifications.
 *
 * Variables : APPLE_BUNDLE_ID (obligatoire pour activer Apple), APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_P8 (facultatives).
 */

/** Empreinte SHA-256 du certificat « Apple Root CA - G3 » (https://www.apple.com/certificateauthority/). */
export const APPLE_ROOT_CA_G3 = "63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79";
/** Marqueurs Apple : certificat feuille de signature App Store (1.2.840.113635.100.6.11.1), intermédiaire WWDR (1.2.840.113635.100.6.2.1). */
const OID_LEAF = Buffer.from("060a2a864886f76364060b01", "hex");
const OID_INTERMEDIATE = Buffer.from("060a2a864886f76364060201", "hex");

export class AppleSignatureError extends Error {}

export interface AppleConfig {
  bundleId: string;
  /** Racines admises (empreintes SHA-256) ; Apple Root CA G3 par défaut, une racine de test dans les tests. */
  roots?: string[];
  api?: { keyId: string; issuerId: string; key: string } | null;
  hosts?: Record<StoreEnv, string>;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const norm = (fp: string) => fp.replace(/:/g, "").toUpperCase();

/** Vérifie un JWS signé par Apple et renvoie son contenu. */
export function verifyAppleJws<T = Record<string, unknown>>(jws: string, roots: string[] = [APPLE_ROOT_CA_G3], now = new Date()): T {
  const parts = typeof jws === "string" ? jws.split(".") : [];
  if (parts.length !== 3) throw new AppleSignatureError("format");
  let header: { alg?: string; x5c?: string[] };
  try {
    header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
  } catch {
    throw new AppleSignatureError("en-tête");
  }
  if (header.alg !== "ES256" || !Array.isArray(header.x5c) || header.x5c.length < 3) throw new AppleSignatureError("en-tête");
  let certs: X509Certificate[];
  try {
    certs = header.x5c.map((c) => new X509Certificate(Buffer.from(c, "base64")));
  } catch {
    throw new AppleSignatureError("certificats");
  }
  for (const c of certs) if (new Date(c.validFrom) > now || new Date(c.validTo) < now) throw new AppleSignatureError("certificat hors validité");
  for (let i = 0; i < certs.length - 1; i++) {
    if (!certs[i]!.checkIssued(certs[i + 1]!) || !certs[i]!.verify(certs[i + 1]!.publicKey)) throw new AppleSignatureError("chaîne");
  }
  const root = certs[certs.length - 1]!;
  if (!roots.map(norm).includes(norm(root.fingerprint256)) || !root.verify(root.publicKey)) throw new AppleSignatureError("racine");
  if (!certs[0]!.raw.includes(OID_LEAF) || !certs[1]!.raw.includes(OID_INTERMEDIATE)) throw new AppleSignatureError("marqueurs Apple");
  const ok = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key: certs[0]!.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2]!, "base64url"));
  if (!ok) throw new AppleSignatureError("signature");
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as T;
  } catch {
    throw new AppleSignatureError("contenu");
  }
}

export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  type?: string;
  expiresDate?: number;
  appAccountToken?: string;
  environment?: string;
  revocationDate?: number;
  inAppOwnershipType?: string;
}
export interface AppleRenewalInfo {
  autoRenewStatus?: number;
  gracePeriodExpiresDate?: number;
  originalTransactionId?: string;
}
export interface AppleNotification {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  data?: { bundleId?: string; environment?: string; signedTransactionInfo?: string; signedRenewalInfo?: string; status?: number };
}

const envOf = (e?: string): StoreEnv => (e === "Production" ? "production" : "sandbox");

export class AppleStore {
  private roots: string[];
  private hosts: Record<StoreEnv, string>;
  private token: { value: string; at: number } | null = null;
  constructor(
    readonly cfg: AppleConfig,
    private fetchFn: typeof fetch = fetch,
  ) {
    this.roots = cfg.roots ?? [APPLE_ROOT_CA_G3];
    this.hosts = cfg.hosts ?? { production: "https://api.storekit.itunes.apple.com", sandbox: "https://api.storekit-sandbox.itunes.apple.com" };
  }

  get hasApi() {
    return Boolean(this.cfg.api);
  }

  decode<T>(jws: string): T {
    return verifyAppleJws<T>(jws, this.roots);
  }

  /**
   * Transaction signée → achat vérifié. `renewal` (si connu) précise le renouvellement automatique ; `subStatus` (API ou
   * notification : 1 actif, 2 expiré, 3 nouvelle tentative de paiement, 4 période de grâce, 5 révoqué) précise l'état.
   */
  toPurchase(tx: AppleTransaction, renewal?: AppleRenewalInfo | null, subStatus?: number): VerifiedPurchase {
    if (tx.bundleId !== this.cfg.bundleId) throw new AppleSignatureError("autre application");
    const kind = kindOf(tx.productId);
    const now = Date.now();
    const expiresAt = tx.expiresDate ? new Date(tx.expiresDate) : null;
    let status: VerifiedPurchase["status"];
    let autoRenewing = false;
    if (tx.revocationDate) status = "refunded";
    else if (kind === "lifetime") status = "active";
    else {
      autoRenewing = renewal ? renewal.autoRenewStatus === 1 : true;
      if (subStatus === 5) status = "revoked";
      else if (subStatus === 4 || (renewal?.gracePeriodExpiresDate && renewal.gracePeriodExpiresDate > now && (!expiresAt || expiresAt.getTime() <= now))) status = "grace";
      else if (subStatus === 3) status = "on_hold";
      else if (subStatus === 2 || !expiresAt || expiresAt.getTime() <= now) status = "expired";
      else status = autoRenewing ? "active" : "cancelled";
    }
    // Période de grâce : l'accès continue jusqu'à sa fin (Apple prolonge la période payée).
    const graceEnd = status === "grace" && renewal?.gracePeriodExpiresDate ? new Date(renewal.gracePeriodExpiresDate) : null;
    return {
      platform: "apple",
      productId: tx.productId,
      kind,
      purchaseKey: String(tx.originalTransactionId),
      accountToken: tx.appAccountToken ? tx.appAccountToken.toLowerCase() : null,
      status,
      expiresAt: kind === "lifetime" ? null : graceEnd ?? expiresAt,
      autoRenewing,
      environment: envOf(tx.environment),
      storeRef: String(tx.transactionId),
      familyShared: tx.inAppOwnershipType === "FAMILY_SHARED",
    };
  }

  /** Vérifie une transaction présentée par l'application, en la complétant par l'API si elle est configurée. */
  async verifySignedTransaction(jws: string): Promise<VerifiedPurchase> {
    const tx = this.decode<AppleTransaction>(jws);
    if (tx.bundleId !== this.cfg.bundleId) throw new AppleSignatureError("autre application");
    if (this.hasApi) {
      const fresh = await this.latest(tx.originalTransactionId, envOf(tx.environment), kindOf(tx.productId), tx.transactionId);
      if (fresh) return fresh;
    }
    return this.toPurchase(tx);
  }

  /** État à jour par l'API App Store Server (null si l'API n'est pas configurée ou ne connaît pas l'achat). */
  async latest(originalTransactionId: string, env: StoreEnv, kind: "annual" | "lifetime", transactionId?: string): Promise<VerifiedPurchase | null> {
    if (!this.cfg.api) return null;
    if (kind === "annual") {
      const r = await this.call(env, `/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`);
      if (!r) return null;
      const groups = (r.data ?? []) as { lastTransactions?: { originalTransactionId: string; status: number; signedTransactionInfo: string; signedRenewalInfo?: string }[] }[];
      for (const g of groups)
        for (const t of g.lastTransactions ?? [])
          if (String(t.originalTransactionId) === String(originalTransactionId)) {
            const tx = this.decode<AppleTransaction>(t.signedTransactionInfo);
            const ren = t.signedRenewalInfo ? this.decode<AppleRenewalInfo>(t.signedRenewalInfo) : null;
            return this.toPurchase(tx, ren, t.status);
          }
      return null;
    }
    const r = await this.call(env, `/inApps/v1/transactions/${encodeURIComponent(transactionId ?? originalTransactionId)}`);
    return r?.signedTransactionInfo ? this.toPurchase(this.decode<AppleTransaction>(r.signedTransactionInfo as string)) : null;
  }

  private jwt(): string {
    const api = this.cfg.api!;
    const now = Math.floor(Date.now() / 1000);
    if (this.token && now - this.token.at < 40 * 60) return this.token.value;
    const head = b64url(JSON.stringify({ alg: "ES256", kid: api.keyId, typ: "JWT" }));
    const claims = b64url(JSON.stringify({ iss: api.issuerId, iat: now, exp: now + 50 * 60, aud: "appstoreconnect-v1", bid: this.cfg.bundleId }));
    const sig = sign("sha256", Buffer.from(`${head}.${claims}`), { key: api.key, dsaEncoding: "ieee-p1363" });
    this.token = { value: `${head}.${claims}.${b64url(sig)}`, at: now };
    return this.token.value;
  }

  private async call(env: StoreEnv, path: string): Promise<Record<string, unknown> | null> {
    const res = await this.fetchFn(this.hosts[env] + path, { headers: { authorization: `Bearer ${this.jwt()}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`App Store Server API : réponse ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }
}

export function appleConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppleConfig | null {
  if (!env.APPLE_BUNDLE_ID) return null;
  const raw = env.APPLE_IAP_KEY_P8;
  const api =
    env.APPLE_IAP_KEY_ID && env.APPLE_IAP_ISSUER_ID && raw ? { keyId: env.APPLE_IAP_KEY_ID, issuerId: env.APPLE_IAP_ISSUER_ID, key: raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw } : null;
  return { bundleId: env.APPLE_BUNDLE_ID, api };
}
