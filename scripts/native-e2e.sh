#!/usr/bin/env bash
# Parcours de connexion de bout en bout : APK natif réel sur émulateur Android + serveur de recette réel (base jetable).
# Usage : native-e2e.sh APK CODE_FAMILLE SORTIE
set -uo pipefail
PKG=app.smartcourse.courses.nativeproto
APK=${1:?apk}; FAMILY=${2:?code famille}; OUT=${3:-native-e2e}
SERVER=http://10.0.2.2:3000
HERE="$(cd "$(dirname "$0")" && pwd)"
UI="python3 $HERE/native-ui.py"
mkdir -p "$OUT"; : > "$OUT/resultats.txt"
FAILS=0
ok()   { echo "PASS  $1" | tee -a "$OUT/resultats.txt"; }
ko()   { echo "FAIL  $1" | tee -a "$OUT/resultats.txt"; FAILS=$((FAILS+1)); local n; n=$(echo "$1" | tr -c 'a-zA-Z0-9' '_' | cut -c1-40); adb exec-out screencap -p > "$OUT/echec-$n.png" || true; adb shell uiautomator dump /sdcard/f.xml >/dev/null 2>&1; adb exec-out cat /sdcard/f.xml > "$OUT/echec-$n.xml" 2>/dev/null || true; }
check() { if "$@" ; then :; fi; }
expect() { local label=$1; shift; if "$@"; then ok "$label"; else ko "$label"; fi; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
sql() { docker exec sc-recette-pg psql -U smart -d smartcourse -tAc "$1"; }
launch() { adb shell am force-stop $PKG; adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 3; }
hide_kb() { adb shell dumpsys input_method | grep -q "mInputShown=true" && adb shell input keyevent KEYCODE_BACK; sleep 1; }
clear_field() { adb shell input keyevent KEYCODE_MOVE_END; for _ in $(seq 1 30); do adb shell input keyevent 67; done; }
# fill HINT_OU_VALEUR VALEUR : touche le champ (par son texte indicatif ou sa valeur actuelle), le vide, saisit
fill() { $UI tap "$1" ${3:-} >/dev/null || return 1; sleep 1; clear_field; adb shell input text "$2"; sleep 1; }
signin() { # famille identifiant code
  fill "${PREV_FAMILY:-Code famille}" "$1"; fill "${PREV_LOGIN:-Identifiant}" "$2"; fill "Code d'accès" "$3"; hide_kb
  $UI tap "Se connecter" --last >/dev/null; sleep 3; }

adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell settings put global window_animation_scale 0 >/dev/null 2>&1; adb shell settings put global transition_animation_scale 0 >/dev/null 2>&1; adb shell settings put global animator_duration_scale 0 >/dev/null 2>&1
adb shell wm size 1080x2340 >/dev/null; adb shell wm density 443 >/dev/null
adb uninstall $PKG >/dev/null 2>&1 || true
adb install -r "$APK" >/dev/null || { echo "installation impossible"; exit 1; }

# 1. Premier lancement : écran de connexion, aucun serveur configuré
launch
expect "1a. premier lancement : écran de connexion" $UI wait "Bienvenue" 25
expect "1b. aucun serveur : 'Serveur : à définir'" $UI has "à définir"
$UI tap "Se connecter" --last >/dev/null; sleep 2
expect "1c. connexion sans serveur : ouvre la saisie du serveur" $UI wait "Tester et enregistrer" 8
shot e2e-1-sans-serveur

# 2. Serveur injoignable puis serveur valide
fill "https://…" "http://10.0.2.2:9" --last; hide_kb
$UI tap "Tester et enregistrer" >/dev/null; sleep 3
expect "2a. serveur injoignable : message clair" $UI wait "Impossible de joindre" 15
shot e2e-2-serveur-injoignable
fill "10.0.2.2:9" "$SERVER" --last; hide_kb
$UI tap "Tester et enregistrer" >/dev/null
expect "2b. serveur valide enregistré" $UI wait "10.0.2.2:3000" 20

# 3. Mauvais code puis bon code
PREV_FAMILY="Code famille"; PREV_LOGIN="Identifiant"
signin "$FAMILY" adil 000000
expect "3a. mauvais code d'accès : message d'erreur" $UI wait "Identifiants incorrects" 15
shot e2e-3-mauvais-code
fill "Code d'accès" "482913"; hide_kb
$UI tap "Se connecter" --last >/dev/null
expect "3b. bon code : liste de l'administrateur" $UI wait "Ma liste" 25
expect "3c. bandeau : parties réelles annoncées" $UI has "réel : compte"
shot e2e-4-connecte

# 4. Compte
$UI tap "Compte" >/dev/null; sleep 2
expect "4a. compte : nom du profil" $UI wait "Adil" 10
expect "4b. compte : rôle réel" $UI has "Administrateur principal"
expect "4c. compte : famille réelle" $UI has "$FAMILY"
shot e2e-5-compte
adb shell input keyevent KEYCODE_BACK; sleep 1

# 5. Session conservée après fermeture complète
launch
expect "5a. rouvre directement sur la liste (session conservée)" $UI wait "Ma liste" 25
expect "5b. pas d'écran de connexion" $UI gone "Bienvenue" 3

# 6. Serveur arrêté : session conservée, mode hors connexion
docker stop sc-recette-app >/dev/null
launch
expect "6a. serveur arrêté : l'application reste ouverte" $UI wait "Ma liste" 25
expect "6b. serveur arrêté : indication hors connexion" $UI wait "Hors connexion" 25
shot e2e-6-hors-connexion
docker start sc-recette-app >/dev/null
for _ in $(seq 1 60); do curl -fsS --max-time 3 http://127.0.0.1:3000/health >/dev/null 2>&1 && break; sleep 2; done
launch
expect "6c. serveur de retour : plus d'indication hors connexion" $UI gone "Hors connexion" 25

# 7. Session révoquée côté serveur → retour à la connexion avec explication
sql "UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL" >/dev/null
launch
expect "7a. session révoquée : retour à la connexion" $UI wait "Bienvenue" 25
expect "7b. session révoquée : explication" $UI has "session a expiré"
shot e2e-7-session-expiree
launch
expect "7c. session révoquée : reste déconnecté au lancement suivant" $UI wait "Bienvenue" 15

# 8. Personnel : mêmes écrans de connexion, présentation personnelle
PREV_FAMILY="$FAMILY"; PREV_LOGIN="adil"
signin "$FAMILY" marie 573918
expect "8a. personnel : liste du jour" $UI wait "Liste du jour" 25
$UI tap "Compte" >/dev/null; sleep 2
expect "8b. personnel : rôle réel" $UI wait "Personnel" 10
shot e2e-8-personnel

# 9. Déconnexion : fermeture locale + révocation côté serveur
$UI tap "Se déconnecter" >/dev/null; sleep 2
$UI tap "Se déconnecter" --last >/dev/null; sleep 3
expect "9a. déconnexion : retour à la connexion" $UI wait "Bienvenue" 20
sleep 3
ACTIVE=$(sql "SELECT count(*) FROM sessions s JOIN profiles p ON p.id=s.profile_id WHERE p.login='marie' AND s.revoked_at IS NULL")
expect "9b. déconnexion : session révoquée côté serveur (actives=$ACTIVE)" test "$ACTIVE" = "0"
launch
expect "9c. après déconnexion : pas de reconnexion automatique" $UI wait "Bienvenue" 15
shot e2e-9-deconnecte

# 10. Réseau coupé pendant la connexion
docker stop sc-recette-app >/dev/null
PREV_FAMILY="$FAMILY"; PREV_LOGIN="marie"
signin "$FAMILY" adil 482913
expect "10a. serveur arrêté : connexion refusée avec message clair" $UI wait "Impossible de joindre" 20
shot e2e-10-reseau-coupe
docker start sc-recette-app >/dev/null
for _ in $(seq 1 60); do curl -fsS --max-time 3 http://127.0.0.1:3000/health >/dev/null 2>&1 && break; sleep 2; done

# 11. Profil désactivé : accès refusé ; réactivé : parent sans Réglages
PREV_LOGIN="adil"
sql "UPDATE profiles SET active=false WHERE login='lamiaa'" >/dev/null
signin "$FAMILY" lamiaa 573918
expect "11a. profil désactivé : accès refusé" $UI wait "Identifiants incorrects" 15
sql "UPDATE profiles SET active=true WHERE login='lamiaa'" >/dev/null
PREV_LOGIN="lamiaa"
fill "Code d'accès" "573918"; hide_kb
$UI tap "Se connecter" --last >/dev/null
expect "11b. profil réactivé : connexion du parent" $UI wait "Ma liste" 25
expect "11c. parent : pas d'onglet Réglages" $UI gone "Réglages" 3
shot e2e-11-parent

echo "ECHECS=$FAILS" | tee -a "$OUT/resultats.txt"
adb logcat -d -b crash > "$OUT/logcat-crash.txt" 2>&1 || true
echo "CRASH_LIGNES=$(wc -l < "$OUT/logcat-crash.txt")" | tee -a "$OUT/resultats.txt"
[ "$FAILS" = 0 ]
