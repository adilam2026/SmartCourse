import { useState } from "react";
import { api, ApiError } from "../api";
import { userMessage } from "../errors";
import { fmtPrice, REF_UNITS, type RefUnit } from "../pricing";
import type { Product } from "../types";
import { CityPrompt } from "./CityPicker";
import { priceNature } from "../priceNature";
import { Dialog } from "./Dialog";

const REF_LABEL: Record<RefUnit, string> = { kg: "kg", g: "g", litre: "litre", ml: "ml", piece: "pièce", paquet: "paquet", bouteille: "bouteille", brique: "brique", pot: "pot", boite: "boîte" };
const COUNTED = new Set<RefUnit>(["piece", "paquet", "bouteille", "brique", "pot", "boite"]);
/** Un conditionnement compte : sans son contenu (500 g, 1 L…), « paquet » ne dit pas ce que coûte un kilo. */
const NEEDS_PACKAGING = new Set<RefUnit>(["paquet", "bouteille", "brique", "pot", "boite"]);

/** « 1 kg », « paquet de 500 g » : la référence du prix en quelques mots. */
export function refText(ref: { refQty: string; refUnit: RefUnit; packaging: string | null }): string {
  const t = fmtPrice({ amount: "0", ...ref }).split(" / ").slice(1).join(" / ");
  return /^[a-zéè]+$/i.test(t) && !COUNTED.has(ref.refUnit) && Number(ref.refQty.replace(",", ".")) === 1 ? `1 ${t}` : t;
}

const initialRef = (product: Product): { refQty: string; refUnit: RefUnit; packaging: string } => {
  const p = product.price;
  return p ? { refQty: p.refQty.replace(".", ","), refUnit: p.refUnit, packaging: p.packaging ?? "" } : { refQty: "1", refUnit: product.unit as RefUnit, packaging: "" };
};

/**
 * Petite fenêtre « Mettre à jour le prix » : un seul champ, « Prix (DH) », pour la référence déjà connue (« Tomates · 1 kg »).
 * On ne demande que ce qui manque ; « Modifier le format » change la référence (autre conditionnement).
 */
