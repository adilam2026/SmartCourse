#!/usr/bin/env bash
# Tests CIBLÉS : reproduisent un par un les échecs du parcours des lots 3 à 6, sans rejouer toute la suite.
# Chaque cas part d'un état propre. Usage : native-e2e-cible.sh APK CODE_FAMILLE SORTIE [cas…]  (cas : M | K9 | R ; tous par défaut)
set -uo pipefail
CASES=("${@:4}"); [ ${#CASES[@]} -eq 0 ] && CASES=(M K9 R)
# Fonctions et installation communes, reprises telles quelles du parcours complet (lignes 4 à l'installation de l'APK).
source <(sed -n '/^PKG=/,/^adb shell pm grant/p' "$(dirname "$0")/native-e2e-lot3.sh")
want() { for c in "${CASES[@]}"; do [ "$c" = "$1" ] && return 0; done; return 1; }
fresh_list() { login_api adil 482913; api GET /api/lists/active >/dev/null; local l; l=$(jq -r '.list.id // empty' /tmp/api.out); [ -n "$l" ] && api POST "/api/lists/$l/close" -d '{}' >/dev/null; api POST /api/lists -d '{}' >/dev/null; jq -r .list.id /tmp/api.out; }
first_login() { launch; $UI wait "Bienvenue" 25 >/dev/null; $UI tap "Se connecter" --last >/dev/null; sleep 2; fill "https://…" "$SERVER" --last; hide_kb; $UI tap "Tester et enregistrer" >/dev/null; $UI wait "10.0.2.2:3000" 20 >/dev/null; signin "$FAMILY" "$1" "$2"; }

if want M; then
  echo "═══ Cas M : liste terminée pendant l'attente → « Reprendre » ═══" | tee -a "$OUT/resultats.txt"
  ACTIVE=$(fresh_list)
  first_login marie 573918
  expect "M0. personnel connecté" $UI wait "Liste du jour" 25
  tapt "Choisir"
  fill "Rechercher un produit" "Carottes"; hide_kb
  docker stop sc-recette-app >/dev/null
  $UI tap "Carottes" --last >/dev/null; sleep 2
  $UI tap "Terminer ma sélection" >/dev/null; sleep 5
  expect "M0b. hors connexion : « Envoi en attente » affiché" $UI wait "Envoi en attente" 20
  ADIL=$(sql "SELECT id FROM profiles WHERE login='adil'")
  sql "UPDATE lists SET status='archived', closed_by='$ADIL', closed_at=now() WHERE id='$ACTIVE'" >/dev/null
  docker start sc-recette-app >/dev/null; server_wait
  expect "M1. liste terminée entre-temps : la demande part puis est refusée proprement" $UI gone "Envoi en attente" 90
  expect "M2. serveur : rien n'a été ajouté à la liste archivée" test "$(sql "SELECT count(*) FROM list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id='$ACTIVE' AND p.name='Carottes'")" = 0
  tapt "Choisir"
  expect "M3. « Reprendre » proposé pour les articles gardés" $UI wait "Reprendre" 30
  shot cible-reprendre
  $UI tap "Reprendre" >/dev/null; sleep 2
  expect "M4. article repris dans la sélection" $UI wait "Terminer ma sélection (1)" 10
  $UI tap "Terminer ma sélection" >/dev/null; sleep 6
  NEW=$(sql "SELECT l.id FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active'")
  expect "M5. serveur : une nouvelle liste en cours contient Carottes" test "$(sql "SELECT count(*) FROM list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id='${NEW:-00000000-0000-0000-0000-000000000000}' AND p.name='Carottes'")" = 1
fi

if want K9; then
  echo "═══ Cas K9 : réinitialisation de la famille (aperçu seulement, jamais confirmée) ═══" | tee -a "$OUT/resultats.txt"
  fresh_list >/dev/null
  first_login adil 482913
  $UI wait "Ma liste" 25 >/dev/null
  tapt "Réglages"; $UI tap "Réinitialiser la famille" --scroll >/dev/null; sleep 3
  expect "K9a. aperçu des données effacées" $UI wait "Seront effacés" 15
  expect "K9b. champs mot de passe et code famille" $UI wait "Votre code d'accès" 10
  expect "K9c. bouton de réinitialisation présent" $UI wait "Réinitialiser définitivement" 10
  shot cible-reinitialiser
  adb shell input keyevent KEYCODE_BACK; sleep 1
  expect "K9d. rien n'a été effacé" test "$(sql "SELECT count(*) FROM profiles p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY'")" -ge 3
fi

if want R; then
  echo "═══ Cas R : notification d'une demande d'un autre profil ═══" | tee -a "$OUT/resultats.txt"
  fresh_list >/dev/null
  first_login adil 482913
  $UI wait "Ma liste" 25 >/dev/null
  tapt "Réglages"; tapt "Notifications"
  $UI tap "Nouvelles demandes" >/dev/null
  expect "R0. notifications activées" $UI wait "Notifications activées" 10
  launch; $UI wait "Ma liste" 25 >/dev/null; sleep 8
  adb shell input keyevent KEYCODE_HOME; sleep 8
  login_api marie 573918
  api GET /api/catalog >/dev/null; PID=$(jq -r '[.categories[].products[] | select(.name=="Lait")][0].id' /tmp/api.out)
  api POST /api/lists/active/ops -d "{\"ops\":[{\"opId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"type\":\"add\",\"productId\":\"$PID\",\"quantity\":1}]}" >/dev/null
  adb logcat -c; adb shell am start -n "$PKG/.MainActivity" --ez poll true >/dev/null 2>&1; sleep 10
  adb logcat -d | grep -E "CoursesNotif|CoursesData" | tee -a "$OUT/resultats.txt"
  adb shell dumpsys notification --noredact | grep -E "pkg=$PKG|Nouvelle demande" | head -5 | tee -a "$OUT/resultats.txt"
  expect "R1. notification « Nouvelle demande » affichée" bash -c "adb shell dumpsys notification --noredact | grep -q 'Nouvelle demande'"
fi

echo "ECHECS=$FAILS" | tee -a "$OUT/resultats.txt"
adb logcat -d -b crash > "$OUT/logcat-crash.txt" 2>&1 || true
echo "CRASH_APPLICATION=$(grep -c app.smartcourse "$OUT/logcat-crash.txt")" | tee -a "$OUT/resultats.txt"
grep -A1 -E "^FAIL" "$OUT/resultats.txt" | cut -c1-400 || true
[ "$FAILS" = 0 ]
