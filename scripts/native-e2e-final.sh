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

# Recette : toutes les listes en cours de la famille clôturées par l'API (départ propre d'une section).
closeall_api() { api GET /api/lists/open >/dev/null; for l in $(jq -r '.lists[]?.id' /tmp/api.out); do api POST "/api/lists/$l/close" -d '{}' >/dev/null; done
  api GET /api/lists/active >/dev/null; local l; l=$(jq -r '.list.id // empty' /tmp/api.out); [ -n "$l" ] && api POST "/api/lists/$l/close" -d '{}' >/dev/null; true; }
pid_of() { sql "SELECT p.id FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.name='$1'"; }
add_api() { api POST "${3:-/api/lists/active/ops}" -d "{\"ops\":[{\"opId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"type\":\"add\",\"productId\":\"$(pid_of "$1")\",\"quantity\":$2}]}" >/dev/null; }

# Saisie : « adb shell input text » coupe au premier espace ; les espaces sont donc transmis en %s (« Famille Benali » entier).
fill() { $UI tap "$1" ${3:-} >/dev/null || return 1; sleep 1; clear_field; adb shell input text "${2// /%s}"; sleep 1; }
# Sections à jouer (variable SECTIONS, ex. « C » ou « C,G ») ; vide = toutes. Chaque section part de l'écran de connexion.
want_s() { [ -z "${SECTIONS:-}" ] || [[ ",${SECTIONS// /}," == *",$1,"* ]]; }
# Saisies VÉRIFIÉES : chaque fill() doit réussir et le champ doit afficher la valeur tapée. Le code d'accès est contrôlé en clair avec
# « Afficher le code » (recette jetable uniquement) puis remasqué avant toute capture. Un champ déjà rempli (essai refusé) est
# retrouvé par son contenu masqué.
T_ERR=""
tf_text() { fill "$1" "$2" || { T_ERR="champ « $1 » introuvable"; return 1; }; hide_kb; $UI has "$2" || { T_ERR="« $2 » absent après saisie"; return 1; }; }
tf_secret() {
  local target="Code d'accès"; $UI has "Code d'accès" || target="•"
  fill "$target" "$1" || { T_ERR="champ du code introuvable ($target)"; return 1; }; hide_kb
  $UI tap "Afficher le code" >/dev/null || { T_ERR="bouton « Afficher le code » introuvable"; return 1; }; sleep 1
  local r=0; $UI has "$1" || { r=1; T_ERR="code affiché différent de la saisie"; }
  $UI tap "Masquer le code" >/dev/null; sleep 1; $UI has "$1" && { T_ERR="code resté visible"; r=1; }
  return $r
}
# Champs de connexion retrouvés par leur position (identifiant famille, identifiant personnel, code), quel que soit leur contenu
# (le téléphone retient la famille : son identifiant s'il est choisi, sinon le code famille).
fill_field() { $UI field "$1" >/dev/null || return 1; sleep 1; clear_field; adb shell input text "${2// /%s}"; sleep 1; }
tf_field() { fill_field "$1" "$2" || { T_ERR="champ n°$1 introuvable"; return 1; }; hide_kb; $UI has "$2" || { T_ERR="« $2 » absent après saisie"; return 1; }; }
tf_login() { # $1 famille (identifiant ou code), $2 identifiant personnel, $3 code : formulaire rempli et vérifié, puis envoyé
  tf_field 0 "$1" || return 1; PREV_FAMILY="$1"
  tf_field 1 "$2" || return 1; PREV_LOGIN="$2"
  tf_secret "$3" || return 1
  $UI tap "Se connecter" --last >/dev/null; sleep 4
}
signin() { fill_field 0 "$1"; hide_kb; fill_field 1 "$2"; hide_kb; fill_field 2 "$3"; hide_kb; $UI tap "Se connecter" --last >/dev/null; sleep 3; PREV_FAMILY="$1"; PREV_LOGIN="$2"; }
if want_s F; then
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

fi
want_s F || { launch; $UI wait "Bienvenue" 25 >/dev/null; }   # section F sautée : écran de connexion quand même
if want_s C; then
echo "═══ C. Première connexion → Créer ma famille (autonome : sans lien, jeton ni serveur) ═══" | tee -a "$OUT/resultats.txt"
NEWMAIL="famille.$(date +%s)@example.org"; NEWLOGIN="karim"
mails() { docker exec sc-recette-app node -e "fetch('http://127.0.0.1:3199/__sent?to=$NEWMAIL').then(r=>r.json()).then(j=>console.log(j.length))"; }
lastcode() { docker exec sc-recette-app node -e "fetch('http://127.0.0.1:3199/__sent?to=$NEWMAIL').then(r=>r.json()).then(j=>console.log((j.at(-1)||{subject:''}).subject.match(/(\d{6})/)?.[1]||''))"; }
FAM_BEFORE=$(sql "SELECT count(*) FROM families")
$UI tap "Première connexion" >/dev/null; sleep 1; $UI tap "Créer ma famille" >/dev/null; sleep 2
expect "C1. formulaire direct (aucun lien, jeton ni serveur)" bash -c "$UI wait 'Nom affiché de la famille' 10 && ! $UI has 'jeton' && ! $UI has 'installé le serveur' && ! $UI has 'Serveur'"
fill "Nom affiché de la famille" "Famille Benali" --scroll; hide_kb
NEWID=FamilleBenali
expect "C1a. identifiant famille proposé d'après le nom et disponible ($NEWID)" bash -c "$UI wait '$NEWID' 8 && $UI wait 'Disponible' 10"
fill "Votre prénom" "Karim" --scroll; hide_kb
fill "Identifiant personnel" "$NEWLOGIN" --scroll; hide_kb
# Ville choisie sans ambiguïté (la liste contient « Casablanca » et « Casablanca Anfa ») : la valeur attendue en base est exactement celle-ci.
NEWCITY="Casablanca Anfa"
$UI tap "Pays : " --scroll >/dev/null; sleep 2; fill "Rechercher un pays" "maroc"; hide_kb; $UI tap "Maroc" --last >/dev/null; sleep 2
$UI tap "Ville : " --scroll >/dev/null; sleep 2; fill "Rechercher une ville" "anfa"; hide_kb; $UI tap "$NEWCITY" --last >/dev/null; sleep 2
expect "C1b. ville choisie affichée dans le formulaire" $UI has "Ville : $NEWCITY"
fill "E-mail de récupération" "$NEWMAIL" --scroll; hide_kb
fill "Code d'accès" 274915 --scroll; hide_kb
fill "Confirmez le code" 274915 --scroll; hide_kb
shot final-c1-formulaire
expect "C2. bouton « Recevoir le code par e-mail » activé" $UI enabled "Recevoir le code par e-mail"
read -r X1 Y1 X2 Y2 <<<"$($UI bounds 'Recevoir le code par e-mail')"; X=$(( (X1+X2)/2 )); Y=$(( (Y1+Y2)/2 ))
adb shell "input tap $X $Y; input tap $X $Y"; sleep 5   # double appui très rapproché
expect "C3. écran du code (adresse masquée)" $UI wait "Vérifiez votre adresse" 15
expect "C3b. double appui : un seul e-mail envoyé ($(mails))" test "$(mails)" = 1
expect "C3c. double appui : une seule demande enregistrée" test "$(sql "SELECT count(*) FROM family_signups WHERE email='$NEWMAIL'")" = 1
expect "C3d. rien n'est créé avant la vérification" test "$(sql "SELECT count(*) FROM families")" = "$FAM_BEFORE"
shot final-c2-code
# Le libellé du champ disparaît dès qu'il est rempli : on le retrouve ensuite par son contenu courant ($CUR).
WRONG=000000; [ "$(lastcode)" = 000000 ] && WRONG=111111
fill "Code reçu par e-mail" "$WRONG"; hide_kb; CUR=$WRONG
$UI tap "Créer ma famille" --last >/dev/null; sleep 3
expect "C4. code faux refusé avec un message clair" $UI wait "Code incorrect" 10
# Code expiré (30 minutes) : nouveau code SANS ressaisir les informations
sql "UPDATE family_signups SET expires_at = now() - interval '1 minute', last_sent_at = now() - interval '31 minutes' WHERE email='$NEWMAIL'" >/dev/null
C1CODE=$(lastcode); fill "$CUR" "$C1CODE"; hide_kb; CUR=$C1CODE
$UI tap "Créer ma famille" --last >/dev/null; sleep 3
expect "C4b. code expiré : message clair, proposition d'un nouveau code" bash -c "$UI wait 'Ce code a expiré' 10 && $UI has 'Recevoir un nouveau code' && ! $UI has 'Nom de la famille'"
shot final-c2b-code-expire
for _ in $(seq 1 40); do $UI enabled "Recevoir un nouveau code" && break; sleep 2; done
$UI tap "Recevoir un nouveau code" >/dev/null; sleep 5
expect "C4c. nouveau code envoyé ($(mails) e-mails au total)" test "$(mails)" = 2
fill "Code reçu par e-mail" "$(lastcode)"; hide_kb   # champ vidé par le renvoi : libellé de nouveau visible
$UI tap "Créer ma famille" --last >/dev/null; sleep 6
expect "C5. famille créée et utilisateur connecté : identifiant famille affiché" $UI wait "Votre famille est créée" 20
NEWCODE=$(sql "SELECT f.code FROM families f JOIN profiles p ON p.family_id=f.id WHERE p.recovery_email='$NEWMAIL'")
NEWALIAS=$(sql "SELECT a.alias FROM family_aliases a JOIN families f ON f.id=a.family_id WHERE f.code='${NEWCODE:-X}' AND a.kind='current'")
expect "C5b. identifiant famille ($NEWID) affiché à l'écran et enregistré pour la famille (« $NEWALIAS »)" bash -c "$UI has 'Identifiant famille' && $UI has '$NEWID' && test '$NEWALIAS' = '$NEWID'"
NBF=$(sql "SELECT count(*) FROM families"); PROF=$(sql "SELECT p.is_primary::text||' '||(p.recovery_email_verified_at IS NOT NULL)::text||' '||p.city||' '||p.login FROM profiles p WHERE p.recovery_email='$NEWMAIL'")
expect "C5c. serveur : une seule famille créée ($FAM_BEFORE → $NBF)" test "$NBF" = "$((FAM_BEFORE + 1))"
expect "C5d. serveur : administrateur principal, adresse vérifiée, ville, identifiant (attendu « true true $NEWCITY $NEWLOGIN », obtenu « $PROF »)" test "$PROF" = "true true $NEWCITY $NEWLOGIN"
shot final-c3-famille-creee
$UI tap "Copier" >/dev/null
expect "C6. Copier : confirmation visible dans le panneau" $UI wait "Identifiant famille copié" 8
$UI tap "Partager" >/dev/null; sleep 3
expect "C7. Partager : fenêtre de partage Android" bash -c "adb shell dumpsys activity activities | grep -qE 'ChooserActivity|ResolverActivity'"
adb shell input keyevent KEYCODE_BACK; sleep 2
$UI tap "Préparer mes courses" >/dev/null; sleep 3
expect "C8. « Préparer mes courses » ouvre la sélection des articles" $UI wait "Rechercher un produit" 15
shot final-c4-preparer
login_api adil 482913
S=$(curl -s -o /tmp/api.out -w '%{http_code}' -X POST "$BASE/api/signup/start" -H 'content-type: application/json' -d "{\"requestId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"familyName\":\"Doublon\",\"displayName\":\"K\",\"login\":\"k2\",\"city\":\"Casablanca\",\"email\":\"$NEWMAIL\",\"secret\":\"274915\",\"secretConfirm\":\"274915\"}")
expect "C9. doublon : la même adresse ne crée pas une seconde famille ($S $(jq -r .error /tmp/api.out))" test "$S" = 409 -a "$(jq -r .error /tmp/api.out)" = email_in_use
logout
# Après déconnexion, le formulaire est déjà rempli avec l'identifiant famille et l'identifiant du dernier profil : seul le code d'accès est saisi.
expect "C10. formulaire de connexion prérempli avec l'identifiant famille ($NEWID)" bash -c "$UI has '$NEWID' && $UI has '$NEWLOGIN'"
fill "Code d'accès" 274915; hide_kb
$UI tap "Se connecter" --last >/dev/null; sleep 4; PREV_FAMILY="$NEWID"; PREV_LOGIN="$NEWLOGIN"
expect "C10b. connecté à la nouvelle famille avec ses accès" $UI wait "Ma liste" 20
logout
# Plafond quotidien (100 familles par défaut) atteint : base de recette JETABLE remplie de 100 créations fictives du jour
sql "INSERT INTO family_signups (request_id, email, email_hash, family_name, display_name, login, city, secret_hash, code_hash, expires_at, completed_at)
     SELECT gen_random_uuid(), 'plafond'||g||'@example.org', md5('plafond'||g), 'P', 'P', 'p', 'Casablanca', 'x', 'x', now(), now() FROM generate_series(1, 100) g" >/dev/null
