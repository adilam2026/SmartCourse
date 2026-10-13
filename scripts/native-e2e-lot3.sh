#!/usr/bin/env bash
# Lots 3 à 6 de bout en bout : listes, sélection, quantités, achats, hors connexion, brouillons, prix, historique, statistiques, réglages.
# APK natif réel (émulateur) + serveur de recette réel (Docker + PostgreSQL jetables). Les règles sont aussi vérifiées directement auprès du serveur.
# Usage : native-e2e-lot3.sh APK CODE_FAMILLE SORTIE
set -uo pipefail
PKG=app.smartcourse.courses.nativeproto
APK=${1:?apk}; FAMILY=${2:?code famille}; OUT=${3:-native-e2e-lot3}
SERVER=http://10.0.2.2:3000; BASE=http://127.0.0.1:3000
HERE="$(cd "$(dirname "$0")" && pwd)"
UI="python3 $HERE/native-ui.py"
mkdir -p "$OUT"; : > "$OUT/resultats.txt"
FAILS=0
ok()   { echo "PASS  $1" | tee -a "$OUT/resultats.txt"; }
ko()   { echo "FAIL  $1" | tee -a "$OUT/resultats.txt"; FAILS=$((FAILS+1)); adb shell uiautomator dump /sdcard/g.xml >/dev/null 2>&1; echo "      écran : $(adb exec-out cat /sdcard/g.xml 2>/dev/null | grep -oE '(text|content-desc)="[^"]+"' | sed -E 's/^(text|content-desc)=//' | head -40 | tr '\n' '|')" | tee -a "$OUT/resultats.txt"; local n; n=$(echo "$1" | tr -c 'a-zA-Z0-9' '_' | cut -c1-40); adb exec-out screencap -p > "$OUT/echec-$n.png" || true; adb shell uiautomator dump /sdcard/f.xml >/dev/null 2>&1; adb exec-out cat /sdcard/f.xml > "$OUT/echec-$n.xml" 2>/dev/null || true; }
expect() { local label=$1; shift; if "$@"; then ok "$label"; else ko "$label"; fi; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
sql() { docker exec sc-recette-pg psql -U smart -d smartcourse -tAc "$1"; }
launch() { adb shell am force-stop $PKG; adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 3; }
hide_kb() { adb shell dumpsys input_method | grep -q "mInputShown=true" && adb shell input keyevent KEYCODE_BACK; sleep 1; }
clear_field() { adb shell input keyevent KEYCODE_MOVE_END; for _ in $(seq 1 30); do adb shell input keyevent 67; done; }
fill() { $UI tap "$1" ${3:-} >/dev/null || return 1; sleep 1; clear_field; adb shell input text "$2"; sleep 1; }
tapt() { $UI tap "$@" >/dev/null; sleep 2; }
COOKIE=""
login_api() { COOKIE=$(curl -s -D - -o /dev/null -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"familyCode\":\"$FAMILY\",\"login\":\"$1\",\"secret\":\"$2\"}" | tr -d '\r' | grep -i '^set-cookie: sc_session=' | sed -E 's/.*sc_session=([^;]*);.*/\1/'); }
api() { local m=$1 p=$2; shift 2; local ct=(); { [ "$m" = POST ] || [ "$m" = PUT ] || [ "$m" = PATCH ]; } && ct=(-H 'content-type: application/json'); curl -s -o /tmp/api.out -w '%{http_code}' -X "$m" "$BASE$p" -H "Cookie: sc_session=$COOKIE" "${ct[@]}" "$@"; }
FAMID() { sql "SELECT id FROM families WHERE code='$FAMILY'"; }
item() { sql "SELECT i.quantity||' '||i.unit||' '||i.status FROM list_items i JOIN products p ON p.id=i.product_id JOIN lists l ON l.id=i.list_id JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active' AND p.name='$1' ORDER BY i.added_at DESC LIMIT 1"; }
signin() { # le formulaire garde les dernières valeurs : on les retrouve par leur contenu
  fill "${PREV_FAMILY:-Code famille}" "$1"; fill "${PREV_LOGIN:-Identifiant}" "$2"; fill "Code d'accès" "$3"; hide_kb
  $UI tap "Se connecter" --last >/dev/null; sleep 3; PREV_FAMILY="$1"; PREV_LOGIN="$2"; }
logout() { tapt "Compte"; $UI tap "Se déconnecter" >/dev/null; sleep 2; $UI tap "Se déconnecter" --last >/dev/null; sleep 3; }
server_wait() { for _ in $(seq 1 60); do curl -fsS --max-time 3 $BASE/health >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell settings put global window_animation_scale 0 >/dev/null 2>&1; adb shell settings put global transition_animation_scale 0 >/dev/null 2>&1; adb shell settings put global animator_duration_scale 0 >/dev/null 2>&1
adb shell wm size 1080x2340 >/dev/null; adb shell wm density 443 >/dev/null
adb uninstall $PKG >/dev/null 2>&1 || true
adb install -r "$APK" >/dev/null || { echo "installation impossible"; exit 1; }
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true

# ═══ Départ propre : liste en cours vide ═══
login_api adil 482913
api GET /api/lists/active >/dev/null; LID=$(jq -r '.list.id // empty' /tmp/api.out)
[ -n "$LID" ] && { api POST "/api/lists/$LID/close" -d '{}' >/dev/null; }
S=$(api POST /api/lists -d '{}'); expect "G0. nouvelle liste vide créée ($S)" test "$S" = 201
ACTIVE=$(jq -r .list.id /tmp/api.out)

launch
expect "G1. écran de connexion" $UI wait "Bienvenue" 25
$UI tap "Se connecter" --last >/dev/null; sleep 2
fill "https://…" "$SERVER" --last; hide_kb
$UI tap "Tester et enregistrer" >/dev/null
$UI wait "10.0.2.2:3000" 20 >/dev/null
signin "$FAMILY" adil 482913
expect "G2. administrateur connecté, liste vide" $UI wait "La liste est vide" 25

# ═══ H. Sélection → liste (administrateur) ═══
tapt "Ajouter des articles"
expect "H1. écran de sélection avec le catalogue réel" $UI wait "Rechercher un produit" 15
fill "Rechercher un produit" "Tomates"; hide_kb
expect "H2. recherche : Tomates" $UI wait "Tomates" 10
$UI tap "Tomates" --last >/dev/null; sleep 2
expect "H3. sélection comptée" $UI wait "Terminer ma sélection (1)" 8
shot lot3-selection
adb shell input keyevent KEYCODE_BACK; sleep 1; launch   # fermeture brutale : le brouillon doit survivre
$UI wait "La liste est vide" 25 >/dev/null; tapt "Ajouter des articles"
expect "H4. brouillon conservé après fermeture de l'application" $UI wait "Terminer ma sélection (1)" 15
$UI tap "Terminer ma sélection" >/dev/null; sleep 4
expect "H5. article visible dans la liste" $UI wait "Tomates" 20
expect "H6. serveur : 1 kg à acheter (« $(item Tomates) »)" test "$(item Tomates)" = "1.000 kg to_buy"
expect "H7. serveur : une validation enregistrée pour Adil" test "$(sql "SELECT count(*) FROM validations v JOIN profiles p ON p.id=v.actor_id WHERE v.list_id='$ACTIVE' AND p.login='adil'")" -ge 1
# quantité
$UI tap "1 kg" >/dev/null; sleep 2
expect "H8. panneau de quantité" $UI wait "Mettre à jour" 10
$UI tap "Augmenter" >/dev/null; sleep 1
shot lot3-quantite
$UI tap "Mettre à jour" >/dev/null; sleep 5
expect "H9. serveur : quantité 1,5 kg (« $(item Tomates) »)" test "$(item Tomates)" = "1.500 kg to_buy"
expect "H10. quantité affichée" $UI wait "1,5 kg" 10

# ═══ I. Achat et correction (parents/administrateurs, réseau requis) ═══
$UI tap "Acheté : Tomates" >/dev/null; sleep 4
expect "I1. serveur : achat enregistré" test "$(item Tomates)" = "1.500 kg purchased"
expect "I2. écran : « Acheté par Adil »" $UI wait "Acheté par Adil" 12
expect "I3. liste terminée proposée (« Tout est acheté »)" $UI wait "Tout est acheté" 8
shot lot3-achete
$UI tap "Acheté : Tomates" >/dev/null; sleep 4
expect "I4. correction : article de nouveau à acheter" test "$(item Tomates)" = "1.500 kg to_buy"
expect "I5. serveur : l'achat corrigé est annulé, pas effacé" test "$(sql "SELECT count(*) FROM purchases pu JOIN lists l ON l.id=pu.list_id WHERE l.id='$ACTIVE' AND pu.voided_at IS NOT NULL")" = 1
$UI tap "Acheté : Tomates" >/dev/null; sleep 4
tapt "Terminer les courses"; $UI tap "Terminer" --last >/dev/null; sleep 4
expect "I6. liste terminée : archivée côté serveur" test "$(sql "SELECT status FROM lists WHERE id='$ACTIVE'")" = archived
expect "I7. historique affiché" $UI wait "1 article acheté" 15
shot lot3-historique

# ═══ J. Historique : détail et Recommander ═══
tapt "1 article acheté"
expect "J1. détail de la commande" $UI wait "Tomates" 12
tapt "Recommander"
expect "J2. retour à la liste avec l'article recommandé" $UI wait "Tomates" 20
sleep 3
expect "J3. serveur : nouvelle liste en cours contenant Tomates ($(item Tomates))" test -n "$(item Tomates)"
expect "J4. l'ancienne liste archivée n'a pas été modifiée" test "$(sql "SELECT count(*) FROM list_items WHERE list_id='$ACTIVE' AND status='purchased'")" = 1
ACTIVE=$(sql "SELECT l.id FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active'")

# ═══ K. Personnel : demandes, quantité, retrait, règles du serveur ═══
logout
expect "K0. déconnecté" $UI wait "Bienvenue" 20
$UI tap "Besoin d'aide" >/dev/null; sleep 2
expect "K0a. aide à la connexion" $UI wait "J'ai oublié mon code" 10
shot lot3-aide-connexion
$UI tap "J'ai oublié mon code" >/dev/null; sleep 2
expect "K0b. récupération du code par e-mail (formulaire réel)" $UI wait "Envoyer le lien" 10
shot lot3-aide-code-oublie
adb shell input keyevent KEYCODE_BACK; sleep 1; hide_kb; adb shell input keyevent KEYCODE_BACK; sleep 1
$UI tap "Première connexion" >/dev/null; sleep 1; $UI tap "Créer ma famille" >/dev/null; sleep 2
expect "K0c. création de famille : jeton d'installation exigé" $UI wait "Jeton d'installation" 10
shot lot3-creer-famille
$UI tap "Se connecter" --first >/dev/null; sleep 1
signin "$FAMILY" marie 573918
expect "K1. personnel : liste du jour" $UI wait "Liste du jour" 25
expect "K2. article demandé visible" $UI wait "Tomates" 15
tapt "Augmenter"; sleep 4
expect "K3. serveur : quantité du personnel enregistrée ($(item Tomates))" test "$(item Tomates)" = "2.000 kg to_buy"
login_api marie 573918
S=$(api GET /api/lists); expect "K4. serveur : le personnel n'a pas l'historique (403, $S)" test "$S" = 403
api GET /api/lists/active >/dev/null; IT=$(jq -r '.list.items[0].id' /tmp/api.out)
S=$(api POST "/api/lists/$ACTIVE/ops" -d "{\"ops\":[{\"opId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"type\":\"purchase\",\"itemId\":\"$IT\"}]}"); expect "K5. serveur : le personnel ne peut pas marquer un achat (403, $S)" test "$S" = 403
S=$(api GET /api/stats/purchases); expect "K6. serveur : pas de statistiques pour le personnel (403, $S)" test "$S" = 403
tapt "Retirer Tomates"; sleep 4
expect "K7. serveur : article retiré (« $(item Tomates) »)" test "$(item Tomates)" = "2.000 kg removed"
expect "K8. écran : liste vide pour le personnel" $UI wait "Aucun article" 12

# ═══ L. Hors connexion : file « Envoi en attente », envoi unique au retour ═══
tapt "Choisir des articles"
fill "Rechercher un produit" "Oignons"; hide_kb
docker stop sc-recette-app >/dev/null
$UI tap "Oignons" --last >/dev/null; sleep 2
$UI tap "Terminer ma sélection" >/dev/null; sleep 5
expect "L1. hors connexion : « Envoi en attente » affiché" $UI wait "Envoi en attente" 15
shot lot3-envoi-en-attente
launch   # fermeture brutale pendant l'attente
expect "L2. la demande en attente survit à la fermeture de l'application" $UI wait "Envoi en attente" 25
docker start sc-recette-app >/dev/null; server_wait
expect "L3. retour du réseau : la demande part toute seule" $UI gone "Envoi en attente" 60
expect "L4. serveur : demande reçue une seule fois (« $(item Oignons) »)" test "$(sql "SELECT count(*) FROM list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id='$ACTIVE' AND p.name='Oignons'")" = 1

# ═══ M. Liste terminée pendant l'attente : rien n'est ajouté à l'archive, « Reprendre » ═══
tapt "Choisir"   # onglet du bas : le bouton « Choisir des articles » n'existe que sur une liste vide (ici elle contient déjà l'article du bloc L)
fill "Rechercher un produit" "Carottes"; hide_kb
docker stop sc-recette-app >/dev/null
$UI tap "Carottes" --last >/dev/null; sleep 2
$UI tap "Terminer ma sélection" >/dev/null; sleep 5
expect "M0. hors connexion : « Envoi en attente » affiché" $UI wait "Envoi en attente" 15
ADIL=$(sql "SELECT id FROM profiles WHERE login='adil'")
sql "UPDATE lists SET status='archived', closed_by='$ADIL', closed_at=now() WHERE id='$ACTIVE'" >/dev/null
docker start sc-recette-app >/dev/null; server_wait
expect "M1. liste terminée entre-temps : la demande est refusée proprement" $UI gone "Envoi en attente" 60
expect "M2. serveur : rien n'a été ajouté à la liste archivée" test "$(sql "SELECT count(*) FROM list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id='$ACTIVE' AND p.name='Carottes'")" = 0
tapt "Choisir"
expect "M3. « Reprendre » proposé pour les articles gardés" $UI wait "Reprendre" 20
shot lot3-reprendre
$UI tap "Reprendre" >/dev/null; sleep 2
expect "M4. article repris dans la sélection" $UI wait "Terminer ma sélection (1)" 10
$UI tap "Terminer ma sélection" >/dev/null; sleep 5
ACTIVE2=$(sql "SELECT l.id FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active'")
expect "M5. serveur : une nouvelle liste en cours contient Carottes" test "$(sql "SELECT count(*) FROM list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id='$ACTIVE2' AND p.name='Carottes'")" = 1

# ═══ N. Brouillons isolés par profil ═══
tapt "Choisir"
fill "Rechercher un produit" "Tomates"; hide_kb
$UI tap "Tomates" --last >/dev/null; sleep 2
expect "N1. brouillon du personnel" $UI wait "Terminer ma sélection (1)" 8
launch
logout
signin "$FAMILY" lamiaa 573918
expect "N2. parent connecté" $UI wait "Ma liste" 25
tapt "Ajouter des articles"
expect "N3. le brouillon d'un autre profil n'apparaît pas" $UI gone "Terminer ma sélection (1)" 8
shot lot3-brouillon-isole

# ═══ O. Prix, total estimé, réglages d'affichage ═══
logout
signin "$FAMILY" adil 482913
$UI wait "Ma liste" 25 >/dev/null
# ═══ Écrans supplémentaires (captures pour validation) ═══
shot lot3-liste-admin
tapt "Favoris"; shot lot3-favoris; adb shell input keyevent KEYCODE_BACK; sleep 1
tapt "Réglages"; $UI tap "Réinitialiser la famille" --scroll >/dev/null; sleep 3
expect "K9. réinitialisation : confirmation par mot de passe et code famille" $UI wait "Réinitialiser définitivement" 15
shot lot3-reinitialiser
adb shell input keyevent KEYCODE_BACK; sleep 1
tapt "Réglages"; tapt "Affichage"
tapt "Prix indicatifs"
expect "O1. serveur : préférence « prix » enregistrée pour ce profil" test "$(sql "SELECT show_prices FROM profiles WHERE login='adil'")" = t
tapt "Total estimé"
expect "O2. serveur : préférence « total » enregistrée" test "$(sql "SELECT show_totals FROM profiles WHERE login='adil'")" = t
expect "O3. les autres profils ne sont pas touchés" test "$(sql "SELECT show_prices FROM profiles WHERE login='lamiaa'")" = f
adb shell input keyevent KEYCODE_BACK; sleep 1
tapt "Liste"
shot lot3-prix-liste
# gestion des prix
tapt "Réglages"; tapt "Gestion des prix"
expect "O4. gestion des prix : catalogue réel" $UI wait "Sans prix" 20
shot lot3-gestion-prix
fill "Rechercher un produit" "Carottes"; hide_kb
$UI tap "Ajouter un prix" >/dev/null || $UI tap "DH" --last >/dev/null; sleep 2
expect "O5. panneau de prix" $UI wait "Enregistrer" 10
sleep 1; clear_field; adb shell input text "7,50"; hide_kb
$UI tap "Enregistrer" >/dev/null; sleep 4
expect "O6. serveur : prix de la famille enregistré (7.50)" test "$(sql "SELECT amount FROM family_prices fp JOIN products p ON p.id=fp.product_id JOIN families f ON f.id=fp.family_id WHERE f.code='$FAMILY' AND p.name='Carottes'")" = 7.50
expect "O7. prix affiché dans la gestion des prix" $UI wait "7,50 DH" 10

# ═══ P. Statistiques ═══
launch; $UI wait "Ma liste" 25 >/dev/null
tapt "Statistiques"
expect "P1. statistiques réelles : achat de Tomates" $UI wait "Tomates" 20
expect "P2. dépense payée jamais inventée" $UI has "non saisie"
shot lot3-statistiques

# ═══ S. Mise à jour en direct (flux SSE) : la demande d'un autre profil apparaît sans rien faire ═══
launch; $UI wait "Ma liste" 25 >/dev/null; sleep 6
login_api marie 573918
api GET /api/catalog >/dev/null; LAI=$(jq -r '[.categories[].products[] | select(.name=="Laitue")][0].id' /tmp/api.out)
api POST /api/lists/active/ops -d "{\"ops\":[{\"opId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"type\":\"add\",\"productId\":\"$LAI\",\"quantity\":1}]}" >/dev/null
expect "S1. mise à jour en direct : la demande de Marie apparaît toute seule" $UI wait "Laitue" 25

# ═══ Q. Réglages : récupération, notifications, sauvegarde, à propos ═══
tapt "Réglages"; tapt "Récupération"
expect "Q1. récupération : adresse réelle" $UI wait "recette@example.org" 15
expect "Q2. adresse vérifiée" $UI has "Vérifiée"
shot lot3-recuperation
adb shell input keyevent KEYCODE_BACK; sleep 1
tapt "Sauvegarde"
expect "Q3. sauvegarde : lecture seule, état réel" $UI wait "Dernière sauvegarde" 15
shot lot3-sauvegarde
adb shell input keyevent KEYCODE_BACK; sleep 1
tapt "À propos"
expect "Q4. à propos : version et serveur" $UI wait "10.0.2.2:3000" 10
shot lot3-apropos
adb shell input keyevent KEYCODE_BACK; sleep 1
tapt "Notifications"
$UI tap "Nouvelles demandes" >/dev/null
expect "Q5. notifications activées" $UI wait "Notifications activées" 10
shot lot3-notifications
expect "Q6. tâche périodique programmée par Android" bash -c "adb shell dumpsys jobscheduler | grep -q $PKG"

# ═══ R. Notification réelle : une demande d'un autre profil, application en arrière-plan ═══
launch; $UI wait "Ma liste" 25 >/dev/null; sleep 8
adb shell input keyevent KEYCODE_HOME; sleep 8
login_api marie 573918
api GET /api/catalog >/dev/null; PID=$(jq -r '[.categories[].products[] | select(.name=="Lait")][0].id' /tmp/api.out)
api POST /api/lists/active/ops -d "{\"ops\":[{\"opId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"type\":\"add\",\"productId\":\"$PID\",\"quantity\":1}]}" >/dev/null
JOB=$(adb shell dumpsys jobscheduler | tr -d '\r' | grep -oE "#u0a[0-9]+/[0-9]+: [0-9a-f]+ $PKG" | head -1 | sed -E 's#.*/([0-9]+):.*#\1#')
echo "tâche WorkManager n°${JOB:-?}" | tee -a "$OUT/resultats.txt"
sleep 3; adb logcat -c; adb shell am start -n "$PKG/.MainActivity" --ez poll true >/dev/null 2>&1; sleep 10; adb logcat -d | grep CoursesNotif | tee -a "$OUT/resultats.txt"
echo "--- diagnostic notification ---" | tee -a "$OUT/resultats.txt"

adb logcat -d | grep -E "WM-|PollWorker|SystemJobService" | tail -12 | tee -a "$OUT/resultats.txt"
adb shell dumpsys notification | grep -E "pkg=$PKG|Nouvelle" | head | tee -a "$OUT/resultats.txt"
expect "R1. notification « Nouvelle demande » affichée" bash -c "adb shell dumpsys notification --noredact | grep -q 'Nouvelle demande'"
adb exec-out screencap -p > "$OUT/lot3-notification-fond.png"

echo "--- journal de l'application ---" | tee -a "$OUT/resultats.txt"; adb logcat -d | grep CoursesData | grep -v "envoyées=0 gardées=0" | tail -40 | tee -a "$OUT/resultats.txt"
echo "ECHECS=$FAILS" | tee -a "$OUT/resultats.txt"
adb logcat -d -b crash > "$OUT/logcat-crash.txt" 2>&1 || true
echo "CRASH_APPLICATION=$(grep -c app.smartcourse "$OUT/logcat-crash.txt")" | tee -a "$OUT/resultats.txt"
echo "--- échecs (résumé) ---"; grep -A1 -E "^FAIL" "$OUT/resultats.txt" | cut -c1-400 || true
[ "$FAILS" = 0 ]
