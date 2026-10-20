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

/** What Brevo said, made safe to store and show: no key, no address, no long token-like string, short. */
export function safeProviderMessage(msg: unknown, apiKey?: string): string {
  let t = typeof msg === "string" ? msg : "";
  if (apiKey) t = t.split(apiKey).join("[clé]");
  t = t.replace(/https?:\/\/\S+/g, "[lien]").replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[adresse]").replace(/[A-Za-z0-9_-]{28,}/g, "[…]");
  return t.replace(/\s+/g, " ").trim().slice(0, 180);
}

/** Operator-facing cause (SERVER LOGS ONLY — never sent to the application's screens), from the stored detail of a failed send. */
export function explainMailFailure(status: string, detail: string | null): { title: string; hint: string } {
  const d = detail ?? "";
  const http = Number(d.match(/HTTP (\d{3})/)?.[1] ?? 0);
  const m = d.toLowerCase();
  if (status === "not_configured") return { title: "Envoi d'e-mails non configuré", hint: "Ajoutez BREVO_API_KEY et BREVO_FROM_EMAIL dans les variables du service SmartCourse sur Railway, puis redéployez." };
  if (status === "unknown") return { title: "Envoi incertain", hint: "Brevo n'a pas répondu à temps : le message est peut-être parti. Patientez quelques minutes avant de réessayer." };
  if (status === "bounced") return { title: "E-mail rejeté par la boîte du destinataire", hint: "Vérifiez l'adresse saisie (faute de frappe ?) ou changez-la." };
  if (status !== "failed") return { title: "", hint: "" };
  // 1. L'adresse IP du serveur n'est pas autorisée chez Brevo (le message de Brevo contient un lien https : ce n'est PAS une erreur HTTPS).
  if (/unrecogni[sz]ed ip|authori[sz]ed_?ips?|ip address/.test(m) || (http === 401 && /\bip\b/.test(m)))
    return { title: "IP du serveur non autorisée dans Brevo", hint: "Brevo bloque le serveur de SmartCourse. Dans Brevo → Sécurité → Adresses IP autorisées, désactivez la restriction (Railway n'a pas d'IP fixe), puis appuyez sur Réessayer." };
  if (m.includes("injoignable")) return { title: "Brevo est injoignable", hint: "Le serveur n'arrive pas à joindre Brevo. Appuyez sur Réessayer dans un instant." };
  if (m.includes("configuration refusée")) return { title: "Configuration d'envoi refusée", hint: "L'adresse du service d'envoi doit commencer par https." };
  if (http === 401 || m.includes("unauthorized") || m.includes("key not found")) return { title: "Clé API refusée par Brevo", hint: "Vérifiez BREVO_API_KEY dans les variables Railway : clé API v3 complète et active, sans guillemets ni espace. « Diagnostiquer l'envoi » (détails techniques) le confirme." };
  if (http === 403 || m.includes("permission_denied") || m.includes("not yet activated") || m.includes("not activated")) return { title: "Compte Brevo non autorisé à envoyer", hint: "Le compte Brevo doit être activé pour l'envoi d'e-mails transactionnels (parfois après validation par Brevo)." };
  if (http === 400 && (m.includes("sender") || m.includes("expéditeur"))) return { title: "Expéditeur non autorisé par Brevo", hint: "BREVO_FROM_EMAIL doit être un expéditeur validé dans Brevo → Expéditeurs, domaines et IP. Une adresse gmail ou yahoo est refusée : utilisez une adresse de votre propre domaine." };
  if (http === 400) return { title: "Demande refusée par Brevo", hint: "Le plus fréquent : expéditeur non validé. « Diagnostiquer l'envoi » (détails techniques) vérifie la clé et l'expéditeur." };
  if (http === 402 || http === 429 || m.includes("quota")) return { title: "Limite ou crédits Brevo atteints", hint: "Le quota d'envoi du compte Brevo est atteint. Réessayez plus tard ou contrôlez le plan Brevo." };
  if (http >= 500) return { title: "Panne chez Brevo", hint: "Brevo a renvoyé une erreur : appuyez sur Réessayer dans quelques minutes." };
  return { title: "Le service d'envoi a refusé le message", hint: "« Diagnostiquer l'envoi » (détails techniques) contrôle la clé et l'expéditeur." };
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
      const why = safeProviderMessage((j as { message?: unknown } | null)?.message, this.o.apiKey);
      return { accepted: false, detail: `refus du service d'envoi (HTTP ${status}${code})${why ? ` : ${why}` : ""}` };
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
  signupCode(to: string, code: string): OutgoingMail {
    return {
      to,
      subject: `Mes Courses — votre code de vérification : ${code}`,
      text: `Votre code pour créer votre famille dans Mes Courses : ${code}\n\nSaisissez-le dans l'application. Il est valable 30 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucune famille ne sera créée.`,
      html: layout("Votre code de vérification", `<p>Votre code pour créer votre famille dans Mes Courses :</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Saisissez-le dans l'application. Il est valable 30 minutes.</p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucune famille ne sera créée.</p>`),
    };
  },
  test(to: string): OutgoingMail {
    return {
      to,
      subject: "SmartCourse — e-mail de test",
      text: "Ceci est un e-mail de test de SmartCourse : si vous le lisez, l'envoi fonctionne jusqu'à votre boîte. Aucune action n'est nécessaire.",
      html: layout("E-mail de test", "<p>Si vous lisez ce message, l'envoi d'e-mails de SmartCourse fonctionne jusqu'à votre boîte.</p><p>Aucune action n'est nécessaire.</p>"),
    };
  },
  familyCode(to: string, families: { name: string; code: string; loginId?: string | null }[]): OutgoingMail {
    // Identifiant famille quand la famille en a choisi un ; le code famille d'origine reste valable dans tous les cas.
    const lines = families.map((f) => (f.loginId ? `${f.name} : identifiant famille ${f.loginId} (ou code famille ${f.code})` : `${f.name} : ${f.code}`)).join("\n");
    return {
      to,
      subject: "SmartCourse — votre code famille",
      text: `Voici le code famille associé à cette adresse :\n${lines}\n\nPour vous connecter : identifiant famille (ou code famille), identifiant personnel et code d'accès personnel. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
      html: layout(
        "Votre code famille",
        `<p>Code famille associé à cette adresse :</p>${families
          .map((f) => (f.loginId ? `<p>${esc(f.name)} : <b style="font-size:20px">${esc(f.loginId)}</b><br>ou code famille ${esc(f.code)}</p>` : `<p>${esc(f.name)} : <b style="font-size:20px;letter-spacing:2px">${esc(f.code)}</b></p>`))
          .join("")}<p>Pour vous connecter : identifiant famille (ou code famille), identifiant personnel et code d'accès personnel.</p>`,
      ),
    };
  },
};
