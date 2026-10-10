export type Role = "admin" | "parent" | "staff";

export interface Me {
  id: string;
  familyId: string;
  displayName: string;
  login: string;
  role: Role;
  family?: { code: string; name: string };
}

export type Unit = "piece" | "paquet" | "bouteille" | "kg";

export interface Product {
  id: string;
  unit: Unit;
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
  /** Frozen at purchase; null for purchases made before quantities existed. */
  quantity?: number | null;
  unit?: Unit | null;
}

export interface Person {
  id: string;
  displayName: string;
}

export type EventKind = "add" | "qty" | "remove" | "request_again" | "correct" | "merge";

/** One change to the list (parents only): kept forever, never overwritten. */
export interface ListEvent {
  id: string;
  itemId: string;
  productId: string;
  validationId: string;
  kind: EventKind;
  before: number | null;
  after: number | null;
  unit: Unit;
  /** The time shown: when the person pressed "Valider" on their phone. */
  at: string;
  /** When the server received it (later than `at` for a validation made offline). */
  receivedAt: string;
  by: Person;
  name: string;
  category: string;
}

/** One press on "Valider": its author, its time, and (through the events) its articles. */
export interface Validation {
  id: string;
  /** The time shown: the phone's time at the press (or the server's when the phone's clock was implausible). */
  at: string;
  receivedAt: string;
  /** What the phone announced, kept even when it was not retained (null: unknown, older validations). */
  clientAt?: string | null;
  by: Person;
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
  quantity: number;
  unit: Unit;
  purchase?: PurchaseInfo;
  /** Parents only: who asked for it and when (its first/last addition). */
  addedBy?: Person;
  addedAt?: string;
  addedReceivedAt?: string;
  /** Parents only: the latest change when it is not the creation itself. */
  lastChange?: { kind: EventKind; by: Person; at: string; receivedAt?: string; before: number | null; after: number | null };
}

export interface Correction {
  purchaseId: string;
  productId: string;
  name: string;
  purchasedBy: { id: string; displayName: string };
  purchasedAt: string;
  quantity?: number | null;
  unit?: Unit | null;
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
  events?: ListEvent[];
  validations?: Validation[];
}

export type Op =
  | { opId: string; type: "add"; productId: string; quantity?: number }
  | { opId: string; type: "set_qty"; productId: string; quantity: number; baseRev: number }
  | { opId: string; type: "request_again"; productId: string; quantity?: number }
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
  | "already_purchased"
  | "bad_quantity"
  | "duplicate_open"
  | "stale"
  | "purchase_unknown";

export interface OpResult {
  opId: string;
  status: "applied" | "already" | "rejected";
  reason?: RejectReason;
  detail?: { purchasedBy?: Person; purchasedAt?: string; quantity?: number; unit?: Unit; lastBy?: Person };
  replay?: boolean;
}

export interface Batch {
  id: string;
  listId: string;
  ops: Op[];
  createdAt: number;
  /** When the person pressed "Valider" (ISO). Sent with the batch so a validation made offline keeps its real time. */
  validatedAt?: string;
}

/** One unvalidated choice of the staff member for one product, relative to what is on the server/outbox. */
export interface Toggle {
  want: boolean;
  /** Chosen quantity (undefined = the default, 1, or the quantity already in the list). */
  qty?: number;
  /** Explicit new request for a product already bought in this list. */
  again?: boolean;
  /** Revision of the article when the choice was made: a removal is only valid against that revision. */
  seenRev?: number;
}
export type Toggles = Record<string, Toggle>;
