import { useEffect, useRef, useState } from "react";
import { api, ApiError, NetworkError, type PurchaseStats, type StatsPeriod, type StatsRow, type StatsSort } from "../api";
import { Dialog } from "../components/Dialog";
import { MonthPicker } from "../components/MonthPicker";
import { ProductStatsSheet } from "../components/ProductStatsSheet";
import { Thumb } from "../components/Thumb";
import { fmtDayRange, fmtDayRangeShort, fmtMonth } from "../format";
import { lastPurchaseText, purchasesLine, shiftMonth, unitsText } from "../stats";

/**
 * « Statistiques d'achats » — parents and administrators only.
 * What it shows is what was BOUGHT (confirmed purchases), not what was consumed; « un achat » is one line marked « Acheté »
 * (not a number of shop visits); frequency and quantity (per unit) are separate; there is no spending figure (no price is entered).
 */
export function Stats({ onOpenList }: { onOpenList?(listId: string, status: string): void }) {
  const [period, setPeriod] = useState<StatsPeriod>("month");
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [category, setCategory] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<StatsSort>("frequency");
  const [data, setData] = useState<PurchaseStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [openRow, setOpenRow] = useState<StatsRow | null>(null);
  const [help, setHelp] = useState(false);

  // The search is sent a moment after the last keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    setError(null);
    api
      .purchaseStats({ period, month, category, q: query, sort })
      .then((d) => n === seq.current && setData(d))
      .catch((e) => n === seq.current && setError(e instanceof NetworkError ? "Statistiques indisponibles hors connexion." : e instanceof ApiError && e.status === 403 ? "Réservé aux parents et administrateurs." : "Statistiques indisponibles."));
  }, [period, month, category, query, sort]);

  const current = data?.currentMonth;
  const shown = data?.month ?? month;
  const idx = data && period === "month" ? data.months.indexOf(data.month) : -1;
  const older = idx >= 0 ? data!.months[idx + 1] : undefined;
  const newer = idx > 0 ? data!.months[idx - 1] : undefined;
  const chip = period === "last3" ? "last3" : shown && current && shown === current ? "current" : shown && current && shown === shiftMonth(current, -1) ? "previous" : "other";
  const pick = (p: StatsPeriod, m?: string) => {
    setPeriod(p);
    setMonth(m);
  };

  return (
    <>
      <header className="topbar"><div className="topbar__title"><strong>Statistiques d'achats</strong><span className="muted">Ce qui a été acheté, pas ce qui a été consommé</span></div></header>
      <div className="seg seg--wrap" role="tablist" aria-label="Période">
        <button role="tab" aria-selected={chip === "current"} className={chip === "current" ? "on" : ""} data-testid="period-current" onClick={() => pick("month", current)}>Ce mois</button>
        <button role="tab" aria-selected={chip === "previous"} className={chip === "previous" ? "on" : ""} data-testid="period-previous" disabled={!current} onClick={() => current && pick("month", shiftMonth(current, -1))}>Mois précédent</button>
        <button role="tab" aria-selected={chip === "last3"} className={chip === "last3" ? "on" : ""} data-testid="period-last3" onClick={() => pick("last3")}>3 derniers mois</button>
      </div>
      {error && <p className="empty" data-testid="stats-error">{error}</p>}
      {data && (
        <>
          <div className="monthnav">
            <button className="btn" aria-label="Mois précédent" disabled={!older} data-testid="stats-prev" onClick={() => pick("month", older)}>←</button>
            <button className="monthnav__title" data-testid="stats-month" aria-haspopup="dialog" aria-label={`${period === "last3" ? "Trois derniers mois" : fmtMonth(data.month)} : choisir un mois`} onClick={() => setPicking(true)}>
              {period === "last3" ? "3 derniers mois" : fmtMonth(data.month)} <span aria-hidden="true">▾</span>
            </button>
            <button className="btn" aria-label="Mois suivant" disabled={!newer} data-testid="stats-next" onClick={() => pick("month", newer)}>→</button>
          </div>
          <p className="statnote statnote--tight" data-testid="stats-window">{fmtDayRange(data.window.fromDay, data.window.toDay)}{data.window.partial && period === "month" ? " (mois en cours)" : ""}</p>

          <div className="statfilters">
            <input type="search" className="statfilters__q" value={text} onChange={(e) => setText(e.target.value)} placeholder="🔎 Chercher un produit" aria-label="Chercher un produit dans les statistiques" data-testid="stats-search" />
            <label className="statfilters__f">Catégorie
              <select value={category} onChange={(e) => setCategory(e.target.value)} data-testid="stats-category">
                <option value="">Toutes</option>
                {data.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                {category && !data.categories.some((c) => c.key === category) && <option value={category}>Catégorie choisie</option>}
              </select>
            </label>
            <label className="statfilters__f">Trier par
              <select value={sort} onChange={(e) => setSort(e.target.value as StatsSort)} data-testid="stats-sort">
                <option value="frequency">Fréquence d'achat</option>
                <option value="last">Dernier achat</option>
                <option value="name">Nom</option>
              </select>
            </label>
          </div>

          <p className="statnote" data-testid="stats-total">
            {data.totals.purchases} achat{data.totals.purchases > 1 ? "s" : ""} · {data.totals.products} produit{data.totals.products > 1 ? "s" : ""}
            {" "}
            <button className="linkbtn linkbtn--inline" data-testid="stats-help" onClick={() => setHelp(true)}>Qu'est-ce qu'un achat ?</button>
          </p>
          {data.comparison.available && data.totals.comparePurchases !== null && data.totals.comparePurchases > 0 && (
            <p className="statnote statnote--tight" data-testid="stats-compare-total">Même période avant ({fmtDayRangeShort(data.comparison.fromDay, data.comparison.toDay)}) : {data.totals.comparePurchases} achat{data.totals.comparePurchases > 1 ? "s" : ""}</p>
          )}
          {data.rows.length === 0 && <p className="empty" data-testid="stats-empty">{query || category ? "Aucun produit ne correspond." : period === "last3" ? "Aucun achat confirmé sur ces trois mois." : "Aucun achat confirmé sur cette période."}</p>}
          <ul className="rows" data-testid="stats-rows">
            {data.rows.map((r) => (
              <li key={r.productId}>
                <button className="row row--btn statrow" data-testid={`stat-${r.name}`} aria-label={`${r.name} : ${purchasesLine(r.purchases, r.units)}. Voir l'historique`} onClick={() => setOpenRow(r)}>
                  <Thumb photoUrl={r.photoUrl} category={r.category} />
                  <span className="row__name">
                    <b>{r.name}</b>
                    <span className="statrow__line" data-testid={`freq-${r.name}`}>{purchasesLine(r.purchases, r.units)}</span>
                    <small data-testid={`last-${r.name}`}>{lastPurchaseText(r.lastPurchaseAt)}{r.brand ? ` · ${r.brand}` : ""}{r.active ? "" : " · désactivé"}</small>
                    {data.comparison.available && r.compare && (
                      <small className="statrow__cmp" data-testid={`cmp-${r.name}`}>Même période avant : {r.compare.purchases} achat{r.compare.purchases > 1 ? "s" : ""} · {unitsText(r.compare.units)}</small>
                    )}
                  </span>
                  <span aria-hidden="true" className="chev">›</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="statnote" data-testid="stats-no-spending">Aucun prix n'est saisi dans SmartCourse : il n'y a donc pas de statistiques de dépenses.</p>
          {!data.comparison.available && <p className="statnote" data-testid="stats-no-compare">Pas de comparaison : l'historique ne couvre pas encore la période équivalente précédente.</p>}

          {picking && <MonthPicker current={data.currentMonth} selected={period === "month" ? data.month : null} withData={data.months} onPick={(m) => { pick("month", m); setPicking(false); }} onClose={() => setPicking(false)} />}
          {openRow && <ProductStatsSheet row={openRow} period={period} month={data.month} onOpenList={onOpenList} onClose={() => setOpenRow(null)} />}
          {help && (
            <Dialog title="Comment sont comptés les achats ?" onClose={() => setHelp(false)}>
              <p><strong>Un achat</strong> = une ligne de la liste marquée « Acheté » (un produit acheté une fois). Ce n'est pas un nombre de passages en magasin : trois produits achetés au même passage font trois achats.</p>
              <p>La <strong>quantité</strong> additionne ce qui a été acheté, séparément pour chaque unité : les kilos ne sont jamais ajoutés aux briques ni aux pièces. Les achats corrigés ne comptent pas.</p>
              <p>Les achats anciens, faits avant que les quantités existent, sont comptés mais leur quantité reste « non enregistrée ».</p>
              <p>L'absence d'achat enregistré ne prouve pas qu'un produit est nouveau, et un achat n'est pas une consommation réelle.</p>
              <button className="btn btn--ghost" onClick={() => setHelp(false)}>Fermer</button>
            </Dialog>
          )}
        </>
      )}
    </>
  );
}
