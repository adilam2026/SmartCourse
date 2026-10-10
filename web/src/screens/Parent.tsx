import { useState } from "react";
import { useBackLayer } from "../useBackLayer";
import { Banners } from "../components/Banners";
import { Dialog } from "../components/Dialog";
import { Thumb } from "../components/Thumb";
import { UserSheet } from "../components/UserSheet";
import { fmtWhen } from "../format";
import { sectionGroups } from "../grouping";
import { fmtQty } from "../units";
import { GroupedRows } from "../components/GroupedRows";
import { ItemDetail, RowMeta } from "../components/ItemDetail";
import { ValidationHistory } from "../components/ValidationHistory";
import { Stats } from "./Stats";
import type { Engine, State } from "../sync/engine";
import type { ListItem } from "../types";
import { StaffScreen } from "./Staff";
import { History } from "./History";
import { Settings } from "./Settings";

type Tab = "current" | "history" | "stats" | "settings";

export function ParentApp({ engine, s }: { engine: Engine; s: State }) {
  const [tab, setTab] = useState<Tab>("current");
  const [editing, setEditing] = useState(false);
  const isAdmin = s.me?.role === "admin";
  const isEditing = editing && s.list?.status === "active";
  useBackLayer(isEditing, () => setEditing(false)); // Back leaves the edit screen
  useBackLayer(!isEditing && tab !== "current", () => setTab("current")); // then goes back to the first tab
  if (editing && s.list?.status === "active") return <StaffScreen engine={engine} s={s} onBack={() => setEditing(false)} />;
  return (
    <div className="parent">
      <div className="parent__body">
        {tab === "current" && <Current engine={engine} s={s} onEdit={() => setEditing(true)} />}
        {tab === "history" && <History categories={s.catalog?.categories ?? []} />}
        {tab === "stats" && <Stats />}
        {tab === "settings" && isAdmin && <Settings engine={engine} s={s} />}
      </div>
      <nav className="tabbar" aria-label="Navigation">
        <button className={tab === "current" ? "on" : ""} aria-current={tab === "current"} data-testid="tab-current" onClick={() => setTab("current")}>🛒<span>En cours</span></button>
        <button className={tab === "history" ? "on" : ""} aria-current={tab === "history"} data-testid="tab-history" onClick={() => setTab("history")}>🗂️<span>Historique</span></button>
        <button className={tab === "stats" ? "on" : ""} aria-current={tab === "stats"} data-testid="tab-stats" onClick={() => setTab("stats")}>📊<span>Statistiques</span></button>
        {isAdmin && <button className={tab === "settings" ? "on" : ""} aria-current={tab === "settings"} data-testid="tab-settings" onClick={() => setTab("settings")}>⚙️<span>Réglages</span></button>}
      </nav>
    </div>
  );
}

