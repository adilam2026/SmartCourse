import { useEffect, useState } from "react";
import { api, type HistoryEntry } from "../api";
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
import type { ListView } from "../types";

export function History({ engine, s, categories, openId, onOpened }: { engine: Engine; s: State; categories: { key: string; label: string }[]; openId?: string | null; onOpened?(): void }) {
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
  }, []);

  if (open) return <Archive engine={engine} s={s} list={open} categories={categories} onBack={() => setOpen(null)} />;
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

function Archive({ engine, s, list, categories, onBack }: { engine: Engine; s: State; list: ListView; categories: { key: string; label: string }[]; onBack(): void }) {
  const bought = list.items.filter((i) => i.status === "purchased");
  const left = list.items.filter((i) => i.status === "to_buy");
  const [validations, setValidations] = useState(false);
  return (
    <div data-testid="archive">
      <PageHead engine={engine} s={s} onBack={onBack} backLabel="Historique" backTestId="archive-back" title={list.closedAt ? fmtDay(list.closedAt) : "Liste"} subtitle={list.closedAt ? `Clôturée à ${fmtTime(list.closedAt)} par ${list.closedBy?.displayName} · lecture seule` : "Lecture seule"} />
      {(list.validations?.length ?? 0) > 0 && (
        <div className="actions">
          <button className="btn btn--small" data-testid="archive-validations" onClick={() => setValidations(true)}><Icon name="history" size={20} /> Validations ({list.validations!.length})</button>
        </div>
      )}
      {validations && <ValidationHistory list={list} onClose={() => setValidations(false)} />}
      <h2 className="sect">Achetés <span className="count-pill">{bought.length}</span></h2>
      <GroupedRows
        groups={sectionGroups(list, "purchased", categories)}
        testid="archive-bought"
        row={(i) => (
          <li key={i.id} className="row row--bought">
            <Thumb photoUrl={i.photoUrl} category={i.category} />
            <span className="row__name">{i.name}<span className="rowqty">{fmtQty(i.purchase?.quantity ?? i.quantity, i.purchase?.unit ?? i.unit)}</span>{i.brand && <small>{i.brand}</small>}<small>Acheté par {i.purchase?.by.displayName} · {i.purchase ? fmtWhen(i.purchase.at) : ""}</small></span>
          </li>
        )}
      />
      <h2 className="sect">Non achetés à la clôture <span className="count-pill" data-testid="archive-left">{left.length}</span></h2>
      <GroupedRows
        groups={sectionGroups(list, "to_buy", categories)}
        testid="archive-left-list"
        row={(i) => (
          <li key={i.id} className="row">
            <Thumb photoUrl={i.photoUrl} category={i.category} />
            <span className="row__name">{i.name}<span className="rowqty">{fmtQty(i.quantity, i.unit)}</span>{i.brand && <small>{i.brand}</small>}<RowMeta item={i} /></span>
          </li>
        )}
      />
    </div>
  );
}
