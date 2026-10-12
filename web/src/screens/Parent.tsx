import { useEffect, useMemo, useState } from "react";
import { useBackLayer } from "../useBackLayer";
import { Banners } from "../components/Banners";
import { NotificationInvite } from "../components/NotificationSettings";
import { clearOpenTarget, useOpenTarget } from "../openTarget";
import { api } from "../api";
import { Dialog } from "../components/Dialog";
import { afterLayersClosed, FavoritesSheet } from "../components/Basket";
import { Thumb } from "../components/Thumb";
import { Icon, type IconName } from "../components/Icon";
import { PageHead } from "../components/PageHead";
import { fmtToday, fmtWhen } from "../format";
import { sectionGroups } from "../grouping";
import { fmtQty } from "../units";
import { EstimateTotal, PriceTag } from "../components/PriceTag";
import { listLines, NO_PREFS, priceIndex, priceOfLine, totalOf } from "../priceView";
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
  const [favorites, setFavorites] = useState(false); // kept here: the sheet must survive the creation of the list it fills
  const [archiveId, setArchiveId] = useState<string | null>(null); // a closed list opened from a product's purchase history
  const isAdmin = s.me?.role === "admin";
  // A tap on a notification: open that list (current list → « En cours », closed list → its history). Waits behind the login screen.
  const target = useOpenTarget();
  useEffect(() => {
    if (!target || !s.me) return;
    let live = true;
    api
      .listById(target)
      .then((r) => {
        if (!live) return;
        setEditing(false);
        if (r.list.status === "active") setTab("current");
        else {
          setArchiveId(r.list.id);
          setTab("history");
        }
      })
      .catch(() => void 0) // another family's list or an unknown one: nothing to open
      .finally(() => live && clearOpenTarget());
    return () => {
      live = false;
    };
  }, [target, s.me]);
  const isEditing = editing && s.list?.status === "active";
  useBackLayer(isEditing, () => setEditing(false)); // Back leaves the edit screen
  useBackLayer(!isEditing && tab !== "current", () => setTab("current")); // then goes back to the first tab
  if (editing && s.list?.status === "active") return <StaffScreen engine={engine} s={s} onBack={() => setEditing(false)} />;
  return (
    <div className="parent">
      <div className="parent__body">
        {tab === "current" && <Current engine={engine} s={s} onEdit={() => setEditing(true)} onFavorites={() => setFavorites(true)} />}
        {tab === "history" && <History engine={engine} s={s} categories={s.catalog?.categories ?? []} openId={archiveId} onOpened={() => setArchiveId(null)} onPrepared={() => { setTab("current"); afterLayersClosed(() => setEditing(true)); }} />}
        {tab === "stats" && <Stats engine={engine} s={s} onOpenList={(id, status) => { if (status === "active") setTab("current"); else { setArchiveId(id); setTab("history"); } }} />}
        {tab === "settings" && isAdmin && <Settings engine={engine} s={s} />}
      </div>
      {favorites && <FavoritesSheet engine={engine} s={s} onClose={() => setFavorites(false)} onPrepared={() => setEditing(true)} />}
      <nav className="tabbar" aria-label="Navigation">
        {TABS.filter((t) => t.key !== "settings" || isAdmin).map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} aria-current={tab === t.key ? "page" : undefined} data-testid={`tab-${t.key}`} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={24} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "current", label: "Liste", icon: "list" },
  { key: "history", label: "Historique", icon: "history" },
  { key: "stats", label: "Statistiques", icon: "chart" },
  { key: "settings", label: "Réglages", icon: "settings" },
];

