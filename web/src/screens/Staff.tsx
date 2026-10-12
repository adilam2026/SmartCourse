import { useEffect, useMemo, useRef, useState } from "react";
import { Banners, bannerCount } from "../components/Banners";
import { ProductCard, type CardState } from "../components/ProductCard";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/PageHead";
import { CATEGORY_EMOJI } from "../categories";
import { boughtItem, effectiveQty, openItem, projectedPresence, projectedQty } from "../sync/logic";
import { useBackLayer } from "../useBackLayer";
import type { Engine, State } from "../sync/engine";
import type { Unit } from "../types";

export type SyncKind = "sending" | "todo" | "waiting" | "offline" | "ok";
/**
 * ONE short indication in the header, in plain words, never two at once:
 *   - choices not validated yet                    → « 3 modifications à valider » (the only thing shown in orange)
 *   - validated, the server has not received them  → « En attente de connexion »
 *   - nothing to send, phone offline               → « Hors connexion »
 *   - nothing to send                              → « Liste à jour »
 */
export function syncState(s: State, unsent: number): { kind: SyncKind; text: string } {
  const queued = s.batches.reduce((n, b) => n + b.ops.length, 0);
  if (s.sending) return { kind: "sending", text: "Envoi en cours…" };
  if (unsent > 0) return { kind: "todo", text: `${unsent} modification${unsent > 1 ? "s" : ""} à valider` };
  if (queued > 0) return { kind: "waiting", text: "En attente de connexion" };
  if (s.conn === "offline") return { kind: "offline", text: "Hors connexion" };
  return { kind: "ok", text: "Liste à jour" };
}

/** The single status line under the title (see syncState). */
function SyncLine({ s }: { s: State }) {
  const sync = syncState(s, Object.keys(s.toggles).length);
  return (
    <span className={`syncstate syncstate--${sync.kind}`} data-testid="sync-state" data-kind={sync.kind}>
      {sync.text}
    </span>
  );
}

/** True while the on-screen keyboard is up (the visible viewport is much shorter than the window): fixed bars then give way to the field. */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setOpen(vv.height < window.innerHeight * 0.75 && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? ""));
    check();
    vv.addEventListener("resize", check);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    return () => {
      vv.removeEventListener("resize", check);
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
    };
  }, []);
  return open;
}

