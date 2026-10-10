import { useMemo, useRef, useState } from "react";
import { Banners, bannerCount } from "../components/Banners";
import { ProductCard, type CardState } from "../components/ProductCard";
import { UserSheet } from "../components/UserSheet";
import { CATEGORY_EMOJI } from "../categories";
import { boughtItem, effectiveQty, openItem, projectedPresence, projectedQty } from "../sync/logic";
import { useBackLayer } from "../useBackLayer";
import type { Engine, State } from "../sync/engine";
import type { Unit } from "../types";

export function NoList({ engine, s }: { engine: Engine; s: State }) {
  const hasDraft = Object.keys(s.toggles).length > 0;
  return (
    <main className="nolist" data-testid="no-list">
      <TopBar engine={engine} s={s} validate={false} />
      <div className="nolist__body">
        <div className="nolist__icon" aria-hidden="true">🛒</div>
        <h1>Aucune liste en cours</h1>
        <p>Un parent doit ouvrir une nouvelle liste. Cet écran se mettra à jour tout seul.</p>
        {hasDraft && <p className="muted">Vos choix non enregistrés sont gardés pour la prochaine liste.</p>}
      </div>
    </main>
  );
}

/**
 * One line, three distinct situations, never mixed up:
 *   - chosen but not sent yet  → "N à valider" (the counter below says "pas encore enregistrés")
 *   - validated, server has not confirmed → "⏳ En attente de synchronisation"
 *   - confirmed by the server → "✓ Enregistré sur le serveur" (only right after a confirmation, never while offline)
 */
export function syncLine(s: State, unsent: number): string {
  const queued = s.batches.reduce((n, b) => n + b.ops.length, 0);
  if (s.sending) return "Envoi en cours…";
  const parts: string[] = [];
  if (unsent > 0) parts.push(`${unsent} à valider`);
  if (queued > 0) parts.push("⏳ En attente"); // full wording in the banner right below
  if (parts.length > 0) return parts.join(" · ");
  if (s.conn === "offline") return "Dernière liste connue";
  return s.justSynced ? "✓ Enregistré sur le serveur" : "";
}

export function TopBar({ engine, s, validate, onBack, title = "Courses" }: { engine: Engine; s: State; validate: boolean; onBack?: () => void; title?: string }) {
  const [open, setOpen] = useState(false);
  const pending = Object.keys(s.toggles).length;
  const label = s.sending ? "Enregistrement…" : "Valider";
  const disabled = s.sending || pending === 0;
  return (
    <header className="topbar">
      {onBack ? (
        <button className="avatar avatar--back" aria-label="Retour" data-testid="back" onClick={onBack}>←</button>
      ) : (
        <button className="avatar" aria-label="Mon profil" data-testid="avatar" onClick={() => setOpen(true)}>
          {s.me?.displayName.slice(0, 1).toUpperCase()}
        </button>
      )}
      <div className="topbar__title">
        <strong>{title}</strong>
        <span className="muted" data-testid="sync-state">
          {syncLine(s, pending)}
        </span>
      </div>
      {validate && (
        <button className="btn btn--primary validate" disabled={disabled} aria-busy={s.sending} data-testid="validate" onClick={() => void engine.validate()}>
          {label}
        </button>
      )}
      {open && <UserSheet engine={engine} s={s} onClose={() => setOpen(false)} />}
    </header>
  );
}

interface CatProduct {
  id: string;
  name: string;
  brand: string | null;
  photoUrl: string | null;
  unit: Unit;
  inactive: boolean;
}
interface CatSection {
  key: string;
  label: string;
  products: CatProduct[];
}

