#!/usr/bin/env python3
"""Génère TOUTES les icônes (PWA + Android) depuis l'image source assets/icone-source.png (panier, fond vert uni).
Usage : python3 scripts/make-icons.py      (Pillow + numpy)
Sorties : web/public/icons/*, android/app/src/main/res/{mipmap-*,drawable-*,drawable/splash.png}.

Marges : les masques ronds ou « carrés arrondis » des lanceurs ne coupent jamais l'illustration :
  - icône « maskable » PWA : illustration dans le disque central de 76 % de la largeur (zone sûre = 80 %) ;
  - icône adaptative Android (108 dp) : illustration dans un disque de 62 % de la largeur (zone sûre officielle = 61 %) ;
  - lanceurs classiques (carré arrondi, rond) : illustration dans un disque de 84 % de la largeur.
Le premier plan adaptatif est l'illustration sur fond transparent (le vert uni devient le calque de fond) ;
la variante monochrome (icônes thématiques, notifications, badge) est la silhouette, objets séparés par un fin trait transparent.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = Image.open(os.path.join(ROOT, "assets/icone-source.png")).convert("RGB")
W = SRC.size[0]
a = np.asarray(SRC).astype(int)
BG = tuple(int(v) for v in np.median(np.concatenate([a[:8, :8].reshape(-1, 3), a[:8, -8:].reshape(-1, 3), a[-8:, :8].reshape(-1, 3), a[-8:, -8:].reshape(-1, 3)]), axis=0))
BG_HEX = "#%02X%02X%02X" % BG

# --- calque « illustration » : alpha selon l'écart avec le fond uni (contours doux, le fond devient transparent) ---
dist = np.abs(a - np.array(BG)).sum(axis=2)
alpha = np.clip((dist - 14) / 40.0, 0, 1)
art = np.dstack([a.astype(np.uint8), (alpha * 255).astype(np.uint8)])
ART = Image.fromarray(art, "RGBA")

# --- silhouette monochrome : classes de couleur, traits de séparation entre objets, trous du panier ---
r, g, b = a[..., 0], a[..., 1], a[..., 2]
cls = np.zeros(a.shape[:2], dtype=np.uint8)  # 0 fond / trou
fg = dist > 70  # les fentes du panier (légèrement plus claires que le fond) restent des trous
cream = fg & (r > 190) & (g > 175) & (b > 120) & (np.abs(r - g) < 45)
tomato = fg & (r > 150) & (g < 110) & (b < 100)
bread = fg & ~cream & ~tomato & (r > 190) & (g > 110) & (b < 130)
leaf = fg & ~cream & ~tomato & ~bread
cls[cream] = 1; cls[tomato] = 2; cls[bread] = 3; cls[leaf] = 4
# les textures (croûte, nervures) créent du bruit : on lisse la carte des classes avant de chercher les frontières
cls = np.asarray(Image.fromarray(cls).filter(ImageFilter.ModeFilter(51)))
fg = cls > 0
edge = np.zeros(cls.shape, dtype=bool)
for dy, dx in ((1, 0), (0, 1), (1, 1), (1, -1)):
    sh = np.roll(np.roll(cls, dy, axis=0), dx, axis=1)
    edge |= (cls != sh) & (cls > 0) & (sh > 0)  # frontière entre deux objets (pas avec le fond)
gap = Image.fromarray((edge * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(11))
mask = (cls > 0) & (np.asarray(gap) < 128)
MONO_A = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))
MONO_A = MONO_A.point(lambda v: 255 if v > 150 else (0 if v < 90 else int((v - 90) / 60 * 255)))

# rayon de l'illustration autour du centre de son cadre englobant (pour caler les marges)
ys, xs = np.nonzero(alpha > 0.5)
cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
RAD = float(np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2).max())  # px de la source

def crop_center(img):
    """Recentre l'image sur le centre de l'illustration (canevas carré de côté 2*max(distance au bord))."""
    half = int(max(cx, cy, W - cx, W - cy))
    out = Image.new(img.mode, (2 * half, 2 * half), (0, 0, 0, 0) if img.mode == "RGBA" else BG)
    out.paste(img, (int(round(half - cx)), int(round(half - cy))))
    return out, half

def place(img, size, disc, bg=None):
    """Pose l'illustration au centre d'un carré `size` : tout point de l'illustration reste dans un disque de diamètre disc*size."""
    c, half = crop_center(img)
    scale = (disc * size / 2) / RAD
    side = max(1, round(c.size[0] * scale))
    scaled = c.resize((side, side), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (bg + (255,)) if bg else (0, 0, 0, 0))
    canvas.alpha_composite(scaled, (round((size - side) / 2), round((size - side) / 2)))
    return canvas

