import { useEffect, useMemo, useState } from "react";
import { api, type Template } from "../api";
import { userMessage } from "../errors";
import { fmtQty } from "../units";
import type { Engine, State } from "../sync/engine";
import type { BasketItem, BasketMode } from "../sync/logic";
import { backStack } from "../back";
import { Dialog } from "./Dialog";

/** Runs `fn` after the dialogs that were just closed have really left the browser history (see back.ts). */
export const afterLayersClosed = (fn: () => void): void => void setTimeout(() => void (backStack?.settled() ?? Promise.resolve()).then(fn), 60);
import { QtyCounter } from "./QtyCounter";
import type { Product, Unit } from "../types";

/**
 * Prépare une liste modifiable à partir d'un favori ou d'une ancienne commande. Sans liste en cours : elle est ouverte puis remplie.
 * Avec une liste en cours : « Ajouter à la liste actuelle » ou « Remplacer son contenu » (avec confirmation). Rien n'est enregistré avant « Valider ».
 */
export function BasketChoice({ engine, s, items, title, onClose, onDone }: { engine: Engine; s: State; items: BasketItem[]; title: string; onClose(): void; onDone(): void }) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = s.list;
  const open = list?.status === "active" ? list : null;
  const run = async (mode: BasketMode) => {
    setBusy(true);
    const r = await engine.applyBasket(items, mode, title);
    setBusy(false);
    if (r) onDone();
    else onClose();
  };
  // No current list: nothing to choose, the new list is prepared straight away.
  useEffect(() => {
    if (!open && list !== undefined) void run("add");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!open) return null;
  const toBuy = open.items.filter((i) => i.status === "to_buy").length;
  return (
    <Dialog title={title} onClose={onClose}>
      {!confirmReplace ? (
        <div className="form" data-testid="basket-choice">
          <p>Une liste est déjà en cours ({toBuy} article{toBuy > 1 ? "s" : ""} à acheter). Que faire de ces {items.length} produit{items.length > 1 ? "s" : ""} ?</p>
          <button className="btn btn--primary btn--big" disabled={busy} data-testid="basket-add" onClick={() => void run("add")}>Ajouter à la liste actuelle</button>
          <button className="btn btn--big" disabled={busy} data-testid="basket-replace" onClick={() => setConfirmReplace(true)}>Remplacer son contenu</button>
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
        </div>
      ) : (
        <div className="form" data-testid="basket-confirm">
          <p><b>Remplacer le contenu de la liste actuelle ?</b></p>
          <p className="muted">Les {toBuy} article{toBuy > 1 ? "s" : ""} encore à acheter qui ne sont pas dans « {title} » seront retirés de la liste, et les quantités communes seront remplacées. Les articles déjà achetés restent. Rien n'est enregistré avant que vous touchiez « Valider ».</p>
          <button className="btn btn--danger btn--big" disabled={busy} data-testid="basket-replace-confirm" onClick={() => void run("replace")}>Oui, remplacer le contenu</button>
          <button className="btn btn--ghost" onClick={() => setConfirmReplace(false)}>Non, revenir</button>
        </div>
      )}
    </Dialog>
  );
}

const itemsOf = (t: Template): BasketItem[] => t.items.map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity, unit: i.unit }));

