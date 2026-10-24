#!/usr/bin/env bash
# Spot publicitaire de 60 s : séquences vidéo SÉPARÉES (A à L) et images fixes de l'application RÉELLE, version candidate
# (même code que l'APK final, -Pfinal=1), sur un serveur de recette LOCAL et jetable rempli de données FICTIVES (Famille Martin :
# Karim le mari, Sophie la femme, Nadia l'employée de maison ; Casablanca). Aucune donnée réelle, aucun accès à la production.
# Format vertical 1080 × 1920, sans son ; gestes lents, pause avant et après chaque action ; barre d'état figée (09:41).
# « L'autre téléphone » (notification, coche visible chez l'autre parent) : l'action de l'autre profil est envoyée par l'API de la
# recette, comme le ferait son application ; un seul émulateur filme le téléphone qui reçoit.
# Usage : native-demo-pub.sh APK SORTIE   (recette lancée avec SEED_PLAY=1 ; SEQUENCES=A,B,… pour n'en jouer qu'une partie)
set -uo pipefail
APK=${1:?apk}; OUT=${2:-demo-pub}
PKG=app.smartcourse.courses.natif; ACT="$PKG/app.smartcourse.courses.nativeproto.MainActivity"
HERE="$(cd "$(dirname "$0")" && pwd)"; UI="python3 $HERE/native-ui.py"; BASE=http://127.0.0.1:3000
mkdir -p "$OUT/videos" "$OUT/images" "$OUT/diag"; : > "$OUT/resultats.txt"; FAILS=0
log() { echo "$*" | tee -a "$OUT/resultats.txt"; }
ok() { log "PASS  $1"; }
ko() { log "FAIL  $1"; FAILS=$((FAILS+1)); adb exec-out screencap -p > "$OUT/diag/echec-$(echo "$1" | tr -c 'a-zA-Z0-9' '_' | cut -c1-30).png" || true; }
expect() { local l=$1; shift; if "$@"; then ok "$l"; else ko "$l"; fi; }
want() { [ -z "${SEQUENCES:-}" ] || [[ ",${SEQUENCES// /}," == *",$1,"* ]]; }
sql() { docker exec -i sc-recette-pg psql -U smart -d smartcourse -v ON_ERROR_STOP=1 -tA "$@"; }
hide_kb() { adb shell dumpsys input_method | grep -q "mInputShown=true" && adb shell input keyevent KEYCODE_BACK; sleep 1; }
clear_field() { adb shell input keyevent KEYCODE_MOVE_END; for _ in $(seq 1 30); do adb shell input keyevent 67; done; }
fill_field() { $UI field "$1" >/dev/null || return 1; sleep 1; clear_field; adb shell input text "$2"; sleep 1; }
# Geste lisible : pause avant (le spectateur voit l'écran), action, pause après (le résultat reste à l'écran).
act() { sleep 1.5; $UI tap "$@" >/dev/null || { log "  introuvable : $1"; return 1; }; sleep 2.5; }
back() { sleep 1.2; adb shell input keyevent KEYCODE_BACK; sleep 2; }
scroll_to() { for _ in 1 2 3 4 5; do $UI has "$1" && return 0; adb shell input swipe 540 1400 540 900 1500; sleep 1.5; done; $UI has "$1"; }
top() { for _ in 1 2 3; do adb shell input swipe 540 600 540 1600 300; done; sleep 1; }
still() { adb exec-out screencap -p > "$OUT/images/$1.png"; log "image $1"; }
REC=""
rec_start() { # enregistrement d'une séquence (screenrecord : 3 min au plus, largement suffisant)
  REC=$1; adb shell rm -f "/sdcard/$REC.mp4"
  adb shell screenrecord --size 1080x1920 --bit-rate 12000000 --time-limit 175 "/sdcard/$REC.mp4" & REC_PID=$!
  sleep 3   # plan fixe de départ
}
rec_stop() {
  sleep 3   # plan fixe de fin
  adb shell pkill -INT screenrecord; wait "$REC_PID" 2>/dev/null; sleep 2
  adb pull "/sdcard/$REC.mp4" "$OUT/videos/$REC.mp4" >/dev/null 2>&1; adb shell rm -f "/sdcard/$REC.mp4"
  local s; s=$(stat -c %s "$OUT/videos/$REC.mp4" 2>/dev/null || echo 0)
  if [ "$s" -gt 100000 ]; then log "vidéo $REC ($((s/1024)) Ko)"; else ko "vidéo $REC vide ou absente"; fi
}
demo_bar() { # barre d'état propre et figée (mode démonstration d'Android) ; $1 = notifications visibles (true/false)
  adb shell am broadcast -a com.android.systemui.demo -p com.android.systemui -e command enter >/dev/null
  adb shell am broadcast -a com.android.systemui.demo -p com.android.systemui -e command clock -e hhmm 0941 >/dev/null
  adb shell am broadcast -a com.android.systemui.demo -p com.android.systemui -e command battery -e level 100 -e plugged false >/dev/null
  adb shell am broadcast -a com.android.systemui.demo -p com.android.systemui -e command network -e wifi show -e level 4 -e fully true >/dev/null
  adb shell am broadcast -a com.android.systemui.demo -p com.android.systemui -e command network -e mobile show -e level 4 -e datatype none -e fully true >/dev/null
  adb shell am broadcast -a com.android.systemui.demo -p com.android.systemui -e command notifications -e visible "${1:-false}" >/dev/null
}