CAPMAIL="plafond.$(date +%s)@example.org"
$UI tap "Première connexion" >/dev/null; sleep 1; $UI tap "Créer ma famille" >/dev/null; sleep 2
fill "Nom affiché de la famille" "Famille Plafond" --scroll; hide_kb; fill "Votre prénom" "Nadia" --scroll; hide_kb; fill "Identifiant personnel" "nadia" --scroll; hide_kb
$UI tap "Pays : " --scroll >/dev/null; sleep 2; fill "Rechercher un pays" "maroc"; hide_kb; $UI tap "Maroc" --last >/dev/null; sleep 2
$UI tap "Ville : " --scroll >/dev/null; sleep 2; fill "Rechercher une ville" "rabat"; hide_kb; $UI tap "Rabat" --last >/dev/null; sleep 2
fill "E-mail de récupération" "$CAPMAIL" --scroll; hide_kb; fill "Code d'accès" 583014 --scroll; hide_kb; fill "Confirmez le code" 583014 --scroll; hide_kb
$UI tap "Recevoir le code par e-mail" --scroll >/dev/null; sleep 4
expect "C11. plafond atteint : « limite temporaire de créations », aucun code envoyé" bash -c "$UI wait 'La limite temporaire de créations est atteinte' 10 && [ \"\$(docker exec sc-recette-app node -e \"fetch('http://127.0.0.1:3199/__sent?to=$CAPMAIL').then(r=>r.json()).then(j=>console.log(j.length))\")\" = 0 ]"
shot final-c5-plafond
sql "DELETE FROM family_signups WHERE email LIKE 'plafond%@example.org'" >/dev/null
# Quota Brevo atteint (refus HTTP 402 simulé par le faux service d'envoi) : échec clair, jamais « code envoyé »
docker exec sc-recette-app node -e "fetch('http://127.0.0.1:3199/__fail?on=1&status=402&code=quota_exceeded&msg=quota',{method:'POST'})" >/dev/null
$UI tap "Recevoir le code par e-mail" --scroll >/dev/null; sleep 5
expect "C12. quota d'envoi atteint : message d'échec, pas d'écran « code envoyé »" bash -c "$UI wait \"L'e-mail n'a pas pu être envoyé\" 10 && ! $UI has 'Vérifiez votre adresse' && ! $UI has 'a été envoyé'"
shot final-c6-envoi-echoue
docker exec sc-recette-app node -e "fetch('http://127.0.0.1:3199/__fail?on=0',{method:'POST'})" >/dev/null
$UI tap "Se connecter" --first >/dev/null; sleep 1

fi
if want_s G; then
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
adb shell input swipe 540 600 540 1700 300; sleep 1   # retour en haut : « Compte » est dans l'en-tête
tapt "Compte"
expect "G7. Compte : profil réel, sans serveur ni démonstration" bash -c "$UI wait 'Administrateur' 8 && ! $UI has 'Écrans de démo' && ! $UI has 'Serveur :'"
shot final-07-compte
adb shell input keyevent KEYCODE_BACK; sleep 1
logout
expect "G8. déconnecté : retour à la connexion" $UI wait "Bienvenue" 15

fi
if want_s H; then
echo "═══ H. Parent : rôle ═══" | tee -a "$OUT/resultats.txt"
signin "$FAMILY" lamiaa 573918
expect "H1. parent connecté" $UI wait "Ma liste" 25
expect "H2. parent : pas d'onglet Réglages" $UI gone "Réglages" 3
expect "H3. parent : Historique accessible" $UI has "Historique"
shot final-08-parent
logout

fi
# Personnel : depuis les évolutions du 15/10 (affichage « Cartes, par catégories » par défaut, recherche pour le personnel), les
# articles ne sont nommés qu'en affichage Liste. Le parcours passe donc d'abord en « Liste, tous les articles » (préférence du profil).
staff_list_view() { $UI tap "Affichage" >/dev/null; sleep 2; $UI tap "Liste" >/dev/null; sleep 1; $UI tap "Tous les articles" >/dev/null; sleep 1; $UI tap "Fermer" --last >/dev/null; sleep 2; }
if want_s P; then
echo "═══ P. Personnel : Choisir mes articles, enregistrement, hors connexion ═══" | tee -a "$OUT/resultats.txt"
signin "$FAMILY" marie 573918
expect "P1. personnel : « Choisir mes articles » directement" $UI wait "Choisir mes articles" 25
expect "P1b. aucun onglet en bas" $UI gone "Liste du jour" 3
expect "P1c. recherche disponible pour le personnel (évolution validée du 15/10)" $UI has "Rechercher un produit"
expect "P1d. aucun bandeau" nodemo
expect "P1e. Compte dans l'en-tête" $UI has "Compte"
shot final-09-personnel
staff_list_view
expect "P1f. affichage « Liste, tous les articles »" $UI has "Affichage : Liste, tous les articles"
show "Tomates"; $UI tap "Tomates" >/dev/null; sleep 2
$UI tap "Terminer ma sélection" >/dev/null
expect "P2. « Sélection enregistrée »" $UI wait "Sélection enregistrée" 10
expect "P2b. reste sur Choisir" $UI has "Choisir mes articles"
expect "P2c. serveur : liste du jour créée par la demande ($(st Tomates))" test "$(st Tomates)" = "1.000 kg to_buy"
expect "P2d. quantité enregistrée affichée" $UI wait "Dans la liste · 1 kg" 10
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

fi
if want_s J; then
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
staff_list_view
show "Tomates"; $UI tap "Tomates" >/dev/null; sleep 2
$UI tap "Terminer ma sélection" >/dev/null; sleep 4
expect "J1. sélection enregistrée sur la liste ouverte ($(items_of $LJ))" test "$(items_of $LJ)" = "Tomates 1.000 to_buy"
# Minuit : 23:59:20 du jour courant du téléphone, puis passage au lendemain, application ouverte
D0=$(adb shell date +%Y-%m-%d | tr -d '\r'); setclock "$(date -u -d "$D0 23:59:20" +%s)"; sleep 75
D1=$(adb shell date +%Y-%m-%d | tr -d '\r')
expect "J2. l'horloge du téléphone est passée minuit ($D0 → $D1)" test "$D1" != "$D0"
expect "J2b. après minuit, application ouverte : sélection toujours affichée (Dans la liste · 1 kg)" $UI wait "Dans la liste · 1 kg" 15
launch
expect "J2c. après minuit, application relancée : toujours sur Choisir, sélection conservée" bash -c "$UI wait 'Choisir mes articles' 20 && $UI wait 'Dans la liste · 1 kg' 15"
expect "J2d. serveur : même liste, toujours ouverte" test "$(sql "SELECT status FROM lists WHERE id='$LJ'")" = active
shot final-12-apres-minuit
# Liste ouverte plusieurs jours : créée il y a 3 jours côté serveur, téléphone 3 jours plus tard
sql "UPDATE lists SET created_at = now() - interval '3 days' WHERE id='$LJ'" >/dev/null
setclock $(( $(devnow) + 3*86400 )); sleep 3
launch
expect "J3. trois jours plus tard : sélection et quantité conservées" bash -c "$UI wait 'Choisir mes articles' 20 && $UI wait 'Dans la liste · 1 kg' 15"
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

fi
# ─── Outils des sections K, S, A ───
ime_type() { adb shell dumpsys input_method | grep -m1 -oE "inputType=0x[0-9a-f]+" | cut -d= -f2; }   # 0x12 = chiffres masqués
screen_grep() { adb shell uiautomator dump /sdcard/sg.xml >/dev/null 2>&1; adb exec-out cat /sdcard/sg.xml 2>/dev/null | grep -oE "$1" | head -1; }
started() { adb logcat -d -s ActivityTaskManager:I | grep "START u0" | grep -c "$1"; }   # lancements d'activité correspondant à $1
# Retour à l'application : la fenêtre qui a le focus (le panneau de partage d'Android 16 laisse l'activité de l'application « au premier plan »).
focused() { adb shell dumpsys window | grep -m1 "mCurrentFocus" | tr -d '\r'; }
back_to_app() { for _ in 1 2 3 4; do focused | grep -q "$PKG" && return 0; adb shell input keyevent KEYCODE_BACK; sleep 2; done; focused | grep -q "$PKG"; }
show_desc() { screen_grep 'Affichage : [^"]*'; }

if want_s K; then
echo "═══ K. Clavier numérique des codes d'accès ═══" | tee -a "$OUT/resultats.txt"
launch; $UI wait "Bienvenue" 25 >/dev/null
$UI tap "Code d'accès" >/dev/null; sleep 2
expect "K1. connexion : clavier numérique pour le code ($(ime_type))" test "$(ime_type)" = 0x12
adb shell input text 047193; sleep 1
$UI tap "Afficher le code" >/dev/null; sleep 2
expect "K2. code affiché : zéro initial conservé (047193)" $UI has "047193"
expect "K2b. clavier toujours numérique quand le code est affiché ($(ime_type))" test "$(ime_type)" = 0x12
adb shell input text 288; sleep 1
expect "K2c. 8 chiffres au plus (le 9e est ignoré)" bash -c "$UI has '04719328' && ! $UI has '047193288'"
shot final-k1-code-visible
$UI tap "Masquer le code" >/dev/null; sleep 1
expect "K3. code remasqué" bash -c "! $UI has '04719328'"
$UI tap "•" >/dev/null; clear_field; hide_kb
fi

check_or_stop() { local l=$1; shift; if "$@"; then ok "$l"; else ko "$l${T_ERR:+ — $T_ERR}"; fi; T_ERR=""; }
# Connexion directe comme la nouvelle application (elle déclare savoir faire choisir le code personnel après un code provisoire).
login_code() { curl -s -o /tmp/lc.out -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d "{\"familyCode\":\"$1\",\"login\":\"$2\",\"secret\":\"$3\",\"clientFeatures\":[\"provisional\"]}"; }
prov_on_screen() { screen_grep "provisoire : [0-9]{6}" | grep -oE "[0-9]{6}"; }

if want_s S; then
echo "═══ S. Accès d'un nouveau membre : code provisoire, partage, nouveau code (famille JETABLE) ═══" | tee -a "$OUT/resultats.txt"
export -f sql   # utilisée dans les contrôles « bash -c »
FID=$(sql "SELECT id FROM families WHERE code='$FAMILY'")
launch; $UI wait "Bienvenue" 25 >/dev/null
check_or_stop "S0. administrateur connecté (saisies vérifiées)" tf_login "$FAMILY" adil 482913
$UI wait "Compte" 25 >/dev/null
tapt "Réglages"; tapt "Profils"
expect "S1. identifiant famille (ici l'ancien code, aucun identifiant choisi) avec « Partager » et « Copier »" bash -c "$UI wait 'Identifiant famille : $FAMILY' 15 && $UI has 'Partager' && $UI has 'Copier'"
expect "S1b. son propre profil : « Modifier mon code d'accès », jamais de code provisoire" bash -c "$UI tap 'Actions pour Adil' >/dev/null; sleep 1; $UI has \"Modifier mon code d'accès\" && ! $UI has 'Nouveau code provisoire'"
adb shell input keyevent KEYCODE_BACK; sleep 1
tapt "Ajouter un profil"
fill "Nom affiché" "Zoe"; hide_kb; fill "Identifiant personnel" zoe; hide_kb
$UI tap "Personnel" >/dev/null; sleep 1
expect "S1c. pays de la famille confirmé : pas de ville à choisir (le membre hérite de celle de la famille)" bash -c "! $UI has 'Choisir la ville'"
expect "S2. aucun code à choisir par l'administrateur : code provisoire annoncé" bash -c "$UI has \"Un code d'accès provisoire sera créé\" && ! $UI has 'Confirmer le code'"
$UI tap "Créer le profil" --scroll >/dev/null; sleep 5
$UI wait "Partager l'accès de Zoe" 15 >/dev/null
PROV=$(prov_on_screen)
expect "S3. partage proposé dès la création : identifiant famille, identifiant personnel, code provisoire 7 jours ($PROV)" bash -c "$UI has 'Identifiant famille : $FAMILY' && $UI has 'Identifiant personnel : zoe' && $UI has 'valable 7 jours' && [[ '$PROV' =~ ^[0-9]{6}$ ]]"
expect "S3b. serveur : code provisoire valable 7 jours, non stocké en clair" test "$(sql "SELECT count(*) FROM profiles WHERE family_id='$FID' AND login='zoe' AND secret_temporary AND secret_used_at IS NULL AND secret_expires_at BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 minute' AND secret_hash NOT LIKE '%${PROV:-X}%'")" = 1
expect "S3c. « Code d'accès provisoire », jamais « mot de passe »" bash -c "$UI has \"Code d'accès provisoire\" && ! $UI has 'ot de passe'"
shot final-s1-partage-apres-creation
$UI tap "Copier les informations" >/dev/null; sleep 1
expect "S4b. « Copier les informations »" $UI wait "Informations copiées" 5
# Android 13+ affiche quelques secondes l'aperçu du presse-papiers en bas de l'écran (avec un raccourci de partage) : on attend
# qu'il disparaisse, sinon l'appui suivant le toucherait et ouvrirait Quick Share.
sleep 10
$UI tap "Fermer" --last >/dev/null; sleep 2
expect "S4d. panneau de partage de l'application fermé" $UI gone "Informations copiées" 5
# Profil existant : un code n'est jamais réaffiché ; « Nouveau code provisoire » annulé sans aucun changement
HASH0=$(sql "SELECT secret_hash FROM profiles WHERE family_id='$FID' AND login='zoe'")
$UI tap "Actions pour Zoe" >/dev/null; sleep 1
expect "S6. menu : « Nouveau code provisoire » (rien ne change à l'ouverture)" bash -c "$UI has 'Nouveau code provisoire' && test \"\$(sql \"SELECT secret_hash FROM profiles WHERE family_id='$FID' AND login='zoe'\")\" = '$HASH0'"
$UI tap "Nouveau code provisoire" >/dev/null; sleep 2
expect "S6b. explication : code jamais affiché, l'ancien cesse aussitôt de fonctionner, 7 jours" bash -c "$UI has 'jamais affiché' && $UI has 'cessera aussitôt de fonctionner' && $UI has '7 jours'"
shot final-s3-nouveau-code-confirmation
$UI tap "Annuler" >/dev/null; sleep 2
expect "S6c. annulation : code inchangé (empreinte identique)" test "$(sql "SELECT secret_hash FROM profiles WHERE family_id='$FID' AND login='zoe'")" = "$HASH0"
# Avec WhatsApp (application d'essai portant l'identifiant com.whatsapp) : nouveau code après confirmation, puis partage
if [ -n "${WA_STUB:-}" ] && adb install -r "$WA_STUB" >/dev/null 2>&1; then
  back_to_app
  $UI tap "Actions pour Zoe" >/dev/null; sleep 1; $UI tap "Nouveau code provisoire" >/dev/null; sleep 2
  $UI tap "Générer et partager" >/dev/null; sleep 5
  NEWC=$(prov_on_screen)
  expect "S7. nouveau code provisoire généré et affiché ($NEWC)" bash -c "[[ '$NEWC' =~ ^[0-9]{6}$ ]] && test '$NEWC' != '$PROV'"
  expect "S7b. l'ancien code ne fonctionne plus ; le nouveau ouvre une session limitée au choix du code" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$FAMILY\",\"login\":\"zoe\",\"secret\":\"$PROV\"}')\" = 401 && curl -s -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$FAMILY\",\"login\":\"zoe\",\"secret\":\"$NEWC\",\"clientFeatures\":[\"provisional\"]}' | grep -q '\"mustChangeSecret\":true'"
  shot final-s4-nouveau-code-partage
  adb logcat -c
  $UI tap "Partager l'accès" --last >/dev/null; sleep 3
  expect "S8. avec WhatsApp : WhatsApp s'ouvre avec le message (envoi par l'administrateur)" test "$(started 'com.whatsapp')" -ge 1
  back_to_app
  $UI tap "Fermer" --last >/dev/null; sleep 2
  adb logcat -c
  $UI tap "Partager" >/dev/null; sleep 3
  expect "S9. identifiant famille : WhatsApp s'ouvre" test "$(started 'com.whatsapp')" -ge 1
  back_to_app
  adb uninstall com.whatsapp >/dev/null 2>&1
