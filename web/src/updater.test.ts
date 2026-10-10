import { describe, expect, it } from "vitest";
import { RUNNING, checkForUpdate, getUpdateState, type BuildInfo, type UpdaterDeps } from "./updater";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const build = (id: string): BuildInfo => ({ id, commit: "abc1234", builtAt: "2026-10-12T07:00:00Z" });
function deps(over: Partial<UpdaterDeps> & { server: BuildInfo | null }) {
  const calls = { reload: 0, swUpdate: 0 };
  const d: UpdaterDeps = {
    busy: () => false,
    reload: () => void calls.reload++,
    fetchBuild: async () => over.server,
    swUpdate: async () => void calls.swUpdate++,
    waitForControl: async () => {},
    storage: mem(),
    ...over,
  };
  return { d, calls };
}

describe("mise à jour de l'application déjà ouverte", () => {
  it("même version que le serveur : rien ne bouge", async () => {
    const { d, calls } = deps({ server: build(RUNNING.id) });
    expect(await checkForUpdate(d)).toBe("current");
    expect(calls).toEqual({ reload: 0, swUpdate: 0 });
    expect(getUpdateState().phase).toBe("current");
  });

  it("le serveur a une version plus récente : le service worker est rafraîchi puis la page se recharge", async () => {
    const { d, calls } = deps({ server: build("nouvelle-1") });
    expect(await checkForUpdate(d)).toBe("updating");
    expect(calls).toEqual({ reload: 1, swUpdate: 1 });
    expect(getUpdateState().server?.id).toBe("nouvelle-1");
  });

  it("page occupée (envoi en cours, fiche ouverte) : pas de rechargement, la mise à jour reste proposée", async () => {
    const { d, calls } = deps({ server: build("nouvelle-2"), busy: () => true });
    expect(await checkForUpdate(d)).toBe("available");
    expect(calls.reload).toBe(0);
    // la personne appuie sur « Mettre à jour maintenant » : on n'attend plus
    expect(await checkForUpdate(d, { force: true })).toBe("updating");
    expect(calls.reload).toBe(1);
  });

  it("jamais de boucle : après 2 tentatives pour la même version, la mise à jour reste proposée à la main", async () => {
    const { d, calls } = deps({ server: build("nouvelle-3") });
    expect(await checkForUpdate(d)).toBe("updating");
    expect(await checkForUpdate(d)).toBe("updating");
    expect(await checkForUpdate(d)).toBe("available");
    expect(calls.reload).toBe(2);
    expect(await checkForUpdate(d, { force: true })).toBe("updating"); // la main de la personne passe toujours
  });

  it("hors connexion ou serveur muet : aucun changement, aucune erreur", async () => {
    const before = getUpdateState().phase;
    const { d, calls } = deps({ server: null });
    expect(await checkForUpdate(d)).toBe(before);
    expect(calls.reload).toBe(0);
  });

  it("même si le rafraîchissement du service worker échoue, la page se recharge (en ligne, elle récupère les fichiers actuels)", async () => {
    const { d, calls } = deps({ server: build("nouvelle-4"), swUpdate: async () => { throw new Error("sw"); } });
    expect(await checkForUpdate(d)).toBe("updating");
    expect(calls.reload).toBe(1);
  });
});
