import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";

export const PHOTO_SIZE = 480;
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;

export interface PhotoStore {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; mime: string } | null>;
}

const KEY_RE = /^photos\/[0-9a-f]{64}\.webp$/;
const assertKey = (key: string) => {
  if (!KEY_RE.test(key)) throw new Error(`Invalid photo key: ${key}`);
};

export class LocalPhotoStore implements PhotoStore {
  constructor(private dir: string) {}
  async put(key: string, data: Buffer): Promise<void> {
    assertKey(key);
    const file = path.join(this.dir, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }
  async get(key: string) {
    assertKey(key);
    try {
      return { data: await readFile(path.join(this.dir, key)), mime: "image/webp" };
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
}

export class S3PhotoStore implements PhotoStore {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}
  async put(key: string, data: Buffer, mime: string): Promise<void> {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: mime }));
  }
  async get(key: string) {
    assertKey(key);
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { data: Buffer.from(await r.Body!.transformToByteArray()), mime: r.ContentType ?? "image/webp" };
    } catch (e: any) {
      if (e.name === "NoSuchKey") return null;
      throw e;
    }
  }
}

export function createPhotoStore(config: Config): PhotoStore {
  if (config.S3_BUCKET) {
    const client = new S3Client({
      region: config.S3_REGION ?? "auto",
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY_ID ?? "", secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? "" },
    });
    return new S3PhotoStore(client, config.S3_BUCKET);
  }
  return new LocalPhotoStore(config.PHOTO_DIR);
}

/** Normalises any input photo to a square WebP tile: one size, light, same look everywhere. */
export async function processImage(input: Buffer) {
  if (input.length > MAX_INPUT_BYTES) throw new HttpError(413, "image_too_large", "Image trop volumineuse (8 Mo max)");
  try {
    const { data, info } = await sharp(input, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const hash = createHash("sha256").update(data).digest("hex");
    return { data, width: info.width, height: info.height, hash, key: `photos/${hash}.webp` };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "invalid_image", "Fichier image illisible");
  }
}

// ---- Politique de licences -------------------------------------------------------------------
// Acceptées : domaine public / CC0, CC BY, CC BY-SA, licences « libres d'usage » des banques d'images
// (Pexels, Pixabay, Unsplash — conditions à relire avant import) et photos faites par la famille.
// Refusées : NC, ND, « tous droits réservés », images de sites marchands, licence inconnue.
const ATTRIBUTION_LICENSES = /^CC-BY(-SA)?-[1-4]\.\d$/;
const FREE_LICENSES = new Set(["CC0-1.0", "PD", "PEXELS", "PIXABAY", "UNSPLASH", "OWN"]);

export interface PhotoMeta {
  sourceName: string;
  sourceUrl?: string | null;
  license: string;
  licenseUrl?: string | null;
  author?: string | null;
}

export function checkLicense(meta: PhotoMeta): { attributionRequired: boolean; attributionText: string | null } {
  const lic = meta.license.trim().toUpperCase().replace(/\s+/g, "-");
  if (/-N[CD]/.test(lic)) throw new HttpError(400, "license_refused", `Licence refusée (${meta.license}) : usage restreint`);
  const needsAttribution = ATTRIBUTION_LICENSES.test(lic);
  if (!needsAttribution && !FREE_LICENSES.has(lic)) {
    throw new HttpError(400, "license_refused", `Licence non reconnue : ${meta.license}`);
  }
  if (lic !== "OWN" && !meta.sourceUrl) throw new HttpError(400, "provenance_missing", "URL d'origine obligatoire");
  if (needsAttribution && !meta.author) throw new HttpError(400, "provenance_missing", "Auteur obligatoire pour cette licence");
  const attributionText = needsAttribution
    ? `${meta.author} — ${meta.license.toUpperCase().replace(/-/g, " ")} — ${meta.sourceName}`
    : null;
  return { attributionRequired: needsAttribution, attributionText };
}

/** Stores the processed image and records its provenance. Returns the new (immutable) asset id. */
export async function savePhotoAsset(
  db: Db,
  store: PhotoStore,
  input: Buffer,
  meta: PhotoMeta,
  opts: { ownerFamilyId: string | null; importedBy?: string | null },
): Promise<string> {
  const { attributionRequired, attributionText } = checkLicense(meta);
  const img = await processImage(input);
  await store.put(img.key, img.data, "image/webp");
  const r = await db.query<{ id: string }>(
    `INSERT INTO photo_assets (owner_family_id, storage_key, content_hash, mime, width, height, bytes,
        source_name, source_url, license, license_url, author, attribution_required, attribution_text, imported_by)
     VALUES ($1,$2,$3,'image/webp',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      opts.ownerFamilyId,
      img.key,
      img.hash,
      img.width,
      img.height,
      img.data.length,
      meta.sourceName,
      meta.sourceUrl ?? null,
      meta.license.trim().toUpperCase().replace(/\s+/g, "-"),
      meta.licenseUrl ?? null,
      meta.author ?? null,
      attributionRequired,
      attributionText,
      opts.importedBy ?? null,
    ],
  );
  return r.rows[0]!.id;
}