# ── États de la base jetable : S0 = jeu de données du spot, liste « Courses de la semaine » vide. Chaque séquence part d'un état connu.
snapshot() { docker exec sc-recette-pg pg_dump -U smart -Fc smartcourse > "/tmp/demo-$1.dump"; }
restore() {
  docker stop sc-recette-app >/dev/null
  docker exec sc-recette-pg dropdb -U smart --force smartcourse && docker exec sc-recette-pg createdb -U smart smartcourse
  docker exec -i sc-recette-pg pg_restore -U smart -d smartcourse --no-owner < "/tmp/demo-$1.dump"
  docker start sc-recette-app >/dev/null
  for _ in $(seq 1 60); do curl -fsS -m 3 "$BASE/health" >/dev/null 2>&1 && return 0; sleep 1; done
  ko "serveur de recette indisponible après restauration $1"; return 1
}
other() { python3 "$HERE/demo-act.py" "$BASE" "$FAMILY" "$@" | tee -a "$OUT/resultats.txt"; }

# Application propre puis connexion d'un profil (hors enregistrement). $1 identifiant, $2 code, $3 texte attendu à l'arrivée.
login_as() {
  adb shell cmd statusbar collapse >/dev/null 2>&1; adb shell input keyevent KEYCODE_HOME; sleep 1
  local try; for try in 1 2; do login_once "$@" && return 0; log "  nouvelle tentative de connexion $1"; done
  ko "connexion $1"; return 1
}
login_once() {
  adb shell pm clear $PKG >/dev/null; adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
  adb shell am start -W -n "$ACT" >/dev/null 2>&1; sleep 4
  $UI wait "Bienvenue" 25 >/dev/null
  fill_field 0 "$FAMILY"; hide_kb; fill_field 1 "$1"; hide_kb; fill_field 2 "$2"; hide_kb
  $UI tap "Se connecter" --last >/dev/null; sleep 5
  $UI wait "$3" 30 >/dev/null || { adb exec-out screencap -p > "$OUT/diag/connexion-$1-$(date +%s).png"; return 1; }
  sleep 3   # synchronisation initiale terminée avant de filmer
}
SOPHIE=(sophie 482913); KARIM=(karim 573918); NADIA=(nadia 573918)
enable_notifications() { # Réglages → Notifications et rappels → Nouvelles demandes (hors enregistrement)
  $UI tap "Réglages" >/dev/null; sleep 2; scroll_to "Notifications et rappels" >/dev/null
  $UI tap "Notifications et rappels" >/dev/null; sleep 2
  $UI wait "Nouvelles demandes" 10 >/dev/null; sleep 1
  adb exec-out screencap -p > "$OUT/diag/notif-avant-$(date +%s).png"
  $UI tap "Nouvelles demandes" >/dev/null; sleep 1.5
  adb exec-out screencap -p > "$OUT/diag/notif-apres-$(date +%s).png"
  adb shell dumpsys jobscheduler | grep -q "$PKG" && log "  tâche périodique programmée" || ko "notifications activées (aucune tâche programmée)"
  adb shell input keyevent KEYCODE_BACK; sleep 1; $UI tap "Liste" --exact >/dev/null; sleep 4   # liste vue : repère des demandes posé
}
poll_now() { # la vérification périodique d'Android (WorkManager) est lancée tout de suite, sans attendre 15 minutes
  adb shell dumpsys jobscheduler | tr -d '\r' | grep -E "JOB #.*$PKG" > "$OUT/diag/jobs-$(date +%s).txt"
  local job; job=$(adb shell dumpsys jobscheduler | tr -d '\r' | grep -E "JOB #.*$PKG.*SystemJobService" | head -1 | sed -E 's#.*JOB \#[^/]+/([0-9]+):.*#\1#')
  log "  vérification forcée, tâche n°${job:-absente}"; adb logcat -c
  [ -n "$job" ] && adb shell cmd jobscheduler run -f $PKG "$job" 2>&1 | head -2 | tee -a "$OUT/resultats.txt"; sleep 10
  adb logcat -d | grep -E "CoursesNotif|WM-WorkerWrapper" | tail -4 | tee -a "$OUT/resultats.txt"
}

