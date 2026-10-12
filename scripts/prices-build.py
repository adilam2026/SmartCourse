#!/usr/bin/env python3
"""
Base initiale des prix : lit docs/prix/tableau-source.txt (tableau validé, transmis tel quel) et produit, SANS rien deviner :
  - docs/prix/import-base.csv          lignes intégrées (format de `admin-cli prices-import`)
  - docs/prix/prix-en-attente.csv      lignes conservées en attente, sans activation
  - docs/prix/controle-import.md       tableau de contrôle : produit, clé, prix, référence, statut intégré / en attente
  - server/migrations/019_base_prices_initial.sql   insertion idempotente (ON CONFLICT DO NOTHING : jamais d'écrasement)
Chaque produit est associé à sa clé stable EXACTE du catalogue (nom générique identique, jamais approximatif) ; une ligne sans correspondance
exacte est signalée et bloque la génération.
"""
import csv, re, sys, unicodedata

SRC = "docs/prix/tableau-source.txt"
CAT = "docs/catalogue/liste-finale.csv"
OBS_ON = "2026-10-12"
SOURCE = "captures du 12/10/2026"

def flat(s):
    s = s.replace("’", "'").replace("œ", "oe").replace("Œ", "oe")
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower().strip()

cat = {}
for r in csv.DictReader(open(CAT, encoding="utf-8-sig"), delimiter=";"):
    cat[flat(r["nom_generique"])] = r

def unit_fr(u):  # unité du catalogue de départ / proposée → code
    return {"pièce": "piece", "boîte": "boite"}.get(u, u)

STANDARD = {"pot": "pot", "boîte": "boite", "brique": "brique", "paquet": "paquet", "bouteille": "bouteille"}
OTHER = {"flacon": "bouteille", "bidon": "bouteille", "bombe": "piece", "rouleau": "piece", "barquette": "paquet", "sachet": "paquet", "petit pain": "piece", "aérosol": "piece", "tube": "piece"}

def parse_unit(u, prod):
    """(quantité de référence, unité de référence, conditionnement, remarque de rattachement)"""
    u = u.strip()
    if u in ("kg", "litre"):
        return "1", u, None, None
    if u == "pièce":
        return "1", "piece", None, None
    if u == "sachet":
        return "1", "paquet", "sachet (poids non précisé)", None
    if u == "petit pain":
        return "1", "piece", "petit pain", None
    m = re.match(r"^(pot|boîte|brique|paquet|bouteille) de (.+)$", u)
    if m:
        return "1", STANDARD[m.group(1)], m.group(2), None
    m = re.match(r"^(flacon|bidon|bombe|rouleau|barquette) de (.+)$", u)
    if m:
        return "1", OTHER[m.group(1)], u, None
    m = re.match(r"^quantité de (.+)$", u)
    if m:  # conteneur non précisé : rattaché à l'unité du catalogue, dit explicitement
        cu = unit_fr(prod["unite_proposee_nouvel_article"] or prod["unite_actuelle_catalogue_depart"])
        return "1", cu, u, f"conteneur non précisé : rattaché à l'unité du catalogue ({cu})"
    raise SystemExit(f"unité non reconnue : « {u} » ({prod['nom_generique']})")

def kind_of(note):
    n = flat(note or "")
    if "moyenne" in n:
        return "average"
    if any(w in n for w in ("arrondi", "estimation", "reference indicative", "lot de")):
        return "rounded"
    return "observed"

lines = open(SRC, encoding="utf-8").read().splitlines()
mode = None
integr, wait, errors = [], [], []
for ln in lines:
    s = ln.strip()
    if s.startswith("PRIX À INTÉGRER"): mode = "in"; continue
    if s.startswith("PRIX À CONSERVER"): mode = "wait"; continue
    if s.startswith("RÈGLES D'IMPORT"): mode = None; continue
    if not mode or ";" not in s: continue
    parts = [p.strip() for p in s.split(";")]
    name = parts[0]
    prod = cat.get(flat(name))
    if not prod:
        errors.append(f"produit sans correspondance exacte dans le catalogue : « {name} »")
        continue
    origin = "initial" if prod["origine"].startswith("Initial") else "extended"
    if mode == "in":
        price = parts[1].replace(",", ".")
        qty, ref, pack, attach = parse_unit(parts[2], prod)
        note = parts[3] if len(parts) > 3 else ""
        integr.append(dict(name=name, key=prod["cle_stable"], origin=origin, price=price, qty=qty, ref=ref, pack=pack, raw_unit=parts[2], note=note, attach=attach, kind=kind_of(note), cat_unit=unit_fr(prod["unite_proposee_nouvel_article"] or prod["unite_actuelle_catalogue_depart"])))
    else:
        wait.append(dict(name=name, key=prod["cle_stable"], origin=origin, raw_price=parts[1], note="; ".join(parts[2:])))
if errors:
    print("\n".join(errors)); sys.exit(1)
keys = [r["key"] for r in integr]
dup = {k for k in keys if keys.count(k) > 1}
if dup: sys.exit(f"clés en double : {dup}")
if {r["key"] for r in wait} & set(keys): sys.exit("une clé est à la fois intégrée et en attente")
if "nettoyant-sol" in keys or "nettoyant-sol" in {r["key"] for r in wait}: sys.exit("nettoyant sol : aucun prix")

KIND_FR = {"observed": "observé", "average": "moyenne", "rounded": "estimation arrondie"}
# compatibilité avec l'unité actuelle du catalogue de départ (les unités des familles ne sont jamais modifiées)
def compat(r):
    cu = r["cat_unit"]
    if r["ref"] in ("kg", "litre"):
        return cu == r["ref"]
    return cu == r["ref"]

