import { fmtWhen } from "../format";
import { validationGroups } from "../grouping";
import type { ListView } from "../types";
import { fmtQty } from "../units";
import { Dialog } from "./Dialog";

const SIGN = { add: "＋", request_again: "↻", qty: "✎", remove: "－" } as const;

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
            <ul>
              {g.events.map((e) => (
                <li key={e.id}>
                  {SIGN[e.kind]} {e.name}{" "}
                  {e.kind === "qty" && e.before !== null && e.after !== null ? `${fmtQty(e.before, e.unit)} → ${fmtQty(e.after, e.unit)}` : e.kind === "remove" ? "retiré" : e.after !== null ? fmtQty(e.after, e.unit) : ""}
                  {e.kind === "request_again" ? " (nouvelle demande)" : ""}
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
