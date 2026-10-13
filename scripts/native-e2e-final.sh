#!/usr/bin/env bash
# Version FINALE (app.smartcourse.courses.natif) sur émulateur, de bout en bout.
# Serveur : serveur de recette LOCAL et jetable, au code identique au serveur permanent déployé (aucune donnée réelle touchée).
# L'APK testé ne diffère de l'APK livré que par l'adresse du serveur fixée à la compilation et par sa signature.
# Usage : native-e2e-final.sh APK CODE_FAMILLE SORTIE
set -uo pipefail
# Fonctions et installation communes (reprises du parcours lots 3-6), avec l'identifiant de la version finale.
source <(sed -n '/^PKG=/,/^adb shell pm grant/p' "$(dirname "$0")/native-e2e-lot3.sh" | sed 's/^PKG=.*/PKG=app.smartcourse.courses.natif/')

# L'activité garde son espace de noms (app.smartcourse.courses.nativeproto) ; seul l'identifiant d'application change.
ACT="$PKG/app.smartcourse.courses.nativeproto.MainActivity"
launch() { adb shell am force-stop $PKG; adb shell am start -W -n "$ACT" >/dev/null 2>&1; sleep 3; }
nodemo() { # aucun bandeau ni fonction de démonstration / technique visible
  ! $UI has "RECETTE" && ! $UI has "PROTOTYPE" && ! $UI has "Écrans de démo" && ! $UI has "simulée" && ! $UI has "Serveur :" && ! $UI has "10.0.2.2"
}
st() { sql "SELECT string_agg(i.quantity||' '||i.unit||' '||i.status, ',') FROM list_items i JOIN products p ON p.id=i.product_id JOIN lists l ON l.id=i.list_id JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active' AND p.name='$1' AND i.status<>'removed'"; }

echo "═══ F. Version finale : identifiant, nom, serveur fixe ═══" | tee -a "$OUT/resultats.txt"
expect "F0. identifiant app.smartcourse.courses.natif installé" bash -c "adb shell pm list packages | grep -qx 'package:app.smartcourse.courses.natif'"
expect "F0b. nom affiché « Mes Courses »" bash -c "\"\$ANDROID_HOME/build-tools/35.0.0/aapt2\" dump badging '$APK' | grep -q \"application-label:'Mes Courses'\""
# Aucune ancienne session : départ propre de la base de recette
login_api adil 482913
api GET /api/lists/active >/dev/null; LID=$(jq -r '.list.id // empty' /tmp/api.out)
[ -n "$LID" ] && api POST "/api/lists/$LID/close" -d '{}' >/dev/null
launch
expect "F1. écran de connexion direct (aucune saisie de serveur)" $UI wait "Bienvenue" 25
expect "F1b. aucun bandeau ni fonction de démonstration" nodemo
expect "F1c. aucun lien « Serveur … Modifier »" $UI gone "Modifier" 2
shot final-01-connexion
# Les paramètres de recette (écrans simulés) sont ignorés par la version finale
adb shell am force-stop $PKG; adb shell am start -W -n "$ACT" --es screen v02 --ez hub true >/dev/null 2>&1; sleep 4
expect "F1d. accès de recette désactivés (écran simulé refusé)" $UI wait "Bienvenue" 15
expect "F1e. pas d'écrans de démonstration" $UI gone "Écrans de démonstration" 2

