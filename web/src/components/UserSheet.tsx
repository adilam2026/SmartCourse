import { useEffect, useState } from "react";
import { api, type Credit } from "../api";
import { CityPicker } from "./CityPicker";
import { userMessage } from "../errors";
import { useBackLayer } from "../useBackLayer";
import { DeleteAccount } from "./DeleteAccount";
import { PriceDisplaySettings } from "./PriceDisplaySettings";
import { NotificationSettings } from "./NotificationSettings";
import { VersionInfo } from "./VersionInfo";
import type { Engine, State } from "../sync/engine";

const ROLE: Record<string, string> = { admin: "Administrateur", parent: "Parent", staff: "Personnel" };

export function UserSheet({ engine, s, onClose }: { engine: Engine; s: State; onClose(): void }) {
  const [credits, setCredits] = useState<Credit[] | null>(null);
  const [generated, setGenerated] = useState<{ count: number; source: string } | null>(null);
  const [showCredits, setShowCredits] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [city, setCity] = useState(s.me?.city ?? "");
  const [cityMsg, setCityMsg] = useState<{ ok: boolean; text: string } | null>(null);
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
        <section className="sheetsection" aria-label="Ma ville" data-testid="my-city">
          <h3>Ma ville</h3>
          <CityPicker key={s.me?.city ?? ""} value={city} onChange={(c) => { setCity(c); setCityMsg(null); }} testid="me-city" label="Ville" />
          {cityMsg && <p className={cityMsg.ok ? "notice" : "error"} role={cityMsg.ok ? "status" : "alert"} data-testid="me-city-msg">{cityMsg.text}</p>}
          <button className="btn btn--small" disabled={!city || city === (s.me?.city ?? "")} data-testid="me-city-save" onClick={() => void engine.setCity(city).then(() => setCityMsg({ ok: true, text: "Ville enregistrée." })).catch((e) => setCityMsg({ ok: false, text: userMessage(e) }))}>Enregistrer ma ville</button>
        </section>
        <PriceDisplaySettings engine={engine} s={s} />
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
        {s.me?.primary
          ? <p className="muted" data-testid="delete-account-primary"><small>Pour supprimer ce compte, supprimez toute la famille : Réglages → Réinitialiser la famille.</small></p>
          : <button className="btn btn--ghost" data-testid="delete-account" onClick={() => setDeleting(true)}>Supprimer mon compte</button>}
        {deleting && <DeleteAccount engine={engine} onClose={() => setDeleting(false)} />}
        <section className="sheetsection sheetsection--secondary" aria-label="À propos">
          <h3>À propos</h3>
          <VersionInfo engine={engine} />
        </section>
        <button className="btn btn--ghost" onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
