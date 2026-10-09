#!/usr/bin/env python3
"""Generates migrations/003_catalog.sql (80 produits initiaux) et 004_extended_seed.sql. Lancé une fois, SQL commité."""
import unicodedata, re, os

CATS = [
 ("legumes","Légumes et herbes",["Tomates","Pommes de terre","Oignons","Carottes","Courgettes","Concombres","Poivrons verts","Poivrons rouges","Aubergines","Haricots verts","Laitue","Ail","Persil","Coriandre","Menthe"]),
 ("fruits","Fruits",["Bananes","Pommes","Oranges","Clémentines","Citrons","Fraises","Raisins","Avocats","Poires","Fruits de saison"]),
 ("laitages","Laitages et œufs",["Lait","Beurre","Fromage en portions","Fromage à tartiner","Fromage râpé","Yaourt nature","Yaourt aromatisé","Yaourt à boire","Crème fraîche","Œufs"]),
 ("epicerie","Épicerie",["Huile de table","Huile d’olive","Sucre","Farine","Semoule fine","Riz","Pâtes","Vermicelles","Lentilles","Pois chiches","Concentré de tomates","Sel","Poivre","Cumin","Levure chimique"]),
 ("viandes","Viandes et poisson",["Poulet","Viande hachée","Viande de bœuf","Poisson","Thon en conserve"]),
 ("surgeles","Surgelés",["Petits pois surgelés","Frites surgelées"]),
 ("pain","Pain et petit-déjeuner",["Pain de mie","Pain","Confiture","Miel","Café","Thé"]),
 ("boissons","Boissons",["Eau minérale","Jus de fruits"]),
 ("maison","Maison",["Liquide vaisselle","Lessive","Assouplissant","Eau de Javel","Nettoyant sol","Papier toilette","Essuie-tout","Sacs-poubelle","Éponges"]),
 ("hygiene","Hygiène",["Savon liquide","Dentifrice","Shampooing","Gel douche","Mouchoirs en papier","Lingettes"]),
]
EXT = {
 "legumes":["Champignons","Poireaux","Choux-fleurs","Brocolis","Épinards","Petits pois","Navets","Betteraves","Radis","Céleri","Potiron","Fenouil","Piments","Gingembre","Aneth","Chou","Salade verte","Maïs"],
 "fruits":["Pastèque","Melon","Pêches","Abricots","Cerises","Mangues","Ananas","Kiwis","Dattes","Figues","Grenades","Prunes"],
 "laitages":["Crème dessert","Fromage blanc","Mozzarella","Lait concentré","Lait en poudre","Lben","Fromage frais"],
 "epicerie":["Couscous","Maïs en conserve","Haricots blancs","Harissa","Paprika","Curcuma","Cannelle","Cacao en poudre","Pâte à tartiner","Biscuits","Céréales","Vinaigre","Moutarde","Mayonnaise","Ketchup","Olives","Amandes","Noix","Levure de boulanger","Sucre glace","Sucre vanillé","Farine complète"],
 "viandes":["Agneau","Dinde","Merguez","Sardines en conserve","Crevettes","Saucisses","Jambon de dinde"],
 "surgeles":["Légumes surgelés","Glaces","Poisson pané","Pâte feuilletée"],
 "pain":["Baguette","Pain complet","Brioche","Biscottes","Crêpes","Gâteaux secs"],
 "boissons":["Boisson gazeuse","Sirop","Eau gazeuse","Café en capsules","Tisane","Lait d’amande"],
 "maison":["Pastilles lave-vaisselle","Désodorisant","Papier aluminium","Film alimentaire","Piles","Ampoules","Sacs congélation","Détartrant","Dégraissant"],
 "hygiene":["Déodorant","Coton","Rasoirs","Brosse à dents","Après-shampooing","Protections hygiéniques","Couches","Crème hydratante","Sérum physiologique"],
}
def norm(s):
    s=unicodedata.normalize("NFD",s)
    s="".join(c for c in s if unicodedata.category(c)!="Mn")
    return s.lower().replace("œ","oe").replace("’","'")
def key(s):
    return re.sub(r"[^a-z0-9]+","-",norm(s)).strip("-")
