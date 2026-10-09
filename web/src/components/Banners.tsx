import type { Engine, State } from "../sync/engine";

export function Banners({ engine, s }: { engine: Engine; s: State }) {
  const queued = s.batches.reduce((n, b) => n + b.ops.length, 0);
  return (
    <div className="banners" role="status" aria-live="polite">
      {s.conn === "offline" && (
        <div className="banner banner--offline" data-testid="banner-offline">
          <span><strong>Hors connexion.</strong> Vos choix sont gardés sur ce téléphone.</span>
        </div>
      )}
      {queued > 0 && (
        <div className="banner banner--pending" data-testid="banner-pending">
          <span><strong>⏳ En attente de synchronisation</strong> ({queued} modification{queued > 1 ? "s" : ""}) — pas encore enregistré sur le serveur.</span>
        </div>
      )}
      {s.orphan && s.list && s.list.status === "active" && (
        <div className="banner banner--info" data-testid="banner-orphan">
          <span>
            La liste précédente a été clôturée. Reprendre vos <strong>{s.orphan.productIds.length}</strong> produit{s.orphan.productIds.length > 1 ? "s" : ""} dans la nouvelle liste ?
          </span>
          <span className="banner__actions">
            <button className="btn btn--small" onClick={() => void engine.resumeOrphan()} data-testid="orphan-resume">Reprendre</button>
            <button className="btn btn--small btn--ghost" onClick={() => void engine.dismissOrphan()}>Non</button>
          </span>
        </div>
      )}
      {s.notices.map((n) => (
        <div key={n.id} className="banner banner--notice" data-testid="notice">
          <span>{n.text}</span>
          <button className="banner__x" aria-label="Fermer" onClick={() => engine.dismissNotice(n.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
