#!/usr/bin/env bash
# Recette sur téléphone SANS Railway : l'application tourne sur VOTRE ordinateur (Docker), avec une base jetable.
#   scripts/recette-locale.sh         démarre l'application + une adresse HTTPS temporaire (Cloudflare « quick tunnel »,
#                                     gratuit, sans compte) à ouvrir sur le téléphone, et affiche les identifiants de test
#   scripts/recette-locale.sh --stop  arrête et efface tout (base et images d'essai comprises)
# HTTPS est indispensable : en production le cookie de session est « Secure » (une adresse http:// du Wi-Fi ne permettrait
# pas de se connecter) et le mode installé / hors connexion exige HTTPS.
# NO_TUNNEL=1 : pas de tunnel (vérification automatique en CI ; l'application reste sur http://localhost:3000 seulement).
# Aucun service payant, aucun déploiement. Les données d'essai disparaissent avec --stop.
set -euo pipefail
cd "$(dirname "$0")/.."
NET=sc-recette-net; PGC=sc-recette-pg; APP=sc-recette-app; VOL=sc-recette-data; TUN=sc-recette-tunnel; TAG=smartcourse:recette
stop() { docker rm -f "$APP" "$PGC" "$TUN" >/dev/null 2>&1 || true; docker volume rm "$VOL" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
if [ "${1:-}" = "--stop" ]; then stop; echo "Recette arrêtée, données d'essai effacées."; exit 0; fi
stop
docker build -t "$TAG" .
docker network create "$NET" >/dev/null
docker run -d --name "$PGC" --network "$NET" -e POSTGRES_USER=smart -e POSTGRES_PASSWORD=smart -e POSTGRES_DB=smartcourse postgres:16 >/dev/null
for _ in $(seq 1 60); do docker exec "$PGC" pg_isready -U smart -d smartcourse >/dev/null 2>&1 && break; sleep 1; done
TOKEN=$(openssl rand -hex 16)
# Port publié sur localhost seulement : le téléphone passe par le tunnel HTTPS.
docker run -d --name "$APP" --network "$NET" -p 127.0.0.1:3000:3000 -v "$VOL:/app/server/data" \
  -e DATABASE_URL=postgres://smart:smart@"$PGC":5432/smartcourse -e NODE_ENV=production -e INSTALL_TOKEN="$TOKEN" "$TAG" >/dev/null
for _ in $(seq 1 60); do docker exec "$APP" node -e 'fetch("http://127.0.0.1:3000/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' && break; sleep 1; done
docker cp scripts/recette-seed.mjs "$APP":/tmp/recette-seed.mjs
OUT=$(docker exec -e INSTALL_TOKEN="$TOKEN" "$APP" node /tmp/recette-seed.mjs)
CODE=$(echo "$OUT" | sed -E 's/.*"familyCode":"([^"]+)".*/\1/')
URL="http://localhost:3000 (cet ordinateur seulement ; pas de tunnel)"
if [ "${NO_TUNNEL:-}" != "1" ]; then
  docker run -d --name "$TUN" --network "$NET" cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://"$APP":3000 >/dev/null
  U=""
  for _ in $(seq 1 60); do U=$(docker logs "$TUN" 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | grep -v '^https://api\.' | head -1 || true) # api.trycloudflare.com est cité dans les journaux : ce n'est pas le tunnel; [ -n "$U" ] && break; sleep 1; done
  [ -n "$U" ] || { echo "Tunnel introuvable : voir « docker logs $TUN »" >&2; exit 1; }
  # L'adresse apparaît dans les journaux AVANT que son nom soit connu du DNS : on attend qu'elle réponde vraiment.
  if command -v curl >/dev/null 2>&1; then
    READY=0
    for _ in $(seq 1 90); do curl -fsS --max-time 5 "$U/health" >/dev/null 2>&1 && { READY=1; break; }; sleep 2; done
    [ "$READY" = 1 ] || { echo "Le tunnel $U ne répond pas encore (DNS) : réessayez dans une minute ou relancez le script." >&2; exit 1; }
  else
    echo "(curl absent : si l'adresse ne s'ouvre pas tout de suite, patientez une minute.)"
  fi
  URL="$U   <- à ouvrir sur le téléphone"
fi
cat <<MSG

Application prête : $URL
  Code famille : $CODE
  Administrateur : adil / 482913        Parent : lamiaa / 573918        Personnel : marie / 573918
Une liste est déjà en cours. Parcours : docs/recette-telephone.md
Arrêter et tout effacer : scripts/recette-locale.sh --stop
MSG
