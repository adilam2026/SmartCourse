import type { Catalog, ListView, Me, Op, OpResult } from "./types";

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
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  me: () => request<{ me: Me }>("GET", "/api/me"),
  catalog: () => request<Catalog>("GET", "/api/catalog"),
  activeList: () => request<{ list: ListView | null }>("GET", "/api/lists/active"),
  postOps: (listId: string, ops: Op[]) => request<{ results: OpResult[]; list: ListView }>("POST", `/api/lists/${listId}/ops`, { ops }),
  createList: () => request<{ list: ListView }>("POST", "/api/lists"),
  closeList: (listId: string) => request<{ status: string; remaining: number; purchased: number }>("POST", `/api/lists/${listId}/close`),
  history: () => request<{ lists: HistoryEntry[] }>("GET", "/api/lists"),
  listById: (id: string) => request<{ list: ListView }>("GET", `/api/lists/${id}`),
  credits: () => request<{ credits: Credit[] }>("GET", "/api/credits"),
};

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
