#!/usr/bin/env python3
"""Zones tactiles : chaque élément cliquable de l'application doit mesurer au moins 48 dp dans les deux sens.
Usage : touch-audit.py fichier.xml densité_dpi  → affiche les éléments trop petits ; code 1 s'il y en a."""
import re, sys
import xml.etree.ElementTree as ET

xml, dpi = sys.argv[1], float(sys.argv[2])
limit = 48.0 * dpi / 160.0 - 1.5  # tolérance d'arrondi
bad = []
count = 0
for n in ET.fromstring(open(xml, encoding="utf-8").read()).iter("node"):
    if n.get("package") != "app.smartcourse.courses.nativeproto" or n.get("clickable") != "true" or n.get("enabled") == "false":
        continue
    m = re.findall(r"-?\d+", n.get("bounds") or "")
    if len(m) != 4:
        continue
    x1, y1, x2, y2 = map(int, m)
    w, h = x2 - x1, y2 - y1
    count += 1
    if min(w, h) < limit:
        label = (n.get("text") or n.get("content-desc") or n.get("class") or "?")[:40]
        bad.append(f"{label!r}: {w / dpi * 160:.0f}x{h / dpi * 160:.0f} dp")
print(f"{count} éléments cliquables, {len(bad)} sous 48 dp")
for b in bad:
    print("  trop petit :", b)
sys.exit(1 if bad else 0)
