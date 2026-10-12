/**
 * Android "Back" button (and the browser's) for screens that are not browser pages: a dialog, the edit screen, a tab other than the
 * first. Each open layer pushes one history entry; Back pops it and closes the layer instead of leaving the app. When the UI closes
 * a layer by itself (a button), its entry is removed with history.back() and the resulting popstate is ignored.
 * With no layer open, Back keeps its normal meaning (leave the app / previous page).
 */
export interface HistoryLike {
  pushState(state: unknown, title: string): void;
  back(): void;
}
export interface WindowLike {
  history: HistoryLike;
  addEventListener(type: "popstate", fn: () => void): void;
}

interface Layer {
  /** Return false to refuse (e.g. an unsaved form): the layer stays open and the Back press is absorbed. */
  close: () => boolean | void;
}

export function createBackStack(win: WindowLike) {
  const stack: Layer[] = [];
  let ignore = 0;
  let waiters: (() => void)[] = [];
  const release = () => {
    const w = waiters;
    waiters = [];
    for (const fn of w) fn();
  };
  win.addEventListener("popstate", () => {
    if (ignore > 0) {
      ignore--;
      if (ignore === 0) release();
      return;
    }
    const top = stack[stack.length - 1];
    if (!top) return;
    if (top.close() === false) {
      win.history.pushState({ sc: 1 }, ""); // refused: put the entry back, stay on the layer
      return;
    }
    const i = stack.indexOf(top);
    if (i >= 0) stack.splice(i, 1);
  });
  return {
    /** Opens a layer; returns the function that releases it when the UI closes it. */
    push(close: Layer["close"]): () => void {
      const layer: Layer = { close };
      stack.push(layer);
      win.history.pushState({ sc: 1 }, "");
      return () => {
        const i = stack.indexOf(layer);
        if (i < 0) return; // already closed by the Back button
        stack.splice(i, 1);
        ignore++;
        win.history.back();
      };
    },
    depth: () => stack.length,
    /**
     * Resolves once every history entry released by the UI has really been popped (or after `ms`). Opening a new layer in the same tick
     * as closing others would let the queued Back steps pop the NEW entry: callers wait here first.
     */
    settled(ms = 600): Promise<void> {
      if (ignore === 0) return Promise.resolve();
      return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        waiters.push(() => (clearTimeout(t), resolve()));
      });
    },
  };
}

export const backStack = typeof window !== "undefined" ? createBackStack(window) : null;
