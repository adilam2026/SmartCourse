import { useState } from "react";
import { Dialog } from "./Dialog";

/** The message handed to WhatsApp or the clipboard. The secret exists only in memory, only for the profile just saved. */
export function shareMessage(a: { url: string; familyCode: string; login: string; secret?: string }): string {
  const lines = ["Voici tes accès à Courses :", `Lien : ${a.url}`, `Code famille : ${a.familyCode}`, `Identifiant : ${a.login}`];
  if (a.secret) lines.push(`Code secret : ${a.secret}`, "Connecte-toi avec ces informations.");
  else lines.push("Ton code secret te sera communiqué séparément.");
  return lines.join("\n");
}

export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export interface ShareTarget {
  displayName: string;
  login: string;
  /** In memory only, for the operation that just succeeded; erased when the summary closes. */
  secret?: string;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * « Partager les accès » : WhatsApp opens with the message ready; the person picks the recipient and sends it themselves.
 * Without a secret in memory (existing profile) only link, family code and identifier are shared — the old code can never be retrieved.
 */
export function ShareSheet({ target, familyCode, onClose, onNewCode }: { target: ShareTarget; familyCode: string; onClose(): void; onNewCode(): void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const text = shareMessage({ url: window.location.origin, familyCode, login: target.login, secret: target.secret });
  return (
    <Dialog title={`Accès de ${target.displayName}`} onClose={onClose}>
      <div className="form" data-testid="share-sheet">
        <pre className="sharepreview" data-testid="share-preview">{text}</pre>
        {!target.secret && <p className="muted" data-testid="share-nosecret">Le code secret actuel n'est pas conservé : il ne peut pas être retrouvé. Définissez-en un nouveau pour transmettre des accès complets.</p>}
        <button className="btn btn--primary btn--big" data-testid="share-whatsapp" onClick={() => window.open(whatsappUrl(text), "_blank", "noopener")}>Partager par WhatsApp</button>
        <button className="btn" data-testid="share-copy" onClick={() => void copy(text).then(setCopied)}>Copier les accès</button>
        {copied === true && <p className="notice" role="status" data-testid="share-copied">Accès copiés.</p>}
        {copied === false && <p className="error" role="alert" data-testid="share-copy-failed">La copie n'a pas fonctionné. Utilisez le partage WhatsApp.</p>}
        {!target.secret && <button className="btn" data-testid="share-newcode" onClick={onNewCode}>Définir un nouveau code et partager</button>}
        <button className="btn btn--ghost" data-testid="share-close" onClick={onClose}>Fermer</button>
      </div>
    </Dialog>
  );
}
