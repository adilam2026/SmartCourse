import type { RefUnit } from "./pricing";
import type { Catalog, ListView, Me, Op, OpResult, Prefs, Price, Product, Role, Unit } from "./types";

/** The server could not be reached (offline, timeout, DNS…): nothing is known about what happened. */
export class NetworkError extends Error {
  constructor() {
    super("network");
  }
}

/** The server answered with an error status. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function statsParams(q: StatsQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, String(v));
  return p.toString();
}

const TIMEOUT_MS = 12_000;

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
  // A gateway error page (bad gateway while the server restarts) is "unreachable", not an answer.
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new NetworkError();
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new NetworkError();
  }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? "error", json?.message ?? "Erreur");
  return json as T;
}

export const api = {
  login: (familyCode: string, login: string, secret: string) => request<{ me: Me }>("POST", "/api/auth/login", { familyCode, login, secret }),
  setupFamily: (b: { installToken: string; familyName: string; admin: { displayName: string; login: string; secret: string; secretConfirm: string; recoveryEmail: string; city: string } }) =>
    request<{ familyCode: string; me: Me }>("POST", "/api/setup/family", b),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  pushConfig: () => request<{ publicKey: string }>("GET", "/api/push/config"),
  pushSubscribe: (b: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }) => request<{ ok: true }>("POST", "/api/push/subscriptions", b),
  pushUnsubscribe: (endpoint: string) => request<{ removed: number }>("DELETE", "/api/push/subscriptions", { endpoint }),
  pushCheck: (endpoint: string) => request<{ registered: boolean }>("POST", "/api/push/subscriptions/check", { endpoint }),
  me: () => request<{ me: Me }>("GET", "/api/me"),
  catalog: () => request<Catalog>("GET", "/api/catalog"),
  activeList: () => request<{ list: ListView | null; catalogRev?: number; prefsRev?: number }>("GET", "/api/lists/active"),
  postOps: (listId: string, ops: Op[], batch?: { id: string; at?: string }) =>
    request<{ results: OpResult[]; list: ListView }>("POST", `/api/lists/${listId}/ops`, { ops, ...(batch ? { batch } : {}) }),
  purchaseStats: (q: StatsQuery = {}) => request<PurchaseStats>("GET", `/api/stats/purchases?${statsParams(q)}`),
  productStats: (id: string, q: Pick<StatsQuery, "period" | "month"> = {}) => request<ProductStats>("GET", `/api/stats/products/${id}?${statsParams(q)}`),
  createList: () => request<{ list: ListView }>("POST", "/api/lists"),
  closeList: (listId: string) => request<{ status: string; remaining: number; purchased: number }>("POST", `/api/lists/${listId}/close`),
  history: () => request<{ lists: HistoryEntry[] }>("GET", "/api/lists"),
  listById: (id: string) => request<{ list: ListView }>("GET", `/api/lists/${id}`),
  credits: () => request<{ generated: { count: number; source: string } | null; credits: Credit[] }>("GET", "/api/credits"),
  // administration
  profiles: () => request<{ profiles: Profile[] }>("GET", "/api/profiles"),
  createProfile: (b: { displayName: string; login: string; role: Role; secret: string; secretConfirm: string; city: string }) =>
    request<{ profile: Profile }>("POST", "/api/profiles", b),
  updateProfile: (id: string, b: { displayName?: string; role?: Role; active?: boolean }) => request<{ profile: Profile }>("PATCH", `/api/profiles/${id}`, b),
  deleteProfile: (id: string) => request<{ ok: true }>("DELETE", `/api/profiles/${id}`),
  deleteOwnAccount: (secret: string) => request<{ ok: true }>("POST", "/api/me/delete", { secret }),
  // prix, favoris, préférences d'affichage
  setCity: (city: string) => request<{ city: string }>("PUT", "/api/me/city", { city }),
  deleteList: (id: string) => request<{ ok: true }>("DELETE", `/api/lists/${id}`),
  setPrefs: (b: { showPrices: boolean; showTotals: boolean }) => request<{ prefs: Prefs }>("PUT", "/api/me/prefs", b),
  setPrice: (id: string, b: PriceInput) => request<{ price: Price | null }>("PUT", `/api/products/${id}/price`, b),
  resetPrice: (id: string) => request<{ price: Price | null }>("DELETE", `/api/products/${id}/price`),
  repriceList: (listId: string) => request<{ updated: number; list: ListView }>("POST", `/api/lists/${listId}/reprice`),
  templates: () => request<{ templates: Template[] }>("GET", "/api/templates"),
  createTemplate: (b: { name: string; items?: { productId: string; quantity: number }[]; fromListId?: string }) => request<{ template: Template }>("POST", "/api/templates", b),
  updateTemplate: (id: string, b: { name?: string; items?: { productId: string; quantity: number }[] }) => request<{ template: Template }>("PUT", `/api/templates/${id}`, b),
  deleteTemplate: (id: string) => request<{ ok: true }>("DELETE", `/api/templates/${id}`),
  sharePrice: (b: { productId: string; observedOn?: string; city?: string; store?: string }) => request<{ ok: true }>("POST", "/api/prices/share", b),
  communityPrices: () => request<{ proposals: PriceProposal[]; city: string; minContributors: number }>("GET", "/api/prices/community"),
  applyCommunityPrices: (items: { productId: string; format: string }[]) => request<{ applied: number; gone: number }>("POST", "/api/prices/community/apply", { items }),
  reportCommunityPrice: (b: { productId: string; format: string; reason?: string }) => request<{ ok: true }>("POST", "/api/prices/community/report", b),
  resetSecret: (id: string, secret: string, secretConfirm: string) => request<{ ok: true }>("POST", `/api/profiles/${id}/reset-secret`, { secret, secretConfirm }),
  recoveryState: () => request<RecoveryState>("GET", "/api/recovery-email"),
  setRecoveryEmail: (email: string) => request<RecoveryState>("PUT", "/api/recovery-email", { email }),
  resendRecovery: () => request<RecoveryState>("POST", "/api/recovery-email/resend", {}),
  testRecovery: () => request<RecoveryState>("POST", "/api/recovery-email/test", {}),
  resetPreview: () => request<ResetPreview>("GET", "/api/family/reset-preview"),
  resetFamily: (password: string, confirmCode: string) => request<{ ok: true; installToken: string; deleted: Record<string, number>; otherFamiliesUntouched: number; photoFilesRemoved: number }>("POST", "/api/family/reset", { password, confirmCode }),
  verifyEmail: (token: string) => request<{ ok: true }>("POST", "/api/auth/verify-email", { token }),
  forgotFamilyCode: (email: string) => request<{ ok: true; message: string }>("POST", "/api/auth/forgot-family-code", { email }),
  forgotPassword: (email: string, familyCode?: string) => request<{ ok: true; message: string }>("POST", "/api/auth/forgot-password", { email, familyCode }),
  checkResetToken: (token: string) => request<{ valid: boolean }>("POST", "/api/auth/reset-password/check", { token }),
  resetPassword: (token: string, secret: string, secretConfirm: string) => request<{ ok: true }>("POST", "/api/auth/reset-password", { token, secret, secretConfirm }),
  backupStatus: () => request<BackupStatus>("GET", "/api/admin/backup-status"),
  catalogAdmin: () => request<Catalog>("GET", "/api/catalog?includeInactive=1"),
  patchProduct: (id: string, b: ProductPatch) => request<{ product: Product }>("PATCH", `/api/products/${id}`, b),
  createProduct: (b: { name: string; category: string; image?: string; active?: boolean; unit?: Unit }) => request<{ product: Product }>("POST", "/api/products", b),
  searchExtended: (q: string) => request<{ results: ExtendedResult[] }>("GET", `/api/catalog/extended?q=${encodeURIComponent(q)}`),
  addFromExtended: (extendedId: string) => request<{ product: Product }>("POST", "/api/products/from-extended", { extendedId }),
  catalogAudit: () => request<{ products: AuditProduct[] }>("GET", "/api/catalog/audit"),
  catalogAll: (o: { category?: string; q?: string; offset?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (o.category) qs.set("category", o.category);
    if (o.q) qs.set("q", o.q);
    qs.set("offset", String(o.offset ?? 0));
    qs.set("limit", String(o.limit ?? 24));
    return request<CatalogAllPage>("GET", `/api/catalog/all?${qs}`);
  },
  addFromCatalog: (origin: "initial" | "extended", key: string) =>
    request<{ product: Product; created: boolean; reactivated: boolean }>("POST", "/api/products/from-catalog", { origin, key }),
  uploadPhoto: async (id: string, file: Blob) => {
    const res = await fetch(`/api/products/${id}/photo`, { method: "POST", credentials: "same-origin", headers: { "content-type": file.type || "image/jpeg" }, body: file }).catch(() => {
      throw new NetworkError();
    });
    if (!res.ok) throw new ApiError(res.status, "upload_failed", "Photo refusée");
    return (await res.json()) as { product: Product };
  },
};

export interface PriceInput {
  amount: string;
  refQty: string;
  refUnit: RefUnit;
  packaging?: string | null;
  pieceWeightG?: string | null;
}
export interface TemplateItem {
  productId: string;
  name: string;
  brand: string | null;
  category: string;
  photoUrl: string | null;
  quantity: number;
  unit: Unit;
  productActive: boolean;
  currentUnit: Unit;
}
export interface Template {
  id: string;
  name: string;
  updatedAt: string;
  items: TemplateItem[];
}
export interface PriceProposal {
  productId: string;
  name: string;
  format: string;
  price: { amount: string; refQty: string; refUnit: RefUnit; packaging: string | null };
  contributors: number;
  min: string;
  max: string;
  latestObservedOn: string;
  current: Price | null;
}

/** `image` is a base64 picture (already shrunk by the phone); `resetImage` goes back to the catalogue picture. */
export interface ProductPatch {
  name?: string;
  category?: string;
  brand?: string | null;
  active?: boolean;
  unit?: Unit;
  image?: string;
  resetImage?: boolean;
}

