import type { ReactNode } from "react";
import { CATEGORY_EMOJI } from "../categories";
import type { Group } from "../grouping";
import type { ListItem } from "../types";

/** One section of the shopping list (« À acheter » or « Achetés »): clear category titles, stable order, rows inside each. */
export function GroupedRows({ groups, testid, row }: { groups: Group<ListItem>[]; testid: string; row: (item: ListItem) => ReactNode }) {
  return (
    <div data-testid={testid}>
      {groups.map((g) => (
        <section key={g.key} className="catgroup" data-testid={`group-${g.key}`} aria-label={g.label}>
          <h3 className="catgroup__title"><span aria-hidden="true">{CATEGORY_EMOJI[g.key] ?? "•"}</span> {g.label} <span className="count-pill">{g.items.length}</span></h3>
          <ul className="rows">{g.items.map((i) => row(i))}</ul>
        </section>
      ))}
    </div>
  );
}
