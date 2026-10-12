import { useId, useState } from "react";
import { api } from "../api";
import { canonicalCity, CITIES, flatCity } from "../cities";
import { userMessage } from "../errors";
import { Dialog } from "./Dialog";

/**
 * Choix de la ville dans la liste des villes du Maroc, avec recherche (sans accent ni majuscule).
 * `value` ne contient qu'une ville de la liste, ou « » tant qu'aucune n'est choisie.
 */
export function CityPicker({ value, onChange, testid = "city", label = "Ville" }: { value: string; onChange(city: string): void; testid?: string; label?: string }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const id = useId();
  const needle = flatCity(text);
  const found = needle ? CITIES.filter((c) => flatCity(c).includes(needle)).slice(0, 6) : [];
  const pick = (c: string) => { setText(c); setOpen(false); onChange(c); };
  return (
    <div className="citypicker">
      <label className="field">{label}
        <input
          value={text}
          role="combobox"
          aria-expanded={open && found.length > 0}
          aria-controls={id}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Cherchez votre ville"
          maxLength={60}
          data-testid={`${testid}-input`}
          onFocus={() => setOpen(true)}
          onChange={(e) => { const t = e.target.value; setText(t); setOpen(true); onChange(canonicalCity(t) ?? ""); }}
        />
      </label>
      {open && found.length > 0 && !(canonicalCity(text) && found.length === 1 && found[0] === canonicalCity(text)) && (
        <ul className="citypicker__list" id={id} role="listbox" data-testid={`${testid}-list`}>
          {found.map((c) => <li key={c} role="option" aria-selected={c === value}><button type="button" className="citypicker__opt" data-testid={`${testid}-opt-${c}`} onClick={() => pick(c)}>{c}</button></li>)}
        </ul>
      )}
      {open && needle && found.length === 0 && <p className="muted" data-testid={`${testid}-none`}>Aucune ville ne correspond.</p>}
    </div>
  );
}

/** Demande la ville (profils créés avant la ville) au moment où elle devient utile ; jamais bloquant : « Plus tard » ferme. */
export function CityPrompt({ onDone, onClose }: { onDone(city: string): void; onClose(): void }) {
  const [city, setCity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Votre ville" onClose={onClose}>
      <form className="form" data-testid="city-prompt" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.setCity(city);
          onDone(city);
        } catch (err) {
          setError(userMessage(err));
          setBusy(false);
        }
      }}>
        <p className="muted">Les prix proposés sont ceux de votre ville.</p>
        <CityPicker value={city} onChange={setCity} testid="prompt-city" />
        {error && <p className="error" role="alert" data-testid="city-prompt-error">{error}</p>}
        <button className="btn btn--primary btn--big" disabled={busy || !city} data-testid="city-prompt-save">Enregistrer</button>
        <button type="button" className="btn btn--ghost" data-testid="city-prompt-later" onClick={onClose}>Plus tard</button>
      </form>
    </Dialog>
  );
}
