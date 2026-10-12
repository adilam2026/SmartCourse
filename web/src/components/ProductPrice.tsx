import { useState } from "react";
import { api } from "../api";
import { userMessage } from "../errors";
import { fmtPrice, REF_UNITS, type RefUnit } from "../pricing";
import { UNIT_CHOICE } from "../units";
import type { Product } from "../types";
import { Dialog } from "./Dialog";

const REF_LABEL: Record<RefUnit, string> = { kg: "kg", g: "g", litre: "litre", ml: "ml", piece: "pièce", paquet: "paquet", bouteille: "bouteille", brique: "brique", pot: "pot", boite: "boîte" };
const COUNTED = new Set<RefUnit>(["piece", "paquet", "bouteille", "brique", "pot", "boite"]);

const sourceText = (p: NonNullable<Product["price"]>): string =>
  p.source === "base"
    ? `Prix initial${p.basis ? ` (${p.basis.kind === "observed" ? "observé" : p.basis.kind === "average" ? "prix moyen" : "prix arrondi"} le ${p.basis.observedOn.split("-").reverse().join("/")})` : ""}`
    : p.source === "community"
      ? "Prix communautaire que vous avez appliqué"
      : "Prix de votre famille";

/**
 * Prix d'un article, propre à la famille (administrateur). Le prix initial ne remplace jamais un prix personnalisé ;
 * les commandes archivées gardent leur prix. Un prix modifié peut être partagé à la communauté (explicitement).
 */
export function ProductPrice({ product, onChanged }: { product: Product; onChanged(): void }) {
  const p = product.price ?? null;
  const [amount, setAmount] = useState(p ? p.amount.replace(".", ",") : "");
  const [refQty, setRefQty] = useState(p ? p.refQty.replace(".", ",") : "1");
  const [refUnit, setRefUnit] = useState<RefUnit>(p?.refUnit ?? (product.unit as RefUnit));
  const [packaging, setPackaging] = useState(p?.packaging ?? "");
  const [weight, setWeight] = useState(p?.pieceWeightG ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: userMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" aria-label="Prix indicatif" data-testid="product-price">
      <h3>Prix indicatif (en dirhams, propre à votre famille)</h3>
      {p ? <p data-testid="price-current"><b>{fmtPrice(p)}</b><br /><small className="muted">{sourceText(p)}</small></p> : <p className="muted" data-testid="price-none">Aucun prix enregistré : « Prix à compléter » s'affiche quand les prix sont activés.</p>}
      <div className="form">
        <label className="field">Montant (DH)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="9,90" data-testid="price-amount" /></label>
        <label className="field">Pour quelle quantité ?<input inputMode="decimal" value={refQty} onChange={(e) => setRefQty(e.target.value)} data-testid="price-refqty" /></label>
        <label className="field">Unité de référence
          <select value={refUnit} onChange={(e) => setRefUnit(e.target.value as RefUnit)} data-testid="price-refunit">
            {REF_UNITS.map((u) => <option key={u} value={u}>{REF_LABEL[u]}</option>)}
          </select>
        </label>
        {COUNTED.has(refUnit) && <label className="field">Contenu de référence (conditionnement)<input value={packaging} onChange={(e) => setPackaging(e.target.value)} maxLength={60} placeholder="250 g, 1 L…" data-testid="price-packaging" /></label>}
        {(refUnit === "kg" || refUnit === "g" || refUnit === "piece") && <label className="field">Poids d'une pièce, en grammes (facultatif, pour convertir pièces et kilos)<input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} data-testid="price-weight" /></label>}
        <p className="muted"><small>Le prix s'applique aux quantités en {UNIT_CHOICE[product.unit]} de ce produit quand l'unité de référence est compatible ; sinon « Prix à compléter ».</small></p>
        {msg && <p className={msg.ok ? "notice" : "error"} role={msg.ok ? "status" : "alert"} data-testid="price-msg">{msg.text}</p>}
        <button className="btn btn--primary" disabled={busy || !amount.trim()} data-testid="price-save" onClick={() => void run(() => api.setPrice(product.id, { amount: amount.trim(), refQty: refQty.trim(), refUnit, packaging: COUNTED.has(refUnit) ? packaging.trim() || null : null, pieceWeightG: weight.trim() || null }), "Prix enregistré pour votre famille.")}>Enregistrer le prix</button>
        {p?.source !== "base" && p && <button className="btn btn--ghost" disabled={busy} data-testid="price-reset" onClick={() => void run(() => api.resetPrice(product.id), "Prix initial rétabli.")}>Rétablir le prix initial</button>}
        {p?.source === "family" && <button className="btn" disabled={busy} data-testid="price-share" onClick={() => setSharing(true)}>Partager ce prix</button>}
      </div>
      {sharing && <ShareDialog product={product} onClose={() => setSharing(false)} onShared={() => { setSharing(false); setMsg({ ok: true, text: "Merci : ce prix est partagé." }); }} />}
    </section>
  );
}

/** « Partager ce prix » : unité, conditionnement et date ; ville et magasin facultatifs. Aucun nom, e-mail, code famille ni historique n'est envoyé. */
function ShareDialog({ product, onClose, onShared }: { product: Product; onClose(): void; onShared(): void }) {
  const [city, setCity] = useState("");
  const [store, setStore] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = product.price!;
  return (
    <Dialog title="Partager ce prix" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.sharePrice({ productId: product.id, observedOn: date, ...(city.trim() ? { city: city.trim() } : {}), ...(store.trim() ? { store: store.trim() } : {}) });
          onShared();
        } catch (err) {
          setError(userMessage(err));
          setBusy(false);
        }
      }}>
        <p data-testid="share-summary"><b>{product.name}</b> : {fmtPrice(p)}</p>
        <p className="muted">Sont partagés : le produit, ce prix avec son unité ou son conditionnement, la date et, si vous les renseignez, la ville et le magasin. <b>Jamais</b> : votre nom, votre e-mail, le code famille ni votre historique de courses.</p>
        <label className="field">Date du prix<input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} required data-testid="share-date" /></label>
        <label className="field">Ville (facultatif)<input value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} data-testid="share-city" /></label>
        <label className="field">Magasin (facultatif)<input value={store} onChange={(e) => setStore(e.target.value)} maxLength={60} data-testid="share-store" /></label>
        {error && <p className="error" role="alert" data-testid="share-error">{error}</p>}
        <button className="btn btn--primary btn--big" disabled={busy} data-testid="share-confirm">{busy ? "Envoi…" : "Partager ce prix"}</button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
      </form>
    </Dialog>
  );
}