/** Fixed bottom button « Valider N modifications »: always reachable, never over the last cards (the page keeps room for it). */
function ValidateBar({ engine, s }: { engine: Engine; s: State }) {
  const pending = Object.keys(s.toggles).length;
  const keyboard = useKeyboardOpen();
  const label = s.sending ? "Enregistrement…" : pending > 0 ? `Valider ${pending} modification${pending > 1 ? "s" : ""}` : "Aucune modification à valider";
  return (
    <div className={`actionbar ${keyboard ? "actionbar--hidden" : ""}`} data-testid="actionbar">
      <button className="btn btn--primary validate" disabled={s.sending || pending === 0} aria-busy={s.sending} data-testid="validate" onClick={() => void engine.validate()}>
        {pending > 0 && !s.sending && <Icon name="check" size={22} />}
        {label}
      </button>
    </div>
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
    if (!catalog) return [];
    return catalog.categories
      .map((c) => {
        const products: CatProduct[] = c.products.map((p) => ({ id: p.id, name: p.name, brand: p.brand, photoUrl: p.photoUrl, unit: p.unit ?? "piece", inactive: false }));
        const known = new Set(products.map((p) => p.id));
        for (const i of list?.items ?? []) if (i.category === c.key && !known.has(i.productId)) {
          known.add(i.productId);
          products.push({ id: i.productId, name: i.name, brand: i.brand, photoUrl: i.photoUrl, unit: i.unit, inactive: true });
        }
        return { key: c.key, label: c.label, products };
      })
      .filter((c) => c.products.length > 0);
  }, [catalog, list]);

  if (list === null && onBack) return (onBack(), null);
  if (!catalog || list === undefined) {
    return (
      <main className="nolist">
        <div className="nolist__body">
          <img className="nolist__logo" src="/icons/icon-192.png" alt="" width="96" height="96" />
          <h1>{s.conn === "offline" ? "Connexion nécessaire" : "Chargement…"}</h1>
          {s.conn === "offline" && <p>La première ouverture demande internet. Ensuite, le catalogue reste disponible sans connexion.</p>}
        </div>
      </main>
    );
  }

  // Without a list nothing is selected: the catalogue is shown, read-only, until a parent opens one.
  const noList = list === null;
  const stateOf = (productId: string): CardState => {
    if (!list) return "off";
    if (boughtItem(list, productId) && !projectedPresence(list, batches, productId) && !toggles[productId]?.again) return "bought";
    const t = toggles[productId];
    if (t) return t.want ? "unsaved" : "removing";
    if (!projectedPresence(list, batches, productId)) return "off";
    // In the list: confirmed on the server, or only queued (not confirmed yet)? A quantity change still in the outbox is not confirmed.
    const line = openItem(list, productId);
    return line && projectedQty(list, batches, productId) === line.quantity ? "saved" : "unsaved";
  };

  const tap = (id: string) => { if (!noList) void engine.toggle(id); };
  const setQty = (id: string, q: number) => void engine.setQuantity(id, q);
  const again = (id: string) => void engine.requestAgain(id);
  const selectedIn = (c: CatSection) => c.products.filter((p) => { const st = stateOf(p.id); return st === "saved" || st === "unsaved"; }).length;

  const card = (c: CatSection, p: CatProduct) => {
    const st = stateOf(p.id);
    const bought = st === "bought" && list ? boughtItem(list, p.id) : undefined;
    const qty = list ? effectiveQty(list, batches, toggles, p.id) : undefined;
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
        unit={(list && openItem(list, p.id)?.unit) || p.unit}
        qty={qty}
        again={!!toggles[p.id]?.again}
        boughtQty={bought ? { qty: bought.quantity, unit: bought.unit } : undefined}
        readOnly={noList}
        onTap={tap}
        onQty={noList ? undefined : setQty}
        onAgain={noList ? undefined : again}
      />
    );
  };
  const grid = (c: CatSection, products: CatProduct[]) => <div className="gridhost"><div className="grid">{products.map((p) => card(c, p))}</div></div>;

  const q = norm(query);
  const found = searching
    ? sections
        .map((c) => ({ ...c, products: c.products.filter((p) => norm(p.name).includes(q) || (p.brand && norm(p.brand).includes(q))) }))
        .filter((c) => c.products.length > 0)
    : [];
  const current = sections.find((c) => c.key === openCat);

  return (
    <div className="staff">
      <PageHead engine={engine} s={s} title="Préparer les courses" onBack={onBack} backLabel="Retour à la liste" subtitle={noList ? undefined : <SyncLine s={s} />} />
      <div className={`stickyhead ${bannerCount(s) > 0 ? "has-banners" : ""}`}>
      <Banners engine={engine} s={s} />
      {noList && <p className="banner banner--notice" role="status" data-testid="no-list">Aucune liste en cours : rien n'est sélectionné. Un parent doit ouvrir une nouvelle liste ; cet écran se met à jour tout seul.</p>}
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
            <Icon name="search" size={20} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un produit…" aria-label="Chercher un produit dans toutes les catégories" data-testid="catalog-search" />
          </label>
        </div>
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
              // Two representative photos: the selected products first, then the others.
              const withPhoto = c.products.filter((p) => p.photoUrl);
              const pics = [...withPhoto.filter((p) => { const st = stateOf(p.id); return st === "saved" || st === "unsaved"; }), ...withPhoto].filter((p, i, all) => all.indexOf(p) === i).slice(0, 2);
              return (
                <button key={c.key} type="button" className={`catblock ${n > 0 ? "catblock--sel" : ""}`} data-testid={`catblock-${c.key}`} aria-label={`${c.label}, ${c.products.length} produit${c.products.length > 1 ? "s" : ""}${n > 0 ? `, ${n} sélectionné${n > 1 ? "s" : ""}` : ""}`} onClick={() => setOpenCat(c.key)}>
                  <span className="catblock__mosaic" aria-hidden="true">
                    {pics.length > 0 ? pics.map((p) => <img key={p.id} src={p.photoUrl!} alt="" decoding="async" />) : <span>{CATEGORY_EMOJI[c.key] ?? "•"}</span>}
                  </span>
                  <span className="catblock__title">{c.label}</span>
                  {n > 0 ? <span className="catblock__count" data-testid={`catcount-${c.key}`} aria-hidden="true">{n} sélectionné{n > 1 ? "s" : ""}</span> : <span className="catblock__none" aria-hidden="true">{c.products.length} produit{c.products.length > 1 ? "s" : ""}</span>}
                </button>
              );
            })}
          </div>
        )}
      </main>
      {!noList && <ValidateBar engine={engine} s={s} />}
    </div>
  );
}
