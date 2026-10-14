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
tf_login() { # $1 famille, $2 identifiant, $3 code : formulaire rempli et vérifié, puis envoyé
  tf_text "${PREV_FAMILY:-Code famille}" "$1" || return 1; PREV_FAMILY="$1"
  tf_text "${PREV_LOGIN:-Identifiant}" "$2" || return 1; PREV_LOGIN="$2"
  tf_secret "$3" || return 1
  $UI tap "Se connecter" --last >/dev/null; sleep 4
}
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
expect "C1. formulaire direct (aucun lien, jeton ni serveur)" bash -c "$UI wait 'Nom de la famille' 10 && ! $UI has 'jeton' && ! $UI has 'installé le serveur' && ! $UI has 'Serveur'"
fill "Nom de la famille" "Famille Benali" --scroll; hide_kb
fill "Votre prénom" "Karim" --scroll; hide_kb
fill "Votre identifiant" "$NEWLOGIN" --scroll; hide_kb
# Ville choisie sans ambiguïté (la liste contient « Casablanca » et « Casablanca Anfa ») : la valeur attendue en base est exactement celle-ci.
NEWCITY="Casablanca Anfa"
$UI tap "Ville : " --scroll >/dev/null; sleep 2; fill "Rechercher une ville" "anfa"; hide_kb; $UI tap "$NEWCITY" --last >/dev/null; sleep 2
expect "C1b. ville choisie affichée dans le formulaire" $UI has "Ville : $NEWCITY"
fill "E-mail de récupération" "$NEWMAIL" --scroll; hide_kb
fill "Code d'accès (6" 274915 --scroll; hide_kb
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
expect "C5. famille créée et utilisateur connecté : code famille affiché" $UI wait "Votre famille est créée" 20
NEWCODE=$(sql "SELECT f.code FROM families f JOIN profiles p ON p.family_id=f.id WHERE p.recovery_email='$NEWMAIL'")
expect "C5b. code famille généré ($NEWCODE) affiché à l'écran" $UI has "${NEWCODE:-ABSENT}"
NBF=$(sql "SELECT count(*) FROM families"); PROF=$(sql "SELECT p.is_primary::text||' '||(p.recovery_email_verified_at IS NOT NULL)::text||' '||p.city||' '||p.login FROM profiles p WHERE p.recovery_email='$NEWMAIL'")
expect "C5c. serveur : une seule famille créée ($FAM_BEFORE → $NBF)" test "$NBF" = "$((FAM_BEFORE + 1))"
expect "C5d. serveur : administrateur principal, adresse vérifiée, ville, identifiant (attendu « true true $NEWCITY $NEWLOGIN », obtenu « $PROF »)" test "$PROF" = "true true $NEWCITY $NEWLOGIN"
shot final-c3-famille-creee
$UI tap "Copier" >/dev/null
expect "C6. Copier : confirmation visible dans le panneau" $UI wait "Code famille copié" 8
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
# Après déconnexion, le formulaire est déjà rempli avec le code famille et l'identifiant du dernier profil : seul le code d'accès est saisi.
expect "C10. formulaire de connexion prérempli avec le code famille généré" bash -c "$UI has '$NEWCODE' && $UI has '$NEWLOGIN'"
fill "Code d'accès" 274915; hide_kb
$UI tap "Se connecter" --last >/dev/null; sleep 4; PREV_FAMILY="$NEWCODE"; PREV_LOGIN="$NEWLOGIN"
expect "C10b. connecté à la nouvelle famille avec ses accès" $UI wait "Ma liste" 20
logout
# Plafond quotidien (100 familles par défaut) atteint : base de recette JETABLE remplie de 100 créations fictives du jour
sql "INSERT INTO family_signups (request_id, email, email_hash, family_name, display_name, login, city, secret_hash, code_hash, expires_at, completed_at)
     SELECT gen_random_uuid(), 'plafond'||g||'@example.org', md5('plafond'||g), 'P', 'P', 'p', 'Casablanca', 'x', 'x', now(), now() FROM generate_series(1, 100) g" >/dev/null
CAPMAIL="plafond.$(date +%s)@example.org"
$UI tap "Première connexion" >/dev/null; sleep 1; $UI tap "Créer ma famille" >/dev/null; sleep 2
fill "Nom de la famille" "Famille Plafond" --scroll; hide_kb; fill "Votre prénom" "Nadia" --scroll; hide_kb; fill "Votre identifiant" "nadia" --scroll; hide_kb
$UI tap "Ville : " --scroll >/dev/null; sleep 2; fill "Rechercher une ville" "rabat"; hide_kb; $UI tap "Rabat" --last >/dev/null; sleep 2
fill "E-mail de récupération" "$CAPMAIL" --scroll; hide_kb; fill "Code d'accès (6" 583014 --scroll; hide_kb; fill "Confirmez le code" 583014 --scroll; hide_kb
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
if want_s P; then
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
adb shell input text 9; sleep 1
expect "K2c. 6 chiffres au plus (le 7e est ignoré)" bash -c "$UI has '047193' && ! $UI has '0471939'"
shot final-k1-code-visible
$UI tap "Masquer le code" >/dev/null; sleep 1
expect "K3. code remasqué" bash -c "! $UI has '047193'"
$UI tap "•" >/dev/null; clear_field; hide_kb
fi

