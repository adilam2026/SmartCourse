#!/usr/bin/env python3
"""Fabrique les ressources d'icône de l'application Android native à partir de l'image fournie (android-native/icon/courses-icon-source.png).
Les pixels de l'image ne sont jamais redessinés ni recolorés : l'image est seulement mise à l'échelle et placée.
 - premier plan adaptatif : l'image elle-même, bords fondus (seule la marge bleu nuit s'efface) ;
 - arrière-plan adaptatif : le fond bleu nuit de l'image, débarrassé du panier (reconstitué par diffusion) et prolongé ;
 - monochrome : silhouette du panier (alpha) pour les icônes thématiques ;
 - anciennes icônes (carrée, ronde), écran de démarrage, PNG 512 Google Play ;
 - aperçus avec masques rond / carré arrondi / squircle / goutte.
Usage : python3 scripts/make-native-icon.py"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = "android-native/icon/courses-icon-source.png"
RES = "android-native/app/src/main/res"
OUTDOCS = "docs/native/icone"
SAFE_DP = 33.0  # rayon de la zone sûre d'une icône adaptative (66 dp de diamètre sur 108 dp)
DENS = {"mdpi": (48, 108), "hdpi": (72, 162), "xhdpi": (96, 216), "xxhdpi": (144, 324), "xxxhdpi": (192, 432)}

src = Image.open(SRC).convert("RGB")
N = src.width
a = np.asarray(src).astype(np.float32)
r, g, b = a[..., 0], a[..., 1], a[..., 2]

# 1. Panier = tout ce qui n'est pas le fond bleu nuit (fond : bleu dominant, rouge quasi nul)
bg_like = ((b - g) >= 18) & (r <= 25) & (b >= 45)
mask = ~bg_like
m_img = Image.fromarray((mask * 255).astype(np.uint8))
m_img = m_img.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))  # retire le bruit isolé
mask = np.asarray(m_img) > 127
ys, xs = np.nonzero(mask)

# 2. Plus petit cercle contenant le panier (Badoiu-Clarkson sur les points du contour)
edge = mask & ~np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))) > 127
ey, ex = np.nonzero(mask & ~(np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))) > 127))
pts = np.stack([ex, ey], 1).astype(np.float64)
c = np.array([(pts[:, 0].min() + pts[:, 0].max()) / 2, (pts[:, 1].min() + pts[:, 1].max()) / 2])
for i in range(1, 3000):
    d = np.linalg.norm(pts - c, axis=1)
    far = pts[d.argmax()]
    c = c + (far - c) / (i + 1)
R = float(np.linalg.norm(pts - c, axis=1).max())
print(f"panier : centre {c.round(1)}, rayon {R:.1f} px sur {N} px")

# 3. Fond sans panier : diffusion lisse dans la zone du panier (grille 128 px), puis prolongement
G = 128
mask_d = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(31))
small_mask = np.asarray(mask_d.resize((G, G), Image.BILINEAR)) > 20
small = np.asarray(src.resize((G, G), Image.LANCZOS)).astype(np.float32)
known = ~small_mask
fill = small.copy()
fill[small_mask] = small[known].mean(0)
for _ in range(2500):
    p = np.pad(fill, ((1, 1), (1, 1), (0, 0)), mode="edge")
    avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4
    fill = np.where(small_mask[..., None], avg, small)
up = np.asarray(Image.fromarray(np.clip(fill, 0, 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)).astype(np.float32)
soft = np.asarray(mask_d.filter(ImageFilter.GaussianBlur(10))).astype(np.float32)[..., None] / 255.0
bg_full = a * (1 - soft) + up * soft          # fond de l'image sans le panier

# 4. Mise à l'échelle : le panier entier dans la zone sûre, centré sur le centre du cercle
MASTER = 1728                                   # 108 dp à 16 px/dp
f = (SAFE_DP * 16.0) / R
size = int(round(N * f))
ox = int(round(MASTER / 2 - c[0] * f)); oy = int(round(MASTER / 2 - c[1] * f))
print(f"échelle {f:.3f} : image {size/16:.1f} dp dans 108 dp ; panier rayon {R*f/16:.1f} dp")

def place(img_arr_rgb, fill_edge_blur=True):
    """Place l'image sur la grille maîtresse ; l'extérieur prolonge les bords en les lissant."""
    im = Image.fromarray(np.clip(img_arr_rgb, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    pad = np.asarray(im).astype(np.float32)
    big = np.pad(pad, ((max(oy, 0) + 40, max(MASTER - oy - size, 0) + 40), (max(ox, 0) + 40, max(MASTER - ox - size, 0) + 40), (0, 0)), mode="edge")
    big_img = Image.fromarray(big.astype(np.uint8)).filter(ImageFilter.GaussianBlur(28))
    bx = max(ox, 0) + 40 - ox; by = max(oy, 0) + 40 - oy
    canvas = big_img.crop((bx, by, bx + MASTER, by + MASTER))
    inside = Image.new("RGB", (MASTER, MASTER))
    inside.paste(im, (ox, oy))
    m = Image.new("L", (MASTER, MASTER), 0)
    ImageDraw.Draw(m).rectangle([ox + 20, oy + 20, ox + size - 21, oy + size - 21], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(18))
    return Image.composite(inside, canvas, m)

background = place(bg_full)                      # arrière-plan : fond bleu nuit seul, prolongé

# premier plan : l'image exacte, alpha dégradé sur sa marge extérieure uniquement
fg = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
im_fg = src.resize((size, size), Image.LANCZOS).convert("RGBA")
fade = int(size * 0.07)
yy, xx = np.mgrid[0:size, 0:size]
dist = np.minimum.reduce([xx, yy, size - 1 - xx, size - 1 - yy]).astype(np.float32)
t = np.clip(dist / fade, 0, 1); alpha = (t * t * (3 - 2 * t) * 255).astype(np.uint8)
im_fg.putalpha(Image.fromarray(alpha))
fg.alpha_composite(im_fg, (ox, oy))

# monochrome : silhouette du panier (écart au fond), trous des fentes conservés
diff = np.linalg.norm(a - bg_full, axis=2)
mono_a = np.clip((diff - 45) / 45.0, 0, 1)
mono_a = np.asarray(Image.fromarray((mono_a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)))
mono_small = Image.fromarray(mono_a).resize((size, size), Image.LANCZOS)
mono = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
white = Image.new("RGBA", (size, size), (255, 255, 255, 255)); white.putalpha(mono_small)
mono.alpha_composite(white, (ox, oy))

def save_layers():
    for d, (leg, lay) in DENS.items():
        os.makedirs(f"{RES}/mipmap-{d}", exist_ok=True)
        background.resize((lay, lay), Image.LANCZOS).save(f"{RES}/mipmap-{d}/ic_launcher_background.png", optimize=True)
        fg.resize((lay, lay), Image.LANCZOS).save(f"{RES}/mipmap-{d}/ic_launcher_foreground.png", optimize=True)
        mono.resize((lay, lay), Image.LANCZOS).save(f"{RES}/mipmap-{d}/ic_launcher_monochrome.png", optimize=True)
        # anciennes versions d'Android (avant 8.0) : image pleine, carrée ; version ronde : découpe circulaire de l'image
        sq = src.resize((leg, leg), Image.LANCZOS)
        sq.save(f"{RES}/mipmap-{d}/ic_launcher.png", optimize=True)
        big = src.resize((leg * 4, leg * 4), Image.LANCZOS).convert("RGBA")
        circ = Image.new("L", big.size, 0); ImageDraw.Draw(circ).ellipse([0, 0, big.width - 1, big.height - 1], fill=255)
        big.putalpha(circ); big.resize((leg, leg), Image.LANCZOS).save(f"{RES}/mipmap-{d}/ic_launcher_round.png", optimize=True)

save_layers()

# écran de démarrage : le panier dans le cercle de 192 dp (toile de 288 dp à 4 px/dp)
SPL = 1152
fs = (90.0 * 4.0) / R
ssz = int(round(N * fs))
sp = src.resize((ssz, ssz), Image.LANCZOS).convert("RGBA")
fade2 = int(ssz * 0.18)
yy, xx = np.mgrid[0:ssz, 0:ssz]
dist2 = np.minimum.reduce([xx, yy, ssz - 1 - xx, ssz - 1 - yy]).astype(np.float32)
t2 = np.clip(dist2 / fade2, 0, 1)
sp.putalpha(Image.fromarray((t2 * t2 * (3 - 2 * t2) * 255).astype(np.uint8)))
splash = Image.new("RGBA", (SPL, SPL), (0, 0, 0, 0))
splash.alpha_composite(sp, (int(SPL / 2 - c[0] * fs), int(SPL / 2 - c[1] * fs)))
os.makedirs(f"{RES}/drawable-nodpi", exist_ok=True)
splash.save(f"{RES}/drawable-nodpi/ic_splash.png", optimize=True)
# couleur de fond du démarrage : médiane du fond de l'image autour du cercle de 96 dp
ang = np.linspace(0, 2 * np.pi, 360, endpoint=False)
rad = 96.0 * 4.0 / fs
samples = []
for t_ in ang:
    x = int(c[0] + rad * np.cos(t_)); y = int(c[1] + rad * np.sin(t_))
    if 0 <= x < N and 0 <= y < N:
        samples.append(a[y, x])
med = np.median(np.array(samples), axis=0).astype(int)
print("fond de démarrage :", "#%02X%02X%02X" % tuple(med))
open(f"{RES}/values/colors_splash.xml", "w").write(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="splash_bg">#%02X%02X%02X</color>\n</resources>\n' % tuple(med))

# Google Play : 512 x 512, image pleine, sans coins arrondis (le Play Store applique son masque) — préparé, non publié
os.makedirs("android-native/store", exist_ok=True); os.makedirs(OUTDOCS, exist_ok=True)
play = src.resize((512, 512), Image.LANCZOS).convert("RGBA")
play.save("android-native/store/ic_launcher_512.png", optimize=True)
play.save(f"{OUTDOCS}/google-play-512.png", optimize=True)

# aperçus avec masques : composition arrière-plan + premier plan, partie visible = 72 dp au centre
def composite(lay_px):
    bgp = background.resize((lay_px, lay_px), Image.LANCZOS).convert("RGBA")
    fgp = fg.resize((lay_px, lay_px), Image.LANCZOS)
    bgp.alpha_composite(fgp)
    k = lay_px / 108.0
    return bgp.crop((int(18 * k), int(18 * k), int(90 * k), int(90 * k)))

def shape_mask(kind, s):
    m = Image.new("L", (s * 4, s * 4), 0); d = ImageDraw.Draw(m); S = s * 4
    if kind == "rond":
        d.ellipse([0, 0, S - 1, S - 1], fill=255)
    elif kind == "carré arrondi":
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.28), fill=255)
    elif kind == "squircle":
        yy, xx = np.mgrid[0:S, 0:S]; u = (xx - S / 2) / (S / 2); v = (yy - S / 2) / (S / 2)
        m = Image.fromarray(((np.abs(u) ** 4 + np.abs(v) ** 4) <= 1).astype(np.uint8) * 255)
    else:  # goutte : trois coins arrondis, un coin presque vif
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.5), fill=255)
        d.rounded_rectangle([int(S * 0.5), int(S * 0.5), S - 1, S - 1], radius=int(S * 0.06), fill=255)
    return m.resize((s, s), Image.LANCZOS)

kinds = ["rond", "carré arrondi", "squircle", "goutte"]
sizes = [192, 96, 64, 48, 32]
cell = 210; Wp = 150 + cell * len(sizes); Hp = 40 + 230 * len(kinds)
sheet = Image.new("RGB", (Wp, Hp), (236, 241, 247)); dr = ImageDraw.Draw(sheet)
try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
except Exception:
    FONT = None
dr.text((10, 10), "Icône Courses (natif) : rendu avec les masques Android, tailles réelles 192 / 96 / 64 / 48 / 32 px (aperçu calculé, pas une capture)", fill=(11, 42, 74), font=FONT)
for i, kd in enumerate(kinds):
    y0 = 40 + i * 230
    dr.text((10, y0 + 100), kd, fill=(11, 42, 74), font=FONT)
    x = 150
    for s in sizes:
        ic = composite(max(s * 3 // 2 * 2, 108)).resize((s, s), Image.LANCZOS)
        mk = shape_mask(kd, s)
        tile = Image.new("RGBA", (s, s), (0, 0, 0, 0)); tile.paste(ic, (0, 0)); tile.putalpha(mk)
        sheet.paste(tile, (x + (cell - s) // 2, y0 + (200 - s) // 2), tile)
        x += cell
sheet.save(f"{OUTDOCS}/apercu-masques.png", optimize=True)
# couches séparées, pour contrôle
fgprev = Image.new("RGB", (432, 432), (200, 200, 200)); fgprev.paste(fg.resize((432, 432)), (0, 0), fg.resize((432, 432)))
lay = Image.new("RGB", (432 * 4 + 30, 432), (236, 241, 247))
lay.paste(background.resize((432, 432)), (0, 0)); lay.paste(fgprev, (442, 0))
mprev = Image.new("RGB", (432, 432), (30, 30, 30)); mprev.paste(mono.resize((432, 432)), (0, 0), mono.resize((432, 432)))
lay.paste(mprev, (884, 0))
comp = composite(432).resize((432, 432)); lay.paste(comp.convert("RGB"), (1326, 0))
lay.save(f"{OUTDOCS}/couches.png", optimize=True)
print("ok")