export function PriceDialog({ product, onClose, onChanged }: { product: Product; onClose(): void; onChanged(): void }) {
  const p = product.price ?? null;
  const [amount, setAmount] = useState(p ? p.amount.replace(".", ",") : "");
  const [ref, setRef] = useState(initialRef(product));
  const [format, setFormat] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [why, setWhy] = useState(false);
  const nature = priceNature(p);
  const missing = NEEDS_PACKAGING.has(ref.refUnit) && !ref.packaging.trim();
  const askPackaging = missing || format;
  const known = { refQty: ref.refQty, refUnit: ref.refUnit, packaging: COUNTED.has(ref.refUnit) ? ref.packaging.trim() || null : null };
  const run = async (fn: () => Promise<unknown>, ok: string, close: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      onChanged();
      if (close) onClose(); else setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: userMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Mettre à jour le prix" onClose={onClose} dismissable={!busy}>
      <form className="form form--compact" data-testid="price-dialog" onSubmit={(e) => {
        e.preventDefault();
        void run(() => api.setPrice(product.id, { amount: amount.trim(), refQty: ref.refQty.trim(), refUnit: ref.refUnit, packaging: known.packaging, pieceWeightG: p?.pieceWeightG ?? null }), "", true);
      }}>
        <p data-testid="price-ref"><b>{product.name}</b> · {refText(known)}</p>
        {nature && (
          <p className="pricenature" data-testid="price-nature-line">
            {nature.chip && <span className={`naturechip naturechip--${nature.chip === "observé" ? "obs" : "est"}`} data-testid="price-nature">{nature.chip}</span>}
            <button type="button" className="linkbtn linkbtn--inline" aria-expanded={why} data-testid="price-nature-more" onClick={() => setWhy((v) => !v)}>{why ? "Masquer" : "D'où vient ce prix ?"}</button>
            {why && <span className="pricenature__detail" data-testid="price-nature-detail">{nature.detail}</span>}
          </p>
        )}
        <label className="field">Prix (DH)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="9,90" autoFocus data-testid="price-amount" /></label>
        {askPackaging && !format && <label className="field">Contenu (ex. 500 g)<input value={ref.packaging} onChange={(e) => setRef({ ...ref, packaging: e.target.value })} maxLength={60} placeholder="500 g, 1 L…" data-testid="price-packaging" /></label>}
        {format && (
          <fieldset className="formatbox" data-testid="price-format">
            <label className="field">Pour quelle quantité ?<input inputMode="decimal" value={ref.refQty} onChange={(e) => setRef({ ...ref, refQty: e.target.value })} data-testid="price-refqty" /></label>
            <label className="field">Unité
              <select value={ref.refUnit} onChange={(e) => setRef({ ...ref, refUnit: e.target.value as RefUnit })} data-testid="price-refunit">
                {REF_UNITS.map((u) => <option key={u} value={u}>{REF_LABEL[u]}</option>)}
              </select>
            </label>
            {COUNTED.has(ref.refUnit) && <label className="field">Contenu (ex. 500 g)<input value={ref.packaging} onChange={(e) => setRef({ ...ref, packaging: e.target.value })} maxLength={60} data-testid="price-packaging" /></label>}
          </fieldset>
        )}
        {msg && <p className={msg.ok ? "notice" : "error"} role={msg.ok ? "status" : "alert"} data-testid="price-msg">{msg.text}</p>}
        <button className="btn btn--primary btn--big" disabled={busy || !amount.trim() || missing} aria-busy={busy} data-testid="price-save">Enregistrer</button>
        <div className="minilinks">
          {!format && <button type="button" className="linkbtn" data-testid="price-format-open" onClick={() => setFormat(true)}>Modifier le format</button>}
          {p && p.source !== "base" && <button type="button" className="linkbtn" disabled={busy} data-testid="price-reset" onClick={() => void run(() => api.resetPrice(product.id), "Prix initial rétabli.", true)}>Rétablir le prix initial</button>}
          {p?.source === "family" && <button type="button" className="linkbtn" data-testid="price-share" onClick={() => setSharing(true)}>Partager ce prix</button>}
        </div>
      </form>
      {sharing && <ShareDialog product={product} onClose={() => setSharing(false)} onShared={() => { setSharing(false); setMsg({ ok: true, text: "Merci : ce prix est partagé." }); }} />}
    </Dialog>
  );
}

/** « Partager ce prix » : volontaire. Seuls le produit, le prix avec son format, la date et votre ville sont envoyés — jamais votre nom, e-mail, code famille ni historique. */
function ShareDialog({ product, onClose, onShared }: { product: Product; onClose(): void; onShared(): void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needCity, setNeedCity] = useState(false);
  const p = product.price!;
  if (needCity) return <CityPrompt onDone={() => setNeedCity(false)} onClose={onClose} />;
  return (
    <Dialog title="Partager ce prix" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.sharePrice({ productId: product.id, observedOn: date });
          onShared();
        } catch (err) {
          if (err instanceof ApiError && err.code === "city_required") setNeedCity(true);
          else setError(userMessage(err));
          setBusy(false);
        }
      }}>
        <p data-testid="share-summary"><b>{product.name}</b> : {fmtPrice(p)}</p>
        <p className="muted">Partagé : le produit, ce prix, la date et votre ville. Jamais votre nom, votre e-mail ni le code famille.</p>
        <label className="field">Date du prix<input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} required data-testid="share-date" /></label>
        {error && <p className="error" role="alert" data-testid="share-error">{error}</p>}
        <button className="btn btn--primary btn--big" disabled={busy} data-testid="share-confirm">{busy ? "Envoi…" : "Partager ce prix"}</button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
      </form>
    </Dialog>
  );
}