else
  ko "S7. application d'essai WhatsApp non installée (WA_STUB=${WA_STUB:-absent})"
fi
$UI tap "Copier" --last >/dev/null; sleep 1
expect "S9b. « Copier » l'identifiant famille" $UI wait "Copié" 5
sleep 10   # aperçu du presse-papiers d'Android
shot final-s5-profils-code-famille
# Partage Android sans WhatsApp, joué en dernier : l'émulateur Google peut ouvrir ensuite, avec un délai variable, l'accueil de
# Quick Share (hors application), qui masquerait les étapes suivantes.
adb uninstall com.whatsapp >/dev/null 2>&1; adb logcat -c
$UI tap "Partager" >/dev/null; sleep 3
expect "S4. sans WhatsApp : partage Android ouvert (rien n'est envoyé)" test "$(started 'android.intent.action.CHOOSER')" -ge 1
shot final-s2-partage-android
sleep 8
expect "S4c. panneau de partage refermé sans rien envoyer, retour à l'application" back_to_app
logout
fi

if want_s I; then
echo "═══ I. Identifiant famille : choix, connexion, changement, alias, invitation, expiration, renouvellement, isolation ═══" | tee -a "$OUT/resultats.txt"
export -f sql
FID=$(sql "SELECT id FROM families WHERE code='$FAMILY'")
footprint() { sql "SELECT md5((SELECT count(*) FROM profiles WHERE family_id='$FID')||'/'||(SELECT count(*) FROM lists WHERE family_id='$FID')||'/'||(SELECT count(*) FROM list_items WHERE family_id='$FID')||'/'||(SELECT count(*) FROM purchases WHERE family_id='$FID')||'/'||(SELECT count(*) FROM products WHERE family_id='$FID')||'/'||(SELECT string_agg(secret_hash, ',' ORDER BY id) FROM profiles WHERE family_id='$FID')||'/'||(SELECT name FROM families WHERE id='$FID'))"; }
FP0=$(footprint)
launch; $UI wait "Bienvenue" 25 >/dev/null
check_or_stop "I0. connexion avec l'ancien code famille (accès existants inchangés)" tf_login "$FAMILY" adil 482913
$UI wait "Compte" 25 >/dev/null
tapt "Réglages"
expect "I1. Réglages : invitation à choisir l'identifiant famille (ancien code rappelé)" bash -c "$UI wait 'Choisissez votre identifiant famille' 10 && $UI has '$FAMILY'"
shot final-i1-reglages
tapt "Choisir l'identifiant"
expect "I2. écran de choix : proposition d'après le nom (Recette), disponible ; ce qui ne change pas" bash -c "$UI wait 'Disponible' 15 && $UI has 'Recette' && $UI has 'Ce qui ne change pas' && $UI has '$FAMILY'"
shot final-i2-choix
# Identifiant déjà réservé ailleurs (empreinte insérée dans la base JETABLE de recette)
sql "INSERT INTO family_aliases (alias_hash, alias, kind) VALUES (sha256(convert_to('pris_ailleurs','UTF8')), 'Pris_Ailleurs', 'former') ON CONFLICT DO NOTHING" >/dev/null
fill_field 0 "pris_ailleurs"; hide_kb
expect "I3. « Cet identifiant famille est déjà utilisé » (majuscules indifférentes) et propositions disponibles" bash -c "$UI wait 'déjà utilisé' 15 && $UI has 'Identifiants disponibles'"
expect "I3b. enregistrement impossible avec cet identifiant" bash -c "! $UI enabled 'Enregistrer pris_ailleurs'"
shot final-i3-indisponible
$UI tap "_20" >/dev/null; sleep 3   # proposition « …_<année> »
expect "I3c. proposition touchée : disponible" $UI wait "Disponible" 15
fill_field 0 "LesRecette04"; hide_kb
$UI wait "Disponible" 15 >/dev/null
tapt "Enregistrer LesRecette04"
expect "I4. confirmation : l'ancien code reste valable" bash -c "$UI wait 'Enregistrer LesRecette04 ?' 10 && $UI has '$FAMILY'"
shot final-i4-confirmation
$UI tap "Enregistrer" --last >/dev/null; sleep 4
expect "I4b. identifiant enregistré et affiché ; ancien code accepté" bash -c "$UI wait 'Ancien code accepté' 15 && $UI has 'LesRecette04'"
expect "I4c. serveur : identifiant actuel + code famille conservé" test "$(sql "SELECT string_agg(kind||':'||alias, ',' ORDER BY kind) FROM family_aliases WHERE family_id='$FID'")" = "code:$FAMILY,current:LesRecette04"
expect "I4d. membres, listes, achats, produits, codes et nom de la famille inchangés" test "$(footprint)" = "$FP0"
shot final-i5-identifiant-enregistre
logout
expect "I5. connexion : identifiant famille retenu sur le téléphone (LesRecette04)" $UI has "LesRecette04"
shot final-i6-connexion
check_or_stop "I5b. connexion avec l'identifiant en minuscules" tf_login "lesrecette04" adil 482913
expect "I5c. connecté" $UI wait "Compte" 20
logout
check_or_stop "I6. ancien code famille toujours accepté (membre du personnel)" tf_login "$FAMILY" marie 573918
expect "I6b. connectée" $UI wait "Compte" 20
logout
# Message générique : identifiant inconnu, code faux, membre d'une autre famille
expect "I7. serveur : réponse identique (identifiant inconnu / code faux)" test "$(login_code Inconnue_42 adil 482913; cat /tmp/lc.out)" = "$(login_code LesRecette04 adil 999999; cat /tmp/lc.out)"
tf_login "Inconnue_42" adil 482913
expect "I7b. application : message générique" $UI wait "Identifiants incorrects ou accès temporairement bloqué" 10
shot final-i7-erreur
# Changement d'identifiant : l'ancien reste un alias permanent
tf_login "LesRecette04" adil 482913; $UI wait "Compte" 20 >/dev/null
tapt "Réglages"; tapt "Identifiant famille"
expect "I8. réglages : identifiant actuel avec Partager et Modifier" bash -c "$UI wait 'LesRecette04' 10 && $UI has 'Modifier' && $UI has 'Partager'"
tapt "Modifier"; fill_field 0 "LesRecette05"; hide_kb; $UI wait "Disponible" 15 >/dev/null
tapt "Enregistrer LesRecette05"; $UI tap "Enregistrer" --last >/dev/null; sleep 4
expect "I8b. nouvel identifiant enregistré ; l'ancien devient un alias" bash -c "$UI wait 'LesRecette05' 10 && test \"\$(sql \"SELECT string_agg(kind||':'||alias, ',' ORDER BY alias) FROM family_aliases WHERE family_id='$FID' AND kind<>'code'\")\" = 'former:LesRecette04,current:LesRecette05'"
expect "I8c. connexion acceptée avec l'ancien identifiant, le nouveau et le code famille" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"LesRecette04\",\"login\":\"adil\",\"secret\":\"482913\"}')\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"lesrecette05\",\"login\":\"adil\",\"secret\":\"482913\"}')\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$FAMILY\",\"login\":\"adil\",\"secret\":\"482913\"}')\" = 200200200"
# Invitation d'un nouveau membre et première connexion
adb shell input keyevent KEYCODE_BACK; sleep 2; tapt "Profils"; tapt "Ajouter un profil"
fill "Nom affiché" "Lina"; hide_kb; fill "Identifiant personnel" lina; hide_kb; $UI tap "Parent" >/dev/null; sleep 1
$UI tap "Créer le profil" --scroll >/dev/null; sleep 5
$UI wait "Partager l'accès de Lina" 15 >/dev/null
LPROV=$(prov_on_screen)
expect "I9. invitation : identifiant famille actuel et code provisoire ($LPROV)" bash -c "$UI has 'Identifiant famille : LesRecette05' && [[ '$LPROV' =~ ^[0-9]{6}$ ]]"
shot final-i8-invitation
sleep 6; $UI tap "Fermer" --last >/dev/null; sleep 2
logout
check_or_stop "I10. Lina se connecte avec le code provisoire" tf_login "lesrecette05" lina "$LPROV"
expect "I10b. première connexion : choix du code personnel obligatoire" bash -c "$UI wait 'Bienvenue Lina' 15 && $UI has 'Enregistrer mon code' && ! $UI has 'Ma liste'"
expect "I10c. code provisoire à usage unique : une seconde connexion est refusée" test "$(login_code LesRecette05 lina "$LPROV")" = 401
shot final-i9-premier-code
fill_field 0 70315826; hide_kb; fill_field 1 70315826; hide_kb
tapt "Enregistrer mon code"; sleep 3
expect "I10d. code enregistré : l'application s'ouvre" $UI wait "Compte" 20
expect "I10e. code personnel accepté, code provisoire refusé" test "$(login_code LesRecette05 lina 70315826)$(login_code LesRecette05 lina "$LPROV")" = 200401
logout
# Expiration (7 jours) puis renouvellement par l'administrateur
login_api adil 482913
api POST /api/profiles -d '{"displayName":"Omar","login":"omar","role":"staff"}' >/dev/null; OPROV=$(jq -r '.provisional.code // empty' /tmp/api.out)
sql "UPDATE profiles SET secret_expires_at = now() - interval '1 minute' WHERE family_id='$FID' AND login='omar'" >/dev/null
tf_login "LesRecette05" omar "$OPROV"
expect "I11. code provisoire expiré ($OPROV) : message générique" $UI wait "Identifiants incorrects" 10
tf_login "LesRecette05" adil 482913; $UI wait "Compte" 20 >/dev/null
tapt "Réglages"; tapt "Profils"; $UI tap "Actions pour Omar" >/dev/null; sleep 1; tapt "Nouveau code provisoire"; tapt "Générer et partager"; sleep 3
ONEW=$(prov_on_screen)
expect "I12. renouvellement : nouveau code affiché ($ONEW) ; l'ancien refusé, le nouveau accepté" bash -c "[[ '$ONEW' =~ ^[0-9]{6}$ ]] && test '$ONEW' != '$OPROV' && test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"LesRecette05\",\"login\":\"omar\",\"secret\":\"$OPROV\"}')\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"LesRecette05\",\"login\":\"omar\",\"secret\":\"$ONEW\",\"clientFeatures\":[\"provisional\"]}')\" = 401200"
shot final-i10-renouvellement
sleep 6; $UI tap "Fermer" --last >/dev/null; sleep 2
logout
# Isolation : une seconde famille, créée par l'API (création autonome avec code reçu par e-mail du faux service d'envoi)
BMAIL="iso.$(date +%s)@example.org"
curl -s -o /tmp/b1.out -X POST $BASE/api/signup/start -H 'content-type: application/json' -d "{\"requestId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"familyName\":\"Famille Iso\",\"displayName\":\"Ines\",\"login\":\"ines\",\"city\":\"Casablanca\",\"email\":\"$BMAIL\",\"secret\":\"582014\",\"secretConfirm\":\"582014\",\"familyLoginId\":\"Famille_Iso\"}"
BCODEMAIL=$(docker exec sc-recette-app node -e "fetch('http://127.0.0.1:3199/__sent?to=$BMAIL').then(r=>r.json()).then(j=>console.log((j.at(-1)||{subject:''}).subject.match(/(\d{6})/)?.[1]||''))")
BCOOKIE=$(curl -s -D - -o /tmp/b2.out -X POST $BASE/api/signup/verify -H 'content-type: application/json' -d "{\"signupId\":\"$(jq -r .signupId /tmp/b1.out)\",\"code\":\"$BCODEMAIL\"}" | tr -d '\r' | grep -i '^set-cookie: sc_session=' | sed -E 's/.*sc_session=([^;]*);.*/\1/')
expect "I13. seconde famille créée avec son identifiant (Famille_Iso)" test "$(jq -r .loginId /tmp/b2.out)" = Famille_Iso
expect "I13b. l'identifiant d'une famille ne donne aucun accès à l'autre (membre de A avec l'identifiant de B : refusé)" test "$(login_code Famille_Iso adil 482913)" = 401
expect "I13c. chaque famille ne voit que ses membres" test "$(curl -s $BASE/api/profiles -H "Cookie: sc_session=$BCOOKIE" | jq -r '[.profiles[].login] | join(",")')" = ines
expect "I13d. ancien identifiant de A jamais réattribué à B" test "$(curl -s -o /tmp/b3.out -w '%{http_code}' -X PUT $BASE/api/family/login-id -H "Cookie: sc_session=$BCOOKIE" -H 'content-type: application/json' -d '{"loginId":"lesrecette04"}')$(jq -r .error /tmp/b3.out)" = 409family_id_taken
expect "I13e. contrôle de disponibilité : aucune information sur la famille qui l'utilise" test "$(curl -s -X POST $BASE/api/family-id/check -H 'content-type: application/json' -d '{"id":"LesRecette05"}' | jq -c 'keys')" = '["available","message","suggestions","valid"]'
expect "I14. données de la famille A toujours intactes hors nouveaux membres (codes des anciens membres inchangés)" test "$(sql "SELECT count(*) FROM profiles WHERE family_id='$FID' AND login IN ('adil','lamiaa','marie') AND NOT secret_temporary")" = 3
fi

