import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";

export const PHOTO_SIZE = 512;
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
/** A WebP square that is already this small is stored as is (the generated catalogue pack): no second lossy pass. */
const PASSTHROUGH_MAX_BYTES = 120_000;
export const GENERATED_SOURCE = "Image générée avec ChatGPT";

/** Anything with `.query` — the pool, or a client inside a transaction. */
export type Queryable = Pick<Db, "query">;

export interface PhotoStore {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; mime: string } | null>;
  /** Removes the file; returns the number of bytes freed (0 when it was not there). */
  delete(key: string): Promise<number>;
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
  async delete(key: string): Promise<number> {
    assertKey(key);
    const file = path.join(this.dir, key);
    try {
      const { size } = await stat(file);
      await rm(file);
      return size;
    } catch (e: any) {
      if (e.code === "ENOENT") return 0;
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
  async delete(key: string): Promise<number> {
    assertKey(key);
    let size = 0;
    try {
      size = (await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))).ContentLength ?? 0;
    } catch (e: any) {
      if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return 0;
      throw e;
    }
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    return size;
  }
}

export function s3ClientFromConfig(config: Config): S3Client {
  return new S3Client({
    region: config.S3_REGION ?? "auto",
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: config.S3_ACCESS_KEY_ID ?? "", secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? "" },
  });
}

export function createPhotoStore(config: Config): PhotoStore {
  if (config.S3_BUCKET) return new S3PhotoStore(s3ClientFromConfig(config), config.S3_BUCKET);
  return new LocalPhotoStore(config.PHOTO_DIR);
}

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
  hash: string;
  key: string;
  sourceSha256: string;
}

/**
 * Normalises any picture to a 512 × 512 WebP on a WHITE background, WITHOUT cropping (the whole picture is kept,
 * padded with white). This keeps storage small (typically 15–40 KB) whatever the phone camera produced.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length > MAX_INPUT_BYTES) throw new HttpError(413, "image_too_large", "Image trop volumineuse (8 Mo max)");
  try {
    const sourceSha256 = createHash("sha256").update(input).digest("hex");
    const meta = await sharp(input, { limitInputPixels: 50_000_000 }).metadata();
    let data: Buffer;
    if (meta.format === "webp" && meta.width === PHOTO_SIZE && meta.height === PHOTO_SIZE && !meta.hasAlpha && input.length <= PASSTHROUGH_MAX_BYTES) {
      data = input;
    } else {
      data = await sharp(input, { limitInputPixels: 50_000_000 })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "contain", background: "#ffffff" })
        .webp({ quality: 80 })
        .toBuffer();
    }
    const hash = createHash("sha256").update(data).digest("hex");
    return { data, width: PHOTO_SIZE, height: PHOTO_SIZE, hash, key: `photos/${hash}.webp`, sourceSha256 };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "invalid_image", "Fichier image illisible");
  }
}

// ---- Politique de licences -------------------------------------------------------------------
// Acceptées : domaine public / CC0, CC BY, CC BY-SA, licences « libres d'usage » des banques d'images
// (Pexels, Pixabay, Unsplash — conditions à relire avant import), photos faites par la famille, et les
// images générées par nous (« Image générée avec … ») pour lesquelles AUCUNE licence externe n'est revendiquée.
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

export const isGeneratedMeta = (m: Pick<PhotoMeta, "license">): boolean => m.license.trim().toUpperCase() === "GENERATED";

export function checkLicense(meta: PhotoMeta): { attributionRequired: boolean; attributionText: string | null } {
  const lic = meta.license.trim().toUpperCase().replace(/\s+/g, "-");
  if (lic === "GENERATED") {
    // Not a licence: the marker for pictures we generated. It is only valid with an explicit "Image générée…" origin,
    // so it cannot be used to wave through a picture taken from somewhere else.
    if (!/^image générée/i.test(meta.sourceName.trim())) throw new HttpError(400, "provenance_missing", "Origine « Image générée avec … » obligatoire");
    if (meta.sourceUrl || meta.author || meta.licenseUrl) throw new HttpError(400, "provenance_invalid", "Une image générée ne porte ni auteur, ni URL, ni licence externe");
    return { attributionRequired: false, attributionText: null };
  }
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

export interface PreparedPhoto {
  img: ProcessedImage;
  meta: PhotoMeta;
  attributionRequired: boolean;
  attributionText: string | null;
}

/** Step 1 (no database): validate provenance, process the picture, write the file. Safe to repeat: the key is the content hash. */
export async function preparePhoto(store: PhotoStore, input: Buffer, meta: PhotoMeta): Promise<PreparedPhoto> {
  const { attributionRequired, attributionText } = checkLicense(meta);
  const img = await processImage(input);
  await store.put(img.key, img.data, "image/webp");
  return { img, meta, attributionRequired, attributionText };
}

/** Step 2: record the (immutable) asset. Usable inside a transaction so that insert + link happen together. */
export async function insertPhotoAsset(q: Queryable, p: PreparedPhoto, opts: { ownerFamilyId: string | null; importedBy?: string | null }): Promise<string> {
  const { img, meta } = p;
  const r = await q.query<{ id: string }>(
    `INSERT INTO photo_assets (owner_family_id, storage_key, content_hash, mime, width, height, bytes,
        source_name, source_url, license, license_url, author, attribution_required, attribution_text, imported_by,
        source_sha256, generated)
     VALUES ($1,$2,$3,'image/webp',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
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
      p.attributionRequired,
      p.attributionText,
      opts.importedBy ?? null,
      img.sourceSha256,
      isGeneratedMeta(meta),
    ],
  );
  return r.rows[0]!.id;
}

/** Stores the processed image and records its provenance. Returns the new (immutable) asset id. */
export async function savePhotoAsset(
  db: Queryable,
  store: PhotoStore,
  input: Buffer,
  meta: PhotoMeta,
  opts: { ownerFamilyId: string | null; importedBy?: string | null },
): Promise<string> {
  return insertPhotoAsset(db, await preparePhoto(store, input, meta), opts);
}