function Current({ engine, s, onEdit, onFavorites }: { engine: Engine; s: State; onEdit(): void; onFavorites(): void }) {
  const [correcting, setCorrecting] = useState<ListItem | null>(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [validations, setValidations] = useState(false);
  const list = s.list;
  const prefs = s.me?.prefs ?? NO_PREFS;
  const prices = useMemo(() => priceIndex(s.catalog), [s.catalog]);

  if (list === undefined) return <><PageHead engine={engine} s={s} title="Les courses du jour" subtitle={fmtToday()} /><p className="empty">Chargement…</p></>;
  const toBuy = (list?.items ?? []).filter((i) => i.status === "to_buy");
  const bought = (list?.items ?? []).filter((i) => i.status === "purchased");
  const total = toBuy.length + bought.length;
  const pct = total ? Math.round((bought.length / total) * 100) : 0;
  const allBought = total > 0 && toBuy.length === 0;
  const pendingEdits = Object.keys(s.toggles).length;

  // No list yet, or a list with nothing in it: one short sentence. The list is only created when « Ajouter / modifier » is used.
  if (!list || total === 0) {
    return (
      <>
        <PageHead engine={engine} s={s} title="Les courses du jour" subtitle={fmtToday()} />
        <Banners engine={engine} s={s} />
        {s.me && <NotificationInvite />}
        {s.conn === "offline" && <p className="banner banner--offline limit" data-testid="offline-limit">Hors connexion : les achats et corrections ne peuvent pas être enregistrés tant que la connexion est coupée.</p>}
        <div className="nolist__body" data-testid="no-list">
          <img className="nolist__logo" src="/icons/icon-192.png" alt="" width="96" height="96" />
          <p className="nolist__text" data-testid="empty-text">Préparez votre liste de courses.</p>
          <button className="btn btn--primary btn--big" data-testid="edit-list" disabled={busy === "create"} onClick={async () => {
            if (!list) {
              setBusy("create");
              await engine.createList();
              setBusy(null);
              if (engine.getState().list?.status !== "active") return;
            }
            onEdit();
          }}>
            <Icon name="plus" size={22} /> Ajouter / modifier{pendingEdits ? ` (${pendingEdits})` : ""}
          </button>
          <button className="btn" data-testid="open-favorites" onClick={onFavorites}><Icon name="star" size={20} /> Favoris</button>
        </div>
      </>
    );
  }

  // Presentation only: the same lines, grouped by category (catalogue order). The list itself is never changed.
  const cats = s.catalog?.categories ?? [];
  const toBuyGroups = sectionGroups(list, "to_buy", cats);
  const boughtGroups = sectionGroups(list, "purchased", cats);
  const detailItem = detail ? list.items.find((i) => i.id === detail) : undefined;

  const validationsBtn = (list.validations?.length ?? 0) > 0 ? (
    <button className="btn btn--ghost btn--small" data-testid="open-validations" aria-label={`Historique des validations (${list.validations!.length})`} onClick={() => setValidations(true)}>
      <Icon name="history" size={20} /> Validations ({list.validations!.length})
    </button>
  ) : null;

  const buy = async (id: string) => {
    setBusy(id);
    await engine.purchase(id);
    setBusy(null);
  };

  return (
    <>
      <PageHead engine={engine} s={s} title="Les courses du jour" subtitle={fmtToday()} />
      <Banners engine={engine} s={s} />
      {s.me && <NotificationInvite />}
      {s.conn === "offline" && <p className="banner banner--offline limit" data-testid="offline-limit">Hors connexion : les achats et corrections ne peuvent pas être enregistrés tant que la connexion est coupée.</p>}
      <section className="progresscard" aria-label="Progression" data-testid="progress">
        <div className="progresscard__line">
          <strong data-testid="progress-text">{`${bought.length} produit${bought.length > 1 ? "s" : ""} sur ${total} acheté${bought.length > 1 ? "s" : ""}`}</strong>
          <span>{pct} %</span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Produits achetés"><i style={{ width: `${pct}%` }} /></div>
      </section>
      {prefs.showTotals && <EstimateTotal summary={totalOf(listLines(list, prices))} />}
      <div className="actions">
        <button className="btn btn--primary" data-testid="edit-list" onClick={onEdit}>
          <Icon name="plus" size={22} /> Ajouter / modifier{pendingEdits ? ` (${pendingEdits})` : ""}
        </button>
        <button className="btn" data-testid="open-favorites" onClick={onFavorites}>
          <Icon name="star" size={20} /> Favoris
        </button>
        <button className="btn" data-testid="close-list" onClick={() => setClosing(true)}>
          <Icon name="check" size={20} /> Clôturer
        </button>
      </div>

      {allBought && (
        <p className="banner banner--notice" role="status" data-testid="all-bought">
          Tous les articles sont achetés
          {validationsBtn}
        </p>
      )}
      {toBuy.length > 0 && <section aria-labelledby="h-tobuy">
        <div className="sectionhead">
          <h2 id="h-tobuy">À acheter <span className="count-pill" data-testid="count-tobuy">{toBuy.length}</span></h2>
          {validationsBtn}
        </div>
        <GroupedRows
          groups={toBuyGroups}
          testid="to-buy"
          row={(i) => (
            <li key={i.id} className="row" data-testid={`row-${i.productId}`}>
              <Thumb photoUrl={i.photoUrl} category={i.category} />
              <button className="row__main" data-testid={`detail-${i.productId}`} aria-label={`Détail des modifications de ${i.name}`} onClick={() => setDetail(i.id)}>
                <b>{i.name}</b>
                <span className="rowqty" data-testid={`qty-${i.productId}`}>{fmtQty(i.quantity, i.unit)}</span>
                {(i.brand || !i.productActive) && <small>{[i.brand, i.productActive ? null : "désactivé"].filter(Boolean).join(" · ")}</small>}
                <PriceTag price={priceOfLine(i, i.productId, prices, true)} qty={i.quantity} unit={i.unit} prefs={prefs} testid={`price-${i.productId}`} showMissing />
                <RowMeta item={i} />
              </button>
              <button className="btn btn--primary buybtn" data-testid={`buy-${i.productId}`} disabled={busy === i.id} aria-label={`Marquer ${i.name} comme acheté`} onClick={() => void buy(i.id)}>
                <Icon name="check" size={20} /> Acheté
              </button>
            </li>
          )}
        />
      </section>}

      {bought.length > 0 && <section aria-labelledby="h-bought">
        <div className="sectionhead">
          <h2 id="h-bought">Déjà achetés <span className="count-pill" data-testid="count-bought">{bought.length}</span></h2>
        </div>
        <GroupedRows
          groups={boughtGroups}
          testid="bought"
          row={(i) => (
            <li key={i.id} className="row row--bought" data-testid={`row-${i.productId}`}>
              <Thumb photoUrl={i.photoUrl} category={i.category} />
              <button className="row__main" data-testid={`detail-${i.productId}`} aria-label={`Détail de ${i.name}`} onClick={() => setDetail(i.id)}>
                <b>{i.name}</b>
                <span className="rowqty" data-testid={`boughtqty-${i.productId}`}>{fmtQty(i.purchase?.quantity ?? i.quantity, i.purchase?.unit ?? i.unit)}</span>
                <PriceTag price={priceOfLine(i, i.productId, prices, true)} qty={i.purchase?.quantity ?? i.quantity} unit={i.purchase?.unit ?? i.unit} prefs={prefs} testid={`price-${i.productId}`} showMissing />
                <small data-testid={`by-${i.productId}`}>Acheté par {i.purchase?.by.displayName} · {i.purchase ? fmtWhen(i.purchase.at) : ""}</small>
              </button>
              <button className="btn btn--small" data-testid={`correct-${i.productId}`} aria-label={`Corriger l'achat de ${i.name}`} onClick={() => setCorrecting(i)}>
                <Icon name="undo" size={18} /> Corriger
              </button>
            </li>
          )}
        />
      </section>}

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
      <p>L'article reviendra dans « À acheter » et cet achat ne comptera plus.</p>
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
