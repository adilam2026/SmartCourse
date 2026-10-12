import { fmtMoney, fmtPrice, lineAmount } from "../pricing";
import { fmtQty } from "../units";
import type { Prefs, Price, Unit } from "../types";

/**
 * Affichage du prix d'une ligne ou d'une carte selon les préférences du profil :
 *   simple (défaut)  : rien
 *   prix indicatifs  : « 9,90 DH / kg » seulement (aucun montant)
 *   prix et total    : quantité, prix unitaire et montant de l'article
 * Un prix absent n'est jamais zéro : rien n'est calculé, et « Prix à compléter » signale un prix inutilisable pour cette unité.
 */
export function PriceTag({ price, qty, unit, prefs, testid, showMissing }: { price: Price | null; qty?: number; unit: Unit; prefs: Prefs; testid: string; showMissing?: boolean }) {
  if (!prefs.showPrices) return null;
  if (!price) return showMissing ? <small className="price price--todo" data-testid={testid}>Prix à compléter</small> : null;
  const computable = qty === undefined || lineAmount(price, qty, unit).ok;
  if (!prefs.showTotals || qty === undefined) {
    return (
      <small className="price" data-testid={testid}>
        {fmtPrice(price)}
        {!computable && <> · <span className="price--todo">Prix à compléter</span></>}
      </small>
    );
  }
  const a = lineAmount(price, qty, unit);
  return (
    <small className="price" data-testid={testid}>
      {a.ok ? <>{fmtQty(qty, unit)} × {fmtPrice(price)} = <b>{fmtMoney(a.cents)}</b></> : <>{fmtPrice(price)} · <span className="price--todo">Prix à compléter</span></>}
    </small>
  );
}

/** Total estimé : un montant indicatif (pas une dépense payée) ; les lignes sans prix ne comptent jamais pour zéro. */
export function EstimateTotal({ summary, testid = "estimate" }: { summary: { cents: number; priced: number; unpriced: number; incomplete: boolean }; testid?: string }) {
  if (summary.priced === 0 && summary.unpriced === 0) return null;
  return (
    <section className="estimate" aria-label="Total estimé" data-testid={testid}>
      <div className="estimate__line">
        <span>{summary.incomplete ? "Sous-total connu (estimation)" : "Total estimé"}</span>
        <b data-testid={`${testid}-amount`}>{summary.priced > 0 ? fmtMoney(summary.cents) : "—"}</b>
      </div>
      {summary.incomplete && (
        <p className="estimate__warn" data-testid={`${testid}-incomplete`}>
          Estimation incomplète — {summary.unpriced} article{summary.unpriced > 1 ? "s" : ""} sans prix
        </p>
      )}
      <p className="muted estimate__note">Montant indicatif d'après les prix enregistrés, pas une dépense réellement payée.</p>
    </section>
  );
}
