import { useState } from "react";
import { api, ApiError, NetworkError, type DiagnosticCheck, type RecoveryState } from "../api";
import { Icon } from "./Icon";
import { fmtDateTime } from "../format";

type Mail = NonNullable<RecoveryState["lastMail"]>;
export const MAIL_PROBLEM = new Set(["failed", "not_configured", "bounced"]);
export const isMailProblem = (m: Mail | null | undefined): boolean => !!m && MAIL_PROBLEM.has(m.status);

const KIND = (k: string) => (k === "test" ? "e-mail de test" : "e-mail de vérification");

/** What became of the last e-mail, said straight: sent-but-not-received is not « received », and a refusal is never presented as a link to open. */
export function MailStatus({ mail }: { mail: Mail | null }) {
  if (!mail) return null;
  if (isMailProblem(mail) || mail.status === "unknown")
    return (
      <div className="mailproblem" role="alert" data-testid="mail-problem">
        <b data-testid="mail-title">{mail.title || "E-mail non envoyé"}</b>
        {mail.hint && <p data-testid="mail-hint">{mail.hint}</p>}
        {mail.detail && <small className="muted" data-testid="mail-detail">Détail : {mail.detail} ({fmtDateTime(mail.at)})</small>}
      </div>
    );
  const text =
    mail.status === "delivered" ? "remis à la boîte mail du destinataire — ouvrez-le (courriers indésirables compris)"
    : mail.status === "accepted" ? "accepté par le service d'envoi (Brevo) — la réception dans la boîte n'est pas confirmée : regardez aussi les courriers indésirables"
    : "envoi en cours…";
  return <p className="muted" data-testid="mail-ok">Dernier {KIND(mail.kind)} : {text} ({fmtDateTime(mail.at)}).</p>;
}

/** Key / account / sender checks, with no message sent. */
export function Diagnose() {
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setChecks((await api.diagnoseMail()).checks);
    } catch (e) {
      setError(e instanceof NetworkError ? "Pas de connexion." : e instanceof ApiError ? e.message : "Diagnostic impossible.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="diagnose">
      <button type="button" className="btn" disabled={busy} data-testid="mail-diagnose" onClick={() => void run()}>{busy ? "Diagnostic…" : "Diagnostiquer l'envoi"}</button>
      {error && <p className="error" role="alert">{error}</p>}
      {checks && (
        <ul className="checks" data-testid="mail-checks">
          {checks.map((c) => (
            <li key={c.name} className={c.ok === false ? "bad" : c.ok ? "good" : ""} data-ok={String(c.ok)}>
              <Icon name={c.ok ? "check" : "info"} size={16} /> <b>{c.name}</b> — {c.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
