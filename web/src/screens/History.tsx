import { useEffect, useMemo, useState } from "react";
import { afterLayersClosed, BasketChoice } from "../components/Basket";
import { EstimateTotal, PriceTag } from "../components/PriceTag";
import { listLines, NO_PREFS, priceIndex, priceOfLine, totalOf } from "../priceView";
import { api, NetworkError, type HistoryEntry } from "../api";
import { Dialog } from "../components/Dialog";
import { Menu, MenuItem } from "../components/Menu";
import { userMessage } from "../errors";
import { Thumb } from "../components/Thumb";
import { fmtDay, fmtTime, fmtWhen } from "../format";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/PageHead";
import type { Engine, State } from "../sync/engine";
import { sectionGroups } from "../grouping";
import { GroupedRows } from "../components/GroupedRows";
import { RowMeta } from "../components/ItemDetail";
import { ValidationHistory } from "../components/ValidationHistory";
import { fmtQty } from "../units";
import type { ListView, Unit } from "../types";

export function History({ engine, s, categories, openId, onOpened, onPrepared }: { engine: Engine; s: State; categories: { key: string; label: string }[]; openId?: string | null; onOpened?(): void; onPrepared?(): void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [open, setOpen] = useState<ListView | null>(null);
  const [error, setError] = useState(false);
  // Opened from a product's purchase history: go straight to that closed list.
  useEffect(() => {
    if (!openId) return;
    api.listById(openId).then((r) => setOpen(r.list)).catch(() => setError(true)).finally(() => onOpened?.());
  }, [openId, onOpened]);
  useEffect(() => {
    api.history().then((r) => setEntries(r.lists)).catch(() => setError(true));
  }, [s.deleted?.n]);
  // Deleted on another phone while open here: back to the history.
  useEffect(() => {
    if (open && s.deleted?.listId === open.id) setOpen(null);
  }, [s.deleted, open]);

  if (open) return <Archive engine={engine} s={s} list={open} categories={categories} onBack={() => setOpen(null)} onDeleted={() => { setOpen(null); setEntries((cur) => cur?.filter((x) => x.id !== open.id) ?? cur); }} onPrepared={() => { setOpen(null); afterLayersClosed(() => onPrepared?.()); }} />;
  return (
    <>
      <PageHead engine={engine} s={s} title="Historique" subtitle="Les listes clôturées, de la plus récente à la plus ancienne" />
      {error && <p className="empty" data-testid="history-error">Historique indisponible hors connexion.</p>}
      {entries?.length === 0 && <p className="empty">Aucune liste clôturée.</p>}
      <ul className="rows" data-testid="history">
        {entries?.map((e) => (
          <li key={e.id}>
            <button className="hcard" data-testid="history-entry" aria-label={`Liste clôturée le ${fmtDay(e.closedAt)} à ${fmtTime(e.closedAt)}`} onClick={() => api.listById(e.id).then((r) => setOpen(r.list)).catch(() => setError(true))}>
              <span className="hcard__top">
                <span>
                  <span className="hcard__date" data-testid="history-date">{fmtDay(e.closedAt)}</span>
                  <br />
                  <span className="hcard__time" data-testid="history-time">Clôturée à {fmtTime(e.closedAt)} par {e.closedBy.displayName}</span>
                </span>
                <Icon name="chevron-right" className="chev" />
              </span>
              <span className="hcard__sum">{e.purchased} produit{e.purchased > 1 ? "s" : ""} acheté{e.purchased > 1 ? "s" : ""}{e.remaining ? ` · ${e.remaining} non acheté${e.remaining > 1 ? "s" : ""}` : ""}</span>
              {(e.thumbs?.length ?? 0) > 0 && (
                <span className="thumbs" aria-hidden="true">
                  {e.thumbs!.map((t, i) => (t.photoUrl ? <img key={i} className="thumb" src={t.photoUrl} alt="" loading="lazy" /> : <span key={i} className="thumb thumb--empty"><Icon name="cart" size={22} /></span>))}
                  {e.purchased > e.thumbs!.length && <span className="thumbs__more">+{e.purchased - e.thumbs!.length}</span>}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Archive({ engine, s, list, categories, onBack, onPrepared, onDeleted }: { engine: Engine; s: State; list: ListView; categories: { key: string; label: string }[]; onBack(): void; onPrepared(): void; onDeleted(): void }) {
  const bought = list.items.filter((i) => i.status === "purchased");
  const left = list.items.filter((i) => i.status === "to_buy");
  const [validations, setValidations] = useState(false);
  const [reorder, setReorder] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const isAdmin = s.me?.role === "admin";
  const prefs = s.me?.prefs ?? NO_PREFS;
  const prices = useMemo(() => priceIndex(s.catalog), [s.catalog]);
  const lines = [...bought, ...left].map((i) => ({ productId: i.productId, name: i.name, quantity: i.status === "purchased" ? (i.purchase?.quantity ?? i.quantity) : i.quantity, unit: ((i.status === "purchased" ? i.purchase?.unit : null) ?? i.unit) as Unit }));
  const when = list.closedAt ? fmtDay(list.closedAt) : "";
  return (
    <div data-testid="archive">
      <PageHead engine={engine} s={s} onBack={onBack} backLabel="Historique" backTestId="archive-back" title={list.closedAt ? fmtDay(list.closedAt) : "Liste"} subtitle={list.closedAt ? `Clôturée à ${fmtTime(list.closedAt)} par ${list.closedBy?.displayName} · lecture seule` : "Lecture seule"} />
      <div className="actions actions--bar" data-testid="archive-actions">
        {lines.length > 0 && <button className="btn btn--primary btn--small" data-testid="reorder" onClick={() => setReorder(true)}><Icon name="plus" size={20} /> Recommander</button>}
        {(list.validations?.length ?? 0) > 0 && <button className="btn btn--small" data-testid="archive-validations" onClick={() => setValidations(true)}><Icon name="history" size={20} /> Validations ({list.validations!.length})</button>}
        {isAdmin && (
          <Menu label="Plus d'actions" testid="archive-more">
            {(close) => <MenuItem danger testid="archive-delete" onClick={() => { close(); setDelError(null); setConfirm(true); }}>Supprimer la liste</MenuItem>}
          </Menu>
        )}
      </div>
      {confirm && (
        <Dialog title="Supprimer la liste" onClose={() => !deleting && setConfirm(false)} dismissable={!deleting}>
          <p data-testid="archive-delete-text">Supprimer cette liste et ses achats de l'historique ? Cette action est définitive.</p>
          {delError && <p className="error" role="alert" data-testid="archive-delete-error">{delError}</p>}
          <button className="btn btn--danger btn--big" disabled={deleting} data-testid="archive-delete-confirm" onClick={async () => {
            setDeleting(true);
            setDelError(null);
            try {
              await api.deleteList(list.id);
              setConfirm(false);
              onDeleted();
            } catch (e) {
              setDelError(e instanceof NetworkError ? "Pas de connexion : la suppression demande le réseau. Réessayez quand il est revenu." : userMessage(e));
              setDeleting(false);
            }
          }}>{deleting ? "Suppression…" : "Supprimer"}</button>
          <button className="btn btn--ghost" disabled={deleting} data-testid="archive-delete-cancel" onClick={() => setConfirm(false)}>Annuler</button>
        </Dialog>
      )}
      {reorder && <BasketChoice engine={engine} s={s} items={lines} title={`Commande du ${when}`} onClose={() => setReorder(false)} onDone={() => { setReorder(false); onPrepared(); }} />}
      {prefs.showTotals && <EstimateTotal summary={totalOf(listLines(list, prices))} testid="archive-estimate" />}
      {validations && <ValidationHistory list={list} onClose={() => setValidations(false)} />}
      {bought.length > 0 && <><h2 className="sect">Achetés <span className="count-pill">{bought.length}</span></h2>
      <GroupedRows
        groups={sectionGroups(list, "purchased", categories)}
        testid="archive-bought"
        row={(i) => (
          <li key={i.id} className="row row--bought">
            <Thumb photoUrl={i.photoUrl} category={i.category} />
            <span className="row__name">{i.name}<span className="rowqty">{fmtQty(i.purchase?.quantity ?? i.quantity, i.purchase?.unit ?? i.unit)}</span>{i.brand && <small>{i.brand}</small>}<PriceTag price={priceOfLine(i, i.productId, prices, false)} qty={i.purchase?.quantity ?? i.quantity} unit={i.purchase?.unit ?? i.unit} prefs={prefs} testid={`price-${i.productId}`} showMissing={i.priceFrozen} /><small>Acheté par {i.purchase?.by.displayName} · {i.purchase ? fmtWhen(i.purchase.at) : ""}</small></span>
          </li>
        )}
      /></>}
      {left.length > 0 && <><h2 className="sect">Non achetés à la clôture <span className="count-pill" data-testid="archive-left">{left.length}</span></h2>
      <GroupedRows
        groups={sectionGroups(list, "to_buy", categories)}
        testid="archive-left-list"
        row={(i) => (
          <li key={i.id} className="row">
            <Thumb photoUrl={i.photoUrl} category={i.category} />
            <span className="row__name">{i.name}<span className="rowqty">{fmtQty(i.quantity, i.unit)}</span>{i.brand && <small>{i.brand}</small>}<PriceTag price={priceOfLine(i, i.productId, prices, false)} qty={i.quantity} unit={i.unit} prefs={prefs} testid={`price-${i.productId}`} showMissing={i.priceFrozen} /><RowMeta item={i} /></span>
          </li>
        )}
      /></>}
    </div>
  );
}
