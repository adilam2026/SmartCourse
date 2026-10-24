#!/usr/bin/env python3
"""Données FICTIVES du spot publicitaire (serveur de recette local et jetable uniquement, jamais la production).

Famille Martin (créée par recette-seed.mjs avec SEED_PLAY=1) : Sophie (la femme, administratrice), Karim (le mari, parent),
Nadia (l'employée de maison, personnel). Maroc (Casablanca), une seule liste en cours « Courses de la semaine », quatre courses
passées, Budget en MAD avec budgets mensuels et « Mon compte ». Magasins génériques, aucune enseigne, aucun e-mail réel.
Produits choisis pour garder la même unité quelle que soit la décision en cours sur les unités (migration 027).

Usage : demo-seed.py BASE CODE_FAMILLE FICHIER_SQL
Le fichier SQL (à exécuter ensuite sur la base jetable) date les courses passées.
"""
import datetime, importlib.util, json, os, sys, uuid, urllib.request

BASE, FAMILY, SQL_OUT = sys.argv[1], sys.argv[2], sys.argv[3]

_spec = importlib.util.spec_from_file_location("demo_const", os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo-const.py"))
_const = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_const)
SELECTION, LIST_NAME = _const.SELECTION, _const.LIST_NAME


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


def login(who, secret):
    _, _, h = call("POST", "/api/auth/login", {"familyCode": FAMILY, "login": who, "secret": secret, "clientFeatures": ["provisional"]})
    for c in h.get_all("set-cookie") or []:
        if c.startswith("sc_session="):
            return c.split(";")[0]
    raise SystemExit(f"connexion {who} : pas de cookie")


def ops(cookie, list_id, items):
    return call("POST", f"/api/lists/{list_id}/ops", {"ops": [dict(opId=str(uuid.uuid4()), **o) for o in items]}, cookie)[1]


sophie = login("sophie", "482913")
karim = login("karim", "573918")
nadia = login("nadia", "573918")
cat = call("GET", "/api/catalog", cookie=sophie)[1]
by_name = {p["name"]: p for c in cat["categories"] for p in c["products"] if p.get("photoUrl")}


def pick(spec):
    missing = [n for n, _ in spec if n not in by_name]
    if missing:
        raise SystemExit(f"produits absents du catalogue : {missing}")
    return [(by_name[n], q) for n, q in spec]


today = datetime.date.today()
first = today.replace(day=1)
in_month = lambda n: min(n, max(today.day - 1, 0))  # les courses « du mois » restent dans le mois affiché

# Quatre courses passées : trois ce mois-ci, une plus ancienne (pour « Tout l'historique »). Nadia ajoute, Sophie et Karim cochent.
PAST = [
    (40, [("Bananes", 1), ("Tomates", 1), ("Œufs", 12), ("Pain", 4), ("Thon en conserve", 2)]),
    (in_month(13), [("Bananes", 1.5), ("Pommes de terre", 2), ("Oignons", 1), ("Carottes", 1), ("Œufs", 12), ("Yaourt nature", 8)]),
    (in_month(8), [("Bananes", 1), ("Tomates", 2), ("Courgettes", 1), ("Citrons", 0.5), ("Pain", 4), ("Thon en conserve", 3)]),
    (in_month(3), [("Bananes", 2), ("Tomates", 1), ("Pommes", 1), ("Œufs", 6), ("Pain", 6), ("Yaourt nature", 4)]),
]
sql = ["SET session_replication_role = replica;"]  # base jetable : gardes des listes archivées suspendues le temps de dater
for days, spec in PAST:
    active = call("GET", "/api/lists/active", cookie=sophie)[1]["list"]
    lid = active["id"] if active else call("POST", "/api/lists", cookie=sophie)[1]["list"]["id"]
    chosen = pick(spec)
    ops(nadia, lid, [{"type": "add", "productId": p["id"], "quantity": q} for p, q in chosen])
    items = {i["productId"]: i["id"] for i in call("GET", f"/api/lists/{lid}", cookie=sophie)[1]["list"]["items"]}
    ids = [items[p["id"]] for p, _ in chosen]
    half = len(ids) // 2
    ops(sophie, lid, [{"type": "purchase", "itemId": x} for x in ids[:half]])
    ops(karim, lid, [{"type": "purchase", "itemId": x} for x in ids[half:]])
    call("POST", f"/api/lists/{lid}/close", {}, sophie)
    at = f"(date_trunc('day', now()) - interval '{days} days' + interval '10 hours 30 minutes')"
    sql += [f"UPDATE lists SET created_at = {at} - interval '1 day', closed_at = {at} + interval '1 hour' WHERE id = '{lid}';",
            f"UPDATE list_items SET added_at = {at} - interval '1 day', updated_at = {at} WHERE list_id = '{lid}';",
            f"UPDATE validations SET at = {at} - interval '1 day' WHERE list_id = '{lid}';",
            f"UPDATE list_events SET at = {at} - interval '1 day' WHERE list_id = '{lid}';",
            f"UPDATE purchases SET purchased_at = {at} + interval '20 minutes' WHERE list_id = '{lid}';"]
