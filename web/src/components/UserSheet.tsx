import { useEffect, useState } from "react";
import { api, type Credit } from "../api";
import type { Engine, State } from "../sync/engine";

const ROLE: Record<string, string> = { admin: "Administrateur", parent: "Parent", staff: "Personnel" };

export function UserSheet({ engine, s, onClose }: { engine: Engine; s: State; onClose(): void }) {
  const [credits, setCredits] = useState<Credit[] | null>(null);
  const [generated, setGenerated] = useState<{ count: number; source: string } | null>(null);
  const [showCredits, setShowCredits] = useState(false);
  const pending = Object.keys(s.toggles).length + s.batches.length;
  useEffect(() => {
    if (showCredits && !credits) api.credits().then((r) => { setGenerated(r.generated); setCredits(r.credits); }).catch(() => setCredits([]));
  }, [showCredits, credits]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Mon profil" onClick={(e) => e.stopPropagation()}>
        <h2>{s.me?.displayName}</h2>
        <p className="muted">{s.me ? ROLE[s.me.role] : ""}</p>
        {pending > 0 && <p className="banner banner--pending">Des choix ne sont pas encore enregistrés. Ils resteront sur ce téléphone et seront envoyés à la prochaine connexion.</p>}
        <button className="btn btn--ghost" onClick={() => setShowCredits((v) => !v)}>Crédits photos</button>
        {showCredits && (
          <ul className="credits">
            {credits === null ? <li>Chargement…</li> : <>
              {generated && <li data-testid="credits-generated">{generated.count} visuels du catalogue : {generated.source}.</li>}
              {credits.length === 0 && !generated && <li>Aucune photo sous licence à créditer.</li>}
            </>}
            {credits?.map((c, i) => (
              <li key={i}>{c.text ?? `${c.author ?? c.sourceName} — ${c.license}`}</li>
            ))}
          </ul>
        )}
        <button className="btn btn--danger" data-testid="logout" onClick={() => { void engine.logout(); onClose(); }}>Se déconnecter</button>
        <button className="btn btn--ghost" onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
