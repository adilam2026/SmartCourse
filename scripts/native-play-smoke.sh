#!/usr/bin/env bash
# APK généré depuis le bundle Google Play : installation et ouverture sur Android 16 (écran de connexion), sans connexion au
# serveur permanent ni donnée réelle lue ou écrite.
# Usage : native-play-smoke.sh APK SORTIE
set -uo pipefail
APK=${1:?apk}; OUT=${2:-play-smoke}
PKG=app.smartcourse.courses.natif; HERE="$(cd "$(dirname "$0")" && pwd)"; UI="python3 $HERE/native-ui.py"
mkdir -p "$OUT"; : > "$OUT/resultats.txt"; FAILS=0
expect() { local l=$1; shift; if "$@"; then echo "PASS  $l" | tee -a "$OUT/resultats.txt"; else echo "FAIL  $l" | tee -a "$OUT/resultats.txt"; FAILS=$((FAILS+1)); fi; }
expect "installation" adb install -r "$APK"
expect "Android 16 (API 36)" test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 36
V=$(adb shell dumpsys package $PKG | grep -m1 -oE "versionCode=[0-9]+ minSdk=[0-9]+ targetSdk=[0-9]+"); echo "$V" | tee -a "$OUT/resultats.txt"
expect "cible API 36 sur l'appareil" bash -c "echo '$V' | grep -q 'targetSdk=36'"
adb shell am start -W -n "$PKG/app.smartcourse.courses.nativeproto.MainActivity" >/dev/null; sleep 6
expect "écran de connexion" $UI wait "Bienvenue" 25
expect "aucun bandeau ni serveur à saisir" bash -c "! $UI has RECETTE && ! $UI has 'Serveur :' && ! $UI has PROTOTYPE"
adb exec-out screencap -p > "$OUT/android16-connexion.png"
adb shell input keyevent KEYCODE_BACK; sleep 2
expect "retour système : l'application se ferme sans plantage" bash -c "! adb logcat -d -b crash | grep -q $PKG"
echo "ECHECS=$FAILS" | tee -a "$OUT/resultats.txt"
[ "$FAILS" = 0 ]