export type StatsPeriod = "month" | "last3";
export type StatsSort = "frequency" | "last" | "name";
/** One unit of one product: how many purchases, how much (null = never recorded) and how many purchases have no quantity. */
export interface StatsUnitCell {
  unit: Unit | null;
  purchases: number;
  quantity: number | null;
  unknownQuantity: number;
}
export interface StatsRow {
  productId: string;
  name: string;
  brand: string | null;
  active: boolean;
  category: string;
  categoryLabel: string;
  photoUrl: string | null;
  purchases: number;
  lastPurchaseAt: string | null;
  units: StatsUnitCell[];
  /** Same product over the equivalent earlier period; null when there is nothing reliable to compare with. */
  compare: { purchases: number; units: StatsUnitCell[] } | null;
}
export interface StatsWindow {
  from: string;
  to: string;
  fromDay: string; // YYYY-MM-DD, first day included (Africa/Casablanca)
  toDay: string; // last day included
}
export interface PurchaseStats {
  period: StatsPeriod;
  month: string;
  currentMonth: string;
  timeZone: string;
  months: string[];
  window: StatsWindow & { partial: boolean };
  comparison: StatsWindow & { available: boolean };
  categories: { key: string; label: string }[];
  rows: StatsRow[];
  totals: { purchases: number; products: number; comparePurchases: number | null };
  spending: null;
}
export interface StatsQuery {
  period?: StatsPeriod;
  month?: string;
  category?: string;
  q?: string;
  sort?: StatsSort;
}
export interface ProductPurchase {
  id: string;
  at: string;
  quantity: number | null;
  unit: Unit | null;
  by: { id: string; displayName: string };
  list: { id: string; status: string; createdAt: string; closedAt: string | null };
}
export interface ProductStats {
  product: { id: string; name: string; brand: string | null; active: boolean; category: string; categoryLabel: string; photoUrl: string | null };
  period: StatsPeriod;
  month: string;
  window: StatsWindow & { partial: boolean };
  summary: { purchases: number; units: StatsUnitCell[]; lastPurchaseAt: string | null };
  purchases: ProductPurchase[];
  months: { month: string; covered: boolean; units: StatsUnitCell[] }[];
}

