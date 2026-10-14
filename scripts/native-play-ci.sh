#!/usr/bin/env bash
# CI Google Play, sur UN émulateur Android 16 (API 36, le niveau cible exigé par Google Play) :
# 1. parcours de la version finale (sections choisies) sur la recette locale habituelle ;
# 2. recette relancée avec la famille FICTIVE (SEED_PLAY=1) et captures de la fiche Play.
# Usage : native-play-ci.sh APK CODE_FAMILLE
set -uo pipefail
APK=${1:?apk}; FAMILY=${2:?code famille}
HERE="$(cd "$(dirname "$0")" && pwd)"
R=0
if [ "${SECTIONS:-}" != "aucune" ]; then
  bash "$HERE/native-e2e-final.sh" "$APK" "$FAMILY" native-final-36 || R=1
fi
# Parcours ciblé (sections choisies) : pas de captures, elles ne changent pas.
if [ -n "${SECTIONS:-}" ] && [ "${SECTIONS}" != "aucune" ]; then exit $R; fi
"$HERE/recette-locale.sh" --stop >/dev/null
SEED_PLAY=1 NO_TUNNEL=1 "$HERE/recette-locale.sh" >/dev/null || { echo "recette fictive impossible"; exit 1; }
# Les captures ne conditionnent pas le bundle (leur résultat est relu avant toute utilisation) ; le parcours, si.
bash "$HERE/native-play-captures.sh" "$APK" play-captures || echo "captures incomplètes : voir play-captures/resultats.txt"
exit $R
