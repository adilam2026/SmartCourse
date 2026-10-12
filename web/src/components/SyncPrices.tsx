import { useEffect, useState } from "react";
import { api, ApiError, type PriceProposal } from "../api";
import { userMessage } from "../errors";
import { fmtPrice } from "../pricing";
import { CityPrompt } from "./CityPicker";
import type { Engine, State } from "../sync/engine";

const key = (p: PriceProposal) => `${p.productId}|${p.format}`;

/**
 * « Synchroniser les prix » : prix partagés par d'autres familles de VOTRE ville, pour vos produits et le même format.
 * Rien n'est appliqué tout seul : l'administrateur coche les prix voulus. Un prix personnel n'est jamais coché d'office.
 */
export function SyncPrices({ engine, s }: { engine: Engine; s: State }) {
  const [list, setList] = useState<PriceProposal[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [city, setCity] = useState<string | null>(null);
  const [needCity, setNeedCity] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.communityPrices().then((r) => {
    setList(r.proposals);
    setCity(r.city);
    setPicked(new Set(r.proposals.filter((p) => p.current?.source !== "family").map(key)));
    setNeedCity(false);
    setError(null);
  }).catch((e) => {
    if (e instanceof ApiError && e.code === "city_required") { setNeedCity(true); setError(null); } else setError(userMessage(e));
  });
  useEffect(() => void load(), [s.me?.city]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const apply = async () => {
    const items = (list ?? []).filter((p) => picked.has(key(p))).map((p) => ({ productId: p.productId, format: p.format }));
    if (!items.length) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.applyCommunityPrices(items);
      setMsg(r.applied === 1 ? "1 prix appliqué." : `${r.applied} prix appliqués.`);
      await load();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const report = async (p: PriceProposal) => {
    setError(null);
    try {
      await api.reportCommunityPrice({ productId: p.productId, format: p.format });
      setMsg("Merci, la proposition est signalée et masquée pour votre famille.");
      await load();
    } catch (e) {
      setError(userMessage(e));
    }
  };
  return (
    <section data-testid="sync-prices">
      {needCity && (
        <div className="panel" data-testid="sync-need-city">
          <p>Indiquez votre ville pour voir les prix proposés autour de vous.</p>
          <CityAsk engine={engine} />
        </div>
      )}
      {city && <p className="muted" data-testid="sync-city">Prix de votre ville : {city}</p>}
      {error && <p className="error" role="alert" data-testid="sync-error">{error}</p>}
      {msg && <p className="notice" role="status" data-testid="sync-msg">{msg}</p>}
      {list?.length === 0 && <p className="empty" data-testid="sync-empty">Aucun nouveau prix disponible dans votre ville.</p>}
      {!!list?.length && (
        <>
          <ul className="rows rows--tight">
            {list.map((p) => (
              <li key={key(p)} className="row row--stack row--compact" data-testid={`proposal-${p.productId}`}>
                <label className="check">
                  <input type="checkbox" checked={picked.has(key(p))} onChange={() => toggle(key(p))} data-testid={`pick-${p.productId}`} />
                  <span className="row__name">
                    <span className="row__title">{p.name}</span>
                    <small>Actuel : {p.current ? fmtPrice(p.current) : "aucun prix"}</small>
                    <small>Proposé : <b>{fmtPrice(p.price)}</b></small>
                  </span>
                </label>
                <button className="linkbtn" data-testid={`report-${p.productId}`} onClick={() => void report(p)}>Signaler</button>
              </li>
            ))}
          </ul>
          <button className="btn btn--primary btn--big" disabled={busy || picked.size === 0} data-testid="sync-apply" onClick={() => void apply()}>Appliquer les prix sélectionnés</button>
        </>
      )}
    </section>
  );
}

function CityAsk({ engine }: { engine: Engine }) {
  const [open, setOpen] = useState(true);
  if (!open) return <button className="btn btn--small" data-testid="sync-city-open" onClick={() => setOpen(true)}>Choisir ma ville</button>;
  return <CityPrompt onDone={(c) => { void engine.setCity(c); setOpen(false); }} onClose={() => setOpen(false)} />;
}
