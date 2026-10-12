import type { Engine, State } from "../sync/engine";
import { NO_PREFS } from "../priceView";

/**
 * « Affichage des prix » : deux préférences propres à CE profil, désactivées par défaut, qui le suivent sur ses autres téléphones.
 * Les prix du catalogue et les quantités des listes restent communs à la famille.
 */
export function PriceDisplaySettings({ engine, s }: { engine: Engine; s: State }) {
  const prefs = s.me?.prefs ?? NO_PREFS;
  return (
    <section className="panel" aria-label="Affichage des prix" data-testid="price-prefs">
      <label className="check">
        <input type="checkbox" checked={prefs.showPrices} data-testid="pref-prices" onChange={(e) => void engine.setPrefs(e.target.checked, e.target.checked ? prefs.showTotals : false)} />
        <span><b>Afficher les prix indicatifs</b><small className="muted"> Le prix de chaque produit, avec son unité ou son conditionnement. Aucun montant.</small></span>
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.showTotals} data-testid="pref-totals" onChange={(e) => void engine.setPrefs(prefs.showPrices, e.target.checked)} />
        <span><b>Afficher les montants et le total estimé</b><small className="muted"> Montant de chaque article et total indicatif de la liste. Active aussi l'affichage des prix.</small></span>
      </label>
      <p className="muted"><small>Ces choix ne concernent que votre profil. Les quantités et les prix enregistrés ne changent pas.</small></p>
    </section>
  );
}
