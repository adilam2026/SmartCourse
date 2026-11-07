#!/bin/sh
# Démarrage du service Railway de RECETTE (Dockerfile.recette). Jamais utilisé par la production.
# - Garde-fou : refuse de démarrer si le projet Railway ne s'appelle pas « …recette… » (évite toute confusion avec la production).
# - E-mails : envoyés au faux service local (127.0.0.1:3199) ; les variables d'envoi réelles sont ignorées.
# - Famille FICTIVE « Recette » (identifiant RecetteCourses ; adil / lamiaa / marie) créée au premier démarrage avec INSTALL_TOKEN.
set -u
case "$(printf '%s' "${RAILWAY_PROJECT_NAME:-}" | tr 'A-Z' 'a-z')" in
  *recette*) ;;
  *) echo "Refus : image de recette hors d'un projet Railway « recette » (projet : ${RAILWAY_PROJECT_NAME:-inconnu})." >&2; exit 1 ;;
esac
export BREVO_API_KEY=cle-de-test BREVO_FROM_EMAIL=noreply@smartcourse.test BREVO_API_URL=http://127.0.0.1:3199/v3/smtp/email
unset S3_BUCKET S3_ENDPOINT S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY
node /app/recette/mock-brevo.mjs &
# Achats de test des stores (testeurs Google Play, Apple Sandbox/TestFlight) admis sur la recette seulement.
export STORE_ACCEPT_SANDBOX=1
node dist/index.js &
APP=$!
P=${PORT:-3000}
for _ in $(seq 1 120); do
  node -e "fetch('http://127.0.0.1:$P/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break
  sleep 1
done
if [ -n "${INSTALL_TOKEN:-}" ]; then
  if BASE="http://127.0.0.1:$P" FAMILY_LOGIN_ID=RecetteCourses node /app/recette/recette-seed.mjs >/dev/null 2>&1; then
    echo "Recette : famille fictive créée (identifiant RecetteCourses)."
  else
    echo "Recette : famille fictive déjà présente (installation déjà faite)."
  fi
fi
# Recette seulement : règle des listes gratuites ACTIVE (la production reste désactivée tant que le propriétaire ne l'a pas décidé).
# - RecetteCourses (contrôles iPhone ↔ Android) : droit « opérateur » de recette, pour que ces contrôles ne soient jamais bloqués ;
# - RecetteQuota (deuxième famille fictive, mêmes membres) : sert aux essais de la limite et des achats de test des stores.
if [ -n "${INSTALL_TOKEN:-}" ] && ! node dist/admin-cli.js family-exists RecetteQuota >/dev/null 2>&1; then
  T2=$(node dist/admin-cli.js token 2>/dev/null | grep -oE '#/install/[^ ]+' | sed 's#.*/##')
  if [ -n "$T2" ] && INSTALL_TOKEN="$T2" BASE="http://127.0.0.1:$P" FAMILY_LOGIN_ID=RecetteQuota SEED_NAME="Recette quota" SEED_MAIL=recette-quota@example.org \
       node /app/recette/recette-seed.mjs >/dev/null 2>&1; then echo "Recette : famille fictive RecetteQuota créée."; else echo "Recette : création de RecetteQuota impossible."; fi
fi
node dist/admin-cli.js quota-activate --execute --note "recette" >/dev/null 2>&1 && echo "Recette : règle des listes gratuites active." || echo "Recette : activation de la règle des listes gratuites impossible."
node dist/admin-cli.js recette-operator-right RecetteCourses 2>&1 | tail -1
node dist/admin-cli.js recette-manager RecetteCourses 2>&1 | tail -1
# Achats : Android ouvert sur la recette (toutes versions) ; iPhone fermé tant que l'App Store n'est pas configuré.
node dist/admin-cli.js purchases-open android --min-version 1 --execute --note recette >/dev/null 2>&1 && echo "Recette : achats Android ouverts." || echo "Recette : ouverture des achats Android impossible."
wait "$APP"
