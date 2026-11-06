import { sign } from "node:crypto";
import { kindOf, type EntStatus, type VerifiedPurchase } from "./types.js";

/**
 * Google Play : vérification par le serveur avec l'API Google Play Developer (compte de service, droit « Afficher les données
 * financières » et « Gérer les commandes et abonnements » limité à l'application).
 *
 * - Abonnement annuel : purchases.subscriptionsv2 (état, échéance, renouvellement automatique, jeton précédent).
 * - Achat à vie : purchases.products (état, confirmation, achat de test).
 * - Le serveur confirme lui-même l'achat (acknowledge) après l'avoir enregistré : sans confirmation sous trois jours,
 *   Google rembourse automatiquement.
 * - Remboursements et annulations : notifications en temps réel (Pub/Sub) et liste des achats annulés (voidedpurchases).
 *
 * Variables : GOOGLE_PLAY_PACKAGE, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (contenu JSON de la clé du compte de service),
 * GOOGLE_RTDN_TOKEN (jeton secret de l'adresse de notification Pub/Sub).
 */
export interface GoogleConfig {
  packageName: string;
  serviceAccount: { client_email: string; private_key: string; token_uri?: string };
  rtdnToken?: string | null;
  base?: string;
}

export class GoogleStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

const SUB_STATE: Record<string, EntStatus> = {
  SUBSCRIPTION_STATE_ACTIVE: "active",
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "grace",
  SUBSCRIPTION_STATE_ON_HOLD: "on_hold",
  SUBSCRIPTION_STATE_PAUSED: "on_hold",
  SUBSCRIPTION_STATE_CANCELED: "cancelled",
  SUBSCRIPTION_STATE_EXPIRED: "expired",
  SUBSCRIPTION_STATE_PENDING: "pending",
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: "expired",
};

export class GooglePlay {
  private token: { value: string; until: number } | null = null;
  private base: string;
  constructor(
    readonly cfg: GoogleConfig,
    private fetchFn: typeof fetch = fetch,
  ) {
    this.base = cfg.base ?? "https://androidpublisher.googleapis.com";
  }

  private get app() {
    return `${this.base}/androidpublisher/v3/applications/${encodeURIComponent(this.cfg.packageName)}`;
  }

