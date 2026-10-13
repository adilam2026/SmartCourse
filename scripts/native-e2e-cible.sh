#!/usr/bin/env bash
# Tests CIBLÉS : reproduisent un par un les échecs du parcours des lots 3 à 6, sans rejouer toute la suite.
# Chaque cas part d'un état propre. Usage : native-e2e-cible.sh APK CODE_FAMILLE SORTIE [cas…]  (cas : M | M2 | K9 | R | RW | I ; tous par défaut)
set -uo pipefail
CASES=("${@:4}"); [ ${#CASES[@]} -eq 0 ] && CASES=(M M2 K9 R RW I)
# Fonctions et installation communes, reprises telles quelles du parcours complet (lignes 4 à l'installation de l'APK).
source <(sed -n '/^PKG=/,/^adb shell pm grant/p' "$(dirname "$0")/native-e2e-lot3.sh")
want() { for c in "${CASES[@]}"; do [ "$c" = "$1" ] && return 0; done; return 1; }
fresh_list() { login_api adil 482913; api GET /api/lists/active >/dev/null; local l; l=$(jq -r '.list.id // empty' /tmp/api.out); [ -n "$l" ] && api POST "/api/lists/$l/close" -d '{}' >/dev/null; api POST /api/lists -d '{}' >/dev/null; jq -r .list.id /tmp/api.out; }
first_login() { unset PREV_FAMILY PREV_LOGIN; adb shell pm clear $PKG >/dev/null; adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS >/dev/null 2>&1; launch; $UI wait "Bienvenue" 25 >/dev/null; $UI tap "Se connecter" --last >/dev/null; sleep 2; fill "https://…" "$SERVER" --last; hide_kb; $UI tap "Tester et enregistrer" >/dev/null; $UI wait "10.0.2.2:3000" 20 >/dev/null; signin "$FAMILY" "$1" "$2"; }

select_qty() { # produit, nombre d'appuis sur « Augmenter » : sélectionne l'article et règle sa quantité par le panneau natif
  fill "Rechercher un produit" "$1"; hide_kb
  $UI tap "$1" --last >/dev/null; sleep 2
  $UI tap "Modifier la quantité" >/dev/null; sleep 2
  for _ in $(seq 1 "$2"); do $UI tap "Augmenter" >/dev/null; sleep 1; done
  $UI tap "Mettre à jour" >/dev/null; sleep 2
}

if want M; then
  echo "═══ Cas M : liste terminée pendant l'attente → articles ET quantités conservés, « Reprendre » ═══" | tee -a "$OUT/resultats.txt"
  ACTIVE=$(fresh_list)
  first_login marie 573918
  expect "M0. personnel connecté" $UI wait "Liste du jour" 25
  tapt "Choisir"
  select_qty Carottes 1                                  # 1 kg → 1,5 kg
  expect "M0a. quantité choisie : Carottes 1,5 kg" $UI wait "1,5 kg" 8
  select_qty Tomates 2                                   # 1 kg → 2 kg
  expect "M0b. quantité choisie : Tomates 2 kg" $UI wait "2 kg" 8
  expect "M0c. deux articles dans la sélection" $UI wait "Terminer ma sélection (2)" 8
  docker stop sc-recette-app >/dev/null
  $UI tap "Terminer ma sélection" >/dev/null; sleep 5
  expect "M0d. hors connexion : « Envoi en attente » affiché" $UI wait "Envoi en attente" 20
  ADIL=$(sql "SELECT id FROM profiles WHERE login='adil'")
  sql "UPDATE lists SET status='archived', closed_by='$ADIL', closed_at=now() WHERE id='$ACTIVE'" >/dev/null
  docker start sc-recette-app >/dev/null; server_wait
  expect "M1. la demande part au retour du réseau puis est refusée proprement" $UI gone "Envoi en attente" 90
  expect "M2. serveur : rien n'a été ajouté à la liste archivée" test "$(sql "SELECT count(*) FROM list_items WHERE list_id='$ACTIVE' AND status IN ('to_buy','purchased')")" = 0
  tapt "Choisir"
  expect "M3. « Reprendre » proposé pour les articles gardés" $UI wait "Reprendre" 30
  expect "M3b. le nombre d'articles gardés est annoncé (2)" $UI has "2 articles"
  shot cible-reprendre
  $UI tap "Reprendre" >/dev/null; sleep 2
  expect "M4. les deux articles sont repris dans la sélection" $UI wait "Terminer ma sélection (2)" 10
  fill "Rechercher un produit" "Carottes"; hide_kb
  expect "M4a. quantité conservée : Carottes 1,5 kg" $UI wait "1,5 kg" 8
  fill "Rechercher un produit" "Tomates"; hide_kb
  expect "M4b. quantité conservée : Tomates 2 kg" $UI wait "2 kg" 8
  $UI tap "Terminer ma sélection" >/dev/null; sleep 6
  NEW=$(sql "SELECT l.id FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active'")
  Q() { sql "SELECT i.quantity||' '||i.unit FROM list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id='${NEW:-00000000-0000-0000-0000-000000000000}' AND p.name='$1' AND i.status='to_buy'"; }
  expect "M5. serveur : nouvelle liste, Carottes 1.500 kg ($(Q Carottes))" test "$(Q Carottes)" = "1.500 kg"
  expect "M5b. serveur : Tomates 2.000 kg ($(Q Tomates))" test "$(Q Tomates)" = "2.000 kg"
fi

if want M2; then
  echo "═══ Cas M2 : brouillon NON validé quand la liste est terminée par quelqu'un d'autre ═══" | tee -a "$OUT/resultats.txt"
  ACTIVE=$(fresh_list)
  first_login marie 573918
  $UI wait "Liste du jour" 25 >/dev/null
  tapt "Choisir"
  select_qty Oignons 1
  expect "M2a. brouillon : Oignons 1,5 kg, sans validation" $UI wait "Terminer ma sélection (1)" 8
  login_api adil 482913; api POST "/api/lists/$ACTIVE/close" -d '{}' >/dev/null
  expect "M2b. la clôture par un parent est apprise en direct : brouillon gardé, « Reprendre » proposé" $UI wait "Reprendre" 40
  expect "M2c. serveur : rien n'a été écrit pour le brouillon" test "$(sql "SELECT count(*) FROM list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id='$ACTIVE' AND p.name='Oignons'")" = 0
  $UI tap "Reprendre" >/dev/null; sleep 2
  expect "M2d. brouillon repris" $UI wait "Terminer ma sélection (1)" 10
  fill "Rechercher un produit" "Oignons"; hide_kb
  expect "M2e. quantité conservée : 1,5 kg" $UI wait "1,5 kg" 8
fi

if want K9; then
  echo "═══ Cas K9 : réinitialisation de la famille (jamais confirmée) — clavier ouvert, défilement, accès à tout ═══" | tee -a "$OUT/resultats.txt"
  fresh_list >/dev/null
  first_login adil 482913
  $UI wait "Ma liste" 25 >/dev/null
  tapt "Réglages"; $UI tap "Réinitialiser la famille" --scroll >/dev/null; sleep 3
  expect "K9a. aperçu des données effacées" $UI wait "Seront effacés" 15
  expect "K9b. champ mot de passe" $UI wait "Votre code d'accès" 10
  expect "K9c. champ code famille" $UI has "Tapez le code famille"
  shot cible-reinitialiser
  $UI tap "Votre code d'accès" >/dev/null; sleep 2; adb shell input text "482913"; sleep 1
  KB=$(adb shell dumpsys input_method | grep -c "mInputShown=true")
  expect "K9d. clavier ouvert" test "$KB" -ge 1
  shot cible-reinitialiser-clavier
  $UI tap "Tapez le code famille" --scroll >/dev/null; sleep 1; adb shell input text "$FAMILY"; sleep 1
  expect "K9e. le bouton reste atteignable clavier ouvert (défilement)" $UI tap "Réinitialiser définitivement" --scroll
  sleep 2
  expect "K9f. confirmation finale demandée avant tout effacement" $UI wait "Effacer toute la famille" 10
  shot cible-reinitialiser-confirmation
  $UI tap "Annuler" >/dev/null; sleep 1
  expect "K9g. rien n'a été effacé (profils conservés)" test "$(sql "SELECT count(*) FROM profiles p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY'")" -ge 3
  expect "K9h. aucun effacement côté serveur (audit)" test "$(sql "SELECT count(*) FROM families WHERE code='$FAMILY'")" = 1
fi

r_prepare() { # adil connecté, notifications activées, application au premier plan puis en arrière-plan ; demande ajoutée ensuite par Marie
  fresh_list >/dev/null
  first_login adil 482913
  $UI wait "Ma liste" 25 >/dev/null
  tapt "Réglages"; tapt "Notifications"
  $UI tap "Nouvelles demandes" >/dev/null
  expect "$1-0. interrupteur activé dans l'application" $UI wait "Notifications activées" 10
  expect "$1-1a. PERMISSION accordée par Android" bash -c "adb shell dumpsys package $PKG | grep POST_NOTIFICATIONS | grep -q 'granted=true'"
  expect "$1-1b. TÂCHE programmée par Android" bash -c "adb shell dumpsys jobscheduler | grep -q '$PKG'"
  adb logcat -c
  launch; $UI wait "Ma liste" 25 >/dev/null; sleep 8
  adb shell input keyevent KEYCODE_HOME; sleep 8
  expect "$1-2. repère initialisé AVANT la nouvelle demande (au premier plan)" bash -c "adb logcat -d | grep -q 'repère mis à jour au premier plan'"
  expect "$1-2b. flux en direct fermé en arrière-plan" bash -c "adb logcat -d | grep -q 'flux en direct fermé'"
  adb logcat -c
  login_api marie 573918
  api GET /api/catalog >/dev/null; PID=$(jq -r '[.categories[].products[] | select(.name=="Lait")][0].id' /tmp/api.out)
  api POST /api/lists/active/ops -d "{\"ops\":[{\"opId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"type\":\"add\",\"productId\":\"$PID\",\"quantity\":1}]}" >/dev/null
  login_api adil 482913; api GET /api/lists/active >/dev/null
  expect "$1-3. API : la nouvelle validation (Marie) est bien renvoyée ($(jq -r '[.list.validations[]?.by.displayName]|join(",")' /tmp/api.out))" bash -c "jq -e '[.list.validations[]?.by.displayName] | index(\"Marie\")' /tmp/api.out >/dev/null"
  sleep 3
  expect "$1-3b. aucune mise à jour du repère en arrière-plan" bash -c "! adb logcat -d | grep -q 'repère mis à jour au premier plan'"
}
r_check() { # préfixe : journal détaillé, calcul de « fresh », appel à NotificationManager, notification réellement présente
  echo "--- journal de la vérification ($1) ---" | tee -a "$OUT/resultats.txt"
  adb logcat -d | grep -E "CoursesNotif|WM-WorkerWrapper" | tee -a "$OUT/resultats.txt"
  expect "$1-4a. la vérification a réellement été exécutée" bash -c "adb logcat -d | grep -q 'vérification : réponse du serveur'"
  expect "$1-4b. calcul : 1 nouvelle demande d'un autre profil" bash -c "adb logcat -d | grep -q \"nouvelles d'autres profils = 1\""
  expect "$1-5. appel à NotificationManager" bash -c "adb logcat -d | grep -q 'notification transmise à Android'"
  expect "$1-6. NOTIFICATION réellement présente (« Nouvelle demande »)" bash -c "adb shell dumpsys notification --noredact | grep -q 'Nouvelle demande'"
}

if want R; then
  echo "═══ Cas R : notification — vérification déclenchée directement (recette) ═══" | tee -a "$OUT/resultats.txt"
  r_prepare R
  adb shell am start -S -n "$PKG/.MainActivity" --ez poll true >/dev/null 2>&1; sleep 12
  r_check R
fi

if want RW; then
  echo "═══ Cas RW : notification — tâche WorkManager réellement exécutée en arrière-plan ═══" | tee -a "$OUT/resultats.txt"
  r_prepare RW
  # La tâche périodique elle-même est programmée (RW-1b) mais Android ne permet pas de l'avancer : la même classe PollWorker
  # est confiée à WorkManager en tâche unique, application fermée, puis exécutée par Android en arrière-plan.
  adb shell am start -S -n "$PKG/.MainActivity" --ez pollwork true >/dev/null 2>&1; sleep 3
  adb shell input keyevent KEYCODE_HOME; sleep 25
  expect "RW-4w. tâche WorkManager exécutée (et non le déclenchement de recette)" bash -c "adb logcat -d | grep -q \"tâche d'arrière-plan (WorkManager) exécutée\""
  r_check RW
fi

if want I; then
  echo "═══ Cas I : lien d'installation — aucun jeton à saisir, protection du serveur conservée ═══" | tee -a "$OUT/resultats.txt"
  adb shell pm clear $PKG >/dev/null; launch; $UI wait "Bienvenue" 25 >/dev/null
  $UI tap "Se connecter" --last >/dev/null; sleep 2; fill "https://…" "$SERVER" --last; hide_kb; $UI tap "Tester et enregistrer" >/dev/null; $UI wait "10.0.2.2:3000" 20 >/dev/null
  $UI tap "Première connexion" >/dev/null; sleep 1; $UI tap "Créer ma famille" >/dev/null; sleep 2
  expect "I1. sans lien d'installation : explication, aucun champ technique" $UI wait "ouvrez le lien d'installation" 10
  expect "I1b. aucun champ « jeton »" $UI gone "Jeton" 3
  adb shell am start -a android.intent.action.VIEW -d "coursesnatif://installer?serveur=$SERVER\&jeton=aaaaaaaaaaaaaaaaaaaaaaaa" $PKG >/dev/null 2>&1; sleep 4
  expect "I2. avec le lien : formulaire de création, serveur déjà réglé" $UI wait "Nom de la famille" 15
  expect "I2b. toujours aucun champ « jeton » à saisir" $UI gone "Jeton" 3
  shot cible-creer-famille
  fill "Nom de la famille" "Famille_Test" --scroll; hide_kb; fill "Votre prénom" "Test" --scroll; hide_kb; fill "Votre identifiant" "test" --scroll; hide_kb
  fill "E-mail de récupération" "test@example.org" --scroll; hide_kb; fill "Code d'accès (6" 135792 --scroll; hide_kb; fill "Répétez le code" 135792 --scroll; hide_kb
  $UI tap "Ville : " --scroll >/dev/null; sleep 2; fill "Rechercher une ville" "casablanca"; hide_kb; $UI tap "Casablanca" --last >/dev/null; sleep 2
  adb shell input swipe 540 1800 540 600 300; sleep 1; adb shell input swipe 540 1800 540 600 300; sleep 1
  for v in "Test" "test@example.org" "Ville : Casablanca"; do expect "I3a. formulaire complet : « $v » saisi" $UI has "$v"; done
  adb shell input swipe 540 600 540 1800 300; sleep 1
  expect "I3a. formulaire complet : nom de famille saisi" $UI has "Famille_Test"
  adb shell input swipe 540 1800 540 600 300; sleep 1; adb shell input swipe 540 1800 540 600 300; sleep 1
  expect "I3b. bouton final ACTIVÉ" $UI enabled "Créer ma famille"
  BEFORE=$(docker logs sc-recette-app 2>&1 | grep -c '/api/setup/family')
  expect "I3c. bouton final TOUCHÉ" $UI tap "Créer ma famille" --last
  sleep 5
  AFTER=$(docker logs sc-recette-app 2>&1 | grep -c '/api/setup/family')
  docker logs sc-recette-app 2>&1 | grep '/api/setup/family' | tail -2 | cut -c1-300 | tee -a "$OUT/resultats.txt"
  expect "I3d. une requête a atteint le serveur ($BEFORE → $AFTER lignes de journal)" test "$AFTER" -gt "$BEFORE"
  REQ=$(docker logs sc-recette-app 2>&1 | grep '/api/setup/family' | tail -1 | grep -oE '"reqId":"?[^",]+"?' | head -1)
  docker logs sc-recette-app 2>&1 | grep -F "$REQ" | grep -oE '"statusCode":[0-9]+' | tail -1 | tee -a "$OUT/resultats.txt"
  expect "I3e. le serveur a répondu 403 à CETTE requête (jeton refusé)" bash -c "docker logs sc-recette-app 2>&1 | grep -F '$REQ' | grep -q '\"statusCode\":403'"
  expect "I3f. message clair à l'écran" $UI wait "n'est plus valable" 15
  expect "I3g. aucune famille créée" test "$(sql "SELECT count(*) FROM families WHERE name='Famille_Test'")" = 0
fi

echo "ECHECS=$FAILS" | tee -a "$OUT/resultats.txt"
adb logcat -d -b crash > "$OUT/logcat-crash.txt" 2>&1 || true
echo "CRASH_APPLICATION=$(grep -c app.smartcourse "$OUT/logcat-crash.txt")" | tee -a "$OUT/resultats.txt"
grep -A1 -E "^FAIL" "$OUT/resultats.txt" | cut -c1-400 || true
[ "$FAILS" = 0 ]