sql.append("SET session_replication_role = DEFAULT;")

# Maroc (prix indicatifs affichés), une liste nommée, Budget en MAD
call("PUT", "/api/family/location", {"country": "MA", "city": "Casablanca"}, sophie)
call("PUT", "/api/family/features", {"multiLists": True}, sophie)
call("PUT", "/api/family/features", {"budget": True, "currency": "MAD"}, sophie)
lid = call("POST", "/api/lists", {"name": LIST_NAME}, sophie)[1]["list"]["id"]
for c in (sophie, karim, nadia):
    call("PUT", "/api/me/current-list", {"listId": lid}, c)

cats = {c["key"]: c["id"] for c in call("GET", "/api/budget", cookie=sophie)[1]["categories"] if c.get("key")}
day = lambda n: max(today - datetime.timedelta(days=n), first).isoformat()
past = sorted([l for l in call("GET", "/api/lists", cookie=sophie)[1]["lists"] if l.get("closedAt")], key=lambda l: l["createdAt"])
for l, (shop, amount, n) in zip(past[-3:], [("Supermarché", "386,50", 13), ("Marché central", "214", 8), ("Supermarché", "248,75", 3)]):
    call("POST", f"/api/lists/{l['id']}/payments", {"requestId": str(uuid.uuid4()), "merchant": shop, "amount": amount, "date": day(n)}, sophie)
    call("PUT", f"/api/lists/{l['id']}/payments/status", {"complete": True}, sophie)
for kind, amount, c, merchant, label, n in [
    ("income", "9500", None, None, "Salaire", 16),
    ("expense", "400", "transport", "Station-service", "Carburant", 9),
    ("expense", "320", "maison", None, "Électricité", 7),
    ("expense", "185", "maison", None, "Internet", 5),
    ("expense", "46", "courses", "Boulangerie", "Pain et viennoiseries", 1),
]:
    call("POST", "/api/budget/operations", {"requestId": str(uuid.uuid4()), "kind": kind, "amount": amount, "date": day(n),
          "categoryId": cats.get(c) if c else None, "merchant": merchant, "label": label}, sophie)
call("PUT", "/api/budget/settings", {"budgetsEnabled": True}, sophie)
month = today.strftime("%Y-%m")
for c, amount in [("courses", "2500"), ("transport", "450"), ("maison", "1200"), ("autres", "500")]:
    call("PUT", "/api/budget/budgets", {"month": month, "categoryId": cats[c], "amount": amount}, sophie)
call("PUT", "/api/budget/account", {"opening": "4250", "referenceDate": first.isoformat(), "today": today.isoformat()}, sophie)

open(SQL_OUT, "w").write("\n".join(sql) + "\n")
print(json.dumps({"liste": lid, "selection": SELECTION, "courses_passees": len(PAST)}, ensure_ascii=False))