  /** Jeton OAuth du compte de service (JWT RS256 → oauth2), gardé jusqu'à cinq minutes avant son expiration. */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.until) return this.token.value;
    const sa = this.cfg.serviceAccount;
    const aud = sa.token_uri ?? "https://oauth2.googleapis.com/token";
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud, iat: now, exp: now + 3600 }));
    const assertion = `${head}.${claims}.${b64url(sign("sha256", Buffer.from(`${head}.${claims}`), sa.private_key))}`;
    const res = await this.fetchFn(aud, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    if (!res.ok) throw new GoogleStoreError(res.status, "Google : authentification du compte de service refusée");
    const j = (await res.json()) as { access_token: string; expires_in?: number };
    this.token = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 };
    return j.access_token;
  }

  private async call(method: "GET" | "POST", url: string): Promise<Record<string, unknown> | null> {
    const res = await this.fetchFn(url, {
      method,
      headers: { authorization: `Bearer ${await this.accessToken()}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    // 404 / 410 : jeton inconnu de Google (faux jeton, autre application, achat trop ancien).
    if (res.status === 404 || res.status === 410 || res.status === 400) return null;
    if (!res.ok) throw new GoogleStoreError(res.status, `Google Play : réponse ${res.status}`);
    const t = await res.text();
    return t ? (JSON.parse(t) as Record<string, unknown>) : {};
  }

  /** Interroge Google sur un achat présenté (null : Google ne le connaît pas). */
  async verify(productId: string, purchaseToken: string): Promise<VerifiedPurchase | null> {
    const kind = kindOf(productId);
    const tok = encodeURIComponent(purchaseToken);
    if (kind === "annual") {
      const s = (await this.call("GET", `${this.app}/purchases/subscriptionsv2/tokens/${tok}`)) as any;
      if (!s) return null;
      const line = ((s.lineItems ?? []) as any[]).find((l) => l.productId === productId);
      if (!line) return null; // jeton d'un autre abonnement
      const expiresAt = line.expiryTime ? new Date(line.expiryTime) : null;
      let status = SUB_STATE[s.subscriptionState as string] ?? "pending";
      // Annulé (renouvellement arrêté) : l'accès continue jusqu'à la fin de la période payée ; ensuite expiré.
      if ((status === "active" || status === "cancelled") && (!expiresAt || expiresAt.getTime() <= Date.now())) status = "expired";
      return {
        platform: "google",
        productId,
        kind,
        purchaseKey: purchaseToken,
        accountToken: (s.externalAccountIdentifiers?.obfuscatedExternalAccountId as string | undefined)?.toLowerCase() ?? null,
        status,
        expiresAt,
        autoRenewing: Boolean(line.autoRenewingPlan?.autoRenewEnabled) && (status === "active" || status === "grace" || status === "on_hold"),
        environment: s.testPurchase ? "sandbox" : "production",
        storeRef: (s.latestOrderId as string | undefined) ?? null,
        linkedKey: (s.linkedPurchaseToken as string | undefined) ?? null,
        needsAck: s.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING",
      };
    }
    const p = (await this.call("GET", `${this.app}/purchases/products/${encodeURIComponent(productId)}/tokens/${tok}`)) as any;
    if (!p) return null;
    if (p.productId && p.productId !== productId) return null;
    const state = Number(p.purchaseState ?? 0); // 0 acheté, 1 annulé (remboursé), 2 en attente
    return {
      platform: "google",
      productId,
      kind,
      purchaseKey: purchaseToken,
      accountToken: (p.obfuscatedExternalAccountId as string | undefined)?.toLowerCase() ?? null,
      status: state === 0 ? "active" : state === 2 ? "pending" : "refunded",
      expiresAt: null,
      autoRenewing: false,
      environment: p.purchaseType === 0 ? "sandbox" : "production",
      storeRef: (p.orderId as string | undefined) ?? null,
      needsAck: Number(p.acknowledgementState ?? 0) === 0 && state === 0,
    };
  }

  async acknowledge(v: VerifiedPurchase): Promise<void> {
    const tok = encodeURIComponent(v.purchaseKey);
    const what = v.kind === "annual" ? "subscriptions" : "products";
    await this.call("POST", `${this.app}/purchases/${what}/${encodeURIComponent(v.productId)}/tokens/${tok}:acknowledge`);
  }

  /** Achats annulés ou remboursés depuis `since` (abonnements compris). */
  async voided(since: Date): Promise<{ purchaseToken: string; orderId?: string; voidedTimeMillis?: string }[]> {
    const out: { purchaseToken: string; orderId?: string; voidedTimeMillis?: string }[] = [];
    let page: string | undefined;
    for (let i = 0; i < 50; i++) {
      const q = new URLSearchParams({ startTime: String(since.getTime()), type: "1", maxResults: "1000", ...(page ? { token: page } : {}) });
      const r = (await this.call("GET", `${this.app}/purchases/voidedpurchases?${q}`)) as any;
      out.push(...((r?.voidedPurchases ?? []) as any[]));
      page = r?.tokenPagination?.nextPageToken;
      if (!page) break;
    }
    return out;
  }
}

export function googleConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  if (!env.GOOGLE_PLAY_PACKAGE || !env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) return null;
  let sa: GoogleConfig["serviceAccount"];
  try {
    sa = JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON n'est pas un JSON valide (contenu non affiché)");
  }
  if (!sa?.client_email || !sa?.private_key) throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON incomplet (client_email, private_key)");
  return { packageName: env.GOOGLE_PLAY_PACKAGE, serviceAccount: sa, rtdnToken: env.GOOGLE_RTDN_TOKEN || null };
}
