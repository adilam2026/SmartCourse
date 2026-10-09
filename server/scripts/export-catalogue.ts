/*
 * Exports the catalogue images as a folder (then zipped) — the 80 generated pictures, one per reference:
 *   images/NN_cle.webp         the images currently shipped with the app (server/catalog-photos/files)
 *   catalogue.csv / .json      one row per reference (all 80): exact name, brand, image file or "sans image", provenance
 *   planche-apercu.png         contact sheet of the 80 references (missing images are shown as such)
 *   CREDITS.md                 attribution for every image
 *   LISEZMOI.txt
 * Brand: only what is actually decided. No branded pack has been retained yet, so the brand column stays empty
 * rather than guessing one.
 */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";

const OUT = path.resolve(process.argv[2] ?? "../exports/catalogue-images");
const PHOTOS = path.resolve("catalog-photos");
const manifest = JSON.parse(await readFile(path.join(PHOTOS, "manifest.json"), "utf8")) as {
  items: { key: string; file: string; sourceName: string; sourceUrl?: string | null; license: string; licenseUrl?: string | null; author?: string | null }[];
};
const byKey = new Map(manifest.items.map((i) => [i.key, i]));

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://smart:smart@localhost:5432/smartcourse" });
await db.connect();
const rows = (await db.query(
  `SELECT i.key, i.name, i.position, c.key AS ckey, c.label AS category, c.position AS cpos
     FROM initial_catalog i JOIN categories c ON c.key = i.category ORDER BY c.position, i.position`,
)).rows as { key: string; name: string; category: string; ckey: string }[];
await db.end();
if (rows.length !== 80) throw new Error(`Catalogue initial : ${rows.length} références au lieu de 80`);

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, "images"), { recursive: true });

type Row = Record<string, string>;
const table: Row[] = [];
const tiles: { n: number; name: string; file: string | null; license: string }[] = [];
for (const [idx, r] of rows.entries()) {
  const n = idx + 1;
  const nn = String(n).padStart(2, "0");
  const m = byKey.get(r.key);
  let file = "";
  if (m) {
    file = `images/${nn}_${r.key}.webp`;
    await copyFile(path.join(PHOTOS, m.file), path.join(OUT, file));
  }
  table.push({
    numero: String(n), categorie: r.category, cle: r.key, nom_exact: r.name,
    marque: "", // one generic reference per product: no brand variants
    statut_image: m ? "image" : "SANS IMAGE",
    fichier_image: file,
    source: m?.sourceName ?? "", auteur: m?.author ?? "", licence: m?.license ?? "", url_licence: m?.licenseUrl ?? "", page_origine: m?.sourceUrl ?? "",
    remarque: m ? "" : "aucune image",
  });
  tiles.push({ n, name: r.name, file: m ? path.join(OUT, file) : null, license: m?.license ?? "" });
}

// ---- CSV (semicolon + BOM: opens correctly in French Excel) and JSON
const cols = Object.keys(table[0]!);
const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
await writeFile(path.join(OUT, "catalogue.csv"), "﻿" + [cols.join(";"), ...table.map((t) => cols.map((c) => esc(t[c]!)).join(";"))].join("\r\n") + "\r\n");
await writeFile(path.join(OUT, "catalogue.json"), JSON.stringify(table, null, 2) + "\n");

// ---- provenance
const withImg = table.filter((t) => t.statut_image === "image");
await writeFile(path.join(OUT, "CREDITS.md"), [
  "# Provenance des images", "",
  `${withImg.length} images, toutes « Image générée avec ChatGPT ». Aucune licence ni aucun auteur externe n'est revendiqué : ne pas en inventer.`, "",
].join("\n"));

// ---- contact sheet (whole picture on white, like the app: no cropping)
const COLS = 8, TILE = 200, LABEL = 46, GAP = 6, HEAD = 70;
const W = COLS * (TILE + GAP) + GAP;
const nrows = Math.ceil(tiles.length / COLS);
const H = HEAD + nrows * (TILE + LABEL + GAP) + GAP;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&#39;");
const wrap = (s: string, max = 24): string[] => {
  const words = s.split(" "); const lines: string[] = []; let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > max) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
};
const comps: sharp.OverlayOptions[] = [];
comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HEAD}"><rect width="100%" height="100%" fill="#fff"/><text x="12" y="30" font-family="sans-serif" font-size="22" font-weight="bold" fill="#111">Catalogue : ${withImg.length} images sur ${tiles.length} références</text><text x="12" y="56" font-family="sans-serif" font-size="14" fill="#555">Cases grises = sans image (${tiles.length - withImg.length}). Images entières sur fond blanc, comme dans l'application. Provenance : CREDITS.md</text></svg>`), left: 0, top: 0 });
for (const [i, t] of tiles.entries()) {
  const x = GAP + (i % COLS) * (TILE + GAP);
  const y = HEAD + GAP + Math.floor(i / COLS) * (TILE + LABEL + GAP);
  if (t.file) comps.push({ input: await sharp(t.file).resize(TILE, TILE, { fit: "contain", background: "#ffffff" }).toBuffer(), left: x, top: y });
  else comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><rect width="100%" height="100%" fill="#e3e6e9"/><text x="${TILE / 2}" y="${TILE / 2 + 5}" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="bold" fill="#6b7580">SANS IMAGE</text></svg>`), left: x, top: y });
  const lines = wrap(t.name);
  comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${LABEL}"><rect width="100%" height="100%" fill="#fff"/><text x="3" y="16" font-family="sans-serif" font-size="13" fill="#888">${String(t.n).padStart(2, "0")}</text>${lines.map((l, k) => `<text x="${TILE / 2}" y="${16 + k * 15}" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#111" ${k === 0 ? 'dx="8"' : ""}>${xml(l)}</text>`).join("")}</svg>`), left: x, top: y + TILE });
}
await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } }).composite(comps).png().toFile(path.join(OUT, "planche-apercu.png"));

await writeFile(path.join(OUT, "LISEZMOI.txt"), [
  "SmartCourse — export des images du catalogue", "",
  "images/             les images actuelles (WebP 512 px), nommées NN_cle.webp (NN = numéro dans catalogue.csv)",
  "catalogue.csv       80 lignes, séparateur « ; », UTF-8 : numéro, catégorie, nom exact du produit, marque, statut de l'image, fichier, source, auteur, licence, page d'origine, remarque",
  "catalogue.json     mêmes informations, lisibles par un programme",
  "planche-apercu.png  vue d'ensemble des 80 références (cases grises = sans image)",
  "CREDITS.md          provenance (images générées avec ChatGPT)", "",
  "Une seule référence générique par produit (pas de variantes de marque) ; la colonne marque est vide.",
  "",
].join("\n"));

console.log(JSON.stringify({ out: OUT, references: tiles.length, avecImage: withImg.length, sansImage: tiles.length - withImg.length }));
