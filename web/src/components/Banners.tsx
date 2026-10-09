import type { Engine, State } from "../sync/engine";

/** How many banner rows are showing — used by the screen to free space on short phones. */
export const bannerCount = (s: State): number =>
  (s.conn === "offline" || s.batches.length > 0 ? 1 : 0) + (s.orphan && s.list?.status === "active" ? 1 : 0) + (s.notices.length > 0 ? 1 : 0);

/*
 * At most three compact rows, whatever the situation:
 *   1. one status row (offline and/or changes waiting to be synchronised),
 *   2. the "resume your choices" offer after a list was closed,
 *   3. the newest message (older ones queue behind it).
 * They sit in the sticky header under the "Valider" button, which therefore never moves or gets covered.
 */
export function Banners({ engine, s }: { engine: Engine; s: State }) {
  const queued = s.batches.reduce((n, b) => n + b.ops.length, 0);
  const offline = s.conn === "offline";
  const notice = s.notices[s.notices.length - 1];
  return (
    <div className="banners" role="status" aria-live="polite">
      {(offline || queued > 0) && (
        <div className={`banner ${queued > 0 ? "banner--pending" : "banner--offline"}`} data-testid="banner-status">
          {offline && (
            <span data-testid="banner-offline">
              <strong>Hors connexion.</strong> {queued === 0 && "Vos choix sont gardés sur ce téléphone."}
            </span>
          )}
          {queued > 0 && (
            <span data-testid="banner-pending">
              <strong>⏳ En attente de synchronisation</strong> ({queued}) : pas encore enregistré sur le serveur.
            </span>
          )}
        </div>
      )}
      {s.orphan && s.list && s.list.status === "active" && (
        <div className="banner banner--info" data-testid="banner-orphan">
          <span>
            Liste précédente clôturée. Reprendre vos <strong>{s.orphan.productIds.length}</strong> produit{s.orphan.productIds.length > 1 ? "s" : ""} ?
          </span>
          <span className="banner__actions">
            <button className="btn btn--small" onClick={() => void engine.resumeOrphan()} data-testid="orphan-resume">Reprendre</button>
            <button className="btn btn--small btn--ghost" onClick={() => void engine.dismissOrphan()}>Non</button>
          </span>
        </div>
      )}
      {notice && (
        <div key={notice.id} className="banner banner--notice" data-testid="notice">
          <span>
            {notice.text}
            {s.notices.length > 1 && <em> (+{s.notices.length - 1})</em>}
          </span>
          <button className="banner__x" aria-label="Fermer le message" onClick={() => engine.dismissNotice(notice.id)}>✕</button>
        </div>
      )}
    </div>
  );
}
