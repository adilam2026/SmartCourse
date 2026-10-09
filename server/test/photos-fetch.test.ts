import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkLicense } from "../src/photos.js";
import { commonsSearchUrl, getWithRetry, makeSheet, thumbOnUploadHost, normalizeCommonsLicense, parseCommonsResponse, searchCommons, stripHtml, USER_AGENT, type FetchFn } from "../src/photos-fetch.js";

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

describe("miniatures", () => {
  it("passe de thumb.wikimedia.org à upload.wikimedia.org et retire les paramètres de suivi", () => {
    expect(thumbOnUploadHost("https://thumb.wikimedia.org/wikipedia/commons/thumb/8/89/Tomato_je.jpg/960px-Tomato_je.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo")).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Tomato_je.jpg/960px-Tomato_je.jpg");
    expect(thumbOnUploadHost("https://upload.wikimedia.org/wikipedia/commons/8/89/A.jpg?x=1")).toBe("https://upload.wikimedia.org/wikipedia/commons/8/89/A.jpg");
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
      page(8, "File:Tomato plant.jpg"),
      page(9, "File:Potato flowers 2016.jpg"),
      page(10, "File:Tomatoes.jpg", {}, { ImageDescription: "Farmer selling tomatoes at the market" }),
      page(11, "File:Naked-Male-Nude-Skin-Strawberries-Fruit-Butt-Erotic.jpg"),
      page(12, "File:Strawberries.jpg", {}, { ImageDescription: "Sexy model with strawberries" }),
    ));
    expect(r.map((c) => c.title)).toEqual(["File:Ok.jpg"]);
    // a placeholder instead of a real author name does not count as attribution (CC BY / CC BY-SA)
    const vague = parseCommonsResponse(response(page(1, "File:Vague.jpg", {}, { Artist: "No machine-readable author provided. Someone assumed (based on copyright claims)." }), page(2, "File:Good.jpg")));
    expect(vague.map((c) => c.title)).toEqual(["File:Good.jpg"]);
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
    const f: FetchFn = async () => ({ ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(searchCommons("x", f)).rejects.toThrow(/404/);
  });
});

describe("reprise sur limitation (429)", () => {
  const resp = (status: number, retryAfter?: string): any => ({ ok: status < 400, status, headers: { get: (n: string) => (n === "retry-after" ? retryAfter ?? null : null) }, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
  it("attend le délai demandé puis réussit", async () => {
    const waits: number[] = [];
    const seq = [resp(429, "36"), resp(429, "1"), resp(200)];
    const r = await getWithRetry(async () => seq.shift(), "u", {}, { wait: async (ms) => void waits.push(ms) });
    expect(r.ok).toBe(true);
    expect(waits).toEqual([36_000, 4_000]); // Retry-After respecté ; sinon délai minimal croissant
  });
  it("plafonne l'attente et abandonne après le nombre d'essais, en renvoyant le dernier échec", async () => {
    const waits: number[] = [];
    let calls = 0;
    const r = await getWithRetry(async () => (calls++, resp(429, "600")), "u", {}, { tries: 3, wait: async (ms) => void waits.push(ms), maxWaitMs: 90_000 });
    expect(r.status).toBe(429);
    expect(calls).toBe(3);
    expect(waits).toEqual([90_000, 90_000, 90_000]);
  });
  it("ne rejoue pas une erreur définitive (404)", async () => {
    let calls = 0;
    const r = await getWithRetry(async () => (calls++, resp(404)), "u", {}, { wait: async () => {} });
    expect(r.status).toBe(404);
    expect(calls).toBe(1);
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
