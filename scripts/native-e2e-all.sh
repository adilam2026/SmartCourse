#!/usr/bin/env bash
# Lance les parcours de bout en bout l'un après l'autre : l'échec d'un parcours n'empêche pas l'autre de s'exécuter.
# Usage : native-e2e-all.sh APK CODE_FAMILLE
HERE="$(cd "$(dirname "$0")" && pwd)"
bash "$HERE/native-e2e.sh" "$1" "$2" native-e2e; R1=$?
bash "$HERE/native-e2e-lot2.sh" "$1" "$2" native-e2e-lot2; R2=$?
echo "PARCOURS_LOT1=$R1 PARCOURS_LOT2=$R2"
[ "$R1" = 0 ] && [ "$R2" = 0 ]
