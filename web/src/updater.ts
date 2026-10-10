/*
 * Keeps the running app in step with the server, without reinstalling and without touching local data.
 *
 * Why it exists: a phone keeps the page it loaded (the Android app resumes the same page for days) and the service worker serves
 * the previous build from its cache until the next navigation. After a deployment the person kept seeing the old screens.
 * Each build publishes /version.json; the running bundle knows its own id (__BUILD_ID__). When they differ, the new service
 * worker is fetched, and the page reloads once it is in control. Drafts, quantities and the offline outbox live in IndexedDB and are
 * written before any network call, so a reload loses nothing; the reload only waits while a request is in flight.
 */
export interface BuildInfo {
  id: string;
  commit: string | null;
  builtAt: string;
}

export const RUNNING: BuildInfo = { id: typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev", commit: typeof __BUILD_COMMIT__ === "string" && __BUILD_COMMIT__ ? __BUILD_COMMIT__ : null, builtAt: typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "" };

export type UpdateState = { phase: "current" | "available" | "updating" | "unknown"; server: BuildInfo | null; checkedAt: number | null };

type Listener = () => void;
const listeners = new Set<Listener>();
let state: UpdateState = { phase: "unknown", server: null, checkedAt: null };
const set = (p: Partial<UpdateState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};
export const getUpdateState = () => state;
export const subscribeUpdate = (l: Listener) => (listeners.add(l), () => void listeners.delete(l));

/** Reads what the server publishes now. Never throws: offline simply leaves the previous knowledge. */
export async function fetchServerBuild(): Promise<BuildInfo | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return null;
    const j = (await r.json()) as BuildInfo;
    return typeof j?.id === "string" ? j : null;
  } catch {
    return null;
  }
}

export interface UpdaterDeps {
  /** True while the page must not be reloaded (a request is being sent, a form is open). */
  busy(): boolean;
  reload(): void;
  fetchBuild?: () => Promise<BuildInfo | null>;
  swUpdate?: () => Promise<void>;
  waitForControl?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  storage?: Pick<Storage, "getItem" | "setItem">;
}

/**
 * One check. Returns the resulting phase. When the server has a newer build: refresh the service worker, then reload — unless the
 * page is busy, in which case the update stays "available" (a banner offers it, and the next check retries).
 * A reload that does not bring the new build (service worker not yet in control) is tried at most `maxAttempts` times per build,
 * so the page can never reload in a loop.
 */
export async function checkForUpdate(deps: UpdaterDeps, { force = false } = {}): Promise<UpdateState["phase"]> {
  const server = await (deps.fetchBuild ?? fetchServerBuild)();
  if (!server) return state.phase;
  set({ server, checkedAt: Date.now() });
  if (server.id === RUNNING.id) {
    set({ phase: "current" });
    return "current";
  }
  set({ phase: "available" });
  if (!force && deps.busy()) return "available";
  const store = deps.storage ?? sessionStorage;
  const key = `smartcourse.update.${server.id}`;
  const tries = Number(store.getItem(key) ?? "0");
  if (!force && tries >= (deps.maxAttempts ?? 2)) return "available"; // never loop: the banner stays and offers a manual restart
  store.setItem(key, String(tries + 1));
  set({ phase: "updating" });
  try {
    await (deps.swUpdate ?? swUpdate)();
    await (deps.waitForControl ?? waitForControl)(6_000);
  } catch {
    /* even without a fresh service worker, a reload fetches the current files when online */
  }
  deps.reload();
  return "updating";
}

async function swUpdate(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration();
  await reg?.update();
}

/** Resolves when the (new) service worker takes control, or after `ms`. */
function waitForControl(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (!navigator.serviceWorker) return resolve();
    const done = () => {
      navigator.serviceWorker.removeEventListener("controllerchange", done);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, ms);
    navigator.serviceWorker.addEventListener("controllerchange", done);
  });
}

/** Wires the checks: shortly after start, when the app comes back to the foreground, when the network returns, every 10 minutes. */
export function startUpdater(deps: UpdaterDeps): void {
  const run = () => void checkForUpdate(deps).catch(() => {});
  setTimeout(run, 2_500);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && run());
  window.addEventListener("online", run);
  setInterval(() => document.visibilityState === "visible" && run(), 10 * 60_000);
}

/** Explicit "Mettre à jour maintenant" (banner / Réglages): no waiting, no attempt limit. */
export const updateNow = (deps: UpdaterDeps) => checkForUpdate(deps, { force: true });
