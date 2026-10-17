import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Dialog } from "../components/Dialog";
import { PriceDialog } from "../components/PriceDialog";
import { SyncPrices } from "../components/SyncPrices";
import { Thumb } from "../components/Thumb";
import { CATEGORY_EMOJI } from "../categories";
import { userMessage } from "../errors";
import { fmtPrice, isComputable } from "../pricing";
import { priceNature } from "../priceNature";
import { unitLabel } from "../units";
import type { Engine, State } from "../sync/engine";
import type { Catalog, Product } from "../types";

const flat = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/œ/g, "oe").trim();

/**
 * Gestion des prix (administrateurs) : tous les articles affichés avec leur prix et sa référence d'unité, recherche, catégories,
 * modification rapide (la petite fenêtre « Prix », qui garde le format de référence et les règles de compatibilité), prix manquants
 * signalés (jamais remplacés par zéro) et synchronisation des prix de la ville. Cet écran est un outil de gestion : il montre les prix
 * même si le profil n'a pas activé leur affichage dans les listes. Un prix modifié ne touche jamais les listes archivées.
 */
export function PricesAdmin({ engine, s }: { engine: Engine; s: State }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [catKey, setCatKey] = useState("");
  const [todo, setTodo] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [sync, setSync] = useState(false);
  const load = () => api.catalogAdmin().then((c) => { setCat(c); setError(null); }).catch((e) => setError(userMessage(e)));
  useEffect(() => void load(), []);

  const shown = useMemo(() => (cat?.categories ?? []).map((c) => ({ ...c, products: c.products.filter((p) => p.active) })).filter((c) => c.products.length > 0), [cat]);
  const needs = (p: Product) => !p.price || !isComputable(p.price, 1, p.unit);
  const all = shown.flatMap((c) => c.products);
  const nTodo = all.filter(needs).length;
  const needle = flat(q);
  const rows = shown
    .filter((c) => !catKey || c.key === catKey)
    .map((c) => ({ ...c, products: c.products.filter((p) => (!needle || flat(p.name).includes(needle)) && (!todo || needs(p))) }))
    .filter((c) => c.products.length > 0);
  const nRows = rows.reduce((n, c) => n + c.products.length, 0);
  const editingProduct = editing ? all.find((p) => p.id === editing) : undefined;
  const changed = () => void Promise.all([load(), engine.refresh()]);

  return (
    <div className="pricesadmin" data-testid="prices-admin">
      {error && <p className="error" role="alert" data-testid="pa-error">{error}</p>}
      <div className="catbar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un article" aria-label="Chercher un article dans les prix" data-testid="pa-search" />
        <button className="btn btn--small" data-testid="pa-sync" onClick={() => setSync(true)}>Synchroniser</button>
      </div>
      <div className="pafilters">
        <select value={catKey} onChange={(e) => setCatKey(e.target.value)} aria-label="Catégorie" data-testid="pa-cat">
          <option value="">Toutes les catégories ({all.length})</option>
          {shown.map((c) => <option key={c.key} value={c.key}>{CATEGORY_EMOJI[c.key]} {c.label} ({c.products.length})</option>)}
        </select>
        <button className={`catchip catchip--todo ${todo ? "on" : ""}`} aria-pressed={todo} data-testid="pa-todo" onClick={() => setTodo((v) => !v)}>
          À compléter ({nTodo})
        </button>
      </div>
      {cat && nRows === 0 && <p className="empty" data-testid="pa-empty">{todo && !q && !catKey ? "Tous les prix sont renseignés." : "Aucun article ne correspond."}</p>}
      {rows.map((c) => (
        <section key={c.key} aria-label={c.label}>
          <h2 className="sect">{CATEGORY_EMOJI[c.key]} {c.label}</h2>
          <ul className="rows">
            {c.products.map((p) => {
              const nature = priceNature(p.price);
              const missing = !p.price;
              const incomplete = !!p.price && !isComputable(p.price, 1, p.unit);
              return (
                <li key={p.id} className="row row--line pricerow" data-testid={`pa-row-${p.name}`} data-price={missing ? "missing" : incomplete ? "incomplete" : "ok"}>
                  <Thumb photoUrl={p.photoUrl} category={c.key} />
                  <span className="row__name">{p.name}<small>{unitLabel(p.unit)}</small></span>
                  <button
                    type="button"
                    className={`pricepill ${missing ? "pricepill--missing" : incomplete ? "pricepill--incomplete" : ""}`}
                    data-testid={`pa-price-${p.name}`}
                    aria-label={missing ? `${p.name} : prix manquant. Ajouter un prix` : `${p.name} : ${fmtPrice(p.price!)}. Modifier le prix`}
                    onClick={() => setEditing(p.id)}
                  >
                    {missing ? <span>Prix manquant</span> : <span data-testid={`pa-amount-${p.name}`}>{fmtPrice(p.price!)}</span>}
                    {incomplete && <small>Unité à préciser</small>}
                    {nature?.chip && <span className={`naturechip naturechip--${nature.chip === "observé" ? "obs" : "est"}`}>{nature.chip}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {editingProduct && <PriceDialog key={editingProduct.id} product={editingProduct} onClose={() => setEditing(null)} onChanged={changed} />}
      {sync && (
        <Dialog title="Synchroniser les prix" onClose={() => { setSync(false); changed(); }}>
          <SyncPrices engine={engine} s={s} />
          <button className="btn btn--ghost" data-testid="pa-sync-close" onClick={() => { setSync(false); changed(); }}>Fermer</button>
        </Dialog>
      )}
    </div>
  );
}
