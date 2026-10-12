#!/usr/bin/env python3
"""Fabrique les ressources d'icône de l'application Android native à partir de l'image validée « Chariot Pop »
(android-native/icon/courses-icon-source.png : chariot turquoise et bleu nuit, pomme corail, pain jaune, fond ivoire).
Le dessin, les couleurs et les proportions ne sont jamais redessinés : l'image est seulement détourée sur son fond ivoire uni
(le fond est reconstitué par la couleur d'arrière-plan), mise à l'échelle et centrée.
 - premier plan adaptatif : le chariot, fond transparent, dans la zone sûre (66 dp de diamètre sur 108 dp) ;
 - arrière-plan adaptatif : l'ivoire uni de l'image (aucun coin arrondi : Android applique le masque) ;
 - monochrome : silhouette du chariot (alpha), fentes et reflets ajourés ;
 - anciennes icônes (avant Android 8), écran de démarrage, PNG 512 × 512 Google Play (préparé, non publié) ;
 - aperçus avec masques rond / carré arrondi / squircle / goutte.
Usage : python3 scripts/make-native-icon.py"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = "android-native/icon/courses-icon-source.png"
RES = "android-native/app/src/main/res"
OUTDOCS = "docs/native/icone"
SAFE_DP = 33.0                    # rayon de la zone sûre d'une icône adaptative
SPLASH_R_DP = 90.0                # rayon du chariot dans l'écran de démarrage (cercle visible : 96 dp)
DENS = {"mdpi": (48, 108), "hdpi": (72, 162), "xhdpi": (96, 216), "xxhdpi": (144, 324), "xxxhdpi": (192, 432)}

src = Image.open(SRC).convert("RGB")
N = src.width
a = np.asarray(src).astype(np.float32)
corner = np.concatenate([a[:24, :24].reshape(-1, 3), a[-24:, -24:].reshape(-1, 3), a[:24, -24:].reshape(-1, 3), a[-24:, :24].reshape(-1, 3)])
BG = np.median(corner, axis=0)
BG_HEX = "#%02X%02X%02X" % tuple(int(round(v)) for v in BG)
print("fond ivoire", BG_HEX)

# 1. Détourage : écart à la couleur de fond. alpha = couverture ; couleur = couleur d'origine « dé-mélangée » du fond.
d = np.linalg.norm(a - BG, axis=2)
alpha = np.clip(d / 34.0, 0, 1)
alpha[d < 5] = 0
alpha = np.where(alpha > 0.995, 1.0, alpha)
al = np.maximum(alpha, 1e-3)[..., None]
fg_rgb = np.clip((a - (1 - alpha[..., None]) * BG) / al, 0, 255)
fg_rgb[alpha == 0] = 0
full = Image.fromarray(np.dstack([fg_rgb, alpha * 255]).astype(np.uint8), "RGBA")

# 2. Plus petit cercle contenant le chariot (Badoiu-Clarkson)
solid = d > 24
m = Image.fromarray((solid * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
solid = np.asarray(m) > 127
edge = solid & ~(np.asarray(Image.fromarray((solid * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))) > 127)
ey, ex = np.nonzero(edge)
pts = np.stack([ex, ey], 1).astype(np.float64)
c = np.array([(pts[:, 0].min() + pts[:, 0].max()) / 2, (pts[:, 1].min() + pts[:, 1].max()) / 2])
for i in range(1, 3000):
    far = pts[np.linalg.norm(pts - c, axis=1).argmax()]
    c = c + (far - c) / (i + 1)
R = float(np.linalg.norm(pts - c, axis=1).max())
print(f"chariot : centre {c.round(1)}, rayon {R:.1f} px sur {N} px")

# 3. Couches adaptatives (grille maîtresse de 108 dp à 16 px/dp)
MASTER = 1728
f = (SAFE_DP * 16.0) / R
size = int(round(N * f)); ox = int(round(MASTER / 2 - c[0] * f)); oy = int(round(MASTER / 2 - c[1] * f))
print(f"échelle {f:.3f} : chariot de {(1087 - 160) * f / 16:.1f} dp de large dans les 108 dp ; rayon {R * f / 16:.1f} dp")
fg = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
fg.alpha_composite(full.resize((size, size), Image.LANCZOS), (ox, oy))
background = Image.new("RGB", (MASTER, MASTER), tuple(int(round(v)) for v in BG))

# monochrome : silhouette (reflets et fentes ajourés)
mono_a = np.clip((d - 12) / 60.0, 0, 1)
mono_a = np.asarray(Image.fromarray((mono_a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)))
white = Image.new("RGBA", (N, N), (255, 255, 255, 255)); white.putalpha(Image.fromarray(mono_a))
mono = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
mono.alpha_composite(white.resize((size, size), Image.LANCZOS), (ox, oy))

# 4. Ressources
for dn, (leg, lay) in DENS.items():
    os.makedirs(f"{RES}/mipmap-{dn}", exist_ok=True)
    for old in ("ic_launcher_background.png",):
        p = f"{RES}/mipmap-{dn}/{old}"
        if os.path.exists(p): os.remove(p)
    fg.resize((lay, lay), Image.LANCZOS).save(f"{RES}/mipmap-{dn}/ic_launcher_foreground.png", optimize=True)
    mono.resize((lay, lay), Image.LANCZOS).save(f"{RES}/mipmap-{dn}/ic_launcher_monochrome.png", optimize=True)
    # avant Android 8 : image pleine carrée ; ronde : découpe circulaire de l'image
    src.resize((leg, leg), Image.LANCZOS).save(f"{RES}/mipmap-{dn}/ic_launcher.png", optimize=True)
    big = src.resize((leg * 4, leg * 4), Image.LANCZOS).convert("RGBA")
    circ = Image.new("L", big.size, 0); ImageDraw.Draw(circ).ellipse([0, 0, big.width - 1, big.height - 1], fill=255)
    big.putalpha(circ); big.resize((leg, leg), Image.LANCZOS).save(f"{RES}/mipmap-{dn}/ic_launcher_round.png", optimize=True)
open(f"{RES}/values/colors_icon.xml", "w").write(f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{BG_HEX}</color>\n    <color name="splash_bg">{BG_HEX}</color>\n</resources>\n')
sp = f"{RES}/values/colors_splash.xml"
if os.path.exists(sp): os.remove(sp)
for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    open(f"{RES}/mipmap-anydpi-v26/{name}", "w").write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
''')

# écran de démarrage : le chariot (fond transparent) sur l'ivoire, dans le cercle de 192 dp (toile de 288 dp à 4 px/dp)
SPL = 1152; fs = (SPLASH_R_DP * 4.0) / R; ssz = int(round(N * fs))
splash = Image.new("RGBA", (SPL, SPL), (0, 0, 0, 0))
splash.alpha_composite(full.resize((ssz, ssz), Image.LANCZOS), (int(SPL / 2 - c[0] * fs), int(SPL / 2 - c[1] * fs)))
os.makedirs(f"{RES}/drawable-nodpi", exist_ok=True)
splash.save(f"{RES}/drawable-nodpi/ic_splash.png", optimize=True)

# Google Play : 512 x 512, image pleine, sans coins arrondis (le Play Store applique son masque) — préparé, non publié
os.makedirs("android-native/store", exist_ok=True); os.makedirs(OUTDOCS, exist_ok=True)
play = src.resize((512, 512), Image.LANCZOS).convert("RGBA")
play.save("android-native/store/ic_launcher_512.png", optimize=True)
play.save(f"{OUTDOCS}/google-play-512.png", optimize=True)

# 5. Aperçus : arrière-plan + premier plan, partie visible = 72 dp au centre, avec les masques d'Android
def composite(px):
    bgp = background.resize((px, px), Image.LANCZOS).convert("RGBA")
    bgp.alpha_composite(fg.resize((px, px), Image.LANCZOS))
    k = px / 108.0
    return bgp.crop((int(18 * k), int(18 * k), int(90 * k), int(90 * k)))

def shape_mask(kind, s):
    S = s * 4; mk = Image.new("L", (S, S), 0); d_ = ImageDraw.Draw(mk)
    if kind == "rond": d_.ellipse([0, 0, S - 1, S - 1], fill=255)
    elif kind == "carré arrondi": d_.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.28), fill=255)
    elif kind == "squircle":
        yy, xx = np.mgrid[0:S, 0:S]; u = (xx - S / 2) / (S / 2); v = (yy - S / 2) / (S / 2)
        mk = Image.fromarray(((np.abs(u) ** 4 + np.abs(v) ** 4) <= 1).astype(np.uint8) * 255)
    else:
        d_.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.5), fill=255)
        d_.rounded_rectangle([int(S * 0.5), int(S * 0.5), S - 1, S - 1], radius=int(S * 0.06), fill=255)
    return mk.resize((s, s), Image.LANCZOS)

try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15); FB = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
except Exception:
    FONT = FB = None
kinds = ["rond", "carré arrondi", "squircle", "goutte"]; sizes = [192, 96, 64, 48, 32]
cell = 210; Wp = 150 + cell * len(sizes); Hp = 40 + 230 * len(kinds)
sheet = Image.new("RGB", (Wp, Hp), (226, 232, 240)); dr = ImageDraw.Draw(sheet)
dr.text((10, 10), "Icône Courses (natif) « Chariot Pop » : rendu avec les masques Android, tailles réelles 192 / 96 / 64 / 48 / 32 px (aperçu calculé, pas une capture)", fill=(11, 42, 74), font=FB)
for i, kd in enumerate(kinds):
    y0 = 40 + i * 230
    dr.text((10, y0 + 100), kd, fill=(11, 42, 74), font=FONT)
    x = 150
    for s in sizes:
        ic = composite(max(s * 3 // 2 * 2, 108)).resize((s, s), Image.LANCZOS)
        tile = Image.new("RGBA", (s, s), (0, 0, 0, 0)); tile.paste(ic, (0, 0)); tile.putalpha(shape_mask(kd, s))
        sheet.paste(tile, (x + (cell - s) // 2, y0 + (200 - s) // 2), tile)
        x += cell
sheet.save(f"{OUTDOCS}/apercu-masques.png", optimize=True)
lay = Image.new("RGB", (432 * 4 + 30, 432), (226, 232, 240))
lay.paste(background.resize((432, 432)), (0, 0))
chk = Image.new("RGB", (432, 432), (200, 200, 200)); fgp = fg.resize((432, 432)); chk.paste(fgp, (0, 0), fgp); lay.paste(chk, (442, 0))
mprev = Image.new("RGB", (432, 432), (30, 30, 30)); mp = mono.resize((432, 432)); mprev.paste(mp, (0, 0), mp); lay.paste(mprev, (884, 0))
lay.paste(composite(432).resize((432, 432)).convert("RGB"), (1326, 0))
lay.save(f"{OUTDOCS}/couches.png", optimize=True)
print("ok")
