import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backupStatus, backupVerifyPrune, createBackup, decrypt, encrypt, listBackups, LocalBackupStore, selectKeep, verifyBackup, type BackupCtx } from "../src/backup.js";
import { generateInstallToken, setupFamily } from "../src/auth.js";
import type { Db } from "../src/db.js";
import { closeTestDb, resetData, testDb } from "./helpers.js";

let db: Db;
let ctx: BackupCtx;
const PASS = "une-phrase-secrete-de-test";

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  await setupFamily(db, { installToken: await generateInstallToken(db), familyName: "F", admin: { displayName: "Adil", login: "adil", secret: "482913" } });
  ctx = { db, databaseUrl: process.env.DATABASE_URL!, store: new LocalBackupStore(mkdtempSync(path.join(os.tmpdir(), "bk-"))), passphrase: PASS };
});
afterAll(closeTestDb);

describe("chiffrement", () => {
  it("aller-retour, mauvaise clé et altération d'un seul octet sont détectés", () => {
    const data = Buffer.from("données de la famille");
    const blob = encrypt(data, PASS);
    expect(blob.includes(data)).toBe(false);
    expect(decrypt(blob, PASS)).toEqual(data);
    expect(() => decrypt(blob, "mauvaise-phrase-de-passe")).toThrow();
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => decrypt(tampered, PASS)).toThrow();
    expect(() => decrypt(Buffer.from("n'importe quoi"), PASS)).toThrow(/backup/);
  });
});

describe("rétention", () => {
  const at = (iso: string) => ({ at: new Date(iso), id: iso });
  it("garde le plus récent de chacun des 7 derniers jours, 4 dernières semaines, 3 derniers mois", () => {
    const entries = [];
    for (let d = 0; d < 120; d++) entries.push(at(new Date(Date.UTC(2026, 9, 9, 3) - d * 86_400_000).toISOString()));
    const kept = selectKeep(entries);
    const days = [...kept].map((e) => e.id.slice(0, 10));
    for (let d = 0; d < 7; d++) expect(days).toContain(new Date(Date.UTC(2026, 9, 9) - d * 86_400_000).toISOString().slice(0, 10));
    expect(kept.size).toBeGreaterThanOrEqual(7);
    expect(kept.size).toBeLessThanOrEqual(7 + 4 + 3);
    expect(days).not.toContain("2026-06-15"); // trop ancien
  });
  it("plusieurs sauvegardes le même jour : seule la plus récente compte ; la plus récente est toujours gardée", () => {
    const e = [at("2026-10-09T03:00:00Z"), at("2026-10-09T15:00:00Z"), at("2026-10-08T03:00:00Z")];
    const kept = [...selectKeep(e, { daily: 1, weekly: 0, monthly: 0 })];
    expect(kept.map((x) => x.id)).toEqual(["2026-10-09T15:00:00Z"]);
  });
  it("peu de sauvegardes : toutes gardées", () => {
    const e = [at("2026-10-09T03:00:00Z"), at("2026-10-08T03:00:00Z")];
    expect(selectKeep(e).size).toBe(2);
  });
});

describe("sauvegarde et restauration vérifiée", () => {
  it("une sauvegarde est restaurée dans une base temporaire et conforme au manifeste ; la base temporaire est supprimée", async () => {
    const b = await createBackup(ctx);
    expect(b.manifest.tables["families"]).toBe(1);
    expect(b.manifest.tables["profiles"]).toBe(1);
    expect(b.manifest.tables["products"]).toBe(80);
    const v = await verifyBackup(ctx, b.key);
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.restoredTables).toBeGreaterThan(10);
    const left = await db.query("SELECT datname FROM pg_database WHERE datname LIKE 'sc_verify_%'");
    expect(left.rows).toEqual([]);
  });

  it("le fichier ne contient rien en clair", async () => {
    const [latest] = await listBackups(ctx.store);
    const blob = (await ctx.store.get(latest!.key))!;
    expect(blob.includes(Buffer.from("Adil"))).toBe(false);
    expect(blob.includes(Buffer.from("scrypt$"))).toBe(false);
  });

  it("une sauvegarde altérée ou une mauvaise clé : échec détecté, rien n'est annoncé comme vérifié", async () => {
    const b = await createBackup(ctx);
    const blob = Buffer.from((await ctx.store.get(b.key))!);
    blob[blob.length - 5]! ^= 0xff;
    await ctx.store.put(b.key, blob);
    const v = await verifyBackup(ctx, b.key);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("déchiffrement impossible");

    const good = await createBackup({ ...ctx, now: () => new Date(Date.now() + 1000) });
    const wrong = await verifyBackup({ ...ctx, passphrase: "une-autre-phrase-de-passe" }, good.key);
    expect(wrong.ok).toBe(false);
  });

  it("un manifeste qui ne correspond pas aux données restaurées est refusé", async () => {
    const b = await createBackup({ ...ctx, now: () => new Date(Date.now() + 2000) });
    const mkey = b.key.replace(/\.dump\.enc$/, ".manifest.json");
    const m = JSON.parse((await ctx.store.get(mkey))!.toString());
    m.tables.families += 1;
    await ctx.store.put(mkey, Buffer.from(JSON.stringify(m)));
    const v = await verifyBackup(ctx, b.key);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("families");
  });

  it("sauvegarde cohérente pendant des écritures concurrentes (le manifeste décrit exactement le dump)", async () => {
    const writer = (async () => {
      for (let i = 0; i < 25; i++) await db.query("INSERT INTO audit_log (action) VALUES ('test.concurrent')");
    })();
    const b = await createBackup({ ...ctx, now: () => new Date(Date.now() + 3000) });
    await writer;
    const v = await verifyBackup(ctx, b.key);
    expect(v.problems).toEqual([]);
  });

  it("un invariant violé dans les données sauvegardées est signalé", async () => {
    const { rows } = await db.query("SELECT id FROM families LIMIT 1");
    await db.query("UPDATE profiles SET active = false WHERE family_id = $1", [rows[0].id]); // famille sans administrateur actif
    try {
      const b = await createBackup({ ...ctx, now: () => new Date(Date.now() + 4000) });
      const v = await verifyBackup(ctx, b.key);
      expect(v.ok).toBe(false);
      expect(v.problems.join(" ")).toContain("administrateur actif");
    } finally {
      await db.query("UPDATE profiles SET active = true WHERE family_id = $1", [rows[0].id]);
    }
  });

  it("sauvegarde + vérification + rétention enregistrées ; l'état est exposé", async () => {
    const r = await backupVerifyPrune({ ...ctx, now: () => new Date(Date.now() + 5000) });
    expect(r.verify.ok).toBe(true);
    const st = await backupStatus(db, true);
    expect(st.configured).toBe(true);
    expect(st.lastBackupAt).toBeTruthy();
    expect(st.lastVerifiedOkAt).toBeTruthy();
  });

  it("une vérification en échec ne supprime aucune ancienne sauvegarde", async () => {
    const before = (await listBackups(ctx.store)).length;
    const bad = { ...ctx, passphrase: PASS };
    const b = await createBackup({ ...bad, now: () => new Date(Date.now() + 6000) });
    const blob = Buffer.from((await ctx.store.get(b.key))!);
    blob[60]! ^= 1;
    await ctx.store.put(b.key, blob);
    const v = await verifyBackup(ctx, b.key);
    expect(v.ok).toBe(false);
    expect((await listBackups(ctx.store)).length).toBe(before + 1); // rien n'a été purgé
  });
});
