/** Produits « Mes Courses Famille » (identiques dans Play Console et App Store Connect). */
export const PRODUCT_ANNUAL = "courses_famille_annuel";
export const PRODUCT_LIFETIME = "courses_famille_a_vie";
export const PRODUCTS: Record<string, "annual" | "lifetime"> = { [PRODUCT_ANNUAL]: "annual", [PRODUCT_LIFETIME]: "lifetime" };

export class UnknownProduct extends Error {}
export function kindOf(productId: string): "annual" | "lifetime" {
  const k = PRODUCTS[productId];
  if (!k) throw new UnknownProduct(productId);
  return k;
}

export type StoreEnv = "sandbox" | "production";
export type EntStatus = "active" | "grace" | "on_hold" | "cancelled" | "expired" | "refunded" | "revoked" | "pending" | "replaced";

/** Achat tel que le store le confirme (jamais tel que l'application le décrit). */
export interface VerifiedPurchase {
  platform: "google" | "apple";
  productId: string;
  kind: "annual" | "lifetime";
  /** Google : jeton d'achat ; Apple : originalTransactionId (stable pour toute la vie de l'abonnement). */
  purchaseKey: string;
  /** Jeton de compte transmis au store à l'achat (Google obfuscatedAccountId, Apple appAccountToken). */
  accountToken: string | null;
  status: EntStatus;
  expiresAt: Date | null;
  autoRenewing: boolean;
  environment: StoreEnv;
  /** orderId Google / transactionId Apple (support, rapprochement). */
  storeRef: string | null;
  /** Google : jeton de l'abonnement précédent que celui-ci remplace. */
  linkedKey?: string | null;
  /** Google : achat à confirmer (acknowledge) sous trois jours, sinon remboursé par Google. */
  needsAck?: boolean;
  /** Apple : achat partagé par le Partage familial Apple (refusé : le droit suit la famille Mes Courses, pas la famille Apple). */
  familyShared?: boolean;
}
