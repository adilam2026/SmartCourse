import { useEffect, useState } from "react";
import { api, type HistoryEntry } from "../api";
import { Thumb } from "../components/Thumb";
import { fmtDateTime, fmtDay } from "../format";
import type { ListView } from "../types";

export function History() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [open, setOpen] = useState<ListView | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api.history().then((r) => setEntries(r.lists)).catch(() => setError(true));
  }, []);

  if (open) return <Archive list={open} onBack={() => setOpen(null)} />;
  return (
    <>
      <header className="topbar"><div className="topbar__title"><strong>Historique</strong></div></header>
      {error && <p className="empty" data-testid="history-error">Historique indisponible hors connexion.</p>}
      {entries?.length === 0 && <p className="empty">Aucune liste clôturée.</p>}
      <ul className="rows" data-testid="history">
        {entries?.map((e) => (
          <li key={e.id}>
            <button className="row row--btn" data-testid="history-entry" onClick={() => api.listById(e.id).then((r) => setOpen(r.list)).catch(() => setError(true))}>
              <span className="row__name">
                {fmtDay(e.closedAt)}
                <small>Clôturée par {e.closedBy.displayName} · {e.purchased} acheté{e.purchased > 1 ? "s" : ""} · {e.remaining} non acheté{e.remaining > 1 ? "s" : ""}{e.corrections ? ` · ${e.corrections} correction${e.corrections > 1 ? "s" : ""}` : ""}</small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Archive({ list, onBack }: { list: ListView; onBack(): void }) {
  const bought = list.items.filter((i) => i.status === "purchased");
  const left = list.items.filter((i) => i.status === "to_buy");
  return (
    <div data-testid="archive">
      <header className="topbar">
        <button className="avatar avatar--back" aria-label="Retour" data-testid="archive-back" onClick={onBack}>←</button>
        <div className="topbar__title">
          <strong>{list.closedAt ? fmtDay(list.closedAt) : "Liste"}</strong>
          <span className="muted">Clôturée par {list.closedBy?.displayName} · lecture seule</span>
        </div>
      </header>
      <h2 className="sect">Achetés <span className="count-pill">{bought.length}</span></h2>
      <ul className="rows">
        {bought.map((i) => (
          <li key={i.id} className="row row--bought">
            <Thumb photoUrl={i.photoUrl} category={i.category} />
            <span className="row__name">{i.name}{i.brand && <small>{i.brand}</small>}<small>Acheté par {i.purchase?.by.displayName} · {i.purchase ? fmtDateTime(i.purchase.at) : ""}</small></span>
          </li>
        ))}
      </ul>
      <h2 className="sect">Non achetés à la clôture <span className="count-pill" data-testid="archive-left">{left.length}</span></h2>
      <ul className="rows">
        {left.map((i) => (
          <li key={i.id} className="row">
            <Thumb photoUrl={i.photoUrl} category={i.category} />
            <span className="row__name">{i.name}{i.brand && <small>{i.brand}</small>}</span>
          </li>
        ))}
      </ul>
      {(list.corrections?.length ?? 0) > 0 && (
        <>
          <h2 className="sect">Corrections</h2>
          <ul className="rows" data-testid="corrections">
            {list.corrections!.map((c) => (
              <li key={c.purchaseId} className="row">
                <span className="row__name">
                  {c.name}
                  <small>Acheté par {c.purchasedBy.displayName} le {fmtDateTime(c.purchasedAt)}</small>
                  <small>Corrigé par {c.correctedBy.displayName} le {fmtDateTime(c.correctedAt)}{c.reason ? ` — « ${c.reason} »` : ""}</small>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
