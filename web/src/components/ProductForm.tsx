import { useEffect, useRef, useState } from "react";
import { api, ApiError, NetworkError } from "../api";
import { userMessage } from "../errors";
import { CATEGORY_EMOJI } from "../categories";
import { prepareImage } from "../image";
import type { Product, Unit } from "../types";
import { UNIT_CHOICE, UNITS } from "../units";
import { Dialog } from "./Dialog";

interface Props {
  /** Absent = « Ajouter un article ». */
  product?: Product;
  categories: { key: string; label: string }[];
  onClose(): void;
  onSaved(): void;
}

const errText = (e: unknown): string => (e instanceof NetworkError ? "Pas de connexion : l'enregistrement d'un article demande le réseau. Réessayez quand il est revenu." : userMessage(e));

/** « Ajouter un article » / « Modifier un article » (administrateur). L'image est vue avant l'enregistrement. */
export function ProductForm({ product, categories, onClose, onSaved }: Props) {
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? categories[0]?.key ?? "");
  const [active, setActive] = useState(product?.active ?? true);
  const [unit, setUnit] = useState<Unit>(product?.unit ?? "piece");
  const [image, setImage] = useState<{ base64: string; previewUrl: string } | null>(null);
  const [reset, setReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false); // un deuxième appui avant le rendu suivant ne doit pas envoyer deux fois
  const dirty = !!image || reset || name !== (product?.name ?? "") || category !== (product?.category ?? categories[0]?.key ?? "") || active !== (product?.active ?? true) || unit !== (product?.unit ?? "piece");
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.previewUrl); }, [image]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      setImage(await prepareImage(f));
      setReset(false);
    } catch {
      setError("Fichier image illisible.");
    }
  };

  const shown = image?.previewUrl ?? (reset ? null : product?.photoUrl ?? null);
  const title = product ? "Modifier un article" : "Ajouter un article";

  return (
    <Dialog title={title} key={product?.id ?? "new"} onClose={onClose} dismissable={!busy && !dirty}>
      <button type="button" className="sheet__close" aria-label="Fermer" data-testid="pf-close" onClick={onClose}>✕</button>
      <form className="form" data-testid="product-form" onSubmit={async (e) => {
        e.preventDefault();
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError(null);
        try {
          if (product) await api.patchProduct(product.id, { name: name.trim(), category, active, unit, ...(image ? { image: image.base64 } : reset ? { resetImage: true } : {}) });
          else await api.createProduct({ name: name.trim(), category, active, unit, ...(image ? { image: image.base64 } : {}) });
          onSaved();
        } catch (err) {
          setError(errText(err));
        } finally {
          inFlight.current = false;
          setBusy(false);
        }
      }}>
        <div className="preview" data-testid="image-preview">
          {shown ? <img src={shown} alt="Aperçu de l'image" data-testid="preview-img" /> : <span className="preview__empty">{CATEGORY_EMOJI[category] ?? "🛒"}<small>Pas d'image</small></span>}
        </div>
        <div className="pick">
          <label className="btn btn--small">🖼️ Galerie
            <input type="file" accept="image/*" hidden data-testid="pick-gallery" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <label className="btn btn--small">📷 Prendre une photo
            <input type="file" accept="image/*" capture="environment" hidden data-testid="pick-camera" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {product && (image || !reset) && <button type="button" className="btn btn--small btn--ghost" data-testid="reset-image" onClick={() => { setImage(null); setReset(true); }}>Image d'origine</button>}
        </div>
        <label className="field">Nom de l'article<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} data-testid="pf-name" /></label>
        <label className="field">Catégorie
          <select value={category} onChange={(e) => setCategory(e.target.value)} data-testid="pf-category">
            {categories.map((c) => <option key={c.key} value={c.key}>{CATEGORY_EMOJI[c.key]} {c.label}</option>)}
          </select>
        </label>
        <label className="field">Unité de la quantité
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} data-testid="pf-unit">
            {UNITS.map((u) => <option key={u} value={u}>{UNIT_CHOICE[u]}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} data-testid="pf-active" /> Article affiché</label>
        {error && <p className="error" role="alert" data-testid="pf-error">{error}</p>}
        <div className="form__actions">
          <button className="btn btn--primary btn--big" disabled={busy || !name.trim()} aria-busy={busy} data-testid="pf-save">{busy ? "Enregistrement…" : "Enregistrer"}</button>
          <button type="button" className="btn btn--ghost" disabled={busy} data-testid="pf-cancel" onClick={onClose}>Annuler</button>
        </div>
      </form>
    </Dialog>
  );
}
