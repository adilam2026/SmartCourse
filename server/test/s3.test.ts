import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
// @ts-expect-error s3rver ships no types
import S3rver from "s3rver";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { backupVerifyPrune, createBackup, listBackups, S3BackupStore, verifyBackup } from "../src/backup.js";
import { createBackupStorage } from "../src/backup-store.js";
import { generateInstallToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import type { Db } from "../src/db.js";
import { S3PhotoStore } from "../src/photos.js";
import { closeTestDb, resetData, testDb } from "./helpers.js";

/*
 * The production storage is an S3-compatible bucket (Railway). These tests run the real S3 code paths
 * (AWS SDK, path-style addressing, list/put/get/delete) against an S3 emulator in the same process.
 */
let server: any;
let client: S3Client;
let db: Db;
const PORT = 4569;
const BUCKET = "test-bucket";

beforeAll(async () => {
  db = await testDb();
  await resetData(db);
  const dir = mkdtempSync(path.join(os.tmpdir(), "s3-"));
  server = new S3rver({ port: PORT, address: "127.0.0.1", silent: true, directory: dir, configureBuckets: [{ name: BUCKET, configs: [] }] });
  await server.run();
  client = new S3Client({ region: "auto", endpoint: `http://127.0.0.1:${PORT}`, forcePathStyle: true, credentials: { accessKeyId: "S3RVER", secretAccessKey: "S3RVER" } });
});
afterAll(async () => {
  await server?.close();
  await closeTestDb();
});

describe("stockage S3 (bucket)", () => {
  it("photos : écriture, lecture, absence", async () => {
    const store = new S3PhotoStore(client, BUCKET);
    const key = `photos/${"c".repeat(64)}.webp`;
    expect(await store.get(key)).toBeNull();
    await store.put(key, Buffer.from("webp-bytes"), "image/webp");
    const got = await store.get(key);
    expect(got?.data.toString()).toBe("webp-bytes");
    expect(got?.mime).toBe("image/webp");
  });

  it("l'application sert une photo téléversée à travers le bucket", async () => {
    const app = await buildApp({ db, store: new S3PhotoStore(client, BUCKET), loginRateLimit: { max: 1000, timeWindow: "1 minute" } });
    const setup = await app.inject({ method: "POST", url: "/api/setup/family", payload: { installToken: await generateInstallToken(db), familyName: "S3", admin: { displayName: "A", login: "adil", secret: "482913" } } });
    const cookies = { sc_session: setup.cookies.find((c) => c.name === "sc_session")!.value };
    const prod = (await app.inject({ method: "GET", url: "/api/catalog", cookies })).json().categories[0].products[0];
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#33aa55" } }).png().toBuffer();
    const up = await app.inject({ method: "POST", url: `/api/products/${prod.id}/photo`, cookies, headers: { "content-type": "image/png" }, payload: png });
    expect(up.statusCode).toBe(200);
    const img = await app.inject({ method: "GET", url: up.json().product.photoUrl, cookies });
    expect(img.statusCode).toBe(200);
    expect((await sharp(img.rawPayload).metadata()).width).toBe(512);
    await app.close();
  });

  it("sauvegardes : liste, lecture, suppression, et cycle complet sauvegarde → restauration vérifiée → rétention", async () => {
    const store = new S3BackupStore(client, BUCKET);
    const ctx = { db, databaseUrl: process.env.DATABASE_URL!, store, passphrase: "phrase-de-passe-de-test-s3" };
    expect(await listBackups(store)).toEqual([]);
    const r = await backupVerifyPrune(ctx);
    expect(r.verify.problems).toEqual([]);
    expect(r.verify.ok).toBe(true);
    const listed = await listBackups(store);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.key).toBe(r.backup.key);
    expect((await store.get(r.backup.key))!.length).toBeGreaterThan(1000);
    expect(await store.get("backups/inexistant.dump.enc")).toBeNull();

    // une 2e sauvegarde, puis suppression explicite de la première
    const b2 = await createBackup({ ...ctx, now: () => new Date(Date.now() + 60_000) });
    expect((await verifyBackup(ctx, b2.key)).ok).toBe(true);
    await store.delete(r.backup.key);
    await store.delete(r.backup.key.replace(/\.dump\.enc$/, ".manifest.json"));
    expect((await listBackups(store)).map((e) => e.key)).toEqual([b2.key]);
  });
});

describe("choix du stockage des sauvegardes", () => {
  const cfg = (env: Record<string, string>) => loadConfig({ DATABASE_URL: "postgres://x/y", ...env } as NodeJS.ProcessEnv);
  it("avec un bucket : S3, partout", () => {
    expect(createBackupStorage(cfg({ NODE_ENV: "production", S3_BUCKET: "b" }))?.kind).toBe("s3");
  });
  it("en production sans bucket : refus (le disque du conteneur est effacé à chaque déploiement)", () => {
    expect(createBackupStorage(cfg({ NODE_ENV: "production" }))).toBeNull();
  });
  it("en production sans bucket mais avec un volume persistant déclaré : local accepté", () => {
    expect(createBackupStorage(cfg({ NODE_ENV: "production", BACKUP_ALLOW_LOCAL: "1" }))?.kind).toBe("local");
  });
  it("en développement : local", () => {
    expect(createBackupStorage(cfg({ NODE_ENV: "development" }))?.kind).toBe("local");
  });
});
