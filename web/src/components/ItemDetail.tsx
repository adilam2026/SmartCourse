import { fmtWhen, lateNote } from "../format";
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
    case "correct": return `Achat corrigé : remis à acheter · ${e.after !== null ? fmtQty(e.after, e.unit) : ""}`;
    case "merge": return `Achat corrigé : quantité reportée ${e.before !== null ? fmtQty(e.before, e.unit) : "?"} → ${e.after !== null ? fmtQty(e.after, e.unit) : "?"}`;
  }
}

/** The line on a shopping row: who asked, when, and the latest change when there is one. */
export function RowMeta({ item }: { item: ListItem }) {
  const late = item.addedAt ? lateNote(item.addedAt, item.addedReceivedAt) : "";
  const lateChange = item.lastChange ? lateNote(item.lastChange.at, item.lastChange.receivedAt) : "";
  return (
    <>
      {item.addedBy && item.addedAt && <small data-testid={`added-${item.productId}`}>Ajouté par {item.addedBy.displayName} · {fmtWhen(item.addedAt)}{late && <em data-testid={`late-${item.productId}`}> · {late}</em>}</small>}
      {item.lastChange && (
        <small data-testid={`changed-${item.productId}`}>
          {item.lastChange.kind === "qty" ? `Quantité ${String(item.lastChange.before ?? "?").replace(".", ",")} → ${String(item.lastChange.after ?? "?").replace(".", ",")}` : item.lastChange.kind === "merge" ? "Achat corrigé, quantité reportée" : item.lastChange.kind === "correct" ? "Achat corrigé" : "Modifié"} par {item.lastChange.by.displayName} · {fmtWhen(item.lastChange.at)}{lateChange && <em> · {lateChange}</em>}
        </small>
      )}
    </>
  );
}

/** Details of one line: every change with its author and time, plus the purchase. Read-only. */
export function ItemDetail({ list, item, onClose }: { list: ListView; item: ListItem; onClose(): void }) {
  const events = eventsOfItem(list, item.id);
  // Purchases of this product that were corrected (nothing is erased: who bought, when, how much, who corrected).
  const corrections = (list.corrections ?? []).filter((c) => c.productId === item.productId);
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
            <small>{e.by.displayName} · {fmtWhen(e.at)}{lateNote(e.at, e.receivedAt) && <em> · {lateNote(e.at, e.receivedAt)}</em>}</small>
          </li>
        ))}
        {corrections.map((c) => (
          <li key={c.purchaseId} data-testid="item-correction">
            <span>Achat corrigé{c.quantity != null && c.unit ? ` · ${fmtQty(c.quantity, c.unit)}` : ""}{c.reason ? ` — « ${c.reason} »` : ""}</span>
            <small>Acheté par {c.purchasedBy.displayName} · {fmtWhen(c.purchasedAt)} · corrigé par {c.correctedBy.displayName} · {fmtWhen(c.correctedAt)}</small>
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
