#!/usr/bin/env python3
"""Génère docs/catalogue/{liste-finale.csv,liste-finale.md,manifeste-images.csv,manifeste-images.json}
à partir du catalogue de départ (80), du catalogue étendu en base (migration 004) et des ajouts proposés ci-dessous."""
import csv, json, re, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "catalogue"
CATS = {"legumes": "Légumes et herbes", "fruits": "Fruits", "laitages": "Laitages et œufs", "epicerie": "Épicerie", "viandes": "Viandes et poisson",
        "surgeles": "Surgelés", "pain": "Pain et petit-déjeuner", "boissons": "Boissons", "maison": "Maison", "hygiene": "Hygiène"}
ORDER = list(CATS)

def slug(s):
    s = unicodedata.normalize("NFD", s.lower()); s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("œ", "oe").replace("’", "-").replace("'", "-")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

UNIT_DEFAULT = {"legumes": "kg", "fruits": "kg", "viandes": "kg", "boissons": "bouteille", "epicerie": "paquet", "surgeles": "paquet"}
def unit_for(cat, name, over):
    return over.get(name) or UNIT_DEFAULT.get(cat, "piece")

# ---- catalogue de départ : 80 produits, photos vérifiées une à une (planches docs/catalogue/planches/initial-0X.png)
initial = []
for line in (Path(sys.argv[1]).read_text(encoding="utf8").splitlines() if len(sys.argv) > 1 else []):
    c, k, n, u = line.split("|"); initial.append((c, k, n, u))

# renommages proposés (identifiant, unité et historique conservés)
RENAME = {"sel": ("Sel alimentaire", "à distinguer du « Sel régénérant pour lave-vaisselle »")}
INITIAL_NOTE = {"levure-chimique": "photo correcte ; le mot « LEVURE » imprimé sur le sachet est générique (à régénérer sans texte si on veut zéro texte)",
                "eau-de-javel": "photo correcte ; le mot « JAVEL » sur le flacon est générique (idem)",
                "huile-de-table": "nom à décider : garder « Huile de table » (usage courant) ou « Huile végétale »",
                "laitue": "garder ; voir « Salade verte » (feuilles) ci-dessous"}

