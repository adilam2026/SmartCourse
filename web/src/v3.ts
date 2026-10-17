import { useSyncExternalStore } from "react";

/**
 * Interrupteur V3 : propre à CET appareil (rien n'est enregistré sur le serveur, aucune famille n'est concernée).
 * Il ne peut être ACTIVÉ que par l'administrateur principal (Réglages → Aperçu V3) ; n'importe qui peut le COUPER (retour immédiat à la V2).
 * Par défaut : coupé, donc la V2 pour tous les utilisateurs.
 */
const KEY = "smartcourse.v3";
const listeners = new Set<() => void>();
let memory = false; // si le stockage du navigateur est indisponible

const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return memory;
  }
};
export const isV3On = (): boolean => read();

export function setV3On(on: boolean): void {
  memory = on;
  try {
    if (on) localStorage.setItem(KEY, "on");
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") window.addEventListener("storage", (e) => e.key === KEY && listeners.forEach((l) => l())); // autre onglet

export function useV3(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => false,
  );
}