if want_s A; then
echo "═══ A. Catalogue (contrôle rapide) : Tous les articles / Par catégories × Liste / Cartes ═══" | tee -a "$OUT/resultats.txt"
set_display() { # $1 présentation, $2 organisation (libellés du panneau)
  $UI tap "Affichage" >/dev/null; sleep 2
  $UI tap "$1" >/dev/null; sleep 1; $UI tap "$2" >/dev/null; sleep 1
  $UI tap "Fermer" --last >/dev/null; sleep 2
}
launch; $UI wait "Bienvenue" 25 >/dev/null
expect "A0. démarrage, personnel connecté" tf_login "$FAMILY" marie 573918
$UI wait "Affichage" 20 >/dev/null
expect "A1. icône Affichage dans l'en-tête, plus de rangée de boutons" bash -c "$UI has 'Affichage : ' && ! $UI has 'Grandes cartes'"
set_display "Cartes" "Par catégories"
expect "A2. Par catégories : grille des catégories (sans articles)" bash -c "$UI has 'Légumes et herbes' && ! $UI has 'Oignons'"
shot final-a1-grille-categories
$UI tap "Légumes et herbes" >/dev/null; sleep 2
expect "A3. catégorie ouverte : ses articles et le retour" bash -c "$UI has 'Retour aux catégories' && $UI has 'Oignons'"
$UI tap "Oignons" >/dev/null; sleep 2
expect "A4. article choisi" $UI has "Terminer ma sélection (1)"
shot final-a2-categorie-ouverte
$UI tap "Retour aux catégories" >/dev/null; sleep 2
expect "A5. retour à la grille, badge « choisi(s) » sur la catégorie" bash -c "$UI has 'Légumes et herbes' && $UI has ' choisi' && $UI has 'Terminer ma sélection (1)'"
shot final-a3-badge-categorie
$UI tap "Légumes et herbes" >/dev/null; sleep 2; adb shell input keyevent KEYCODE_BACK; sleep 2
expect "A6. retour Android : grille, application toujours ouverte" bash -c "$UI has 'Légumes et herbes' && ! $UI has 'Retour aux catégories' && $UI has 'Terminer ma sélection (1)'"
set_display "Liste" "Tous les articles"
expect "A7. Tous les articles en Liste : titres de catégorie, sélection conservée" bash -c "$UI has 'Légumes et herbes' && $UI has 'Terminer ma sélection (1)' && $UI has 'Affichage : Liste, tous les articles'"
shot final-a4-tous-les-articles-liste
adb shell am force-stop $PKG; adb shell am start -W -n "$ACT" >/dev/null 2>&1; sleep 4; $UI wait "Affichage" 25 >/dev/null
expect "A8. préférence gardée après fermeture de l'application" test "$(show_desc)" = "Affichage : Liste, tous les articles"
logout; tf_login "$FAMILY" marie 573918; $UI wait "Affichage" 25 >/dev/null
expect "A9. préférence gardée après déconnexion / reconnexion" test "$(show_desc)" = "Affichage : Liste, tous les articles"
logout
fi

if want_s V; then
echo "═══ V. Créer ma famille : le bouton dit ce qui manque (ville oubliée) — contrôle rapide ═══" | tee -a "$OUT/resultats.txt"
launch; $UI wait "Bienvenue" 25 >/dev/null
$UI tap "Première connexion" >/dev/null; sleep 1; $UI tap "Créer ma famille" >/dev/null; sleep 2
fill "Nom affiché de la famille" "Famille Test" --scroll; hide_kb
fill "Votre prénom" "Test" --scroll; hide_kb
fill "Identifiant personnel" "testv" --scroll; hide_kb
fill "E-mail de récupération" "v.$(date +%s)@example.org" --scroll; hide_kb
fill "Code d'accès" 274915 --scroll; hide_kb
fill "Confirmez le code" 274915 --scroll; hide_kb
expect "V1. pays non choisi : « Il manque : le pays » affiché" $UI has "Il manque : le pays"
expect "V2. bouton actif (jamais grisé sans explication)" $UI enabled "Recevoir le code par e-mail"
$UI tap "Recevoir le code par e-mail" --scroll >/dev/null; sleep 2
expect "V3. appui : choix du pays ouvert, rien n'est envoyé" bash -c "$UI wait 'Rechercher un pays' 6 && test \"\$(docker exec sc-recette-pg psql -U smart -d smartcourse -tAc \"SELECT count(*) FROM family_signups WHERE login='testv'\")\" = 0"
shot final-v1-pays-manquant
fill "Rechercher un pays" "maroc"; hide_kb; $UI tap "Maroc" --last >/dev/null; sleep 2
expect "V3b. Maroc : la ville est demandée" $UI has "Il manque : votre ville"
$UI tap "Ville : " --scroll >/dev/null; sleep 2
fill "Rechercher une ville" "rabat"; hide_kb; $UI tap "Rabat" --last >/dev/null; sleep 2
expect "V4. ville choisie : plus rien ne manque" bash -c "$UI has 'Ville : Rabat' && ! $UI has 'Il manque'"
shot final-v2-formulaire-complet
fi

if want_s R; then
echo "═══ R. Recommander puis « Ajouter des articles » : sélection reprise, sans doublon — contrôle rapide ═══" | tee -a "$OUT/resultats.txt"
login_api adil 482913
api GET /api/lists/active >/dev/null; LID=$(jq -r '.list.id // empty' /tmp/api.out); [ -n "$LID" ] && api POST "/api/lists/$LID/close" -d '{}' >/dev/null
pid() { sql "SELECT p.id FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.name='$1'"; }
TOM=$(pid Tomates); OIG=$(pid Oignons)
uuid() { cat /proc/sys/kernel/random/uuid; }
# Commande passée : Tomates 3 kg et Oignons 1 kg, achetées puis archivées
api POST /api/lists/active/ops -d "{\"ops\":[{\"opId\":\"$(uuid)\",\"type\":\"add\",\"productId\":\"$TOM\",\"quantity\":3},{\"opId\":\"$(uuid)\",\"type\":\"add\",\"productId\":\"$OIG\",\"quantity\":1}]}" >/dev/null
api GET /api/lists/active >/dev/null; OLD=$(jq -r '.list.id' /tmp/api.out)
for it in $(jq -r '.list.items[].id' /tmp/api.out); do api POST "/api/lists/$OLD/ops" -d "{\"ops\":[{\"opId\":\"$(uuid)\",\"type\":\"purchase\",\"itemId\":\"$it\"}]}" >/dev/null; done
api POST "/api/lists/$OLD/close" -d '{}' >/dev/null
OLDSTATE() { sql "SELECT string_agg(p.name||':'||i.quantity||':'||i.status, ',' ORDER BY p.name) FROM list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id='$OLD'"; }
OLD0=$(OLDSTATE)
ACTIVE() { sql "SELECT coalesce(string_agg(p.name||':'||i.quantity||':'||i.status, ',' ORDER BY p.name),'') FROM list_items i JOIN products p ON p.id=i.product_id JOIN lists l ON l.id=i.list_id JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active' AND i.status<>'removed'"; }
launch; $UI wait "Bienvenue" 25 >/dev/null
signin "$FAMILY" adil 482913; $UI wait "Compte" 25 >/dev/null
tapt "Historique"; $UI wait "Recommander" 15 >/dev/null
$UI tap "Recommander" >/dev/null; sleep 6
expect "R1. recommandée dans la liste en cours ($(ACTIVE))" test "$(ACTIVE)" = "Oignons:1.000:to_buy,Tomates:3.000:to_buy"
tapt "Ajouter des articles"; sleep 3
expect "R2. catégorie : badge des 2 articles déjà dans la liste" $UI has "2 choisis"
fill "Rechercher un produit" "tomates"; hide_kb; sleep 2
expect "R3. Tomates cochée avec sa quantité actuelle (3 kg), rien à terminer" bash -c "$UI has 'Dans la liste · 3 kg' && $UI has 'Sélectionné' && ! $UI has 'Terminer ma sélection ('"
shot final-r1-selection-reprise
$UI tap "Retour" >/dev/null; sleep 3
expect "R4. aller-retour sans modification : liste strictement inchangée" test "$(ACTIVE)" = "Oignons:1.000:to_buy,Tomates:3.000:to_buy"
tapt "Ajouter des articles"; sleep 3
fill "Rechercher un produit" "carottes"; hide_kb; sleep 2
$UI tap "Carottes" --last >/dev/null; sleep 2
expect "R5. un seul changement à confirmer" $UI has "Terminer ma sélection (1)"
tapt "Terminer ma sélection"; sleep 6
expect "R6. confirmé sans doublon ni cumul ($(ACTIVE))" test "$(ACTIVE)" = "Carottes:1.000:to_buy,Oignons:1.000:to_buy,Tomates:3.000:to_buy"
expect "R7. commande d'origine intacte" test "$(OLDSTATE)" = "$OLD0"
tapt "Historique"; $UI wait "Recommander" 15 >/dev/null; $UI tap "Recommander" >/dev/null; sleep 3
expect "R8. liste non vide : choix explicite Ajouter / Remplacer (aucune fusion silencieuse)" bash -c "$UI has 'La liste en cours n' && $UI has 'Ajouter à la liste actuelle' && $UI has 'Remplacer son contenu'"
shot final-r2-choix-recommander
$UI tap "Annuler" --last >/dev/null; sleep 2
expect "R9. annulé : liste inchangée" test "$(ACTIVE)" = "Carottes:1.000:to_buy,Oignons:1.000:to_buy,Tomates:3.000:to_buy"
logout
fi

