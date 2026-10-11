#!/usr/bin/env bash
# Recette de l'APK sur un émulateur Android réel (API 34) : installation, notifications, plein écran vérifié (liens d'application),
# lien d'e-mail reçu, ouverture hors connexion. Aucun identifiant de famille n'est utilisé et rien n'est créé en production :
# le lien d'e-mail essayé porte un faux jeton (le serveur répond « lien plus valable »).
# Usage : scripts/android-emulator-check.sh <adresse de production sans / final>
set -u
URL="$1"; HOST="${URL#https://}"; PKG=app.smartcourse.courses; FAIL=0
ok()   { echo "OK   : $*"; }
ko()   { echo "ECHEC: $*"; FAIL=1; }
cdp()  { node scripts/android-cdp.mjs "$HOST" "$1" 2>&1; }
top()  { adb shell dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | head -1; }

# Chrome sans écrans de première utilisation (image google_apis : accès root pour la ligne de commande de Chrome)
adb root >/dev/null 2>&1 || true
adb shell 'echo "chrome --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line; chmod 755 /data/local/tmp/chrome-command-line' || true
adb shell am set-debug-app --persistent com.android.chrome >/dev/null 2>&1 || true

adb install -r dist/SmartCourse.apk | tail -1
adb shell pm list packages | grep -q "$PKG" && ok "application installée ($PKG)" || ko "installation"
adb shell dumpsys package "$PKG" | grep -m1 versionName
adb shell dumpsys package "$PKG" | grep -m1 targetSdk

echo "== Notifications"
adb shell dumpsys package "$PKG" | grep -q "android.permission.POST_NOTIFICATIONS" && ok "permission POST_NOTIFICATIONS déclarée" || ko "POST_NOTIFICATIONS absente"
adb shell cmd package query-services -a android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE | grep -q "$PKG" && ok "service de délégation des notifications résolu (Chrome peut faire afficher les notifications par l'application)" || ko "service de délégation introuvable"
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS && ok "autorisation « Notifications » accordable" || ko "autorisation refusée par le système"

echo "== Liens d'application (plein écran sans barre d'adresse, liens reçus par e-mail)"
adb shell pm verify-app-links --re-verify "$PKG" || true
sleep 20
adb shell pm get-app-links "$PKG" | tee /tmp/applinks.txt
grep -q "$HOST: verified" /tmp/applinks.txt && ok "adresse $HOST vérifiée par Android (assetlinks.json conforme à la clé de signature)" || ko "adresse non vérifiée : l'application afficherait une barre d'adresse"

echo "== Lancement par l'icône"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 25
adb forward tcp:9222 localabstract:chrome_devtools_remote >/dev/null
top
R=$(cdp "({title:document.title, standalone:matchMedia('(display-mode: standalone)').matches, hasLogin:!!document.querySelector('[data-testid=login-submit]'), online:navigator.onLine})"); echo "$R"
echo "$R" | grep -q '"standalone":true' && ok "plein écran (mode « standalone » : aucune barre d'adresse)" || ko "barre d'adresse visible ou page non chargée"
echo "$R" | grep -q '"hasLogin":true' && ok "écran de connexion affiché" || echo "(écran de connexion non détecté : session ou chargement)"
R=$(cdp "fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({familyCode:'ZZZZZZZZ',login:'inconnu',secret:'000000'})}).then(r=>r.status)"); echo "$R"
echo "$R" | grep -qE '"value":(401|429)' && ok "connexion : le serveur répond (identifiants inconnus refusés, aucune donnée créée)" || ko "serveur injoignable depuis l'application"

echo "== Lien reçu par e-mail (faux jeton)"
LINK="$URL/#/verify/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
adb shell cmd package resolve-activity --brief -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "$LINK" | tail -2
adb shell cmd package resolve-activity --brief -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "$LINK" | grep -q "$PKG" && ok "le lien est attribué directement à l'application Courses" || ko "le lien ne s'ouvre pas dans l'application"
adb shell am force-stop "$PKG"; sleep 2
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "$LINK" >/dev/null
sleep 20
adb forward tcp:9222 localabstract:chrome_devtools_remote >/dev/null
top
R=$(cdp "({href:location.href, text:document.body.innerText.slice(0,200), standalone:matchMedia('(display-mode: standalone)').matches})"); echo "$R"
echo "$R" | grep -q "verify" && ok "le lien est arrivé dans la page (fragment conservé)" || ko "lien non reçu par la page"
echo "$R" | grep -qi "plus valable" && ok "faux jeton refusé avec une explication simple" || echo "(message de lien non détecté)"

echo "== WhatsApp (partage) : ouverture d'une adresse externe depuis l'application"
cdp "window.open('https://wa.me/?text=essai','_blank','noopener') ? 'ouvert' : 'ouvert-sans-fenetre'" | tail -1
sleep 8
top
adb shell am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null

echo "== Hors connexion"
adb shell am force-stop "$PKG"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 20   # page chargée en ligne : le service worker se met en place
adb shell svc wifi disable; adb shell svc data disable; sleep 5
adb shell am force-stop "$PKG"; sleep 2
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 25
adb forward tcp:9222 localabstract:chrome_devtools_remote >/dev/null
R=$(cdp "({title:document.title, online:navigator.onLine, hasLogin:!!document.querySelector('[data-testid=login-submit]'), text:document.body.innerText.slice(0,120)})"); echo "$R"
echo "$R" | grep -q '"online":false' && ok "téléphone réellement hors connexion" || echo "(réseau non coupé)"
echo "$R" | grep -q '"hasLogin":true' && ok "l'application s'ouvre hors connexion (écran de connexion servi par le cache)" || ko "page non servie hors connexion"
adb shell svc wifi enable; adb shell svc data enable
adb exec-out screencap -p > screen-final.png || true
adb logcat -d -s AndroidRuntime:E | head -20
[ "$FAIL" = 0 ] && echo "TOUS LES CONTRÔLES ÉMULATEUR SONT PASSÉS" || { echo "AU MOINS UN CONTRÔLE ÉMULATEUR A ÉCHOUÉ"; exit 1; }
