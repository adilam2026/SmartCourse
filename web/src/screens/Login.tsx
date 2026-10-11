import { useEffect, useRef, useState } from "react";
import { api, ApiError, NetworkError, type RecoveryState } from "../api";
import { MAIL_FAILED } from "../mailText";
import type { Engine, State } from "../sync/engine";

type Mode = "login" | "setup" | "forgot-code" | "forgot-password";

export function LoginScreen(props: { engine: Engine; s: State }) {
  const [mode, setMode] = useState<Mode>(props.s.prefillInstallToken ? "setup" : "login");
  const back = () => setMode("login");
  if (mode === "setup") return <Setup {...props} onBack={back} />;
  if (mode === "forgot-code" || mode === "forgot-password") return <Forgot kind={mode} onBack={back} />;
  return <Login {...props} onMode={setMode} />;
}

function Logo({ title, text }: { title: string; text: string }) {
  return (
    <div className="auth__logo">
      <img src="/icons/icon-192.png" alt="" width="96" height="96" />
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}

/** Six visible characters of any kind (digits, letters, symbols): the current six-digit codes are among them. */
const SIX = (v: string) => [...v].length === 6 && !/\s/.test(v);

function Login({ engine, s, onMode }: { engine: Engine; s: State; onMode(m: Mode): void }) {
  const [familyCode, setFamilyCode] = useState(s.lastLogin?.familyCode ?? "");
  const [login, setLogin] = useState(s.lastLogin?.login ?? "");
  const [secret, setSecret] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void engine.login(familyCode, login, secret).then(() => setSecret(""));
  };
  return (
    <main className="auth">
      <Logo title="Courses" text="La liste de courses de la famille" />
      <section className="authsec" aria-labelledby="h-login" data-testid="path-login">
        <h2 id="h-login">Se connecter</h2>
        <form onSubmit={submit}>
          <label>
            Code famille
            <input value={familyCode} onChange={(e) => setFamilyCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" required data-testid="login-family" />
          </label>
          <label>
            Identifiant
            <input value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" required data-testid="login-id" />
          </label>
          <label>
            Mot de passe
            <input value={secret} onChange={(e) => setSecret(e.target.value.replace(/\s/g, "").slice(0, 6))} type="password" autoComplete="current-password" maxLength={6} required data-testid="login-secret" />
          </label>
          {s.loginError && <p className="error" role="alert" data-testid="login-error">{s.loginError}</p>}
          <button className="btn btn--primary btn--big" disabled={s.loggingIn || !SIX(secret)} data-testid="login-submit">
            {s.loggingIn ? "Connexion…" : "Se connecter"}
          </button>
        </form>
        <div className="authlinks">
          <button className="linkbtn" data-testid="go-forgot-code" onClick={() => onMode("forgot-code")}>Code famille oublié ?</button>
          <button className="linkbtn" data-testid="go-forgot-password" onClick={() => onMode("forgot-password")}>Mot de passe oublié ?</button>
        </div>
      </section>
      <section className="authsec authsec--first" aria-labelledby="h-setup" data-testid="path-setup">
        <h2 id="h-setup">Première installation</h2>
        <div className="panel">
          <p>Vous installez SmartCourse pour la première fois ? Paramétrez la famille et son premier administrateur.</p>
          <button className="btn btn--big" data-testid="go-setup" onClick={() => onMode("setup")}>Créer ma famille</button>
        </div>
      </section>
    </main>
  );
}

function Setup({ engine, s, onBack }: { engine: Engine; s: State; onBack(): void }) {
  const [f, setF] = useState({ installToken: s.prefillInstallToken ?? "", familyName: "", displayName: "", login: "", secret: "", again: "", email: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === "secret" || k === "again" ? e.target.value.replace(/\s/g, "").slice(0, 6) : e.target.value });
  const mismatch = f.again.length > 0 && f.secret !== f.again;
  return (
    <main className="auth">
      <Logo title="Première installation" text="Créer ma famille : paramétrage de la famille et du premier administrateur" />
      {s.prefillInstallToken && <p className="notice" role="status" data-testid="reset-banner">La famille précédente a été supprimée définitivement. Le jeton d'installation ci-dessous est neuf et ne sert qu'une fois.</p>}
      <form onSubmit={async (e) => { e.preventDefault(); await engine.setup({ installToken: f.installToken, familyName: f.familyName, displayName: f.displayName, login: f.login, secret: f.secret, secretConfirm: f.again, recoveryEmail: f.email }); }}>
        <label>Jeton d'installation<input value={f.installToken} onChange={set("installToken")} autoComplete="off" required data-testid="setup-token" /></label>
        <label>Nom de la famille<input value={f.familyName} onChange={set("familyName")} required maxLength={60} data-testid="setup-family" /></label>
        <label>Votre nom affiché<input value={f.displayName} onChange={set("displayName")} required maxLength={40} data-testid="setup-name" /></label>
        <label>Votre identifiant<input value={f.login} onChange={set("login")} required autoCapitalize="none" pattern="[a-zA-Z0-9._-]{2,30}" data-testid="setup-login" /></label>
        <label>Mot de passe — 6 caractères<input value={f.secret} onChange={set("secret")} type="password" maxLength={6} autoComplete="new-password" required data-testid="setup-secret" /></label>
        <label>Confirmer le mot de passe<input value={f.again} onChange={set("again")} type="password" maxLength={6} autoComplete="new-password" required data-testid="setup-again" /></label>
        {mismatch && <p className="error">Les deux mots de passe ne sont pas identiques.</p>}
        <label>E-mail de récupération (obligatoire)<input value={f.email} onChange={set("email")} type="email" autoComplete="email" maxLength={254} required data-testid="setup-email" /></label>
        <p className="muted">Pour retrouver le code famille ou changer un mot de passe oublié. Un lien de confirmation y est envoyé : l'installation se termine quand vous l'avez ouvert.</p>
        {s.loginError && <p className="error" role="alert" data-testid="setup-error">{s.loginError}</p>}
        <button className="btn btn--primary btn--big" disabled={s.loggingIn || !SIX(f.secret) || f.secret !== f.again || !f.email.includes("@")} data-testid="setup-submit">{s.loggingIn ? "Création…" : "Créer ma famille"}</button>
      </form>
      <button className="linkbtn" onClick={onBack}>← Retour à la connexion</button>
    </main>
  );
}

/** « Code famille oublié ? » / « Mot de passe oublié ? » : the answer is the same whether or not the address is known. */
function Forgot({ kind, onBack }: { kind: "forgot-code" | "forgot-password"; onBack(): void }) {
  const [email, setEmail] = useState("");
  const [familyCode, setFamilyCode] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const isCode = kind === "forgot-code";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    try {
      if (isCode) await api.forgotFamilyCode(email.trim());
      else await api.forgotPassword(email.trim(), familyCode.trim() || undefined);
      setState("sent");
    } catch (err) {
      setError(err instanceof NetworkError ? "Pas de connexion." : err instanceof ApiError && err.status === 429 ? "Trop de demandes. Patientez un instant." : "Adresse invalide.");
      setState("error");
    }
  };
  return (
    <main className="auth">
      <Logo title={isCode ? "Code famille oublié" : "Mot de passe oublié"} text={isCode ? "Le code est envoyé à l'adresse de récupération de la famille." : "Un lien temporaire vous permet de choisir un nouveau mot de passe."} />
      {state === "sent" ? (
        <section className="panel" data-testid="forgot-sent">
          <p><b>Si cette adresse est enregistrée et vérifiée, un e-mail vient d'être envoyé.</b></p>
          <p className="muted">{isCode ? "Il contient votre code famille." : "Le lien est valable 1 heure et ne sert qu'une fois. Votre ancien mot de passe n'est jamais envoyé."} Pensez à regarder les courriers indésirables.</p>
        </section>
      ) : (
        <form onSubmit={submit}>
          <label>Adresse e-mail de récupération<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" data-testid="forgot-email" /></label>
          {!isCode && <label>Code famille (facultatif)<input value={familyCode} onChange={(e) => setFamilyCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" data-testid="forgot-family" /></label>}
          {state === "error" && <p className="error" role="alert" data-testid="forgot-error">{error}</p>}
          <button className="btn btn--primary btn--big" disabled={state === "busy" || !email.includes("@")} data-testid="forgot-submit">{state === "busy" ? "Envoi…" : isCode ? "Recevoir mon code famille" : "Recevoir le lien"}</button>
        </form>
      )}
      <button className="linkbtn" data-testid="forgot-back" onClick={onBack}>← Retour à la connexion</button>
    </main>
  );
}

/** Family created, address not verified yet: the only thing possible is to finish (verify, resend, change the address) — never a dead end. */
export function SetupVerify({ engine }: { engine: Engine }) {
  const [st, setSt] = useState<RecoveryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const problem = st?.lastMail?.status === "failed";
  const load = async () => {
    try {
      const r = await api.recoveryState();
      setSt(r);
      if (r.verified) void engine.completeSetup(); // verified (here or on another device): the server now lets the installation finish
    } catch {
      /* offline: stay here */
    }
  };
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    const on = () => void load();
    document.addEventListener("visibilitychange", on);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", on); };
  }, []);
  const act = async (fn: () => Promise<RecoveryState>) => {
    setBusy(true);
    setError("");
    try {
      setSt(await fn());
      setChanging(false);
    } catch (e) {
      setError(e instanceof NetworkError ? "Pas de connexion." : e instanceof ApiError && (e.code === "too_many_mails" || e.code === "too_soon") ? e.message : MAIL_FAILED);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth" data-testid="setup-verify">
      <Logo title="Vérifiez votre e-mail" text="Dernière étape de l'installation" />
      <section className="panel">
        {problem ? (
          <p className="mailproblem" role="alert" data-testid="verify-status">{MAIL_FAILED}</p>
        ) : (
          <>
            <p>Un lien de confirmation a été envoyé à <b data-testid="verify-address">{st?.email ?? "…"}</b>. Ouvrez-le (sur ce téléphone ou un autre) : l'installation se termine toute seule.</p>
            <p className="muted" data-testid="verify-status">{busy ? "Envoi en cours…" : "Pensez à regarder aussi les courriers indésirables."}</p>
          </>
        )}
        {error && <p className="error" role="alert" data-testid="verify-error">{error}</p>}
        <button className="btn btn--primary btn--big" disabled={busy || !st?.email} data-testid="verify-resend" onClick={() => void act(() => api.resendRecovery())}>{busy ? "Envoi en cours…" : problem ? "Réessayer" : "Renvoyer le lien"}</button>
        {!changing ? (
          <button className="btn" data-testid="verify-change" onClick={() => { setEmail(st?.email ?? ""); setChanging(true); }}>Changer d'adresse</button>
        ) : (
          <form className="form" onSubmit={(e) => { e.preventDefault(); void act(() => api.setRecoveryEmail(email.trim())); }}>
            <label className="field">Nouvelle adresse<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" data-testid="verify-new-email" /></label>
            <button className="btn btn--primary" disabled={busy || !email.includes("@")} data-testid="verify-new-save">Envoyer le lien à cette adresse</button>
          </form>
        )}
      </section>
      <button className="linkbtn" data-testid="verify-logout" onClick={() => void engine.logout()}>Me déconnecter (je reprendrai plus tard)</button>
    </main>
  );
}

/** Opened by the link in an e-mail (…/?verify=… or …/?reset=…). Works signed in or out. */
export function LinkScreen({ kind, token, onDone }: { kind: "verify" | "reset"; token: string; onDone(): void }) {
  const [state, setState] = useState<"busy" | "ok" | "bad" | "form" | "saved" | "offline">("busy");
  const [secret, setSecret] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; // a link is single-use: React's double effect (same instance, same ref) must not spend it twice
    ran.current = true;
    (kind === "verify" ? api.verifyEmail(token).then(() => "ok" as const) : api.checkResetToken(token).then((r) => (r.valid ? ("form" as const) : ("bad" as const))))
      .then(setState)
      .catch((e) => setState(e instanceof NetworkError ? "offline" : "bad"));
  }, [kind, token]);
  const mismatch = again.length > 0 && secret !== again;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.resetPassword(token, secret, again);
      setState("saved");
    } catch (err) {
      setError(err instanceof NetworkError ? "Pas de connexion." : err instanceof ApiError && err.code === "weak_secret" ? "Mot de passe trop simple (évitez 123456, 111111…)." : err instanceof ApiError && err.code === "invalid_link" ? "Ce lien n'est plus valable : demandez-en un nouveau." : "Mot de passe refusé (6 caractères, identiques).");
    }
  };
  return (
    <main className="auth" data-testid={`link-${kind}`}>
      <Logo title={kind === "verify" ? "Adresse de récupération" : "Nouveau mot de passe"} text="SmartCourse" />
      {state === "busy" && <p className="muted" role="status">Vérification du lien…</p>}
      {state === "offline" && <p className="error" role="alert">Pas de connexion. Rouvrez le lien une fois en ligne.</p>}
      {state === "bad" && <section className="panel" data-testid="link-bad"><p><b>Ce lien n'est plus valable.</b></p><p className="muted">{kind === "verify" ? "Demandez un nouvel e-mail depuis Réglages → Adresse de récupération." : "Il a expiré ou a déjà servi. Depuis la connexion, choisissez « Mot de passe oublié ? »."}</p></section>}
      {state === "ok" && <section className="panel" data-testid="link-ok"><p><b>Adresse confirmée.</b></p><p className="muted">Elle peut désormais servir à retrouver le code famille ou à changer un mot de passe oublié.</p></section>}
      {state === "form" && (
        <form onSubmit={save}>
          <label>Nouveau mot de passe — 6 caractères<input type="password" maxLength={6} value={secret} onChange={(e) => setSecret(e.target.value.replace(/\s/g, "").slice(0, 6))} autoComplete="new-password" required data-testid="reset-new" /></label>
          <label>Confirmer le mot de passe<input type="password" maxLength={6} value={again} onChange={(e) => setAgain(e.target.value.replace(/\s/g, "").slice(0, 6))} autoComplete="new-password" required data-testid="reset-confirm" /></label>
          {mismatch && <p className="error">Les deux mots de passe ne sont pas identiques.</p>}
          {error && <p className="error" role="alert" data-testid="reset-error">{error}</p>}
          <button className="btn btn--primary btn--big" disabled={!SIX(secret) || secret !== again} data-testid="reset-submit">Enregistrer</button>
        </form>
      )}
      {state === "saved" && <section className="panel" data-testid="reset-saved"><p><b>Mot de passe modifié.</b></p><p className="muted">Toutes les sessions de ce profil ont été fermées : connectez-vous avec le nouveau mot de passe.</p></section>}
      <button className="btn btn--primary btn--big" data-testid="link-continue" onClick={onDone}>{state === "saved" || state === "ok" ? "Continuer" : "Retour"}</button>
    </main>
  );
}

export function Welcome({ code, onDone }: { code: string; onDone(): void }) {
  return (
    <main className="auth">
      <div className="auth__logo">
        <img src="/icons/icon-192.png" alt="" width="96" height="96" />
        <h1>Famille créée</h1>
      </div>
      <section className="panel">
        <p>Code de la famille, à donner aux autres membres (avec leur identifiant et leur code secret) :</p>
        <p className="secret" data-testid="setup-family-code">{code}</p>
        <p className="muted">Vous pourrez le retrouver dans Réglages.</p>
        <button className="btn btn--primary btn--big" data-testid="welcome-continue" onClick={onDone}>Continuer</button>
      </section>
    </main>
  );
}
