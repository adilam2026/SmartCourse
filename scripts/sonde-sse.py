#!/usr/bin/env python3
"""Sonde du flux en direct (SSE) du serveur de recette : connexion d'un membre FICTIF, ouverture de /api/events, délai
d'arrivée de l'événement « ready ». Code de sortie 1 si « ready » n'arrive pas dans le délai. N'affiche aucun cookie.
Usage : sonde-sse.py URL IDENTIFIANT_FAMILLE IDENTIFIANT CODE [DÉLAI_S]"""
import json, sys, time, urllib.request

url, family, login, secret = sys.argv[1:5]
limit = float(sys.argv[5]) if len(sys.argv) > 5 else 10
req = urllib.request.Request(url + "/api/auth/login", data=json.dumps({"familyCode": family, "login": login, "secret": secret}).encode(),
                             headers={"Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=20) as r:
    cookie = next(c.split(";")[0] for c in r.headers.get_all("Set-Cookie") or [] if c.startswith("sc_session="))
t0 = time.monotonic()
req = urllib.request.Request(url + "/api/events", headers={"Cookie": cookie, "Accept": "text/event-stream"})
try:
  with urllib.request.urlopen(req, timeout=limit) as r:
    print(f"flux ouvert : HTTP {r.status} en {int((time.monotonic() - t0) * 1000)} ms ({r.headers.get('Content-Type')})")
    while time.monotonic() - t0 < limit:
        line = r.readline()
        if not line:
            break
        if line.startswith(b"event:"):
            ev = line[6:].strip().decode()
            print(f"événement « {ev} » reçu {int((time.monotonic() - t0) * 1000)} ms après la demande")
            if ev == "ready":
                sys.exit(0)
except OSError as e:
    print(f"flux interrompu : {type(e).__name__}")
print(f"ÉCHEC : « ready » non reçu en {limit:.0f} s")
sys.exit(1)
