#!/usr/bin/env bash
# Exécuté DANS l'émulateur Android (workflow native-proto) : installe l'APK du prototype natif,
# l'ouvre sur chaque écran/état et capture l'écran réel (adb screencap). Aucune image générée.
set -uo pipefail
PKG=app.smartcourse.courses.nativeproto
APK=${1:?apk}
OUT=${2:-native-captures}
mkdir -p "$OUT"
adb install -r "$APK" >/dev/null || { echo "installation impossible"; exit 1; }
adb shell settings put secure show_ime_with_hard_keyboard 1 || true
adb shell settings put global window_animation_scale 0 || true
adb shell settings put global transition_animation_scale 0 || true
adb shell settings put global animator_duration_scale 0 || true
adb shell settings put system accelerometer_rotation 0 || true
# L'émulateur logiciel est lent : on masque les boîtes système « ne répond pas » (lanceur) qui recouvriraient les captures.
adb shell settings put global hide_error_dialogs 1 || true
adb shell settings put global anr_show_background 0 || true
adb shell settings put secure anr_show_background 0 || true
adb shell input keyevent KEYCODE_WAKEUP || true
adb shell wm dismiss-keyguard || true
sleep 20

W=360
audit() { # nom : mesure les zones tactiles de l'écran affiché (personnel : 48 dp au moins)
  local name=$1
  adb shell uiautomator dump /sdcard/a.xml >/dev/null 2>&1
  adb exec-out cat /sdcard/a.xml > "$OUT/${name}-${W}.xml"
  local res
  res=$(python3 scripts/touch-audit.py "$OUT/${name}-${W}.xml" $((1080 * 160 / W)) 2>&1); local rc=$?
  echo "TOUCH_${name}_${W}=$([ $rc = 0 ] && echo OK || echo ECHEC) | $(echo "$res" | tr '\n' ' ')" >> "$OUT/controles.txt"
}

shot() { # nom, extras...
  local name=$1; shift
  adb shell am start -S -W -n "$PKG/.MainActivity" "$@" >/dev/null 2>&1
  sleep 4
  # Si une boîte « ne répond pas » est malgré tout apparue, on choisit « Attendre » puis on laisse l'écran se rétablir.
  if adb shell uiautomator dump /sdcard/d.xml >/dev/null 2>&1 && adb shell cat /sdcard/d.xml | grep -q "isn't responding"; then
    adb shell input keyevent KEYCODE_BACK; sleep 2
    adb shell am start -W -n "$PKG/.MainActivity" "$@" >/dev/null 2>&1; sleep 3
  fi
  adb exec-out screencap -p > "$OUT/${name}-${W}.png"
  case "$name" in V01-connexion|V03-*|V04-selection-carres-personnel|V04-selection-liste-personnel|V04-selection-cartes-personnel|V05-personnel-*) audit "$name";; esac
}

