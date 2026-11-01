#!/usr/bin/env bash
# Rapport d'un foyer sur une COPIE PRIVÉE de la dernière sauvegarde de production, sur le POSTE de l'administrateur :
# jamais dans l'intégration continue du dépôt public (le résultat contient des données du foyer).
#   1. construit l'image de l'application (même Dockerfile que la production) ;
#   2. démarre un PostgreSQL 18 local et jetable (conteneur « copie-pg », sans port ouvert sur la machine) ;
#   3. y restaure la sauvegarde la plus récente (programme dist/copie-privee.js : aucune adresse de production, lecture seule
#      du stockage, fichier déchiffré effacé aussitôt) ;
#   4. exécute docs/catalogue/import-2026-11-01/rapport-foyer.sql sur cette copie : il JOUE les migrations 026 à 030 puis
#      ANNULE la transaction (la copie n'est pas modifiée) ;
#   5. supprime la copie (sauf --garder).
# Prérequis : Docker, et dans CE terminal les variables copiées depuis Railway (service de l'application, onglet Variables),
# jamais écrites dans un fichier du dépôt :
#   export BACKUP_KEY=… S3_BUCKET=… S3_ENDPOINT=… S3_REGION=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=…   (+ S3_FORCE_PATH_STYLE si défini)
# Usage : scripts/rapport-foyer-prive.sh CODEFAMILLE [--garder]
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib-docker.sh
FAM=${1:?usage : scripts/rapport-foyer-prive.sh CODEFAMILLE [--garder]}
KEEP=${2:-}
[ -z "${DATABASE_URL:-}" ] || { echo "REFUS : DATABASE_URL est défini dans ce terminal (adresse de production) : ouvrir un terminal sans elle." >&2; exit 1; }
for v in BACKUP_KEY S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  [ -n "${!v:-}" ] || { echo "Variable $v manquante (à copier depuis Railway dans ce terminal)." >&2; exit 1; }
done
NET=copie-net; PGC=copie-pg; TAG=smartcourse:copie-privee
cleanup() {
  if [ "$KEEP" = "--garder" ]; then echo "Copie conservée dans le conteneur $PGC. Suppression : docker rm -f $PGC && docker network rm $NET"; return; fi
  docker rm -f "$PGC" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true
  echo "Copie privée supprimée."
}
trap cleanup EXIT

docker_build "$TAG"
docker network create "$NET" >/dev/null 2>&1 || true
docker rm -f "$PGC" >/dev/null 2>&1 || true
docker run -d --name "$PGC" --network "$NET" -e POSTGRES_USER=copie -e POSTGRES_PASSWORD=copie -e POSTGRES_DB=copie "$(docker_image postgres:18)" >/dev/null
for _ in $(seq 1 60); do docker exec "$PGC" pg_isready -U copie -d copie >/dev/null 2>&1 && break; sleep 1; done

OUT=$(docker run --rm --network "$NET" -e BACKUP_KEY -e S3_BUCKET -e S3_ENDPOINT -e S3_REGION -e S3_ACCESS_KEY_ID -e S3_SECRET_ACCESS_KEY -e S3_FORCE_PATH_STYLE \
  -e COPY_TARGET_URL=postgres://copie:copie@copie-pg:5432/copie "$TAG" node dist/copie-privee.js)
echo "$OUT" | grep -v "^Rapport foyer :"
DB=$(echo "$OUT" | grep -o 'copie_privee_[0-9]*' | head -1)
[ -n "$DB" ] || { echo "Copie privée introuvable." >&2; exit 1; }

docker exec "$PGC" mkdir -p /tmp/repo/server /tmp/repo/docs/catalogue/import-2026-11-01
docker cp server/migrations "$PGC":/tmp/repo/server/ >/dev/null
docker cp docs/catalogue/import-2026-11-01/rapport-foyer.sql "$PGC":/tmp/repo/docs/catalogue/import-2026-11-01/ >/dev/null
echo
docker exec -w /tmp/repo "$PGC" psql -U copie -d "$DB" -q -v famille="$FAM" -f docs/catalogue/import-2026-11-01/rapport-foyer.sql 2>&1 | grep -v "NOTICE"
