/**
 * Envoi d'e-mails transactionnels via l'API HTTPS de Brevo (pas de SMTP). Même module et mêmes règles que Petits Héros
 * (adilam2026/Kids, server/mail.js), avec les paramètres PROPRES à SmartCourse, lus dans l'environnement du service Railway :
 *   BREVO_API_KEY (secrète), BREVO_FROM_EMAIL (expéditeur validé chez Brevo), BREVO_FROM_NAME, APP_URL, MAIL_TIMEOUT_MS,
 *   BREVO_WEBHOOK_SECRET (facultatif : retour « remis / rejeté »). Aucun secret dans le dépôt, jamais dans les journaux. « Accepté » signifie seulement que Brevo a pris le message en charge : la réception réelle dans la
 * boîte n'est confirmée par aucun accusé ici (au mieux l'état « remis » signalé par le webhook Brevo).
 */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  /** Le service d'envoi a accepté le message (≠ reçu dans la boîte). */
  accepted: boolean;
  messageId?: string;
  /** Raison lisible d'un refus ; jamais de secret. */
  detail?: string;
  /** Service non configuré (aucune clé) : rien n'est parti. */
  notConfigured?: boolean;
  /** Délai dépassé : l'issue est inconnue (le message est peut-être parti). */
  unknown?: boolean;
}

export interface Mailer {
  readonly enabled: boolean;
  send(mail: OutgoingMail): Promise<SendResult>;
}

export class DisabledMailer implements Mailer {
  readonly enabled = false;
  async send(): Promise<SendResult> {
    return { accepted: false, notConfigured: true, detail: "envoi d'e-mails non configuré" };
  }
}

export interface BrevoOptions {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * « Accepté » seulement si Brevo répond 2xx AVEC un messageId (sinon l'acceptation n'est pas démontrée). Le détail ne contient jamais
 * la clé, l'adresse du destinataire, le contenu ni le corps de réponse de Brevo.
 */
export class BrevoMailer implements Mailer {
  readonly enabled = true;
  constructor(private readonly o: BrevoOptions) {}

  async send(mail: OutgoingMail): Promise<SendResult> {
    const url = new URL(this.o.endpoint ?? "https://api.brevo.com/v3/smtp/email");
    const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !local) return { accepted: false, detail: "configuration refusée : la clé ne circule qu'en HTTPS" };
    const f = this.o.fetchImpl ?? fetch;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 10_000);
    let status: number;
    let raw: string;
    try {
      const res = await f(url.toString(), {
        method: "POST",
        signal: ctl.signal,
        redirect: "error",
        headers: { "api-key": this.o.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { name: this.o.senderName, email: this.o.senderEmail },
          to: [{ email: mail.to }],
          subject: mail.subject,
          htmlContent: mail.html,
          textContent: mail.text,
          tags: ["smartcourse"],
        }),
      });
      status = res.status;
      raw = await res.text();
    } catch (e) {
      return (e as Error)?.name === "AbortError"
        ? { accepted: false, unknown: true, detail: "pas de réponse du service d'envoi dans le délai : issue inconnue, le message est peut-être parti" }
        : { accepted: false, detail: "service d'envoi injoignable" };
    } finally {
      clearTimeout(timer);
    }
    let j: { messageId?: unknown; code?: unknown } | null = null;
    try {
      j = JSON.parse(raw);
    } catch {
      /* corps non JSON */
    }
    if (status < 200 || status >= 300) {
      const code = typeof j?.code === "string" && /^[a-z_]{3,40}$/.test(j.code) ? ` ${j.code}` : "";
      return { accepted: false, detail: `refus du service d'envoi (HTTP ${status}${code})` };
    }
    if (typeof j?.messageId !== "string" || !j.messageId) return { accepted: false, detail: `réponse sans identifiant de message (HTTP ${status}) : acceptation non démontrée` };
    return { accepted: true, messageId: j.messageId };
  }
}

/** Reads the application's own settings; without a key and a valid sender the application still works, only the e-mails are off. */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const apiKey = env.BREVO_API_KEY;
  const senderEmail = env.BREVO_FROM_EMAIL ?? "";
  if (!apiKey || !EMAIL.test(senderEmail)) return new DisabledMailer();
  return new BrevoMailer({ apiKey, senderEmail, senderName: env.BREVO_FROM_NAME || "SmartCourse", endpoint: env.BREVO_API_URL, timeoutMs: Number(env.MAIL_TIMEOUT_MS) || undefined });
}

/** Address the links in e-mails point to: SmartCourse itself. */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env.APP_URL ?? env.APP_BASE_URL)?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  return "http://localhost:3000";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;color:#1b2822"><h2 style="color:#1f6b45">${esc(title)}</h2>${bodyHtml}<p style="color:#6a7a70;font-size:12px">SmartCourse — la liste de courses de la famille. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien ne change.</p></div>`;
}
const button = (url: string, label: string) =>
  `<p><a href="${esc(url)}" style="display:inline-block;background:#1f6b45;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">${esc(label)}</a></p><p style="font-size:12px;word-break:break-all">${esc(url)}</p>`;

export const templates = {
  verifyEmail(to: string, link: string): OutgoingMail {
    return {
      to,
      subject: "SmartCourse — confirmez votre adresse de récupération",
      text: `Confirmez cette adresse comme adresse de récupération de votre famille SmartCourse :\n${link}\n\nLe lien est valable 48 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
      html: layout("Confirmez votre adresse", `<p>Confirmez cette adresse comme adresse de récupération de votre famille SmartCourse.</p>${button(link, "Confirmer mon adresse")}<p>Lien valable 48 heures.</p>`),
    };
  },
  resetPassword(to: string, link: string): OutgoingMail {
    return {
      to,
      subject: "SmartCourse — choisir un nouveau mot de passe",
      text: `Vous avez demandé à changer votre mot de passe SmartCourse. Choisissez-en un nouveau avec ce lien (valable 1 heure, une seule fois) :\n${link}\n\nVotre ancien mot de passe n'est jamais envoyé. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
      html: layout("Nouveau mot de passe", `<p>Vous avez demandé à changer votre mot de passe. Choisissez-en un nouveau :</p>${button(link, "Choisir un nouveau mot de passe")}<p>Lien valable 1 heure, utilisable une seule fois. Votre ancien mot de passe n'est jamais envoyé.</p>`),
    };
  },
  familyCode(to: string, families: { name: string; code: string }[]): OutgoingMail {
    const lines = families.map((f) => `${f.name} : ${f.code}`).join("\n");
    return {
      to,
      subject: "SmartCourse — votre code famille",
      text: `Voici le code famille associé à cette adresse :\n${lines}\n\nPour vous connecter : code famille, identifiant et mot de passe. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
      html: layout("Votre code famille", `<p>Code famille associé à cette adresse :</p>${families.map((f) => `<p>${esc(f.name)} : <b style="font-size:20px;letter-spacing:2px">${esc(f.code)}</b></p>`).join("")}<p>Pour vous connecter : code famille, identifiant et mot de passe.</p>`),
    };
  },
};