# ---- catalogue étendu actuel (100) : unité éventuelle, description de la photo attendue, alias de recherche
E = {}  # name -> (unit_override, description, alias)
def e(name, desc, unit=None, alias=""): E[name] = (unit, desc, alias)
e("Champignons", "Champignons de Paris blancs, entiers et un coupé en deux, sur fond blanc")
e("Poireaux", "Trois poireaux entiers avec le vert et la racine barbue")
e("Choux-fleurs", "Un chou-fleur entier avec feuilles vertes, un morceau de fleurette devant", "piece", "chou fleur")
e("Brocolis", "Un brocoli entier et quelques fleurettes", "piece", "brocoli")
e("Épinards", "Botte de feuilles d'épinards fraîches")
e("Petits pois", "Cosses de petits pois ouvertes avec des pois verts visibles (frais, pas surgelés)")
e("Navets", "Trois navets blancs à collerette violette avec fanes")
e("Betteraves", "Betteraves rouges entières avec fanes, une coupée en deux")
e("Radis", "Botte de radis rouges ronds avec fanes")
e("Céleri", "Branches de céleri vert (céleri-branche) avec feuilles", "piece", "celeri branche")
e("Potiron", "Un quartier de potiron/courge orange avec la chair visible et graines", "kg", "courge citrouille")
e("Fenouil", "Un bulbe de fenouil blanc avec tiges et feuilles vertes", "piece")
e("Piments", "Piments verts et rouges frais, entiers, avec queue")
e("Gingembre", "Racine de gingembre frais, un morceau coupé montrant l'intérieur jaune pâle")
e("Aneth", "Botte d'aneth frais aux feuilles fines et plumeuses", "piece")
e("Chou", "Un chou vert pommé entier, un quart coupé montrant les feuilles serrées", "piece", "chou vert")
e("Salade verte", "Salade à feuilles vertes séparées (batavia/feuille de chêne), pas une laitue pommée", "piece", "salade feuilles")
e("Maïs", "Deux épis de maïs frais avec quelques feuilles, grains jaunes visibles", "piece", "mais epi")
e("Pastèque", "Une demi-pastèque rouge avec écorce verte et une tranche triangulaire devant")
e("Melon", "Un melon entier brodé et une tranche montrant la chair orange")
e("Pêches", "Trois pêches avec feuille, une coupée montrant le noyau")
e("Abricots", "Quatre abricots, un coupé en deux avec noyau")
e("Cerises", "Grappe de cerises rouges avec queues")
e("Mangues", "Une mangue entière rouge-jaune et une moitié coupée")
e("Ananas", "Un ananas entier avec sa couronne et deux rondelles devant", "piece")
e("Kiwis", "Trois kiwis dont un coupé en deux montrant la chair verte et les pépins")
e("Dattes", "Dattes brunes (type Medjool) en petit tas, certaines avec noyau visible", "kg")
e("Figues", "Figues fraîches violettes, une coupée en deux montrant l'intérieur rose")
e("Grenades", "Une grenade entière et une ouverte avec graines rouges visibles", "kg")
e("Prunes", "Prunes violettes, une coupée en deux avec noyau")
e("Crème dessert", "Trois pots individuels de crème dessert (chocolat/vanille), un avec cuillère, sans marque", "pot", "creme dessert flan danette")
e("Fromage blanc", "Pot de fromage blanc ouvert avec une cuillère, texture lisse blanche", "pot")
e("Mozzarella", "Boule de mozzarella blanche dans un peu de liquide, une tranche coupée", "boite")
e("Lait concentré", "Boîte de lait concentré sucré ouverte versant un filet épais crémeux, sans marque", "boite", "lait concentre sucre")
e("Lait en poudre", "Boîte de lait en poudre avec une mesure et de la poudre blanche, sans marque", "boite")
e("Lben", "Bouteille ou verre de lben (lait fermenté) blanc, sans marque", "bouteille", "petit lait lait fermente")
e("Fromage frais", "Fromage frais blanc en petit pot ouvert, et une portion étalée", "pot")
e("Couscous", "Paquet de couscous avec un bol de grains de couscous cuit/sec, sans marque", "paquet")
e("Maïs en conserve", "Boîte de maïs ouverte avec grains jaunes visibles, sans marque", "boite", "mais conserve")
e("Haricots blancs", "Bol de haricots blancs secs avec quelques haricots épars", "paquet", "loubia")
e("Harissa", "Petit pot ou tube de harissa rouge avec une cuillère, piments rouges à côté", "pot")
e("Paprika", "Petit pot et cuillère de paprika rouge en poudre")
e("Curcuma", "Pot et cuillère de curcuma jaune vif en poudre, racine de curcuma à côté", "paquet")
e("Cannelle", "Bâtons de cannelle et un petit tas de cannelle en poudre")
e("Cacao en poudre", "Boîte ou bol de cacao en poudre brun foncé avec une cuillère", "boite")
e("Pâte à tartiner", "Pot ouvert de pâte à tartiner chocolat-noisette avec couteau, sans marque", "pot", "chocolat tartiner")
e("Biscuits", "Paquet de biscuits secs ronds ouvert avec quelques biscuits devant, sans marque", "paquet")
e("Céréales", "Bol de céréales du petit-déjeuner avec lait et boîte de céréales, sans marque", "boite")
e("Vinaigre", "Bouteille de vinaigre (blanc ou de cidre), étiquette neutre", "bouteille")
e("Moutarde", "Pot de moutarde jaune avec une cuillère", "pot")
e("Mayonnaise", "Pot ou tube de mayonnaise avec une cuillère, sans marque", "pot")
e("Ketchup", "Flacon de ketchup rouge souple, sans marque", "bouteille")
e("Olives", "Bocal d'olives vertes et noires avec bol d'olives, sans marque", "pot", "olive verte noire")
e("Amandes", "Bol d'amandes entières avec quelques amandes devant", "paquet")
e("Noix", "Noix entières en coque et cerneaux de noix dans un bol", "paquet")
e("Levure de boulanger", "Sachets de levure de boulanger sèche et un peu de poudre/granulés, sans marque", "paquet", "levure boulangere")
e("Sucre glace", "Sachet de sucre glace blanc très fin avec un bol et tamis", "paquet")
e("Sucre vanillé", "Petits sachets de sucre vanillé avec une gousse de vanille", "paquet")
e("Farine complète", "Sac de farine complète beige avec cuillère en bois et épis de blé", "paquet")
e("Agneau", "Côtelettes et morceau d'épaule d'agneau cru sur plateau blanc")
e("Dinde", "Escalopes de dinde crues sur plateau blanc")
e("Merguez", "Cinq merguez rouges crues en chapelet, sur plateau blanc", "kg")
e("Sardines en conserve", "Boîte de sardines ouverte montrant les poissons à l'huile, sans marque", "boite")
e("Crevettes", "Crevettes crues roses/grises dans un bol, quelques-unes devant")
e("Saucisses", "Saucisses de volaille/bœuf crues alignées sur plateau", "paquet")
e("Jambon de dinde", "Tranches de jambon de dinde roulées/empilées sur assiette", "paquet")
e("Légumes surgelés", "Sachet transparent de macédoine/mélange de légumes surgelés (carottes, petits pois, haricots)", "paquet")
e("Glaces", "Bac de crème glacée vanille avec une boule dans une coupe", "piece", "glace creme glacee")
e("Poisson pané", "Bâtonnets de poisson panés dorés dans un paquet, sans marque", "paquet", "poisson pane nuggets poisson")
e("Pâte feuilletée", "Rouleau de pâte feuilletée déroulé avec papier cuisson, bords feuilletés visibles", "piece")
e("Baguette", "Deux baguettes de pain croustillantes, un morceau coupé", "piece")
e("Pain complet", "Pain complet en tranches avec graines, miche entamée", "piece")
e("Brioche", "Une brioche dorée tressée ou ronde avec une tranche coupée", "piece")
e("Biscottes", "Paquet de biscottes avec quelques biscottes empilées, sans marque", "paquet")
e("Crêpes", "Pile de crêpes pliées avec un filet de sirop/miel", "paquet", "crepes msemen")
e("Gâteaux secs", "Assortiment de gâteaux secs marocains (sablés, cornes de gazelle) sur assiette", "paquet", "gateaux marocains sablés")
e("Boisson gazeuse", "Bouteille de boisson gazeuse brune avec verre et glaçons, étiquette neutre sans logo", "bouteille", "soda limonade")
e("Sirop", "Bouteille de sirop coloré (grenadine/menthe) avec un verre dilué", "bouteille")
e("Eau gazeuse", "Bouteille d'eau gazeuse avec bulles et verre, étiquette neutre", "bouteille")
e("Café en capsules", "Boîte de capsules de café avec 3 capsules et une tasse", "boite", "capsules cafe")
e("Tisane", "Boîte de sachets de tisane avec un sachet et une tasse, feuilles de verveine", "boite", "infusion verveine")
e("Lait d'amande", "Brique de boisson végétale à l'amande avec verre et amandes (à faire évoluer en « Boisson végétale »)", "brique", "boisson vegetale soja avoine")
e("Pastilles lave-vaisselle", "Pastilles de lave-vaisselle emballées et une pastille dans un lave-vaisselle, sans marque", "boite", "tablettes lave vaisselle")
e("Désodorisant", "Flacon spray désodorisant d'intérieur avec fleurs/citron, sans marque", "piece", "desodorisant maison")
e("Papier aluminium", "Rouleau de papier aluminium dans sa boîte avec quelques centimètres déroulés", "piece", "alu")
e("Film alimentaire", "Rouleau de film alimentaire transparent dans sa boîte avec un bout déroulé", "piece", "film etirable")
e("Piles", "Quatre piles alcalines AA/AAA génériques, sans marque", "paquet")
e("Ampoules", "Ampoules LED à culot à vis, une allumée", "piece")
e("Sacs congélation", "Boîte de sacs zip de congélation transparents avec un sac contenant des légumes", "boite", "sacs zip")
e("Détartrant", "Flacon de détartrant avec pommeau de douche/robinet sans calcaire", "bouteille")
e("Dégraissant", "Flacon spray dégraissant de cuisine avec plaque de cuisson propre", "bouteille")
e("Déodorant", "Déodorant bille ou stick générique blanc/bleu, sans marque", "piece")
e("Coton", "Paquet de cotons-tiges ou rondelles de coton démaquillantes", "paquet", "coton demaquillant cotons tiges")
e("Rasoirs", "Trois rasoirs jetables avec lames visibles", "paquet")
e("Brosse à dents", "Deux brosses à dents manuelles de couleurs différentes", "piece", "brosses a dents")
e("Après-shampooing", "Flacon d'après-shampooing crème avec mèche de cheveux brillants", "bouteille", "apres shampoing demelant")
e("Protections hygiéniques", "Paquet de serviettes hygiéniques et quelques serviettes dépliées", "paquet", "serviettes hygieniques")
e("Couches", "Paquet de couches bébé et une couche dépliée, sans marque", "paquet", "couches bebe")
e("Crème hydratante", "Pot de crème hydratante ouvert avec texture blanche", "pot", "creme visage corps")
e("Sérum physiologique", "Boîte de dosettes de sérum physiologique stériles, quelques dosettes devant", "boite", "serum physio dosettes")

