#!/usr/bin/env bash
# Réseau du simulateur piloté par les contrôles iPhone (Mac de CI, recette seulement). Le test écrit un fichier signal dans son
# dossier temporaire (sur ce Mac, sous le dossier du simulateur) : « courses-reseau-coupe » coupe l'accès de ce Mac au serveur de
# recette (pare-feu pf, connexions en cours comprises) ; « courses-reseau-retablit » le rend. Le serveur et Android ne sont pas
# touchés. « courses-push » : notification APNs simulée (xcrun simctl push, même contenu que celui envoyé par le serveur).
# Horodatages en UTC. Usage : ios-reseau.sh UDID_SIMULATEUR URL [DURÉE_MAX_MIN]
set -uo pipefail
SIM=$1; URL=$2; MAX=${3:-110}
HOST=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.urlparse(sys.argv[1]).hostname)' "$URL")
DATA="$HOME/Library/Developer/CoreSimulator/Devices/$SIM/data"
take() { local f; f=$(find "$DATA" -name "$1" -type f 2>/dev/null | head -1); [ -n "$f" ] && { rm -f "$f"; return 0; }; return 1; }
cut() {
  IPS=$( (dig +short A "$HOST"; dig +short AAAA "$HOST") | grep -E '^[0-9a-fA-F:.]+$' | grep -E '[.:]' | sort -u | tr '\n' ' ')
  local l; l=$(echo $IPS | sed 's/ /, /g')
  printf 'block drop out quick from any to { %s }\nblock drop in quick from { %s } to any\n' "$l" "$l" > /tmp/reseau.pf
  sudo pfctl -E >/dev/null 2>&1 || true; sudo pfctl -f /tmp/reseau.pf 2>/dev/null
  for ip in $IPS; do sudo pfctl -k 0.0.0.0/0 -k "$ip" >/dev/null 2>&1; sudo pfctl -k ::/0 -k "$ip" >/dev/null 2>&1; sudo pfctl -k "$ip" >/dev/null 2>&1; done
  curl -fsS --max-time 5 "$URL/health" >/dev/null 2>&1 && R="le serveur répond encore (coupure inefficace)" || R="vérifié : serveur injoignable"
  echo "$(date -u +%T) COUPURE ($R)"
}
restore() { sudo pfctl -f /etc/pf.conf >/dev/null 2>&1; echo "$(date -u +%T) RÉTABLI"; }
END=$(( $(date +%s) + MAX * 60 ))
while [ "$(date +%s)" -lt "$END" ]; do
  take courses-reseau-coupe && cut
  take courses-reseau-retablit && restore
  if take courses-push; then
    printf '%s' '{"aps":{"alert":{"title":"Liste mise à jour","body":"Marie a ajouté 1 produit"},"sound":"default","thread-id":"recette"},"listId":"recette","url":"/"}' > /tmp/push.json
    xcrun simctl push "$SIM" app.smartcourse.courses.recette /tmp/push.json && echo "$(date -u +%T) NOTIFICATION APNs simulée envoyée"
  fi
  sleep 1
done
restore