/** « Favoris » : modèles de la famille. Tous les parents les utilisent ; les administrateurs les créent, nomment, modifient et suppriment. */
export function FavoritesSheet({ engine, s, onClose, onPrepared }: { engine: Engine; s: State; onClose(): void; onPrepared(): void }) {
  const isAdmin = s.me?.role === "admin";
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [using, setUsing] = useState<Template | null>(null);
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const load = () => api.templates().then((r) => setTemplates(r.templates)).catch((e) => setError(userMessage(e)));
  useEffect(() => void load(), []);
  const list = s.list?.status === "active" ? s.list : null;
  const hasLines = !!list && list.items.some((i) => i.status === "to_buy" || i.status === "purchased");
  return (
    <Dialog title="Favoris" onClose={onClose}>
      <div className="form" data-testid="favorites">
        {error && <p className="error" role="alert" data-testid="favorites-error">{error}</p>}
        {templates?.length === 0 && <p className="muted" data-testid="favorites-empty">Aucun favori pour le moment.{isAdmin ? " Créez-en un, ou enregistrez la liste en cours." : " Un administrateur peut en créer."}</p>}
        <ul className="rows rows--tight">
          {templates?.map((t) => (
            <li key={t.id} className="row row--stack row--compact" data-testid={`favorite-${t.name}`}>
              <span className="row__name">
                <span className="row__title">{t.name}</span>
                <small>{t.items.length} produit{t.items.length > 1 ? "s" : ""}{t.items.some((i) => !i.productActive) ? " · certains masqués" : ""}</small>
              </span>
              <span className="row__actions">
                <button className="btn btn--small btn--primary" data-testid={`use-${t.name}`} onClick={() => setUsing(t)}>Utiliser cette liste</button>
                {isAdmin && <button className="btn btn--small" data-testid={`edit-favorite-${t.name}`} onClick={() => setEditing(t)}>Modifier</button>}
                {isAdmin && <button className="btn btn--small btn--ghost" data-testid={`delete-favorite-${t.name}`} onClick={() => setDeleting(t)}>Supprimer</button>}
              </span>
            </li>
          ))}
        </ul>
        {isAdmin && <button className="btn" data-testid="favorite-new" onClick={() => setEditing("new")}>+ Créer un favori</button>}
        {isAdmin && hasLines && <SaveCurrent list={list!.id} onSaved={() => void load()} />}
        <button className="btn btn--ghost" onClick={onClose}>Fermer</button>
      </div>
      {using && <BasketChoice engine={engine} s={s} items={itemsOf(using)} title={using.name} onClose={() => setUsing(null)} onDone={() => { setUsing(null); onClose(); afterLayersClosed(onPrepared); }} />}
      {editing && <TemplateEditor s={s} template={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {deleting && (
        <Dialog title="Supprimer ce favori ?" onClose={() => setDeleting(null)}>
          <p>Le favori « {deleting.name} » sera supprimé. Les listes déjà préparées avec lui ne changent pas.</p>
          <button className="btn btn--danger btn--big" data-testid="favorite-delete-confirm" onClick={async () => { try { await api.deleteTemplate(deleting.id); setDeleting(null); void load(); } catch (e) { setError(userMessage(e)); setDeleting(null); } }}>Supprimer</button>
          <button className="btn btn--ghost" onClick={() => setDeleting(null)}>Annuler</button>
        </Dialog>
      )}
    </Dialog>
  );
}

function SaveCurrent({ list, onSaved }: { list: string; onSaved(): void }) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      try { await api.createTemplate({ name, fromListId: list }); setName(""); setMsg("Favori enregistré."); onSaved(); } catch (err) { setMsg(userMessage(err)); }
    }}>
      <label className="field">Enregistrer la liste en cours comme favori
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Nom du favori" data-testid="favorite-from-list-name" />
      </label>
      <button className="btn" disabled={!name.trim()} data-testid="favorite-from-list">Enregistrer la liste en cours</button>
      {msg && <p className="muted" role="status">{msg}</p>}
    </form>
  );
}

interface Row {
  productId: string;
  name: string;
  unit: Unit;
  quantity: number;
}

function TemplateEditor({ s, template, onClose, onSaved }: { s: State; template: Template | null; onClose(): void; onSaved(): void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [rows, setRows] = useState<Row[]>(template?.items.map((i) => ({ productId: i.productId, name: i.name, unit: i.unit, quantity: i.quantity })) ?? []);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const products: Product[] = useMemo(() => (s.catalog?.categories ?? []).flatMap((c) => c.products), [s.catalog]);
  const flat = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const found = q.trim() ? products.filter((p) => flat(p.name).includes(flat(q)) && !rows.some((r) => r.productId === p.id)).slice(0, 6) : [];
  return (
    <Dialog title={template ? "Modifier le favori" : "Nouveau favori"} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const items = rows.map((r) => ({ productId: r.productId, quantity: r.quantity }));
        try {
          if (template) await api.updateTemplate(template.id, { name, items });
          else await api.createTemplate({ name, items });
          onSaved();
        } catch (err) {
          setError(userMessage(err));
          setBusy(false);
        }
      }}>
        <label className="field">Nom<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} data-testid="favorite-name" /></label>
        <ul className="rows rows--tight" data-testid="favorite-rows">
          {rows.map((r) => (
            <li key={r.productId} className="row row--compact row--stack" data-testid={`favrow-${r.productId}`}>
              <span className="row__name"><span className="row__title">{r.name}</span><small>{fmtQty(r.quantity, r.unit)}</small></span>
              <QtyCounter productId={r.productId} name={r.name} unit={r.unit} qty={r.quantity} onChange={(_, v) => setRows(rows.map((x) => (x.productId === r.productId ? { ...x, quantity: v } : x)))} />
              <button type="button" className="btn btn--small btn--ghost" aria-label={`Retirer ${r.name}`} onClick={() => setRows(rows.filter((x) => x.productId !== r.productId))}>Retirer</button>
            </li>
          ))}
        </ul>
        <label className="field">Ajouter un produit<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher…" data-testid="favorite-search" /></label>
        {found.map((p) => (
          <button type="button" key={p.id} className="btn" data-testid={`favorite-pick-${p.id}`} onClick={() => { setRows([...rows, { productId: p.id, name: p.name, unit: p.unit, quantity: 1 }]); setQ(""); }}>+ {p.name}</button>
        ))}
        {error && <p className="error" role="alert" data-testid="favorite-error">{error}</p>}
        <button className="btn btn--primary btn--big" disabled={busy || !name.trim() || rows.length === 0} data-testid="favorite-save">{busy ? "Enregistrement…" : "Enregistrer le favori"}</button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
      </form>
    </Dialog>
  );
}
