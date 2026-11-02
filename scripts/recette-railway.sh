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
wait "$APP"
