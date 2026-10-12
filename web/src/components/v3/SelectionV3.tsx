import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { CATEGORY_EMOJI } from "../../categories";
import { fmtQty } from "../../units";
import { setV3On } from "../../v3";
import { Icon } from "../Icon";
import { PriceTag } from "../PriceTag";
import type { CardState } from "../ProductCard";
import type { Engine, State, V3Mode } from "../../sync/engine";
import { effectiveQty } from "../../sync/logic";
import type { Price, Unit } from "../../types";
import { QuantitySheet, type SheetProduct } from "./QuantitySheet";

export interface V3Section {
  key: string;
  label: string;
  products: SheetProduct[];
}

const MODES: { key: V3Mode; label: string }[] = [
  { key: "list", label: "Liste" },
  { key: "squares", label: "Carrés" },
  { key: "cards", label: "Grandes cartes" },
];

interface TileProps {
  p: SheetProduct;
  mode: V3Mode;
  state: CardState;
  qty?: number;
  price?: ReactNode;
  emoji?: string;
  readOnly: boolean;
  onOpen(id: string): void;
}

/** Une carte d'article (les trois présentations partagent le même contenu : photo, nom, prix indicatif unitaire, action). */
const Tile = memo(function Tile({ p, mode, state, qty, price, emoji, readOnly, onOpen }: TileProps) {
  const [broken, setBroken] = useState(false);
  const selected = state === "saved" || state === "unsaved";
  const action =
    state === "bought" ? <span className="v3tile__mark v3tile__mark--bought" aria-hidden="true">🔒</span>
    : selected ? <span className={`v3tile__mark v3tile__mark--${state}`} aria-hidden="true">✓</span>
    : state === "removing" ? <span className="v3tile__mark v3tile__mark--removing" aria-hidden="true">✕</span>
    : <span className="v3tile__mark v3tile__mark--add" aria-hidden="true">+</span>;
  const status =
    state === "bought" ? "acheté" : state === "saved" ? "à acheter" : state === "unsaved" ? "à valider" : state === "removing" ? "à retirer" : "";
  return (
    <button
      type="button"
      className={`v3tile v3tile--${mode} v3tile--${state}`}
      data-testid={`v3-${p.id}`}
      data-state={state}
      aria-disabled={readOnly || undefined}
      aria-label={`${p.name}${status ? `, ${status}` : ""}${qty !== undefined && selected ? `, ${fmtQty(qty, p.unit as Unit)}` : ""}`}
      onClick={() => onOpen(p.id)}
    >
      <span className="v3tile__photo">
        {p.photoUrl && !broken ? <img src={p.photoUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} /> : <span className="v3tile__noimg" aria-hidden="true">{emoji ?? p.name.slice(0, 1)}</span>}
      </span>
      <span className="v3tile__body">
        <span className="v3tile__name" title={p.name}>{p.name}</span>
        {p.brand && <small>{p.brand}</small>}
        {p.inactive && <small>désactivé</small>}
        {selected && qty !== undefined && <span className="v3tile__qty" data-testid={`v3qty-${p.id}`}>{fmtQty(qty, p.unit as Unit)}{state === "unsaved" ? " · à valider" : ""}</span>}
        {state === "bought" && <span className="v3tile__qty v3tile__qty--bought">Acheté</span>}
        {price}
      </span>
      {action}
    </button>
  );
});

interface Props {
  engine: Engine;
  s: State;
  groups: V3Section[];
  searching: boolean;
  query: string;
  setQuery(q: string): void;
  stateOf(productId: string): CardState;
  priceOf(productId: string): Price | null;
  boughtOf(productId: string): { qty: number; unit: Unit } | undefined;
  registerRef(key: string, el: HTMLElement | null): void;
  noList: boolean;
}

/**
 * V3 · choix des articles. Trois affichages (liste visuelle, carrés à deux colonnes, grandes cartes), changement immédiat et mémorisé
 * par utilisateur ; au toucher d'un article, un panneau inférieur règle la quantité. Le choix en cours, les droits et la synchronisation
 * sont ceux de la V2 : seul l'écran change (engine.toggle / setQuantity / requestAgain).
 */
