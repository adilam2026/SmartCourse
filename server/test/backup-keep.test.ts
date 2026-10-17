import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KEPT_PREFIX, keepBackup, listBackups, LocalBackupStore, pruneBackups } from "../src/backup.js";

describe("copie conservée d'une sauvegarde", () => {
  it("copie identique (fichier et manifeste), idempotente, jamais élaguée", async () => {
    const store = new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "keep-")));
    const day = (h: number) => `backups/sc-2026-10-17T${String(h).padStart(2, "0")}-00-00-000Z`;
    for (const h of [9, 18]) {
      await store.put(`${day(h)}.dump.enc`, Buffer.from(`dump ${h}`));
      await store.put(`${day(h)}.manifest.json`, Buffer.from(`{"h":${h}}`));
    }
    const k = await keepBackup(store, `${day(9)}.dump.enc`);
    expect(k).toMatchObject({ kept: `${KEPT_PREFIX}sc-2026-10-17T09-00-00-000Z.dump.enc`, already: false });
    expect((await store.get(`${KEPT_PREFIX}sc-2026-10-17T09-00-00-000Z.manifest.json`))!.toString()).toBe('{"h":9}');
    expect((await keepBackup(store, `${day(9)}.dump.enc`)).already).toBe(true);
    // la rétention (une par jour) supprime la sauvegarde de 9 h dans backups/, jamais sa copie conservée
    await pruneBackups(store, { daily: 1, weekly: 0, monthly: 0 });
    expect((await listBackups(store)).map((e) => e.key)).toEqual([`${day(18)}.dump.enc`]);
    expect((await store.get(`${KEPT_PREFIX}sc-2026-10-17T09-00-00-000Z.dump.enc`))!.toString()).toBe("dump 9");
  });
});