run_all() {
  shot V01-connexion
  shot V01-premiere-rejoindre --es tab first
  shot V01-premiere-creer --es tab first --es sub create
  shot V01-aide --ez help true
  shot V01-clavier --ez keyboard true
  shot V02-liste-admin --es screen v02
  shot V02-menu --es screen v02 --ez menu true
  shot V02-cloture-confirmation --es screen v02 --ez confirm true
  shot V02-tout-achete --es screen v02 --es state allbought
  shot V02-favoris --es screen v02 --ez favs true
  shot V02-textes-longs --es screen v02 --ez long true
  shot V03-liste-personnel --es screen v03 --es role staff
  shot V03-a-acheter --es screen v03 --es role staff --es filter todo
  shot V03-vide --es screen v03 --es role staff --es state empty
  shot V03-textes-longs --es screen v03 --es role staff --ez long true
  shot V04-selection-liste --es screen v04 --es mode list --ez preselect true
  shot V04-selection-carres --es screen v04 --es mode grid --ez preselect true
  shot V04-selection-grandes-cartes --es screen v04 --es mode cards --ez preselect true
  shot V04-selection-carres-personnel --es screen v04 --es role staff --es mode grid --ez preselect true
  shot V04-selection-textes-longs --es screen v04 --es mode cards --ez long true
  shot V04-selection-liste-personnel --es screen v04 --es role staff --es mode list --ez preselect true
  shot V04-selection-cartes-personnel --es screen v04 --es role staff --es mode cards --ez preselect true
  shot V05-personnel-quantite --es screen v04 --es role staff --es sheet tomates --ez selected true --es qty 1500
  shot V05-quantite-kg --es screen v04 --es sheet tomates --ez selected true --es qty 1500
  shot V05-quantite-g --es screen v04 --es sheet tomates --ez selected true --es qty 750
  shot V05-quantite-litre --es screen v04 --es sheet lait --ez selected true --es qty 1500
  shot V05-quantite-piece --es screen v04 --es sheet oeufs --ez selected true --es qty 12
  shot V05-quantite-clavier --es screen v04 --es sheet tomates --ez selected true --es qty 1500 --ez keyboard true
  shot V05-quantite-prix-actifs --es screen v04 --es sheet tomates --es qty 1500 --ez prices true
  shot V06-historique --es screen v06
  shot V06-historique-menu --es screen v06 --es omenu o3
  shot V06-detail --es screen v06d
  shot V06-detail-menu --es screen v06d --ez menu true
  shot V06-suppression-confirmation --es screen v06d --ez confirm true
  shot V07-administration --es screen v07
  shot V07-reinitialiser --es screen v07 --ez confirm true
  shot V13-recuperation --es path v07,stub/recuperation
  shot V14-notifications --es path v07,stub/notifications
  shot V15-sauvegarde --es path v07,stub/sauvegarde
  shot V16-apropos --es path v07,stub/apropos
  shot V08-profils --es screen v08
  shot V08-menu-profil --es screen v08 --es pmenu 1
  shot V08-menu-protege --es screen v08 --es pmenu 0
  shot V08-suppression-confirmation --es screen v08 --es pdelete 1
  shot V08-textes-longs --es screen v08 --ez long true
  shot V09-catalogue-tous --es screen v09
  shot V09-catalogue-dans-mon-catalogue --es screen v09 --es tab in
  shot V09-catalogue-a-ajouter --es screen v09 --es tab out
  shot V10-prix --es screen v10
  shot V10-prix-modification --es screen v10 --es edit tomates
  shot V10-prix-ajouter --es screen v10 --es edit menthe
  shot V10-prix-manquants --es screen v10 --es filter missing
  shot V10-prix-synchronisation --es screen v10 --ez sync true
  shot V11-affichage --es screen v11
  shot V11-affichage-prix-actifs --es screen v11 --ez prices true
  shot V12-statistiques --es screen v12
  shot V12-aide --es screen v12 --ez help true
  shot V12-textes-longs-courts --es screen v12 --ez long true
}

: > "$OUT/controles.txt"
for DP in 360 390; do
  W=$DP
  adb shell wm size 1080x2340
  adb shell wm density $((1080 * 160 / DP))
  sleep 3
  adb shell wm size >> "$OUT/controles.txt"; adb shell wm density >> "$OUT/controles.txt"
  run_all
done

# ───────── Icône : rendu réel dans le lanceur Android, avec les différents masques ─────────
launcher_open_drawer() {
  adb shell input keyevent KEYCODE_HOME; sleep 2
  adb shell input swipe 540 2100 540 500 250; sleep 2
  for _ in 1 2 3 4 5 6; do
    python3 scripts/native-ui.py has "Courses (n" 1 && return 0
    adb shell input swipe 540 1700 540 700 300; sleep 1
  done
  return 1
}
adb shell wm size reset; adb shell wm density reset; sleep 2
adb shell cmd overlay list 2>/dev/null | grep -iE "icon|shape" > "$OUT/overlays-icones.txt" || true
pkg_for() { grep -oE '[a-zA-Z0-9_.]*(icon|shape)[a-zA-Z0-9_.]*' "$OUT/overlays-icones.txt" | grep -i "$1" | head -1; }
for shape in circle roundedrect squircle teardrop; do
  P=$(pkg_for "$shape")
  if [ -n "$P" ]; then
    adb shell cmd overlay enable-exclusive --category "$P" >/dev/null 2>&1 || adb shell cmd overlay enable "$P" >/dev/null 2>&1
    echo "MASQUE_$shape=$P" >> "$OUT/controles.txt"
  else
    echo "MASQUE_$shape=indisponible" >> "$OUT/controles.txt"
  fi
  adb shell am force-stop com.google.android.apps.nexuslauncher; sleep 3
  if launcher_open_drawer; then echo "TIROIR_$shape=OK" >> "$OUT/controles.txt"; else echo "TIROIR_$shape=icone-introuvable" >> "$OUT/controles.txt"; fi
  adb exec-out screencap -p > "$OUT/launcher-$shape.png"
