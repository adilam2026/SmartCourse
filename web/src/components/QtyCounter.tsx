import { useEffect, useState } from "react";
import type { Unit } from "../types";
import { clampQty, stepQty, unitLabel, unitPlural } from "../units";

interface Props {
  productId: string;
  name: string;
  unit: Unit;
  qty: number;
  onChange(productId: string, qty: number): void;
}

/**
 * [−] 1 [+] in its own zone at the bottom of a selected card, under the photo and the name (never over the photo), with the full
 * unit on a line of its own so it is never cut. The buttons live OUTSIDE the card's tap area, so a tap on them can never select or unselect the card.
 * [−] is disabled at the minimum (1, or 0,5 kg from 1 kg: 0,1 kg is the smallest value that can be typed): removing the article
 * is done by unselecting the card. The centre is an input for every unit: tap it to type a quantity ("1,25" for kilograms,
 * whole numbers for the other units).
 */
export function QtyCounter({ productId, name, unit, qty, onChange }: Props) {
  const minus = stepQty(qty, unit, -1);
  const plus = stepQty(qty, unit, 1);
  const shown = String(qty).replace(".", ",");
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const n = Number(text.replace(",", ".").trim());
    if (!text.trim() || !Number.isFinite(n)) return setText(shown); // unreadable: back to the value in use
    const q = clampQty(n, unit);
    setText(String(q).replace(".", ","));
    if (q !== qty) onChange(productId, q);
  };
  return (
    <div className="qty" role="group" aria-label={`Quantité de ${name}`} data-testid={`qty-${productId}`}>
      <button type="button" className="qty__btn" aria-label={`Diminuer la quantité de ${name}`} disabled={minus === null} data-testid={`minus-${productId}`} onClick={() => minus !== null && onChange(productId, minus)}>−</button>
      <input
        className="qty__input"
        inputMode={unit === "kg" ? "decimal" : "numeric"}
        aria-label={`Quantité de ${name}, en ${unit === "kg" ? "kilogrammes" : unitPlural(unit)}`}
        data-testid={`qty-input-${productId}`}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())}
      />
      <button type="button" className="qty__btn" aria-label={`Augmenter la quantité de ${name}`} disabled={plus === null} data-testid={`plus-${productId}`} onClick={() => plus !== null && onChange(productId, plus)}>+</button>
      <span className="qty__unit" data-testid={`qty-unit-${productId}`}>{qty > 1 && unit !== "kg" ? unitPlural(unit) : unitLabel(unit)}</span>
    </div>
  );
}