export function SelectionV3({ engine, s, groups, searching, query, setQuery, stateOf, priceOf, boughtOf, registerRef, noList }: Props) {
  const mode = s.v3Mode;
  const prefs = s.me?.prefs ?? { showPrices: false, showTotals: false, rev: 0 };
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (t: string) => {
    setToast(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  };
  const all = groups.flatMap((g) => g.products.map((p) => ({ p, key: g.key })));
  const open = openId ? all.find((x) => x.p.id === openId) : undefined;
  const qtyOf = (id: string) => effectiveQty(s.list, s.batches, s.toggles, id);
  const priceNote = (id: string) => (prefs.showPrices ? <PriceTag price={priceOf(id)} unit={(all.find((x) => x.p.id === id)?.p.unit ?? "piece") as Unit} prefs={{ ...prefs, showTotals: false }} testid={`v3price-${id}`} /> : null);
  const onOpen = (id: string) => {
    if (noList) return; // sans liste en cours, les produits restent seulement affichés (comme en V2)
    setOpenId(id);
  };
  const close = () => setOpenId(null);

  const confirm = async (qty: number) => {
    if (!open) return;
    const { p } = open;
    const st = stateOf(p.id);
    close();
    if (st !== "saved" && st !== "unsaved") await engine.toggle(p.id);
    const cur = effectiveQty(engine.getState().list, engine.getState().batches, engine.getState().toggles, p.id);
    if (cur !== undefined && cur !== qty) await engine.setQuantity(p.id, qty, true); // exacte : 125 g = 0,125 kg
    say(st === "saved" || st === "unsaved" ? `Quantité de ${p.name} mise à jour` : `${p.name} ajouté à la sélection`);
  };

  return (
    <div className="v3" data-testid="v3-selection">
      <div className="v3bar">
        <div className="seg v3modes" role="tablist" aria-label="Affichage des articles">
          {MODES.map((m) => (
            <button key={m.key} role="tab" aria-selected={mode === m.key} className={mode === m.key ? "on" : ""} data-testid={`v3-mode-${m.key}`} onClick={() => void engine.setV3Mode(m.key)}>{m.label}</button>
          ))}
        </div>
        <label className="searchbox">
          <Icon name="search" size={20} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un article…" aria-label="Chercher un produit dans toutes les catégories" data-testid="catalog-search" />
        </label>
      </div>
      {toast && <p className="v3toast" role="status" data-testid="v3-toast"><Icon name="check" size={18} /> {toast}</p>}
      {searching && all.length === 0 && <p className="empty" data-testid="search-empty">Aucun produit « {query.trim()} ».</p>}
      {groups.map((g) => (
        <section key={g.key} ref={(el) => registerRef(g.key, el)} className="category v3cat" aria-labelledby={`v3cat-${g.key}`} data-testid={searching ? "search-results" : undefined}>
          <h2 id={`v3cat-${g.key}`} className="v3cat__title"><span aria-hidden="true">{CATEGORY_EMOJI[g.key]} </span>{g.label}</h2>
          <div className={`v3grid v3grid--${mode}`}>
            {g.products.map((p) => (
              <Tile key={p.id} p={p} mode={mode} state={stateOf(p.id)} qty={qtyOf(p.id)} price={priceNote(p.id)} emoji={CATEGORY_EMOJI[g.key]} readOnly={noList} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
      <button className="linkbtn linkbtn--inline v3back" data-testid="v3-to-v2" onClick={() => setV3On(false)}>Version d'essai V3 · revenir à la V2</button>
      {open && (
        <QuantitySheet
          key={open.p.id}
          product={open.p}
          state={stateOf(open.p.id)}
          qty={qtyOf(open.p.id)}
          bought={boughtOf(open.p.id)}
          price={priceOf(open.p.id)}
          prefs={prefs}
          emoji={CATEGORY_EMOJI[open.key]}
          onClose={close}
          onConfirm={(q) => void confirm(q)}
          onRemove={() => { const p = open.p; close(); void engine.toggle(p.id).then(() => say(`${p.name} retiré de la sélection`)); }}
          onAgain={() => { const p = open.p; close(); void engine.requestAgain(p.id).then(() => say(`Nouvelle demande de ${p.name}`)); }}
        />
      )}
    </div>
  );
}
