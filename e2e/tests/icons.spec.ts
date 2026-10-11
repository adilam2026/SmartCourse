import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/* Nouvelle icône : tailles, manifeste PWA (any / maskable / monochrome) et marges — rien du panier ni des produits en dehors des zones sûres. */
const RES = new URL("../../android/app/src/main/res/", import.meta.url).pathname;

/** Largest distance (as a fraction of the image width) from the centre to a pixel that is NOT background / NOT transparent. */
async function farthest(page: import("@playwright/test").Page, b64: string, mode: "alpha" | "bg", bg?: [number, number, number]) {
  return page.evaluate(
    async ({ b64, mode, bg }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bin], { type: "image/png" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
      let far = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const solid = mode === "alpha" ? data[i + 3]! > 24 : Math.abs(data[i]! - bg![0]) + Math.abs(data[i + 1]! - bg![1]) + Math.abs(data[i + 2]! - bg![2]) > 40;
          if (solid) far = Math.max(far, Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) / width);
        }
      return { far, w: width, h: height };
    },
    { b64, mode, bg },
  );
}
const b64 = (p: string) => readFileSync(p).toString("base64");

test("PWA : icônes servies aux bonnes tailles, manifeste avec any / maskable / monochrome", async ({ page, request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  const purposes = manifest.icons.map((i: any) => `${i.src}|${i.purpose ?? "any"}`);
  expect(purposes).toEqual(expect.arrayContaining(["/icons/icon-192.png|any", "/icons/icon-512.png|any", "/icons/icon-maskable-512.png|maskable", "/icons/icon-monochrome-512.png|monochrome"]));
  for (const [path, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-512.png", 512], ["icon-monochrome-512.png", 512], ["badge-96.png", 96]] as const) {
    const r = await request.get(`/icons/${path}`);
    expect(r.status(), path).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
    const body = await r.body();
    expect(body.readUInt32BE(16), path).toBe(size); // largeur (IHDR)
    expect(body.readUInt32BE(20), path).toBe(size);
  }
  await page.goto("/");
  // marges : masques ronds ou carrés arrondis, rien ne dépasse du disque de zone sûre
  const bg = readFileSync(new URL("../../assets/icone-fond.txt", import.meta.url).pathname, "utf8").trim();
  const rgb = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16)) as [number, number, number];
  const maskable = await farthest(page, b64(new URL("../../web/public/icons/icon-maskable-512.png", import.meta.url).pathname), "bg", rgb);
  expect(maskable.far).toBeLessThanOrEqual(0.4); // zone sûre « maskable » : disque de 80 % de la largeur
  const any = await farthest(page, b64(new URL("../../web/public/icons/icon-512.png", import.meta.url).pathname), "bg", rgb);
  expect(any.far).toBeLessThanOrEqual(0.47);
  const mono = await farthest(page, b64(new URL("../../web/public/icons/icon-monochrome-512.png", import.meta.url).pathname), "alpha");
  expect(mono.far).toBeLessThanOrEqual(0.4);
});

test("Android : premier plan adaptatif et monochrome dans la zone sûre de 66 dp (61 %), toutes densités ; petite icône de notification, sans fond", async ({ page }) => {
  await page.goto("/");
  for (const [d, px] of [["mdpi", 108], ["hdpi", 162], ["xhdpi", 216], ["xxhdpi", 324], ["xxxhdpi", 432]] as const) {
    for (const name of ["ic_launcher_foreground.png", "ic_launcher_monochrome.png"]) {
      const r = await farthest(page, b64(`${RES}mipmap-${d}/${name}`), "alpha");
      expect([r.w, r.h]).toEqual([px, px]);
      expect(r.far, `${d}/${name}`).toBeLessThanOrEqual(0.31); // 66/108 = 61 % → rayon 30,5 %
    }
  }
  for (const [d, px] of [["mdpi", 24], ["hdpi", 36], ["xhdpi", 48], ["xxhdpi", 72], ["xxxhdpi", 96]] as const) {
    const r = await farthest(page, b64(`${RES}drawable-${d}/ic_notification_icon.png`), "alpha");
    expect([r.w, r.h]).toEqual([px, px]);
    expect(r.far).toBeGreaterThan(0.1); // il y a bien une silhouette
    // monochrome : tous les pixels visibles sont blancs
    const white = await page.evaluate(async (s) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x = c.getContext("2d")!;
      x.drawImage(bmp, 0, 0);
      const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 24 && (d[i]! < 250 || d[i + 1]! < 250 || d[i + 2]! < 250)) return false;
      return true;
    }, b64(`${RES}drawable-${d}/ic_notification_icon.png`));
    expect(white, `${d} blanc`).toBe(true);
  }
  // légers contrôles des lanceurs classiques
  for (const [d, px] of [["mdpi", 48], ["xxxhdpi", 192]] as const) for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
    const r = await farthest(page, b64(`${RES}mipmap-${d}/${name}`), "alpha");
    expect([r.w, r.h]).toEqual([px, px]);
  }
});
