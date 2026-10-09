import { useState } from "react";
import type { Engine, State } from "../sync/engine";

export function LoginScreen(props: { engine: Engine; s: State }) {
  const [mode, setMode] = useState<"login" | "setup">("login");
  return mode === "login" ? <Login {...props} onSetup={() => setMode("setup")} /> : <Setup {...props} onBack={() => setMode("login")} />;
}

function Login({ engine, s, onSetup }: { engine: Engine; s: State; onSetup(): void }) {
  const [familyCode, setFamilyCode] = useState(s.lastLogin?.familyCode ?? "");
  const [login, setLogin] = useState(s.lastLogin?.login ?? "");
  const [secret, setSecret] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void engine.login(familyCode, login, secret).then(() => setSecret(""));
  };
  return (
    <main className="login">
      <h1>🛒 Courses</h1>
      <form onSubmit={submit}>
        <label>
          Code de la famille
          <input value={familyCode} onChange={(e) => setFamilyCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" required data-testid="login-family" />
        </label>
        <label>
          Identifiant
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" required data-testid="login-id" />
        </label>
        <label>
          Code secret (6 chiffres)
          <input value={secret} onChange={(e) => setSecret(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" autoComplete="current-password" pattern="\d{6}" required data-testid="login-secret" />
        </label>
        {s.loginError && <p className="error" role="alert" data-testid="login-error">{s.loginError}</p>}
        <button className="btn btn--primary btn--big" disabled={s.loggingIn || secret.length !== 6} data-testid="login-submit">
          {s.loggingIn ? "Connexion…" : "Se connecter"}
        </button>
      </form>
      <button className="linkbtn" data-testid="go-setup" onClick={onSetup}>Première installation ? Créer la famille</button>
    </main>
  );
}

function Setup({ engine, s, onBack }: { engine: Engine; s: State; onBack(): void }) {
  const [f, setF] = useState({ installToken: "", familyName: "", displayName: "", login: "", secret: "", again: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === "secret" || k === "again" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value });
  const mismatch = f.again.length > 0 && f.secret !== f.again;
  return (
    <main className="login">
      <h1>Première installation</h1>
      <form onSubmit={async (e) => { e.preventDefault(); await engine.setup(f); }}>
        <label>Jeton d'installation<input value={f.installToken} onChange={set("installToken")} autoComplete="off" required data-testid="setup-token" /></label>
        <label>Nom de la famille<input value={f.familyName} onChange={set("familyName")} required maxLength={60} data-testid="setup-family" /></label>
        <label>Votre nom affiché<input value={f.displayName} onChange={set("displayName")} required maxLength={40} data-testid="setup-name" /></label>
        <label>Votre identifiant<input value={f.login} onChange={set("login")} required autoCapitalize="none" pattern="[a-zA-Z0-9._-]{2,30}" data-testid="setup-login" /></label>
        <label>Code secret (6 chiffres)<input value={f.secret} onChange={set("secret")} inputMode="numeric" type="password" pattern="\d{6}" required data-testid="setup-secret" /></label>
        <label>Répétez le code<input value={f.again} onChange={set("again")} inputMode="numeric" type="password" pattern="\d{6}" required data-testid="setup-again" /></label>
        {mismatch && <p className="error">Les deux codes ne sont pas identiques.</p>}
        {s.loginError && <p className="error" role="alert" data-testid="setup-error">{s.loginError}</p>}
        <button className="btn btn--primary btn--big" disabled={s.loggingIn || f.secret.length !== 6 || f.secret !== f.again} data-testid="setup-submit">{s.loggingIn ? "Création…" : "Créer la famille"}</button>
      </form>
      <button className="linkbtn" onClick={onBack}>← Retour à la connexion</button>
    </main>
  );
}

export function Welcome({ code, onDone }: { code: string; onDone(): void }) {
  return (
    <main className="login">
      <h1>Famille créée 🎉</h1>
      <p>Code de la famille, à donner aux autres membres (avec leur identifiant et leur code secret) :</p>
      <p className="secret" data-testid="setup-family-code">{code}</p>
      <p className="muted">Vous pourrez le retrouver dans Réglages.</p>
      <button className="btn btn--primary btn--big" data-testid="welcome-continue" onClick={onDone}>Continuer</button>
    </main>
  );
}
