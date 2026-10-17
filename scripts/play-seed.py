#!/usr/bin/env python3
"""Données FICTIVES pour les captures de la fiche Google Play (serveur de recette local et jetable uniquement).

Famille Martin (créée par recette-seed.mjs avec SEED_PLAY=1, puis Léa ajoutée ici) : une liste en cours avec photos, trois courses passées.
Version 1166 : pays Maroc (Casablanca), « Plusieurs listes actives » (trois listes nommées) et Budget en MAD (paiements des courses
passées, dépenses et entrée du mois, budgets mensuels, solde de « Mon compte »). Magasins génériques, aucune enseigne réelle.
Usage : play-seed.py BASE CODE_FAMILLE FICHIER_SQL
Le fichier SQL écrit ensuite (à exécuter sur la base jetable) date les courses passées de quelques jours.
"""
import datetime, json, sys, uuid, urllib.request

BASE, FAMILY, SQL_OUT = sys.argv[1], sys.argv[2], sys.argv[3]


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
    _, _, h = call("POST", "/api/auth/login", {"familyCode": FAMILY, "login": who, "secret": secret})
    for c in h.get_all("set-cookie") or []:
        if c.startswith("sc_session="):
            return c.split(";")[0]
    raise SystemExit(f"connexion {who} : pas de cookie")


def ops(cookie, list_id, items):
    return call("POST", f"/api/lists/{list_id}/ops", {"ops": [dict(opId=str(uuid.uuid4()), **o) for o in items]}, cookie)[1]


sophie = login("sophie", "482913")
# Profil supplémentaire (fictif) pour l'écran des profils
call("POST", "/api/profiles", {"displayName": "Léa", "login": "lea", "role": "parent", "secret": "573918", "secretConfirm": "573918", "city": "Casablanca"}, sophie)
karim = login("karim", "573918")

cat = call("GET", "/api/catalog", cookie=sophie)[1]
by_name = {p["name"]: p for c in cat["categories"] for p in c["products"] if p.get("photoUrl")}


def pick(spec):
    missing = [n for n, _ in spec if n not in by_name]
    if missing:
        raise SystemExit(f"produits absents du catalogue : {missing}")
    return [(by_name[n], q) for n, q in spec]


def fill(list_id, chosen, buyers):
    ops(sophie, list_id, [{"type": "add", "productId": p["id"], "quantity": q} for p, q in chosen])
    items = call("GET", f"/api/lists/{list_id}", cookie=sophie)[1]["list"]["items"]
    by_pid = {i["productId"]: i for i in items}
    for who, names in buyers:
        ids = [by_pid[p["id"]]["id"] for p, _ in chosen if p["name"] in names]
        if ids:
            ops(who, list_id, [{"type": "purchase", "itemId": x} for x in ids])


PAST = [
    (12, [("Pommes de terre", 2), ("Oignons", 1), ("Carottes", 1), ("Lait", 6), ("Œufs", 12), ("Riz", 1), ("Liquide vaisselle", 1)]),
    (6, [("Poulet", 1), ("Courgettes", 1), ("Citrons", 0.5), ("Yaourt nature", 8), ("Pâtes", 2), ("Café", 1)]),
    (2, [("Tomates", 1), ("Bananes", 1), ("Oranges", 2), ("Pain", 4), ("Fromage à tartiner", 1), ("Eau minérale", 6), ("Papier toilette", 1), ("Lessive", 1)]),
]
CURRENT = [("Tomates", 1.5), ("Pommes de terre", 2), ("Courgettes", 1), ("Bananes", 1), ("Yaourt nature", 8), ("Riz", 1),
           ("Lait", 6), ("Œufs", 12), ("Pain", 4)]
BOUGHT_NOW = ["Lait", "Œufs", "Pain"]