/** Lowercase, accents removed: "peche" finds "Pêches". */
const norm = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export function StaffScreen({ engine, s, onBack }: { engine: Engine; s: State; onBack?: () => void }) {
  const { catalog, list, toggles, batches } = s;
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const [query, setQuery] = useState("");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const searching = norm(query).length > 0;
  const view = s.catalogView;
  // Android Back: leaves the opened category (before leaving the screen).
  useBackLayer(view === "categories" && openCat !== null && !searching, () => setOpenCat(null));

  // Catalogue (active products) + articles already on the list whose product was deactivated since.
  const sections: CatSection[] = useMemo(() => {
    if (!catalog || !list) return [];
    return catalog.categories
      .map((c) => {
        const products: CatProduct[] = c.products.map((p) => ({ id: p.id, name: p.name, brand: p.brand, photoUrl: p.photoUrl, unit: p.unit ?? "piece", inactive: false }));
        const known = new Set(products.map((p) => p.id));
        for (const i of list.items) if (i.category === c.key && !known.has(i.productId)) {
          known.add(i.productId);
          products.push({ id: i.productId, name: i.name, brand: i.brand, photoUrl: i.photoUrl, unit: i.unit, inactive: true });
        }
        return { key: c.key, label: c.label, products };
      })
      .filter((c) => c.products.length > 0);
  }, [catalog, list]);

  if (list === null) return onBack ? (onBack(), null) : <NoList engine={engine} s={s} />;
  if (!catalog || !list) {
    return (
      <main className="nolist">
        <div className="nolist__body">
          <div className="nolist__icon" aria-hidden="true">{s.conn === "offline" ? "📵" : "⏳"}</div>
          <h1>{s.conn === "offline" ? "Connexion nécessaire" : "Chargement…"}</h1>
          {s.conn === "offline" && <p>La première ouverture demande internet. Ensuite, le catalogue reste disponible sans connexion.</p>}
        </div>
      </main>
    );
  }

  const stateOf = (productId: string): CardState => {
    if (boughtItem(list, productId) && !projectedPresence(list, batches, productId) && !toggles[productId]?.again) return "bought";
    const t = toggles[productId];
    if (t) return t.want ? "unsaved" : "removing";
    if (!projectedPresence(list, batches, productId)) return "off";
    // In the list: confirmed on the server, or only queued (not confirmed yet)? A quantity change still in the outbox is not confirmed.
    const line = openItem(list, productId);
    return line && projectedQty(list, batches, productId) === line.quantity ? "saved" : "unsaved";
  };

  const all = sections.flatMap((c) => c.products.map((p) => stateOf(p.id)));
  const confirmed = all.filter((x) => x === "saved" || x === "bought").length; // known to the server
  const notYet = all.filter((x) => x === "unsaved" || x === "removing").length; // chosen here, not confirmed
  const tap = (id: string) => void engine.toggle(id);
  const setQty = (id: string, q: number) => void engine.setQuantity(id, q);
  const again = (id: string) => void engine.requestAgain(id);
  const selectedIn = (c: CatSection) => c.products.filter((p) => { const st = stateOf(p.id); return st === "saved" || st === "unsaved"; }).length;

  const card = (c: CatSection, p: CatProduct) => {
    const st = stateOf(p.id);
    const bought = st === "bought" ? boughtItem(list, p.id) : undefined;
    const qty = effectiveQty(list, batches, toggles, p.id);
    return (
      <ProductCard
        key={p.id}
        emoji={CATEGORY_EMOJI[c.key]}
        productId={p.id}
        name={p.name}
        brand={p.brand}
        photoUrl={p.photoUrl}
        inactive={p.inactive}
        state={st}
        unit={openItem(list, p.id)?.unit ?? p.unit}
        qty={qty}
        again={!!toggles[p.id]?.again}
        boughtQty={bought ? { qty: bought.quantity, unit: bought.unit } : undefined}
        onTap={tap}
        onQty={setQty}
        onAgain={again}
      />
    );
  };
  const grid = (c: CatSection, products: CatProduct[]) => <div className="grid">{products.map((p) => card(c, p))}</div>;

  const q = norm(query);
  const found = searching
    ? sections
        .map((c) => ({ ...c, products: c.products.filter((p) => norm(p.name).includes(q) || (p.brand && norm(p.brand).includes(q))) }))
        .filter((c) => c.products.length > 0)
    : [];
  const current = sections.find((c) => c.key === openCat);

  return (
    <div className="staff">
      <div className={`stickyhead ${bannerCount(s) > 0 ? "has-banners" : ""}`}>
      <TopBar engine={engine} s={s} validate onBack={onBack} title={onBack ? "Modifier la liste" : undefined} />
      <Banners engine={engine} s={s} />
      {view === "all" && !searching && (
        <nav className="chips" aria-label="Catégories">
          {sections.map((c) => (
            <button key={c.key} className="chip" aria-label={c.label} onClick={() => refs.current[c.key]?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <span aria-hidden="true">{CATEGORY_EMOJI[c.key] ?? "•"}</span>
            </button>
          ))}
        </nav>
      )}
      </div>
      <main className="catalog" data-testid="catalog">
        <div className="viewbar">
          <div className="seg" role="tablist" aria-label="Affichage du catalogue">
            <button role="tab" aria-selected={view === "all"} className={view === "all" ? "on" : ""} data-testid="view-all" onClick={() => void engine.setCatalogView("all")}>Tous les produits</button>
            <button role="tab" aria-selected={view === "categories"} className={view === "categories" ? "on" : ""} data-testid="view-categories" onClick={() => { setOpenCat(null); void engine.setCatalogView("categories"); }}>Par catégories</button>
          </div>
          <label className="searchbox">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔎 Chercher un produit" aria-label="Chercher un produit dans toutes les catégories" data-testid="catalog-search" />
          </label>
        </div>
        <p className="count" data-testid="count">
          <span className="count__ok" data-testid="count-saved">✓ {confirmed} enregistré{confirmed > 1 ? "s" : ""} sur le serveur</span>
          {notYet > 0 && <span className="count__todo" data-testid="count-unsaved">● {notYet} pas encore enregistré{notYet > 1 ? "s" : ""}</span>}
        </p>
        {searching ? (
          found.length === 0 ? (
            <p className="empty" data-testid="search-empty">Aucun produit « {query.trim()} ».</p>
          ) : (
            found.map((c) => (
              <section key={c.key} aria-labelledby={`found-${c.key}`} data-testid="search-results">
                <h2 id={`found-${c.key}`} className="cathead"><span aria-hidden="true">{CATEGORY_EMOJI[c.key]} </span>{c.label}</h2>
                {grid(c, c.products)}
              </section>
            ))
          )
        ) : view === "all" ? (
          sections.map((c) => (
            <section key={c.key} ref={(el) => void (refs.current[c.key] = el)} className="category" aria-labelledby={`cat-${c.key}`}>
              <h2 id={`cat-${c.key}`}><span aria-hidden="true">{CATEGORY_EMOJI[c.key]} </span>{c.label}</h2>
              {grid(c, c.products)}
            </section>
          ))
        ) : current ? (
          <section aria-labelledby="open-cat" data-testid="category-open">
            <div className="catback">
              <button className="btn" data-testid="cat-back" onClick={() => setOpenCat(null)}>← Catégories</button>
              <h2 id="open-cat"><span aria-hidden="true">{CATEGORY_EMOJI[current.key]} </span>{current.label}</h2>
            </div>
            {grid(current, current.products)}
          </section>
        ) : (
          <div className="catblocks" data-testid="category-blocks">
            {sections.map((c) => {
              const n = selectedIn(c);
              const pics = c.products.filter((p) => p.photoUrl).slice(0, 4);
              return (
                <button key={c.key} type="button" className={`catblock ${n > 0 ? "catblock--sel" : ""}`} data-testid={`catblock-${c.key}`} aria-label={`${c.label}, ${c.products.length} produit${c.products.length > 1 ? "s" : ""}${n > 0 ? `, ${n} sélectionné${n > 1 ? "s" : ""}` : ""}`} onClick={() => setOpenCat(c.key)}>
                  {n > 0 && <span className="catblock__count" data-testid={`catcount-${c.key}`} aria-hidden="true">{n}</span>}
                  <span className="catblock__mosaic" aria-hidden="true">
                    {pics.length > 0 ? pics.map((p) => <img key={p.id} src={p.photoUrl!} alt="" loading="lazy" decoding="async" />) : <span>{CATEGORY_EMOJI[c.key] ?? "•"}</span>}
                  </span>
                  <span className="catblock__title"><span className="catblock__emoji" aria-hidden="true">{CATEGORY_EMOJI[c.key]} </span>{c.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
