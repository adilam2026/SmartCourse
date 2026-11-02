#!/usr/bin/env bash
# Étape 1 iPhone — côté ANDROID du contrôle de synchronisation (émulateur, serveur de recette LOCAL et jetable).
# L'administrateur (adil) est connecté sur l'application Android, écran « Liste ». L'iPhone (simulateur, autre machine, même serveur
# par le tunnel) ajoute un produit en tant que personnel (marie). Contrôles : le serveur reçoit l'ajout de marie une seule fois, puis
# l'application Android l'affiche d'elle-même (flux en direct), sans action ni relance.
# Usage : ios-sync-android.sh APK CODE_FAMILLE SORTIE PRODUIT ATTENTE_MINUTES
set -uo pipefail
source <(sed -n '/^PKG=/,/^adb shell pm grant/p' "$(dirname "$0")/native-e2e-lot3.sh")
PRODUCT=${4:-Oignons}; WAIT_MIN=${5:-45}

launch
expect "A0. Android : écran de connexion" $UI wait "Bienvenue" 25
$UI tap "Se connecter" --last >/dev/null; sleep 2
fill "https://…" "$SERVER" --last; hide_kb
$UI tap "Tester et enregistrer" >/dev/null
$UI wait "10.0.2.2:3000" 20 >/dev/null
signin "$FAMILY" adil 482913
expect "A1. Android : administrateur connecté, liste vide" $UI wait "La liste est vide" 25
shot android-1-liste-vide
touch "$OUT/android-pret"

# Ajout fait par l'iPhone : attendu sur le serveur (ajouté par marie, dans la liste en cours de la famille)
added() { sql "SELECT count(*) FROM list_items i JOIN products p ON p.id=i.product_id JOIN lists l ON l.id=i.list_id JOIN families f ON f.id=l.family_id
  JOIN profiles pr ON pr.id=i.added_by WHERE f.code='$FAMILY' AND l.status='active' AND p.name='$PRODUCT' AND pr.login='marie' AND i.status<>'removed'"; }
n=0; for _ in $(seq 1 $((WAIT_MIN * 6))); do n=$(added); [ "${n:-0}" -ge 1 ] && break; sleep 10; done
expect "A2. serveur : « $PRODUCT » ajouté depuis l'iPhone par marie, une seule fois ($n)" test "${n:-0}" = 1
# L'écran Android n'est pas touché : la mise à jour doit arriver seule
expect "A3. Android : « $PRODUCT » apparaît tout seul dans la liste de l'administrateur" $UI wait "$PRODUCT" 30
shot android-2-ajout-iphone-recu
echo "Échecs Android : $FAILS" | tee -a "$OUT/resultats.txt"
exit $FAILS
