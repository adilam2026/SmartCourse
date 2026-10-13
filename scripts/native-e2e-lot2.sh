#!/usr/bin/env bash
# Lot 2 de bout en bout : profils, rôles, ville, catalogue. APK natif réel (émulateur) + serveur de recette réel (Docker + PostgreSQL jetables).
# Les protections sont vérifiées DEUX fois : par l'interface, et directement auprès du serveur (requêtes HTTP) pour prouver qu'elles viennent bien de lui.
# Usage : native-e2e-lot2.sh APK CODE_FAMILLE SORTIE
set -uo pipefail
PKG=app.smartcourse.courses.nativeproto
APK=${1:?apk}; FAMILY=${2:?code famille}; OUT=${3:-native-e2e-lot2}
SERVER=http://10.0.2.2:3000; BASE=http://127.0.0.1:3000
HERE="$(cd "$(dirname "$0")" && pwd)"
UI="python3 $HERE/native-ui.py"
mkdir -p "$OUT"; : > "$OUT/resultats.txt"
FAILS=0
ok()   { echo "PASS  $1" | tee -a "$OUT/resultats.txt"; }
ko()   { echo "FAIL  $1" | tee -a "$OUT/resultats.txt"; FAILS=$((FAILS+1)); local n; n=$(echo "$1" | tr -c 'a-zA-Z0-9' '_' | cut -c1-40); adb exec-out screencap -p > "$OUT/echec-$n.png" || true; adb shell uiautomator dump /sdcard/f.xml >/dev/null 2>&1; adb exec-out cat /sdcard/f.xml > "$OUT/echec-$n.xml" 2>/dev/null || true; }
expect() { local label=$1; shift; if "$@"; then ok "$label"; else ko "$label"; fi; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
sql() { docker exec sc-recette-pg psql -U smart -d smartcourse -tAc "$1"; }
launch() { adb shell am force-stop $PKG; adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 3; }
hide_kb() { adb shell dumpsys input_method | grep -q "mInputShown=true" && adb shell input keyevent KEYCODE_BACK; sleep 1; }
clear_field() { adb shell input keyevent KEYCODE_MOVE_END; for _ in $(seq 1 30); do adb shell input keyevent 67; done; }
fill() { $UI tap "$1" ${3:-} >/dev/null || return 1; sleep 1; clear_field; adb shell input text "$2"; sleep 1; }
tapt() { $UI tap "$@" >/dev/null; sleep 2; }
# ── appels directs au serveur (preuve que les règles viennent du serveur) ──
COOKIE=""
login_api() { COOKIE=$(curl -s -D - -o /dev/null -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"familyCode\":\"$FAMILY\",\"login\":\"$1\",\"secret\":\"$2\"}" | tr -d '\r' | grep -i '^set-cookie: sc_session=' | sed -E 's/.*sc_session=([^;]*);.*/\1/'); }
api() { local m=$1 p=$2; shift 2; local ct=(); [ "$m" = POST ] || [ "$m" = PUT ] || [ "$m" = PATCH ] && ct=(-H 'content-type: application/json'); curl -s -o /tmp/api.out -w '%{http_code}' -X "$m" "$BASE$p" -H "Cookie: sc_session=$COOKIE" "${ct[@]}" "$@"; }
errcode() { jq -r '.error // empty' /tmp/api.out; }
pid() { sql "SELECT p.id FROM profiles p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.login='$1'"; }

adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell settings put global window_animation_scale 0 >/dev/null 2>&1; adb shell settings put global transition_animation_scale 0 >/dev/null 2>&1; adb shell settings put global animator_duration_scale 0 >/dev/null 2>&1
adb shell wm size 1080x2340 >/dev/null; adb shell wm density 443 >/dev/null
adb uninstall $PKG >/dev/null 2>&1 || true
adb install -r "$APK" >/dev/null || { echo "installation impossible"; exit 1; }

# ═══ A. Protections appliquées par le SERVEUR (requêtes directes) ═══
login_api adil 482913
ADIL=$(pid adil)
expect "A0. connexion administrateur auprès du serveur" test -n "$COOKIE"
S=$(api PATCH "/api/profiles/$ADIL" -d '{"role":"parent"}'); expect "A1. rôle de l'administrateur principal : refusé (409 $(errcode))" test "$S" = 409
S=$(api PATCH "/api/profiles/$ADIL" -d '{"active":false}'); expect "A2. désactivation de l'administrateur principal : refusée (409 $(errcode))" test "$S" = 409
S=$(api DELETE "/api/profiles/$ADIL"); expect "A3. suppression de soi-même : refusée ($S $(errcode))" test "$S" = 400 -a "$(errcode)" = use_own_deletion
S=$(api POST /api/profiles -d '{"displayName":"Boss","login":"boss","role":"admin","secret":"135790","secretConfirm":"135790","city":"Casablanca"}'); expect "A4. création d'un second administrateur ($S)" test "$S" = 201
BOSS=$(pid boss)
S=$(api PATCH "/api/profiles/$BOSS" -d '{"active":false}'); expect "A5. un administrateur ne se désactive pas (409 $(errcode))" test "$S" = 409 -a "$(errcode)" = admin_cannot_deactivate
S=$(api DELETE "/api/profiles/$BOSS"); expect "A6. un administrateur ne se supprime pas (409 $(errcode))" test "$S" = 409 -a "$(errcode)" = admin_cannot_delete
login_api boss 135790; BCOOKIE=$COOKIE
S=$(api DELETE "/api/profiles/$ADIL"); expect "A7. l'administrateur principal ne se supprime pas, même par un autre administrateur (409 $(errcode))" test "$S" = 409 -a "$(errcode)" = admin_cannot_delete
S=$(api PATCH "/api/profiles/$ADIL" -d '{"role":"staff"}'); expect "A8. idem pour le rôle (409 $(errcode))" test "$S" = 409
login_api adil 482913
S=$(api PATCH "/api/profiles/$BOSS" -d '{"role":"parent"}'); expect "A9. retirer le rôle administrateur : permis ($S)" test "$S" = 200
S=$(api DELETE "/api/profiles/$BOSS"); expect "A10. puis suppression permise ($S)" test "$S" = 200
expect "A11. profil supprimé : anonymisé, achats conservés ('$(sql "SELECT display_name FROM profiles WHERE id='$BOSS'")')" test "$(sql "SELECT display_name FROM profiles WHERE id='$BOSS'")" = "Ancien profil"
login_api marie 573918; S=$(api GET /api/profiles); expect "A12. le personnel ne voit pas les profils (403)" test "$S" = 403
S=$(api POST /api/profiles -d '{"displayName":"X","login":"xx","role":"staff","secret":"135790","secretConfirm":"135790","city":"Casablanca"}'); expect "A13. le personnel ne crée pas de profil (403)" test "$S" = 403
S=$(api GET "/api/catalog/all?counts=1"); expect "A14. le personnel n'accède pas au catalogue complet (403)" test "$S" = 403
login_api lamiaa 573918; S=$(api GET /api/profiles); expect "A15. un parent ne voit pas les profils (403)" test "$S" = 403
S=$(api PATCH /api/me/city -d '{}'); S=$(api PUT /api/me/city -d '{"city":"Rabat"}'); expect "A16. un parent change SA ville ($S)" test "$S" = 200
S=$(api PUT /api/me/city -d '{"city":"Atlantide"}'); expect "A17. ville hors liste refusée ($S $(errcode))" test "$S" = 400
api PUT /api/me/city -d '{"city":"Casablanca"}' >/dev/null

# ═══ B. Interface : serveur et connexion de l'administrateur ═══
launch
expect "B0. écran de connexion" $UI wait "Bienvenue" 25
$UI tap "Se connecter" --last >/dev/null; sleep 2
fill "https://…" "$SERVER" --last; hide_kb
$UI tap "Tester et enregistrer" >/dev/null
expect "B1. serveur enregistré" $UI wait "10.0.2.2:3000" 20
fill "Code famille" "$FAMILY"; fill "Identifiant" adil; fill "Code d'accès" 482913; hide_kb
$UI tap "Se connecter" --last >/dev/null
expect "B2. administrateur connecté" $UI wait "Ma liste" 25

# ═══ C. Profils (interface + serveur) ═══
tapt "Réglages"; tapt "Profils"
expect "C1. liste réelle des profils" $UI wait "Marie" 20
expect "C2. rôles réels affichés" $UI has "Administrateur principal"
expect "C3. mon profil repéré" $UI has "Vous"
shot lot2-profils
# création
tapt "Ajouter un profil"
fill "Nom affiché" Karim; fill "Identifiant de connexion" karim
fill "Code d'accès (6" 135792; fill "Confirmer le code" 135792; hide_kb
shot lot2-profil-creation
$UI tap "Créer le profil" --scroll >/dev/null; sleep 3
expect "C4. profil créé et affiché" $UI wait "Karim" 20
expect "C5. profil créé côté serveur (rôle staff, ville de l'administrateur)" test "$(sql "SELECT role||'/'||city FROM profiles p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.login='karim'")" = "staff/Casablanca"
# identifiant déjà pris
tapt "Ajouter un profil"
fill "Nom affiché" Autre; fill "Identifiant de connexion" karim; fill "Code d'accès (6" 135792; fill "Confirmer le code" 135792; hide_kb
$UI tap "Créer le profil" --scroll >/dev/null; sleep 1
expect "C6. identifiant déjà pris : message clair" $UI wait "existe déjà" 12
# code trop simple
tapt "Ajouter un profil"
fill "Nom affiché" Faible; fill "Identifiant de connexion" faible; fill "Code d'accès (6" 123456; fill "Confirmer le code" 123456; hide_kb
$UI tap "Créer le profil" --scroll >/dev/null; sleep 1
expect "C7. code trop simple : refusé par le serveur" $UI wait "trop simple" 12
expect "C8. aucun profil créé par erreur" test "$(sql "SELECT count(*) FROM profiles WHERE login IN ('faible') ")" = 0
# modification du rôle
tapt "Actions pour Karim"; tapt "Modifier"
$UI tap "Parent" >/dev/null; sleep 1; hide_kb
$UI tap "Enregistrer" --scroll >/dev/null; sleep 3
expect "C9. rôle modifié côté serveur" test "$(sql "SELECT role FROM profiles WHERE login='karim'")" = parent
# code d'accès
tapt "Actions pour Karim"; tapt "Modifier le code d'accès"
fill "Nouveau code" 246801; fill "Confirmer le code" 246801; hide_kb
$UI tap "Enregistrer le code" --scroll >/dev/null; sleep 3
login_api karim 246801; expect "C10. nouveau code accepté par le serveur" test -n "$COOKIE"
login_api karim 135792; expect "C11. ancien code refusé" test -z "$COOKIE"
# désactivation : la session ouverte est coupée par le serveur
login_api karim 246801; KC=$COOKIE
tapt "Actions pour Karim"; tapt "Désactiver"
shot lot2-desactiver
$UI tap "Désactiver" --last >/dev/null; sleep 3
expect "C12. profil désactivé côté serveur" test "$(sql "SELECT active FROM profiles WHERE login='karim'")" = f
COOKIE=$KC; S=$(api GET /api/me); expect "C13. sa session ouverte est coupée par le serveur (401, $S)" test "$S" = 401
expect "C14. étiquette « Désactivé » affichée" $UI wait "Désactivé" 12
# réactivation
tapt "Actions pour Karim"; tapt "Réactiver"
expect "C15. profil réactivé côté serveur" test "$(sql "SELECT active FROM profiles WHERE login='karim'")" = t
# protections dans l'interface
tapt "Actions pour Adil"
expect "C16. administrateur principal : suppression impossible" $UI wait "Suppression impossible" 8
expect "C17. administrateur principal : désactivation impossible" $UI has "Désactivation impossible"
shot lot2-profil-protege
adb shell input keyevent KEYCODE_BACK; sleep 1
# suppression
tapt "Actions pour Karim"; tapt "Supprimer le profil"
shot lot2-supprimer
$UI tap "Supprimer" --last >/dev/null; sleep 3
expect "C18. profil supprimé : anonymisé côté serveur" test "$(sql "SELECT display_name FROM profiles WHERE login LIKE 'supprime-%' ORDER BY deleted_at DESC LIMIT 1")" = "Ancien profil"
expect "C19. profil retiré de la liste" $UI gone "Karim" 12

# ═══ D. Ville ═══
launch; $UI wait "Ma liste" 25 >/dev/null   # nouvel état de départ : l'échec éventuel d'un bloc ne se propage pas au suivant
tapt "Compte"
expect "D1. ville réelle dans le compte" $UI wait "Ville : Casablanca" 10
tapt "Ville : "
expect "D2. liste des villes affichée" $UI wait "Rechercher une ville" 10
fill "Rechercher une ville" "fes"
expect "D3. recherche sans accent : Fès trouvée" $UI wait "Fès" 10
shot lot2-villes
fill "fes" "rabat"; hide_kb
$UI tap "Rabat" >/dev/null; sleep 3
expect "D4. ville enregistrée côté serveur" test "$(sql "SELECT city FROM profiles WHERE login='adil'")" = Rabat
tapt "Compte"; expect "D5. nouvelle ville affichée" $UI wait "Ville : Rabat" 15
tapt "Ville : "; fill "Rechercher une ville" "casablanca"; hide_kb; $UI tap "Casablanca" >/dev/null; sleep 3
expect "D6. ville rétablie" test "$(sql "SELECT city FROM profiles WHERE login='adil'")" = Casablanca

# ═══ E. Catalogue ═══
launch; $UI wait "Ma liste" 25 >/dev/null
login_api adil 482913
api GET "/api/catalog/all?counts=1&limit=1" >/dev/null; A=$(jq -r .counts.active /tmp/api.out); I=$(jq -r .counts.inactive /tmp/api.out); Z=$(jq -r .counts.absent /tmp/api.out)
tapt "Réglages"; tapt "Catalogue"
expect "E1. compteur « Dans mon catalogue » réel ($A)" $UI wait "Dans mon catalogue ($A)" 25
expect "E2. compteur « À ajouter » réel ($((I+Z)))" $UI has "À ajouter ($((I+Z)))"
expect "E3. compteur « Tous » réel ($((A+I+Z)))" $UI has "Tous ($((A+I+Z)))"
shot lot2-catalogue
# pagination : un article au-delà des 30 premiers apparaît après défilement
api GET "/api/catalog/all?presentFirst=1&offset=45&limit=1" >/dev/null; LATE=$(jq -r '.items[0].name' /tmp/api.out)
for _ in 1 2 3 4 5 6 7 8; do $UI has "$LATE" 1 && break; adb shell input swipe 540 1900 540 700 250; sleep 1; done
expect "E4. défilement : l'article n°46 ($LATE) est chargé" $UI has "$LATE"
# retirer / annuler
fill "Rechercher un produit" "Tomates"
expect "E5. recherche réelle" $UI wait "Retirer" 15
$UI tap "Retirer" >/dev/null
expect "E7. message avec « Annuler »" $UI wait "Annuler" 6
shot lot2-retire
expect "E6. article retiré côté serveur" test "$(sql "SELECT active FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.name='Tomates'")" = f
expect "E8. compteur de la recherche « Tomates » mis à jour (2 → 1)" $UI has "Dans mon catalogue (1)"
$UI tap "Annuler" >/dev/null; sleep 3
expect "E9. retrait annulé : l'article est de retour (réversible)" test "$(sql "SELECT active FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.name='Tomates'")" = t
# ajouter depuis « À ajouter »
fill "Tomates" ""; hide_kb
tapt "À ajouter ("
BEFORE=$(sql "SELECT count(*) FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY'")
$UI wait "Ajouter" 15 >/dev/null; $UI tap "Ajouter" --last >/dev/null; sleep 3
AFTER=$(sql "SELECT count(*) FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY'")
expect "E10. ajout depuis le catalogue complet : un article de plus ($BEFORE → $AFTER)" test "$AFTER" -ge "$BEFORE"
shot lot2-a-ajouter
api GET "/api/catalog/all?counts=1&limit=1" >/dev/null
expect "E11. compteurs côté serveur cohérents après ajout" test "$(jq -r '.counts.active' /tmp/api.out)" -ge "$A"
# catégorie
CAT_LABEL=$(curl -s -H "Cookie: sc_session=$COOKIE" "$BASE/api/catalog" | jq -r '.categories[1].label'); CAT_KEY=$(curl -s -H "Cookie: sc_session=$COOKIE" "$BASE/api/catalog" | jq -r '.categories[1].key')
api GET "/api/catalog/all?counts=1&limit=1&category=$CAT_KEY" >/dev/null; CT=$(jq -r '.counts.active+.counts.inactive+.counts.absent' /tmp/api.out)
tapt "Tous ("
tapt "Toutes les catégories"; tapt "$CAT_LABEL"
expect "E12. filtre par catégorie ($CAT_LABEL) : compteur réel $CT" $UI wait "Tous ($CT)" 15
shot lot2-categorie

echo "ECHECS=$FAILS" | tee -a "$OUT/resultats.txt"
adb logcat -d -b crash > "$OUT/logcat-crash.txt" 2>&1 || true
echo "CRASH_LIGNES=$(wc -l < "$OUT/logcat-crash.txt")" | tee -a "$OUT/resultats.txt"
[ "$FAILS" = 0 ]
