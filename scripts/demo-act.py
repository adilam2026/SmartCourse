#!/usr/bin/env python3
"""Actions de « l'autre téléphone » pendant les captures du spot (serveur de recette local et jetable uniquement, jamais la production).

Usage :
  demo-act.py BASE CODE_FAMILLE batch          Nadia envoie la sélection du spot dans « Courses de la semaine »
  demo-act.py BASE CODE_FAMILLE buy QUI NOM    QUI (sophie, karim) coche NOM comme acheté dans cette liste
"""
import importlib.util, json, os, sys, uuid, urllib.request

BASE, FAMILY, ACTION = sys.argv[1], sys.argv[2], sys.argv[3]
# Mêmes produits, quantités et nom de liste que le jeu de données (une seule source).
_spec = importlib.util.spec_from_file_location("demo_const", os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo-const.py"))
const = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(const)
SECRETS = {"sophie": "482913", "karim": "573918", "nadia": "573918"}


def call(method, path, body=None, cookie=None):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode())
    if body is not None:
        req.add_header("content-type", "application/json")
    if cookie:
        req.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None), r.headers
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} : {e.code} {e.read()[:300]!r}")


def login(who):
    _, _, h = call("POST", "/api/auth/login", {"familyCode": FAMILY, "login": who, "secret": SECRETS[who], "clientFeatures": ["provisional"]})
    for c in h.get_all("set-cookie") or []:
        if c.startswith("sc_session="):
            return c.split(";")[0]
    raise SystemExit(f"connexion {who} : pas de cookie")


def the_list(cookie):
    """Liste courante du profil (choisie par demo-seed.py pour les trois profils) ; le personnel n'a pas accès à toutes les listes."""
    l = call("GET", "/api/lists/active", cookie=cookie)[1]["list"]
    if not l or l.get("name") != const.LIST_NAME:
        raise SystemExit(f"liste courante différente de « {const.LIST_NAME} »")
    return l["id"]


def ops(cookie, list_id, items):
    # Un seul lot, comme « Terminer ma sélection » dans l'application : une seule demande pour toute la sélection.
    call("POST", f"/api/lists/{list_id}/ops", {"batch": {"id": str(uuid.uuid4())}, "ops": [dict(opId=str(uuid.uuid4()), **o) for o in items]}, cookie)


if ACTION == "batch":
    nadia = login("nadia")
    lid = the_list(nadia)
    names = {p["name"]: p["id"] for c in call("GET", "/api/catalog", cookie=nadia)[1]["categories"] for p in c["products"]}
    ops(nadia, lid, [{"type": "add", "productId": names[n], "quantity": q} for n, q in const.SELECTION])
    print(f"sélection de Nadia envoyée ({len(const.SELECTION)} articles)")
elif ACTION == "buy":
    who, name = sys.argv[4], sys.argv[5]
    c = login(who)
    lid = the_list(c)
    items = [i for i in call("GET", f"/api/lists/{lid}", cookie=c)[1]["list"]["items"] if i.get("name") == name or i.get("productName") == name]
    if not items:
        names = {p["id"]: p["name"] for cat in call("GET", "/api/catalog", cookie=c)[1]["categories"] for p in cat["products"]}
        items = [i for i in call("GET", f"/api/lists/{lid}", cookie=c)[1]["list"]["items"] if names.get(i["productId"]) == name]
    if not items:
        raise SystemExit(f"« {name} » absent de la liste")
    ops(c, lid, [{"type": "purchase", "itemId": items[0]["id"]}])
    print(f"{who} : {name} acheté")
else:
    raise SystemExit(__doc__)
