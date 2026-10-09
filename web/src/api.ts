import type { Catalog, ListView, Me, Op, OpResult, Product, Role } from "./types";

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
  setupFamily: (b: { installToken: string; familyName: string; admin: { displayName: string; login: string; secret: string } }) =>
    request<{ familyCode: string; me: Me }>("POST", "/api/setup/family", b),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  me: () => request<{ me: Me }>("GET", "/api/me"),
  catalog: () => request<Catalog>("GET", "/api/catalog"),
  activeList: () => request<{ list: ListView | null; catalogRev?: number }>("GET", "/api/lists/active"),
  postOps: (listId: string, ops: Op[]) => request<{ results: OpResult[]; list: ListView }>("POST", `/api/lists/${listId}/ops`, { ops }),
  createList: () => request<{ list: ListView }>("POST", "/api/lists"),
  closeList: (listId: string) => request<{ status: string; remaining: number; purchased: number }>("POST", `/api/lists/${listId}/close`),
  history: () => request<{ lists: HistoryEntry[] }>("GET", "/api/lists"),
  listById: (id: string) => request<{ list: ListView }>("GET", `/api/lists/${id}`),
  credits: () => request<{ generated: { count: number; source: string } | null; credits: Credit[] }>("GET", "/api/credits"),
  // administration
  profiles: () => request<{ profiles: Profile[] }>("GET", "/api/profiles"),
  createProfile: (b: { displayName: string; login: string; role: Role; secret?: string }) =>
    request<{ profile: Profile; secret: string }>("POST", "/api/profiles", b),
  updateProfile: (id: string, b: { displayName?: string; role?: Role; active?: boolean }) => request<{ profile: Profile }>("PATCH", `/api/profiles/${id}`, b),
  resetSecret: (id: string) => request<{ secret: string }>("POST", `/api/profiles/${id}/reset-secret`, {}),
  backupStatus: () => request<BackupStatus>("GET", "/api/admin/backup-status"),
  catalogAdmin: () => request<Catalog>("GET", "/api/catalog?includeInactive=1"),
  patchProduct: (id: string, b: ProductPatch) => request<{ product: Product }>("PATCH", `/api/products/${id}`, b),
  createProduct: (b: { name: string; category: string; image?: string; active?: boolean }) => request<{ product: Product }>("POST", "/api/products", b),
  searchExtended: (q: string) => request<{ results: ExtendedResult[] }>("GET", `/api/catalog/extended?q=${encodeURIComponent(q)}`),
  addFromExtended: (extendedId: string) => request<{ product: Product }>("POST", "/api/products/from-extended", { extendedId }),
  uploadPhoto: async (id: string, file: Blob) => {
    const res = await fetch(`/api/products/${id}/photo`, { method: "POST", credentials: "same-origin", headers: { "content-type": file.type || "image/jpeg" }, body: file }).catch(() => {
      throw new NetworkError();
    });
    if (!res.ok) throw new ApiError(res.status, "upload_failed", "Photo refusée");
    return (await res.json()) as { product: Product };
  },
};

/** `image` is a base64 picture (already shrunk by the phone); `resetImage` goes back to the catalogue picture. */
export interface ProductPatch {
  name?: string;
  category?: string;
  brand?: string | null;
  active?: boolean;
  image?: string;
  resetImage?: boolean;
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
  corrections: number;
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
