import { fmtWhen, isLate } from "../format";
import { validationGroups } from "../grouping";
import type { ListView } from "../types";
import { fmtQty } from "../units";
import { Dialog } from "./Dialog";

const SIGN = { add: "＋", request_again: "↻", qty: "✎", remove: "－", correct: "↩", merge: "↩" } as const;

/**
 * « Historique des validations » : one block per press on « Valider », newest first, so the 08:00 group and the 14:00 group
 * stay separate with their own author, time and articles. Read-only.
 */
export function ValidationHistory({ list, onClose }: { list: ListView; onClose(): void }) {
  const groups = validationGroups(list);
  return (
    <Dialog title="Historique des validations" onClose={onClose}>
      {groups.length === 0 && <p className="empty">Aucune validation pour cette liste.</p>}
      <div className="form" data-testid="validations">
        {groups.map((g) => (
          <section key={g.validation.id} className="vgroup" data-testid="validation-group">
            <h3>{fmtWhen(g.validation.at)} · {g.validation.by.displayName} <span className="muted">· {g.events.length} changement{g.events.length > 1 ? "s" : ""}</span></h3>
            {isLate(g.validation.at, g.validation.receivedAt) && (
              <p className="muted" data-testid="validation-late">Envoyé plus tard : validé sur le téléphone à {fmtWhen(g.validation.at)}, reçu par le serveur à {fmtWhen(g.validation.receivedAt)}.</p>
            )}
            {g.validation.clientAt && Math.abs(new Date(g.validation.clientAt).getTime() - new Date(g.validation.at).getTime()) > 1000 && (
              <p className="muted" data-testid="validation-clock">L'heure annoncée par le téléphone ({fmtWhen(g.validation.clientAt)}) était incohérente : l'heure du serveur est affichée.</p>
            )}
            <ul>
              {g.events.map((e) => (
                <li key={e.id}>
                  {SIGN[e.kind]} {e.name}{" "}
                  {(e.kind === "qty" || e.kind === "merge") && e.before !== null && e.after !== null ? `${fmtQty(e.before, e.unit)} → ${fmtQty(e.after, e.unit)}` : e.kind === "remove" ? "retiré" : e.after !== null ? fmtQty(e.after, e.unit) : ""}
                  {e.kind === "request_again" ? " (nouvelle demande)" : ""}
                  {e.kind === "correct" ? " : achat corrigé, remis à acheter" : ""}
                  {e.kind === "merge" ? " : achat corrigé, quantité reportée" : ""}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <button className="btn btn--ghost" data-testid="validations-close" onClick={onClose}>Fermer</button>
    </Dialog>
  );
}
