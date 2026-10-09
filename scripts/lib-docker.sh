# Aides Docker communes aux scripts de vérification (à « sourcer »). Aucune version d'image n'est modifiée :
# en cas de refus de Docker Hub (429 « trop de requêtes », 504, échec d'authentification), on réessaie d'abord après une
# pause, puis on télécharge LES MÊMES images (mêmes noms et mêmes étiquettes que le Dockerfile) par le miroir public
# mirror.gcr.io. Les erreurs sans rapport avec le registre (compilation, tests…) ne déclenchent aucun repli.

REGISTRY_ERR='429|Too Many Requests|504|Gateway Time-?out|failed to authorize|failed to fetch oauth token|toomanyrequests|TLS handshake timeout|unexpected EOF|connection reset|Client\.Timeout|context deadline exceeded|request canceled|i/o timeout|dial tcp|no such host|temporary failure in name resolution'
MIRROR="${DOCKER_MIRROR:-mirror.gcr.io/library}"

# Image par défaut d'une ARG du Dockerfile (source unique des versions).
dockerfile_default() { sed -n "s/^ARG $1=//p" Dockerfile | head -1; }

# docker_build TAG : construit l'image du dossier courant.
docker_build() {
  local tag="$1" out rc i
  out=$(mktemp)
  for i in 1 2; do
    if docker build -t "$tag" . > >(tee "$out") 2>&1; then rc=0; else rc=$?; fi
    sleep 1 # laisse « tee » finir d'écrire le journal avant de le lire
    [ "$rc" = 0 ] && { rm -f "$out"; return 0; }
    grep -Eq "$REGISTRY_ERR" "$out" || { echo "Échec de construction sans rapport avec le registre : pas de repli." >&2; rm -f "$out"; return "$rc"; }
    [ "$i" = 1 ] && { echo "Docker Hub a refusé la requête : nouvel essai dans 20 s." >&2; sleep "${DOCKER_RETRY_PAUSE:-20}"; }
  done
  echo "Docker Hub refuse toujours : même construction, mêmes versions, images prises sur $MIRROR." >&2
  local args=() n v
  for n in NODE_IMAGE PG_IMAGE_16 PG_IMAGE_17 PG_IMAGE_18; do
    v=$(dockerfile_default "$n"); [ -n "$v" ] && args+=(--build-arg "$n=$MIRROR/$v")
  done
  if docker build "${args[@]}" -t "$tag" . ; then rm -f "$out"; return 0; fi
  rm -f "$out"; return 1
}

# docker_image NAME:TAG : télécharge (avec repli) et affiche le nom d'image à utiliser avec « docker run ».
docker_image() {
  local img="$1" out i
  out=$(mktemp)
  for i in 1 2; do
    if docker pull "$img" >"$out" 2>&1; then rm -f "$out"; echo "$img"; return 0; fi
    grep -Eq "$REGISTRY_ERR" "$out" || { cat "$out" >&2; rm -f "$out"; return 1; }
    [ "$i" = 1 ] && sleep "${DOCKER_RETRY_PAUSE:-20}"
  done
  if docker pull "$MIRROR/$img" >"$out" 2>&1; then rm -f "$out"; echo "$MIRROR/$img"; return 0; fi
  cat "$out" >&2; rm -f "$out"; return 1
}
