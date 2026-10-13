#!/usr/bin/env bash
# Lance les parcours de bout en bout l'un après l'autre : l'échec d'un parcours n'empêche pas l'autre de s'exécuter.
# SKIP_LOT1=1 : relance rapide du seul lot 2 (mise au point).
# Usage : native-e2e-all.sh APK CODE_FAMILLE
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "${CIBLE:-}" = "1" ]; then
  CASES=$(echo "${MSG:-}" | grep -oE '\[cible [A-Z0-9 ]+\]' | head -1 | sed -E 's/\[cible ([A-Z0-9 ]+)\]/\1/')
  bash "$HERE/native-e2e-cible.sh" "$1" "$2" native-e2e-cible $CASES; exit $?
fi
R1=0
if [ "${SKIP_LOT1:-}" != "1" ]; then bash "$HERE/native-e2e.sh" "$1" "$2" native-e2e; R1=$?; fi
R2=0; R3=0
if [ "${SKIP_LOT2:-}" != "1" ]; then bash "$HERE/native-e2e-lot2.sh" "$1" "$2" native-e2e-lot2; R2=$?; fi
bash "$HERE/native-e2e-lot3.sh" "$1" "$2" native-e2e-lot3; R3=$?
echo "PARCOURS_LOT1=$R1 PARCOURS_LOT2=$R2 PARCOURS_LOT3=$R3"
[ "$R1" = 0 ] && [ "$R2" = 0 ] && [ "$R3" = 0 ]
