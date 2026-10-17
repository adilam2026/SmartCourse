#!/usr/bin/env bash
# Captures de la fiche Google Play : écrans RÉELS de la version finale (même code que l'APK livré, -Pfinal=1), sur un serveur de
# recette LOCAL et jetable rempli de données FICTIVES (Famille Martin : Sophie, Karim, Léa, Nadia ; adresse example.org).
# Version 1166 : trois listes en cours nommées, Budget en MAD (magasins génériques), rappels d'achat, statistiques.
# 9 écrans capturés ; la fiche Play en retient 8 (maximum autorisé), voir play-visuels.py.
# Aucun e-mail personnel, aucun code famille réel, aucune donnée de production.
# Format Play : 1080 × 1920 (9:16 ; le côté long ne dépasse pas deux fois le côté court).
# Usage : native-play-captures.sh APK SORTIE   (le serveur de recette doit avoir été lancé avec SEED_PLAY=1)
set -uo pipefail
APK=${1:?apk}; OUT=${2:-play-captures}
PKG=app.smartcourse.courses.natif; ACT="$PKG/app.smartcourse.courses.nativeproto.MainActivity"
HERE="$(cd "$(dirname "$0")" && pwd)"; UI="python3 $HERE/native-ui.py"; BASE=http://127.0.0.1:3000
mkdir -p "$OUT"; : > "$OUT/resultats.txt"; FAILS=0
ok() { echo "PASS  $1" | tee -a "$OUT/resultats.txt"; }
ko() { echo "FAIL  $1" | tee -a "$OUT/resultats.txt"; FAILS=$((FAILS+1)); adb exec-out screencap -p > "$OUT/echec-$(echo "$1" | tr -c 'a-zA-Z0-9' '_' | cut -c1-30).png" || true; }
expect() { local l=$1; shift; if "$@"; then ok "$l"; else ko "$l"; fi; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; echo "capture $1" | tee -a "$OUT/resultats.txt"; }
sql() { docker exec -i sc-recette-pg psql -U smart -d smartcourse -v ON_ERROR_STOP=1 -tA "$@"; }
hide_kb() { adb shell dumpsys input_method | grep -q "mInputShown=true" && adb shell input keyevent KEYCODE_BACK; sleep 1; }
clear_field() { adb shell input keyevent KEYCODE_MOVE_END; for _ in $(seq 1 30); do adb shell input keyevent 67; done; }
fill() { $UI tap "$1" ${3:-} >/dev/null || return 1; sleep 1; clear_field; adb shell input text "$2"; sleep 1; }
tapt() { $UI tap "$@" >/dev/null; sleep 2; }

FAMILY=$(sql -c "SELECT code FROM families WHERE name='Famille Martin'")
[ -n "$FAMILY" ] || { echo "Famille Martin absente : lancer la recette avec SEED_PLAY=1"; exit 1; }
python3 "$HERE/play-seed.py" "$BASE" "$FAMILY" /tmp/play-dates.sql | tee -a "$OUT/resultats.txt" || exit 1
sql < /tmp/play-dates.sql >/dev/null || exit 1
expect "S0. données fictives : 3 courses passées, 3 listes en cours" test "$(sql -c "SELECT count(*) FILTER (WHERE status='archived')||'/'||count(*) FILTER (WHERE status='active') FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY'")" = "3/3"

# Écran au format Play, barre d'état propre (mode démonstration d'Android : heure fixe, réseau et batterie pleins, aucune notification)
adb shell wm size 1080x1920 >/dev/null; adb shell wm density 420 >/dev/null
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e fully true >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command network -e mobile show -e level 4 -e datatype none -e fully true >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null

