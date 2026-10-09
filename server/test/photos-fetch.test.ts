import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkLicense } from "../src/photos.js";
import { commonsSearchUrl, makeSheet, normalizeCommonsLicense, parseCommonsResponse, searchCommons, stripHtml, USER_AGENT, type FetchFn } from "../src/photos-fetch.js";

/*
 * No access to Wikimedia from the development environment yet: these tests use responses shaped like the
 * Commons API (generator=search + prop=imageinfo + extmetadata). They must be re-checked once against the live API.
 */
const page = (index: number, title: string, over: Record<string, unknown> = {}, meta: Record<string, string> = {}) => ({
  pageid: index, title, index,
  imageinfo: [{
    thumburl: `https://upload.wikimedia.org/thumb/${index}.jpg`, thumbwidth: 800, thumbheight: 600,
    url: `https://upload.wikimedia.org/${index}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    width: 2000, height: 1500, mime: "image/jpeg",
    extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" }, Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jean">Jean Dupont</a>' }, ...Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, { value: v }])) },
    ...over,
  }],
});
const response = (...pages: any[]) => ({ query: { pages: Object.fromEntries(pages.map((p) => [String(p.pageid), p])) } });

describe("licences Commons", () => {
  it("normalise les licences libres et rejette le reste", () => {
    expect(normalizeCommonsLicense("CC BY-SA 4.0")).toBe("CC-BY-SA-4.0");
    expect(normalizeCommonsLicense("CC BY 2.0")).toBe("CC-BY-2.0");
    expect(normalizeCommonsLicense("CC0")).toBe("CC0-1.0");
    expect(normalizeCommonsLicense("Public domain")).toBe("PD");
    expect(normalizeCommonsLicense("CC BY-NC 4.0")).toBeNull();
    expect(normalizeCommonsLicense("CC BY-ND 2.0")).toBeNull();
    expect(normalizeCommonsLicense("Fair use")).toBeNull();
    expect(normalizeCommonsLicense("GFDL")).toBeNull();
    expect(normalizeCommonsLicense("Attribution")).toBeNull();
    expect(normalizeCommonsLicense(undefined)).toBeNull();
  });
  it("toute licence produite passe le contrôle d'import", () => {
    for (const l of ["CC BY-SA 4.0", "CC BY 3.0", "CC0", "Public domain"]) {
      const lic = normalizeCommonsLicense(l)!;
      expect(() => checkLicense({ sourceName: "Wikimedia Commons", sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg", license: lic, author: "Jean" })).not.toThrow();
    }
  });
  it("retire le HTML de l'auteur", () => {
    expect(stripHtml('<a href="x">Jean &amp; Marie</a>')).toBe("Jean & Marie");
    expect(stripHtml(undefined)).toBeNull();
    expect(stripHtml("  ")).toBeNull();
  });
});

describe("réponse de l'API Commons", () => {
  it("garde les candidats utilisables, dans l'ordre de pertinence, avec auteur et licence", () => {
    const r = parseCommonsResponse(response(page(2, "File:Tomatoes b.jpg"), page(1, "File:Tomato a.jpg")));
    expect(r.map((c) => c.title)).toEqual(["File:Tomato a.jpg", "File:Tomatoes b.jpg"]);
    expect(r[0]).toMatchObject({ license: "CC-BY-SA-4.0", author: "Jean Dupont", mime: "image/jpeg" });
    expect(r[0]!.pageUrl).toContain("commons.wikimedia.org/wiki/");
  });
  it("écarte : licence non libre, auteur manquant (CC BY), trop petit, mauvais format, schémas, panoramas", () => {
    const r = parseCommonsResponse(response(
      page(1, "File:Ok.jpg"),
      page(2, "File:NC.jpg", {}, { LicenseShortName: "CC BY-NC 4.0" }),
      page(3, "File:NoAuthor.jpg", {}, { Artist: "" }),
      page(4, "File:Small.jpg", { width: 300, height: 200 }),
      page(5, "File:Anim.gif", { mime: "image/gif" }),
      page(6, "File:Tomato diagram.jpg"),
      page(7, "File:Pano.jpg", { width: 4000, height: 800 }),
    ));
    expect(r.map((c) => c.title)).toEqual(["File:Ok.jpg"]);
  });
  it("CC0 et domaine public sont acceptés sans auteur", () => {
    const r = parseCommonsResponse(response(page(1, "File:A.jpg", {}, { LicenseShortName: "CC0", Artist: "" }), page(2, "File:B.jpg", {}, { LicenseShortName: "Public domain", Artist: "" })));
    expect(r.map((c) => c.license)).toEqual(["CC0-1.0", "PD"]);
  });
  it("réponse vide ou inattendue : aucun candidat, pas d'erreur", () => {
    expect(parseCommonsResponse({})).toEqual([]);
    expect(parseCommonsResponse({ query: {} })).toEqual([]);
    expect(parseCommonsResponse(null)).toEqual([]);
  });
});

describe("requête", () => {
  it("construit une recherche de fichiers (espace de noms 6, bitmaps) avec les métadonnées de licence", () => {
    const u = new URL(commonsSearchUrl("green beans"));
    expect(u.origin + u.pathname).toBe("https://commons.wikimedia.org/w/api.php");
    expect(u.searchParams.get("gsrnamespace")).toBe("6");
    expect(u.searchParams.get("gsrsearch")).toBe("green beans filetype:bitmap");
    expect(u.searchParams.get("prop")).toBe("imageinfo");
    expect(u.searchParams.get("iiprop")).toContain("extmetadata");
    expect(u.searchParams.get("iiextmetadatafilter")).toContain("LicenseShortName");
  });
  it("envoie un User-Agent d'identification sans donnée personnelle", async () => {
    let seen: Record<string, string> | undefined;
    const f: FetchFn = async (_u, init) => ((seen = init?.headers), { ok: true, status: 200, json: async () => response(page(1, "File:Ok.jpg")), arrayBuffer: async () => new ArrayBuffer(0) });
    const r = await searchCommons("tomato", f);
    expect(r).toHaveLength(1);
    expect(seen?.["User-Agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).not.toMatch(/@/);
  });
  it("erreur HTTP : échec explicite", async () => {
    const f: FetchFn = async () => ({ ok: false, status: 429, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(searchCommons("x", f)).rejects.toThrow(/429/);
  });
});

describe("planche de contrôle", () => {
  it("assemble les candidats de plusieurs produits dans une image à regarder", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stage-"));
    const cands: Record<string, unknown[]> = {};
    for (const [k, color] of [["tomates", "#d33"], ["citrons", "#ee3"]] as const) {
      await mkdir(path.join(dir, k));
      cands[k] = [];
      for (let i = 0; i < 2; i++) {
        await sharp({ create: { width: 400, height: 300, channels: 3, background: color } }).jpeg().toFile(path.join(dir, k, `${i}.jpg`));
        cands[k]!.push({ license: "CC-BY-SA-4.0" });
      }
    }
    await writeFile(path.join(dir, "candidates.json"), JSON.stringify(cands));
    const file = path.join(dir, "sheet.png");
    await makeSheet(dir, ["tomates", "citrons"], file);
    const meta = await sharp(await readFile(file)).metadata();
    expect(meta.width).toBe(4 * 220);
    expect(meta.height).toBe(2 * (220 + 26));
  });
});