sql = ["SET session_replication_role = replica;"]  # base jetable : gardes des listes archivées suspendues le temps de dater
# Trois courses passées (datées de 12, 6 et 2 jours), achetées par Sophie et Karim
for days, spec in PAST:
    active = call("GET", "/api/lists/active", cookie=sophie)[1]["list"]
    lid = active["id"] if active else call("POST", "/api/lists", cookie=sophie)[1]["list"]["id"]
    chosen = pick(spec)
    names = [p["name"] for p, _ in chosen]
    fill(lid, chosen, [(sophie, names[: len(names) // 2]), (karim, names[len(names) // 2 :])])
    call("POST", f"/api/lists/{lid}/close", {}, sophie)
    at = f"now() - interval '{days} days'"
    sql += [f"UPDATE lists SET created_at = {at} - interval '3 hours', closed_at = {at} WHERE id = '{lid}';",
            f"UPDATE list_items SET added_at = {at} - interval '3 hours', updated_at = {at} WHERE list_id = '{lid}';",
            f"UPDATE purchases SET purchased_at = {at} - interval '40 minutes' WHERE list_id = '{lid}';"]
sql.append("SET session_replication_role = DEFAULT;")

# Pays de la famille confirmé (pas de demande de confirmation à la connexion), puis options avancées
call("PUT", "/api/family/location", {"country": "MA", "city": "Casablanca"}, sophie)
call("PUT", "/api/family/features", {"multiLists": True}, sophie)
call("PUT", "/api/family/features", {"budget": True, "currency": "MAD"}, sophie)

# Listes en cours : la liste de la semaine (neuf articles, trois déjà achetés par Karim) et deux autres listes nommées
lid = call("POST", "/api/lists", {"name": "Courses de la semaine"}, sophie)[1]["list"]["id"]
fill(lid, pick(CURRENT), [(karim, BOUGHT_NOW)])
others = [
    ("Anniversaire de Léa", [("Farine", 1), ("Sucre", 1), ("Œufs", 6), ("Beurre", 1), ("Fraises", 1), ("Jus de fruits", 4)], ["Farine", "Sucre"]),
    ("Produits ménagers", [("Lessive", 1), ("Liquide vaisselle", 1), ("Éponges", 1), ("Essuie-tout", 1)], []),
]
for name, spec, bought in others:
    x = call("POST", "/api/lists", {"name": name}, sophie)[1]["list"]["id"]
    fill(x, pick(spec), [(karim, bought)])
call("PUT", "/api/me/current-list", {"listId": lid}, sophie)  # Sophie revient sur la liste de la semaine

# Budget (MAD) : paiements des trois courses passées, opérations du mois, budgets mensuels et solde de « Mon compte »
today = datetime.date.today()
first = today.replace(day=1)
day = lambda n: max(today - datetime.timedelta(days=n), first).isoformat()  # tout reste dans le mois affiché
cats = {c["key"]: c["id"] for c in call("GET", "/api/budget", cookie=sophie)[1]["categories"] if c.get("key")}
past = [l for l in call("GET", "/api/lists", cookie=sophie)[1]["lists"] if l.get("closedAt")]
past.sort(key=lambda l: l["createdAt"])
for l, (shop, amount, n) in zip(past, [("Supermarché", "486,50", 12), ("Marché central", "312", 6), ("Supermarché", "254,75", 2)]):
    call("POST", f"/api/lists/{l['id']}/payments", {"requestId": str(uuid.uuid4()), "merchant": shop, "amount": amount, "date": day(n)}, sophie)
    call("PUT", f"/api/lists/{l['id']}/payments/status", {"complete": True}, sophie)
for kind, amount, cat, merchant, label, n in [
    ("income", "9500", None, None, "Salaire", 16),
    ("expense", "400", "transport", "Station-service", "Carburant", 9),
    ("expense", "320", "maison", None, "Électricité", 7),
    ("expense", "185", "maison", None, "Internet", 5),
    ("expense", "85,40", "autres", "Pharmacie", "Pharmacie", 3),
    ("expense", "46", "courses", "Boulangerie", "Pain et viennoiseries", 1),
]:
    call("POST", "/api/budget/operations", {"requestId": str(uuid.uuid4()), "kind": kind, "amount": amount, "date": day(n),
          "categoryId": cats.get(cat) if cat else None, "merchant": merchant, "label": label}, sophie)
call("PUT", "/api/budget/settings", {"budgetsEnabled": True}, sophie)
month = today.strftime("%Y-%m")
for cat, amount in [("courses", "2500"), ("transport", "450"), ("maison", "1200"), ("autres", "500")]:
    call("PUT", "/api/budget/budgets", {"month": month, "categoryId": cats[cat], "amount": amount}, sophie)
call("PUT", "/api/budget/account", {"opening": "4250", "referenceDate": first.isoformat(), "today": today.isoformat()}, sophie)

open(SQL_OUT, "w").write("\n".join(sql) + "\n")
print(json.dumps({"liste": lid, "articles": [n for n, _ in CURRENT], "achetes": BOUGHT_NOW, "autres_listes": [o[0] for o in others]}, ensure_ascii=False))
