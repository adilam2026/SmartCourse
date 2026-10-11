#!/usr/bin/env python3
"""Planche contact : les images du catalogue avec leur nom exact sous chaque photo (pour vérifier la CORRESPONDANCE visuelle).
Usage : python3 scripts/contact-sheet.py <manifest.json> <sortie-préfixe> [par_planche=20] [colonnes=5]
Le manifeste est celui de server/catalog-photos (items[].file, name, key) ; les fichiers sont lus à côté du manifeste."""
import json, os, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

man, out = sys.argv[1], sys.argv[2]
per = int(sys.argv[3]) if len(sys.argv) > 3 else 20
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 5
items = json.load(open(man))["items"]
base = os.path.dirname(man)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 17)
    small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
except Exception:
    font = small = ImageFont.load_default()
T = 220  # vignette
for n in range(0, len(items), per):
    chunk = items[n:n + per]
    rows = (len(chunk) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (T + 16) + 16, rows * (T + 78) + 16), "#f4f1ea")
    d = ImageDraw.Draw(sheet)
    for i, it in enumerate(chunk):
        x, y = 16 + (i % cols) * (T + 16), 16 + (i // cols) * (T + 78)
        try:
            im = Image.open(os.path.join(base, it["file"])).convert("RGB")
            im.thumbnail((T, T))
            tile = Image.new("RGB", (T, T), "white")
            tile.paste(im, ((T - im.width) // 2, (T - im.height) // 2))
        except Exception:
            tile = Image.new("RGB", (T, T), "#ffdddd")
            ImageDraw.Draw(tile).text((10, T // 2), "image absente", fill="red", font=font)
        sheet.paste(tile, (x, y))
        d.rectangle([x, y, x + T, y + T], outline="#cfc6b5")
        label = "\n".join(textwrap.wrap(it.get("name", it["key"]), 24)[:2])
        d.text((x, y + T + 4), label, fill="#111", font=font)
        d.text((x, y + T + 44), f"{it['key']}", fill="#666", font=small)
    path = f"{out}-{n // per + 1:02d}.png"
    sheet.save(path)
    print(path, len(chunk))