FAMILY=$(sql -c "SELECT code FROM families WHERE name='Famille Martin'")
[ -n "$FAMILY" ] || { echo "Famille Martin absente : lancer la recette avec SEED_PLAY=1"; exit 1; }
python3 "$HERE/demo-seed.py" "$BASE" "$FAMILY" /tmp/demo-dates.sql | tee -a "$OUT/resultats.txt" || exit 1
sql < /tmp/demo-dates.sql >/dev/null || exit 1
expect "S0. données fictives : 4 courses passées, liste « Courses de la semaine » vide" test "$(sql -c "SELECT count(*) FILTER (WHERE l.status='archived')||'/'||count(*) FILTER (WHERE l.status='active' AND l.name='Courses de la semaine' AND NOT EXISTS (SELECT 1 FROM list_items i WHERE i.list_id=l.id AND i.status<>'removed')) FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY'")" = "4/1"
snapshot S0

adb shell wm size 1080x1920 >/dev/null; adb shell wm density 420 >/dev/null
adb shell settings put global sysui_demo_allowed 1
adb shell settings put system show_touches 1   # point de contact visible : le geste se lit à l'écran
demo_bar false
adb install -r "$APK" >/dev/null
adb root >/dev/null 2>&1; sleep 3; adb wait-for-device   # émulateur de recette : réglage de l'horloge (séquence B)

# ═══ A. Nadia choisit les articles en photos, change une quantité, envoie sa sélection ═══
if want A; then
login_as "${NADIA[@]}" "Choisir mes articles"
rec_start A-selection-photos
act "Légumes et herbes"; act "Tomates" --exact          # la photo touchée : 1 kg choisi
act "Modifier la quantité : Tomates"
$UI wait "Mettre à jour" 10 >/dev/null
act "Augmenter"; act "Augmenter"   # 1 kg → 1,5 kg : le changement de quantité du spot
expect "A1. Tomates : 1,5 kg" $UI has "1,5"
still A1-quantite-tomates
act "Mettre à jour"
act "Pommes de terre" --exact
act "Catégories"; act "Fruits"; act "Bananes" --exact
more() { act "Modifier la quantité : $1"; $UI wait "Mettre à jour" 10 >/dev/null; for _ in $(seq 1 "$2"); do sleep 0.4; $UI tap "Augmenter" >/dev/null; sleep 0.9; done; act "Mettre à jour"; }
reach() { for _ in 1 2 3 4 5; do $UI has "$1" --exact && return 0; adb shell input swipe 540 1450 540 850 1500; sleep 1.5; done; }   # défilement lent et lisible
act "Catégories"; act "Laitages et œufs"; reach "Œufs"; act "Œufs" --exact; more "Œufs" 5
act "Catégories"; act "Pain et petit-déjeuner"; reach "Pain"; act "Pain" --exact; more "Pain" 3
act "Catégories"
expect "A2. sélection de 5 articles" $UI has "Terminer ma sélection (5)"
still A2-selection-5-articles
act "Terminer ma sélection"
sleep 2; still A3-selection-envoyee
rec_stop
expect "A3. sélection reçue par le serveur (5 articles)" test "$(sql -c "SELECT count(*) FROM list_items i JOIN lists l ON l.id=i.list_id WHERE l.name='Courses de la semaine' AND l.status='active' AND i.status<>'removed'")" = 5
fi