echo "═══ G. Administrateur : connexion, sélection, achat, historique ═══" | tee -a "$OUT/resultats.txt"
signin "$FAMILY" adil 482913
expect "G1. administrateur connecté" $UI wait "Ma liste" 25
expect "G1b. aucun bandeau" nodemo
expect "G1c. Compte dans l'en-tête" $UI has "Compte"
expect "G1d. aucune liste : « Créer une liste »" $UI wait "Créer une liste" 15
shot final-02-aucune-liste
tapt "Créer une liste"
expect "G2. sélection (recherche pour l'administrateur)" $UI wait "Rechercher un produit" 15
fill "Rechercher un produit" "Tomates"; hide_kb
$UI tap "Tomates" --last >/dev/null; sleep 2
$UI tap "Terminer ma sélection" >/dev/null; sleep 5
expect "G3. liste créée avec Tomates" $UI wait "Acheté : Tomates" 20
expect "G3b. serveur : Tomates à acheter ($(st Tomates))" test "$(st Tomates)" = "1.000 kg to_buy"
shot final-03-liste
$UI tap "Acheté : Tomates" >/dev/null; sleep 4
expect "G4. achat enregistré par le serveur ($(st Tomates))" test "$(st Tomates)" = "1.000 kg purchased"
expect "G4b. article dans « Déjà achetés »" $UI wait "Déjà achetés" 10
shot final-04-achat
ACTIVE=$(sql "SELECT l.id FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active'")
tapt "Terminer les courses"; $UI tap "Terminer" --last >/dev/null; sleep 5
expect "G5. liste archivée par le serveur" test "$(sql "SELECT status FROM lists WHERE id='$ACTIVE'")" = archived
expect "G5b. historique affiché" $UI wait "1 article acheté" 15
shot final-05-historique
tapt "Réglages"
adb shell input swipe 540 1700 540 600 300; sleep 1
expect "G6. Réglages : « Se déconnecter » visible" $UI wait "Se déconnecter" 8
expect "G6b. aucune fonction technique dans Réglages" nodemo
shot final-06-reglages
tapt "Compte"
expect "G7. Compte : profil réel, sans serveur ni démonstration" bash -c "$UI wait 'Administrateur' 8 && ! $UI has 'Écrans de démo' && ! $UI has 'Serveur :'"
shot final-07-compte
adb shell input keyevent KEYCODE_BACK; sleep 1
logout
expect "G8. déconnecté : retour à la connexion" $UI wait "Bienvenue" 15

echo "═══ H. Parent : rôle ═══" | tee -a "$OUT/resultats.txt"
signin "$FAMILY" lamiaa 573918
expect "H1. parent connecté" $UI wait "Ma liste" 25
expect "H2. parent : pas d'onglet Réglages" $UI gone "Réglages" 3
expect "H3. parent : Historique accessible" $UI has "Historique"
shot final-08-parent
logout

echo "═══ P. Personnel : Choisir mes articles, enregistrement, hors connexion ═══" | tee -a "$OUT/resultats.txt"
signin "$FAMILY" marie 573918
expect "P1. personnel : « Choisir mes articles » directement" $UI wait "Choisir mes articles" 25
expect "P1b. aucun onglet en bas" $UI gone "Liste du jour" 3
expect "P1c. aucune recherche" $UI gone "Rechercher un produit" 2
expect "P1d. aucun bandeau" nodemo
expect "P1e. Compte dans l'en-tête" $UI has "Compte"
shot final-09-personnel
show "Tomates"; $UI tap "Tomates" >/dev/null; sleep 2
$UI tap "Terminer ma sélection" >/dev/null
expect "P2. « Sélection enregistrée »" $UI wait "Sélection enregistrée" 10
expect "P2b. reste sur Choisir" $UI has "Choisir mes articles"
expect "P2c. serveur : liste du jour créée par la demande ($(st Tomates))" test "$(st Tomates)" = "1.000 kg to_buy"
expect "P2d. quantité enregistrée affichée" $UI wait "Enregistré · 1 kg" 10
shot final-10-personnel-enregistre
docker stop sc-recette-app >/dev/null
$UI tap "Modifier la quantité : Tomates" >/dev/null; sleep 2; $UI tap "Augmenter" >/dev/null; sleep 1; $UI tap "Mettre à jour" >/dev/null; sleep 2
$UI tap "Terminer ma sélection" >/dev/null; sleep 4
expect "P3. hors connexion : « Envoi en attente »" $UI wait "Envoi en attente" 15
shot final-11-hors-connexion
launch
expect "P3b. la demande survit à la fermeture de l'application" $UI wait "Envoi en attente" 25
docker start sc-recette-app >/dev/null; server_wait
expect "P4. reprise : envoi au retour du réseau" $UI gone "Envoi en attente" 90
expect "P4b. serveur : une seule ligne, quantité remplacée ($(st Tomates))" test "$(st Tomates)" = "1.500 kg to_buy"
tapt "Compte"
expect "P5. personnel : « Se déconnecter » dans Compte" $UI wait "Se déconnecter" 8
adb shell input keyevent KEYCODE_BACK; sleep 1
logout
expect "P5b. déconnecté" $UI wait "Bienvenue" 15

