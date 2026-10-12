import { useState } from "react";
import { Icon } from "../Icon";
import { StaffScreen } from "../../screens/Staff";
import { useBackLayer } from "../../useBackLayer";
import type { Engine, State } from "../../sync/engine";
import { StaffList } from "./StaffList";

type Tab = "choose" | "list";

/**
 * V3 · parcours du personnel : « Choisir » (sélection des articles, brouillon) et « Liste du jour ». La validation d'une sélection
 * envoie les demandes (la liste du jour est créée si besoin) et propose de rejoindre la liste. Aucun droit nouveau : pas d'achat, pas de clôture.
 */
export function StaffApp({ engine, s }: { engine: Engine; s: State }) {
  const [tab, setTab] = useState<Tab>("choose");
  const [done, setDone] = useState<{ n: number; failed: boolean } | null>(null);
  useBackLayer(tab === "list", () => setTab("choose"));
  const pending = Object.keys(s.toggles).length;
  const queued = s.batches.length > 0 || s.sending;
  const validated = (n: number, result: "sent" | "queued" | "failed" | "nothing") => { if (n > 0 && result !== "nothing") setDone({ n, failed: result === "failed" }); };
  const TABS: { key: Tab; label: string; icon: "list" | "grid" }[] = [
    { key: "choose", label: "Choisir", icon: "grid" },
    { key: "list", label: "Liste du jour", icon: "list" },
  ];
  return (
    <div className="staffshell" data-testid="staff-shell">
      {tab === "choose" ? <StaffScreen engine={engine} s={s} onValidated={validated} /> : <StaffList engine={engine} s={s} onChoose={() => setTab("choose")} onValidated={validated} />}
      {done !== null && (
        <div className={`v3confirm ${done.failed ? "v3confirm--failed" : ""}`} role="status" data-testid="v3-confirm">
          <span className="v3confirm__text" data-testid="v3-confirm-text">
            {done.failed ? "La demande n'a pas pu être enregistrée. Vérifiez la liste et réessayez." : <><Icon name="check" size={18} /> {queued ? `${done.n} article${done.n > 1 ? "s" : ""} gardé${done.n > 1 ? "s" : ""} sur ce téléphone, envoyé${done.n > 1 ? "s" : ""} au retour du réseau` : `Demande enregistrée : ${done.n} article${done.n > 1 ? "s" : ""}`}</>}
          </span>
          <span className="v3confirm__actions">
            {tab === "choose" && !done.failed && <button className="btn btn--small" data-testid="v3-see-list" onClick={() => { setTab("list"); setDone(null); }}>Voir la liste du jour</button>}
            <button className="btn btn--small btn--ghost" aria-label="Fermer la confirmation" data-testid="v3-confirm-close" onClick={() => setDone(null)}>✕</button>
          </span>
        </div>
      )}
      <nav className="tabbar" aria-label="Navigation du personnel">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} aria-current={tab === t.key ? "page" : undefined} data-testid={`stafftab-${t.key}`} onClick={() => { setTab(t.key); if (t.key === "list") setDone(null); }}>
            <Icon name={t.icon} size={24} />
            <span>{t.label}{t.key === "choose" && pending > 0 ? ` (${pending})` : ""}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
