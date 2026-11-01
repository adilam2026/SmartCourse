#!/usr/bin/env bash
# Rapport d'un foyer sur une COPIE PRIVÉE de la dernière sauvegarde de production, sur le POSTE de l'administrateur :
# jamais dans l'intégration continue du dépôt public avec la vraie sauvegarde (le résultat contient des données du foyer).
#   1. construit l'image de l'application (même Dockerfile que la production) ;
#   2. démarre un PostgreSQL 18 jetable, données EN MÉMOIRE (aucun volume, aucun port ouvert sur la machine) ;
#   3. y restaure la sauvegarde la plus récente (dist/copie-privee.js : aucune adresse de production, stockage en lecture
#      seule, fichier déchiffré effacé aussitôt) ;
#   4. exécute docs/catalogue/import-2026-11-01/rapport-foyer.sql sur cette copie : il JOUE les migrations 026 à 030 puis
#      ANNULE la transaction ;
#   5. supprime tout, en cas de réussite, d'erreur ou d'interruption (Ctrl-C) : conteneurs, données en mémoire, réseau,
#      secrets en mémoire du script.
# Secrets : demandés à l'écran SANS AFFICHAGE (ni écho, ni historique du terminal, ni fichier), gardés dans des variables
# NON exportées, et transmis seulement au conteneur de restauration (supprimé à la fin). Le code famille est aussi demandé
# à l'écran (pas d'argument : il ne reste pas dans l'historique).
# Usage : scripts/rapport-foyer-prive.sh
#   Variables facultatives (contrôle du script) : COPY_IMAGE (image déjà construite), COPY_NETWORK (réseau Docker existant).
set -Eeuo pipefail
cd "$(dirname "$0")/.."
. scripts/lib-docker.sh

PGC=copie-pg; APPC=copie-app
NET=${COPY_NETWORK:-copie-net}; NET_CREATED=0
TAG=${COPY_IMAGE:-smartcourse:copie-privee}
cleanup() {
  local rc=$?
  trap - EXIT INT TERM HUP
  docker rm -f -v "$APPC" "$PGC" >/dev/null 2>&1 || true
  [ "$NET_CREATED" = 1 ] && { docker network rm "$NET" >/dev/null 2>&1 || true; }
  unset k_backup k_id k_secret s_bucket s_endpoint s_region s_path famille
  echo "Nettoyage : copie privée, conteneurs et secrets en mémoire supprimés." >&2
  exit "$rc"
}
trap cleanup EXIT
trap 'echo "Interruption." >&2; exit 130' INT TERM HUP

[ -z "${DATABASE_URL:-}" ] || { echo "REFUS : DATABASE_URL est défini dans ce terminal (adresse de production) : ouvrir un terminal sans elle." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker est nécessaire." >&2; exit 1; }

# ---- Saisie (rien n'est affiché pour les secrets ; rien n'est écrit sur le disque)
ask()  { local v; printf '%s : ' "$1" >&2; IFS= read -r v; printf '%s' "$v"; }
askS() { local v; printf '%s (saisie masquée) : ' "$1" >&2; IFS= read -rs v; printf '\n' >&2; printf '%s' "$v"; }
famille=$(ask "Code famille (8 caractères : icône du profil en haut à droite de l'application, « Famille : nom (CODE) »)")
k_backup=$(askS "BACKUP_KEY")
s_bucket=$(ask "S3_BUCKET")
s_endpoint=$(ask "S3_ENDPOINT")
s_region=$(ask "S3_REGION (vide = auto)")
k_id=$(askS "S3_ACCESS_KEY_ID")
k_secret=$(askS "S3_SECRET_ACCESS_KEY")
s_path=$(ask "S3_FORCE_PATH_STYLE (vide si non défini dans Railway)")
[[ "$famille" =~ ^[A-Za-z0-9]{6,12}$ ]] || { echo "Code famille invalide." >&2; exit 1; }
for v in k_backup s_bucket k_id k_secret; do [ -n "${!v}" ] || { echo "Valeur manquante." >&2; exit 1; }; done

# ---- Image, réseau et PostgreSQL jetable en mémoire
[ -n "${COPY_IMAGE:-}" ] || docker_build "$TAG" >/dev/null
docker network inspect "$NET" >/dev/null 2>&1 || { docker network create "$NET" >/dev/null; NET_CREATED=1; }
docker rm -f -v "$APPC" "$PGC" >/dev/null 2>&1 || true
docker run -d --name "$PGC" --network "$NET" --tmpfs /var/lib/postgresql:rw,size=2g \
  -e POSTGRES_USER=copie -e POSTGRES_PASSWORD=copie -e POSTGRES_DB=copie "$(docker_image postgres:18)" >/dev/null
for _ in $(seq 1 60); do docker exec "$PGC" pg_isready -U copie -d copie >/dev/null 2>&1 && break; sleep 1; done

# ---- Copie privée : secrets passés au SEUL conteneur de restauration, par son environnement (jamais en argument)
OUT=$(BACKUP_KEY="$k_backup" S3_BUCKET="$s_bucket" S3_ENDPOINT="$s_endpoint" S3_REGION="${s_region:-auto}" \
  S3_ACCESS_KEY_ID="$k_id" S3_SECRET_ACCESS_KEY="$k_secret" S3_FORCE_PATH_STYLE="$s_path" \
  docker run --rm --name "$APPC" --network "$NET" \
    -e BACKUP_KEY -e S3_BUCKET -e S3_ENDPOINT -e S3_REGION -e S3_ACCESS_KEY_ID -e S3_SECRET_ACCESS_KEY -e S3_FORCE_PATH_STYLE \
    -e COPY_TARGET_URL=postgres://copie:copie@copie-pg:5432/copie "$TAG" node dist/copie-privee.js)
unset k_backup k_id k_secret
echo "$OUT" | grep -v "^Rapport foyer :"
DB=$(echo "$OUT" | grep -o 'copie_privee_[0-9]*' | head -1)
[ -n "$DB" ] || { echo "Copie privée introuvable." >&2; exit 1; }

# ---- Rapport (migrations jouées puis annulées sur la copie)
docker exec "$PGC" mkdir -p /tmp/repo/server /tmp/repo/docs/catalogue/import-2026-11-01
docker cp server/migrations "$PGC":/tmp/repo/server/ >/dev/null
docker cp docs/catalogue/import-2026-11-01/rapport-foyer.sql "$PGC":/tmp/repo/docs/catalogue/import-2026-11-01/ >/dev/null
echo
docker exec -w /tmp/repo "$PGC" psql -U copie -d "$DB" -q -v famille="$famille" -f docs/catalogue/import-2026-11-01/rapport-foyer.sql 2>&1 | grep -v "NOTICE"
echo
echo "Copie inchangée après le rapport : dernière migration $(docker exec "$PGC" psql -U copie -d "$DB" -tAc "SELECT max(name) FROM schema_migrations")."
