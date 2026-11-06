import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import type { SseHub } from "../hub.js";
import { AppleSignatureError, AppleStore, appleConfigFromEnv, type AppleNotification, type AppleRenewalInfo, type AppleTransaction } from "./apple.js";
import { attachPurchase, forceStatus, keyHash, type AttachResult } from "./entitlements.js";
import { GooglePlay, googleConfigFromEnv } from "./google.js";
import { PRODUCTS, UnknownProduct, type VerifiedPurchase } from "./types.js";

export interface StoreDeps {
  google?: GooglePlay | null;
  apple?: AppleStore | null;
  /** Achats de test (Google testeurs agréés, Apple Sandbox/TestFlight) : admis partout (recette) ou pour les familles listées. */
  sandbox?: { all: boolean; families?: string[] };
  log?: (msg: string) => void;
}

export type Submission = { platform: "google"; productId: string; purchaseToken: string } | { platform: "apple"; signedTransaction: string };

const unavailable = (store: string) => new HttpError(503, "store_unavailable", `${store} ne peut pas être vérifié pour le moment. L'achat est conservé par le store : réessayez « Restaurer les achats » plus tard.`);
const unknown = () => new HttpError(400, "purchase_unknown", "Achat introuvable auprès du store.");

export class StoreService {
  private sandboxFamilies: Set<string>;
  constructor(
    private db: Db,
    private hub: SseHub | undefined,
    private deps: StoreDeps,
  ) {
    this.sandboxFamilies = new Set(deps.sandbox?.families ?? []);
  }

  get google() {
    return this.deps.google ?? null;
  }
  get apple() {
    return this.deps.apple ?? null;
  }
  acceptSandbox = (familyId: string) => Boolean(this.deps.sandbox?.all) || this.sandboxFamilies.has(familyId);
  private log(m: string) {
    (this.deps.log ?? ((x) => console.log(x)))(m);
  }

  /** Achat (ou restauration) présenté par l'application : vérifié auprès du store, puis rattaché à la famille. */
  async submit(auth: { familyId: string; profileId: string }, s: Submission): Promise<AttachResult> {
    let v: VerifiedPurchase | null;
    try {
      if (s.platform === "google") {
        if (!this.google) throw unavailable("Google Play");
        if (!PRODUCTS[s.productId]) throw unknown();
        v = await this.google.verify(s.productId, s.purchaseToken);
      } else {
        if (!this.apple) throw unavailable("L'App Store");
        v = await this.apple.verifySignedTransaction(s.signedTransaction);
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof AppleSignatureError || e instanceof UnknownProduct) throw new HttpError(400, "purchase_invalid", "Achat non reconnu : signature ou produit invalide.");
      this.log(`store: vérification impossible (${s.platform}) : ${(e as Error).message}`);
      throw unavailable(s.platform === "google" ? "Google Play" : "L'App Store");
    }
    if (!v) throw unknown();
    const r = await attachPurchase(this.db, this.hub, v, { familyId: auth.familyId, profileId: auth.profileId, source: "client", type: "submit", acceptSandbox: this.acceptSandbox });
    await this.ackIfNeeded(v, r);
    return r;
  }

  /** Google exige une confirmation sous trois jours (sinon remboursement) : seulement pour un achat payé et rattaché. */
  private async ackIfNeeded(v: VerifiedPurchase, r: AttachResult) {
    if (v.platform !== "google" || !v.needsAck || !r.entitlementId || !["active", "grace", "cancelled"].includes(r.status ?? "")) return;
    try {
      await this.google!.acknowledge(v);
    } catch (e) {
      this.log(`store: confirmation Google reportée (${keyHash(v.purchaseKey)}) : ${(e as Error).message}`); // reprise au rapprochement
    }
  }

  /** Notification en temps réel Google Play (Pub/Sub, envoi « push »). Son contenu ne sert qu'à savoir QUEL achat revérifier. */
  async googleNotification(body: unknown): Promise<void> {
    if (!this.google) throw unavailable("Google Play");
    const msg = (body as { message?: { data?: string; messageId?: string; message_id?: string } })?.message;
    if (!msg?.data) throw new HttpError(400, "invalid_notification", "Notification invalide");
    let n: any;
    try {
      n = JSON.parse(Buffer.from(msg.data, "base64").toString("utf8"));
    } catch {
      throw new HttpError(400, "invalid_notification", "Notification invalide");
    }
    if (n.packageName !== this.google.cfg.packageName) return; // autre application : ignorée
    const eventKey = `pubsub:${msg.messageId ?? msg.message_id ?? ""}`;
    if (n.voidedPurchaseNotification?.purchaseToken) {
      await forceStatus(this.db, this.hub, "google", n.voidedPurchaseNotification.purchaseToken, "refunded", { source: "google_notification", type: "voided", eventKey });
      return;
    }
    const sub = n.subscriptionNotification;
    const one = n.oneTimeProductNotification;
    if (sub?.purchaseToken && Number(sub.notificationType) === 12) {
      await forceStatus(this.db, this.hub, "google", sub.purchaseToken, "revoked", { source: "google_notification", type: "sub:12", eventKey });
      return;
    }
    const productId = sub?.subscriptionId ?? one?.sku;
    const token = sub?.purchaseToken ?? one?.purchaseToken;
    if (!productId || !token || !PRODUCTS[productId]) return; // notification de test, autre produit
    const v = await this.google.verify(productId, token); // erreur réseau : 500, Pub/Sub renverra la notification
    if (!v) return;
    const type = sub ? `sub:${sub.notificationType}` : `product:${one.notificationType}`;
    const r = await attachPurchase(this.db, this.hub, v, { source: "google_notification", type, eventKey, acceptSandbox: this.acceptSandbox }).catch((e) => {
      if (e instanceof HttpError) return null; // refus journalisé (test refusé, autre famille)
      throw e;
    });
    if (r) await this.ackIfNeeded(v, r);
  }