# ---- ajouts proposés (nouveaux) : (catégorie, nom, unité, description photo, alias, note)
N = []
def n(cat, name, unit, desc, alias="", note=""): N.append((cat, name, unit, desc, alias, note))
# Légumes et herbes
n("legumes", "Ciboulette", "piece", "Petite botte de ciboulette aux tiges fines et vertes")
n("legumes", "Roquette", "piece", "Poignée de feuilles de roquette découpées, vert foncé")
n("legumes", "Romarin", "piece", "Brins de romarin frais aux aiguilles vertes")
n("legumes", "Thym", "piece", "Brins de thym frais aux petites feuilles", "zaatar frais")
n("legumes", "Sauge", "piece", "Brins de sauge aux feuilles gris-vert veloutées")
n("legumes", "Basilic", "piece", "Botte de basilic frais aux larges feuilles vertes brillantes")
n("legumes", "Fèves fraîches", "kg", "Cosses de fèves fraîches ouvertes avec fèves vertes visibles", "foul fave verte", "à distinguer de « Fèves sèches »")
# Fruits
n("fruits", "Pamplemousse", "kg", "Pamplemousse rose entier et un coupé en deux, chair rose")
n("fruits", "Framboises", "paquet", "Barquette ouverte de framboises rouges fraîches")
n("fruits", "Mûres", "paquet", "Barquette ouverte de mûres noires fraîches")
n("fruits", "Noix de coco", "piece", "Une noix de coco brune entière et une moitié avec chair blanche")
n("fruits", "Papaye", "piece", "Une papaye entière jaune-orange et une moitié avec graines noires")
n("fruits", "Fruit de la passion", "piece", "Fruits de la passion violets, un coupé montrant la pulpe jaune et les graines", "maracuja")
n("fruits", "Coings", "kg", "Coings jaunes duveteux avec une feuille, un coupé en deux")
n("fruits", "Châtaignes", "kg", "Châtaignes brunes brillantes en tas, une ouverte avec bogue")
n("fruits", "Raisins secs", "paquet", "Bol de raisins secs bruns/dorés ridés (surtout pas du raisin frais)", "raisin sec", "à distinguer de « Raisins » (frais)")
# Laitages et œufs
n("laitages", "Fromage en tranches", "paquet", "Paquet de tranches de fromage jaune individuelles avec quelques tranches empilées, sans marque", "fromage tranche cheddar")
n("laitages", "Margarine", "boite", "Barquette de margarine ouverte avec couteau, sans marque")
n("laitages", "Crème de cuisson", "brique", "Petite brique de crème de cuisson avec filet de crème versée", "creme liquide")
n("laitages", "Crème chantilly", "piece", "Bombe de crème chantilly avec une rosace de chantilly sur une coupe de fraises", "chantilly")
n("laitages", "Smen", "pot", "Pot en verre ou en terre de smen (beurre rance marocain) ouvert, jaune pâle, cuillère", "smen beurre rance", "à distinguer de « Beurre »")
# Pain et petit-déjeuner
n("pain", "Amlou", "pot", "Pot d'amlou (pâte d'amande, huile d'argan et miel), texture brune, avec pain trempé", "amlou argan")
n("pain", "Beurre de cacahuètes", "pot", "Pot de beurre de cacahuètes ouvert avec couteau et quelques cacahuètes", "beurre cacahuete")
n("pain", "Caramel à tartiner", "pot", "Pot de caramel à tartiner (spéculoos/caramel) ouvert avec un couteau", "speculoos")
n("pain", "Flocons d'avoine", "paquet", "Sachet ou bol de flocons d'avoine avec épis d'avoine", "avoine porridge")
n("pain", "Compote de fruits", "pot", "Pot ou gourde de compote de pommes avec cuillère et pomme à côté", "compote pomme")
# Épicerie
n("epicerie", "Fèves sèches", "paquet", "Bol de fèves sèches brun-beige décortiquées, plusieurs fèves visibles devant", "foul feves seches bissara", "à distinguer de « Fèves fraîches »")
n("epicerie", "Pois cassés", "paquet", "Bol de pois cassés jaune-verts secs avec quelques pois devant", "pois casses")
n("epicerie", "Noix de cajou", "paquet", "Bol de noix de cajou entières, courbes, couleur crème", "cajou")
n("epicerie", "Citrons confits", "pot", "Bocal de citrons confits au sel avec une moitié devant", "citron confit msyar")
n("epicerie", "Cornichons", "pot", "Bocal de cornichons verts avec quelques cornichons devant")
n("epicerie", "Sauce tomate", "boite", "Boîte ou bocal de sauce tomate avec filet de sauce sur cuillère, tomate à côté", "coulis tomate passata")
n("epicerie", "Pesto", "pot", "Pot de pesto vert ouvert avec cuillère et feuilles de basilic")
n("epicerie", "Bouillon", "boite", "Boîte de cubes de bouillon avec deux cubes emballés/déballés, sans marque", "bouillon cube")
n("epicerie", "Mélange d'épices", "pot", "Pot d'épices moulues brun-orangé avec cuillère et épices entières autour", "ras el hanout epices tajine")
n("epicerie", "Bicarbonate alimentaire", "paquet", "Boîte ou sachet de bicarbonate blanc, un petit tas de poudre avec cuillère", "bicarbonate soude")
n("epicerie", "Édulcorant", "boite", "Boîte distributrice de comprimés édulcorants avec quelques pastilles blanches", "edulcorant sucrette stevia")
n("epicerie", "Safran", "pot", "Petit pot de filaments de safran rouge-orangé avec quelques filaments sur une cuillère", "zaafrane")
n("epicerie", "Graines de sésame", "paquet", "Bol de graines de sésame blanches avec cuillère", "sesame")
n("epicerie", "Piment en poudre", "pot", "Pot et cuillère de piment rouge en poudre, piments séchés autour", "piment moulu")
n("epicerie", "Feuilles de brick", "paquet", "Paquet ouvert de feuilles de brick rondes très fines, une feuille dépliée en transparence", "brick warqa feuilles de pastilla")
n("epicerie", "Chapelure", "paquet", "Bol de chapelure dorée avec un sachet, sans marque")
n("epicerie", "Fécule de maïs", "paquet", "Boîte ou sachet de fécule de maïs avec bol de poudre blanche très fine", "maizena fecule")
n("epicerie", "Huile d'argan alimentaire", "bouteille", "Petite bouteille en verre foncé d'huile d'argan alimentaire avec noix d'argan", "argan", "optionnel")
# Boissons
n("boissons", "Thé glacé", "bouteille", "Bouteille de thé glacé avec verre, glaçons, citron et menthe, sans marque", "ice tea")
# Maison - entretien
for nm, d, a in [("Nettoyant multiusage", "Flacon spray nettoyant multisurface avec éponge et plan de travail propre", "multi surfaces"),
                 ("Désinfectant ménager", "Flacon de désinfectant ménager avec gants et lingette, étiquette neutre", "desinfectant surfaces"),
                 ("Désinfectant du linge", "Flacon de désinfectant pour le linge avec pile de linge blanc", "desinfectant lessive"),
                 ("Détachant du linge", "Flacon ou spray détachant avec un vêtement blanc taché puis propre", "detachant"),
                 ("Déboucheur", "Flacon de déboucheur d'évier avec évier propre ou ventouse", "deboucheur canalisation"),
                 ("Nettoyant vitres", "Spray nettoyant vitres bleu avec chiffon microfibre et vitre propre", "vitres"),
                 ("Savon noir ménager", "Pot ou bouteille de savon noir pâteux brun-noir avec éponge", "savon noir"),
                 ("Liquide de rinçage pour lave-vaisselle", "Flacon de liquide de rinçage pour lave-vaisselle bleu avec verres brillants", "rincage lave vaisselle"),
                 ("Insecticide", "Bombe aérosol insecticide générique, étiquette neutre sans logo ni insecte dessiné", "anti insectes moustiques"),
                 ("Aide au repassage", "Flacon spray d'aide au repassage avec fer à repasser et chemise", "repassage amidon")]:
    n("maison", nm, "bouteille", d, a)
