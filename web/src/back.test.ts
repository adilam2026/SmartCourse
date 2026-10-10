import { describe, expect, it } from "vitest";
import { createBackStack, type WindowLike } from "./back";

/** Minimal browser: a history list; back() pops and fires popstate asynchronously like a real browser. */
function fakeWindow() {
  const listeners: (() => void)[] = [];
  const entries = ["root"];
  let pending = 0;
  const win: WindowLike = {
    history: {
      pushState: () => void entries.push("layer"),
      back: () => {
        pending++;
      },
    },
    addEventListener: (_t, fn) => void listeners.push(fn),
  };
  return {
    win,
    entries,
    /** Delivers the queued back() calls (what the browser does after the call returns). */
    flush() {
      while (pending > 0) {
        pending--;
        entries.pop();
        listeners.forEach((l) => l());
      }
    },
    /** The user presses Back. */
    press() {
      pending++;
      this.flush();
    },
  };
}

describe("bouton Retour des écrans empilés", () => {
  it("ferme la couche ouverte au lieu de quitter, puis ne fait plus rien d'anormal", () => {
    const f = fakeWindow();
    const s = createBackStack(f.win);
    let closed = 0;
    s.push(() => void closed++);
    expect(f.entries).toEqual(["root", "layer"]);
    f.press();
    expect(closed).toBe(1);
    expect(s.depth()).toBe(0);
    expect(f.entries).toEqual(["root"]); // on est revenu à la page de départ : un autre Retour quitterait l'application
  });
  it("une couche fermée par l'interface retire son entrée d'historique sans rappeler close", () => {
    const f = fakeWindow();
    const s = createBackStack(f.win);
    let closed = 0;
    const release = s.push(() => void closed++);
    release();
    f.flush();
    expect(closed).toBe(0);
    expect(f.entries).toEqual(["root"]);
    expect(s.depth()).toBe(0);
  });
  it("deux couches : Retour ferme la plus récente seulement", () => {
    const f = fakeWindow();
    const s = createBackStack(f.win);
    const order: string[] = [];
    s.push(() => void order.push("onglet"));
    s.push(() => void order.push("dialogue"));
    f.press();
    expect(order).toEqual(["dialogue"]);
    expect(s.depth()).toBe(1);
    f.press();
    expect(order).toEqual(["dialogue", "onglet"]);
  });
  it("une couche qui refuse (formulaire non enregistré) reste ouverte et absorbe Retour", () => {
    const f = fakeWindow();
    const s = createBackStack(f.win);
    s.push(() => false);
    f.press();
    expect(s.depth()).toBe(1);
    expect(f.entries).toEqual(["root", "layer"]); // l'entrée a été remise : un nouveau Retour est encore absorbé
  });
  it("fermer deux couches par l'interface à la suite ne perturbe pas la suivante", () => {
    const f = fakeWindow();
    const s = createBackStack(f.win);
    const a = s.push(() => {});
    const b = s.push(() => {});
    b();
    a();
    f.flush();
    expect(f.entries).toEqual(["root"]);
    let closed = 0;
    s.push(() => void closed++);
    f.press();
    expect(closed).toBe(1);
  });
});
