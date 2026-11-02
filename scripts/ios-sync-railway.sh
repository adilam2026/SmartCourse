#!/usr/bin/env bash
# Contrôle restant Android → iPhone, côté ANDROID (émulateur), sur le service Railway de RECETTE (HTTPS, données fictives).
# Les deux appareils joignent directement le même serveur, la même base et la même famille. Coordination par l'état du serveur
# (nom de la liste en cours, posé par le test iPhone) :
#   R0 Android (adil) ouvre une liste vide et l'affiche ;
#   « iphone-pret-1 »  → R1 Android ajoute « Bananes » : l'iPhone doit l'afficher seul (contrôlé côté iPhone) ;
#   « iphone-coupure » → R2 pendant la coupure réseau de l'iPhone, Android ajoute « Oranges » : l'iPhone doit l'afficher seul
#                        après rétablissement (reconnexion, contrôlé côté iPhone).
# Usage : ios-sync-railway.sh APK URL_RECETTE IDENTIFIANT_FAMILLE SORTIE ATTENTE_MINUTES
set -uo pipefail
APK_IN=$1; URL=$2; FAM=$3; OUTDIR=$4; WAIT_MIN=${5:-60}
source <(sed -n '/^PKG=/,/^adb shell pm grant/p' "$(dirname "$0")/native-e2e-lot3.sh" | sed -E 's/^APK=.*$/APK="$APK_IN"; FAMILY="$FAM"; OUT="$OUTDIR"/')
SERVER=$URL; BASE=$URL
fill_field() { $UI field "$1" >/dev/null || return 1; sleep 1; clear_field; adb shell input text "${2// /%s}"; sleep 1; }
signin() { fill_field 0 "$1"; hide_kb; fill_field 1 "$2"; hide_kb; fill_field 2 "$3"; hide_kb; $UI tap "Se connecter" --last >/dev/null; sleep 3; }
closeall_api() { api GET /api/lists/open >/dev/null; for l in $(jq -r '.lists[]?.id' /tmp/api.out); do api POST "/api/lists/$l/close" -d '{}' >/dev/null; done
  api GET /api/lists/active >/dev/null; local l; l=$(jq -r '.list.id // empty' /tmp/api.out); [ -n "$l" ] && api POST "/api/lists/$l/close" -d '{}' >/dev/null; true; }
list_name() { api GET /api/lists/active >/dev/null; jq -r '.list.name // ""' /tmp/api.out; }
has_item() { api GET /api/lists/active >/dev/null; jq -e --arg n "$1" '[.list.items[]? | select(.status != "removed") | .name] | index($n) != null' /tmp/api.out >/dev/null; }
wait_name() { for _ in $(seq 1 $((WAIT_MIN * 6))); do [ "$(list_name)" = "$1" ] && return 0; sleep 10; done; return 1; }
add_from_selection() { fill "Rechercher un produit" "$1"; hide_kb; $UI wait "$1" 10 >/dev/null; $UI tap "$1" --last >/dev/null; sleep 2
  $UI tap "Terminer ma sélection" >/dev/null; sleep 4; }

login_api adil 482913
[ -n "$COOKIE" ] || { echo "connexion API impossible à la recette"; exit 1; }
closeall_api
S=$(api POST /api/lists -d '{}'); LIST=$(jq -r '.list.id // empty' /tmp/api.out)
expect "R0a. serveur de recette : liste vide ouverte ($S)" test "$S" = 201
launch
expect "R0b. Android : écran de connexion" $UI wait "Bienvenue" 25
$UI tap "Se connecter" --last >/dev/null; sleep 2
fill "https://…" "$SERVER" --last; hide_kb
$UI tap "Tester et enregistrer" >/dev/null
$UI wait "${SERVER#https://}" 30 >/dev/null
signin "$FAMILY" adil 482913
expect "R0c. Android : administrateur connecté, liste vide affichée" $UI wait "Ajouter des articles" 30
shot r0-android-liste
wait_name iphone-pret-1; expect "R1a. l'iPhone affiche la liste (signal reçu du serveur)" test "$(list_name)" = iphone-pret-1
tapt "Ajouter des articles"; $UI wait "Rechercher un produit" 15 >/dev/null
add_from_selection "Bananes"
echo "$(date -u +%T) Android : « Bananes » envoyé" | tee -a "$OUT/resultats.txt"
expect "R1b. serveur : « Bananes » ajouté depuis Android dans la liste $LIST" has_item Bananes
shot r1-android-bananes
wait_name iphone-coupure; expect "R2a. coupure réseau de l'iPhone annoncée" test "$(list_name)" = iphone-coupure
sleep 30   # la coupure est en place (le Mac surveille le même signal toutes les 5 s)
tapt "Ajouter des articles"; $UI wait "Rechercher un produit" 15 >/dev/null
add_from_selection "Oranges"
echo "$(date -u +%T) Android : « Oranges » envoyé (pendant la coupure de l'iPhone)" | tee -a "$OUT/resultats.txt"
expect "R2b. serveur : « Oranges » ajouté depuis Android pendant la coupure" has_item Oranges
shot r2-android-oranges
echo "Échecs Android : $FAILS" | tee -a "$OUT/resultats.txt"
exit $FAILS
