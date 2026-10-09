export type Role = "admin" | "parent" | "staff";

export interface Me {
  id: string;
  familyId: string;
  displayName: string;
  login: string;
  role: Role;
  family?: { code: string; name: string };
}

export interface Product {
  id: string;
  category: string;
  name: string;
  brand: string | null;
  active: boolean;
  photoUrl: string | null;
}

export interface Catalog {
  /** Revision of the family catalogue (absent on an older server: then it is always downloaded). */
  rev?: number;
  categories: { key: string; label: string; products: Product[] }[];
}

export interface PurchaseInfo {
  id: string;
  at: string;
  by: { id: string; displayName: string };
}

export interface ListItem {
  id: string;
  productId: string;
  category: string;
  name: string;
  brand: string | null;
  photoUrl: string | null;
  productActive: boolean;
  status: "to_buy" | "purchased";
  rev: number;
  purchase?: PurchaseInfo;
}

export interface Correction {
  purchaseId: string;
  productId: string;
  name: string;
  purchasedBy: { id: string; displayName: string };
  purchasedAt: string;
  correctedBy: { id: string; displayName: string };
  correctedAt: string;
  reason: string | null;
}

export interface ListView {
  id: string;
  status: "active" | "archived";
  createdAt: string;
  closedAt: string | null;
  closedBy?: { id: string; displayName: string };
  items: ListItem[];
  corrections?: Correction[];
}

export type Op =
  | { opId: string; type: "add"; productId: string }
  | { opId: string; type: "remove"; productId: string; baseRev: number }
  | { opId: string; type: "purchase"; itemId: string }
  | { opId: string; type: "correct"; purchaseId: string; reason?: string | null };

export type RejectReason =
  | "list_closed"
  | "product_unknown"
  | "product_inactive"
  | "item_unknown"
  | "item_removed"
  | "locked_purchased"
  | "stale"
  | "purchase_unknown";

export interface OpResult {
  opId: string;
  status: "applied" | "already" | "rejected";
  reason?: RejectReason;
  detail?: { purchasedBy?: { id: string; displayName: string }; purchasedAt?: string };
  replay?: boolean;
}

export interface Batch {
  id: string;
  listId: string;
  ops: Op[];
  createdAt: number;
}

/** One unvalidated choice of the staff member for one product, relative to what is on the server/outbox. */
export interface Toggle {
  want: boolean;
  /** Revision of the article when the choice was made: a removal is only valid against that revision. */
  seenRev?: number;
}
export type Toggles = Record<string, Toggle>;
