import { useEffect, useState } from "react";
import { api, ApiError, NetworkError, type PurchaseStats } from "../api";
import { CATEGORY_EMOJI } from "../categories";
import { fmtMonth } from "../format";
import { purchasesDelta, quantityText } from "../stats";

/**
 * « Statistiques d'achats » — parents and administrators only.
 * What it shows is what was BOUGHT (confirmed purchases), not what was consumed; frequency (how many times) and quantity
 * (how much, per unit) are separate; there is no spending figure because no price is ever entered.
 */
export function Stats() {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [data, setData] = useState<PurchaseStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api
      .purchaseStats(month)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof NetworkError ? "Statistiques indisponibles hors connexion." : e instanceof ApiError && e.status === 403 ? "Réservé aux parents et administrateurs." : "Statistiques indisponibles."));
    return () => {
      live = false;
    };
  }, [month]);

  const idx = data ? data.months.indexOf(data.month) : -1;
  const older = data && idx >= 0 ? data.months[idx + 1] : undefined;
  const newer = data && idx > 0 ? data.months[idx - 1] : undefined;
  const prevLabel = data ? fmtMonth(data.previousMonth).toLowerCase() : "";

  return (
    <>
      <header className="topbar"><div className="topbar__title"><strong>Statistiques d'achats</strong><span className="muted">Ce qui a été acheté, pas ce qui a été consommé</span></div></header>
      {error && <p className="empty" data-testid="stats-error">{error}</p>}
      {data && (
        <>
          <div className="monthnav">
            <button className="btn" aria-label="Mois précédent" disabled={!older} data-testid="stats-prev" onClick={() => setMonth(older)}>←</button>
            <strong data-testid="stats-month">{fmtMonth(data.month)}</strong>
            <button className="btn" aria-label="Mois suivant" disabled={!newer} data-testid="stats-next" onClick={() => setMonth(newer)}>→</button>
          </div>
          <p className="statnote" data-testid="stats-total">
            {data.totals.purchases} achat{data.totals.purchases > 1 ? "s" : ""} confirmé{data.totals.purchases > 1 ? "s" : ""} en {fmtMonth(data.month).toLowerCase()} · {data.totals.previousPurchases} en {prevLabel}
          </p>
          {data.rows.length === 0 && <p className="empty" data-testid="stats-empty">Aucun achat confirmé ce mois-ci.</p>}
          <ul className="rows" data-testid="stats-rows">
            {data.rows.map((r) => {
              const dup = data.rows.filter((x) => x.productId === r.productId).length > 1;
              return (
                <li key={`${r.productId}|${r.unit ?? ""}`} className="row stat" data-testid={`stat-${r.name}`}>
                  <span className="row__name">
                    {CATEGORY_EMOJI[r.category] ?? "•"} {r.name}
                    {r.brand && <small>{r.brand}</small>}
                    {!r.active && <small>désactivé</small>}
                    {dup && r.unit && <small>achats comptés en {r.unit === "piece" ? "pièces" : r.unit === "paquet" ? "paquets" : r.unit === "bouteille" ? "bouteilles" : "kg"}</small>}
                  </span>
                  <span className="stat__nums">
                    <span data-testid={`freq-${r.name}`}>{r.current.purchases} achat{r.current.purchases > 1 ? "s" : ""}</span>
                    <small>{purchasesDelta(r.current.purchases, r.previous.purchases, prevLabel)}</small>
                    <span data-testid={`quant-${r.name}`}>{quantityText(r.current, r.unit)}</span>
                    {r.previous.purchases > 0 && <small>{prevLabel} : {quantityText(r.previous, r.unit)}</small>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="statnote">« Achats » compte les fois où le produit a été acheté ; « quantité » additionne ce qui a été acheté, séparément pour chaque unité (les kilos ne sont jamais ajoutés aux paquets). Les achats corrigés ne comptent pas.</p>
          <p className="statnote" data-testid="stats-no-spending">Aucun prix n'est saisi dans SmartCourse : il n'y a donc pas de statistiques de dépenses.</p>
        </>
      )}
    </>
  );
}