# Application propre (aucune session antérieure), connexion de Sophie (administratrice fictive)
adb install -r "$APK" >/dev/null; adb shell pm clear $PKG >/dev/null; adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
adb shell am start -W -n "$ACT" >/dev/null 2>&1; sleep 4
$UI wait "Bienvenue" 25 >/dev/null
# Écran de 1920 px : le clavier masque les champs suivants, il est refermé après chaque saisie.
fill "Code famille" "$FAMILY"; hide_kb; fill "Identifiant" sophie; hide_kb; fill "Code d'accès" 482913; hide_kb
$UI tap "Se connecter" --last >/dev/null; sleep 4
expect "S1. liste partagée affichée (liste de la semaine, sélecteur de listes)" bash -c "$UI wait 'Ma liste' 25 && $UI wait 'Courses de la semaine' 10"
sleep 3; shot play-1-liste-partagee

# Articles achetés : la section « Déjà achetés » (achats de Karim)
for _ in 1 2 3 4; do $UI has "Acheté par Karim" && break; adb shell input swipe 540 1500 540 700 400; sleep 1; done
expect "S4. articles achetés visibles (« Acheté par Karim »)" $UI wait "Acheté par Karim" 10
sleep 1; shot play-4-articles-achetes
for _ in 1 2 3 4; do adb shell input swipe 540 600 540 1600 200; done; sleep 1

# Plusieurs listes en cours : le sélecteur ouvre les trois listes de la famille
tapt "listes en cours"
expect "S2. listes en cours (3 listes nommées)" bash -c "$UI wait 'Anniversaire de Léa' 15 && $UI has 'Produits ménagers'"
sleep 2; shot play-2-listes-en-cours
adb shell input keyevent KEYCODE_BACK; sleep 2

# Historique : trois courses passées
tapt "Historique"
expect "S7. historique des courses" $UI wait "Recommander" 15
sleep 1; shot play-7-historique

# Statistiques : achats du mois, par catégorie, produits les plus achetés
tapt "Statistiques"
expect "S9. statistiques du mois" bash -c "$UI wait 'Achats par catégorie' 20 && $UI has 'Produits différents'"
sleep 2; shot play-9-statistiques

# Budget : vue d'ensemble du mois (solde, dépenses, entrées, budgets)
tapt "Budget"
expect "S5. budget du mois" $UI wait "Solde de mon compte" 20
sleep 2; shot play-5-budget

# Budgets mensuels par catégorie
for _ in 1 2 3 4 5; do $UI has "Budgets mensuels" && break; adb shell input swipe 540 1500 540 700 400; sleep 1; done
tapt "Budgets mensuels"
expect "S6. budgets mensuels" bash -c "$UI wait 'Transport' 15 && $UI has 'Maison'"
sleep 2; shot play-6-budgets-mensuels
adb shell input keyevent KEYCODE_BACK; sleep 2

# Rappels d'achat : Réglages → Notifications et rappels, rappel activé du lundi au samedi à 18:00
tapt "Réglages"
for _ in 1 2 3; do $UI has "Notifications et rappels" && break; adb shell input swipe 540 1500 540 700 400; sleep 1; done
tapt "Notifications et rappels"
$UI wait "Me rappeler les articles restants" 15 >/dev/null
tapt "Me rappeler les articles restants"
tapt "Dim"
expect "S8. rappels d'achat activés" bash -c "$UI wait '18:00' 10 && $UI has 'Ajouter un horaire'"
sleep 1; shot play-8-rappels
adb shell input keyevent KEYCODE_BACK; sleep 2

# Sélection avec photos : « Ajouter des articles », affichage en carrés
tapt "Liste"; tapt "Ajouter des articles"
expect "S3. sélection avec photos" $UI wait "Terminer ma sélection" 15
$UI tap "Carrés" >/dev/null 2>&1; sleep 2
for _ in 1 2 3 4; do adb shell input swipe 540 600 540 1600 200; done; sleep 1
sleep 2; shot play-3-selection-photos

adb shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null
adb shell wm size reset >/dev/null; adb shell wm density reset >/dev/null
echo "Captures : $(ls "$OUT"/play-*.png 2>/dev/null | wc -l) / 9 ; échecs : $FAILS" | tee -a "$OUT/resultats.txt"
exit $FAILS