if want_s M; then
echo "═══ M. Option « Plusieurs listes actives » : activation, nouvelle liste nommée, changement de liste, désactivation refusée — contrôle rapide ═══" | tee -a "$OUT/resultats.txt"
login_api adil 482913
closeall() { api GET /api/lists/open >/dev/null; for l in $(jq -r '.lists[]?.id' /tmp/api.out); do api POST "/api/lists/$l/close" -d '{}' >/dev/null; done; }
closeall; api PUT /api/family/features -d '{"multiLists":false}' >/dev/null
TOM=$(sql "SELECT p.id FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.name='Tomates'")
api POST /api/lists/active/ops -d "{\"ops\":[{\"opId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"type\":\"add\",\"productId\":\"$TOM\",\"quantity\":2}]}" >/dev/null
OPT() { sql "SELECT multi_lists_enabled FROM families WHERE code='$FAMILY'"; }
NACT() { sql "SELECT count(*) FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active'"; }
launch; $UI wait "Bienvenue" 25 >/dev/null
signin "$FAMILY" adil 482913; $UI wait "Ma liste" 25 >/dev/null
expect "M1. option désactivée par défaut : présentation habituelle (pas de sélecteur)" bash -c "test \"\$(docker exec sc-recette-pg psql -U smart -d smartcourse -tAc \"SELECT multi_lists_enabled FROM families WHERE code='$FAMILY'\")\" = f && ! $UI has 'liste en cours'"
tapt "Réglages"; $UI tap "Paramètres avancés" --scroll >/dev/null; sleep 2
expect "M2. Paramètres avancés : option visible" $UI wait "Plusieurs listes actives" 10
shot final-m1-parametres-avances
$UI tap "Plusieurs listes actives" >/dev/null; sleep 4
expect "M3. activée par l'administrateur (enregistrée côté serveur)" test "$(OPT)" = t
adb shell input keyevent KEYCODE_BACK; sleep 2; tapt "Liste"; sleep 2
expect "M4. sélecteur affiché : 1 liste en cours" $UI wait "1 liste en cours" 10
$UI tap "1 liste en cours" >/dev/null; sleep 2; tapt "Nouvelle liste" --last
# Nom sans accent : adb input text ne sait pas taper les accents.
fill "Ex. : Marché" "Souk"; hide_kb; $UI tap "Créer" --last >/dev/null; sleep 5
expect "M5. nouvelle liste « Souk » créée et consultée ; l'autre reste ouverte" bash -c "test \"\$(docker exec sc-recette-pg psql -U smart -d smartcourse -tAc \"SELECT count(*) FROM lists l JOIN families f ON f.id=l.family_id WHERE f.code='$FAMILY' AND l.status='active'\")\" = 2 && $UI has 'Souk' && $UI has '2 listes en cours' && ! $UI has 'Tomates'"
shot final-m2-liste-souk
$UI tap "2 listes en cours" >/dev/null; sleep 3
expect "M6. liste des listes en cours avec leurs articles restants" $UI has "1 à acheter"
$UI tap "1 à acheter" >/dev/null; sleep 5
expect "M7. retour à la première liste : Tomates affichées" $UI wait "Tomates" 10
tapt "Réglages"; $UI tap "Paramètres avancés" --scroll >/dev/null; sleep 2
$UI tap "Plusieurs listes actives" >/dev/null; sleep 2; $UI tap "Désactiver" --last >/dev/null; sleep 4
expect "M8. désactivation refusée tant que 2 listes sont en cours (rien fusionné ni supprimé)" bash -c "$UI has 'listes sont en cours' && test \"\$(docker exec sc-recette-pg psql -U smart -d smartcourse -tAc \"SELECT multi_lists_enabled FROM families WHERE code='$FAMILY'\")\" = t"
shot final-m3-desactivation-refusee
expect "M9. aucune liste supprimée ($(NACT) en cours)" test "$(NACT)" = 2
closeall; api PUT /api/family/features -d '{"multiLists":false}' >/dev/null
logout
fi

if want_s N; then
echo "═══ N. Produit introuvable : actif, masqué, disponible, réellement absent, catalogue inaccessible — contrôle rapide ═══" | tee -a "$OUT/resultats.txt"
REFS="SELECT count(*) FROM (SELECT c.photo_asset_id FROM extended_catalog c WHERE c.key IN ('farine-fino','farine-force','pate-a-tartiner-nutella','couscous','farine-complete') UNION ALL SELECT photo_asset_id FROM initial_catalog WHERE key='semoule-fine') r JOIN photo_assets a ON a.id=r.photo_asset_id WHERE a.source_name='Visuel fourni par l''éditeur de Mes Courses'"
expect "N1. six références avec leur visuel fourni ($(sql "$REFS")/6)" test "$(sql "$REFS")" = 6
login_api adil 482913
BEURRE=$(sql "SELECT p.id FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.name='Beurre'")
api PATCH "/api/products/$BEURRE" -d '{"active":false}' >/dev/null   # produit MASQUÉ par un administrateur
api GET /api/lists/active >/dev/null; LID=$(jq -r '.list.id // empty' /tmp/api.out); [ -n "$LID" ] && api POST "/api/lists/$LID/close" -d '{}' >/dev/null
search() { fill "Rechercher un produit" "$1"; hide_kb; sleep 3; }
# --- Personnel : jamais de création ni de contournement du masquage
launch; $UI wait "Bienvenue" 25 >/dev/null
expect "N2. personnel connecté" tf_login "$FAMILY" marie 573918
$UI wait "Affichage" 20 >/dev/null
search beurre
expect "N3. personnel : produit masqué introuvable, renvoi vers un administrateur, aucune création" bash -c "$UI has 'Un administrateur peut' && ! $UI has 'Rechercher dans le catalogue complet' && ! $UI has 'Créer' && ! $UI has 'Beurre'"
shot final-n1-personnel-introuvable
logout
# --- Administrateur : « Ajouter des articles » → catalogue complet avec la recherche transmise
signin "$FAMILY" adil 482913; $UI wait "Compte" 25 >/dev/null
tapt "Créer une liste"; $UI wait "Rechercher un produit" 15 >/dev/null
search beurre
expect "N4. administrateur : plus de bouton de création directe, « Rechercher dans le catalogue complet »" bash -c "$UI has 'Rechercher dans le catalogue complet' && ! $UI has 'Ajouter « beurre »'"
tapt "Rechercher dans le catalogue complet"; sleep 3
expect "N5. catalogue ouvert avec la recherche transmise ; masqué → « Réactiver »" bash -c "$UI wait 'Catalogue' 10 && $UI has 'beurre' && $UI has 'Beurre' && $UI has 'Réactiver'"
$UI tap "Dans mon catalogue" >/dev/null; sleep 4
expect "N6. autre onglet : vérifié dans tout le catalogue, « Masqué » + « Réactiver », aucune création" bash -c "$UI has 'Trouvé dans tout le catalogue' && $UI has 'Masqué' && $UI has 'Réactiver' && ! $UI has 'Créer un nouveau produit'"
shot final-n2-masque-autre-onglet
$UI tap "Réactiver" >/dev/null; sleep 5
expect "N7. réactivé puis choisi, retour à la sélection" bash -c "$UI has 'Terminer ma sélection (1)' && test \"\$(docker exec sc-recette-pg psql -U smart -d smartcourse -tAc \"SELECT active FROM products WHERE id='$BEURRE'\")\" = t"
search nutella; tapt "Rechercher dans le catalogue complet"; sleep 3
$UI tap "Dans mon catalogue" >/dev/null; sleep 4
expect "N8. disponible mais absent : « Ajouter » depuis la référence existante" bash -c "$UI has 'Pâte à tartiner Nutella' && $UI has 'Disponible' && $UI has 'Ajouter' && ! $UI has 'Créer un nouveau produit'"
shot final-n3-disponible
$UI tap "Ajouter" --last >/dev/null; sleep 5
NUT=$(sql "SELECT count(*) FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.name='Pâte à tartiner Nutella' AND p.extended_id IS NOT NULL AND p.photo_asset_id IS NOT NULL")
expect "N9. ajouté depuis la référence (avec sa photo) et choisi" bash -c "$UI has 'Terminer ma sélection (2)' && test '$NUT' = 1"
search tomate; sleep 1
expect "N10. actif : trouvé directement dans la sélection" bash -c "$UI has 'Tomates' && ! $UI has 'Rechercher dans le catalogue complet'"
search zzzz; tapt "Rechercher dans le catalogue complet"; sleep 2
fill "Rechercher un produit" "tomates"; hide_kb; $UI tap "À ajouter" >/dev/null; sleep 4
expect "N11. actif vu depuis l'onglet « À ajouter » : « Déjà dans mon catalogue », aucune création" bash -c "$UI has 'Déjà dans mon catalogue' && ! $UI has 'Créer un nouveau produit'"
$UI tap "Tous" >/dev/null; sleep 2
fill "Rechercher un produit" "Bsissa"; hide_kb; sleep 4
expect "N12. réellement absent : « Créer un nouveau produit »" bash -c "$UI has 'Aucune référence ne correspond' && $UI has 'Créer un nouveau produit'"
shot final-n4-absent
tapt "Créer un nouveau produit"
expect "N13. formulaire prérempli" bash -c "$UI wait 'Nouveau produit' 8 && $UI has 'Bsissa' && $UI has 'Autres'"
$UI tap "Créer et ajouter à ma sélection" >/dev/null; sleep 5
expect "N14. créé pour cette famille seulement, proposition possible" bash -c "$UI has 'créé et ajouté' && $UI has 'Proposer' && test \"\$(docker exec sc-recette-pg psql -U smart -d smartcourse -tAc \"SELECT string_agg(f.code||':'||p.category, ',') FROM products p JOIN families f ON f.id=p.family_id WHERE p.name='Bsissa'\")\" = '$FAMILY:autres'"
shot final-n5-cree
# Catalogue inaccessible : jamais « inexistant », aucune création
adb shell cmd connectivity airplane-mode enable; sleep 4
fill "Rechercher un produit" "Harissa"; hide_kb; sleep 6
expect "N15. hors connexion : explication + Réessayer, aucune création" bash -c "$UI has 'Impossible de vérifier le catalogue complet' && $UI has 'Réessayer' && ! $UI has 'Créer un nouveau produit'"
shot final-n6-hors-connexion
adb shell cmd connectivity airplane-mode disable; sleep 8
$UI tap "Réessayer" >/dev/null; sleep 5
expect "N16. après reconnexion : vérification aboutie" bash -c "$UI has 'Créer un nouveau produit' || $UI has 'Trouvé dans tout le catalogue'"
expect "N17. /gestion : page servie, données protégées" test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/gestion"):$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/gestion/proposals")" = "200:401"
logout
fi

if want_s D; then
echo "═══ D. Suppression de compte et de famille (familles JETABLES de la recette) ═══" | tee -a "$OUT/resultats.txt"
export -f sql   # utilisée aussi dans les contrôles « bash -c »
launch; $UI wait "Bienvenue" 25 >/dev/null
FID=$(sql "SELECT id FROM families WHERE code='$FAMILY'")
login_api adil 482913
api POST /api/profiles -d '{"displayName":"Dina","login":"dpers","role":"staff","secret":"735194","secretConfirm":"735194","city":"Casablanca"}' >/dev/null
api POST /api/profiles -d '{"displayName":"Driss","login":"dadmin","role":"admin","secret":"628351","secretConfirm":"628351","city":"Casablanca"}' >/dev/null
DPERS=$(sql "SELECT id FROM profiles WHERE family_id='$FID' AND login='dpers'")
# Dina (personnel) a fait une demande, et garde une seconde session ouverte (API) : les deux doivent être traitées
login_api dpers 735194; DCOOKIE=$COOKIE
OIG=$(sql "SELECT id FROM products WHERE family_id='$FID' AND name='Oignons'")
api POST /api/lists/active/ops -d "{\"ops\":[{\"opId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"type\":\"add\",\"productId\":\"$OIG\",\"quantity\":1}]}" >/dev/null
DITEM=$(sql "SELECT id FROM list_items WHERE added_by='$DPERS' LIMIT 1")
signin "$FAMILY" dpers 735194
expect "D1. personnel connecté" $UI wait "Choisir mes articles" 25
tapt "Compte"
expect "D1b. « Supprimer mon compte » dans le menu Compte (personnel)" $UI has "Supprimer mon compte"
expect "D1c. distinct de la déconnexion (Se déconnecter au-dessus)" $UI above "Se déconnecter" "Supprimer mon compte"
$UI tap "Supprimer mon compte" --last >/dev/null; sleep 2
expect "D2. écran explicite : ce qui est supprimé / ce qui reste" bash -c "$UI wait 'Ce qui est supprimé définitivement' 10 && $UI has 'Ancien profil'"
expect "D2b. bouton désactivé tant que le code et la confirmation manquent" bash -c "! $UI enabled 'Supprimer mon compte'"
shot final-d1-supprimer-mon-compte
fill "Votre code d'accès" 735194; hide_kb
$UI tap "Je comprends que la suppression" --scroll >/dev/null; sleep 1
$UI tap "Supprimer mon compte" --last --scroll >/dev/null; sleep 2
expect "D2c. confirmation demandée" $UI wait "Supprimer votre compte ?" 8
$UI tap "Supprimer" --last >/dev/null; sleep 5
expect "D3. retour à la connexion avec message de suppression (essais refusés : $(sql "SELECT failed_attempts FROM profiles WHERE id='$DPERS'"))" bash -c "$UI wait 'Votre compte a été supprimé' 20 && $UI has 'Bienvenue'"
shot final-d2-compte-supprime
expect "D3b. serveur : profil anonymisé ($(sql "SELECT display_name||'|'||(deleted_at IS NOT NULL)::text||'|'||coalesce(city,'-')||'|'||active::text FROM profiles WHERE id='$DPERS'"))" \
  test "$(sql "SELECT display_name||'|'||(deleted_at IS NOT NULL)::text||'|'||coalesce(city,'-')||'|'||active::text FROM profiles WHERE id='$DPERS'")" = "Ancien profil|true|-|false"
