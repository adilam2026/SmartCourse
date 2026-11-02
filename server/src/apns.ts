import { sign } from "node:crypto";
import http2 from "node:http2";
import type { PushPayload, PushSubscriptionRow } from "./push.js";

/**
 * Notifications iPhone (Apple Push Notification service), à côté de Web Push. Même déclencheur, mêmes destinataires, même texte :
 * seul le transport change. Un iPhone est enregistré dans push_subscriptions avec une adresse « apns:<environnement>:<jeton> »
 * (environnement « sandbox » pour les versions installées depuis Xcode, « production » pour TestFlight et l'App Store).
 *
 * Configuration (compte Apple Developer, clé « Apple Push Notifications service » de type .p8) — variables du serveur :
 *   APNS_KEY_ID   identifiant de la clé (10 caractères)       APNS_TEAM_ID  identifiant de l'équipe Apple (10 caractères)
 *   APNS_KEY_P8   contenu du fichier .p8 (PEM ; « \n » accepté) APNS_TOPIC    identifiant de l'application iPhone (bundle id)
 * Sans ces variables, les iPhones enregistrés ne reçoivent rien et le serveur l'indique une fois dans ses journaux.
 */
export type ApnsEnv = "sandbox" | "production";
export interface ApnsConfig {
  keyId: string;
  teamId: string;
  key: string;
  topic: string;
}

const PREFIX = "apns:";
export const apnsEndpoint = (env: ApnsEnv, token: string) => `${PREFIX}${env}:${token.toLowerCase()}`;
export function parseApnsEndpoint(endpoint: string): { env: ApnsEnv; token: string } | null {
  const m = /^apns:(sandbox|production):([0-9a-f]{64,200})$/.exec(endpoint);
  return m ? { env: m[1] as ApnsEnv, token: m[2]! } : null;
}
export const isApns = (endpoint: string) => endpoint.startsWith(PREFIX);

export function apnsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const { APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_KEY_P8: raw, APNS_TOPIC: topic } = env;
  if (!keyId || !teamId || !raw || !topic) return null;
  return { keyId, teamId, key: raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw, topic };
}

/** Contenu APNs : le texte de la notification (titre, corps), regroupé par liste ; l'application ouvre la liste au toucher. */
export function apnsBody(p: PushPayload): string {
  return JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: "default", "thread-id": p.listId }, listId: p.listId, url: p.url, tag: p.tag });
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export class ApnsClient {
  private token: { value: string; at: number } | null = null;
  private sessions = new Map<ApnsEnv, http2.ClientHttp2Session>();
  constructor(
    private cfg: ApnsConfig,
    private hosts: Record<ApnsEnv, string> = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" },
  ) {}

  /** Jeton d'authentification (JWT ES256), renouvelé toutes les 50 minutes (Apple le refuse au-delà d'une heure). */
  private jwt(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && now - this.token.at < 50 * 60) return this.token.value;
    const head = b64url(JSON.stringify({ alg: "ES256", kid: this.cfg.keyId }));
    const claims = b64url(JSON.stringify({ iss: this.cfg.teamId, iat: now }));
    const sig = sign("sha256", Buffer.from(`${head}.${claims}`), { key: this.cfg.key, dsaEncoding: "ieee-p1363" });
    this.token = { value: `${head}.${claims}.${b64url(sig)}`, at: now };
    return this.token.value;
  }

  private session(env: ApnsEnv): http2.ClientHttp2Session {
    const cur = this.sessions.get(env);
    if (cur && !cur.closed && !cur.destroyed) return cur;
    const s = http2.connect(this.hosts[env]);
    s.on("error", () => this.sessions.delete(env));
    s.on("close", () => this.sessions.delete(env));
    s.unref();
    this.sessions.set(env, s);
    return s;
  }

  /** Un envoi. Réponse d'Apple ramenée aux codes de Web Push : 410 = appareil à oublier (désinstallé, jeton invalide). */
  send(env: ApnsEnv, deviceToken: string, body: string, collapseId: string): Promise<{ statusCode: number; reason?: string }> {
    return new Promise((resolve) => {
      let req: http2.ClientHttp2Stream;
      try {
        req = this.session(env).request({
          ":method": "POST",
          ":path": `/3/device/${deviceToken}`,
          authorization: `bearer ${this.jwt()}`,
          "apns-topic": this.cfg.topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 3600), // gardée un jour si l'iPhone est éteint
          "apns-collapse-id": collapseId.slice(0, 64), // une validation renvoyée remplace la notification déjà affichée
          "content-type": "application/json",
        });
      } catch {
        return resolve({ statusCode: 0 });
      }
      let status = 0;
      let data = "";
      const timer = setTimeout(() => req.close(http2.constants.NGHTTP2_CANCEL), 10_000);
      req.on("response", (h) => (status = Number(h[":status"]) || 0));
      req.setEncoding("utf8");
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        clearTimeout(timer);
        let reason: string | undefined;
        try {
          reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined;
        } catch {
          reason = undefined;
        }
        const gone = status === 410 || (status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic"));
        resolve({ statusCode: gone ? 410 : status, reason });
      });
      req.on("error", () => {
        clearTimeout(timer);
        resolve({ statusCode: 0 });
      });
      req.end(body);
    });
  }
}

/** Envoyeur APNs pour PushService : null (aucun envoi, journal une fois) tant que le compte Apple n'est pas configuré. */
export function apnsSenderFromEnv(): (sub: PushSubscriptionRow, payload: string) => Promise<{ statusCode: number }> {
  const cfg = apnsConfigFromEnv();
  const client = cfg ? new ApnsClient(cfg) : null;
  let warned = false;
  return async (sub, payload) => {
    const dest = parseApnsEndpoint(sub.endpoint);
    if (!dest) return { statusCode: 410 };
    if (!client) {
      if (!warned) console.error("Notification iPhone non envoyée : APNs non configuré (APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8, APNS_TOPIC)");
      warned = true;
      return { statusCode: 0 };
    }
    const p = JSON.parse(payload) as PushPayload;
    const r = await client.send(dest.env, dest.token, apnsBody(p), p.tag);
    if (r.statusCode >= 400 && r.statusCode !== 410) console.error(`Notification iPhone refusée par Apple : ${r.statusCode} ${r.reason ?? ""}`);
    return { statusCode: r.statusCode };
  };
}
