import { memo, useState } from "react";

export type CardState = "off" | "saved" | "unsaved" | "removing" | "bought";

interface Props {
  productId: string;
  name: string;
  brand: string | null;
  photoUrl: string | null;
  state: CardState;
  inactive?: boolean;
  emoji?: string;
  onTap(productId: string): void;
}

const LABEL: Record<CardState, string> = {
  off: "",
  saved: ", dans la liste",
  unsaved: ", dans la liste, pas encore enregistré",
  removing: ", sera retiré, pas encore enregistré",
  bought: ", déjà acheté, verrouillé",
};

export const ProductCard = memo(function ProductCard({ productId, name, brand, photoUrl, state, inactive, emoji, onTap }: Props) {
  const [broken, setBroken] = useState(false);
  const showPhoto = photoUrl && !broken;
  return (
    <button
      type="button"
      className={`card card--${state}`}
      aria-pressed={state !== "off" && state !== "removing"}
      aria-label={`${name}${LABEL[state]}`}
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
          <span className="badge badge--bought" aria-hidden="true">🔒 Acheté</span>
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
        {inactive ? <small>plus proposé</small> : null}
      </span>
    </button>
  );
});