# ═══ B. Notification sur les deux téléphones des parents (Karim, puis Sophie) ═══
if want B; then
for name in karim sophie; do
  restore S0 || continue
  if [ $name = karim ]; then login_as "${KARIM[@]}" "Ma liste"; else login_as "${SOPHIE[@]}" "Ma liste"; fi
  enable_notifications; poll_now
  adb shell input keyevent KEYCODE_HOME; sleep 3
  demo_bar true
  rec_start "B-notification-$name"
  other batch; sleep 2; poll_now
  for _ in 1 2 3; do adb shell dumpsys notification --noredact | grep -q 'Nouvelle demande' && break; poll_now; done
  if ! adb shell dumpsys notification --noredact | grep -q 'Nouvelle demande'; then
    # WorkManager n'exécute pas une tâche périodique avant son échéance (15 min) : l'horloge de l'émulateur jetable est avancée de
    # 16 min, la vérification réelle de l'application est lancée, puis l'horloge est remise à l'heure.
    log "  horloge de l'émulateur avancée de 16 min"
    adb shell settings put global auto_time 0; adb shell "date -u $(date -u -d '+16 minutes' +%m%d%H%M%Y.%S)" >/dev/null
    for _ in 1 2 3; do poll_now; adb shell dumpsys notification --noredact | grep -q 'Nouvelle demande' && break; done
    adb shell "date -u $(date -u +%m%d%H%M%Y.%S)" >/dev/null
  fi
  if ! adb shell dumpsys notification --noredact | grep -q 'Nouvelle demande'; then
    # Repli : la vérification périodique d'Android (au plus 15 min + marge) ; l'enregistrement reprend quand la notification est là.
    rec_stop; mv "$OUT/videos/B-notification-$name.mp4" "$OUT/diag/B-attente-$name.mp4" 2>/dev/null
    log "  attente de la vérification périodique d'Android (jusqu'à 17 min)"
    for _ in $(seq 1 102); do adb shell dumpsys notification --noredact | grep -q 'Nouvelle demande' && break; sleep 10; done
    rec_start "B-notification-$name"; sleep 1
  fi
  sleep 2; adb shell cmd statusbar expand-notifications; sleep 4
  expect "B. notification « Nouvelle demande » ($name)" bash -c "adb shell dumpsys notification --noredact | grep -q 'Nouvelle demande'"
  still "B1-notification-$name"
  act "Nouvelle demande" || adb shell cmd statusbar collapse
  $UI wait "Tomates" 15 >/dev/null; sleep 2
  still "B2-liste-ouverte-$name"
  rec_stop
  adb shell cmd statusbar collapse >/dev/null 2>&1
  demo_bar false
done
fi

# ═══ C. Les articles arrivent dans la liste partagée (téléphone de Sophie, liste ouverte) ═══
if want C; then
restore S0 && login_as "${SOPHIE[@]}" "Ma liste"
still C0-liste-vide
rec_start C-liste-partagee
sleep 2; other batch
expect "C1. les articles apparaissent sans action" bash -c "$UI wait 'Tomates' 30 && $UI wait 'Bananes' 10"
sleep 4; still C1-articles-recus
rec_stop
fi

# S1 = S0 + sélection de Nadia (articles dans la liste) : départ de D et E.
if want D || want E; then restore S0 && other batch && snapshot S1; fi

# ═══ D. Karim coche « Tomates » ; Sophie voit le changement ═══
if want D; then
restore S1 && login_as "${KARIM[@]}" "Tomates"
rec_start D1-karim-coche-tomates
act "Acheté : Tomates"
expect "D1. Tomates achetées par Karim" bash -c "for _ in 1 2 3 4 5; do $UI has 'Déjà achetés' && exit 0; adb shell input swipe 540 1500 540 900 600; sleep 2; done; exit 1"
still D1-karim-tomates-achetees
rec_stop
restore S1 && login_as "${SOPHIE[@]}" "Tomates"
rec_start D2-sophie-voit-tomates
sleep 2; other buy karim Tomates
expect "D2. chez Sophie : « Acheté par Karim »" bash -c "for _ in 1 2 3 4 5 6; do $UI has 'Acheté par Karim' && exit 0; adb shell input swipe 540 1500 540 900 600; sleep 3; done; exit 1"
sleep 3; still D2-sophie-voit-achat-karim
rec_stop
fi

# ═══ E. Sophie coche « Bananes » ; Karim voit le changement ═══
if want E; then
restore S1 && login_as "${SOPHIE[@]}" "Bananes"
rec_start E1-sophie-coche-bananes
act "Acheté : Bananes"
expect "E1. Bananes achetées par Sophie" bash -c "for _ in 1 2 3 4 5; do $UI has 'Achetée par Sophie' || $UI has 'Acheté par Sophie' && exit 0; adb shell input swipe 540 1400 540 900 1500; sleep 2; done; exit 1"
still E1-sophie-bananes-achetees
rec_stop
restore S1 && login_as "${KARIM[@]}" "Bananes"
rec_start E2-karim-voit-bananes
sleep 2; other buy sophie "Bananes"
expect "E2. chez Karim : « Acheté par Sophie »" bash -c "for _ in 1 2 3 4 5 6; do $UI has 'Acheté par Sophie' && exit 0; adb shell input swipe 540 1500 540 900 600; sleep 3; done; exit 1"
sleep 3; still E2-karim-voit-achat-sophie
rec_stop
fi

