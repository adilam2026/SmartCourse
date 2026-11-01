#!/usr/bin/env bash
# Contrôle COMPLET de scripts/rapport-foyer-prive.sh, enchaînement réel compris, sur une sauvegarde FICTIVE (aucune donnée
# réelle, aucun vrai secret) : stockage S3 local (MinIO), image construite avec le Dockerfile de production, PostgreSQL jetable.
# Scénarios : réussite ; mauvaise clé (erreur) ; Ctrl-C pendant la restauration ; réseau créé par le script.
# Après chacun : aucun conteneur ni volume restant, réseau du script supprimé, aucun secret dans la sortie ni dans Docker.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
. scripts/lib-docker.sh
NET=copie-test-net; KEY="cle-de-test-fictive-$RANDOM$RANDOM"; ID=minio-test; SECRET="secret-fictif-$RANDOM$RANDOM"
FAILS=0
ok() { echo "PASS  $*"; }
ko() { echo "FAIL  $*"; FAILS=$((FAILS+1)); }
vols() { docker volume ls -q | sort; }
clean_state() { # $1 : nom du scénario
  if [ -z "$(docker ps -aq --filter name='^copie-(pg|app)$')" ]; then ok "$1 : aucun conteneur de copie restant"; else ko "$1 : conteneur restant"; docker ps -a; fi
  if [ "$(vols)" = "$VOLS0" ]; then ok "$1 : aucun volume créé ni restant"; else ko "$1 : volumes modifiés"; fi
  if grep -qF -e "$KEY" -e "$SECRET" "$2"; then ko "$1 : un secret apparaît dans la sortie"; else ok "$1 : aucun secret dans la sortie"; fi
}
cleanup() { docker rm -f -v "$ID" src-pg copie-pg copie-app >/dev/null 2>&1 || true; docker network rm "$NET" copie-net >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$ID" --network "$NET" -p 127.0.0.1:9000:9000 -e MINIO_ROOT_USER="$ID" -e MINIO_ROOT_PASSWORD="$SECRET" minio/minio server /data >/dev/null
docker run -d --name src-pg -p 127.0.0.1:5455:5432 -e POSTGRES_USER=src -e POSTGRES_PASSWORD=src -e POSTGRES_DB=src "$(docker_image postgres:18)" >/dev/null
for _ in $(seq 1 60); do docker exec src-pg pg_isready -U src -d src >/dev/null 2>&1 && curl -fsS -m 2 http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1 && break; sleep 1; done
(cd server && SRC_URL=postgres://src:src@127.0.0.1:5455/src S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=sauvegardes S3_ACCESS_KEY_ID="$ID" \
  S3_SECRET_ACCESS_KEY="$SECRET" BACKUP_KEY="$KEY" npx tsx scripts/seed-sauvegarde-test.ts)
docker_build smartcourse:copie-test >/dev/null
VOLS0=$(vols)
answers() { printf '%s\n' TESTFOY1 "$1" sauvegardes "http://$ID:9000" "" "$ID" "$SECRET" ""; }

echo "── 1. Réussite"
answers "$KEY" | COPY_IMAGE=smartcourse:copie-test COPY_NETWORK="$NET" scripts/rapport-foyer-prive.sh > /tmp/r1.txt 2>&1 && rc=0 || rc=$?
cat /tmp/r1.txt
[ "$rc" = 0 ] && ok "réussite : code de sortie 0" || ko "réussite : code de sortie $rc"
grep -Eq "Sucre +\| pot +\| piece +\| migration 030" /tmp/r1.txt && ok "rapport : Sucre, unité personnalisée « pot » conservée" || ko "rapport : ligne Sucre absente"
grep -Eq "Melon +\| 030 +\| 4.00 DH / 1 kg" /tmp/r1.txt && ok "rapport : prix du Melon au kg à compléter" || ko "rapport : prix à compléter absent"
grep -q "Copie inchangée après le rapport : dernière migration 025_budget.sql" /tmp/r1.txt && ok "copie inchangée après le rapport (025)" || ko "copie modifiée"
grep -q "saisie masquée" /tmp/r1.txt && ok "saisie masquée proposée pour les secrets" || ko "saisie masquée absente"
clean_state "réussite" /tmp/r1.txt

echo "── 2. Erreur (mauvaise clé de chiffrement)"
answers "mauvaise-cle-de-test-0000" | COPY_IMAGE=smartcourse:copie-test COPY_NETWORK="$NET" scripts/rapport-foyer-prive.sh > /tmp/r2.txt 2>&1 && rc=0 || rc=$?
tail -3 /tmp/r2.txt
[ "$rc" != 0 ] && ok "erreur : arrêt avec code $rc" || ko "erreur : non détectée"
clean_state "erreur" /tmp/r2.txt

echo "── 3. Interruption (Ctrl-C pendant la restauration)"
set -m
answers "$KEY" > /tmp/in3.txt
COPY_IMAGE=smartcourse:copie-test COPY_NETWORK="$NET" scripts/rapport-foyer-prive.sh < /tmp/in3.txt > /tmp/r3.txt 2>&1 &
PID=$!
stage=""
for _ in $(seq 1 300); do
  if docker ps -q --filter name='^copie-app$' | grep -q .; then stage="pendant la restauration"; break; fi
  kill -0 "$PID" 2>/dev/null || break; sleep 0.2
done
[ -z "$stage" ] && stage="avant la restauration (copie-pg prêt)"
kill -INT -- "-$PID" 2>/dev/null || true   # comme Ctrl-C : tout le groupe de processus au premier plan
wait "$PID" && rc=0 || rc=$?
set +m
tail -3 /tmp/r3.txt
[ "$rc" != 0 ] && ok "interruption $stage : arrêt avec code $rc" || ko "interruption : le script a continué"
sleep 2; clean_state "interruption" /tmp/r3.txt

echo "── 4. Réseau créé par le script (stockage inaccessible) : le réseau est supprimé"
answers "$KEY" | COPY_IMAGE=smartcourse:copie-test scripts/rapport-foyer-prive.sh > /tmp/r4.txt 2>&1 && rc=0 || rc=$?
[ "$rc" != 0 ] && ok "stockage inaccessible : arrêt avec code $rc" || ko "stockage inaccessible : non détecté"
docker network inspect copie-net >/dev/null 2>&1 && ko "réseau copie-net restant" || ok "réseau créé par le script supprimé"
clean_state "réseau" /tmp/r4.txt

echo "Échecs : $FAILS"
exit "$FAILS"
