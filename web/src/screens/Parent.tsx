import { useState } from "react";
import { Banners } from "../components/Banners";
import { Dialog } from "../components/Dialog";
import { Thumb } from "../components/Thumb";
import { UserSheet } from "../components/UserSheet";
import { fmtDateTime } from "../format";
import type { Engine, State } from "../sync/engine";
import type { ListItem } from "../types";
import { StaffScreen } from "./Staff";
import { History } from "./History";
import { Settings } from "./Settings";

type Tab = "current" | "history" | "settings";

export function ParentApp({ engine, s }: { engine: Engine; s: State }) {
  const [tab, setTab] = useState<Tab>("current");
  const [editing, setEditing] = useState(false);
  const isAdmin = s.me?.role === "admin";
  if (editing && s.list?.status === "active") return <StaffScreen engine={engine} s={s} onBack={() => setEditing(false)} />;
  return (
    <div className="parent">
      <div className="parent__body">
        {tab === "current" && <Current engine={engine} s={s} onEdit={() => setEditing(true)} />}
        {tab === "history" && <History />}
        {tab === "settings" && isAdmin && <Settings engine={engine} s={s} />}
      </div>
      <nav className="tabbar" aria-label="Navigation">
        <button className={tab === "current" ? "on" : ""} aria-current={tab === "current"} data-testid="tab-current" onClick={() => setTab("current")}>🛒<span>En cours</span></button>
        <button className={tab === "history" ? "on" : ""} aria-current={tab === "history"} data-testid="tab-history" onClick={() => setTab("history")}>🗂️<span>Historique</span></button>
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

      <section aria-labelledby="h-tobuy">
        <h2 id="h-tobuy" className="sect">À acheter <span className="count-pill" data-testid="count-tobuy">{toBuy.length}</span></h2>
        {toBuy.length === 0 && <p className="empty">Rien à acheter pour le moment.</p>}
        <ul className="rows" data-testid="to-buy">
          {toBuy.map((i) => (
            <li key={i.id} className="row" data-testid={`row-${i.productId}`}>
              <Thumb photoUrl={i.photoUrl} category={i.category} />
              <span className="row__name">{i.name}{i.brand && <small>{i.brand}</small>}{!i.productActive && <small>désactivé</small>}</span>
              <button className="btn btn--primary" data-testid={`buy-${i.productId}`} disabled={busy === i.id} onClick={() => void buy(i.id)}>Acheté</button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="h-bought">
        <h2 id="h-bought" className="sect">Déjà achetés <span className="count-pill" data-testid="count-bought">{bought.length}</span></h2>
        <ul className="rows" data-testid="bought">
          {bought.map((i) => (
            <li key={i.id} className="row row--bought" data-testid={`row-${i.productId}`}>
              <Thumb photoUrl={i.photoUrl} category={i.category} />
              <span className="row__name">
                {i.name}
                <small data-testid={`by-${i.productId}`}>Acheté par {i.purchase?.by.displayName} · {i.purchase ? fmtDateTime(i.purchase.at) : ""}</small>
              </span>
              <button className="btn btn--ghost" data-testid={`correct-${i.productId}`} onClick={() => setCorrecting(i)}>Corriger</button>
            </li>
          ))}
        </ul>
      </section>

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
