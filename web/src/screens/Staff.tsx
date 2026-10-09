import { useMemo, useRef, useState } from "react";
import { Banners } from "../components/Banners";
import { ProductCard, type CardState } from "../components/ProductCard";
import { UserSheet } from "../components/UserSheet";
import { CATEGORY_EMOJI } from "../categories";
import { effectivePresence } from "../sync/logic";
import type { Engine, State } from "../sync/engine";

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

export function TopBar({ engine, s, validate, onBack, title = "Liste de courses" }: { engine: Engine; s: State; validate: boolean; onBack?: () => void; title?: string }) {
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
          {s.sending ? "Envoi en cours…" : s.batches.length > 0 ? "En attente de synchronisation" : s.justSynced ? "✓ Enregistré" : pending > 0 ? `${pending} changement${pending > 1 ? "s" : ""} à valider` : ""}
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

export function StaffScreen({ engine, s, onBack }: { engine: Engine; s: State; onBack?: () => void }) {
  const { catalog, list, toggles, batches } = s;
  const refs = useRef<Record<string, HTMLElement | null>>({});

  // Catalogue (active products) + articles already on the list whose product was deactivated since.
  const sections = useMemo(() => {
    if (!catalog || !list) return [];
    return catalog.categories
      .map((c) => {
        const products = c.products.map((p) => ({ id: p.id, name: p.name, brand: p.brand, photoUrl: p.photoUrl, inactive: false }));
        const known = new Set(products.map((p) => p.id));
        for (const i of list.items) if (i.category === c.key && !known.has(i.productId)) products.push({ id: i.productId, name: i.name, brand: i.brand, photoUrl: i.photoUrl, inactive: true });
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
    const item = list.items.find((i) => i.productId === productId);
    if (item?.status === "purchased") return "bought";
    const t = toggles[productId];
    if (t) return t.want ? "unsaved" : "removing";
    if (!effectivePresence(list, batches, toggles, productId)) return "off";
    // In the list: confirmed on the server, or only queued (not confirmed yet)?
    return item ? "saved" : "unsaved";
  };

  const count = sections.reduce((n, c) => n + c.products.filter((p) => ["saved", "unsaved", "bought"].includes(stateOf(p.id))).length, 0);
  const tap = (id: string) => void engine.toggle(id);

  return (
    <div className="staff">
      <div className="stickyhead">
      <TopBar engine={engine} s={s} validate onBack={onBack} title={onBack ? "Modifier la liste" : undefined} />
      <Banners engine={engine} s={s} />
      <nav className="chips" aria-label="Catégories">
        {sections.map((c) => (
          <button key={c.key} className="chip" aria-label={c.label} onClick={() => refs.current[c.key]?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <span aria-hidden="true">{CATEGORY_EMOJI[c.key] ?? "•"}</span>
          </button>
        ))}
      </nav>
      </div>
      <main className="catalog" data-testid="catalog">
        <p className="muted count" data-testid="count">{count} produit{count > 1 ? "s" : ""} dans la liste</p>
        {sections.map((c) => (
          <section key={c.key} ref={(el) => void (refs.current[c.key] = el)} className="category" aria-labelledby={`cat-${c.key}`}>
            <h2 id={`cat-${c.key}`}><span aria-hidden="true">{CATEGORY_EMOJI[c.key]} </span>{c.label}</h2>
            <div className="grid">
              {c.products.map((p) => (
                <ProductCard key={p.id} emoji={CATEGORY_EMOJI[c.key]} productId={p.id} name={p.name} brand={p.brand} photoUrl={p.photoUrl} inactive={p.inactive} state={stateOf(p.id)} onTap={tap} />
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
