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
 * [−] 1 [+] under a selected card. The buttons live OUTSIDE the card's own button, so a tap on them can never select or
 * unselect the card. [−] is disabled at the minimum (1, or 100 g): removing the article is done by unselecting the card.
 * Kilograms accept decimals: step 0.5, and the value can be typed ("1,25").
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
      <span className="qty__val">
        {unit === "kg" ? (
          <input
            className="qty__input"
            inputMode="decimal"
            aria-label={`Quantité en kilogrammes de ${name}`}
            data-testid={`qty-input-${productId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())}
          />
        ) : (
          <b data-testid={`qty-value-${productId}`}>{shown}</b>
        )}
        <small>{qty > 1 && unit !== "kg" ? unitPlural(unit) : unitLabel(unit)}</small>
      </span>
      <button type="button" className="qty__btn" aria-label={`Augmenter la quantité de ${name}`} disabled={plus === null} data-testid={`plus-${productId}`} onClick={() => plus !== null && onChange(productId, plus)}>+</button>
    </div>
  );
}