expect "D3c. serveur : aucune session ouverte" test "$(sql "SELECT count(*) FROM sessions WHERE profile_id='$DPERS' AND revoked_at IS NULL")" = 0
expect "D3d. l'autre session (autre téléphone) est fermée : 401" test "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/me -H "Cookie: sc_session=$DCOOKIE")" = 401
expect "D3e. reconnexion refusée (API : 401)" test "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d "{\"familyCode\":\"$FAMILY\",\"login\":\"dpers\",\"secret\":\"735194\"}")" = 401
signin "$FAMILY" dpers 735194
expect "D3f. reconnexion refusée dans l'application" bash -c "sleep 3; $UI has 'Bienvenue' && ! $UI has 'Choisir mes articles'"
expect "D3g. sa demande reste dans la liste, attribuée à « Ancien profil »" test "$(sql "SELECT p.display_name FROM list_items i JOIN profiles p ON p.id=i.added_by WHERE i.id='$DITEM'")" = "Ancien profil"
expect "D3h. les autres membres et la famille sont intacts" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$FAMILY\",\"login\":\"lamiaa\",\"secret\":\"573918\"}')\" = 200 && test \"\$(sql \"SELECT count(*) FROM profiles WHERE family_id='$FID' AND login IN ('adil','lamiaa','marie','dadmin') AND deleted_at IS NULL\")\" = 4"

# Page web publique /suppression-compte (même règle que dans l'application)
expect "D7. page web /suppression-compte servie (« Mes Courses »)" bash -c "curl -s $BASE/suppression-compte | grep -q 'Supprimer mon compte Mes Courses'"
login_api dadmin 628351
api POST /api/profiles -d '{"displayName":"Walid","login":"dweb","role":"parent","secret":"846203","secretConfirm":"846203","city":"Casablanca"}' >/dev/null
DWEB=$(sql "SELECT id FROM profiles WHERE family_id='$FID' AND login='dweb'")
expect "D7b. page web : mauvais code refusé (401), rien ne change" test "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/account/delete -H 'content-type: application/json' -d "{\"familyCode\":\"$FAMILY\",\"login\":\"dweb\",\"secret\":\"000001\"}")" = 401
expect "D7c. page web : suppression acceptée" test "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/account/delete -H 'content-type: application/json' -d "{\"familyCode\":\"$FAMILY\",\"login\":\"dweb\",\"secret\":\"846203\"}")" = 200
expect "D7d. page web : profil anonymisé, reconnexion refusée" bash -c "test \"\$(sql \"SELECT display_name FROM profiles WHERE id='$DWEB'\")\" = 'Ancien profil' && test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$FAMILY\",\"login\":\"dweb\",\"secret\":\"846203\"}')\" = 401"

# Toute la famille (administrateur principal) : la famille créée dans l'application en section C
BCODE=${NEWCODE:-}   # famille créée dans l'application en section C (adresse $NEWMAIL)
if [ -n "$BCODE" ]; then
  BFID=$(sql "SELECT id FROM families WHERE code='$BCODE'")
  SIGN_BEFORE=$(sql "SELECT count(*) FROM family_signups WHERE email='$NEWMAIL'")
  sleep 61
  signin "$BCODE" karim 274915
  $UI wait "Compte" 25 >/dev/null
  tapt "Compte"; $UI tap "Supprimer mon compte" --last >/dev/null; sleep 3
  $UI tap "Supprimer toute la famille…" --scroll >/dev/null; sleep 4
  expect "D8. suppression de la famille : conséquences explicites" bash -c "$UI wait 'Conséquences, définitives' 15 && $UI has 'Les autres familles ne sont pas touchées'"
  fill "Votre code d'accès" 274915; hide_kb
  fill "Tapez le code famille" "$BCODE" --scroll; hide_kb
  expect "D8b. bouton désactivé sans la case « Je comprends »" bash -c "! $UI enabled 'Supprimer définitivement la famille'"
  shot final-d5-supprimer-famille
  $UI tap "Je comprends que toute la famille" --scroll >/dev/null; sleep 1
  $UI tap "Supprimer définitivement la famille" --last --scroll >/dev/null; sleep 2
  expect "D8c. confirmation explicite" $UI wait "Supprimer toute la famille ?" 8
  $UI tap "Supprimer la famille" --last >/dev/null; sleep 6
  expect "D9. famille supprimée : retour à la connexion avec message" $UI wait "La famille a été supprimée" 20
  shot final-d6-famille-supprimee
  expect "D9b. serveur : famille, profils, listes et demande de création effacés (demande avant : $SIGN_BEFORE)" bash -c "
    test \"\$(sql \"SELECT count(*) FROM families WHERE id='$BFID'\")\" = 0 && test \"\$(sql \"SELECT count(*) FROM profiles WHERE family_id='$BFID'\")\" = 0 &&
    test \"\$(sql \"SELECT count(*) FROM lists WHERE family_id='$BFID'\")\" = 0 && test \"\$(sql \"SELECT count(*) FROM family_signups WHERE email='$NEWMAIL'\")\" = 0 && test '$SIGN_BEFORE' -ge 1"
  expect "D9c. reconnexion refusée ; l'autre famille reste" bash -c "
    test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$BCODE\",\"login\":\"karim\",\"secret\":\"274915\"}')\" = 401 &&
    test \"\$(sql \"SELECT count(*) FROM families WHERE code='$FAMILY'\")\" = 1"
else
  echo "(D8-D9 non joués : la famille de la section C n'existe pas dans ce lancement)" | tee -a "$OUT/resultats.txt"
fi

fi
if want_s T; then
echo "═══ T. Administrateur principal : transfert du rôle puis suppression de son seul compte (famille JETABLE) ═══" | tee -a "$OUT/resultats.txt"
export -f sql
FID=$(sql "SELECT id FROM families WHERE code='$FAMILY'")
# Une seule session API, réutilisée : Driss (administrateur) existe déjà si la section D a été jouée
if [ "$(sql "SELECT count(*) FROM profiles WHERE family_id='$FID' AND login='dadmin'")" = 0 ]; then
  login_api adil 482913
  api POST /api/profiles -d '{"displayName":"Driss","login":"dadmin","role":"admin","secret":"628351","secretConfirm":"628351","city":"Casablanca"}' >/dev/null
fi
t_ok=1
check_or_stop() { local l=$1; shift; if [ "$t_ok" = 1 ] && "$@"; then ok "$l"; else ko "$l${T_ERR:+ — $T_ERR}"; t_ok=0; fi; T_ERR=""; }
launch; $UI wait "Bienvenue" 25 >/dev/null
check_or_stop "T0. formulaire neuf : code famille, identifiant et code saisis et vérifiés ; envoi" tf_login "$FAMILY" adil 482913
check_or_stop "T0b. administrateur principal connecté (formulaire neuf)" $UI wait "Compte" 25
[ "$t_ok" = 1 ] && logout
# Même contrôle juste après une connexion refusée (cas des échecs précédents) ; l'essai refusé ne vise aucun compte existant
check_or_stop "T0c. essai refusé (identifiant inconnu) : saisies vérifiées ; envoi" tf_login "$FAMILY" inconnu 913482
check_or_stop "T0d. refus affiché" $UI wait "Identifiants incorrects" 15
check_or_stop "T0e. après le refus : saisies vérifiées (adil) ; envoi" tf_login "$FAMILY" adil 482913
check_or_stop "T0f. administrateur principal connecté après un refus" $UI wait "Compte" 25
if [ "$t_ok" != 1 ]; then
  echo "ARRÊT de la section T : connexion de l'administrateur principal non établie, transfert et suppression non joués" | tee -a "$OUT/resultats.txt"
else
tapt "Compte"; $UI tap "Supprimer mon compte" --last >/dev/null; sleep 3
expect "D4. principal : suppression seule impossible, expliquée" bash -c "$UI wait 'Vous êtes l' 10 && $UI has 'ne peut pas être supprimé seul'"
# « Supprimer toute la famille » est plus bas dans ce panneau : il est vérifié (et utilisé) par la section D (D8). Ne pas faire défiler ici :
# un glissement vers le bas, contenu déjà en haut, fermerait le panneau.
expect "D4b. deux choix : transférer le rôle (et, plus bas, supprimer toute la famille)" bash -c "$UI has 'Supprimer seulement mon compte' && $UI has 'Transférer le rôle'"
expect "D4c. candidat proposé : l'autre administrateur actif" $UI wait "(dadmin)" 10
shot final-d3-principal-choix
$UI tap "(dadmin)" >/dev/null; sleep 1
check_or_stop "T4d. code saisi pour le transfert" fill "Votre code d'accès" 482913; hide_kb
$UI tap "Transférer le rôle" --last --scroll >/dev/null; sleep 2
$UI tap "Transférer" --last >/dev/null; sleep 5
expect "D5. transfert confirmé à l'écran" $UI wait "est maintenant l'administrateur principal" 15
expect "D5b. serveur : Driss est l'administrateur principal, adresse de l'ancien retirée" test "$(sql "SELECT string_agg(login||':'||is_primary::text||':'||coalesce(recovery_email,'-'), ',' ORDER BY login) FROM profiles WHERE family_id='$FID' AND login IN ('adil','dadmin')")" = "adil:false:-,dadmin:true:-"
shot final-d4-transfert
check_or_stop "T5c. code saisi pour la suppression" fill "Votre code d'accès" 482913; hide_kb
$UI tap "Je comprends que la suppression" --scroll >/dev/null; sleep 1
$UI tap "Supprimer mon compte" --last --scroll >/dev/null; sleep 2
$UI tap "Supprimer" --last >/dev/null; sleep 5
expect "D6. ancien principal : compte supprimé, retour à la connexion" $UI wait "Votre compte a été supprimé" 20
expect "D6b. reconnexion refusée ; Driss et Lamiaa se connectent" bash -c "
  test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$FAMILY\",\"login\":\"adil\",\"secret\":\"482913\"}')\" = 401 &&
  test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$FAMILY\",\"login\":\"dadmin\",\"secret\":\"628351\"}')\" = 200 &&
  test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$FAMILY\",\"login\":\"lamiaa\",\"secret\":\"573918\"}')\" = 200"


fi
fi
if want_s X; then
echo "═══ X. Options avancées : activation des listes, choix et sélection de la devise, activation du budget, réglages gardés après réouverture — contrôle ciblé ═══" | tee -a "$OUT/resultats.txt"
login_api adil 482913
closeall_api; api PUT /api/family/features -d '{"multiLists":false,"budget":false}' >/dev/null
FEAT() { sql "SELECT f.multi_lists_enabled||':'||f.budget_enabled||':'||coalesce(s.currency,'-') FROM families f LEFT JOIN finance_settings s ON s.family_id=f.id WHERE f.code='$FAMILY'"; }
launch; $UI wait "Bienvenue" 25 >/dev/null
signin "$FAMILY" adil 482913; $UI wait "Ma liste" 25 >/dev/null
tapt "Réglages"; $UI tap "Paramètres avancés" --scroll >/dev/null; sleep 3
expect "X0. serveur à jour : aucune option bloquée" bash -c "! $UI has 'mise à jour du serveur'"
$UI tap "Plusieurs listes actives" >/dev/null; sleep 4
expect "X1. « Plusieurs listes actives » activée sans message d'erreur ($(FEAT))" bash -c "test \"\$(docker exec sc-recette-pg psql -U smart -d smartcourse -tAc \"SELECT multi_lists_enabled FROM families WHERE code='$FAMILY'\")\" = t && ! $UI has 'introuvable'"
$UI tap "Gestion du budget" >/dev/null; sleep 3
$UI tap "Changer de devise" >/dev/null; sleep 3
expect "X2. choix de devise ouvert : liste des devises avec leurs pays" bash -c "$UI has 'Devise de la famille' && $UI has 'EUR' && $UI has 'France'"
shot final-x1-devises
$UI tap "EUR" --scroll >/dev/null; sleep 2
expect "X3. devise sélectionnée affichée, confirmation possible" bash -c "$UI has 'EUR' && $UI enabled 'Confirmer la devise et activer'"
$UI tap "Confirmer la devise et activer" >/dev/null; sleep 5
expect "X4. budget activé avec la devise choisie ($(FEAT))" test "$(FEAT)" = "true:true:EUR"
launch; $UI wait "Ma liste" 25 >/dev/null; sleep 2
tapt "Réglages"; $UI tap "Paramètres avancés" --scroll >/dev/null; sleep 3
expect "X5. après fermeture et réouverture : options toujours activées, onglet Budget présent" bash -c "$UI has 'Activée' && $UI has 'Réglages du budget' && $UI has 'Budget'"
shot final-x2-apres-reouverture
api PUT /api/family/features -d '{"multiLists":false,"budget":false}' >/dev/null
logout
fi

