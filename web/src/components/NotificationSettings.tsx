import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "./Icon";
import { disablePush, enablePush, PushError, pushStatus, type PushStatus, type PushStep } from "../push";

const FAILED: Record<PushStep, string> = {
  server: "Les notifications ne peuvent pas être préparées pour le moment (connexion nécessaire). Réessayez.",
  phone: "Ce téléphone n'a pas pu enregistrer les notifications. Vérifiez que les notifications de Courses sont autorisées dans les paramètres du téléphone, puis réessayez.",
  register: "Les notifications n'ont pas pu être enregistrées pour ce téléphone. Réessayez dans un instant.",
  verify: "L'activation n'a pas pu être confirmée sur ce téléphone. Elle n'est donc pas considérée comme activée.",
};

const LABEL: Record<PushStatus, string> = {
  on: "Activées sur cet appareil",
  off: "Désactivées sur cet appareil",
  denied: "Bloquées dans les paramètres du téléphone",
  unsupported: "Non prises en charge par ce navigateur",
};

// One shared state for the whole page: the invitation banner and the profile sheet always agree.
let shared: PushStatus | null = null;
const subs = new Set<() => void>();
const setShared = (v: PushStatus) => {
  shared = v;
  subs.forEach((l) => l());
};

/** The state of notifications on THIS phone, and the two actions (profile sheet and invitation banner share it). */
export function usePushControl() {
  const status = useSyncExternalStore(
    (l) => {
      subs.add(l);
      return () => subs.delete(l);
    },
    () => shared,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => void pushStatus().then(setShared).catch(() => setShared("unsupported")), []);
  useEffect(refresh, [refresh]);
  /** Returns the real state afterwards, or null when the action failed (nothing is announced as done in that case). */
  const run = async (fn: () => Promise<PushStatus>): Promise<PushStatus | null> => {
    setBusy(true);
    setError(null);
    try {
      const asked = await fn();
      const real = await pushStatus(); // the permission and the subscription as the phone really holds them
      if (asked === "on" && real !== "on") throw new PushError("verify");
      setShared(real);
      return real;
    } catch (e) {
      setError(FAILED[e instanceof PushError ? e.step : "server"]);
      refresh();
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { status, busy, error, enable: () => run(enablePush), disable: () => run(disablePush) };
}

/** Refusées dans le téléphone : on ne redemande pas ; l'aide n'apparaît que si la personne la demande. */
function DeniedHelp() {
  const [open, setOpen] = useState(false);
  return open
    ? <p className="muted" data-testid="notif-denied-help"><small>Ouvrez les paramètres du téléphone → Applications → Courses → Notifications, autorisez-les, puis revenez ici.</small></p>
    : <button className="linkbtn linkbtn--inline" data-testid="notif-howto" onClick={() => setOpen(true)}>Comment les activer ?</button>;
}

/** « Notifications » in the profile sheet (parents and administrators only). */
export function NotificationSettings() {
  const { status, busy, error, enable, disable } = usePushControl();
  return (
    <section className="sheetsection" data-testid="notif-settings" aria-label="Notifications">
      <h3><Icon name="bell" size={20} /> Notifications</h3>
      <p className="muted" data-testid="notif-status" data-status={status ?? "loading"}>{status ? LABEL[status] : "Vérification…"}</p>
      {status === "off" && <button className="btn btn--small btn--primary" data-testid="notif-enable" disabled={busy} onClick={() => void enable()}>Activer les notifications</button>}
      {status === "on" && <button className="btn btn--small" data-testid="notif-disable" disabled={busy} onClick={() => void disable()}>Désactiver sur cet appareil</button>}
      {status === "denied" && <DeniedHelp />}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted"><small>Un récapitulatif quand quelqu'un d'autre valide des modifications de la liste. Rien pour vos propres actions, ni à chaque appui sur + ou −.</small></p>
    </section>
  );
}

/** Choix fait sur CET appareil (pas par profil) : une fois « Plus tard », fermé ou répondu, l'invitation ne revient plus. Réglages reste disponible. */
const CHOICE = "smartcourse.notifChoice";
let choiceMemory = false; // si le stockage du navigateur est indisponible : au moins pas deux fois dans la même session
const choiceMade = (): boolean => {
  try {
    return localStorage.getItem(CHOICE) !== null || choiceMemory;
  } catch {
    return choiceMemory;
  }
};
const rememberChoice = (what: "later" | "answered"): void => {
  choiceMemory = true;
  try {
    localStorage.setItem(CHOICE, what);
  } catch {
    /* ignore */
  }
};

/**
 * Invitation unique sur l'écran de la liste. « Activer » ouvre alors seulement la demande du téléphone ; « Plus tard », la fermeture
 * ou une réponse du téléphone (accord ou refus) clôt l'invitation pour toujours sur cet appareil. Une activation qui échoue (réseau) ne
 * clôt rien et n'est jamais annoncée comme réussie.
 */
export function NotificationInvite() {
  const { status, busy, error, enable } = usePushControl();
  const [closed, setClosed] = useState(choiceMade);
  if (closed || status !== "off") return null;
  const close = (what: "later" | "answered") => { rememberChoice(what); setClosed(true); };
  return (
    <div className="banner banner--info limit" data-testid="notif-invite">
      <span>Recevoir une notification quand la liste change ?</span>
      <span className="banner__actions">
        <button className="btn btn--small btn--primary" data-testid="notif-invite-enable" disabled={busy} onClick={async () => { if ((await enable()) !== null) close("answered"); }}>Activer</button>
        <button className="btn btn--small btn--ghost" data-testid="notif-invite-dismiss" onClick={() => close("later")}>Plus tard</button>
        <button className="btn btn--small btn--ghost" aria-label="Masquer l'invitation" data-testid="notif-invite-close" onClick={() => close("later")}>✕</button>
      </span>
      {error && <small className="error" role="alert" data-testid="notif-invite-error">{error}</small>}
    </div>
  );
}

export { disablePush };
