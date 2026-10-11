import { useEffect, useState } from "react";
import { api, ApiError, NetworkError, type ProductStats, type StatsPeriod, type StatsRow, type StatsUnitCell } from "../api";
import { fmtDayMonth, fmtDayRange, fmtMonthShort, fmtWhen } from "../format";
import { lastPurchaseText, unitsText } from "../stats";
import type { Unit } from "../types";
import { fmtQty, unitPlural, unitLabel } from "../units";
import { Dialog } from "./Dialog";
import { Thumb } from "./Thumb";

/**
 * Purchase history of one product: period totals per unit, every purchase (newest first, with who and when), corrected
 * purchases shown but never counted, and a small monthly chart per unit. Purchases are not consumption.
 */
export function ProductStatsSheet({ row, period, month, onOpenList, onClose }: { row: StatsRow; period: StatsPeriod; month: string; onOpenList?(listId: string, status: string): void; onClose(): void }) {
  const [data, setData] = useState<ProductStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .productStats(row.productId, { period, month })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof NetworkError ? "Historique indisponible hors connexion." : e instanceof ApiError && e.status === 403 ? "Réservé aux parents et administrateurs." : "Historique indisponible."));
    return () => {
      live = false;
    };
  }, [row.productId, period, month]);

  return (
    <Dialog title={row.name} onClose={onClose}>
      <div className="phead">
        <Thumb photoUrl={row.photoUrl} category={row.category} />
        <div>
          <strong className="phead__name">{row.name}</strong>
          <small className="muted">{[row.brand, row.categoryLabel].filter(Boolean).join(" · ")}</small>
        </div>
      </div>
      {error && <p className="empty" data-testid="pstats-error">{error}</p>}
      {!data && !error && <p className="empty">Chargement…</p>}
      {data && (
        <div data-testid="pstats">
          <p className="muted" data-testid="pstats-period">Période : {period === "last3" ? "3 derniers mois, " : ""}{fmtDayRange(data.window.fromDay, data.window.toDay)}</p>
          <section className="pstats__sum" aria-label="Résumé">
            <p data-testid="pstats-count"><strong>{data.summary.purchases} achat{data.summary.purchases > 1 ? "s" : ""}</strong> sur la période{data.summary.units.length === 1 && <> · <b data-testid="pstats-units">{unitsText(data.summary.units)}</b></>}</p>
            {data.summary.units.length === 0 && <p className="muted">Aucun achat confirmé sur cette période.</p>}
            {data.summary.units.length > 1 && (
              <ul className="pstats__units" data-testid="pstats-units">
                {data.summary.units.map((u) => (
                  <li key={u.unit ?? "inconnue"}>{u.purchases} achat{u.purchases > 1 ? "s" : ""} · <b>{unitsText([u])}</b></li>
                ))}
              </ul>
            )}
            <p className="muted" data-testid="pstats-last">{data.summary.lastPurchaseAt ? lastPurchaseText(data.summary.lastPurchaseAt) : "Aucun achat enregistré."}</p>
          </section>

          <Chart months={data.months} />

          <h3 className="pstats__h">Historique</h3>
          {data.purchases.length === 0 ? (
            <p className="empty">Rien à afficher sur cette période.</p>
          ) : (
            <ul className="timeline pstats__list" data-testid="pstats-history">
              {data.purchases.map((p) => (
                <li key={p.id} className={p.corrected ? "pstats__corrected" : ""} data-testid="pstats-purchase">
                  <span>
                    <b>{p.quantity !== null && p.unit ? fmtQty(p.quantity, p.unit) : "Quantité non enregistrée"}</b>
                    {p.corrected && <em> · achat corrigé, non compté</em>}
                  </span>
                  <small>{fmtWhen(p.at)} · acheté par {p.by.displayName}</small>
                  {p.corrected && <small>Corrigé par {p.corrected.by} · {fmtWhen(p.corrected.at)}{p.corrected.reason ? ` — « ${p.corrected.reason} »` : ""}</small>}
                  {onOpenList && (
                    <button className="linkbtn linkbtn--inline" data-testid="pstats-open-list" onClick={() => onOpenList(p.list.id, p.list.status)}>
                      {p.list.status === "active" ? "Voir la liste en cours" : `Voir la liste du ${fmtDayMonth(p.list.closedAt ?? p.list.createdAt)}`}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="muted"><small>Ce sont des achats enregistrés, pas une mesure de la consommation réelle.</small></p>
        </div>
      )}
      <button className="btn btn--ghost" data-testid="pstats-close" onClick={onClose}>Fermer</button>
    </Dialog>
  );
}

/** Quantity of one unit in one month: "known" when at least one purchase had a quantity. */
const cellOf = (units: StatsUnitCell[], unit: Unit | null): StatsUnitCell | undefined => units.find((u) => u.unit === unit);

/**
 * One small bar chart per unit (units are never drawn together). Months before the household's first list show « pas de données »;
 * a month with data tracking but no purchase shows an empty bar (zero), which is different.
 */
export function Chart({ months }: { months: ProductStats["months"] }) {
  const units: Unit[] = [];
  for (const m of months) for (const u of m.units) if (u.unit && !units.includes(u.unit)) units.push(u.unit);
  const hasPurchases = months.some((m) => m.units.length > 0);
  const unknownOnly = months.some((m) => cellOf(m.units, null));
  if (!hasPurchases) return <p className="muted" data-testid="pstats-nochart">Pas encore assez d'achats pour un graphique.</p>;
  if (units.length === 0) return <p className="muted" data-testid="pstats-nochart">Quantités non enregistrées sur ces mois : pas de graphique.</p>;
  return (
    <section aria-label="Quantités achetées par mois" data-testid="pstats-charts">
      <h3 className="pstats__h">Quantités achetées par mois</h3>
      {units.map((unit) => <UnitChart key={unit} unit={unit} months={months} />)}
      {unknownOnly && <p className="muted"><small>Certains achats anciens n'ont pas de quantité : ils ne sont pas dessinés.</small></p>}
    </section>
  );
}

function UnitChart({ unit, months }: { unit: Unit; months: ProductStats["months"] }) {
  const values = months.map((m) => cellOf(m.units, unit)?.quantity ?? 0);
  const max = Math.max(...values, 1);
  const W = 300;
  const H = 118;
  const top = 22;
  const base = 92;
  const step = W / months.length;
  const summary = months.map((m, i) => `${fmtMonthShort(m.month)} : ${!m.covered ? "pas de données" : values[i] ? fmtQty(values[i]!, unit) : "aucun achat"}`).join(" ; ");
  return (
    <figure className="chart" data-testid={`chart-${unit}`}>
      <figcaption>En {unit === "kg" ? "kilogrammes" : unitPlural(unit)}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${unitLabel(unit)} : ${summary}`}>
        <line x1="0" y1={base} x2={W} y2={base} className="chart__axis" />
        {months.map((m, i) => {
          const x = i * step + step * 0.18;
          const w = step * 0.64;
          const q = values[i]!;
          const h = q > 0 ? Math.max(3, ((base - top) * q) / max) : 0;
          return (
            <g key={m.month} data-testid={`bar-${m.month}`} data-state={!m.covered ? "nodata" : q > 0 ? "value" : "zero"}>
              {!m.covered ? (
                <rect x={x} y={base - 14} width={w} height={14} className="chart__nodata" />
              ) : q > 0 ? (
                <>
                  <rect x={x} y={base - h} width={w} height={h} rx="3" className="chart__bar" />
                  <text x={x + w / 2} y={base - h - 4} textAnchor="middle" className="chart__val">{String(q).replace(".", ",")}</text>
                </>
              ) : (
                <text x={x + w / 2} y={base - 4} textAnchor="middle" className="chart__zero">0</text>
              )}
              <text x={x + w / 2} y={base + 14} textAnchor="middle" className="chart__lbl">{fmtMonthShort(m.month)}</text>
              {!m.covered && <text x={x + w / 2} y={base + 26} textAnchor="middle" className="chart__lbl chart__lbl--small">—</text>}
            </g>
          );
        })}
      </svg>
      <p className="chart__legend muted"><small>0 = aucun achat ce mois-là · pointillé = pas de données (avant le début de l'historique)</small></p>
    </figure>
  );
}
