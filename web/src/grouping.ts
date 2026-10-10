import type { ListEvent, ListItem, ListView, Validation } from "./types";

export interface Group<T> {
  key: string;
  label: string;
  items: T[];
}

/**
 * The shopping list is always shown grouped by category, in the catalogue's category order, whatever the order or time the articles
 * were added in. Pure presentation: the list itself is never changed. Categories the catalogue does not know come last, by key.
 */
export function groupByCategory<T extends { category: string }>(items: T[], categories: { key: string; label: string }[]): Group<T>[] {
  const order = new Map(categories.map((c, i) => [c.key, i]));
  const label = new Map(categories.map((c) => [c.key, c.label]));
  const by = new Map<string, T[]>();
  for (const it of items) by.set(it.category, [...(by.get(it.category) ?? []), it]);
  return [...by.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b))
    .map(([key, list]) => ({ key, label: label.get(key) ?? key, items: list }));
}

/** Items of one section (to buy / bought) ready to show: grouped by category. */
export function sectionGroups(list: ListView, status: ListItem["status"], categories: { key: string; label: string }[]): Group<ListItem>[] {
  return groupByCategory(
    list.items.filter((i) => i.status === status),
    categories,
  );
}

export interface ValidationGroup {
  validation: Validation;
  events: ListEvent[];
}

/** The validations of a list, newest first, each with the changes it made (so the 08:00 group and the 14:00 group stay separate). */
export function validationGroups(list: ListView): ValidationGroup[] {
  const events = list.events ?? [];
  return (list.validations ?? [])
    .map((v) => ({ validation: v, events: events.filter((e) => e.validationId === v.id) }))
    .filter((g) => g.events.length > 0)
    .sort((a, b) => (a.validation.at < b.validation.at ? 1 : a.validation.at > b.validation.at ? -1 : a.validation.receivedAt < b.validation.receivedAt ? 1 : a.validation.receivedAt > b.validation.receivedAt ? -1 : 0));
}

/** Everything that happened to one line, oldest first (the "details of the changes"). */
export const eventsOfItem = (list: ListView, itemId: string): ListEvent[] => (list.events ?? []).filter((e) => e.itemId === itemId);
