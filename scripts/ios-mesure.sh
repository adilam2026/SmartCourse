#!/usr/bin/env bash
# Mesure RÉELLE de la réutilisation pour iOS : compile tous les fichiers de l'application Android pour iOS, sans adaptation,
# puis résume les erreurs du compilateur par fichier. Un fichier sans erreur compile tel quel (sous réserve des erreurs en
# cascade : une référence à un fichier en erreur peut masquer ou provoquer d'autres erreurs).
set -uo pipefail
cd "$(dirname "$0")/../ios"
./gradlew --no-daemon -q :shared:compileKotlinIosSimulatorArm64 -Pmesure=1 --continue > ../ios-mesure.log 2>&1
rc=$?
cd ..
grep -oE '^e: file://[^ ]*nativeproto/[A-Za-z/]+\.kt' ios-mesure.log | sed 's#.*nativeproto/##' | sort | uniq -c | sort -rn > ios-mesure-fichiers.txt
total=$(find android-native/app/src/main/java -name '*.kt' | wc -l)
bad=$(wc -l < ios-mesure-fichiers.txt)
echo "Compilation iOS sans adaptation : code $rc ; $((total - bad)) fichiers sur $total sans erreur, $bad avec erreurs."
echo "Erreurs par fichier :"; cat ios-mesure-fichiers.txt
echo "Catégories d'erreurs (références non résolues les plus fréquentes) :"
grep -oE "Unresolved reference '[^']+'|Unresolved reference: [A-Za-z_.]+" ios-mesure.log | sort | uniq -c | sort -rn | head -40
grep -E '^e: ' ios-mesure.log | grep -v 'Unresolved reference' | sed -E 's#^e: file://[^ ]*nativeproto/##' | cut -c1-200 | head -40
