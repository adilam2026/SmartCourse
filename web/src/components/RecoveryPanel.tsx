import { useEffect, useRef, useState } from "react";
import { api, ApiError, NetworkError, type RecoveryState } from "../api";
import { Icon } from "./Icon";
import { MAIL_FAILED } from "../mailText";

const errText = (e: unknown): string =>
  e instanceof NetworkError ? "Pas de connexion."
  : e instanceof ApiError ? (e.code === "too_soon" || e.code === "too_many_mails" ? e.message : e.code === "email_not_verified" ? "L'adresse doit d'abord être vérifiée." : MAIL_FAILED)
  : "Erreur.";

/**
 * « Adresse de récupération », en trois états lisibles : à vérifier, vérifiée, envoi échoué.
 * Une seule phrase d'explication. En cas d'échec : une seule phrase et un seul bouton « Réessayer » — rien sur l'infrastructure.
 */
export function RecoveryPanel() {
  const [st, setSt] = useState<RecoveryState | null>(null);
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"send" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [testFailed, setTestFailed] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const inFlight = useRef(false); // un second appui avant le rendu suivant n'envoie rien

  const apply = (r: RecoveryState) => {
    setSt(r);
    setWait(r.resendInSeconds);
  };
  const load = () => api.recoveryState().then(apply).catch((e) => setError(errText(e)));
  useEffect(() => void load(), []);
  // L'état se met à jour tout seul tant que l'adresse n'est pas vérifiée (le lien peut être ouvert sur un autre téléphone).
  useEffect(() => {
    if (!st || st.verified || !st.email) return;
    const t = setInterval(() => void api.recoveryState().then(apply).catch(() => {}), 4000);
    const on = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", on);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", on); };
  }, [st?.verified, st?.email]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const run = async (kind: "send" | "test", fn: () => Promise<RecoveryState>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setError(null); // l'ancienne erreur disparaît dès qu'on réessaie
    if (kind === "test") { setTestFailed(false); setTestSent(false); }
    try {
      const r = await fn();
      apply(r);
      if (kind === "test") {
        const failed = r.lastMail?.status === "failed";
        setTestFailed(failed);
        setTestSent(!failed); // jamais « envoyé » si le service a refusé
      }
      if (kind === "send") setEditing(false);
    } catch (e) {
      setError(errText(e));
      if (kind === "test") setTestFailed(true);
      if (e instanceof ApiError && e.code === "too_soon") void load();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  if (!st) return <p className="empty">{error ?? "Chargement…"}</p>;
  if (!st.canEdit)
    return (
      <div className="panel recovery" data-testid="recovery">
        <p>{st.verified ? "Une adresse de récupération vérifiée est enregistrée." : "Aucune adresse de récupération vérifiée."}</p>
        <p className="muted">Seul l'administrateur principal la gère.</p>
      </div>
    );

  const mail = st.lastMail?.kind === "verify_email" ? st.lastMail : null;
  const failed = !st.verified && mail?.status === "failed";
  const form = editing || !st.email;

  return (
    <div className="panel recovery" data-testid="recovery">
      {/* ---- état ---- */}
      {!st.email ? (
        <p><span className="statebadge statebadge--bad" data-testid="recovery-state">Aucune adresse</span></p>
      ) : st.verified ? (
        <p className="verified" data-testid="recovery-state"><span className="okmark" aria-hidden="true"><Icon name="check" size={20} /></span> <b>Adresse vérifiée</b></p>
      ) : (
        <p><span className="statebadge statebadge--bad" data-testid="recovery-state">Adresse à vérifier</span></p>
      )}
      {st.email && <p className="addr" data-testid="recovery-email">{st.email}</p>}

      {/* ---- message : un seul, selon l'état ---- */}
      {failed && !form && <p className="mailproblem" role="alert" data-testid="mail-problem">{MAIL_FAILED}</p>}
      {!st.verified && st.email && !failed && !form && (
        <p data-testid="verify-instruction">{busy === "send" || mail?.status === "sending" ? "Envoi en cours…" : "Ouvrez le lien envoyé par e-mail pour vérifier votre adresse."}</p>
      )}
      {st.verified && testSent && <p data-testid="test-ok">E-mail de test envoyé : vérifiez votre boîte mail (courriers indésirables compris).</p>}
      {st.verified && testFailed && <p className="mailproblem" role="alert" data-testid="test-problem">{MAIL_FAILED}</p>}
      {error && <p className="error" role="alert" data-testid="recovery-error">{error}</p>}

      {/* ---- actions ---- */}
      {form ? (
        <form className="form" onSubmit={(e) => { e.preventDefault(); void run("send", () => api.setRecoveryEmail(email.trim())); }}>
          <label className="field">Adresse e-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} required data-testid="recovery-input" /></label>
          <button className="btn btn--primary btn--big" disabled={busy !== null || !email.includes("@")} aria-busy={busy === "send"} data-testid="recovery-save">{busy === "send" ? "Envoi en cours…" : "Enregistrer et envoyer"}</button>
          {st.email && <button type="button" className="btn btn--ghost" disabled={busy !== null} data-testid="recovery-cancel" onClick={() => setEditing(false)}>Annuler</button>}
        </form>
      ) : st.verified ? (
        <div className="actions2">
          <button className="btn" disabled={busy !== null} data-testid="recovery-edit" onClick={() => { setEmail(st.email ?? ""); setEditing(true); setTestSent(false); setTestFailed(false); }}>Modifier l'adresse</button>
          <button className="btn" disabled={busy !== null} aria-busy={busy === "test"} data-testid="recovery-test" onClick={() => void run("test", () => api.testRecovery())}>{busy === "test" ? "Envoi en cours…" : testFailed ? "Réessayer" : "Envoyer un e-mail de test"}</button>
        </div>
      ) : (
        <div className="actions2">
          {failed ? (
            <button className="btn btn--primary btn--big" disabled={busy !== null} aria-busy={busy === "send"} data-testid="recovery-resend" onClick={() => void run("send", () => api.resendRecovery())}>{busy === "send" ? "Envoi en cours…" : "Réessayer"}</button>
          ) : (
            <button className="btn btn--primary btn--big" disabled={busy !== null || wait > 0} aria-busy={busy === "send"} data-testid="recovery-resend" onClick={() => void run("send", () => api.resendRecovery())}>
              {busy === "send" ? "Envoi en cours…" : wait > 0 ? `Renvoyer le lien de vérification (dans ${wait} s)` : "Renvoyer le lien de vérification"}
            </button>
          )}
          <button className="linkbtn" disabled={busy !== null} data-testid="recovery-edit" onClick={() => { setEmail(st.email ?? ""); setEditing(true); }}>Modifier l'adresse</button>
        </div>
      )}

      <p className="muted" data-testid="recovery-sentence">Cette adresse permet de récupérer votre code famille et de réinitialiser votre mot de passe.</p>
    </div>
  );
}
