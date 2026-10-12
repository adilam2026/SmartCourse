import { useMemo, useState } from "react";
import { Banners } from "../Banners";
import { PageHead } from "../PageHead";
import { EstimateTotal, PriceTag } from "../PriceTag";
import { Thumb } from "../Thumb";
import { CATEGORY_EMOJI } from "../../categories";
import { fmtToday } from "../../format";
import { groupByCategory } from "../../grouping";
import { listLines, NO_PREFS, priceIndex, priceOfLine, totalOf } from "../../priceView";
import { effectiveQty, projectedPresence } from "../../sync/logic";
import { fmtQty } from "../../units";
import type { Engine, State } from "../../sync/engine";
import type { ListItem, Unit } from "../../types";

type Filter = "all" | "todo" | "done";

interface Row {
  key: string;
  productId: string;
  name: string;
  photoUrl: string | null;
  category: string;
  qty: number;
  unit: Unit;
  /** draft : sélection en cours (pas validée) · pending : validée, envoi en attente (gardée sur ce téléphone) · asked : à acheter (enregistrée dans la liste) · bought : acheté */
  status: "draft" | "pending" | "asked" | "bought";
  item?: ListItem;
}

const BADGE: Record<Row["status"], string> = { draft: "Sélection en cours", pending: "Envoi en attente", asked: "À acheter", bought: "Acheté" };

/**
 * V3 · Liste du jour du personnel. États bien distincts : « Sélection en cours » (choisi sur ce téléphone, pas validé), « Envoi en attente »
 * (validé hors connexion : gardé sur ce téléphone, PAS encore enregistré sur le serveur), « À acheter » (enregistré dans la liste partagée) et « Acheté ».
 * La progression ne compte que les articles ENREGISTRÉS (à acheter + achetés). Valider enregistre la sélection dans la liste partagée, sans approbation.
 * Le personnel ne marque aucun achat : ce droit reste aux parents et administrateurs.
 */
