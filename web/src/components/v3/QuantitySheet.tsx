import { useEffect, useState } from "react";
import { Dialog } from "../Dialog";
import { PriceTag } from "../PriceTag";
import { clampQty, isFractional, stepQty, unitLabel, unitPlural } from "../../units";
import { fmtQty } from "../../units";
import type { CardState } from "../ProductCard";
import type { Prefs, Price, Unit } from "../../types";

export interface SheetProduct {
  id: string;
  name: string;
  brand: string | null;
  photoUrl: string | null;
  unit: Unit;
  inactive: boolean;
}

interface Props {
  product: SheetProduct;
  state: CardState;
  /** Quantité actuellement choisie (article déjà sélectionné). */
  qty?: number;
  bought?: { qty: number; unit: Unit };
  price: Price | null;
  prefs: Prefs;
  emoji?: string;
  onClose(): void;
  /** Ajoute l'article avec cette quantité (ou met à jour la quantité d'un article déjà choisi). */
  onConfirm(qty: number): void;
  onRemove(): void;
  onAgain(): void;
}

/**
 * V3 : panneau inférieur de quantité. La quantité se règle ici (−, +, ou saisie directe) puis « Ajouter à la liste » l'enregistre dans
 * le choix en cours (comme la carte de la V2 : rien n'est envoyé avant « Valider »). L'unité est celle du produit. Le prix est le prix
 * indicatif UNITAIRE, jamais un total par article.
 */
export function QuantitySheet({ product, state, qty, bought, price, prefs, emoji, onClose, onConfirm, onRemove, onAgain }: Props) {
  const selected = state === "saved" || state === "unsaved";
  const unit = product.unit;
  const [draft, setDraft] = useState(qty ?? 1);
  const [text, setText] = useState(String(qty ?? 1).replace(".", ","));
  const [broken, setBroken] = useState(false);
  const fine = prefs.showTotals;
  const set = (q: number) => {
    setDraft(q);
    setText(String(q).replace(".", ","));
  };
  useEffect(() => setText(String(draft).replace(".", ",")), [draft]);
  const minus = stepQty(draft, unit, -1, fine);
  const plus = stepQty(draft, unit, 1, fine);
  const commit = () => {
    const n = Number(text.replace(",", ".").trim());
    if (!text.trim() || !Number.isFinite(n)) return setText(String(draft).replace(".", ","));
    set(clampQty(n, unit));
  };
  const noteUnit = unit === "kg" ? "kilogrammes" : unitPlural(unit);
  const label = (draft > 1 && unit !== "kg") || (unit === "litre" && draft >= 2) ? unitPlural(unit) : unitLabel(unit);
  return (
    <Dialog title={product.name} onClose={onClose}>
      <div className="v3sheet" data-testid="qty-sheet">
        <div className="v3sheet__head">
          <span className="v3sheet__photo">
            {product.photoUrl && !broken ? <img src={product.photoUrl} alt="" decoding="async" onError={() => setBroken(true)} /> : <span aria-hidden="true">{emoji ?? product.name.slice(0, 1)}</span>}
          </span>
          <span className="v3sheet__id">
            {product.brand && <small>{product.brand}</small>}
            {product.inactive && <small>désactivé</small>}
            {prefs.showPrices && price && <span className="v3sheet__price" data-testid="sheet-price">Prix indicatif : <PriceTag price={price} unit={unit} prefs={{ ...prefs, showTotals: false }} testid="sheet-price-tag" /></span>}
          </span>
        </div>
        {state === "bought" ? (
          <>
            <p className="v3sheet__bought" data-testid="sheet-bought">Déjà acheté{bought ? ` : ${fmtQty(bought.qty, bought.unit)}` : ""}. Une nouvelle demande ajoute l'article à acheter encore.</p>
            <button className="btn btn--primary btn--big" data-testid="sheet-again" onClick={onAgain}>Nouvelle demande</button>
          </>
        ) : (
          <>
            <div className="v3qty" role="group" aria-label={`Quantité de ${product.name}`}>
              <span className="v3qty__label">Quantité</span>
              <div className="v3qty__row">
                <button type="button" className="v3qty__btn" aria-label={`Diminuer la quantité de ${product.name}`} disabled={minus === null} data-testid="sheet-minus" onClick={() => minus !== null && set(minus)}>−</button>
                <span className="v3qty__val">
                  <input
                    inputMode={isFractional(unit) ? "decimal" : "numeric"}
                    aria-label={`Quantité de ${product.name}, en ${noteUnit}`}
                    data-testid="sheet-input"
                    value={text}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setText(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())}
                  />
                  <small data-testid="sheet-unit">{label}</small>
                </span>
                <button type="button" className="v3qty__btn" aria-label={`Augmenter la quantité de ${product.name}`} disabled={plus === null} data-testid="sheet-plus" onClick={() => plus !== null && set(plus)}>+</button>
              </div>
            </div>
            <button
              className="btn btn--primary btn--big"
              data-testid="sheet-confirm"
              disabled={selected && draft === qty}
              onClick={() => {
                const n = Number(text.replace(",", ".").trim());
                onConfirm(Number.isFinite(n) && text.trim() ? clampQty(n, unit) : draft); // une saisie encore non validée est prise en compte
              }}
            >
              {selected ? "Mettre à jour la quantité" : "Ajouter à la liste"}
            </button>
            {selected && <button className="btn btn--ghost" data-testid="sheet-remove" onClick={onRemove}>Retirer de la sélection</button>}
          </>
        )}
      </div>
    </Dialog>
  );
}
