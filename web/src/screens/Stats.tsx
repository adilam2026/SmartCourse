import { useEffect, useRef, useState } from "react";
import { api, ApiError, NetworkError, type PurchaseStats, type StatsPeriod, type StatsRow, type StatsSort } from "../api";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/PageHead";
import type { Engine, State } from "../sync/engine";
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
export function Stats({ engine, s, onOpenList }: { engine: Engine; s: State; onOpenList?(listId: string, status: string): void }) {
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
  const [filters, setFilters] = useState(false);

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

  const defaultPeriod = chip === "current" && !category && sort === "frequency";
  const reset = () => {
    setPeriod("month");
    setMonth(undefined);
    setCategory("");
    setSort("frequency");
    setText("");
  };
  const catLabel = data?.categories.find((c) => c.key === category)?.label;
  const activeCount = (category ? 1 : 0) + (sort !== "frequency" ? 1 : 0) + (chip !== "current" ? 1 : 0);
  const max = Math.max(1, ...(data?.rows.map((r) => r.purchases) ?? [1])); // one measure for every bar: the number of purchases

  return (
    <>
      <PageHead engine={engine} s={s} title="Vos achats" />
      {error && <p className="empty" data-testid="stats-error">{error}</p>}
      {data && (
        <>
          <div className="monthnav">
            <button className="btn" aria-label="Mois précédent" disabled={!older} data-testid="stats-prev" onClick={() => pick("month", older)}><Icon name="chevron-left" /></button>
            <button className="monthnav__title" data-testid="stats-month" aria-haspopup="dialog" aria-label={`${period === "last3" ? "Trois derniers mois" : fmtMonth(data.month)} : choisir un mois`} onClick={() => setPicking(true)}>
              <Icon name="calendar" size={20} /> {period === "last3" ? "3 derniers mois" : fmtMonth(data.month)} <Icon name="chevron-down" size={18} />
            </button>
            <button className="btn" aria-label="Mois suivant" disabled={!newer} data-testid="stats-next" onClick={() => pick("month", newer)}><Icon name="chevron-right" /></button>
          </div>
          <p className="statnote statnote--tight" data-testid="stats-window">{fmtDayRange(data.window.fromDay, data.window.toDay)}{data.window.partial && period === "month" ? " (mois en cours)" : ""}</p>

          <div className="statsum" data-testid="stats-total" aria-label="Synthèse de la période">
            <div className="statsum__card">
              <span className="statsum__icon"><Icon name="cart" size={24} /></span>
              <span><span className="statsum__num" data-testid="sum-purchases">{data.totals.purchases}</span><span className="statsum__lbl">achat{data.totals.purchases > 1 ? "s" : ""}</span></span>
            </div>
            <div className="statsum__card">
              <span className="statsum__icon"><Icon name="grid" size={24} /></span>
              <span><span className="statsum__num" data-testid="sum-products">{data.totals.products}</span><span className="statsum__lbl">produit{data.totals.products > 1 ? "s" : ""} distinct{data.totals.products > 1 ? "s" : ""}</span></span>
            </div>
          </div>
          {data.comparison.available && data.totals.comparePurchases !== null && data.totals.comparePurchases > 0 && (
            <p className="statnote statnote--tight" data-testid="stats-compare-total">Même période avant ({fmtDayRangeShort(data.comparison.fromDay, data.comparison.toDay)}) : {data.totals.comparePurchases} achat{data.totals.comparePurchases > 1 ? "s" : ""}</p>
          )}

          <div className="listhead">
            <h2>Les plus achetés</h2>
            <span className="listhead__tools">
              <button className="btn btn--small" data-testid="stats-filters" aria-haspopup="dialog" onClick={() => setFilters(true)}>
                <Icon name="filter" size={20} /> Filtres{activeCount ? ` (${activeCount})` : ""}
              </button>
              <button className="btn btn--small btn--ghost helpbtn" data-testid="stats-help" aria-label="Aide : comment sont comptés les achats ?" aria-haspopup="dialog" onClick={() => setHelp(true)}>?</button>
            </span>
          </div>
          {(!defaultPeriod || text) && (
            <div className="activefilters" data-testid="active-filters">
              {chip !== "current" && <span className="fchip">{period === "last3" ? "3 derniers mois" : fmtMonth(data.month)}</span>}
              {category && <span className="fchip">{catLabel ?? "Catégorie"} <button aria-label="Retirer le filtre de catégorie" onClick={() => setCategory("")}>✕</button></span>}
              {sort !== "frequency" && <span className="fchip">Tri : {sort === "last" ? "dernier achat" : "nom"} <button aria-label="Revenir au tri par fréquence" onClick={() => setSort("frequency")}>✕</button></span>}
              <button className="btn btn--ghost btn--small" data-testid="stats-reset" onClick={reset}>Réinitialiser</button>
            </div>
          )}
          <div className="searchbox statsearch">
            <Icon name="search" size={20} />
            <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Rechercher un produit…" aria-label="Chercher un produit dans les statistiques" data-testid="stats-search" />
          </div>
          {data.rows.length === 0 && <p className="empty" data-testid="stats-empty">{query || category ? "Aucun produit ne correspond." : period === "last3" ? "Aucun achat confirmé sur ces trois mois." : "Aucun achat confirmé sur cette période."}</p>}
          <ul className="rows" data-testid="stats-rows">
            {data.rows.map((r) => (
              <li key={r.productId}>
                <button className="row row--btn statrow" data-testid={`stat-${r.name}`} aria-label={`${r.name} : ${purchasesLine(r.purchases, r.units)}. Voir l'historique`} onClick={() => setOpenRow(r)}>
                  <Thumb photoUrl={r.photoUrl} category={r.category} />
                  <span className="row__name">
                    <b>{r.name}</b>
                    <span className="statrow__line" data-testid={`freq-${r.name}`}>{purchasesLine(r.purchases, r.units)}</span>
                    <span className="statbar" aria-hidden="true"><i data-testid={`statbar-${r.name}`} style={{ width: `${Math.max(4, Math.round((r.purchases / max) * 100))}%` }} /></span>
                    <small data-testid={`last-${r.name}`}>{lastPurchaseText(r.lastPurchaseAt)}{r.brand ? ` · ${r.brand}` : ""}{r.active ? "" : " · désactivé"}</small>
                    {data.comparison.available && r.compare && (
                      <small className="statrow__cmp" data-testid={`cmp-${r.name}`}>Même période avant : {r.compare.purchases} achat{r.compare.purchases > 1 ? "s" : ""} · {unitsText(r.compare.units)}</small>
                    )}
                  </span>
                  <Icon name="chevron-right" className="chev" />
                </button>
              </li>
            ))}
          </ul>

          {picking && <MonthPicker current={data.currentMonth} selected={period === "month" ? data.month : null} withData={data.months} onPick={(m) => { pick("month", m); setPicking(false); }} onClose={() => setPicking(false)} />}
          {openRow && <ProductStatsSheet row={openRow} period={period} month={data.month} onOpenList={onOpenList} onClose={() => setOpenRow(null)} />}
          {filters && (
            <Dialog title="Filtres" onClose={() => setFilters(false)}>
              <div className="filtersec">
                <span>Période</span>
                <div className="seg" role="tablist" aria-label="Période">
                  <button role="tab" aria-selected={chip === "current"} className={chip === "current" ? "on" : ""} data-testid="period-current" onClick={() => pick("month", current)}>Ce mois</button>
                  <button role="tab" aria-selected={chip === "previous"} className={chip === "previous" ? "on" : ""} data-testid="period-previous" disabled={!current} onClick={() => current && pick("month", shiftMonth(current, -1))}>Mois précédent</button>
                  <button role="tab" aria-selected={chip === "last3"} className={chip === "last3" ? "on" : ""} data-testid="period-last3" onClick={() => pick("last3")}>3 derniers mois</button>
                </div>
                <small className="muted">Pour un autre mois ou une autre année, touchez le mois en haut de l'écran.</small>
              </div>
              <label className="field">Catégorie
                <select value={category} onChange={(e) => setCategory(e.target.value)} data-testid="stats-category">
                  <option value="">Toutes les catégories</option>
                  {data.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  {category && !data.categories.some((c) => c.key === category) && <option value={category}>Catégorie choisie</option>}
                </select>
              </label>
              <label className="field">Trier par
                <select value={sort} onChange={(e) => setSort(e.target.value as StatsSort)} data-testid="stats-sort">
                  <option value="frequency">Fréquence d'achat</option>
                  <option value="last">Dernier achat</option>
                  <option value="name">Nom</option>
                </select>
              </label>
              <button className="btn btn--primary btn--big" data-testid="filters-done" onClick={() => setFilters(false)}>Afficher les résultats</button>
              <button className="btn" data-testid="filters-reset" onClick={reset}>Réinitialiser les filtres</button>
            </Dialog>
          )}
          {help && (
            <Dialog title="Comment sont comptés les achats ?" onClose={() => setHelp(false)}>
              <p data-testid="legend-bars">Les barres comparent le nombre d'achats de chaque produit sur la période. Ce qui est compté est ce qui a été acheté, pas ce qui a été consommé.</p>
              <p><strong>Un achat</strong> = une ligne de la liste marquée « Acheté » (un produit acheté une fois). Ce n'est pas un nombre de passages en magasin : trois produits achetés au même passage font trois achats.</p>
              <p>La <strong>quantité</strong> additionne ce qui a été acheté, séparément pour chaque unité : les kilos ne sont jamais ajoutés aux briques ni aux pièces. Les achats corrigés ne comptent pas.</p>
              <p>Les achats anciens, faits avant que les quantités existent, sont comptés mais leur quantité reste « non enregistrée ».</p>
              <p data-testid="stats-no-spending">Ces statistiques comptent des achats, pas des montants. Les prix de l'application sont indicatifs : ils ne sont jamais une dépense réellement payée.</p>
              {data.comparison.available === false && <p data-testid="stats-no-compare">Pas de comparaison : l'historique ne couvre pas encore la période équivalente précédente.</p>}
              <p>L'absence d'achat enregistré ne prouve pas qu'un produit est nouveau, et un achat n'est pas une consommation réelle.</p>
              <button className="btn btn--ghost" onClick={() => setHelp(false)}>Fermer</button>
            </Dialog>
          )}
        </>
      )}
    </>
  );
}