function Current({ engine, s, onEdit }: { engine: Engine; s: State; onEdit(): void }) {
  const [menu, setMenu] = useState(false);
  const [correcting, setCorrecting] = useState<ListItem | null>(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [validations, setValidations] = useState(false);
  const list = s.list;

  const header = (
    <header className="topbar">
      <button className="avatar" aria-label="Mon profil" data-testid="avatar" onClick={() => setMenu(true)}>{s.me?.displayName.slice(0, 1).toUpperCase()}</button>
      <div className="topbar__title"><strong>En cours</strong></div>
      {menu && <UserSheet engine={engine} s={s} onClose={() => setMenu(false)} />}
    </header>
  );

  if (list === undefined) return <>{header}<p className="empty">Chargement…</p></>;
  if (list === null) {
    return (
      <>
        {header}
        <Banners engine={engine} s={s} />
        <div className="nolist__body" data-testid="no-list">
          <div className="nolist__icon" aria-hidden="true">🛒</div>
          <h1>Aucune liste en cours</h1>
          <button className="btn btn--primary btn--big" data-testid="create-list" disabled={busy === "create"} onClick={async () => { setBusy("create"); await engine.createList(); setBusy(null); }}>
            Créer une nouvelle liste
          </button>
        </div>
      </>
    );
  }

  const toBuy = list.items.filter((i) => i.status === "to_buy");
  const bought = list.items.filter((i) => i.status === "purchased");
  const pendingEdits = Object.keys(s.toggles).length;
  // Presentation only: the same lines, grouped by category (catalogue order). The list itself is never changed.
  const cats = s.catalog?.categories ?? [];
  const toBuyGroups = sectionGroups(list, "to_buy", cats);
  const boughtGroups = sectionGroups(list, "purchased", cats);
  const detailItem = detail ? list.items.find((i) => i.id === detail) : undefined;

  const buy = async (id: string) => {
    setBusy(id);
    await engine.purchase(id);
    setBusy(null);
  };

  return (
    <>
      {header}
      <Banners engine={engine} s={s} />
      {s.conn === "offline" && <p className="banner banner--offline limit" data-testid="offline-limit">Hors connexion : les achats et corrections ne peuvent pas être enregistrés tant que le serveur est injoignable.</p>}
      <div className="actions">
        <button className="btn" data-testid="edit-list" onClick={onEdit}>✏️ Modifier{pendingEdits ? ` (${pendingEdits})` : ""}</button>
        <button className="btn btn--ghost" data-testid="close-list" onClick={() => setClosing(true)}>Clôturer</button>
      </div>
      {(list.validations?.length ?? 0) > 0 && (
        <button className="linkbtn" data-testid="open-validations" onClick={() => setValidations(true)}>Historique des validations ({list.validations!.length})</button>
      )}

      <section aria-labelledby="h-tobuy">
        <h2 id="h-tobuy" className="sect">À acheter <span className="count-pill" data-testid="count-tobuy">{toBuy.length}</span></h2>
        {toBuy.length === 0 && <p className="empty">Rien à acheter pour le moment.</p>}
        <GroupedRows
          groups={toBuyGroups}
          testid="to-buy"
          row={(i) => (
            <li key={i.id} className="row" data-testid={`row-${i.productId}`}>
              <Thumb photoUrl={i.photoUrl} category={i.category} />
              <button className="row__main" data-testid={`detail-${i.productId}`} aria-label={`Détail des modifications de ${i.name}`} onClick={() => setDetail(i.id)}>
                <b>{i.name}<span className="qtychip" data-testid={`qty-${i.productId}`}>{fmtQty(i.quantity, i.unit)}</span></b>
                {i.brand && <small>{i.brand}</small>}
                {!i.productActive && <small>désactivé</small>}
                <RowMeta item={i} />
              </button>
              <button className="btn btn--primary" data-testid={`buy-${i.productId}`} disabled={busy === i.id} onClick={() => void buy(i.id)}>Acheté</button>
            </li>
          )}
        />
      </section>

      <section aria-labelledby="h-bought">
        <h2 id="h-bought" className="sect">Déjà achetés <span className="count-pill" data-testid="count-bought">{bought.length}</span></h2>
        <GroupedRows
          groups={boughtGroups}
          testid="bought"
          row={(i) => (
            <li key={i.id} className="row row--bought" data-testid={`row-${i.productId}`}>
              <Thumb photoUrl={i.photoUrl} category={i.category} />
              <button className="row__main" data-testid={`detail-${i.productId}`} aria-label={`Détail de ${i.name}`} onClick={() => setDetail(i.id)}>
                <b>{i.name}<span className="qtychip">{fmtQty(i.purchase?.quantity ?? i.quantity, i.purchase?.unit ?? i.unit)}</span></b>
                <small data-testid={`by-${i.productId}`}>Acheté par {i.purchase?.by.displayName} · {i.purchase ? fmtWhen(i.purchase.at) : ""}</small>
              </button>
              <button className="btn btn--ghost" data-testid={`correct-${i.productId}`} onClick={() => setCorrecting(i)}>Corriger</button>
            </li>
          )}
        />
      </section>

      {detailItem && <ItemDetail list={list} item={detailItem} onClose={() => setDetail(null)} />}
      {validations && <ValidationHistory list={list} onClose={() => setValidations(false)} />}
      {correcting && <CorrectDialog engine={engine} item={correcting} onClose={() => setCorrecting(null)} />}
      {closing && <CloseDialog engine={engine} remaining={toBuy.length} onClose={() => setClosing(false)} />}
    </>
  );
}

function CorrectDialog({ engine, item, onClose }: { engine: Engine; item: ListItem; onClose(): void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={`Corriger l'achat : ${item.name}`} onClose={onClose}>
      <p>L'article reviendra dans « À acheter ». L'achat annulé reste conservé dans l'historique avec votre nom.</p>
      <label className="field">Motif (facultatif)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Ex. mauvais produit" data-testid="correct-reason" />
      </label>
      <button className="btn btn--primary btn--big" disabled={busy} data-testid="correct-confirm" onClick={async () => {
        setBusy(true);
        if (item.purchase) await engine.correct(item.purchase.id, reason);
        onClose();
      }}>Confirmer la correction</button>
      <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
    </Dialog>
  );
}

function CloseDialog({ engine, remaining, onClose }: { engine: Engine; remaining: number; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Clôturer la liste ?" onClose={onClose}>
      {remaining > 0 ? (
        <p data-testid="close-remaining"><strong>{remaining} article{remaining > 1 ? "s" : ""}</strong> reste{remaining > 1 ? "nt" : ""} à acheter. {remaining > 1 ? "Ils resteront" : "Il restera"} « non acheté{remaining > 1 ? "s" : ""} » dans l'archive et ne seront pas reportés automatiquement.</p>
      ) : (
        <p data-testid="close-remaining">Tous les articles sont achetés.</p>
      )}
      <button className="btn btn--primary btn--big" disabled={busy} data-testid="close-confirm" onClick={async () => { setBusy(true); await engine.closeList(); onClose(); }}>Clôturer la liste</button>
      <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
    </Dialog>
  );
}