def white_from_alpha(alpha_img):
    out = Image.new("RGBA", alpha_img.size, (255, 255, 255, 0))
    out.putalpha(alpha_img)
    return out

def save(img, path):
    p = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p, optimize=True)

def rounded(img, radius_frac):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=int(img.size[0] * radius_frac), fill=255)
    out = img.copy()
    out.putalpha(m)
    return out

def circle(img):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).ellipse([0, 0, img.size[0] - 1, img.size[1] - 1], fill=255)
    out = img.copy()
    out.putalpha(m)
    return out

full = lambda size, disc: place(ART, size, disc, bg=BG)  # illustration sur fond vert
mono = lambda size, disc: white_from_alpha(place(MONO_A.convert("L").convert("RGBA"), size, disc).split()[0])

# ============================ PWA ============================
save(full(512, 0.90).convert("RGB"), "web/public/icons/icon-512.png")        # « any » : marges naturelles de la source
save(full(192, 0.90).convert("RGB"), "web/public/icons/icon-192.png")
save(full(512, 0.76).convert("RGB"), "web/public/icons/icon-maskable-512.png")  # zone sûre 80 %
# monochrome (icônes thématiques du navigateur) : silhouette noire sur transparent, mêmes marges que l'icône adaptative
sil = place(MONO_A.convert("RGBA"), 512, 0.76)
black = Image.new("RGBA", sil.size, (0, 0, 0, 0)); black.putalpha(sil.split()[0])
save(black, "web/public/icons/icon-monochrome-512.png")
# petit badge de notification (blanc sur transparent)
save(mono(96, 0.86), "web/public/icons/badge-96.png")

# ============================ Android ============================
RES = "android/app/src/main/res/"
for d, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    sq = full(px * 4, 0.84).resize((px, px), Image.LANCZOS)
    save(rounded(sq, 0.22), f"{RES}mipmap-{d}/ic_launcher.png")
    save(circle(sq), f"{RES}mipmap-{d}/ic_launcher_round.png")
for d, px in {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}.items():
    fgl = place(ART, px * 4, 0.60).resize((px, px), Image.LANCZOS)  # zone sûre officielle : 66/108 = 61 %
    save(fgl, f"{RES}mipmap-{d}/ic_launcher_foreground.png")
    save(mono(px * 4, 0.60).resize((px, px), Image.LANCZOS), f"{RES}mipmap-{d}/ic_launcher_monochrome.png")
for d, px in {"mdpi": 24, "hdpi": 36, "xhdpi": 48, "xxhdpi": 72, "xxxhdpi": 96}.items():
    save(mono(px * 8, 0.92).resize((px, px), Image.LANCZOS), f"{RES}drawable-{d}/ic_notification_icon.png")
save(rounded(full(288 * 2, 0.90).resize((288, 288), Image.LANCZOS), 0.22), f"{RES}drawable/splash.png")
# couleur du calque de fond adaptatif
open(os.path.join(ROOT, "assets/icone-fond.txt"), "w").write(BG_HEX + "\n")
print("fond", BG_HEX, "rayon source", round(RAD / W, 3), "de la largeur")
