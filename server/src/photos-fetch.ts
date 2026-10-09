/*
 * Photo search on Wikimedia Commons, with provenance read from each file's own metadata.
 *
 *   photos-fetch search   <queries.json> <outdir> [perProduct=4]   → candidates + downloaded thumbnails
 *   photos-fetch sheet    <outdir>                                  → contact sheets to look at and choose from
 *   photos-fetch manifest <outdir> <selection.json> <manifest.json> → input for `photos-cli import`
 *
 * Only files whose licence is on our allow-list (CC0, public domain, CC BY, CC BY-SA) are kept; the licence,
 * author and page URL are recorded for the credits screen. Nothing here writes to the database.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";

const API = "https://commons.wikimedia.org/w/api.php";
// Wikimedia asks for an identifying User-Agent (no personal data).
export const USER_AGENT = "SmartCourse/0.1 (family shopping-list app; +https://github.com/adilam2026/SmartCourse)";

export interface Candidate {
  title: string;
  pageUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  mime: string;
  license: string;
  licenseUrl: string | null;
  author: string | null;
}

/** "CC BY-SA 4.0" → "CC-BY-SA-4.0"; anything we do not accept → null. */
export function normalizeCommonsLicense(shortName: string | undefined): string | null {
  if (!shortName) return null;
  const s = shortName.trim().toLowerCase().replace(/\s+/g, " ");
  if (/non-?commercial|\bnc\b|no ?deriv|\bnd\b|fair use|all rights reserved|gfdl|copyrighted/.test(s)) return null;
  if (/^cc0/.test(s) || s === "public domain" || /^pd\b/.test(s) || s.startsWith("public domain")) return /^cc0/.test(s) ? "CC0-1.0" : "PD";
  let m = /^cc by-sa (\d\.\d)/.exec(s);
  if (m) return `CC-BY-SA-${m[1]}`;
  m = /^cc by (\d\.\d)/.exec(s);
  if (m) return `CC-BY-${m[1]}`;
  return null;
}

/**
 * The API now hands out thumbnails on thumb.wikimedia.org; the same path is served by upload.wikimedia.org
 * (which is the host we are allowed to reach). Tracking parameters are dropped.
 */
export function thumbOnUploadHost(url: string): string {
  const u = new URL(url);
  if (u.hostname === "thumb.wikimedia.org") u.hostname = "upload.wikimedia.org";
  u.search = "";
  return u.toString();
}

export function stripHtml(html: string | undefined): string | null {
  if (!html) return null;
  const t = html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  return t || null;
}

// We want a clean picture of the product itself: no plants/flowers, fields, markets, dishes, people or drawings.
const BAD_TITLE = /\b(logo|icon|diagram|map|drawing|illustration|sketch|painting|stamp|flag|coat of arms|seedling|plantation|market|stall|menu|poster|screenshot|flowers?|blossoms?|blooms?|plants?|trees?|fields?|gardens?|farms?|farmers?|harvest(ing)?|vendors?|shops?|supermarket|restaurant|cooking|cooked|recipe|dish|soup|salad|botanical|woman|women|man|men|girl|boy|child|children|people|person|hands?|naked|nude|nudity|erotic|sexy|sexual|porn|lingerie|bikini|underwear|topless|butt|buttocks)\b/i;

/** Pure: turns a Commons `query` response into usable candidates, best search rank first. */
export function parseCommonsResponse(json: any, minSide = 600): Candidate[] {
  const pages = Object.values(json?.query?.pages ?? {}) as any[];
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: Candidate[] = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    if (!/^image\/(jpeg|png|webp)$/.test(ii.mime ?? "")) continue;
    if (Math.min(ii.width ?? 0, ii.height ?? 0) < minSide) continue;
    const meta0 = ii.extmetadata ?? {};
    if (BAD_TITLE.test(`${p.title ?? ""} ${stripHtml(meta0.ImageDescription?.value) ?? ""} ${stripHtml(meta0.ObjectName?.value) ?? ""}`)) continue;
    const ratio = (ii.width ?? 1) / (ii.height ?? 1);
    if (ratio < 0.6 || ratio > 1.8) continue; // extreme panoramas / strips crop badly into a square tile
    const meta = ii.extmetadata ?? {};
    const license = normalizeCommonsLicense(meta.LicenseShortName?.value);
    if (!license) continue;
    const rawAuthor = stripHtml(meta.Artist?.value);
    // Commons sometimes fills the field with a disclaimer instead of a name: that is not an attribution.
    const author = rawAuthor && !/no machine-readable author|unknown author|author unknown|^unknown\b|anonymous/i.test(rawAuthor) ? rawAuthor : null;
    if (/^CC-BY/.test(license) && !author) continue; // attribution is mandatory: no author, no use
    out.push({
      title: p.title,
      pageUrl: ii.descriptionurl,
      thumbUrl: thumbOnUploadHost(ii.thumburl ?? ii.url),
      width: ii.width,
      height: ii.height,
      mime: ii.mime,
      license,
      licenseUrl: meta.LicenseUrl?.value ?? null,
      author,
    });
  }
  return out;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>;