with open("docs/prix/import-base.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f, delimiter=";")
    w.writerow("cle_stable;origine;produit_observe;montant;quantite_reference;unite_reference;conditionnement;poids_piece_g;nature;source;date_capture;statut;remise_conditionnelle;valide_pour_generique;remarque".split(";"))
    for r in integr:
        w.writerow([r["key"], r["origin"], r["name"], r["price"].replace(".", ","), r["qty"], r["ref"], r["pack"] or "", "", {"observed": "observation", "average": "moyen", "rounded": "arrondi"}[r["kind"]], SOURCE, OBS_ON, "confirmé", "non", "", "; ".join(x for x in (r["note"], r["attach"]) if x)])
with open("docs/prix/prix-en-attente.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f, delimiter=";")
    w.writerow(["cle_stable", "origine", "produit", "prix_transmis", "raison_de_l_attente", "activation"])
    for r in wait:
        w.writerow([r["key"], r["origin"], r["name"], r["raw_price"], r["note"], "aucune : conservé sans activation"])

def q(s): return "NULL" if s is None else "'" + s.replace("'", "''") + "'"
vals = []
for r in integr:
    vals.append(f"  ('{r['origin']}', {q(r['key'])}, {r['price']}, {r['qty']}, '{r['ref']}', {q(r['pack'])}, NULL, '{r['kind']}', {q(SOURCE)}, DATE '{OBS_ON}', {q('; '.join(x for x in (r['note'], r['attach']) if x) or None)})")
open("server/migrations/019_base_prices_initial.sql", "w", encoding="utf-8").write(
"""-- Base initiale des prix (captures du 12/10/2026, tableau validé). GÉNÉRÉ par scripts/prices-build.py — ne pas éditer à la main.
-- Prix INDICATIFS en dirhams, associés à la clé stable exacte du catalogue ; masqués par défaut dans l'application.
-- Aucun prix de famille n'est modifié ni écrasé (la base ne copie rien) ; aucune unité n'est modifiée ; aucun article n'est créé.
-- Insertion idempotente : une ligne déjà présente est conservée. Les prix « en attente » (riz, dinde, huile d'argan…) ne sont PAS importés.
INSERT INTO base_prices (origin, key, amount, ref_qty, ref_unit, packaging, piece_weight_g, kind, source, observed_on, note) VALUES
""" + ",\n".join(vals) + "\nON CONFLICT (origin, key) DO NOTHING;\n-- Les téléphones relisent le catalogue pour afficher ces prix (quand l'utilisateur les active).\nUPDATE families SET catalog_rev = catalog_rev + 1;\n")

def eur(p): return p.replace(".", ",") + " DH"
md = ["# Contrôle de l'import — base initiale des prix (captures du 12/10/2026)", "",
      f"**{len(integr)} prix intégrés**, **{len(wait)} prix en attente** (conservés sans activation), nettoyant sol : aucun prix. Prix indicatifs, masqués par défaut ; aucune remise ni cashback déduit ; aucune unité de famille modifiée ; aucun prix personnalisé écrasé ; aucun article créé.", "",
      "Colonne « Calcul avec l'unité du catalogue » : `oui` si une quantité en unité du catalogue de départ donne un montant ; sinon `non` — le montant n'est PAS calculé et « Prix à compléter » s'affiche quand les prix sont activés (aucune conversion pièce ↔ kg sans poids, aucun changement d'unité).", "",
      "## Intégrés", "", "| Produit | Clé stable | Prix | Référence | Nature | Statut | Calcul avec l'unité du catalogue | Précision |", "|---|---|---|---|---|---|---|---|"]
for r in integr:
    ref = {"kg": "kg", "litre": "litre", "piece": "pièce", "paquet": "paquet", "pot": "pot", "boite": "boîte", "brique": "brique", "bouteille": "bouteille"}[r["ref"]]
    ref = ref + (f" — {r['pack']}" if r["pack"] else "")
    ok = "oui" if compat(r) else f"non (catalogue : {r['cat_unit']})"
    md.append(f"| {r['name']} | `{r['key']}` | {eur(r['price'])} | {ref} | {KIND_FR[r['kind']]} | intégré | {ok} | {'; '.join(x for x in (r['note'], r['attach']) if x)} |")
md += ["", "## En attente (conservés, sans activation)", "", "| Produit | Clé stable | Prix transmis | Statut | Raison |", "|---|---|---|---|---|"]
for r in wait:
    md.append(f"| {r['name']} | `{r['key']}` | {r['raw_price']} | en attente | {r['note']} |")
md += ["", "## Exclu : nettoyant sol", "", "`nettoyant-sol` : **aucun prix**. Le montant 32,20 DH / 500 ml concernait un nettoyant four. La clé reste exclue de l'import par une règle de l'outil.", ""]
unpriced = [k for k in cat.values() if k["cle_stable"] not in keys and k["cle_stable"] not in {w["key"] for w in wait}]
md += [f"## Produits du catalogue sans prix ({len(unpriced)} sur {len(cat)})", "", "Jamais à zéro : « Prix à compléter » quand les prix sont activés. " + ", ".join(k["nom_generique"] for k in unpriced) + ".", ""]
open("docs/prix/controle-import.md", "w", encoding="utf-8").write("\n".join(md))
print(f"{len(integr)} intégrés, {len(wait)} en attente, {len(unpriced)} sans prix ; non calculables avec l'unité du catalogue : {sum(1 for r in integr if not compat(r))}")
