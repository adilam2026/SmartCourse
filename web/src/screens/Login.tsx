import { useState } from "react";
import type { Engine, State } from "../sync/engine";

export function LoginScreen({ engine, s }: { engine: Engine; s: State }) {
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
    </main>
  );
}
