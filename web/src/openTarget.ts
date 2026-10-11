import { useSyncExternalStore } from "react";

/**
 * « Open this list » — set by a tap on a notification (address ?open=<list>, or a message from the service worker when the
 * application was already open). It survives the login screen: if the session expired, the person signs in and then lands on the
 * list. It is read once, by the screen that can show lists (parents and administrators), and then cleared.
 */
const KEY = "smartcourse.openList";
const TTL_MS = 30 * 60_000;
let target: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const store = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function setOpenTarget(listId: string | null | undefined): void {
  if (!listId || !UUID.test(listId)) return;
  target = listId;
  try {
    store()?.setItem(KEY, JSON.stringify({ listId, at: Date.now() }));
  } catch {
    /* private mode: memory only */
  }
  emit();
}

export function clearOpenTarget(): void {
  target = null;
  try {
    store()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/** At startup: the address may carry ?open=…, or an earlier tap may be waiting behind the login screen. */
export function readOpenTargetFromLocation(loc: Pick<Location, "search" | "pathname" | "hash"> = window.location): void {
  const q = new URLSearchParams(loc.search).get("open");
  if (q) {
    setOpenTarget(q);
    try {
      window.history.replaceState(null, "", loc.pathname + loc.hash); // the address no longer carries it: a reload does not reopen it
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const saved = JSON.parse(store()?.getItem(KEY) ?? "null") as { listId: string; at: number } | null;
    if (saved && Date.now() - saved.at < TTL_MS && UUID.test(saved.listId)) target = saved.listId;
  } catch {
    /* ignore */
  }
}

export const getOpenTarget = (): string | null => target;
export function useOpenTarget(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => target,
  );
}