n("maison", "Blocs WC", "paquet", "Bloc WC bleu accroché au bord d'une cuvette de toilettes", "bloc wc javel toilettes")
n("maison", "Sel régénérant pour lave-vaisselle", "paquet", "Sac ou boîte générique de gros sel blanc avec un petit tas de gros cristaux et un lave-vaisselle à côté, sans marque", "sel lave vaisselle", "à distinguer de « Sel alimentaire »")
n("maison", "Diffuseur antimoustiques", "piece", "Diffuseur électrique antimoustiques branché sur une prise, avec recharge liquide", "anti moustiques prise")
n("maison", "Papier cuisson", "piece", "Un rouleau de papier cuisson sulfurisé beige dans sa boîte et une feuille déroulée sur un moule", "papier sulfurise", "ne pas confondre avec les éponges")
n("maison", "Allumettes", "boite", "Boîte d'allumettes en bois entrouverte avec quelques allumettes, sans marque")
n("maison", "Briquet", "piece", "Un briquet de cuisine/ordinaire plastique coloré, sans marque", "briquet cuisine")
n("maison", "Allume-feu", "paquet", "Paquet de cubes allume-feu blancs avec un cube posé sur du charbon", "allume feu charbon")
# Hygiène
n("hygiene", "Savon solide", "piece", "Un pain de savon solide rectangulaire clair avec un peu de mousse sur un support", "savon pain savon de marseille")
n("hygiene", "Bain de bouche", "bouteille", "Bouteille de bain de bouche bleu clair avec petit gobelet doseur (pas de dentifrice)", "bain de bouche")

