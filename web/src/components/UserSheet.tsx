import { useEffect, useState } from "react";
import { api, type Credit } from "../api";
import { useBackLayer } from "../useBackLayer";
import { NotificationSettings } from "./NotificationSettings";
import { VersionInfo } from "./VersionInfo";
import type { Engine, State } from "../sync/engine";

const ROLE: Record<string, string> = { admin: "Administrateur", parent: "Parent", staff: "Personnel" };

export function UserSheet({ engine, s, onClose }: { engine: Engine; s: State; onClose(): void }) {
  const [credits, setCredits] = useState<Credit[] | null>(null);
  const [generated, setGenerated] = useState<{ count: number; source: string } | null>(null);
  const [showCredits, setShowCredits] = useState(false);
  const pending = Object.keys(s.toggles).length + s.batches.length;
  useBackLayer(true, onClose);
  useEffect(() => {
    if (showCredits && !credits) api.credits().then((r) => { setGenerated(r.generated); setCredits(r.credits); }).catch(() => setCredits([]));
  }, [showCredits, credits]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Mon profil" onClick={(e) => e.stopPropagation()}>
        <div className="phead">
          <span className="avatar" aria-hidden="true">{s.me?.displayName.slice(0, 1).toUpperCase()}</span>
          <div>
            <h2>{s.me?.displayName}</h2>
            <p className="muted">{s.me ? ROLE[s.me.role] : ""}</p>
          </div>
        </div>
        {pending > 0 && <p className="banner banner--pending">Des choix ne sont pas encore enregistrés. Ils resteront sur ce téléphone et seront envoyés à la prochaine connexion.</p>}
        {s.me && s.me.role !== "staff" && <NotificationSettings />}
        <button className="btn" onClick={() => setShowCredits((v) => !v)}>Crédits photos</button>
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
        <section className="sheetsection sheetsection--secondary" aria-label="À propos et version">
          <h3>À propos et version</h3>
          <VersionInfo engine={engine} />
        </section>
        <button className="btn btn--ghost" onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
