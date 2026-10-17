import { useEffect, useState } from "react";
import { Dialog } from "../Dialog";
import { PriceTag } from "../PriceTag";
import { priceNature } from "../../priceNature";
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
  /** Ajoute l'article avec cette quantité, exprimée dans l'unité DU PRODUIT (ou met à jour un article déjà choisi). */
  onConfirm(qty: number): void;
  onRemove(): void;
  onAgain(): void;
}

/**
 * V3 : panneau inférieur de quantité. La quantité se règle ici (−, +, ou saisie directe) puis « Ajouter à la liste » l'enregistre dans
 * le choix en cours (comme la carte de la V2 : rien n'est envoyé avant « Valider »). L'unité est celle du produit. Le prix est le prix
 * indicatif UNITAIRE, jamais un total par article.
 */
/** Petite unité de saisie d'un produit au poids (g) ou au volume (ml) ; aucune pour les unités comptées. */
const SMALL: Partial<Record<Unit, { label: string; plural: string }>> = { kg: { label: "g", plural: "grammes" }, litre: { label: "ml", plural: "millilitres" } };
const BASE_CHIP: Partial<Record<Unit, string>> = { kg: "kg", litre: "L" };

/**
 * V3 : panneau inférieur de quantité. La quantité se règle ici (−, +, ou saisie directe) puis « Ajouter à la liste » l'enregistre dans
 * le choix en cours (comme la carte de la V2 : rien n'est envoyé avant « Valider »). L'unité est celle du produit ; pour un produit au
 * poids on peut saisir en g (kg ↔ g, ×1000) et pour un volume en ml (L ↔ ml) : la conversion est exacte et la quantité reste stockée
 * dans l'unité du produit (0,25 kg), donc identique pour la V2. Jamais « pièce » pour un produit au kilo. Le prix est le prix indicatif
 * UNITAIRE, jamais un total par article.
 */
export function QuantitySheet({ product, state, qty, bought, price, prefs, emoji, onClose, onConfirm, onRemove, onAgain }: Props) {
  const selected = state === "saved" || state === "unsaved";
  const unit = product.unit;
  const small = SMALL[unit];
  const [draft, setDraft] = useState(qty ?? 1); // toujours dans l'unité du produit
  const [inSmall, setInSmall] = useState(false); // saisie en g / ml
  const shownOf = (d: number, sm: boolean) => (sm ? String(Math.round(d * 1000)) : String(d).replace(".", ","));
  const [text, setText] = useState(shownOf(qty ?? 1, false));
  const [problem, setProblem] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const fine = prefs.showTotals;
  const set = (q: number, sm = inSmall) => {
    setDraft(q);
    setText(shownOf(q, sm));
    setProblem(null);
  };
  const MIN_SMALL = 10; // g ou ml
  const smallStep = fine ? 50 : 100;
  const milli = Math.round(draft * 1000);
  const minus = inSmall ? (milli - smallStep >= MIN_SMALL ? (milli - smallStep) / 1000 : null) : stepQty(draft, unit, -1, fine);
  const plus = inSmall ? (milli + smallStep <= 999000 ? (milli + smallStep) / 1000 : null) : stepQty(draft, unit, 1, fine);
  const commit = (): number | null => {
    const raw = text.trim();
    const n = Number(raw.replace(",", "."));
    if (!raw || !Number.isFinite(n)) {
      setText(shownOf(draft, inSmall));
      setProblem(null);
      return draft; // saisie illisible : retour à la valeur en cours
    }
    if (inSmall) {
      if (!Number.isInteger(n) || n < MIN_SMALL || n > 999000) {
        setProblem(`Entrez un nombre entier de ${small!.plural}, au moins ${MIN_SMALL}.`);
        return null;
      }
      set(n / 1000);
      return n / 1000;
    }
    const q = clampQty(n, unit);
    set(q);
    return q;
  };
  const chooseSmall = (sm: boolean) => {
    if (sm === inSmall) return;
    const v = commit();
    if (v === null) return; // une saisie invalide empêche de changer d'unité : rien n'est converti à tort
    setInSmall(sm);
    setText(shownOf(v, sm));
    setProblem(null);
  };
  const shownUnit = inSmall ? small!.label : (draft > 1 && unit !== "kg") || (unit === "litre" && draft >= 2) ? unitPlural(unit) : unitLabel(unit);
  const noteUnit = inSmall ? small!.plural : unit === "kg" ? "kilogrammes" : unitPlural(unit);
  return (
    <Dialog title={product.name} onClose={onClose}>
      <div className="v3sheet" data-testid="qty-sheet">
        <div className="v3sheet__head">
          <span className="v3sheet__photo">
            {product.photoUrl && !broken ? <img src={product.photoUrl} alt="" decoding="async" onError={() => setBroken(true)} /> : <span aria-hidden="true">{emoji ?? product.name.slice(0, 1)}</span>}
          </span>
          <span className="v3sheet__id">
            {product.brand && <small>{product.brand}</small>}
            {product.inactive && <small>masqué</small>}
            {prefs.showPrices && price && <span className="v3sheet__price" data-testid="sheet-price">Prix indicatif : <PriceTag price={price} unit={unit} prefs={{ ...prefs, showTotals: false }} testid="sheet-price-tag" />{(() => { const n = priceNature(price); return n?.chip ? <span className={`naturechip naturechip--${n.chip === "observé" ? "obs" : "est"}`} title={n.detail} data-testid="sheet-nature">{n.chip}</span> : null; })()}</span>}
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
                    inputMode={inSmall ? "numeric" : isFractional(unit) ? "decimal" : "numeric"}
                    aria-label={`Quantité de ${product.name}, en ${noteUnit}`}
                    aria-invalid={problem ? true : undefined}
                    data-testid="sheet-input"
                    value={text}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => { setText(e.target.value); setProblem(null); }}
                    onBlur={() => void commit()}
                    onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())}
                  />
                  <small data-testid="sheet-unit">{shownUnit}</small>
                </span>
                <button type="button" className="v3qty__btn" aria-label={`Augmenter la quantité de ${product.name}`} disabled={plus === null} data-testid="sheet-plus" onClick={() => plus !== null && set(plus)}>+</button>
              </div>
              {problem && <small className="error" role="alert" data-testid="sheet-problem">{problem}</small>}
            </div>
            {small && (
              <div className="v3units" role="group" aria-label="Unité de saisie">
                <span className="v3qty__label">Unité</span>
                <div className="seg v3units__seg">
                  <button type="button" className={!inSmall ? "on" : ""} aria-pressed={!inSmall} data-testid="sheet-unit-base" onClick={() => chooseSmall(false)}>{BASE_CHIP[unit]}</button>
                  <button type="button" className={inSmall ? "on" : ""} aria-pressed={inSmall} data-testid="sheet-unit-small" onClick={() => chooseSmall(true)}>{small.label}</button>
                </div>
              </div>
            )}
            <button
              className="btn btn--primary btn--big"
              data-testid="sheet-confirm"
              disabled={!!problem || (selected && Math.round(draft * 1000) === Math.round((qty ?? 0) * 1000))}
              onClick={() => {
                const v = commit(); // une saisie encore non validée est prise en compte (ou refusée avec son message)
                if (v !== null) onConfirm(v);
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
