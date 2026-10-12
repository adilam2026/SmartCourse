import { useEffect, useState } from "react";
import { api, type PriceProposal } from "../api";
import { userMessage } from "../errors";
import { fmtPrice } from "../pricing";

const SOURCE: Record<string, string> = { base: "prix initial", family: "prix de votre famille", community: "prix communautaire" };

/**
 * « Synchroniser les prix » : propositions de la communauté compatibles avec vos produits. Rien n'est appliqué tout seul :
 * l'administrateur choisit chaque prix. Une proposition est la médiane de plusieurs familles pour UN format précis.
 */
export function SyncPrices() {
  const [list, setList] = useState<PriceProposal[] | null>(null);
  const [min, setMin] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [asking, setAsking] = useState<PriceProposal | null>(null);
  const load = () => api.communityPrices().then((r) => { setList(r.proposals); setMin(r.minContributors); setError(null); }).catch((e) => setError(userMessage(e)));
  useEffect(() => void load(), []);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e) {
      setError(userMessage(e));
    }
  };
  return (
    <section data-testid="sync-prices">
      <p className="muted">Prix partagés par d'autres familles pour vos produits, quand au moins {min} familles différentes ont partagé un prix du même format. Rien n'est changé sans votre choix.</p>
      {error && <p className="error" role="alert" data-testid="sync-error">{error}</p>}
      {msg && <p className="notice" role="status" data-testid="sync-msg">{msg}</p>}
      {list?.length === 0 && <p className="empty" data-testid="sync-empty">Aucune proposition pour le moment.</p>}
      <ul className="rows rows--tight">
        {list?.map((p) => (
          <li key={`${p.productId}|${p.format}`} className="row row--stack row--compact" data-testid={`proposal-${p.productId}`}>
            <span className="row__name">
              <span className="row__title">{p.name}</span>
              <small>Actuel : {p.current ? `${fmtPrice(p.current)} (${SOURCE[p.current.source]})` : "aucun prix"}</small>
              <small>Proposé : <b>{fmtPrice(p.price)}</b></small>
              <small>{p.contributors} familles · de {p.min.replace(".", ",")} à {p.max.replace(".", ",")} DH · dernier relevé {p.latestObservedOn.split("-").reverse().join("/")}</small>
            </span>
            <span className="row__actions">
              <button className="btn btn--small btn--primary" data-testid={`apply-${p.productId}`} onClick={() => (p.current?.source === "family" ? setAsking(p) : void act(() => api.applyCommunityPrice({ productId: p.productId, format: p.format }), `Prix appliqué : ${p.name}.`))}>Appliquer</button>
              <button className="btn btn--small btn--ghost" data-testid={`report-${p.productId}`} onClick={() => void act(() => api.reportCommunityPrice({ productId: p.productId, format: p.format }), "Merci, la proposition est signalée et masquée pour votre famille.")}>Signaler</button>
            </span>
          </li>
        ))}
      </ul>
      {asking && (
        <div className="panel danger" role="alertdialog" data-testid="sync-confirm">
          <p>Remplacer votre prix actuel de « {asking.name} » ({asking.current ? fmtPrice(asking.current) : ""}) par {fmtPrice(asking.price)} ? Les commandes déjà validées gardent leur prix.</p>
          <button className="btn btn--danger" data-testid="sync-confirm-apply" onClick={() => { const a = asking; setAsking(null); void act(() => api.applyCommunityPrice({ productId: a.productId, format: a.format }), `Prix appliqué : ${a.name}.`); }}>Oui, remplacer</button>
          <button className="btn btn--ghost" onClick={() => setAsking(null)}>Non, garder le mien</button>
        </div>
      )}
    </section>
  );
}
