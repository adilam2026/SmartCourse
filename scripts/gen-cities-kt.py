#!/usr/bin/env python3
"""Génère la liste des villes de l'application Android depuis server/src/cities.ts (même liste que le serveur et le web)."""
import re
src = open("server/src/cities.ts", encoding="utf-8").read()
arr = re.search(r"CITIES: readonly string\[\] = \[(.*?)\];", src, re.S).group(1)
cities = re.findall(r'"((?:[^"\\]|\\.)*)"', arr)
lines = ",\n".join('    "%s"' % c.replace("\\", "\\\\").replace('"', '\\"') for c in cities)
open("android-native/app/src/main/java/app/smartcourse/courses/nativeproto/Cities.kt", "w", encoding="utf-8").write(f'''// Fichier généré par scripts/gen-cities-kt.py depuis server/src/cities.ts : ne pas modifier à la main (un test compare les deux listes).
package app.smartcourse.courses.nativeproto

import java.text.Normalizer

val CITIES: List<String> = listOf(
{lines},
)

/** Même normalisation que le serveur (flatCity) : sans accents, sans casse, tirets et apostrophes = espaces. */
fun flatCity(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\\\p{{M}}"), "").lowercase()
    .replace(Regex("['’-]"), " ").replace(Regex("\\\\s+"), " ").trim()
''')
print(len(cities), "villes")