# ---- sorties
rows = []  # category, name, key, origin, status_cat, unit, photo_status, note
for c, k, nm, u in initial:
    new = RENAME.get(k)
    rows.append(dict(cat=c, name=new[0] if new else nm, key=k, origin="Initial (80)", exist="Existe déjà", unit=u or unit_for(c, nm, {}), photo="correcte", note=(new[1] + " — renommage proposé (« " + nm + " »)") if new else INITIAL_NOTE.get(k, "")))
EXT_NOTE = {"Lait d'amande": "à faire évoluer en « Boisson végétale » (même clé et mêmes données ; les articles déjà ajoutés gardent leur nom)",
            "Salade verte": "distincte de « Laitue » (pommée) : à valider, aucune suppression",
            "Baguette": "distincte de « Pain » (pain rond) et « Pain de mie »", "Gâteaux secs": "distinct de « Biscuits » (industriels)",
            "Maïs": "distinct de « Maïs en conserve »", "Piments": "frais ; distinct de « Piment en poudre »"}
for nm, (u, desc, alias) in E.items():
    c = None
for sql in [(ROOT / "server/migrations/004_extended_seed.sql").read_text(encoding="utf8")]:
    for m in re.finditer(r"\('(\w+)','([^']+)','([^']+)','seed-v1'\)", sql.replace("''", "’")):
        c, nm = m.group(1), m.group(2).replace("’", "'")
        u, desc, alias = E.get(nm, (None, "", ""))
        if nm not in E: print("MANQUE description:", nm, file=sys.stderr)
        rows.append(dict(cat=c, name=nm, key=slug(nm), origin="Complémentaire (étendu actuel)", exist="Existe déjà", unit=unit_for(c, nm, {nm: u} if u else {}), photo="manquante", note=EXT_NOTE.get(nm, ""), desc=desc, alias=alias))
