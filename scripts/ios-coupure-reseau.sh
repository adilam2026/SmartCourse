#!/usr/bin/env bash
# Contrôle de reconnexion (Mac de CI, recette seulement) : quand le test iPhone nomme la liste « iphone-coupure », coupe
# l'accès de CE Mac (donc du simulateur) au serveur de recette pendant COUPURE secondes (pare-feu pf, connexions en cours
# comprises), puis le rétablit. Le serveur de recette et Android ne sont pas touchés. Horodatages en UTC.
# Usage : ios-coupure-reseau.sh URL IDENTIFIANT_FAMILLE [COUPURE_S]
set -uo pipefail
URL=$1; FAMILY=$2; CUT=${3:-120}
HOST=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.urlparse(sys.argv[1]).hostname)' "$URL")
JAR=$(mktemp)
curl -fsS -c "$JAR" -H 'Content-Type: application/json' -d "{\"familyCode\":\"$FAMILY\",\"login\":\"marie\",\"secret\":\"573918\"}" "$URL/api/auth/login" >/dev/null || { echo "coupure : connexion API impossible"; exit 1; }
name() { curl -fsS --max-time 10 -b "$JAR" "$URL/api/lists/active" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("list") or {}).get("name") or "")' 2>/dev/null; }
for _ in $(seq 1 1440); do [ "$(name)" = "iphone-coupure" ] && break; sleep 5; done
[ "$(name)" = "iphone-coupure" ] || { echo "coupure : signal du test iPhone jamais reçu"; exit 1; }
IPS=$( (dig +short A "$HOST"; dig +short AAAA "$HOST") | grep -E '^[0-9a-fA-F:.]+$' | grep -E '[.:]' | sort -u | tr '\n' ' ')
[ -n "$IPS" ] || { echo "coupure : adresse du serveur introuvable"; exit 1; }
LIST=$(echo $IPS | sed 's/ /, /g')
printf 'block drop out quick from any to { %s }\nblock drop in quick from { %s } to any\n' "$LIST" "$LIST" > /tmp/coupure.pf
sudo pfctl -E >/dev/null 2>&1 || true
sudo pfctl -f /tmp/coupure.pf 2>/dev/null
for ip in $IPS; do sudo pfctl -k 0.0.0.0/0 -k "$ip" >/dev/null 2>&1; sudo pfctl -k ::/0 -k "$ip" >/dev/null 2>&1; sudo pfctl -k "$ip" >/dev/null 2>&1; done
echo "$(date -u +%T) COUPURE : serveur de recette inaccessible depuis ce Mac ($(echo $IPS | wc -w | tr -d ' ') adresse(s)), pour ${CUT} s"
curl -fsS --max-time 5 "$URL/health" >/dev/null 2>&1 && echo "  (attention : le serveur répond encore malgré la coupure)" || echo "  vérifié : le serveur ne répond plus"
sleep "$CUT"
sudo pfctl -f /etc/pf.conf >/dev/null 2>&1
echo "$(date -u +%T) RÉTABLI : accès au serveur de recette rendu"
curl -fsS --max-time 10 "$URL/health" >/dev/null 2>&1 && echo "  vérifié : le serveur répond de nouveau" || echo "  (le serveur ne répond pas encore)"
rm -f "$JAR"
