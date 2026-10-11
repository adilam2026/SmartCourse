import { api } from "./api";

/**
 * Notifications téléphone (Web Push) de CET appareil. Réservé aux parents et administrateurs (le serveur refuse le personnel).
 * L'abonnement appartient au navigateur du téléphone ; le serveur en garde l'adresse pour le profil connecté.
 *   off → on : permission du téléphone, abonnement, enregistrement chez le serveur
 *   on → off : désabonnement du téléphone et suppression chez le serveur
 */
export type PushStatus = "unsupported" | "denied" | "off" | "on";

export const pushSupported = (): boolean =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const registration = async () => (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
const currentSubscription = async (): Promise<PushSubscription | null> => (pushSupported() ? (await registration()).pushManager.getSubscription() : null);

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const sameKey = (sub: PushSubscription, key: Uint8Array): boolean => {
  const k = sub.options.applicationServerKey;
  if (!k) return false;
  const a = new Uint8Array(k);
  return a.length === key.length && a.every((v, i) => v === key[i]);
};

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const sub = await currentSubscription().catch(() => null);
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** « Activer les notifications » : the phone asks the person for permission, then this device is registered for the signed-in profile. */
export async function enablePush(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const { publicKey } = await api.pushConfig();
  const key = keyBytes(publicKey);
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe(); // subscribed with another server key (never expected: the key is kept in the database)
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.pushSubscribe({ ...(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }), userAgent: navigator.userAgent.slice(0, 200) });
  return "on";
}

/**
 * Stops notifications on this device. The phone's own subscription is always cancelled first (that alone makes the push service
 * refuse anything the server could still send); the server is told as well when it can be reached.
 */
export async function disablePush(): Promise<PushStatus> {
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await api.pushUnsubscribe(endpoint).catch(() => {});
  }
  return pushStatus();
}

/** Signing out, or a role that no longer gets notifications: this phone stops receiving the previous profile's notifications. */
export const releasePushDevice = async (): Promise<void> => {
  if (pushSupported()) await disablePush().catch(() => {});
};

/**
 * Called once a profile is signed in on this phone. A subscription left by someone else (signed out while offline, another family)
 * is dropped here, and staff never keep one: notifications of an old profile never continue under a new one.
 */
export async function reconcilePush(role: "admin" | "parent" | "staff"): Promise<void> {
  if (!pushSupported()) return;
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  if (role === "staff") return void (await disablePush());
  try {
    const { registered } = await api.pushCheck(sub.endpoint);
    if (!registered) await sub.unsubscribe().catch(() => {}); // this phone's subscription is not this profile's: cancel it locally
  } catch {
    /* offline: checked at the next opening */
  }
}
