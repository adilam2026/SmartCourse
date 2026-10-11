import { useState } from "react";
import { fmtMonthShort } from "../format";
import { Dialog } from "./Dialog";

/** Choose a month and a year directly. Months after the current one cannot be chosen; a dot marks months that have purchases. */
export function MonthPicker({ current, selected, withData, onPick, onClose }: { current: string; selected: string | null; withData: string[]; onPick(month: string): void; onClose(): void }) {
  const curYear = Number(current.slice(0, 4));
  const firstYear = Math.min(curYear, ...withData.map((m) => Number(m.slice(0, 4))));
  const [year, setYear] = useState(Number((selected ?? current).slice(0, 4)));
  return (
    <Dialog title="Choisir un mois" onClose={onClose}>
      <div className="monthnav">
        <button className="btn" aria-label="Année précédente" disabled={year <= firstYear} data-testid="picker-prev-year" onClick={() => setYear(year - 1)}>←</button>
        <strong data-testid="picker-year">{year}</strong>
        <button className="btn" aria-label="Année suivante" disabled={year >= curYear} data-testid="picker-next-year" onClick={() => setYear(year + 1)}>→</button>
      </div>
      <div className="monthgrid" role="group" aria-label={`Mois de ${year}`}>
        {Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).map((m) => (
          <button
            key={m}
            className={`monthgrid__m ${m === selected ? "on" : ""}`}
            disabled={m > current}
            aria-pressed={m === selected}
            aria-label={`${fmtMonthShort(m)} ${year}${withData.includes(m) ? ", avec achats" : ""}`}
            data-testid={`pick-${m}`}
            onClick={() => onPick(m)}
          >
            {fmtMonthShort(m)}
            {withData.includes(m) && <i aria-hidden="true" />}
          </button>
        ))}
      </div>
      <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
    </Dialog>
  );
}
