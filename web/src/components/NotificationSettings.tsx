import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { disablePush, enablePush, pushStatus, type PushStatus } from "../push";

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
  const run = async (fn: () => Promise<PushStatus>) => {
    setBusy(true);
    setError(null);
    try {
      setShared(await fn());
    } catch {
      setError("Impossible pour le moment (connexion nécessaire). Réessayez.");
      refresh();
    } finally {
      setBusy(false);
    }
  };
  return { status, busy, error, enable: () => run(enablePush), disable: () => run(disablePush) };
}

/** « Notifications » in the profile sheet (parents and administrators only). */
export function NotificationSettings() {
  const { status, busy, error, enable, disable } = usePushControl();
  return (
    <section className="versioninfo" data-testid="notif-settings" aria-label="Notifications">
      <p><strong>Notifications</strong></p>
      <p className="muted" data-testid="notif-status" data-status={status ?? "loading"}>{status ? LABEL[status] : "Vérification…"}</p>
      {status === "off" && <button className="btn btn--small btn--primary" data-testid="notif-enable" disabled={busy} onClick={() => void enable()}>Activer les notifications</button>}
      {status === "on" && <button className="btn btn--small" data-testid="notif-disable" disabled={busy} onClick={() => void disable()}>Désactiver sur cet appareil</button>}
      {status === "denied" && <p className="muted" data-testid="notif-denied-help"><small>Pour les activer : Paramètres du téléphone → Applications → Courses → Notifications, puis revenez ici.</small></p>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted"><small>Un récapitulatif quand quelqu'un d'autre valide des modifications de la liste. Rien pour vos propres actions, ni à chaque appui sur + ou −.</small></p>
    </section>
  );
}

const DISMISS = "smartcourse.notifInviteDismissed";

/** One-line invitation on the current-list screen, until notifications are on, refused, or the person says no thanks. */
export function NotificationInvite({ profileId }: { profileId: string }) {
  const { status, busy, enable } = usePushControl();
  const key = `${DISMISS}.${profileId}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed || status !== "off") return null;
  return (
    <div className="banner banner--info limit" data-testid="notif-invite">
      <span>Recevoir une notification quand la liste change ?</span>
      <span className="banner__actions">
        <button className="btn btn--small btn--primary" data-testid="notif-invite-enable" disabled={busy} onClick={() => void enable()}>Activer les notifications</button>
        <button className="btn btn--small btn--ghost" data-testid="notif-invite-dismiss" onClick={() => { setDismissed(true); try { localStorage.setItem(key, "1"); } catch { /* ignore */ } }}>Plus tard</button>
      </span>
    </div>
  );
}

export { disablePush };