q=lambda s:"'"+s.replace("'","''")+"'"

out=["-- Généré par scripts/gen-catalog-sql.py — 80 produits exacts du cahier des charges.",
"""CREATE TABLE categories (
  key       text PRIMARY KEY,
  label     text NOT NULL,
  position  integer NOT NULL
);

CREATE TABLE photo_assets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_family_id      uuid REFERENCES families(id),   -- NULL = photo commune (catalogue initial / étendu)
  storage_key          text NOT NULL,
  content_hash         text NOT NULL,
  mime                 text NOT NULL,
  width                integer NOT NULL,
  height               integer NOT NULL,
  bytes                integer NOT NULL,
  source_name          text NOT NULL,
  source_url           text,
  license              text NOT NULL,
  license_url          text,
  author               text,
  attribution_required boolean NOT NULL DEFAULT false,
  attribution_text     text,
  imported_at          timestamptz NOT NULL DEFAULT now(),
  imported_by          uuid REFERENCES profiles(id)
);

-- Une photo est immuable : on n'en modifie jamais une, on en ajoute une nouvelle.
CREATE FUNCTION photo_assets_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'photo_assets est immuable (% interdit)', TG_OP;
END $$;
CREATE TRIGGER photo_assets_no_update BEFORE UPDATE OR DELETE ON photo_assets
  FOR EACH ROW EXECUTE FUNCTION photo_assets_immutable();

CREATE TABLE initial_catalog (
  key            text PRIMARY KEY,
  category       text NOT NULL REFERENCES categories(key),
  name           text NOT NULL,
  position       integer NOT NULL,
  photo_asset_id uuid REFERENCES photo_assets(id)
);

CREATE TABLE extended_catalog (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category       text NOT NULL REFERENCES categories(key),
  name           text NOT NULL,
  brand          text,
  search_text    text NOT NULL,
  photo_asset_id uuid REFERENCES photo_assets(id),
  source         text NOT NULL DEFAULT 'manual'
);
CREATE INDEX extended_catalog_search_idx ON extended_catalog (search_text text_pattern_ops);

CREATE TABLE products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      uuid NOT NULL REFERENCES families(id),
  category       text NOT NULL REFERENCES categories(key),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  brand          text CHECK (brand IS NULL OR length(brand) BETWEEN 1 AND 40),
  active         boolean NOT NULL DEFAULT true,
  photo_asset_id uuid REFERENCES photo_assets(id),
  catalog_key    text REFERENCES initial_catalog(key),
  extended_id    uuid REFERENCES extended_catalog(id),
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Un même produit (nom + marque) ne peut exister qu'une fois par famille. Pas de DELETE : l'historique référence products.id.
CREATE UNIQUE INDEX products_identity_idx ON products (family_id, lower(name), coalesce(lower(brand), ''));
CREATE INDEX products_family_idx ON products (family_id, category, position);
"""]
out.append("INSERT INTO categories (key,label,position) VALUES")
out.append(",\n".join(f"  ({q(k)},{q(l)},{i})" for i,(k,l,_) in enumerate(CATS))+";")
rows=[];n=0
for k,l,names in CATS:
    for i,nm in enumerate(names):
        rows.append(f"  ({q(key(nm))},{q(k)},{q(nm)},{i})");n+=1
assert n==80,n
out.append("INSERT INTO initial_catalog (key,category,name,position) VALUES")
out.append(",\n".join(rows)+";")
open("migrations/003_catalog.sql","w").write("\n".join(out)+"\n")

init={nm for _,_,ns in CATS for nm in ns}
rows=[]
for k,ns in EXT.items():
    for nm in ns:
        assert nm not in init,nm
        rows.append(f"  ({q(k)},{q(nm)},{q(norm(nm))},'seed-v1')")
sql="-- Liste de départ (noms génériques, sans photo) : volontairement non exhaustive.\nINSERT INTO extended_catalog (category,name,search_text,source) VALUES\n"+",\n".join(rows)+";\n"
open("migrations/004_extended_seed.sql","w").write(sql)
print("ok",n,len(rows))
