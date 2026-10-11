import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, NetworkError, type CatalogAllItem } from "../api";
import { CATEGORY_EMOJI } from "../categories";
import { Icon } from "../components/Icon";
import { unitLabel } from "../units";

const PAGE = 24;

/** A picture that is never someone else's: when the catalogue has none yet, say so plainly. */
export function CatPhoto({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  return url && !broken ? (
    <img className="catphoto" src={url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} data-testid={`photo-${name}`} />
  ) : (
    <span className="catphoto catphoto--todo" data-testid={`photo-todo-${name}`}><Icon name="image" size={22} /><small>Photo à venir</small></span>
  );
}

/** « Tous les produits » : the whole catalogue (starter + extended), opened at once, by category, loaded progressively. */
export function CatalogBrowser({ categories, onChanged }: { categories: { key: string; label: string }[]; onChanged(): unknown }) {
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CatalogAllItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const gen = useRef(0); // a slow answer for a previous filter must never overwrite a newer one

  const fetchPage = useCallback(async (offset: number, replace: boolean, term: string, cat: string | null) => {
    const my = ++gen.current;
    setBusy(true);
    try {
      const r = await api.catalogAll({ category: cat ?? undefined, q: term.trim() || undefined, offset, limit: PAGE });
      if (my !== gen.current) return;
      setItems((cur) => (replace ? r.items : [...cur, ...r.items.filter((n) => !cur.some((c) => c.origin === n.origin && c.key === n.key))]));
      setTotal(r.total);
      setError(null);
    } catch (e) {
      if (my === gen.current) setError(e instanceof NetworkError ? "Pas de connexion." : e instanceof ApiError ? e.message : "Erreur.");
    } finally {
      if (my === gen.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void fetchPage(0, true, q, category), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, category, fetchPage]);

  const act = async (it: CatalogAllItem) => {
    setNotice(null);
    try {
      if (it.origin === "family") return;
      const r = await api.addFromCatalog(it.origin, it.key);
      setItems((cur) => cur.map((c) => (c.origin === it.origin && c.key === it.key ? { ...c, status: "active", productId: r.product.id, unit: r.product.unit } : c)));
      setNotice(r.reactivated ? `« ${it.name} » est de nouveau disponible.` : r.created ? `« ${it.name} » ajouté au catalogue de la famille.` : `« ${it.name} » était déjà disponible.`);
      await onChanged();
    } catch (e) {
      setError(e instanceof NetworkError ? "Pas de connexion." : e instanceof ApiError ? e.message : "Erreur.");
    }
  };

  const label = (k: string) => categories.find((c) => c.key === k)?.label ?? k;
  let last = "";
  return (
    <div data-testid="catalog-all">
      <label className="field search">Chercher dans tous les produits
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. couscous, lessive, thym…" data-testid="all-search" />
      </label>
      <div className="catchips" role="tablist" aria-label="Catégories" data-testid="all-cats">
        <button role="tab" aria-selected={category === null} className={`catchip ${category === null ? "on" : ""}`} data-testid="allcat-all" onClick={() => setCategory(null)}>Toutes</button>
        {categories.map((c) => (
          <button key={c.key} role="tab" aria-selected={category === c.key} className={`catchip ${category === c.key ? "on" : ""}`} data-testid={`allcat-${c.key}`} onClick={() => setCategory(c.key)}>
            <span aria-hidden="true">{CATEGORY_EMOJI[c.key]}</span> {c.label}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert" data-testid="all-error">{error}</p>}
      {notice && <p className="notice" role="status" data-testid="all-notice">{notice}</p>}
      <p className="muted allcount" data-testid="all-count">{total === null ? "Chargement…" : `${total} produit${total > 1 ? "s" : ""}${q.trim() ? " trouvé" + (total > 1 ? "s" : "") : ""}`}</p>
      <ul className="rows allrows" data-testid="all-list">
        {items.map((it) => {
          const head = it.category !== last ? ((last = it.category), true) : false;
          return (
            <li key={`${it.origin}:${it.key}`} className="allcell">
              {head && !category && <h2 className="allhead" data-testid={`allhead-${it.category}`}>{CATEGORY_EMOJI[it.category]} {label(it.category)}</h2>}
              <div className={`row allrow ${it.status === "inactive" ? "row--off" : ""}`} data-testid={`all-${it.name}`} data-status={it.status}>
                <CatPhoto url={it.photoUrl} name={it.name} />
                <span className="row__name">{it.name}{it.brand && <small>{it.brand}</small>}<small>Unité : {unitLabel(it.unit)}</small></span>
                {it.origin === "family" && it.status !== "inactive" && <span className="statebadge" data-testid={`all-have-${it.name}`}><Icon name="check" size={16} /> Déjà disponible</span>}
                {it.origin === "family" && it.status === "inactive" && <span className="muted" data-testid={`all-off-${it.name}`}>Désactivé (voir Mes produits)</span>}
                {it.origin !== "family" && it.status === "absent" && <button className="btn btn--small btn--primary" data-testid={`all-add-${it.name}`} aria-label={`Ajouter ${it.name}`} onClick={() => void act(it)}>Ajouter</button>}
                {it.origin !== "family" && it.status === "inactive" && <button className="btn btn--small" data-testid={`all-react-${it.name}`} aria-label={`Réactiver ${it.name}`} onClick={() => void act(it)}>Réactiver</button>}
                {it.origin !== "family" && it.status === "active" && <span className="statebadge" data-testid={`all-have-${it.name}`}><Icon name="check" size={16} /> Déjà disponible</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {total !== null && items.length === 0 && !busy && <p className="empty" data-testid="all-empty">Aucun produit trouvé.</p>}
      {total !== null && items.length < total && (
        <button className="btn btn--big addbtn" data-testid="all-more" disabled={busy} onClick={() => void fetchPage(items.length, false, q, category)}>
          {busy ? "Chargement…" : `Voir plus (${total - items.length} restants)`}
        </button>
      )}
    </div>
  );
}