/**
 * GET with automatic retry on 429/5xx. Wikimedia throttles shared IP addresses and says how long to wait
 * (Retry-After); we honour it (capped) with a growing minimum, and give up after `tries` attempts.
 */
export async function getWithRetry(
  fetchFn: FetchFn, url: string, headers: Record<string, string>,
  opts: { tries?: number; wait?: (ms: number) => Promise<void>; maxWaitMs?: number } = {},
): Promise<FetchResponse> {
  const tries = opts.tries ?? 8;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cap = opts.maxWaitMs ?? 90_000;
  let last: FetchResponse | undefined;
  for (let attempt = 1; attempt <= tries; attempt++) {
    last = await fetchFn(url, { headers });
    if (last.ok || (last.status !== 429 && last.status < 500)) return last;
    const asked = Number(last.headers?.get("retry-after") ?? 0);
    await wait(Math.min(cap, Math.max(asked * 1000, 2000 * attempt)));
  }
  return last!;
}

export function commonsSearchUrl(query: string, limit = 25): string {
  const p = new URLSearchParams({
    action: "query", format: "json", 
    generator: "search", gsrsearch: `${query} filetype:bitmap`, gsrnamespace: "6", gsrlimit: String(limit),
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "960",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit|AttributionRequired|ImageDescription|ObjectName",
  });
  return `${API}?${p.toString()}`;
}

export async function searchCommons(query: string, fetchFn: FetchFn): Promise<Candidate[]> {
  const res = await getWithRetry(fetchFn, commonsSearchUrl(query), { "User-Agent": USER_AGENT, Accept: "application/json" });
  if (!res.ok) throw new Error(`Commons API ${res.status} for "${query}"`);
  return parseCommonsResponse(await res.json());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Pause between requests; raise it (PHOTO_PACE_MS) when Wikimedia throttles a shared IP address. */
const PACE = Number(process.env.PHOTO_PACE_MS ?? 1200);

// ---- CLI ---------------------------------------------------------------------------------------------
async function cmdSearch(queriesPath: string, outDir: string, per: number) {
  const queries = JSON.parse(await readFile(queriesPath, "utf8")) as Record<string, string[] | string>;
  await mkdir(outDir, { recursive: true });
  // Resumable: candidates.json is rewritten after every product, and finished products are skipped on a re-run.
  const file = path.join(outDir, "candidates.json");
  let all: Record<string, Candidate[]> = {};
  try {
    all = JSON.parse(await readFile(file, "utf8"));
  } catch {
    /* first run */
  }
  for (const [key, qs] of Object.entries(queries)) {
    if (key.startsWith("_") || all[key]) continue;
    // The API throttles shared IPs hard: a product that still fails after the built-in retries is retried later
    // in this run, then skipped (a re-run picks it up, since only finished products are recorded).
    let lastError: unknown;
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        await searchOne(key, qs as string[], per, outDir, all, file);
        done = true;
      } catch (e) {
        lastError = e;
        console.warn(`  ${key}: tentative ${attempt} échouée (${(e as Error).message}); pause 60 s`);
        await sleep(60_000);
      }
    }
    if (!done) console.warn(`  ${key}: abandonné pour cette passe (${(lastError as Error).message})`);
  }
}

