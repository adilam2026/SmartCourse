#!/usr/bin/env bash
# Contrôle croisé Android ↔ iPhone — côté ANDROID (émulateur). Un seul service : même serveur de recette (local et jetable), même base,
# mêmes comptes et même famille pour les deux appareils ; aucune donnée propre à une plateforme, aucun compte recréé, rien d'importé.
# L'iPhone (simulateur, autre machine) joint ce même serveur par le tunnel. Les deux appareils s'attendent par l'état du serveur.
#   Sens 1 — liste créée sur ANDROID, modifiée sur l'iPhone :
#     A1 Android (adil) crée la liste avec « Tomates » ; l'iPhone (marie) la voit seul, ajoute « Oignons » ;
#     A3 Android voit « Oignons » apparaître seul.
#   Sens 2 — liste créée sur l'IPHONE, modifiée sur Android :
#     la liste du sens 1 est clôturée ; l'iPhone (adil) crée une liste avec « Carottes » ; B2 Android la voit apparaître seule,
#     ajoute « Bananes » ; l'iPhone voit « Bananes » apparaître seul (contrôlé côté iPhone).
# Usage : ios-sync-android.sh APK CODE_FAMILLE SORTIE ATTENTE_MINUTES
set -uo pipefail
source <(sed -n '/^PKG=/,/^adb shell pm grant/p' "$(dirname "$0")/native-e2e-lot3.sh")
WAIT_MIN=${4:-50}
closeall_api() { api GET /api/lists/open >/dev/null; for l in $(jq -r '.lists[]?.id' /tmp/api.out); do api POST "/api/lists/$l/close" -d '{}' >/dev/null; done
  api GET /api/lists/active >/dev/null; local l; l=$(jq -r '.list.id // empty' /tmp/api.out); [ -n "$l" ] && api POST "/api/lists/$l/close" -d '{}' >/dev/null; true; }
# Article de la liste en cours de la famille, ajouté par [login] (vide = quelqu'un)
in_active() { sql "SELECT count(*) FROM list_items i JOIN products p ON p.id=i.product_id JOIN lists l ON l.id=i.list_id JOIN families f ON f.id=l.family_id
  JOIN profiles pr ON pr.id=i.added_by WHERE f.code='$FAMILY' AND l.status='active' AND p.name='$1' AND i.status<>'removed' ${2:+AND pr.login='$2'}"; }
active_id() { sql "SELECT l.id FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active' ORDER BY l.created_at DESC LIMIT 1"; }
wait_sql() { local q=$1 n=0; for _ in $(seq 1 $((WAIT_MIN * 6))); do n=$(eval "$q"); [ "${n:-0}" -ge 1 ] && return 0; sleep 10; done; return 1; }
add_from_selection() { # Android : « Ajouter des articles » / « Créer une liste » → recherche → article → « Terminer ma sélection »
  fill "Rechercher un produit" "$1"; hide_kb; $UI wait "$1" 10 >/dev/null; $UI tap "$1" --last >/dev/null; sleep 2
  $UI tap "Terminer ma sélection" >/dev/null; sleep 4; }

login_api adil 482913
closeall_api
launch
expect "A0. Android : écran de connexion" $UI wait "Bienvenue" 25
$UI tap "Se connecter" --last >/dev/null; sleep 2
fill "https://…" "$SERVER" --last; hide_kb
$UI tap "Tester et enregistrer" >/dev/null
$UI wait "10.0.2.2:3000" 20 >/dev/null
signin "$FAMILY" adil 482913
expect "A0b. Android : administrateur connecté, aucune liste en cours" $UI wait "Créer une liste" 25

echo "═══ Sens 1 : liste créée sur Android, modifiée sur l'iPhone ═══" | tee -a "$OUT/resultats.txt"
tapt "Créer une liste"; $UI wait "Rechercher un produit" 15 >/dev/null
add_from_selection "Tomates"
LIST1=$(active_id)
expect "A1. Android : liste créée avec « Tomates » (serveur : liste $LIST1 créée par adil)" bash -c "[ -n '$LIST1' ] && [ \"\$(docker exec sc-recette-pg psql -U smart -d smartcourse -tAc \"SELECT p.login FROM lists l JOIN profiles p ON p.id=l.created_by WHERE l.id='$LIST1'\")\" = adil ]"
expect "A1b. Android : « Tomates » dans la liste" $UI wait "Tomates" 20
shot sens1-android-liste-creee
wait_sql "in_active Oignons marie" || true
expect "A2. serveur : « Oignons » ajouté depuis l'iPhone par marie dans la MÊME liste" test "$(sql "SELECT count(*) FROM list_items i JOIN products p ON p.id=i.product_id JOIN profiles pr ON pr.id=i.added_by WHERE i.list_id='$LIST1' AND p.name='Oignons' AND pr.login='marie' AND i.status<>'removed'")" = 1
expect "A3. Android : « Oignons » apparaît seul dans la liste (sans action)" $UI wait "Oignons" 30
shot sens1-android-modif-iphone-recue

echo "═══ Sens 2 : liste créée sur l'iPhone, modifiée sur Android ═══" | tee -a "$OUT/resultats.txt"
closeall_api   # fin du sens 1 : la liste est clôturée sur le serveur commun
expect "B0. Android : liste clôturée, « Créer une liste » affiché seul" $UI wait "Créer une liste" 30
wait_sql "in_active Carottes" || true
LIST2=$(active_id)
expect "B1. serveur : nouvelle liste créée depuis l'iPhone avec « Carottes » ($LIST2, différente de $LIST1)" bash -c "[ -n '$LIST2' ] && [ '$LIST2' != '$LIST1' ]"
expect "B2. Android : la liste créée sur l'iPhone apparaît seule, avec « Carottes »" $UI wait "Carottes" 40
shot sens2-android-liste-iphone-recue
tapt "Ajouter des articles"; $UI wait "Rechercher un produit" 15 >/dev/null
add_from_selection "Bananes"
expect "B3. serveur : « Bananes » ajouté depuis Android dans la liste créée sur l'iPhone" test "$(sql "SELECT count(*) FROM list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id='$LIST2' AND p.name='Bananes' AND i.status<>'removed'")" = 1
shot sens2-android-modif-envoyee
echo "Échecs Android : $FAILS" | tee -a "$OUT/resultats.txt"
exit $FAILS