if want_s B; then
echo "═══ B. Budget : activation, paiements pendant les courses, clôture sans double débit, vue d'ensemble — contrôle court ═══" | tee -a "$OUT/resultats.txt"
login_api adil 482913
closeall_api; api PUT /api/family/features -d '{"multiLists":false,"budget":false}' >/dev/null
add_api Tomates 2
LISTB=$(api GET /api/lists/active >/dev/null; jq -r '.list.id' /tmp/api.out)
OPS() { sql "SELECT coalesce(string_agg(m.name||':'||o.amount_minor, ',' ORDER BY m.name),'') FROM finance_operations o JOIN finance_merchants m ON m.id=o.merchant_id WHERE o.list_id='$LISTB' AND o.voided_at IS NULL"; }
launch; $UI wait "Bienvenue" 25 >/dev/null
signin "$FAMILY" adil 482913; $UI wait "Ma liste" 25 >/dev/null
expect "B0. option désactivée : aucun onglet Budget ni « Saisir un paiement »" bash -c "! $UI has 'Budget' && ! $UI has 'Saisir un paiement'"
tapt "Réglages"; $UI tap "Paramètres avancés" --scroll >/dev/null; sleep 2
$UI tap "Gestion du budget" >/dev/null; sleep 3
$UI has "Choisir la devise" && { $UI tap "Choisir la devise" >/dev/null; sleep 2; $UI tap "MAD" --scroll >/dev/null; sleep 2; }
expect "B1. activation : devise à confirmer, figée dès la première opération" bash -c "$UI has 'MAD' && $UI has 'ne pourra plus être changée'"
shot final-b1-activation
$UI tap "Confirmer la devise et activer" >/dev/null; sleep 5
expect "B1b. activée côté serveur, devise MAD" test "$(sql "SELECT f.budget_enabled||':'||s.currency FROM families f JOIN finance_settings s ON s.family_id=f.id WHERE f.code='$FAMILY'")" = "true:MAD"
adb shell input keyevent KEYCODE_BACK; sleep 2; tapt "Liste"; sleep 3
$UI tap "Plus d'actions" >/dev/null; sleep 2
expect "B2. menu de la liste : « Saisir un paiement »" $UI has "Saisir un paiement"
$UI tap "Saisir un paiement" >/dev/null; sleep 3
$UI tap "Carrefour" >/dev/null; sleep 1
fill "Montant payé" "450"; hide_kb
shot final-b2-paiement
$UI tap "Enregistrer la dépense" --scroll >/dev/null; sleep 5
expect "B3. dépense Courses enregistrée et rattachée à la liste en cours ($(OPS))" test "$(OPS)" = "Carrefour:45000"
$UI tap "Plus d'actions" >/dev/null; sleep 2; $UI tap "Saisir un paiement" >/dev/null; sleep 3
$UI tap "BIM" >/dev/null; sleep 1; fill "Montant payé" "320"; hide_kb
$UI tap "Enregistrer la dépense" --scroll >/dev/null; sleep 5
$UI tap "Plus d'actions" >/dev/null; sleep 2; $UI tap "Clôturer la liste" >/dev/null; sleep 4
expect "B4. clôture : paiements déjà saisis et total de la liste (770,00 DH), rien à ressaisir" bash -c "$UI has 'Paiements enregistrés' && $UI has 'Total de la liste' && $UI has '770,00 DH' && $UI has 'Confirmer et clôturer'"
shot final-b3-cloture
$UI tap "Confirmer et clôturer" --scroll >/dev/null; sleep 6
expect "B5. liste clôturée, paiements confirmés complets, aucun débit supplémentaire ($(OPS))" bash -c "test \"\$(docker exec sc-recette-pg psql -U smart -d smartcourse -tAc \"SELECT status FROM lists WHERE id='$LISTB'\")\" = archived && test \"\$(docker exec sc-recette-pg psql -U smart -d smartcourse -tAc \"SELECT count(*) FROM list_payment_status WHERE list_id='$LISTB'\")\" = 1" && test "$(OPS)" = "BIM:32000,Carrefour:45000"
tapt "Budget"; sleep 4
expect "B6. vue d'ensemble : dépenses du mois 770,00 DH (Courses), entrées séparées" bash -c "$UI has 'Dépenses du mois' && $UI has '770,00 DH' && $UI has 'Entrées du mois'"
shot final-b4-vue-ensemble
api PUT /api/family/features -d '{"budget":false}' >/dev/null
logout
fi

if want_s W; then
echo "═══ W. Recommander vers une liste choisie (plusieurs listes actives) — contrôle ciblé ═══" | tee -a "$OUT/resultats.txt"
login_api adil 482913
closeall_api; api PUT /api/family/features -d '{"multiLists":true}' >/dev/null
# Commande passée : Tomates 3 et Oignons 1, achetées puis archivées
add_api Tomates 3; add_api Oignons 1
api GET /api/lists/active >/dev/null; OLDW=$(jq -r '.list.id' /tmp/api.out)
for it in $(jq -r '.list.items[].id' /tmp/api.out); do api POST "/api/lists/$OLDW/ops" -d "{\"ops\":[{\"opId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"type\":\"purchase\",\"itemId\":\"$it\"}]}" >/dev/null; done
api POST "/api/lists/$OLDW/close" -d '{}' >/dev/null
# Deux listes en cours : « Souk » (Carottes) et « Epicerie » (vide, consultée en dernier)
api POST /api/lists -d '{"name":"Souk"}' >/dev/null; SOUK=$(jq -r '.list.id' /tmp/api.out); add_api Carottes 1 "/api/lists/$SOUK/ops"
api POST /api/lists -d '{"name":"Epicerie"}' >/dev/null; EPI=$(jq -r '.list.id' /tmp/api.out)
CONTENT() { sql "SELECT coalesce(string_agg(p.name||':'||i.quantity, ',' ORDER BY p.name),'') FROM list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id='$1' AND i.status<>'removed'"; }
OLDW0=$(CONTENT "$OLDW")
launch; $UI wait "Bienvenue" 25 >/dev/null
signin "$FAMILY" adil 482913; $UI wait "Ma liste" 25 >/dev/null
tapt "Historique"; $UI wait "Recommander" 15 >/dev/null
$UI tap "Recommander" >/dev/null; sleep 4
expect "W1. destination demandée : listes en cours et nouvelle liste" bash -c "$UI has 'Recommander dans' && $UI has 'Souk' && $UI has 'Epicerie' && $UI has 'Nouvelle liste'"
shot final-w1-destination
$UI tap "Souk" --last >/dev/null; sleep 5
expect "W2. liste choisie non vide : Ajouter / Remplacer proposé" $UI has "Ajouter à la liste actuelle"
$UI tap "Ajouter à la liste actuelle" >/dev/null; sleep 6
expect "W3. articles ajoutés à « Souk » seulement ($(CONTENT "$SOUK"))" bash -c "test \"$(CONTENT "$SOUK")\" = 'Carottes:1.000,Oignons:1.000,Tomates:3.000' && test -z \"$(CONTENT "$EPI")\""
expect "W4. commande d'origine intacte" test "$(CONTENT "$OLDW")" = "$OLDW0"
closeall_api; api PUT /api/family/features -d '{"multiLists":false}' >/dev/null
logout
fi

if want_s Q; then
echo "═══ Q. Rappel d'achat : programmé puis reçu à l'horaire (horloge de l'émulateur avancée) — contrôle court ═══" | tee -a "$OUT/resultats.txt"
login_api adil 482913
closeall_api; api PUT /api/family/features -d '{"multiLists":false}' >/dev/null
add_api Tomates 2
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS 2>/dev/null
launch; $UI wait "Bienvenue" 25 >/dev/null
signin "$FAMILY" adil 482913; $UI wait "Ma liste" 25 >/dev/null
tapt "Réglages"; $UI tap "Notifications et rappels" --scroll >/dev/null; sleep 3
$UI tap "Me rappeler les articles restants" --scroll >/dev/null; sleep 3
expect "Q1. rappel activé (18:00, tous les jours), limite affichée : peut être différé par Android" bash -c "$UI has '18:00' && $UI has 'différés par Android'"
shot final-q1-rappel
expect "Q2. réveil programmé auprès d'Android (sans alarme exacte)" bash -c "adb shell dumpsys alarm | grep -q 'app.smartcourse.courses.natif'"
adb shell input keyevent KEYCODE_HOME; sleep 1
adb root >/dev/null 2>&1; sleep 3; adb wait-for-device
adb shell settings put global auto_time 0
D=$(adb shell date +%m%d%Y | tr -d '\r')
adb shell date "${D:0:4}1759${D:4:4}.50" >/dev/null
GOT=""
for i in $(seq 1 70); do adb shell dumpsys notification --noredact 2>/dev/null | grep -q "Il reste 1 article à acheter" && { GOT=1; break; }; sleep 10; done
echo "      reçu après environ $(( i * 10 )) s (horloge réglée à 17:59:50 ; Android peut différer)" | tee -a "$OUT/resultats.txt"
expect "Q3. notification reçue : « Il reste 1 article à acheter », sans montant" bash -c "test -n '$GOT' && ! adb shell dumpsys notification --noredact | grep -A3 'Il reste 1 article' | grep -q 'DH'"
adb shell cmd statusbar expand-notifications; sleep 2; shot final-q2-notification; adb shell cmd statusbar collapse
adb shell settings put global auto_time 1
fi

# Achat enregistré par l'API (article ajouté puis coché) ; $3 = date d'achat (SQL), facultative
buy_api() {
  add_api "$1" "$2"
  local item; item=$(sql "SELECT i.id FROM list_items i JOIN lists l ON l.id=i.list_id JOIN families f ON f.id=l.family_id JOIN products p ON p.id=i.product_id WHERE f.code='$FAMILY' AND l.status='active' AND p.name='$1' AND i.status='to_buy'")
  [ -z "$item" ] && { api POST /api/lists/active/ops -d "{\"ops\":[{\"opId\":\"$(uuid)\",\"type\":\"request_again\",\"productId\":\"$(pid_of "$1")\",\"quantity\":$2}]}" >/dev/null
    item=$(sql "SELECT i.id FROM list_items i JOIN lists l ON l.id=i.list_id JOIN families f ON f.id=l.family_id JOIN products p ON p.id=i.product_id WHERE f.code='$FAMILY' AND l.status='active' AND p.name='$1' AND i.status='to_buy'"); }
  api POST /api/lists/active/ops -d "{\"ops\":[{\"opId\":\"$(uuid)\",\"type\":\"purchase\",\"itemId\":\"$item\"}]}" >/dev/null
  [ -n "${3:-}" ] && sql "UPDATE purchases SET purchased_at = $3 WHERE list_item_id='$item' AND voided_at IS NULL" >/dev/null
  return 0
}
uuid() { cat /proc/sys/kernel/random/uuid; }

if want_s U; then
echo "═══ U. Unités corrigées : décimales au kg, lignes existantes jamais réinterprétées, prix à ressaisir ═══" | tee -a "$OUT/resultats.txt"
login_api adil 482913
closeall_api; api PUT /api/family/features -d '{"multiLists":false}' >/dev/null
expect "U0. unités arbitrées dans la famille : riz/cumin au poids, persil en botte, poulet entier à la pièce, lait et huile au litre, thon en boîte, papier toilette en rouleau" test "$(sql "SELECT string_agg(p.name||':'||p.unit, ',' ORDER BY p.name) FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.name IN ('Riz','Cumin','Persil','Poulet','Lait','Huile de table','Thon en conserve','Papier toilette')")" = "Cumin:kg,Huile de table:litre,Lait:litre,Papier toilette:rouleau,Persil:botte,Poulet:piece,Riz:kg,Thon en conserve:boite"
add_api Cumin 0.25
add_api Riz 2
# Ligne de riz créée AVANT la correction (en paquets) : elle doit rester « 2 paquets »
sql "UPDATE list_items SET unit='paquet' WHERE id=(SELECT i.id FROM list_items i JOIN lists l ON l.id=i.list_id JOIN families f ON f.id=l.family_id JOIN products p ON p.id=i.product_id WHERE f.code='$FAMILY' AND l.status='active' AND p.name='Riz')" >/dev/null
# Ancien prix de famille du poulet au kg (le poulet est maintenant à la pièce) : conservé, jamais converti
sql "INSERT INTO family_prices (family_id, product_id, amount, ref_qty, ref_unit) SELECT f.id, p.id, 70, 1, 'kg' FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.name='Poulet' ON CONFLICT (family_id, product_id) DO UPDATE SET amount=70, ref_qty=1, ref_unit='kg', packaging=NULL, piece_weight_g=NULL" >/dev/null
launch; $UI wait "Bienvenue" 25 >/dev/null
signin "$FAMILY" adil 482913; $UI wait "Ma liste" 25 >/dev/null; sleep 2
expect "U1. 0,25 kg de cumin accepté et affiché (250 g)" $UI wait "250 g" 15
RIZ=$(st Riz)
expect "U2. ligne de riz enregistrée en paquets : toujours « 2 paquets » (jamais « 2 g » ni « 2 kg »)" bash -c "$UI has '2 paquets' && ! $UI has '2 g' && test '$RIZ' = '2.000 paquet to_buy'"
shot final-u1-liste-unites
# Modifier la quantité de cette ligne garde son unité (appui sur la ligne, pas sur la case « Acheté »)
$UI tap "2 paquets" >/dev/null; sleep 2
expect "U3. quantité de la ligne modifiée dans SON unité (paquets)" $UI wait "Se compte en paquets" 8
$UI has "Se compte en paquets" && { adb shell input keyevent KEYCODE_BACK; sleep 2; }
back_to_app
tapt "Réglages"; $UI tap "Gestion des prix" --scroll >/dev/null; sleep 3
fill "Rechercher un produit" "Poulet"; hide_kb; sleep 3
expect "U4. ancien prix au kg du poulet signalé « à ressaisir », jamais affiché comme prix actuel" bash -c "$UI wait 'prix à ressaisir' 10 && ! $UI has '70,00 DH / kg'"
$UI tap "Ajouter un prix" >/dev/null || $UI tap "Poulet" --last >/dev/null; sleep 3
expect "U5. formulaire : ancien prix rappelé à part, montant vide (aucune reprise avec la nouvelle unité)" bash -c "$UI wait 'Ancien prix : 70,00 DH / kg' 10 && $UI has 'ne peut pas être converti'"
shot final-u2-prix-a-ressaisir
for _ in 1 2 3; do $UI has "Ancien prix" || break; adb shell input keyevent KEYCODE_BACK; sleep 1; done   # clavier puis panneau
expect "U6. serveur : ancien prix conservé tel quel" test "$(sql "SELECT fp.amount||' '||fp.ref_unit FROM family_prices fp JOIN products p ON p.id=fp.product_id JOIN families f ON f.id=fp.family_id WHERE f.code='$FAMILY' AND p.name='Poulet'")" = "70.00 kg"
# Prix commun converti exactement (9,90 DH pour 500 g, jamais arrondi à 20 DH/kg) ; format du produit facultatif
back_to_app; $UI has "Rechercher un produit" || { tapt "Réglages"; $UI tap "Gestion des prix" --scroll >/dev/null; sleep 3; }
fill "Rechercher un produit" "Vermicelles"; hide_kb; sleep 3
expect "U7. vermicelles : prix converti exactement « 9,90 DH / 500 g »" $UI wait "9,90 DH / 500 g" 10
fill "Rechercher un produit" "Thon"; hide_kb; sleep 3
$UI tap "11,17 DH" >/dev/null; sleep 3
fill "Format du produit" "boîte de 80 g"; hide_kb; sleep 1
$UI tap "Enregistrer" --last >/dev/null; sleep 4
expect "U8. format « boîte de 80 g » enregistré ; unité inchangée ; aucun prix personnel créé (prix commun conservé)" test "$(sql "SELECT p.format||'|'||p.unit||'|'||(SELECT count(*) FROM family_prices fp WHERE fp.product_id=p.id) FROM products p JOIN families f ON f.id=p.family_id WHERE f.code='$FAMILY' AND p.name='Thon en conserve'")" = "boîte de 80 g|boite|0"
shot final-u3-format
fi