# F à L : Sophie (administratrice), état S1 (liste en cours remplie, quatre courses passées, Budget en MAD).
if want F || want G || want H || want I || want J || want K || want L; then restore S1 && login_as "${SOPHIE[@]}" "Ma liste"; fi

# ═══ F. Historique des courses ═══
if want F; then
rec_start F-historique
act "Historique"
expect "F1. historique : courses passées" $UI wait "Recommander" 15
sleep 2; still F1-historique
sleep 1; adb shell input swipe 540 1400 540 900 1200; sleep 2
rec_stop
fi

# ═══ H. Statistiques du mois ═══
if want H; then
rec_start H-statistiques
act "Statistiques"
expect "H1. statistiques du mois" bash -c "$UI wait 'Achats par catégorie' 20"
sleep 2; still H1-statistiques
adb shell input swipe 540 1500 540 800 1500; sleep 3; still H2-statistiques-suite
rec_stop
fi

# ═══ G. Recherche d'un produit et détail des achats (ÉVOLUTION EN PRÉPARATION : version non encore validée) ═══
if want G; then
$UI tap "Statistiques" >/dev/null; sleep 3; top
rec_start G-recherche-produit-EN-PREPARATION
scroll_to "Voir tous les produits" >/dev/null; act "Voir tous les produits"
sleep 1; $UI tap "Rechercher un produit" >/dev/null; sleep 1.5; adb shell input text "bananes"; sleep 2; hide_kb
still G1-recherche-bananes
act "Bananes" --exact --last
sleep 2; still G2-detail-bananes-mois
act "Tout l'historique"
expect "G1. détail des achats de Bananes, tout l'historique" $UI has "Tout l'historique"
sleep 2; still G3-bananes-tout-historique
rec_stop
back; back
fi

# ═══ I. Saisir un paiement pendant les courses ═══
if want I; then
$UI tap "Liste" --exact >/dev/null; sleep 3
rec_start I-saisir-paiement
act "Plus d'actions"; act "Saisir un paiement"
act "Supermarché"
$UI tap "Montant payé" >/dev/null; sleep 1; adb shell input text "312,50"; sleep 2; hide_kb
still I1-paiement-saisi
act "Enregistrer la dépense"
expect "I1. paiement enregistré" $UI wait "Paiement enregistré" 10
sleep 2; still I2-paiement-enregistre
rec_stop
fi

# ═══ J. Budget du mois et montant restant ; K. Mon compte ═══
if want J; then
rec_start J-budget-mensuel
act "Budget"
$UI wait "Solde de mon compte" 20 >/dev/null; sleep 2; still J1-budget-du-mois
scroll_to "Budgets mensuels" >/dev/null; act "Budgets mensuels"
expect "J1. budgets mensuels (Courses, Transport, Maison)" bash -c "$UI wait 'Transport' 15 && $UI has 'Maison'"
sleep 2; still J2-budgets-mensuels-restant
rec_stop
back
fi
if want K; then
$UI tap "Budget" >/dev/null; sleep 3; top
rec_start K-mon-compte
scroll_to "Mon compte" >/dev/null; act "Mon compte"
expect "K1. Mon compte : solde, dépenses, entrées" $UI wait "Solde de mon compte" 15
sleep 2; still K1-mon-compte
adb shell input swipe 540 1400 540 900 1200; sleep 2; still K2-mon-compte-operations
rec_stop
back
fi

# ═══ L. Prix indicatifs pour une famille au Maroc ═══
if want L; then
$UI tap "Réglages" >/dev/null; sleep 3; top
rec_start L-prix-indicatifs-maroc
scroll_to "Gestion des prix" >/dev/null; act "Gestion des prix"
$UI wait "Tomates" 15 >/dev/null; sleep 2; still L1-gestion-des-prix
act "DH / kg"   # premier prix de la liste : Tomates
expect "L1. prix indicatif en dirhams" $UI wait "Prix indicatif" 10
sleep 2; still L2-prix-tomates
rec_stop
back
fi

adb shell am broadcast -a com.android.systemui.demo -p com.android.systemui -e command exit >/dev/null
adb shell settings put system show_touches 0
adb shell wm size reset >/dev/null; adb shell wm density reset >/dev/null
log "Vidéos : $(ls "$OUT"/videos/*.mp4 2>/dev/null | wc -l) ; images : $(ls "$OUT"/images/*.png 2>/dev/null | wc -l) ; échecs : $FAILS"
exit 0