export function StaffList({ engine, s, onChoose, onValidated }: { engine: Engine; s: State; onChoose(): void; onValidated?(sent: number, result: "sent" | "queued" | "failed" | "nothing"): void }) {
  const { list, catalog, toggles, batches } = s;
  const [filter, setFilter] = useState<Filter>("all");
  const prefs = s.me?.prefs ?? NO_PREFS;
  const prices = useMemo(() => priceIndex(catalog), [catalog]);
  const cats = catalog?.categories ?? [];
  const byId = useMemo(() => {
    const m = new Map<string, { name: string; photoUrl: string | null; category: string; unit: Unit }>();
    for (const c of cats) for (const p of c.products) m.set(p.id, { name: p.name, photoUrl: p.photoUrl, category: c.key, unit: p.unit });
    return m;
  }, [cats]);

  const items = (list?.items ?? []).filter((i) => i.status === "to_buy" || i.status === "purchased");
  const asked = items.filter((i) => i.status === "to_buy");
  const bought = items.filter((i) => i.status === "purchased");
  const total = items.length;
  const pct = total ? Math.round((bought.length / total) * 100) : 0;
  const drafts: Row[] = Object.entries(toggles)
    .filter(([id, t]) => t.want && !projectedPresence(list, batches, id) && byId.has(id))
    .map(([id, t]) => {
      const p = byId.get(id)!;
      return { key: `d-${id}`, productId: id, name: p.name, photoUrl: p.photoUrl, category: p.category, qty: effectiveQty(list, batches, toggles, id) ?? t.qty ?? 1, unit: p.unit, status: "draft" as const };
    });
  // Validé mais pas encore reçu par le serveur (hors connexion) : visible, mais ni compté ni confondu avec une demande enregistrée.
  const queuedQty = new Map<string, number>();
  for (const b of batches) {
    for (const op of b.ops) {
      if (op.type === "add" || op.type === "request_again") queuedQty.set(op.productId, op.quantity ?? 1);
      else if (op.type === "set_qty" && queuedQty.has(op.productId)) queuedQty.set(op.productId, op.quantity);
      else if (op.type === "remove") queuedQty.delete(op.productId);
    }
  }
  const pendingRows: Row[] = [...queuedQty.entries()]
    .filter(([id]) => byId.has(id) && !items.some((i) => i.productId === id && i.status === "to_buy"))
    .map(([id, q]) => {
      const p = byId.get(id)!;
      return { key: `q-${id}`, productId: id, name: p.name, photoUrl: p.photoUrl, category: p.category, qty: q, unit: p.unit, status: "pending" as const };
    });
  const rows: Row[] = items.map((i) => ({
    key: i.id,
    productId: i.productId,
    name: i.name,
    photoUrl: i.photoUrl,
    category: i.category,
    qty: i.status === "purchased" ? (i.purchase?.quantity ?? i.quantity) : i.quantity,
    unit: ((i.status === "purchased" ? i.purchase?.unit : null) ?? i.unit) as Unit,
    status: i.status === "purchased" ? ("bought" as const) : ("asked" as const),
    item: i,
  }));
  const shown = rows.filter((r) => filter === "all" || (filter === "todo" ? r.status === "asked" : r.status === "bought"));
  const groups = groupByCategory(shown, cats);
  const nothingYet = total === 0 && drafts.length === 0 && pendingRows.length === 0;
  const FILTERS: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "Tous", n: total },
    { key: "todo", label: "À acheter", n: asked.length },
    { key: "done", label: "Achetés", n: bought.length },
  ];

  return (
    <div className="stafflist" data-testid="staff-list">
      <PageHead engine={engine} s={s} title="Les courses du jour" subtitle={fmtToday()} />
      <Banners engine={engine} s={s} />
      {total > 0 && (
        <section className="progresscard" aria-label="Progression" data-testid="sl-progress">
          <div className="progresscard__line">
            <strong data-testid="sl-progress-text">{`${bought.length} sur ${total} acheté${bought.length > 1 ? "s" : ""}`}</strong>
            <span data-testid="sl-pct">{pct} %</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Articles achetés"><i style={{ width: `${pct}%` }} /></div>
        </section>
      )}
      {prefs.showTotals && list && <EstimateTotal summary={totalOf(listLines(list, prices))} />}

      {pendingRows.length > 0 && (
        <section className="slsection" aria-label="Envoi en attente" data-testid="sl-pending">
          <h2 className="slsection__title">Envoi en attente <span className="count-pill">{pendingRows.length}</span></h2>
          <p className="muted" data-testid="sl-pending-note">Gardé sur ce téléphone, envoyé dès le retour du réseau.</p>
          <ul className="slrows">
            {pendingRows.map((r) => <RowView key={r.key} r={r} prefs={prefs} price={priceOfLine(undefined, r.productId, prices, true)} />)}
          </ul>
        </section>
      )}

      {drafts.length > 0 && (
        <section className="slsection" aria-label="Sélection en cours" data-testid="sl-drafts">
          <h2 className="slsection__title">Sélection en cours <span className="count-pill">{drafts.length}</span></h2>
          <ul className="slrows">
            {drafts.map((r) => <RowView key={r.key} r={r} prefs={prefs} price={priceOfLine(undefined, r.productId, prices, true)} />)}
          </ul>
          <button className="btn btn--primary btn--big" data-testid="sl-validate" disabled={s.sending} onClick={() => void engine.validate().then((r) => onValidated?.(drafts.length, r))}>
            Valider {drafts.length} article{drafts.length > 1 ? "s" : ""}
          </button>
        </section>
      )}

      {total > 0 && (
        <div className="seg slfilters" role="tablist" aria-label="Filtrer la liste">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} className={filter === f.key ? "on" : ""} data-testid={`sl-filter-${f.key}`} onClick={() => setFilter(f.key)}>{f.label} ({f.n})</button>
          ))}
        </div>
      )}

      {nothingYet && (
        <div className="slempty" data-testid="sl-empty">
          <p>Aucun article dans la liste pour le moment.</p>
          <button className="btn btn--primary" data-testid="sl-choose" onClick={onChoose}>Choisir des articles</button>
        </div>
      )}
      {total > 0 && shown.length === 0 && <p className="empty" data-testid="sl-none">Aucun article dans cette vue.</p>}
      {groups.map((g) => (
        <section key={g.key} className="slsection" aria-label={g.label} data-testid={`sl-group-${g.key}`}>
          <h2 className="slsection__title"><span aria-hidden="true">{CATEGORY_EMOJI[g.key] ?? "•"}</span> {g.label} <span className="count-pill">{g.items.length}</span></h2>
          <ul className="slrows">
            {g.items.map((r) => <RowView key={r.key} r={r} prefs={prefs} price={priceOfLine(r.item, r.productId, prices, true)} />)}
          </ul>
        </section>
      ))}
      {total > 0 && <button className="linkbtn linkbtn--inline slmore" data-testid="sl-choose-more" onClick={onChoose}>+ Choisir d'autres articles</button>}
    </div>
  );
}

function RowView({ r, prefs, price }: { r: Row; prefs: State["me"] extends infer M ? (M extends { prefs?: infer P } ? NonNullable<P> : never) : never; price: ReturnType<typeof priceOfLine> }) {
  return (
    <li className={`slrow slrow--${r.status}`} data-testid={`sl-row-${r.productId}`} data-status={r.status}>
      <Thumb photoUrl={r.photoUrl} category={r.category} />
      <span className="slrow__body">
        <span className="slrow__name">{r.name}</span>
        <span className="slrow__qty" data-testid={`sl-qty-${r.productId}`}>{fmtQty(r.qty, r.unit)}</span>
        <PriceTag price={price} qty={r.qty} unit={r.unit} prefs={prefs} testid={`sl-price-${r.productId}`} />
      </span>
      <span className={`slbadge slbadge--${r.status}`} data-testid={`sl-badge-${r.productId}`}>{BADGE[r.status]}</span>
    </li>
  );
}