export interface BackupStatus {
  configured: boolean;
  storage: "s3" | "local" | null;
  schedule: string;
  tools: { ok: boolean; message: string; serverMajor: number | null; available: number[] } | null;
  lastBackupAt: string | null;
  lastVerifiedOkAt: string | null;
  lastVerifyFailedAt: string | null;
}

export interface Profile {
  id: string;
  displayName: string;
  login: string;
  role: Role;
  active: boolean;
  /** Administrateur principal : rôle figé, jamais désactivé. */
  primary: boolean;
  city?: string | null;
}

export interface RecoveryState {
  canEdit: boolean;
  email: string | null;
  verified: boolean;
  /** Première installation inachevée : l'adresse doit être vérifiée pour terminer. */
  setupPending: boolean;
  /** Secondes avant de pouvoir demander un nouveau lien de vérification. */
  resendInSeconds: number;
  /** Dernier message : en cours, envoyé, ou non envoyé. Rien d'autre n'est révélé à l'écran. */
  lastMail: { kind: string; status: "sending" | "sent" | "failed"; at: string } | null;
}

export interface AuditProduct {
  id: string;
  name: string;
  category: string;
  active: boolean;
  unit: Unit;
  photoSource: "none" | "catalogue" | "famille";
  sharedWithOtherNames: boolean;
  /** Picture the catalogue holds for this very product (by name or link), when it differs from the one shown. */
  catalogPhotoUrl: string | null;
}
export interface CatalogAllItem {
  key: string;
  origin: "initial" | "extended" | "family";
  name: string;
  brand: string | null;
  category: string;
  photoUrl: string | null;
  status: "absent" | "active" | "inactive";
  productId: string | null;
  unit: Unit;
}
export interface CatalogAllPage {
  total: number;
  offset: number;
  items: CatalogAllItem[];
}

export interface ExtendedResult {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  photoUrl: string | null;
  alreadyAdded: boolean;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  closedAt: string;
  closedBy: { id: string; displayName: string };
  purchased: number;
  remaining: number;
  thumbs?: { name: string; photoUrl: string | null }[];
}

export interface Credit {
  sourceName: string;
  sourceUrl: string | null;
  license: string;
  licenseUrl: string | null;
  author: string | null;
  attributionRequired: boolean;
  text: string | null;
}

export interface ResetPreview {
  family: { name: string; code: string; createdAt: string; profiles: { displayName: string; login: string; role: string; primary: boolean; active: boolean }[] };
  counts: Record<string, number>;
  ready: { recoveryEmailVerified: boolean };
}

