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
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export function stripHtml(html: string | undefined): string | null {
  if (!html) return null;
  const t = html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  return t || null;
}

const BAD_TITLE = /\b(logo|icon|diagram|map|drawing|illustration|sketch|painting|stamp|flag|coat of arms|seed ?ling|plant ?ation|market stall|menu|poster|screenshot)\b/i;

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
    if (BAD_TITLE.test(p.title ?? "")) continue;
    const ratio = (ii.width ?? 1) / (ii.height ?? 1);
    if (ratio < 0.6 || ratio > 1.8) continue; // extreme panoramas / strips crop badly into a square tile
    const meta = ii.extmetadata ?? {};
    const license = normalizeCommonsLicense(meta.LicenseShortName?.value);
    if (!license) continue;
    const author = stripHtml(meta.Artist?.value);
    if (/^CC-BY/.test(license) && !author) continue; // attribution is mandatory: no author, no use
    out.push({
      title: p.title,
      pageUrl: ii.descriptionurl,
      thumbUrl: ii.thumburl ?? ii.url,
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

export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; arrayBuffer(): Promise<ArrayBuffer> }>;

export function commonsSearchUrl(query: string, limit = 12): string {
  const p = new URLSearchParams({
    action: "query", format: "json", 
    generator: "search", gsrsearch: `${query} filetype:bitmap`, gsrnamespace: "6", gsrlimit: String(limit),
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "800",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit|AttributionRequired",
  });
  return `${API}?${p.toString()}`;
}

export async function searchCommons(query: string, fetchFn: FetchFn): Promise<Candidate[]> {
  const res = await fetchFn(commonsSearchUrl(query), { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Commons API ${res.status} for "${query}"`);
  return parseCommonsResponse(await res.json());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- CLI ---------------------------------------------------------------------------------------------
async function cmdSearch(queriesPath: string, outDir: string, per: number) {
  const queries = JSON.parse(await readFile(queriesPath, "utf8")) as Record<string, string[] | string>;
  await mkdir(outDir, { recursive: true });
  const all: Record<string, Candidate[]> = {};
  for (const [key, qs] of Object.entries(queries)) {
    if (key.startsWith("_")) continue;
    const seen = new Set<string>();
    const picked: Candidate[] = [];
    for (const q of qs as string[]) {
      await sleep(400); // be polite to the API
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
      await sleep(250);
      const r = await (fetch as unknown as FetchFn)(c.thumbUrl, { headers: { "User-Agent": USER_AGENT } });
      if (!r.ok) continue;
      await writeFile(path.join(dir, `${i}.jpg`), await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize(800, 800, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer());
    }
    all[key] = picked;
    console.log(`${key.padEnd(24)} ${picked.length} candidate(s)`);
  }
  await writeFile(path.join(outDir, "candidates.json"), JSON.stringify(all, null, 2));
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

async function cmdSheet(outDir: string) {
  const cands = JSON.parse(await readFile(path.join(outDir, "candidates.json"), "utf8")) as Record<string, Candidate[]>;
  const keys = Object.keys(cands);
  await mkdir(path.join(outDir, "sheets"), { recursive: true });
  for (let i = 0; i < keys.length; i += 5) {
    const file = path.join(outDir, "sheets", `sheet-${String(i / 5 + 1).padStart(2, "0")}.png`);
    await makeSheet(outDir, keys.slice(i, i + 5), file);
    console.log(file);
  }
}

async function cmdManifest(outDir: string, selectionPath: string, manifestPath: string) {
  const cands = JSON.parse(await readFile(path.join(outDir, "candidates.json"), "utf8")) as Record<string, Candidate[]>;
  const selection = JSON.parse(await readFile(selectionPath, "utf8")) as Record<string, number>;
  const items = Object.entries(selection).map(([key, idx]) => {
    const c = cands[key]?.[idx];
    if (!c) throw new Error(`Aucun candidat #${idx} pour ${key}`);
    return {
      target: "initial", key, file: path.relative(path.dirname(manifestPath), path.join(outDir, key, `${idx}.jpg`)),
      sourceName: "Wikimedia Commons", sourceUrl: c.pageUrl, license: c.license, licenseUrl: c.licenseUrl, author: c.author,
    };
  });
  await writeFile(manifestPath, JSON.stringify({ items }, null, 2));
  console.log(`${items.length} entrée(s) écrites dans ${manifestPath}`);
}

if (process.argv[1] && /photos-fetch\.(ts|js)$/.test(process.argv[1])) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "search" && a && b) await cmdSearch(a, b, Number(c ?? 4));
  else if (cmd === "sheet" && a) await cmdSheet(a);
  else if (cmd === "manifest" && a && b && c) await cmdManifest(a, b, c);
  else console.log("Usage : photos-fetch search <queries.json> <outdir> [n] | sheet <outdir> | manifest <outdir> <selection.json> <manifest.json>");
}
