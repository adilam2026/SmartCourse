import { memo, useState } from "react";
import type { Unit } from "../types";
import { fmtQty } from "../units";
import { QtyCounter } from "./QtyCounter";

export type CardState = "off" | "saved" | "unsaved" | "removing" | "bought";

interface Props {
  productId: string;
  name: string;
  brand: string | null;
  photoUrl: string | null;
  state: CardState;
  unit: Unit;
  /** Quantity shown under a selected card. */
  qty?: number;
  /** Quantity and unit of the bought line (locked card). */
  boughtQty?: { qty: number; unit: Unit };
  /** The selection is an explicit new request for something already bought. */
  again?: boolean;
  inactive?: boolean;
  emoji?: string;
  onTap(productId: string): void;
  onQty?(productId: string, qty: number): void;
  onAgain?(productId: string): void;
}

const LABEL: Record<CardState, string> = {
  off: "",
  saved: ", dans la liste",
  unsaved: ", dans la liste, pas encore enregistré",
  removing: ", sera retiré, pas encore enregistré",
  bought: ", déjà acheté, verrouillé",
};

export const ProductCard = memo(function ProductCard({ productId, name, brand, photoUrl, state, unit, qty, boughtQty, again, inactive, emoji, onTap, onQty, onAgain }: Props) {
  const [broken, setBroken] = useState(false);
  const showPhoto = photoUrl && !broken;
  const selected = state === "saved" || state === "unsaved";
  return (
    <div className={`cardwrap cardwrap--${state}`} data-testid={`wrap-${productId}`}>
      <button
        type="button"
        className={`card card--${state}`}
        aria-pressed={state !== "off" && state !== "removing"}
        aria-label={`${name}${LABEL[state]}${again ? ", nouvelle demande" : ""}${qty !== undefined && selected ? `, ${fmtQty(qty, unit)}` : ""}`}
        data-testid={`card-${productId}`}
        data-state={state}
        onClick={() => onTap(productId)}
      >
        <span className="card__photo">
          {showPhoto ? (
            <img src={photoUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
          ) : (
            // No photo yet: a neutral tile with the name, never a stand-in picture.
            <span className="card__noimg" aria-hidden="true">{emoji ?? name.slice(0, 1)}</span>
          )}
          {state === "bought" ? (
            <span className="badge badge--bought" aria-hidden="true">🔒 Acheté{boughtQty ? ` · ${fmtQty(boughtQty.qty, boughtQty.unit)}` : ""}</span>
          ) : state === "saved" ? (
            <span className="badge badge--saved" aria-hidden="true">✓</span>
          ) : state === "unsaved" ? (
            <span className="badge badge--unsaved" aria-hidden="true">✓</span>
          ) : state === "removing" ? (
            <span className="badge badge--removing" aria-hidden="true">✕</span>
          ) : (
            <span className="badge badge--off" aria-hidden="true" />
          )}
        </span>
        <span className="card__name">
          {name}
          {brand ? <small>{brand}</small> : null}
          {inactive ? <small>désactivé</small> : null}
          {again ? <small className="card__again">Nouvelle demande</small> : null}
        </span>
      </button>
      {selected && qty !== undefined && onQty && <QtyCounter productId={productId} name={name} unit={unit} qty={qty} onChange={onQty} />}
      {state === "bought" && onAgain && (
        <button type="button" className="btn btn--small again" data-testid={`again-${productId}`} onClick={() => onAgain(productId)}>
          Nouvelle demande
        </button>
      )}
    </div>
  );
});
