import Dexie, { type Table } from "dexie";
import type { Batch, Catalog, ListView, Me, Toggles } from "./types";

/**
 * Local storage. Everything per-person is keyed by (familyId, profileId) and the draft also by list:
 * a draft never crosses into another family, profile or list. The secret code is never stored.
 */
export interface MetaRow {
  key: string;
  value: unknown;
}
export interface CacheRow {
  familyId: string;
  profileId: string;
  me: Me;
  catalog: Catalog | null;
  list: ListView | null | undefined;
  savedAt: number;
}
export interface DraftRow {
  familyId: string;
  profileId: string;
  listId: string;
  toggles: Toggles;
}
export interface OutboxRow extends Batch {
  familyId: string;
  profileId: string;
}
export interface OrphanRow {
  id: string;
  familyId: string;
  profileId: string;
  fromListId: string;
  productIds: string[];
  createdAt: number;
}

class AppDb extends Dexie {
  meta!: Table<MetaRow, string>;
  cache!: Table<CacheRow, [string, string]>;
  drafts!: Table<DraftRow, [string, string, string]>;
  outbox!: Table<OutboxRow, string>;
  orphans!: Table<OrphanRow, string>;

  constructor(name = "smartcourse") {
    super(name);
    this.version(1).stores({
      meta: "key",
      cache: "[familyId+profileId]",
      drafts: "[familyId+profileId+listId]",
      outbox: "id, [familyId+profileId]",
      orphans: "id, [familyId+profileId]",
    });
  }
}

export const db = new AppDb();
export type { AppDb };
export { AppDb as AppDbClass };
