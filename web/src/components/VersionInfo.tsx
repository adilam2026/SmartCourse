import { useEffect, useState, useSyncExternalStore } from "react";
import { checkClock, type ClockCheck } from "../clock";
import { checkForUpdate, getUpdateState, subscribeUpdate, updateNow, type UpdaterDeps } from "../updater";
import { backStack } from "../back";
import type { Engine } from "../sync/engine";

export const makeUpdaterDeps = (engine: Engine): UpdaterDeps => ({
  // The page is only reloaded when nothing is being sent and no sheet/form is open. Drafts and the offline outbox are on disk anyway.
  busy: () => engine.getState().sending || (backStack?.depth() ?? 0) > 0,
  reload: () => location.reload(),
});

/** « À propos » : whether the application is up to date, and a manual update button. Build identifiers stay internal. */
export function VersionInfo({ engine }: { engine: Engine }) {
  const u = useSyncExternalStore(subscribeUpdate, getUpdateState);
  // Looking at this block checks for a newer version (it never reloads by itself here: a sheet is open, so the page counts as busy).
  useEffect(() => void checkForUpdate(makeUpdaterDeps(engine)).catch(() => {}), [engine]);
  const [clock, setClock] = useState<ClockCheck | null>(null);
  useEffect(() => void checkClock().then(setClock), []);
  const text =
    u.phase === "current" ? "Application à jour" : u.phase === "available" ? "Une nouvelle version est disponible" : u.phase === "updating" ? "Mise à jour en cours…" : "Mise à jour non vérifiée";
  return (
    <section className="versioninfo" data-testid="version-info" aria-label="Mises à jour">
      <p className={u.phase === "available" ? "banner banner--pending" : "muted"} data-testid="version-status">{text}</p>
      {clock && clock.skewSec !== null && Math.abs(clock.skewSec) > 90 && (
        <p className="banner banner--notice" data-testid="clock-skew">L'horloge de ce téléphone est {clock.skewSec > 0 ? "en avance" : "en retard"} d'environ {Math.round(Math.abs(clock.skewSec) / 60)} min : réglez la date et l'heure automatiques.</p>
      )}
      <button className="btn btn--small" data-testid="update-check" onClick={() => void (u.phase === "available" ? updateNow(makeUpdaterDeps(engine)) : checkForUpdate(makeUpdaterDeps(engine), { force: true }))}>
        {u.phase === "available" ? "Mettre à jour maintenant" : "Vérifier les mises à jour"}
      </button>
      <p><a className="linkbtn" data-testid="privacy-link" href="/confidentialite.html">Confidentialité et suppression des données</a></p>
      <p className="muted"><small>La mise à jour ne supprime rien : vos choix non validés et les envois hors connexion sont conservés.</small></p>
    </section>
  );
}

/** Banner shown when a newer version exists but the page could not reload by itself (sheet open, sending…). */
export function UpdateBanner({ engine }: { engine: Engine }) {
  const u = useSyncExternalStore(subscribeUpdate, getUpdateState);
  if (u.phase !== "available" && u.phase !== "updating") return null;
  return (
    <div className="banner banner--pending updatebar" role="status" data-testid="update-banner">
      <span>{u.phase === "updating" ? "Mise à jour en cours…" : "Une nouvelle version est disponible."}</span>
      {u.phase === "available" && <button className="btn btn--small btn--primary" data-testid="update-now" onClick={() => void updateNow(makeUpdaterDeps(engine))}>Mettre à jour</button>}
    </div>
  );
}