for c, nm, u, desc, alias, note in N:
    rows.append(dict(cat=c, name=nm, key=slug(nm), origin="Ajout proposé", exist="Nouvel ajout", unit=u, photo="manquante", note=note, desc=desc, alias=alias))
keys = [r["key"] for r in rows if r["origin"] != "Initial (80)"]
assert len(keys) == len(set(keys)), [k for k in keys if keys.count(k) > 1]
ik = {r["key"] for r in rows if r["origin"] == "Initial (80)"}
assert not (set(keys) & ik), set(keys) & ik
names = [r["name"].lower() for r in rows]; assert len(names) == len(set(names)), [x for x in names if names.count(x) > 1]
rows.sort(key=lambda r: (ORDER.index(r["cat"]), 0 if r["origin"].startswith("Initial") else 1 if r["exist"] == "Existe déjà" else 2, r["name"].lower()))

fields = ["categorie", "nom_generique", "cle_stable", "origine", "existe_deja_ou_nouveau", "unite_proposee", "photo", "remarque"]
with open(OUT / "liste-finale.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f, delimiter=";"); w.writerow(fields)
    for r in rows: w.writerow([CATS[r["cat"]], r["name"], r["key"], r["origin"], r["exist"], r["unit"], r["photo"], r["note"]])
UL = {"piece": "pièce", "kg": "kg", "paquet": "paquet", "bouteille": "bouteille", "brique": "brique", "pot": "pot", "boite": "boîte"}
with open(OUT / "liste-finale.md", "w", encoding="utf8") as f:
    t = len(rows); ni = sum(r["origin"] == "Initial (80)" for r in rows); ne = sum(r["origin"].startswith("Compl") for r in rows); nn = sum(r["exist"] == "Nouvel ajout" for r in rows)
    f.write(f"# Liste finale proposée du catalogue — à valider avant import\n\n**{t} produits** : {ni} de départ (photos correctes), {ne} complémentaires déjà dans le code (photo manquante), **{nn} ajouts proposés** (photo manquante). Images à produire : **{ne + nn}**.\n\nLégende « existe » : *Existe déjà* = déjà dans l'application ; *Nouvel ajout* = sera créé à l'import après votre validation. Unité = unité de départ proposée (modifiable par article ensuite).\n")
    for c in ORDER:
        f.write(f"\n## {CATS[c]}\n\n| Nom générique | Origine | Existe | Unité | Photo | Remarque |\n|---|---|---|---|---|---|\n")
        for r in rows:
            if r["cat"] == c: f.write(f"| {r['name']} | {r['origin']} | {r['exist']} | {UL[r['unit']]} | {r['photo']} | {r['note']} |\n")
need = [r for r in rows if r["photo"] == "manquante"]
mf = ["id_stable", "nom_exact", "categorie", "origine", "fichier_attendu", "description_photo", "photo_actuelle", "articles_familiaux_lies"]
with open(OUT / "manifeste-images.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f, delimiter=";"); w.writerow(mf)
    for r in need: w.writerow([f"extended:{r['key']}", r["name"], CATS[r["cat"]], r["origin"], f"{r['key']}.webp", r["desc"], "manquante", "les articles de même nom suivront la photo du catalogue (photos personnelles conservées)"])
json.dump({"version": 1, "style": "fond blanc ou très clair, produit entier reconnaissable, sans marque ni texte publicitaire, 512x512 WebP, même style que les 80 photos existantes",
           "items": [{"target": "extended", "key": r["key"], "name": r["name"], "file": f"files/{r['key']}.webp", "category": r["cat"], "origin": r["origin"], "description": r["desc"]} for r in need]},
          open(OUT / "manifeste-images.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
print(t, ni, ne, nn, len(need))