if want_s L; then
echo "═══ L. Statistiques : tous les produits achetés, recherche, historique d'un produit, tout l'historique ═══" | tee -a "$OUT/resultats.txt"
login_api adil 482913
closeall_api; api PUT /api/family/features -d '{"multiLists":false}' >/dev/null
FID=$(sql "SELECT id FROM families WHERE code='$FAMILY'")
# Neuf produits achetés deux fois ce mois ; Cumin une fois ce mois (10e, hors de l'aperçu) et une fois il y a deux mois
for n in Tomates Lait Oignons Carottes Pommes Bananes Sucre Farine Beurre; do buy_api "$n" 1 "now() - interval '1 hour'"; buy_api "$n" 1 "now() - interval '2 hours'"; done
buy_api Cumin 0.25 "now() - interval '3 hours'"
buy_api Cumin 0.5 "date_trunc('month', now()) - interval '40 days'"
# Attendus calculés sur la base (d'autres sections ont pu acheter avant) : produits achetés ce mois, achats de cumin
NP=$(sql "SELECT count(DISTINCT product_id) FROM purchases WHERE family_id='$FID' AND voided_at IS NULL AND purchased_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Casablanca') AT TIME ZONE 'Africa/Casablanca'")
NC=$(sql "SELECT count(*) FROM purchases pu JOIN products p ON p.id=pu.product_id WHERE pu.family_id='$FID' AND pu.voided_at IS NULL AND p.name='Cumin'")
NCM=$(sql "SELECT count(*) FROM purchases pu JOIN products p ON p.id=pu.product_id WHERE pu.family_id='$FID' AND pu.voided_at IS NULL AND p.name='Cumin' AND pu.purchased_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Casablanca') AT TIME ZONE 'Africa/Casablanca'")
echo "      produits achetés ce mois : $NP ; achats de cumin : $NCM ce mois, $NC en tout" | tee -a "$OUT/resultats.txt"
expect "L0. jeu d'essai : au moins 10 produits ce mois, cumin acheté 1 fois ce mois et 2 fois en tout" test "$NP" -ge 10 -a "$NCM" = 1 -a "$NC" = 2
launch; $UI wait "Bienvenue" 25 >/dev/null
signin "$FAMILY" adil 482913; $UI wait "Ma liste" 25 >/dev/null
tapt "Statistiques"; $UI wait "Produits les plus achetés" 20 >/dev/null
expect "L1. aperçu conservé (8 produits, Cumin absent) et bouton « Voir tous les produits ($NP) »" bash -c "! $UI has 'Cumin' && $UI tap 'Voir tous les produits ($NP)' --scroll >/dev/null"
expect "L2. écran « Tous les produits achetés » avec la période affichée" bash -c "$UI wait 'Tous les produits achetés' 10 && $UI has 'Ce mois' && $UI has '$NP produits'"
shot final-l1-tous-les-produits
fill "Rechercher un produit" "CUMI"; hide_kb; sleep 2
expect "L3. recherche (majuscules ignorées) : Cumin, hors du top 8, trouvé avec « 1 achat » et sa quantité" bash -c "$UI has 'Cumin' && $UI has '1 achat' && $UI has '250 g' && $UI has '1 sur $NP'"
shot final-l2-recherche
$UI tap "Cumin" >/dev/null; sleep 3
expect "L4. historique du produit : période choisie, 1 achat de 250 g avec sa date" bash -c "$UI wait 'Historique des achats' 10 && $UI has '250 g' && $UI has '1 achat'"
shot final-l3-historique
$UI tap "Tout l'historique" >/dev/null; sleep 3
expect "L5. « Tout l'historique » : l'achat plus ancien apparaît (2 achats, 750 g cumulés)" bash -c "$UI wait '2 achats' 10 && $UI has '500 g' && $UI has '750 g'"
shot final-l4-tout-historique
adb shell input keyevent KEYCODE_BACK; sleep 2
expect "L6. retour : liste complète, recherche « CUMI » conservée" bash -c "$UI wait 'Tous les produits achetés' 10 && $UI has 'CUMI' && $UI has '1 sur $NP'"
fill "Rechercher un produit" "zzz"; hide_kb; sleep 2
expect "L7. aucune correspondance : message explicite" $UI wait "Aucun produit acheté ne correspond à votre recherche" 10
$UI tap "Effacer la recherche" >/dev/null; sleep 2
expect "L8. recherche effacée : tous les produits ($NP)" $UI wait "$NP produits" 10
fi

if want_s Z; then
echo "═══ Z. Mise à jour de l'application : aucune, conseillée, obligatoire, annulée ; panne réseau sans blocage ═══" | tee -a "$OUT/resultats.txt"
FID=$(sql "SELECT id FROM families WHERE code='$FAMILY'")
sql "INSERT INTO catalog_managers (profile_id) SELECT id FROM profiles WHERE family_id='$FID' AND login='adil' ON CONFLICT DO NOTHING" >/dev/null
login_api adil 482913
VC=$(adb shell dumpsys package $PKG | grep -m1 -oE "versionCode=[0-9]+" | cut -d= -f2)
echo "      versionCode installé : $VC" | tee -a "$OUT/resultats.txt"
policy() { api PUT /api/gestion/app-update -d "$1" >/dev/null; }
policy '{"latestVersionCode":null,"minVersionCode":null}'
closeall_api; add_api Tomates 2
launch
expect "Z1. version à jour : aucun message" bash -c "sleep 6; ! $UI has 'Une nouvelle version' && ! $UI has 'Pour continuer à utiliser'"
policy "{\"latestVersionCode\":$((VC+1)),\"minVersionCode\":null}"
launch
expect "Z2. mise à jour conseillée : message et « Plus tard »" bash -c "$UI wait 'Une nouvelle version de Mes Courses est disponible.' 15 && $UI has 'Plus tard' && $UI has 'Mettre à jour'"
shot final-z1-conseillee
$UI tap "Plus tard" >/dev/null; sleep 2
$UI has "Bienvenue" && signin "$FAMILY" adil 482913
expect "Z3. reportée : l'application s'utilise, le message ne revient pas à chaque écran" bash -c "$UI wait 'Ma liste' 20 && $UI gone 'Une nouvelle version' 3"
tapt "Historique"; tapt "Liste"
expect "Z3b. toujours pas de message après un changement d'écran" $UI gone "Une nouvelle version" 3
expect "Z4. obligation refusée sans confirmation de disponibilité sur Google Play" test "$(api PUT /api/gestion/app-update -d "{\"latestVersionCode\":$((VC+1)),\"minVersionCode\":$((VC+1))}")" = 400
policy "{\"latestVersionCode\":$((VC+1)),\"minVersionCode\":$((VC+1)),\"availableOnPlay\":true}"
# Vérification au plus toutes les 30 min au premier plan : l'obligation est vue à la prochaine ouverture de l'application
adb shell input keyevent KEYCODE_HOME; sleep 2; adb shell am start -n "$ACT" >/dev/null 2>&1; sleep 4
expect "Z4b. retour au premier plan moins de 30 min après : pas de nouvelle vérification (fréquence raisonnable)" $UI gone "Pour continuer à utiliser" 3
launch
expect "Z5. mise à jour obligatoire (à l'ouverture de l'application) : accès bloqué, message attendu" bash -c "$UI wait 'Pour continuer à utiliser Mes Courses, veuillez mettre à jour' 15 && $UI has 'Vos données seront conservées'"
shot final-z2-obligatoire
adb logcat -c
$UI tap "Mettre à jour" >/dev/null; sleep 5
expect "Z6. « Mettre à jour » ouvre la fiche Mes Courses (Google Play, sinon navigateur)" bash -c "adb logcat -d -s CoursesUpdate:I | grep -qE 'ouverte : (market://details\?id=|https://play.google.com/store/apps/details\?id=)app.smartcourse.courses.natif'"
adb logcat -d -s CoursesUpdate:I | tail -3 | tee -a "$OUT/resultats.txt"
back_to_app; sleep 3
expect "Z7. retour sans mise à jour : blocage maintenu" $UI wait "Pour continuer à utiliser Mes Courses" 15
adb shell input keyevent KEYCODE_BACK; sleep 2; adb shell am start -n "$ACT" >/dev/null 2>&1; sleep 4
expect "Z7b. le bouton Retour ne contourne pas le blocage" $UI wait "Pour continuer à utiliser Mes Courses" 15
# Panne réseau : l'application relancée n'est jamais bloquée faute de pouvoir vérifier
adb shell am force-stop $PKG
adb shell cmd connectivity airplane-mode enable >/dev/null 2>&1; adb shell svc wifi disable >/dev/null 2>&1; adb shell svc data disable >/dev/null 2>&1; sleep 4
adb shell am start -W -n "$ACT" >/dev/null 2>&1; sleep 6
expect "Z8. panne réseau : aucun faux blocage" bash -c "sleep 8; ! $UI has 'Pour continuer à utiliser'"
shot final-z3-hors-connexion
adb shell cmd connectivity airplane-mode disable >/dev/null 2>&1; adb shell svc wifi enable >/dev/null 2>&1; adb shell svc data enable >/dev/null 2>&1; sleep 8
# Annulation de l'obligation côté serveur : effet immédiat au retour dans l'application
policy "{\"latestVersionCode\":$((VC+1)),\"minVersionCode\":null}"
adb shell input keyevent KEYCODE_HOME; sleep 2; adb shell am start -n "$ACT" >/dev/null 2>&1; sleep 5
expect "Z9. obligation annulée : accès rétabli" bash -c "$UI gone 'Pour continuer à utiliser' 8 && $UI wait 'Ma liste' 10"
# « Après mise à jour » : la version installée atteint la version exigée
policy "{\"latestVersionCode\":$VC,\"minVersionCode\":$VC,\"availableOnPlay\":true}"
launch; sleep 3
expect "Z10. version installée = version minimale : accès normal, aucun message" bash -c "$UI gone 'Pour continuer à utiliser' 8 && $UI gone 'Une nouvelle version' 3"
TOM=$(st Tomates)
expect "Z11. données conservées : la liste garde ses articles" bash -c "$UI has 'Tomates' && test '$TOM' = '2.000 kg to_buy'"
policy '{"latestVersionCode":null,"minVersionCode":null}'
fi

echo "ECHECS=$FAILS" | tee -a "$OUT/resultats.txt"
adb logcat -d -b crash > "$OUT/logcat-crash.txt" 2>&1 || true
echo "CRASH_APPLICATION=$(grep -c app.smartcourse "$OUT/logcat-crash.txt")" | tee -a "$OUT/resultats.txt"
grep -A1 -E "^FAIL" "$OUT/resultats.txt" | cut -c1-400 || true
[ "$FAILS" = 0 ]