done
# Icônes thématiques (Android 13+) : active l'option et recharge le lanceur
adb shell settings put secure themed_icon_enabled 1 >/dev/null 2>&1
adb shell am force-stop com.google.android.apps.nexuslauncher; sleep 3
launcher_open_drawer && echo "TIROIR_themed=OK" >> "$OUT/controles.txt" || echo "TIROIR_themed=icone-introuvable" >> "$OUT/controles.txt"
adb exec-out screencap -p > "$OUT/launcher-themed.png"
adb shell settings put secure themed_icon_enabled 0 >/dev/null 2>&1
adb shell input keyevent KEYCODE_HOME
# Écran de démarrage (démarrage à froid, capture au plus tôt : non garantie)
for d in 0.15 0.4 0.8; do
  adb shell am force-stop $PKG; sleep 1
  adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep $d
  adb exec-out screencap -p > "$OUT/demarrage-$d.png"
done

# Retour Android : V07 → V08 puis touche retour = retour à V07 ; clavier ouvert : un premier retour ferme le clavier seulement.
W=360
adb shell wm size 1080x2340; adb shell wm density 480; sleep 2
adb shell am start -S -W -n "$PKG/.MainActivity" --es path v07,v08 >/dev/null 2>&1; sleep 3
adb exec-out screencap -p > "$OUT/retour-1-profils-$W.png"
adb shell input keyevent KEYCODE_BACK; sleep 2
adb exec-out screencap -p > "$OUT/retour-2-apres-retour-$W.png"
adb shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1; adb shell cat /sdcard/u.xml > "$OUT/retour-2.xml"
if grep -q "Administration\|Supprimer toute la famille" "$OUT/retour-2.xml"; then echo "RETOUR_ECRAN_PRECEDENT=OK" >> "$OUT/controles.txt"; else echo "RETOUR_ECRAN_PRECEDENT=ECHEC" >> "$OUT/controles.txt"; fi

adb shell am start -S -W -n "$PKG/.MainActivity" --ez keyboard true >/dev/null 2>&1; sleep 3
adb shell dumpsys input_method | grep -E "mInputShown=true" >/dev/null && echo "CLAVIER_VISIBLE=OUI" >> "$OUT/controles.txt" || echo "CLAVIER_VISIBLE=NON" >> "$OUT/controles.txt"
adb shell input keyevent KEYCODE_BACK; sleep 2
adb shell dumpsys window | grep -E "mCurrentFocus" | grep -q "$PKG" && echo "RETOUR_FERME_CLAVIER_SANS_QUITTER=OK" >> "$OUT/controles.txt" || echo "RETOUR_FERME_CLAVIER_SANS_QUITTER=ECHEC" >> "$OUT/controles.txt"
adb exec-out screencap -p > "$OUT/retour-3-clavier-ferme-$W.png"

# Plantages éventuels
adb logcat -d -b crash > "$OUT/logcat-crash.txt" 2>&1 || true
echo "CRASH_APPLICATION=$(grep -c app.smartcourse "$OUT/logcat-crash.txt")" >> "$OUT/controles.txt"
echo "CRASH_AUTRES_APPLICATIONS_DE_LEMULATEUR=$(grep -c "Cmdline:" "$OUT/logcat-crash.txt")" >> "$OUT/controles.txt"
ls "$OUT" | wc -l
