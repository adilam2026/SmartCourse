import { useState } from "react";
import { api } from "../api";
import { userMessage } from "../errors";
import type { Engine } from "../sync/engine";
import { Dialog } from "./Dialog";
import { isAnySecret, SecretInput } from "./SecretInput";

/** « Supprimer mon compte » : la personne retire son propre profil (mot de passe retapé) ; la famille et les autres profils ne changent pas. */
export function DeleteAccount({ engine, onClose }: { engine: Engine; onClose(): void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Supprimer mon compte" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.deleteOwnAccount(secret);
          await engine.afterAccountDeleted();
        } catch (err) {
          setError(userMessage(err));
          setBusy(false);
        }
      }}>
        <p>Votre profil, votre identifiant et votre code sont supprimés définitivement et vos accès sont fermés. La famille et les autres profils ne changent pas ; dans l'historique des achats, votre nom devient « Ancien profil ».</p>
        <label className="field">Votre mot de passe actuel<SecretInput kind="current" value={secret} onChange={setSecret} testid="delete-account-secret" /></label>
        {error && <p className="error" role="alert" data-testid="delete-account-error">{error}</p>}
        <button className="btn btn--danger btn--big" disabled={busy || !isAnySecret(secret)} data-testid="delete-account-submit">{busy ? "Suppression…" : "Supprimer mon compte"}</button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
      </form>
    </Dialog>
  );
}