echo "═══ J. Personnel : minuit, liste ouverte plusieurs jours, clôture par un parent (en ligne et hors connexion) ═══" | tee -a "$OUT/resultats.txt"
# Horloge du téléphone pilotée (émulateur, accès root) ; la liste est identifiée par son identifiant et son statut, jamais par sa date.
adb root >/dev/null 2>&1; sleep 3; adb wait-for-device; adb shell settings put global auto_time 0 >/dev/null 2>&1
setclock() { adb shell date "$(date -u -d "@$1" +%m%d%H%M%Y.%S)" >/dev/null; }
devnow() { adb shell date +%s | tr -d '\r'; }
items_of() { sql "SELECT coalesce(string_agg(p.name||' '||i.quantity||' '||i.status, ',' ORDER BY p.name), '') FROM list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id='$1'"; }
login_api adil 482913
api GET /api/lists/active >/dev/null; LID=$(jq -r '.list.id // empty' /tmp/api.out); [ -n "$LID" ] && api POST "/api/lists/$LID/close" -d '{}' >/dev/null
api POST /api/lists -d '{}' >/dev/null; LJ=$(jq -r .list.id /tmp/api.out)
signin "$FAMILY" marie 573918
$UI wait "Choisir mes articles" 25 >/dev/null
show "Tomates"; $UI tap "Tomates" >/dev/null; sleep 2
$UI tap "Terminer ma sélection" >/dev/null; sleep 4
expect "J1. sélection enregistrée sur la liste ouverte ($(items_of $LJ))" test "$(items_of $LJ)" = "Tomates 1.000 to_buy"
# Minuit : 23:59:20 du jour courant du téléphone, puis passage au lendemain, application ouverte
D0=$(adb shell date +%Y-%m-%d | tr -d '\r'); setclock "$(date -u -d "$D0 23:59:20" +%s)"; sleep 75
D1=$(adb shell date +%Y-%m-%d | tr -d '\r')
expect "J2. l'horloge du téléphone est passée minuit ($D0 → $D1)" test "$D1" != "$D0"
expect "J2b. après minuit, application ouverte : sélection toujours affichée (Enregistré · 1 kg)" $UI wait "Enregistré · 1 kg" 15
launch
expect "J2c. après minuit, application relancée : toujours sur Choisir, sélection conservée" bash -c "$UI wait 'Choisir mes articles' 20 && $UI wait 'Enregistré · 1 kg' 15"
expect "J2d. serveur : même liste, toujours ouverte" test "$(sql "SELECT status FROM lists WHERE id='$LJ'")" = active
shot final-12-apres-minuit
# Liste ouverte plusieurs jours : créée il y a 3 jours côté serveur, téléphone 3 jours plus tard
sql "UPDATE lists SET created_at = now() - interval '3 days' WHERE id='$LJ'" >/dev/null
setclock $(( $(devnow) + 3*86400 )); sleep 3
launch
expect "J3. trois jours plus tard : sélection et quantité conservées" bash -c "$UI wait 'Choisir mes articles' 20 && $UI wait 'Enregistré · 1 kg' 15"
$UI tap "Modifier la quantité : Tomates" >/dev/null; sleep 2; $UI tap "Augmenter" >/dev/null; sleep 1; $UI tap "Mettre à jour" >/dev/null; sleep 2
$UI tap "Terminer ma sélection" >/dev/null; sleep 4
expect "J3b. modification enregistrée sur la MÊME liste ($(items_of $LJ))" test "$(items_of $LJ)" = "Tomates 1.500 to_buy"
expect "J3c. serveur : toujours une seule liste ouverte" test "$(sql "SELECT count(*) FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active'")" = 1
# Clôture EN LIGNE par un parent
login_api lamiaa 573918; api POST "/api/lists/$LJ/close" -d '{}' >/dev/null
expect "J4. clôture par le parent apprise : sélections de cette liste réinitialisées" $UI gone "Enregistré ·" 30
expect "J4b. reste sur Choisir, articles et photos toujours affichés" bash -c "$UI has 'Choisir mes articles' && $UI has 'Tomates' && $UI has 'Légumes et herbes'"
ARCH=$(items_of $LJ)
expect "J4c. historique : liste archivée avec son contenu ($ARCH)" test "$(sql "SELECT status FROM lists WHERE id='$LJ'")" = archived -a "$ARCH" = "Tomates 1.500 to_buy"
shot final-13-apres-cloture
# Clôture HORS CONNEXION : demande non envoyée + brouillon non validé pendant que le parent clôture
login_api adil 482913; api POST /api/lists -d '{}' >/dev/null; LK=$(jq -r .list.id /tmp/api.out)
sleep 5; show "Tomates"; $UI tap "Tomates" >/dev/null; sleep 2; $UI tap "Terminer ma sélection" >/dev/null; sleep 4
expect "J5. nouvelle liste : sélection enregistrée ($(items_of $LK))" test "$(items_of $LK)" = "Tomates 1.000 to_buy"
adb shell cmd connectivity airplane-mode enable >/dev/null 2>&1; adb shell svc wifi disable >/dev/null 2>&1; adb shell svc data disable >/dev/null 2>&1; sleep 4
$UI tap "Modifier la quantité : Tomates" >/dev/null; sleep 2; $UI tap "Augmenter" >/dev/null; sleep 1; $UI tap "Mettre à jour" >/dev/null; sleep 2
$UI tap "Terminer ma sélection" >/dev/null; sleep 4
expect "J5b. hors connexion : demande non envoyée (« Envoi en attente »)" $UI wait "Envoi en attente" 20
show "Carottes"; $UI tap "Carottes" >/dev/null; sleep 2
expect "J5c. brouillon non validé (Carottes)" $UI wait "Terminer ma sélection (1)" 8
login_api lamiaa 573918; api POST "/api/lists/$LK/close" -d '{}' >/dev/null
SNAP=$(items_of $LK)
adb shell cmd connectivity airplane-mode disable >/dev/null 2>&1; adb shell svc wifi enable >/dev/null 2>&1; adb shell svc data enable >/dev/null 2>&1
expect "J6. retour du réseau : la clôture est appliquée (sélection enregistrée réinitialisée)" $UI gone "Enregistré ·" 90
expect "J6b. la demande non envoyée et le brouillon sont gardés : « Reprendre »" $UI wait "Reprendre" 30
expect "J6c. historique non modifié par les demandes tardives ($(items_of $LK))" test "$(items_of $LK)" = "$SNAP" -a "$SNAP" = "Tomates 1.000 to_buy"
expect "J6d. reste sur Choisir" $UI has "Choisir mes articles"
shot final-14-reprendre-apres-cloture-hors-connexion
$UI tap "Reprendre" >/dev/null; sleep 2
expect "J7. reprise : demande (Tomates 1,5 kg) et brouillon (Carottes) repris dans la sélection" bash -c "$UI wait 'Terminer ma sélection (2)' 10 && $UI has '1,5 kg'"
$UI tap "Terminer ma sélection" >/dev/null; sleep 6
NEWL=$(sql "SELECT l.id FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active'")
expect "J7b. serveur : nouvelle liste du jour avec les articles repris ($(items_of ${NEWL:-00000000-0000-0000-0000-000000000000}))" test "$(items_of ${NEWL:-00000000-0000-0000-0000-000000000000})" = "Carottes 1.000 to_buy,Tomates 1.500 to_buy"
expect "J7c. les listes archivées restent intactes" test "$(items_of $LJ)" = "Tomates 1.500 to_buy" -a "$(items_of $LK)" = "Tomates 1.000 to_buy"
adb shell settings put global auto_time 1 >/dev/null 2>&1; setclock "$(date -u +%s)"

echo "ECHECS=$FAILS" | tee -a "$OUT/resultats.txt"
adb logcat -d -b crash > "$OUT/logcat-crash.txt" 2>&1 || true
echo "CRASH_APPLICATION=$(grep -c app.smartcourse "$OUT/logcat-crash.txt")" | tee -a "$OUT/resultats.txt"
grep -A1 -E "^FAIL" "$OUT/resultats.txt" | cut -c1-400 || true
[ "$FAILS" = 0 ]