if want_s S; then
echo "═══ S. Partager l'accès d'un membre (famille JETABLE) ═══" | tee -a "$OUT/resultats.txt"
export -f sql   # utilisée dans les contrôles « bash -c »
FID=$(sql "SELECT id FROM families WHERE code='$FAMILY'")
launch; $UI wait "Bienvenue" 25 >/dev/null
check_or_stop() { local l=$1; shift; if "$@"; then ok "$l"; else ko "$l${T_ERR:+ — $T_ERR}"; fi; T_ERR=""; }
check_or_stop "S0. administrateur connecté (saisies vérifiées)" tf_login "$FAMILY" adil 482913
$UI wait "Compte" 25 >/dev/null
tapt "Réglages"; tapt "Profils"
expect "S1. code famille affiché avec « Partager le code famille » et « Copier »" bash -c "$UI wait 'Code famille : $FAMILY' 15 && $UI has 'Partager le code famille' && $UI has 'Copier'"
expect "S1b. son propre profil : partage impossible" bash -c "$UI tap 'Actions pour Adil' >/dev/null; sleep 1; $UI has 'Partage impossible'"
adb shell input keyevent KEYCODE_BACK; sleep 1
# Création d'un membre (code commençant par zéro), clavier numérique, puis partage proposé tout de suite
tapt "Ajouter un profil"
fill "Nom affiché" "Zoe"; hide_kb; fill "Identifiant de connexion" zoe; hide_kb
$UI tap "Personnel" >/dev/null; sleep 1
expect "S1c. ville reprise de l'administrateur" $UI has "Ville : Casablanca"
$UI tap "Code d'accès (6 chiffres)" --scroll >/dev/null; sleep 1
expect "S2. création : clavier numérique ($(ime_type))" test "$(ime_type)" = 0x12
adb shell input text 047193; hide_kb
fill "Confirmer le code" 047193 --scroll; hide_kb
$UI tap "Afficher le code" >/dev/null; sleep 1
expect "S2b. code saisi avec son zéro initial (047193)" $UI has "047193"
$UI tap "Masquer le code" >/dev/null; sleep 1
$UI tap "Créer le profil" --scroll >/dev/null; sleep 5
expect "S3. partage proposé dès la création" bash -c "$UI wait \"Partager l'accès de Zoe\" 15 && $UI has 'Code famille : $FAMILY' && $UI has 'Identifiant : zoe' && $UI has \"Code d'accès : 047193\""
expect "S3b. serveur : profil créé, code non stocké en clair" bash -c "test \"\$(sql \"SELECT count(*) FROM profiles WHERE family_id='$FID' AND login='zoe' AND secret_hash NOT LIKE '%047193%'\")\" = 1"
shot final-s1-partage-apres-creation
adb logcat -c
$UI tap "Partager l'accès" --last >/dev/null; sleep 3
expect "S4. sans WhatsApp : partage Android ouvert (rien n'est envoyé)" test "$(started 'android.intent.action.CHOOSER')" -ge 1
shot final-s2-partage-android
expect "S4c. panneau de partage refermé sans rien envoyer, retour à l'application" back_to_app
$UI tap "Copier les informations" >/dev/null; sleep 1
expect "S4b. « Copier les informations »" $UI wait "Informations copiées" 5
$UI tap "Fermer" --last >/dev/null; sleep 2
# L'émulateur Google ouvre parfois, quelques secondes après le panneau de partage, l'accueil de Quick Share (hors application) :
# il est refermé avant de continuer.
sleep 6; back_to_app
expect "S5. le code partagé fonctionne (zéro initial) : connexion de Zoé" test "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d "{\"familyCode\":\"$FAMILY\",\"login\":\"zoe\",\"secret\":\"047193\"}")" = 200
# Profil existant : le code n'est pas récupérable ; annulation sans aucun changement
HASH0=$(sql "SELECT secret_hash FROM profiles WHERE family_id='$FID' AND login='zoe'")
$UI tap "Actions pour Zoe" >/dev/null; sleep 1
expect "S6. menu : « Partager l'accès » (rien ne change à l'ouverture)" bash -c "$UI has \"Partager l'accès\" && test \"\$(sql \"SELECT secret_hash FROM profiles WHERE family_id='$FID' AND login='zoe'\")\" = '$HASH0'"
$UI tap "Partager l'accès" >/dev/null; sleep 2
expect "S6b. explication : code non conservé, l'ancien cessera de fonctionner" bash -c "$UI has 'pas conservé en clair' && $UI has \"L'ancien code cessera de fonctionner\""
shot final-s3-nouveau-code-confirmation
$UI tap "Annuler" >/dev/null; sleep 2
expect "S6c. annulation : code inchangé (empreinte identique, connexion 047193 toujours valable)" bash -c "test \"\$(sql \"SELECT secret_hash FROM profiles WHERE family_id='$FID' AND login='zoe'\")\" = '$HASH0' && test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$FAMILY\",\"login\":\"zoe\",\"secret\":\"047193\"}')\" = 200"
# Avec WhatsApp (application d'essai portant l'identifiant com.whatsapp) : nouveau code après confirmation, puis partage
if [ -n "${WA_STUB:-}" ] && adb install -r "$WA_STUB" >/dev/null 2>&1; then
  back_to_app
  $UI tap "Actions pour Zoe" >/dev/null; sleep 1; $UI tap "Partager l'accès" >/dev/null; sleep 2
  $UI tap "Générer un nouveau code et partager" >/dev/null; sleep 5
  NEWC=$(screen_grep "accès : [0-9]{6}" | grep -oE "[0-9]{6}")   # XML : l'apostrophe y est échappée
  expect "S7. nouveau code généré et affiché ($NEWC)" bash -c "[[ '$NEWC' =~ ^[0-9]{6}$ ]] && test '$NEWC' != 047193"
  expect "S7b. l'ancien code ne fonctionne plus ; le nouveau, si" bash -c "
    test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$FAMILY\",\"login\":\"zoe\",\"secret\":\"047193\"}')\" = 401 &&
    test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{\"familyCode\":\"$FAMILY\",\"login\":\"zoe\",\"secret\":\"$NEWC\"}')\" = 200"
  shot final-s4-nouveau-code-partage
  adb logcat -c
  $UI tap "Partager l'accès" --last >/dev/null; sleep 3
  expect "S8. avec WhatsApp : WhatsApp s'ouvre avec le message (envoi par l'administrateur)" test "$(started 'com.whatsapp')" -ge 1
  back_to_app
  $UI tap "Fermer" --last >/dev/null; sleep 2
  adb logcat -c
  $UI tap "Partager le code famille" >/dev/null; sleep 3
  expect "S9. code famille : WhatsApp s'ouvre" test "$(started 'com.whatsapp')" -ge 1
  back_to_app
  adb uninstall com.whatsapp >/dev/null 2>&1
else
  ko "S7. application d'essai WhatsApp non installée (WA_STUB=${WA_STUB:-absent})"
fi
$UI tap "Copier" --last >/dev/null; sleep 1
expect "S9b. « Copier » le code famille" $UI wait "Copié" 5
shot final-s5-profils-code-famille
logout
fi

if want_s A; then
echo "═══ A. Bouton « Affichage » : 3 présentations × 2 organisations, pour les 3 rôles ═══" | tee -a "$OUT/resultats.txt"
check_or_stop() { local l=$1; shift; if "$@"; then ok "$l"; else ko "$l${T_ERR:+ — $T_ERR}"; fi; T_ERR=""; }
y1() { $UI bounds "$1" | awk '{print $2}'; }
set_display() { # $1 présentation, $2 organisation (libellés du panneau)
  $UI tap "Affichage" >/dev/null; sleep 2
  $UI tap "$1" >/dev/null; sleep 1; $UI tap "$2" >/dev/null; sleep 1
  $UI tap "Fermer" --last >/dev/null; sleep 2
}
check_layout() { # $1 rôle, $2 présentation, $3 organisation
  local a b exp="Affichage : $2, ${3,}"
  if [ "$3" = "Par catégorie" ]; then a=Tomates; b="Pommes de terre"; else a=Ail; b=Assouplissant; fi
  for _ in 1 2 3 4; do adb shell input swipe 540 700 540 1900 150; done; sleep 1
  local d; d=$(show_desc)
  local ya yb; ya=$(y1 "$a"); yb=$(y1 "$b")
  local org_ok=1
  if [ "$3" = "Par catégorie" ]; then $UI has "Légumes et herbes" || org_ok=0; else $UI has "Légumes et herbes" && org_ok=0; fi
  local pres_ok=0
  case "$2" in
    "Petites cartes") [ -n "$ya" ] && [ "$ya" = "$yb" ] && pres_ok=1;;
    Liste) [ -n "$ya" ] && [ -n "$yb" ] && [ $((yb - ya)) -gt 0 ] && [ $((yb - ya)) -lt 400 ] && pres_ok=1;;
    "Grandes cartes") [ -n "$ya" ] && { [ -z "$yb" ] || [ $((yb - ya)) -gt 600 ]; } && pres_ok=1;;
  esac
  expect "A·$1 · $2 · $3 (repère : $d ; $a y=$ya, $b y=${yb:-hors écran})" test "$d" = "$exp" -a "$org_ok" = 1 -a "$pres_ok" = 1
}
run_role() { # $1 rôle (libellé), $2 identifiant, $3 code, $4 écran attendu
  launch; $UI wait "Bienvenue" 25 >/dev/null
  check_or_stop "A0. $1 connecté" tf_login "$FAMILY" "$2" "$3"
  if [ "$4" = admin ]; then $UI wait "Compte" 25 >/dev/null; tapt "Ajouter des articles"; fi
  $UI wait "Affichage" 20 >/dev/null
  # sélection en cours : elle doit survivre à tous les changements d'affichage
  for _ in 1 2 3 4; do adb shell input swipe 540 700 540 1900 150; done
  $UI tap "Oignons" >/dev/null; sleep 2
  for org in "Par catégorie" "Liste globale"; do
    for pres in "Liste" "Petites cartes" "Grandes cartes"; do set_display "$pres" "$org"; check_layout "$1" "$pres" "$org"; done
  done
  expect "A1. $1 : sélection conservée après les 6 changements" $UI has "Terminer ma sélection (1)"
}
run_role "Personnel" marie 573918 staff
shot final-a1-personnel-grandes-cartes-globale
expect "A2. personnel : toujours sans recherche ni onglets" bash -c "! $UI has 'Rechercher un produit' && ! $UI has 'Liste du jour'"
$UI tap "Affichage" >/dev/null; sleep 2; shot final-a2-panneau-affichage; $UI tap "Fermer" --last >/dev/null; sleep 1
set_display "Liste" "Par catégorie"
logout
run_role "Parent" lamiaa 573918 admin
expect "A3. parent : recherche disponible" $UI has "Rechercher un produit"
set_display "Petites cartes" "Liste globale"
shot final-a3-parent-petites-cartes-globale
adb shell input keyevent KEYCODE_BACK; sleep 2; logout
run_role "Administrateur" adil 482913 admin
set_display "Grandes cartes" "Liste globale"
shot final-a4-admin-grandes-cartes-globale
# Mémorisation : autre écran, redémarrage, déconnexion / reconnexion, changement de compte
adb shell input keyevent KEYCODE_BACK; sleep 2; tapt "Historique"; tapt "Liste"; tapt "Ajouter des articles"
expect "A4. après un changement d'écran (administrateur)" test "$(show_desc)" = "Affichage : Grandes cartes, liste globale"
adb shell am force-stop $PKG; adb shell am start -W -n "$ACT" >/dev/null 2>&1; sleep 4; $UI wait "Compte" 25 >/dev/null; tapt "Ajouter des articles"
expect "A5. après fermeture et réouverture (administrateur)" test "$(show_desc)" = "Affichage : Grandes cartes, liste globale"
adb shell input keyevent KEYCODE_BACK; sleep 2; logout
tf_login "$FAMILY" marie 573918; $UI wait "Affichage" 25 >/dev/null
expect "A6. changement de compte : préférences du personnel, pas celles de l'administrateur" test "$(show_desc)" = "Affichage : Liste, par catégorie"
logout
tf_login "$FAMILY" lamiaa 573918; $UI wait "Compte" 25 >/dev/null; tapt "Ajouter des articles"
expect "A7. parent : ses propres préférences" test "$(show_desc)" = "Affichage : Petites cartes, liste globale"
adb shell input keyevent KEYCODE_BACK; sleep 2; logout
tf_login "$FAMILY" adil 482913; $UI wait "Compte" 25 >/dev/null; tapt "Ajouter des articles"
expect "A8. reconnexion de l'administrateur : ses préférences retrouvées" test "$(show_desc)" = "Affichage : Grandes cartes, liste globale"
adb shell input keyevent KEYCODE_BACK; sleep 2; logout
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
expect "D4b. deux choix : transférer le rôle / supprimer toute la famille" bash -c "$UI has 'Supprimer seulement mon compte' && $UI has 'Transférer le rôle' && $UI has 'Supprimer toute la famille'"
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
echo "ECHECS=$FAILS" | tee -a "$OUT/resultats.txt"
adb logcat -d -b crash > "$OUT/logcat-crash.txt" 2>&1 || true
echo "CRASH_APPLICATION=$(grep -c app.smartcourse "$OUT/logcat-crash.txt")" | tee -a "$OUT/resultats.txt"
grep -A1 -E "^FAIL" "$OUT/resultats.txt" | cut -c1-400 || true
[ "$FAILS" = 0 ]