async function searchOne(key: string, qs: string[], per: number, outDir: string, all: Record<string, Candidate[]>, file: string) {
  {
    const seen = new Set<string>();
    const picked: Candidate[] = [];
    for (const q of qs as string[]) {
      await sleep(PACE); // be polite to the API
      for (const c of await searchCommons(q, fetch as unknown as FetchFn)) {
        if (seen.has(c.pageUrl) || picked.length >= per) continue;
        seen.add(c.pageUrl);
        picked.push(c);
      }
      if (picked.length >= per) break;
    }
    const dir = path.join(outDir, key);
    await mkdir(dir, { recursive: true });
    for (const [i, c] of picked.entries()) {
      await sleep(PACE);
      try {
        const r = await getWithRetry(fetch as unknown as FetchFn, c.thumbUrl, { "User-Agent": USER_AGENT });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await writeFile(path.join(dir, `${i}.jpg`), await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize(800, 800, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer());
      } catch (e) {
        console.warn(`  téléchargement impossible (${(e as Error).message}) : ${c.title}`);
        c.license = ""; // no local file for this candidate: keep it out of the selection
      }
    }
    all[key] = picked; // indices stay aligned with files {0..n}.jpg
    await writeFile(file, JSON.stringify(all, null, 2));
    console.log(`${key.padEnd(24)} ${picked.length} candidate(s)`);
  }
}

export async function makeSheet(outDir: string, keys: string[], file: string, cols = 4, tile = 220): Promise<void> {
  const cands = JSON.parse(await readFile(path.join(outDir, "candidates.json"), "utf8")) as Record<string, Candidate[]>;
  const rows = keys.length;
  const labelH = 26;
  const composites: OverlayOptions[] = [];
  for (const [r, key] of keys.entries()) {
    for (let i = 0; i < cols; i++) {
      const x = i * tile, y = r * (tile + labelH);
      try {
        const img = await sharp(path.join(outDir, key, `${i}.jpg`)).resize(tile - 4, tile - 4, { fit: "cover" }).toBuffer();
        composites.push({ input: img, left: x + 2, top: y + 2 });
      } catch {
        /* no candidate #i */
      }
      const lic = cands[key]?.[i]?.license ?? "";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${labelH}"><rect width="100%" height="100%" fill="#fff"/><text x="4" y="18" font-family="sans-serif" font-size="14" fill="#000">${key} #${i} ${lic}</text></svg>`;
      composites.push({ input: Buffer.from(svg), left: x, top: y + tile });
    }
  }
  await sharp({ create: { width: cols * tile, height: rows * (tile + labelH), channels: 3, background: "#ffffff" } }).composite(composites).png().toFile(file);
}

async function cmdSheet(outDir: string, from = 0) {
  const cands = JSON.parse(await readFile(path.join(outDir, "candidates.json"), "utf8")) as Record<string, Candidate[]>;
  const keys = Object.keys(cands).slice(from);
  await mkdir(path.join(outDir, "sheets"), { recursive: true });
  for (let i = 0; i < keys.length; i += 5) {
    const file = path.join(outDir, "sheets", `sheet-from${from}-${String(i / 5 + 1).padStart(2, "0")}.png`);
    await makeSheet(outDir, keys.slice(i, i + 5), file);
    console.log(file);
  }
}

async function cmdManifest(outDir: string, selectionPath: string, manifestPath: string) {
  const cands = JSON.parse(await readFile(path.join(outDir, "candidates.json"), "utf8")) as Record<string, Candidate[]>;
  const selection = JSON.parse(await readFile(selectionPath, "utf8")) as Record<string, number>;
  const filesDir = path.join(path.dirname(manifestPath), "files");
  await mkdir(filesDir, { recursive: true });
  const items = [];
  for (const [key, idx] of Object.entries(selection)) {
    const c = cands[key]?.[idx];
    if (!c) throw new Error(`Aucun candidat #${idx} pour ${key}`);
    // The chosen picture travels with the app (repository), so a deployment never depends on Wikimedia being reachable.
    await copyFile(path.join(outDir, key, `${idx}.jpg`), path.join(filesDir, `${key}.jpg`));
    items.push({
      target: "initial", key, file: `files/${key}.jpg`,
      sourceName: "Wikimedia Commons", sourceUrl: c.pageUrl, license: c.license, licenseUrl: c.licenseUrl, author: c.author,
    });
  }
  await writeFile(manifestPath, JSON.stringify({ items }, null, 2) + "\n");
  console.log(`${items.length} entrée(s) écrites dans ${manifestPath}`);
}

async function cmdCredits(manifestPath: string, outPath: string) {
  const m = JSON.parse(await readFile(manifestPath, "utf8")) as { items: { key: string; sourceUrl: string; license: string; licenseUrl: string | null; author: string | null }[] };
  const names = new Map<string, string>(); // catalogue key → display name, read from the generated migration
  for (const mm of (await readFile(path.join(path.dirname(new URL(import.meta.url).pathname), "../migrations/003_catalog.sql"), "utf8")).matchAll(/\('([a-z0-9-]+)','[a-z]+','((?:[^']|'')+)',\d+\)/g)) names.set(mm[1]!, mm[2]!.replace(/''/g, "'"));
  const rows = m.items.map((i) => `| ${names.get(i.key) ?? i.key} | ${i.author ?? "—"} | ${i.license} | [page d'origine](${i.sourceUrl}) |`);
  const out = ["# Crédits des photos du catalogue", "", "Généré depuis `server/catalog-photos/manifest.json` (provenance lue dans les métadonnées de chaque fichier Wikimedia Commons). Les photos prises par la famille ne figurent pas ici.", "", "| Produit | Auteur | Licence | Source |", "|---|---|---|---|", ...rows, ""].join("\n");
  await writeFile(outPath, out);
  console.log(`${rows.length} crédit(s) écrits dans ${outPath}`);
}

if (process.argv[1] && /photos-fetch\.(ts|js)$/.test(process.argv[1])) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "search" && a && b) await cmdSearch(a, b, Number(c ?? 4));
  else if (cmd === "sheet" && a) await cmdSheet(a, Number(b ?? 0));
  else if (cmd === "manifest" && a && b && c) await cmdManifest(a, b, c);
  else if (cmd === "credits" && a && b) await cmdCredits(a, b);
  else console.log("Usage : photos-fetch credits <manifest.json> <out.md> | search <queries.json> <outdir> [n] | sheet <outdir> | manifest <outdir> <selection.json> <manifest.json>");
}
