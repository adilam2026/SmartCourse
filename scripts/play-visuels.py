#!/usr/bin/env python3
"""Visuels de la fiche Google Play de « Mes Courses », à partir de l'icône validée et des captures originales.

Usage : play-visuels.py DOSSIER_CAPTURES_ORIGINALES DOSSIER_SORTIE
Produit (formats Google Play : PNG 24 bits sans transparence) :
  icone-512.png                 icône 512 × 512 (chariot validé, inchangé)
  banniere-1024x500.png         visuel de présentation
  captures/play-N-*.png         captures originales, au pixel près, converties en PNG 24 bits (exigence Play)
  captures-habillees/*.png      proposition : capture + légende, 1080 × 1920 (à valider avant utilisation)
"""
import glob, os, shutil, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC, OUT = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON = os.path.join(ROOT, "docs/native/icone/google-play-512.png")
NAVY, INK, TEAL, TEAL_DARK, TEAL_SOFT, CREAM = (11, 42, 74), (18, 48, 79), (20, 181, 174), (12, 143, 138), (223, 246, 244), (253, 250, 236)
FONT_DIR = "/usr/share/fonts/opentype/inter"


def font(weight, size):
    for name in (f"Inter-{weight}.otf", f"InterDisplay-{weight}.otf"):
        p = os.path.join(FONT_DIR, name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)


def rgb(im, bg=CREAM):
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        base = Image.new("RGB", im.size, bg)
        base.paste(im, mask=im.getchannel("A"))
        return base
    return im.convert("RGB")


def rounded(im, r):
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), r, fill=255)
    out = im.convert("RGBA"); out.putalpha(m)
    return out


def wrap(draw, text, f, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= width:
            cur = t
        else:
            lines.append(cur); cur = w
    lines.append(cur)
    return lines


os.makedirs(os.path.join(OUT, "captures"), exist_ok=True)
os.makedirs(os.path.join(OUT, "captures-habillees"), exist_ok=True)

# 1. Icône : celle validée, telle quelle (déjà 512 × 512, opaque)
icon = Image.open(ICON)
assert icon.size == (512, 512)
rgb(icon).save(os.path.join(OUT, "icone-512.png"), optimize=True)

# 2. Visuel de présentation 1024 × 500
W, H = 1024, 500
fg = Image.new("RGB", (W, H), CREAM)
d = ImageDraw.Draw(fg)
d.ellipse((620, -180, 1220, 420), fill=TEAL_SOFT)
d.ellipse((760, 300, 1100, 640), fill=(208, 240, 237))
card = rounded(rgb(icon).resize((330, 330), Image.LANCZOS), 72)
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((652, 99, 652 + 330, 99 + 330), 72, fill=(11, 42, 74, 60))
fg.paste(shadow.filter(ImageFilter.GaussianBlur(18)), (0, 12), shadow.filter(ImageFilter.GaussianBlur(18)))
fg.paste(card, (652, 85), card)
d = ImageDraw.Draw(fg)
d.text((64, 128), "Mes Courses", font=font("Bold", 86), fill=NAVY)
ty = 252
for line in ("Votre liste de courses partagée,", "simple et pratique", "pour toute la famille."):
    d.text((66, ty), line, font=font("Medium", 36), fill=INK); ty += 50
fg.save(os.path.join(OUT, "banniere-1024x500.png"), optimize=True)

# 3. Captures originales (pixels inchangés, PNG 24 bits) et proposition habillée
CAPTIONS = {
    "play-1-liste-partagee": "Une liste partagée par toute la famille",
    "play-2-listes-en-cours": "En option : plusieurs listes en cours",
    "play-3-selection-photos": "Choisissez vos articles en photos",
    "play-4-articles-achetes": "Chacun voit ce qui est déjà acheté",
    "play-5-budget": "Budget facultatif : suivez vos dépenses",
    "play-6-budgets-mensuels": "Budget facultatif : vos budgets du mois",
    "play-7-historique": "Vos courses passées, à refaire en un geste",
    "play-8-rappels": "Un rappel s'il reste des achats",
    "play-9-statistiques": "Vos achats en statistiques, mois par mois",
}
for sub in ("captures", "captures-habillees"):  # une seule série à jour (les anciennes captures ne traînent pas)
    for old in glob.glob(os.path.join(OUT, sub, "play-*.png")):
        os.remove(old)
for key, caption in CAPTIONS.items():
    src = os.path.join(SRC, key + ".png")
    if not os.path.exists(src):
        print(f"capture absente : {key}"); continue
    shot = rgb(Image.open(src))
    w, h = shot.size
    assert max(w, h) <= 2 * min(w, h), f"{key} : rapport {w}×{h} refusé par Google Play"
    shot.save(os.path.join(OUT, "captures", key + ".png"), optimize=True)
    CW, CH = 1080, 1920
    can = Image.new("RGB", (CW, CH), TEAL_SOFT)
    d = ImageDraw.Draw(can)
    d.ellipse((-260, -360, 700, 420), fill=(208, 240, 237))
    f = font("Bold", 68)
    lines = wrap(d, caption, f, 900)
    y = 110 if len(lines) > 1 else 150
    for line in lines:
        d.text(((CW - d.textlength(line, font=f)) / 2, y), line, font=f, fill=NAVY); y += 86
    sh = int(CH * 0.73); sw = int(w * sh / h)
    phone = rounded(shot.resize((sw, sh), Image.LANCZOS), 44)
    x0, y0 = (CW - sw) // 2, CH - sh - 70
    sd = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    ImageDraw.Draw(sd).rounded_rectangle((x0, y0, x0 + sw, y0 + sh), 44, fill=(11, 42, 74, 70))
    sd = sd.filter(ImageFilter.GaussianBlur(22))
    can.paste(sd, (0, 14), sd)
    frame = Image.new("RGBA", (sw + 20, sh + 20), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle((0, 0, sw + 19, sh + 19), 52, fill=NAVY)
    can.paste(frame, (x0 - 10, y0 - 10), frame)
    can.paste(phone, (x0, y0), phone)
    can.save(os.path.join(OUT, "captures-habillees", key + ".png"), optimize=True)
print("visuels :", sorted(os.path.relpath(p, OUT) for p in glob.glob(os.path.join(OUT, "**/*.png"), recursive=True)))
