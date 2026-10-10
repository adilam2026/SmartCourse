import { useEffect, useSyncExternalStore } from "react";
import { fmtDateTime } from "../format";
import { RUNNING, checkForUpdate, getUpdateState, subscribeUpdate, updateNow, type BuildInfo, type UpdaterDeps } from "../updater";
import { backStack } from "../back";
import type { Engine } from "../sync/engine";

export const makeUpdaterDeps = (engine: Engine): UpdaterDeps => ({
  // The page is only reloaded when nothing is being sent and no sheet/form is open. Drafts and the offline outbox are on disk anyway.
  busy: () => engine.getState().sending || (backStack?.depth() ?? 0) > 0,
  reload: () => location.reload(),
});

const label = (b: BuildInfo | null) => (b ? `${b.commit ?? "locale"} · ${b.builtAt ? fmtDateTime(b.builtAt) : "date inconnue"}` : "inconnue");

/** « Version de l'application » : what is really loaded on this phone, what the server has now, and a manual update button. */
export function VersionInfo({ engine }: { engine: Engine }) {
  const u = useSyncExternalStore(subscribeUpdate, getUpdateState);
  // Looking at this block checks the server (it never reloads by itself here: a sheet is open, so the page counts as busy).
  useEffect(() => void checkForUpdate(makeUpdaterDeps(engine)).catch(() => {}), [engine]);
  const text =
    u.phase === "current" ? "À jour" : u.phase === "available" ? "Une version plus récente est disponible" : u.phase === "updating" ? "Mise à jour en cours…" : "Pas encore vérifié";
  return (
    <section className="versioninfo" data-testid="version-info" aria-label="Version de l'application">
      <p><strong>Version de l'application</strong></p>
      <p className="muted" data-testid="version-running">Chargée sur ce téléphone : <b>{label(RUNNING)}</b> <small>({RUNNING.id})</small></p>
      <p className="muted" data-testid="version-server">Publiée par le serveur : <b>{label(u.server)}</b>{u.server ? <small> ({u.server.id})</small> : null}</p>
      <p className={u.phase === "available" ? "banner banner--pending" : "muted"} data-testid="version-status">{text}</p>
      <button className="btn btn--small" data-testid="update-check" onClick={() => void (u.phase === "available" ? updateNow(makeUpdaterDeps(engine)) : checkForUpdate(makeUpdaterDeps(engine), { force: true }))}>
        {u.phase === "available" ? "Mettre à jour maintenant" : "Vérifier les mises à jour"}
      </button>
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
