// Génère les icônes Android (lanceur classique, adaptative, monochrome) depuis les icônes de la PWA : une seule source graphique.
// Usage : node scripts/android-icons.mjs   (sharp est dans server/node_modules)
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(new URL("../server/package.json", import.meta.url));
const sharp = require("sharp");
const res = new URL("../android/app/src/main/res/", import.meta.url).pathname;
const icon = new URL("../web/public/icons/icon-512.png", import.meta.url).pathname;
const maskable = new URL("../web/public/icons/icon-maskable-512.png", import.meta.url).pathname;

const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const adaptive = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

// Premier plan adaptatif : le fond vert de l'icône « maskable » devient transparent, il reste le panier blanc.
const { data, info } = await sharp(maskable).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const bg = [data[0], data[1], data[2]]; // coin supérieur gauche = fond uni
for (let i = 0; i < data.length; i += 4) {
  const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
  // transparence proportionnelle à l'écart avec le fond : contours lissés
  data[i + 3] = Math.min(255, Math.round((d / 400) * 255 * 1.6));
  data[i] = data[i + 1] = data[i + 2] = 255;
}
const foreground = await sharp(data, { raw: info }).png().toBuffer();

for (const [d, px] of Object.entries(legacy)) {
  mkdirSync(`${res}mipmap-${d}`, { recursive: true });
  const png = await sharp(icon).resize(px, px).png().toBuffer();
  writeFileSync(`${res}mipmap-${d}/ic_launcher.png`, png);
  writeFileSync(`${res}mipmap-${d}/ic_launcher_round.png`, await sharp(png).composite([{ input: Buffer.from(`<svg width="${px}" height="${px}"><circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}"/></svg>`), blend: "dest-in" }]).png().toBuffer());
}
for (const [d, px] of Object.entries(adaptive)) {
  writeFileSync(`${res}mipmap-${d}/ic_launcher_foreground.png`, await sharp(foreground).resize(px, px).png().toBuffer());
}
mkdirSync(`${res}mipmap-anydpi-v26`, { recursive: true });
const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
writeFileSync(`${res}mipmap-anydpi-v26/ic_launcher.xml`, xml);
writeFileSync(`${res}mipmap-anydpi-v26/ic_launcher_round.xml`, xml);
// Image d'accueil (écran de démarrage) : l'icône complète
mkdirSync(`${res}drawable`, { recursive: true });
writeFileSync(`${res}drawable/splash.png`, await sharp(icon).resize(288, 288).png().toBuffer());
console.log("icônes Android générées");
