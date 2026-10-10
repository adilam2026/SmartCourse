import { fmtWhen } from "../format";
import { eventsOfItem } from "../grouping";
import type { ListEvent, ListItem, ListView } from "../types";
import { fmtQty } from "../units";
import { Dialog } from "./Dialog";

/** What one event says, in words: "Ajouté · 2 kg", "Quantité 2 → 3 kg", "Retiré", "Nouvelle demande · 1 pièce". */
export function eventText(e: Pick<ListEvent, "kind" | "before" | "after" | "unit">): string {
  switch (e.kind) {
    case "add": return `Ajouté · ${e.after !== null ? fmtQty(e.after, e.unit) : ""}`;
    case "request_again": return `Nouvelle demande · ${e.after !== null ? fmtQty(e.after, e.unit) : ""}`;
    case "qty": return `Quantité ${e.before ?? "?"} → ${e.after !== null ? fmtQty(e.after, e.unit) : "?"}`.replace(".", ",");
    case "remove": return `Retiré${e.before !== null ? ` (${fmtQty(e.before, e.unit)})` : ""}`;
  }
}

/** The line on a shopping row: who asked, when, and the latest change when there is one. */
export function RowMeta({ item }: { item: ListItem }) {
  return (
    <>
      {item.addedBy && item.addedAt && <small data-testid={`added-${item.productId}`}>Ajouté par {item.addedBy.displayName} · {fmtWhen(item.addedAt)}</small>}
      {item.lastChange && (
        <small data-testid={`changed-${item.productId}`}>
          {item.lastChange.kind === "qty" ? `Quantité ${String(item.lastChange.before ?? "?").replace(".", ",")} → ${String(item.lastChange.after ?? "?").replace(".", ",")}` : "Modifié"} par {item.lastChange.by.displayName} · {fmtWhen(item.lastChange.at)}
        </small>
      )}
    </>
  );
}

/** Details of one line: every change with its author and time, plus the purchase. Read-only. */
export function ItemDetail({ list, item, onClose }: { list: ListView; item: ListItem; onClose(): void }) {
  const events = eventsOfItem(list, item.id);
  return (
    <Dialog title={item.name} onClose={onClose}>
      <p>
        <strong>{fmtQty(item.quantity, item.unit)}</strong>
        {item.brand ? <span className="muted"> · {item.brand}</span> : null}
      </p>
      <ul className="timeline" data-testid="item-timeline">
        {events.map((e) => (
          <li key={e.id}>
            <span>{eventText(e)}</span>
            <small>{e.by.displayName} · {fmtWhen(e.at)}</small>
          </li>
        ))}
        {item.purchase && (
          <li>
            <span>Acheté{item.purchase.quantity != null && item.purchase.unit ? ` · ${fmtQty(item.purchase.quantity, item.purchase.unit)}` : ""}</span>
            <small>{item.purchase.by.displayName} · {fmtWhen(item.purchase.at)}</small>
          </li>
        )}
      </ul>
      <button className="btn btn--ghost" data-testid="detail-close" onClick={onClose}>Fermer</button>
    </Dialog>
  );
}
