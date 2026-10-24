#!/usr/bin/env python3
"""Pilote l'interface de l'application native sur l'émulateur (adb + uiautomator), comme le ferait un utilisateur.
Usage : native-ui.py tap TEXTE [--last|--first] [--exact] | has TEXTE | wait TEXTE [secondes] | gone TEXTE [secondes] | above A B | field N"""
import re, subprocess, sys, time
import xml.etree.ElementTree as ET


def dump():
    for _ in range(6):
        try:  # une lecture d'écran qui ne rend jamais la main échoue au bout de 20 s au lieu de bloquer tout le parcours
            subprocess.run(["adb", "shell", "uiautomator", "dump", "/sdcard/ui.xml"], capture_output=True, timeout=20)
            r = subprocess.run(["adb", "exec-out", "cat", "/sdcard/ui.xml"], capture_output=True, timeout=10)
        except subprocess.TimeoutExpired:
            print("LECTURE D'ÉCRAN BLOQUÉE (délai dépassé)", file=sys.stderr)
            time.sleep(1)
            continue
        if r.stdout.strip().startswith(b"<?xml"):
            return r.stdout.decode("utf-8", "replace")
        time.sleep(1)
    return ""


def enabled_last(xml, needle):
    """Vrai si le DERNIER élément (le plus bas) portant ce texte est activé (attribut enabled d'uiautomator, ou celui de son parent cliquable)."""
    if not xml:
        return False
    root = ET.fromstring(xml)
    parent = {c: p for p in root.iter() for c in p}
    found = None
    for n in root.iter("node"):
        if needle in (n.get("text") or "") + "\n" + (n.get("content-desc") or ""):
            found = n
    if found is None:
        return False
    n = found
    while n is not None and n.tag == "node":
        if n.get("clickable") == "true":
            return n.get("enabled") == "true"
        n = parent.get(n)
    return found.get("enabled") == "true"


def matches(xml, needle):
    out = []
    if not xml:
        return out
    exact = "--exact" in sys.argv  # texte ou description identique (ex. « Pain » sans « Pain et petit-déjeuner »)
    for n in ET.fromstring(xml).iter("node"):
        t = (n.get("text") or "") + "\n" + (n.get("content-desc") or "")
        if (needle in (n.get("text"), n.get("content-desc"))) if exact else (needle in t):
            m = re.findall(r"\d+", n.get("bounds") or "")
            if len(m) == 4:
                x1, y1, x2, y2 = map(int, m)
                out.append(((x1 + x2) // 2, (y1 + y2) // 2, y1))
    return sorted(out, key=lambda c: c[2])


def main():
    cmd, needle = sys.argv[1], sys.argv[2]
    if cmd == "tap":
        last = "--last" in sys.argv
        scroll = "--scroll" in sys.argv
        deadline = time.time() + 12
        swipes = 0
        while time.time() < deadline:
            found = matches(dump(), needle)
            if found:
                x, y, _ = found[-1] if last else found[0]
                subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)])
                return 0
            if scroll and swipes < 4:  # élément hors écran dans un panneau défilant : on fait défiler vers le bas
                subprocess.run(["adb", "shell", "input", "swipe", "540", "1700", "540", "1000", "300"])
                swipes += 1
            time.sleep(1)
        print(f"INTROUVABLE: {needle}")
        return 1
    if cmd == "field":  # field N : touche le N-ième champ de saisie de l'écran (0 = le plus haut), quel que soit son contenu
        deadline = time.time() + 12
        while time.time() < deadline:
            xml = dump()
            fields = []
            if xml:
                for n in ET.fromstring(xml).iter("node"):
                    if n.get("class") == "android.widget.EditText":
                        m = re.findall(r"\d+", n.get("bounds") or "")
                        if len(m) == 4:
                            x1, y1, x2, y2 = map(int, m)
                            fields.append(((x1 + x2) // 2, (y1 + y2) // 2))
            fields.sort(key=lambda c: c[1])
            if len(fields) > int(needle):
                x, y = fields[int(needle)]
                subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)])
                return 0
            time.sleep(1)
        print(f"CHAMP INTROUVABLE: {needle}")
        return 1
    if cmd == "bounds":  # bounds TEXTE : « x1 y1 x2 y2 » du dernier élément portant ce texte
        if not (xml := dump()):
            return 1
        last = None
        for n in ET.fromstring(xml).iter("node"):
            if needle in (n.get("text") or "") + "\n" + (n.get("content-desc") or ""):
                last = n
        if last is None:
            return 1
        print(" ".join(re.findall(r"\d+", last.get("bounds") or "")))
        return 0
    if cmd == "above":  # above A B : le premier A est affiché plus haut que le premier B (les deux visibles)
        xml = dump(); a, b = matches(xml, needle), matches(xml, sys.argv[3])
        if not a or not b:
            print(f"ABSENT: {needle if not a else sys.argv[3]}")
            return 1
        return 0 if a[0][2] < b[0][2] else 1
    secs = float(sys.argv[3]) if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else 20.0
    if cmd == "enabled":
        return 0 if enabled_last(dump(), needle) else 1
    if cmd == "has":
        return 0 if matches(dump(), needle) else 1
    if cmd == "wait":
        deadline = time.time() + secs
        while time.time() < deadline:
            if matches(dump(), needle):
                return 0
            time.sleep(1)
        return 1
    if cmd == "gone":
        deadline = time.time() + secs
        while time.time() < deadline:
            if not matches(dump(), needle):
                return 0
            time.sleep(1)
        return 1
    return 2


sys.exit(main())
