#!/usr/bin/env bash
# Vérifie l'image Docker de bout en bout, EN LOCAL (ou dans un CI) : aucun déploiement, aucun accès à Railway.
#   - construction de l'image (clients PostgreSQL 16/17/18 inclus)
#   - démarrage sur un PostgreSQL jetable, utilisateur non privilégié
#   - import des 80 visuels au premier démarrage, puis idempotence (redémarrage + import manuel)
#   - aucun JPEG résiduel, aucune image supprimée à tort, images servies par l'API
# Prérequis : docker. Durée : quelques minutes (la première construction compile les clients PostgreSQL).
# Usage : scripts/verify-docker.sh [--keep]     (--keep laisse les conteneurs pour inspection)
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib-docker.sh

TAG="smartcourse:verify"; RUN="sc-verify-$$"; NET="$RUN-net"; PGC="$RUN-pg"; APP="$RUN-app"; VOL="$RUN-photos"
KEEP=0; [ "${1:-}" = "--keep" ] && KEEP=1
fail() { echo "ÉCHEC : $*" >&2; echo "--- journaux de l'application ---" >&2; docker logs "$APP" 2>&1 | tail -40 >&2 || true; exit 1; }
ok() { echo "OK    $*"; }
cleanup() { [ "$KEEP" = 1 ] && { echo "Conteneurs conservés : $APP, $PGC (réseau $NET)"; return; }; docker rm -f "$APP" "$PGC" >/dev/null 2>&1 || true; docker volume rm "$VOL" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

sql() { docker exec "$PGC" psql -U smart -d smartcourse -tA -c "$1"; }
# Dernière ligne d'import du journal (celle du démarrage le plus récent), pas la fin du journal.
last_import() { docker logs "$APP" 2>&1 | grep "Images du catalogue" | tail -1; }
wait_health() { for _ in $(seq 1 60); do docker exec "$APP" node -e 'fetch("http://127.0.0.1:3000/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' && return 0; sleep 1; done; return 1; }
start_app() {
  docker run -d --name "$APP" --network "$NET" -v "$VOL:/app/server/data" \
    -e DATABASE_URL=postgres://smart:smart@"$PGC":5432/smartcourse -e NODE_ENV=production "$TAG" >/dev/null
}

echo "== 1. Construction de l'image"
docker_build "$TAG"
ok "image construite"

echo "== 2. Contenu de l'image"
[ "$(docker run --rm "$TAG" sh -c 'ls catalog-photos/files/*.webp | wc -l')" = 80 ] || fail "il devrait y avoir exactement 80 images WebP"
[ "$(docker run --rm "$TAG" sh -c 'ls catalog-photos/files | grep -vc "\.webp$" || true')" = 0 ] || fail "fichier non WebP dans catalog-photos/files (ancienne image ?)"
[ "$(docker run --rm "$TAG" id -un)" = node ] || fail "l'application ne tourne pas en utilisateur non privilégié"
docker run --rm "$TAG" sh -c 'ls /usr/lib/postgresql/16/bin/pg_dump /usr/lib/postgresql/17/bin/pg_dump /usr/lib/postgresql/18/bin/pg_dump' >/dev/null || fail "clients pg_dump 16/17/18 absents de l'image"
ok "80 WebP, aucun autre fichier, utilisateur node, clients pg_dump 16, 17, 18 présents"

echo "== 3. Premier démarrage (base vide)"
docker network create "$NET" >/dev/null
PGIMG=$(docker_image postgres:16) || fail "image postgres:16 introuvable (registre)"
docker run -d --name "$PGC" --network "$NET" -e POSTGRES_USER=smart -e POSTGRES_PASSWORD=smart -e POSTGRES_DB=smartcourse "$PGIMG" >/dev/null
for _ in $(seq 1 60); do docker exec "$PGC" pg_isready -U smart -d smartcourse >/dev/null 2>&1 && break; sleep 1; done
start_app
wait_health || fail "l'application ne répond pas sur /health"
ok "/health répond"
sleep 3
last_import | grep -q "Images du catalogue : 80 remplacée(s) ou ajoutée(s), 0 déjà à jour." || fail "import initial attendu : 80 remplacées/ajoutées"
[ "$(sql "SELECT count(*) FROM initial_catalog WHERE photo_asset_id IS NOT NULL")" = 80 ] || fail "80 références du catalogue devraient avoir une image"
[ "$(sql "SELECT count(*) FROM photo_assets WHERE generated AND license = 'GENERATED' AND source_name LIKE 'Image générée%' AND author IS NULL AND source_url IS NULL")" = 80 ] || fail "provenance « Image générée avec ChatGPT » attendue sur 80 images"
[ "$(docker exec "$APP" sh -c 'ls /app/server/data/photos/photos/*.webp | wc -l')" = 80 ] || fail "80 fichiers attendus dans le stockage"
ok "80 images importées, provenance générée, 80 fichiers stockés"
# Migration 008 (révision du catalogue) : enregistrée, colonne et déclencheur présents, révision incrémentée par la création des produits
[ "$(sql "SELECT count(*) FROM schema_migrations WHERE name LIKE '008%'")" = 1 ] || fail "migration 008 non enregistrée"
[ "$(sql "SELECT count(*) FROM information_schema.columns WHERE table_name = 'families' AND column_name = 'catalog_rev'")" = 1 ] || fail "colonne families.catalog_rev absente"
[ "$(sql "SELECT count(*) FROM pg_trigger WHERE tgname = 'products_bump_catalog_rev' AND NOT tgisinternal")" = 1 ] || fail "déclencheur products_bump_catalog_rev absent"
ok "migration 008 appliquée (colonne et déclencheur présents)"
IDS_BEFORE=$(sql "SELECT md5(string_agg(photo_asset_id::text, ',' ORDER BY key)) FROM initial_catalog")

echo "== 4. Idempotence : redémarrage"
docker restart "$APP" >/dev/null
wait_health || fail "l'application ne redémarre pas"
sleep 3
last_import | grep -q "Images du catalogue : 0 remplacée(s) ou ajoutée(s), 80 déjà à jour." || fail "après redémarrage : 0 remplacée / 80 déjà à jour attendu"
[ "$(sql "SELECT count(*) FROM photo_assets")" = 80 ] || fail "le redémarrage ne doit pas créer d'image"
[ "$(sql "SELECT md5(string_agg(photo_asset_id::text, ',' ORDER BY key)) FROM initial_catalog")" = "$IDS_BEFORE" ] || fail "les références d'image ont changé au redémarrage"
ok "redémarrage : rien n'a changé"

echo "== 5. Idempotence : import et purge manuels"
OUT=$(docker exec "$APP" node dist/photos-cli.js import catalog-photos/manifest.json)
echo "$OUT" | grep -q "0 remplacée(s) ou ajoutée(s), 80 déjà à jour." || fail "import manuel non idempotent : $OUT"
OUT=$(docker exec "$APP" node dist/photos-cli.js purge --dry-run --min-age-minutes 0)
echo "$OUT" | grep -q "0 enregistrement(s) d'image et 0 fichier(s)" || fail "la purge ne devrait rien trouver : $OUT"
[ "$(sql "SELECT count(*) FROM photo_assets")" = 80 ] || fail "nombre d'images modifié"
ok "import manuel : 80 déjà à jour ; purge : rien à supprimer"

echo "== 6. Une image personnalisée survit à un redémarrage"
TOKEN=$(docker exec "$APP" node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')
HASH=$(printf %s "$TOKEN" | sha256sum | cut -d" " -f1)
sql "INSERT INTO install_tokens (token_hash) VALUES ('$HASH')" >/dev/null
docker exec -e T="$TOKEN" "$APP" node -e '
const sharp=require("sharp");
(async()=>{
 const b="http://127.0.0.1:3000";
 const r=await fetch(b+"/api/setup/family",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({installToken:process.env.T,familyName:"Verif",admin:{displayName:"Adil",login:"adil",secret:"482913"}})});
 if(r.status!==201) throw new Error("setup "+r.status);
 const cookie=r.headers.get("set-cookie").split(";")[0];
 const cat=await (await fetch(b+"/api/catalog",{headers:{cookie}})).json();
 const p=cat.categories.flatMap(c=>c.products).find(x=>x.name==="Tomates");
 if(!p||!p.photoUrl) throw new Error("Tomates sans image");
 const img=await fetch(b+p.photoUrl,{headers:{cookie}}); if(img.status!==200||img.headers.get("content-type")!=="image/webp") throw new Error("image non servie");
 const png=await sharp({create:{width:300,height:200,channels:3,background:"#336699"}}).png().toBuffer();
 const up=await fetch(b+"/api/products/"+p.id,{method:"PATCH",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({image:png.toString("base64")})});
 if(up.status!==200) throw new Error("patch "+up.status);
 console.log((await up.json()).product.photoUrl);
})().catch(e=>{console.error(e.message);process.exit(1)})' > "/tmp/$RUN.custom" || fail "création de la famille / image personnalisée"
CUSTOM=$(cat "/tmp/$RUN.custom"); rm -f "/tmp/$RUN.custom"
docker restart "$APP" >/dev/null; wait_health || fail "redémarrage"; sleep 3
last_import | grep -q "Images du catalogue : 0 remplacée(s)" || fail "redémarrage : l'import ne devrait rien changer"
[ "$(sql "SELECT count(*) FROM products WHERE photo_asset_id = '${CUSTOM##*/}'")" = 1 ] || fail "l'image personnalisée a été remplacée"
ok "image personnalisée conservée après redémarrage"
[ "$(sql "SELECT (catalog_rev > 0)::int FROM families LIMIT 1")" = 1 ] || fail "la révision du catalogue n'a pas été incrémentée par la création des produits / le changement d'image"
ok "révision du catalogue incrémentée (création de la famille, changement d'image)"

echo
echo "Vérification Docker terminée : tout est conforme. Rien n'a été déployé."