  /** Notification App Store Server (version 2) : signée par Apple, vérifiée comme une transaction. */
  async appleNotification(body: unknown): Promise<void> {
    if (!this.apple) throw unavailable("L'App Store");
    const signed = (body as { signedPayload?: string })?.signedPayload;
    let n: AppleNotification;
    let tx: AppleTransaction | null = null;
    let ren: AppleRenewalInfo | null = null;
    try {
      n = this.apple.decode<AppleNotification>(String(signed ?? ""));
      if (n.data?.bundleId && n.data.bundleId !== this.apple.cfg.bundleId) return;
      if (n.data?.signedTransactionInfo) tx = this.apple.decode<AppleTransaction>(n.data.signedTransactionInfo);
      if (n.data?.signedRenewalInfo) ren = this.apple.decode<AppleRenewalInfo>(n.data.signedRenewalInfo);
    } catch (e) {
      if (e instanceof AppleSignatureError) throw new HttpError(400, "invalid_notification", "Notification non signée par Apple");
      throw e;
    }
    if (!tx || !PRODUCTS[tx.productId]) return; // TEST, autre produit
    const eventKey = `asn:${n.notificationUUID}`;
    let v: VerifiedPurchase;
    try {
      v = this.apple.toPurchase(tx, ren, n.data?.status);
    } catch {
      return;
    }
    if (n.notificationType === "REVOKE") v = { ...v, status: "revoked", autoRenewing: false };
    if (n.notificationType === "DID_FAIL_TO_RENEW" && n.subtype === "GRACE_PERIOD" && v.status !== "refunded") v = { ...v, status: "grace" };
    await attachPurchase(this.db, this.hub, v, {
      source: "apple_notification",
      type: n.subtype ? `${n.notificationType}:${n.subtype}` : n.notificationType,
      eventKey,
      reinstate: n.notificationType === "REFUND_REVERSED",
      acceptSandbox: this.acceptSandbox,
    }).catch((e) => {
      if (!(e instanceof HttpError)) throw e;
    });
  }

  /**
   * Rapprochement (commande d'administration, à lancer chaque jour) : revérifie auprès du store les droits encore en cours
   * ou récemment échus, relit les achats Google annulés des 30 derniers jours, reprend les confirmations Google manquées.
   * Rattrape toute notification perdue. Ne renvoie que des comptes, aucun identifiant.
   */
  async reconcile(): Promise<{ checked: number; changed: number; unreachable: number; voided: number; skippedApple: number }> {
    const rows = (
      await this.db.query(
        `SELECT family_id, platform, product_id, purchase_key, store_ref, environment, kind FROM family_entitlements
          WHERE product_id = ANY($1) AND (status IN ('active','grace','on_hold','cancelled','pending') OR (kind = 'annual' AND status = 'expired' AND expires_at > now() - interval '30 days'))`,
        [Object.keys(PRODUCTS)],
      )
    ).rows;
    const out = { checked: 0, changed: 0, unreachable: 0, voided: 0, skippedApple: 0 };
    for (const r of rows) {
      let v: VerifiedPurchase | null = null;
      try {
        if (r.platform === "google" && this.google) v = await this.google.verify(r.product_id, r.purchase_key);
        else if (r.platform === "apple" && this.apple?.hasApi) v = await this.apple.latest(r.purchase_key, r.environment, r.kind, r.store_ref ?? undefined);
        else {
          if (r.platform === "apple") out.skippedApple++;
          continue;
        }
      } catch {
        out.unreachable++;
        continue;
      }
      out.checked++;
      if (!v) continue;
      const res = await attachPurchase(this.db, this.hub, v, { source: "reconcile", type: "reconcile", acceptSandbox: () => true }).catch(() => null);
      if (res?.changed) out.changed++;
      if (res) await this.ackIfNeeded(v, res);
    }
    if (this.google) {
      try {
        for (const x of await this.google.voided(new Date(Date.now() - 30 * 86400_000))) {
          const done = await forceStatus(this.db, this.hub, "google", x.purchaseToken, "refunded", {
            source: "reconcile",
            type: "voided",
            eventKey: `voided:${keyHash(x.purchaseToken)}:${x.voidedTimeMillis ?? ""}`,
          });
          if (done) out.voided++;
        }
      } catch {
        out.unreachable++;
      }
    }
    return out;
  }
}

/** Configuration depuis les variables du serveur (aucune valeur secrète n'est jamais affichée). */
export function storesFromEnv(env: NodeJS.ProcessEnv = process.env): StoreDeps {
  const g = googleConfigFromEnv(env);
  const a = appleConfigFromEnv(env);
  const families = (env.STORE_SANDBOX_FAMILIES ?? "").split(/[\s,;]+/).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  return { google: g ? new GooglePlay(g) : null, apple: a ? new AppleStore(a) : null, sandbox: { all: env.STORE_ACCEPT_SANDBOX === "1", families } };
}
