-- Unités du catalogue selon le tableau validé (consignes consolidées et arbitrages du 24/10/2026), format du produit,
-- références distinctes (lessive, savon noir, glace, thé, tisane) et nouvelles unités botte, rouleau, sachet, cube.
-- Tableau source : docs/evolutions/tableau-unites-prix.md.
--
-- Familles existantes : l'unité d'un produit rattaché au catalogue est corrigée SEULEMENT si elle vient du catalogue (unité actuelle
-- du catalogue, unité de départ de son rayon, ou valeur de départ de la migration 009). Une unité qu'une famille a choisie
-- elle-même (aucune de ces valeurs) est CONSERVÉE et inscrite au journal comme cas à examiner (outcome « unit_kept_custom »).
-- Prix (base commune et prix des familles) : conversion seulement quand la quantité de référence est connue (paquet de 500 g ->
-- prix pour 500 g ; 12 rouleaux -> prix pour 12 rouleaux ; flacon de 750 ml -> prix pour 750 ml), montant inchangé (jamais
-- arrondi). Sinon le prix est conservé tel quel, signalé « à confirmer » par l'application et jamais utilisé pour un montant.
-- Jamais modifiés : lignes de listes, achats, événements, favoris (quantité, unité et prix figés), prix proposés non vérifiés
-- (non importés). Chaque changement est inscrit dans unit_corrections pour un retour arrière exact.

-- ---- Nouvelles unités comptées : botte, rouleau, sachet, cube -------------------------------------------------------------
ALTER TABLE initial_catalog      DROP CONSTRAINT IF EXISTS initial_catalog_unit_check;
ALTER TABLE initial_catalog      ADD CONSTRAINT initial_catalog_unit_check      CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','botte','rouleau','sachet','cube','kg','litre'));
ALTER TABLE extended_catalog     DROP CONSTRAINT IF EXISTS extended_catalog_unit_check;
ALTER TABLE extended_catalog     ADD CONSTRAINT extended_catalog_unit_check     CHECK (unit IS NULL OR unit IN ('piece','paquet','bouteille','brique','pot','boite','botte','rouleau','sachet','cube','kg','litre'));
ALTER TABLE products             DROP CONSTRAINT IF EXISTS products_unit_check;
ALTER TABLE products             ADD CONSTRAINT products_unit_check             CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','botte','rouleau','sachet','cube','kg','litre'));
ALTER TABLE list_items           DROP CONSTRAINT IF EXISTS list_items_unit_check;
ALTER TABLE list_items           ADD CONSTRAINT list_items_unit_check           CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','botte','rouleau','sachet','cube','kg','litre'));
ALTER TABLE purchases            DROP CONSTRAINT IF EXISTS purchases_unit_check;
ALTER TABLE purchases            ADD CONSTRAINT purchases_unit_check            CHECK (unit IS NULL OR unit IN ('piece','paquet','bouteille','brique','pot','boite','botte','rouleau','sachet','cube','kg','litre'));
ALTER TABLE list_events          DROP CONSTRAINT IF EXISTS list_events_unit_check;
ALTER TABLE list_events          ADD CONSTRAINT list_events_unit_check          CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','botte','rouleau','sachet','cube','kg','litre'));
ALTER TABLE list_template_items  DROP CONSTRAINT IF EXISTS list_template_items_unit_check;
ALTER TABLE list_template_items  ADD CONSTRAINT list_template_items_unit_check  CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','botte','rouleau','sachet','cube','kg','litre'));
ALTER TABLE base_prices          DROP CONSTRAINT IF EXISTS base_prices_ref_unit_check;
ALTER TABLE base_prices          ADD CONSTRAINT base_prices_ref_unit_check      CHECK (ref_unit IN ('kg','g','litre','ml','piece','paquet','bouteille','brique','pot','boite','botte','rouleau','sachet','cube'));
ALTER TABLE family_prices        DROP CONSTRAINT IF EXISTS family_prices_ref_unit_check;
ALTER TABLE family_prices        ADD CONSTRAINT family_prices_ref_unit_check    CHECK (ref_unit IN ('kg','g','litre','ml','piece','paquet','bouteille','brique','pot','boite','botte','rouleau','sachet','cube'));
ALTER TABLE price_contributions  DROP CONSTRAINT IF EXISTS price_contributions_ref_unit_check;
ALTER TABLE price_contributions  ADD CONSTRAINT price_contributions_ref_unit_check CHECK (ref_unit IN ('kg','g','litre','ml','piece','paquet','bouteille','brique','pot','boite','botte','rouleau','sachet','cube'));

-- ---- Format du produit (facultatif, propre à chaque famille) : « pot de 350 g », « boîte de 16 portions » --------------------
-- Information affichée seulement : aucune conversion entre pièce et poids ou volume n'en est jamais tirée.
ALTER TABLE products ADD COLUMN format text CHECK (format IS NULL OR char_length(format) BETWEEN 1 AND 60);

-- ---- Journal (retour arrière exact) ----------------------------------------------------------------------------------------
CREATE TABLE unit_corrections (
  id          bigserial PRIMARY KEY,
  migration   text NOT NULL,
  family_id   uuid,                       -- NULL : catalogue commun ou base commune des prix
  subject     text NOT NULL CHECK (subject IN ('initial_catalog', 'extended_catalog', 'product', 'base_price', 'family_price')),
  ref         text NOT NULL,              -- clé du catalogue (« origine:clé » pour un prix commun), ou identifiant du produit
  old_unit    text,
  new_unit    text,
  old_value   jsonb,                      -- prix ou nom d'avant
  new_value   jsonb,
  outcome     text NOT NULL CHECK (outcome IN ('unit_changed', 'unit_kept_custom', 'price_converted', 'price_to_confirm', 'renamed', 'created')),
  applied_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX unit_corrections_family_idx ON unit_corrections (family_id) WHERE family_id IS NOT NULL;

-- ---- Références distinctes : même identifiant pour la forme que l'ancienne désignait sans ambiguïté -------------------------
-- « Lessive » (en bouteilles) = lessive liquide ; « Savon noir ménager » (en bouteilles) = savon noir liquide ; « Glaces »
-- (à la pièce) = glace individuelle. Leurs achats restent rattachés au même produit, dans leur unité d'origine.
-- « Thé » et « Tisane » (en boîtes) ne disent pas leur forme : conservés tels quels, à côté des nouvelles formes.
CREATE TEMP TABLE r027 (origin text, key text, old_name text, new_name text, search text) ON COMMIT DROP;
INSERT INTO r027 VALUES
  ('initial', 'lessive', 'Lessive', 'Lessive liquide', 'lessive liquide lessive'),
  ('extended', 'savon-noir-menager', 'Savon noir ménager', 'Savon noir liquide', 'savon noir liquide savon noir menager'),
  ('extended', 'glaces', 'Glaces', 'Glace individuelle', 'glace individuelle glaces esquimau cornet');
INSERT INTO unit_corrections (migration, subject, ref, old_value, new_value, outcome)
SELECT '027', CASE r.origin WHEN 'initial' THEN 'initial_catalog' ELSE 'extended_catalog' END, r.key,
       jsonb_build_object('name', r.old_name), jsonb_build_object('name', r.new_name), 'renamed'
  FROM r027 r
 WHERE (r.origin = 'initial' AND EXISTS (SELECT 1 FROM initial_catalog i WHERE i.key = r.key AND i.name = r.old_name))
    OR (r.origin = 'extended' AND EXISTS (SELECT 1 FROM extended_catalog e WHERE e.key = r.key AND e.name = r.old_name));
UPDATE initial_catalog i SET name = r.new_name, former_names = (SELECT array_agg(DISTINCT x) FROM unnest(i.former_names || ARRAY[lower(r.old_name)]) x)
  FROM r027 r WHERE r.origin = 'initial' AND i.key = r.key AND i.name = r.old_name;
UPDATE extended_catalog e SET name = r.new_name, search_text = r.search,
       former_names = (SELECT array_agg(DISTINCT x) FROM unnest(e.former_names || ARRAY[lower(r.old_name)]) x)
  FROM r027 r WHERE r.origin = 'extended' AND e.key = r.key AND e.name = r.old_name;
-- Articles des familles : le nom suit seulement s'il est resté celui du catalogue (un nom choisi par la famille est gardé).
INSERT INTO unit_corrections (migration, family_id, subject, ref, old_value, new_value, outcome)
SELECT '027', p.family_id, 'product', p.id::text, jsonb_build_object('name', p.name), jsonb_build_object('name', r.new_name), 'renamed'
  FROM products p JOIN r027 r ON p.name = r.old_name AND p.brand IS NULL
   AND ((r.origin = 'initial' AND p.catalog_key = r.key) OR (r.origin = 'extended' AND p.extended_id = (SELECT id FROM extended_catalog WHERE key = r.key)))
 WHERE NOT EXISTS (SELECT 1 FROM products q WHERE q.family_id = p.family_id AND lower(q.name) = lower(r.new_name));
UPDATE products p SET name = r.new_name
  FROM r027 r WHERE p.name = r.old_name AND p.brand IS NULL
   AND ((r.origin = 'initial' AND p.catalog_key = r.key) OR (r.origin = 'extended' AND p.extended_id = (SELECT id FROM extended_catalog WHERE key = r.key)))
   AND NOT EXISTS (SELECT 1 FROM products q WHERE q.family_id = p.family_id AND lower(q.name) = lower(r.new_name));

-- Nouvelles références du catalogue étendu (ajoutées par chaque famille quand elle le souhaite, comme les autres).
INSERT INTO extended_catalog (category, name, search_text, source, key, unit) VALUES
  ('maison',   'Lessive en poudre',   'lessive en poudre lessive poudre',            'seed-v4', 'lessive-en-poudre',   'kg'),
  ('maison',   'Capsules de lessive', 'capsules de lessive lessive capsules pods',   'seed-v4', 'capsules-de-lessive', 'piece'),
  ('maison',   'Savon noir en pâte',  'savon noir en pate savon noir beldi',         'seed-v4', 'savon-noir-en-pate',  'kg'),
  ('surgeles', 'Glace en bac',        'glace en bac glace bac creme glacee',         'seed-v4', 'glace-en-bac',        'litre'),
  ('pain',     'Thé en vrac',         'the en vrac the vert the noir',               'seed-v4', 'the-en-vrac',         'kg'),
  ('pain',     'Thé en sachets',      'the en sachets the sachets',                  'seed-v4', 'the-en-sachets',      'sachet'),
  ('boissons', 'Tisane en vrac',      'tisane en vrac infusion verveine',            'seed-v4', 'tisane-en-vrac',      'kg'),
  ('boissons', 'Tisane en sachets',   'tisane en sachets infusion sachets',          'seed-v4', 'tisane-en-sachets',   'sachet')
ON CONFLICT (key) DO NOTHING;
INSERT INTO unit_corrections (migration, subject, ref, new_unit, outcome)
SELECT '027', 'extended_catalog', key, unit, 'created' FROM extended_catalog WHERE source = 'seed-v4';

-- ---- Unités retenues (tableau validé : 244 références ; Thé et Tisane inchangés) ----------------------------------------------
CREATE TEMP TABLE t027 (origin text NOT NULL, key text NOT NULL, unit text NOT NULL) ON COMMIT DROP;
INSERT INTO t027 (origin, key, unit) VALUES
  ('initial', 'ail', 'kg'),
  ('extended', 'aneth', 'botte'),
  ('initial', 'aubergines', 'kg'),
  ('extended', 'basilic', 'botte'),
  ('extended', 'betteraves', 'kg'),
  ('extended', 'brocolis', 'kg'),
  ('initial', 'carottes', 'kg'),
  ('extended', 'celeri', 'botte'),
  ('extended', 'champignons', 'kg'),
  ('extended', 'chou', 'kg'),
  ('extended', 'choux-fleurs', 'kg'),
  ('extended', 'ciboulette', 'botte'),
  ('initial', 'concombres', 'kg'),
  ('initial', 'coriandre', 'botte'),
  ('initial', 'courgettes', 'kg'),
  ('extended', 'epinards', 'kg'),
  ('extended', 'fenouil', 'kg'),
  ('extended', 'feves-fraiches', 'kg'),
  ('extended', 'gingembre', 'kg'),
  ('initial', 'haricots-verts', 'kg'),
  ('initial', 'laitue', 'piece'),
  ('extended', 'mais-frais', 'piece'),
  ('initial', 'menthe', 'botte'),
  ('extended', 'navets', 'kg'),
  ('initial', 'oignons', 'kg'),
  ('initial', 'persil', 'botte'),
  ('extended', 'petits-pois', 'kg'),
  ('extended', 'piments-frais', 'kg'),
  ('extended', 'poireaux', 'kg'),
  ('initial', 'poivrons-rouges', 'kg'),
  ('initial', 'poivrons-verts', 'kg'),
  ('initial', 'pommes-de-terre', 'kg'),
  ('extended', 'potiron', 'kg'),
  ('extended', 'radis', 'kg'),
  ('extended', 'romarin', 'botte'),
  ('extended', 'roquette', 'kg'),
  ('extended', 'sauge', 'botte'),
  ('extended', 'thym', 'botte'),
  ('initial', 'tomates', 'kg'),
  ('extended', 'abricots', 'kg'),
  ('extended', 'ananas', 'piece'),
  ('initial', 'avocats', 'kg'),
  ('initial', 'bananes', 'kg'),
  ('extended', 'cerises', 'kg'),
  ('extended', 'chataignes', 'kg'),
  ('initial', 'citrons', 'kg'),
  ('initial', 'clementines', 'kg'),
  ('extended', 'coings', 'kg'),
  ('extended', 'dattes', 'kg'),
  ('extended', 'figues', 'kg'),
  ('initial', 'fraises', 'kg'),
  ('extended', 'framboises', 'kg'),
  ('extended', 'fruit-de-la-passion', 'kg'),
  ('initial', 'fruits-de-saison', 'kg'),
  ('extended', 'grenades', 'kg'),
  ('extended', 'kiwis', 'kg'),
  ('extended', 'mangues', 'kg'),
  ('extended', 'melon', 'kg'),
  ('extended', 'mures', 'kg'),
  ('extended', 'noix-de-coco', 'piece'),
  ('initial', 'oranges', 'kg'),
  ('extended', 'pamplemousse', 'kg'),
  ('extended', 'papaye', 'piece'),
  ('extended', 'pasteque', 'kg'),
  ('extended', 'peches', 'kg'),
  ('initial', 'poires', 'kg'),
  ('initial', 'pommes', 'kg'),
  ('extended', 'prunes', 'kg'),
  ('initial', 'raisins', 'kg'),
  ('extended', 'raisins-secs', 'kg'),
  ('initial', 'beurre', 'kg'),
  ('extended', 'creme-chantilly', 'piece'),
  ('extended', 'creme-de-cuisson', 'piece'),
  ('extended', 'creme-dessert', 'piece'),
  ('initial', 'creme-fraiche', 'piece'),
  ('initial', 'fromage-a-tartiner', 'kg'),
  ('extended', 'fromage-blanc', 'kg'),
  ('initial', 'fromage-en-portions', 'boite'),
  ('extended', 'fromage-en-tranches', 'kg'),
  ('extended', 'fromage-frais', 'kg'),
  ('initial', 'fromage-rape', 'kg'),
  ('initial', 'lait', 'litre'),
  ('extended', 'lait-concentre', 'kg'),
  ('extended', 'lait-en-poudre', 'kg'),
  ('extended', 'lben', 'litre'),
  ('extended', 'margarine', 'kg'),
  ('extended', 'mozzarella', 'kg'),
  ('initial', 'oeufs', 'piece'),
  ('extended', 'smen', 'kg'),
  ('initial', 'yaourt-a-boire', 'piece'),
  ('initial', 'yaourt-aromatise', 'pot'),
  ('initial', 'yaourt-nature', 'pot'),
  ('extended', 'amandes', 'kg'),
  ('extended', 'bicarbonate-alimentaire', 'kg'),
  ('extended', 'biscuits', 'kg'),
  ('extended', 'bouillon', 'cube'),
  ('extended', 'cacao-en-poudre', 'kg'),
  ('extended', 'cannelle', 'kg'),
  ('extended', 'cereales', 'kg'),
  ('extended', 'chapelure', 'kg'),
  ('extended', 'citrons-confits', 'kg'),
  ('initial', 'concentre-de-tomates', 'kg'),
  ('extended', 'cornichons', 'kg'),
  ('initial', 'cumin', 'kg'),
  ('extended', 'curcuma', 'kg'),
  ('extended', 'edulcorant', 'boite'),
  ('initial', 'farine', 'kg'),
  ('extended', 'farine-complete', 'kg'),
  ('extended', 'farine-fino', 'kg'),
  ('extended', 'farine-force', 'kg'),
  ('extended', 'fecule-de-mais', 'kg'),
  ('extended', 'feuilles-de-brick', 'paquet'),
  ('extended', 'feves-seches', 'kg'),
  ('extended', 'graines-de-sesame', 'kg'),
  ('extended', 'haricots-blancs', 'kg'),
  ('extended', 'harissa', 'kg'),
  ('extended', 'huile-d-argan-alimentaire', 'litre'),
  ('initial', 'huile-de-table', 'litre'),
  ('initial', 'huile-d-olive', 'litre'),
  ('extended', 'ketchup', 'kg'),
  ('initial', 'lentilles', 'kg'),
  ('initial', 'levure-chimique', 'kg'),
  ('extended', 'levure-de-boulanger', 'kg'),
  ('extended', 'mais-en-conserve', 'kg'),
  ('extended', 'mayonnaise', 'kg'),
  ('extended', 'melange-d-epices', 'kg'),
  ('extended', 'moutarde', 'kg'),
  ('extended', 'noix', 'kg'),
  ('extended', 'noix-de-cajou', 'kg'),
  ('extended', 'olives', 'kg'),
  ('extended', 'paprika', 'kg'),
  ('extended', 'pate-a-tartiner', 'kg'),
  ('extended', 'pate-a-tartiner-nutella', 'piece'),
  ('initial', 'pates', 'kg'),
  ('extended', 'pesto', 'kg'),
  ('extended', 'piment-en-poudre', 'kg'),
  ('extended', 'pois-casses', 'kg'),
  ('initial', 'pois-chiches', 'kg'),
  ('initial', 'poivre', 'kg'),
  ('initial', 'riz', 'kg'),
  ('extended', 'safran', 'kg'),
  ('extended', 'sauce-tomate', 'kg'),
  ('initial', 'sel', 'kg'),
  ('extended', 'couscous', 'kg'),
  ('initial', 'semoule-fine', 'kg'),
  ('initial', 'sucre', 'kg'),
  ('extended', 'sucre-glace', 'kg'),
  ('extended', 'sucre-vanille', 'kg'),
  ('initial', 'vermicelles', 'kg'),
  ('extended', 'vinaigre', 'litre'),
  ('extended', 'agneau', 'kg'),
  ('extended', 'crevettes', 'kg'),
  ('extended', 'dinde', 'kg'),
  ('extended', 'jambon-de-dinde', 'kg'),
  ('extended', 'merguez', 'kg'),
  ('initial', 'poisson', 'kg'),
  ('initial', 'poulet', 'piece'),
  ('extended', 'sardines-en-conserve', 'boite'),
  ('extended', 'saucisses', 'kg'),
  ('initial', 'thon-en-conserve', 'boite'),
  ('initial', 'viande-de-boeuf', 'kg'),
  ('initial', 'viande-hachee', 'kg'),
  ('initial', 'frites-surgelees', 'kg'),
  ('extended', 'glaces', 'piece'),
  ('extended', 'legumes-surgeles', 'kg'),
  ('extended', 'pate-feuilletee', 'kg'),
  ('initial', 'petits-pois-surgeles', 'kg'),
  ('extended', 'poisson-pane', 'kg'),
  ('extended', 'amlou', 'kg'),
  ('extended', 'baguette', 'piece'),
  ('extended', 'beurre-de-cacahuetes', 'kg'),
  ('extended', 'biscottes', 'kg'),
  ('extended', 'brioche', 'piece'),
  ('initial', 'cafe', 'kg'),
  ('extended', 'caramel-a-tartiner', 'kg'),
  ('extended', 'compote-de-fruits', 'kg'),
  ('initial', 'confiture', 'kg'),
  ('extended', 'crepes', 'piece'),
  ('extended', 'flocons-d-avoine', 'kg'),
  ('extended', 'gateaux-secs-marocains', 'kg'),
  ('initial', 'miel', 'kg'),
  ('initial', 'pain', 'piece'),
  ('extended', 'pain-complet', 'piece'),
  ('initial', 'pain-de-mie', 'kg'),
  ('extended', 'boisson-gazeuse', 'litre'),
  ('extended', 'boisson-vegetale', 'litre'),
  ('extended', 'cafe-en-capsules', 'piece'),
  ('extended', 'eau-gazeuse', 'litre'),
  ('initial', 'eau-minerale', 'litre'),
  ('initial', 'jus-de-fruits', 'litre'),
  ('extended', 'sirop', 'litre'),
  ('extended', 'the-glace', 'litre'),
  ('extended', 'aide-au-repassage', 'litre'),
  ('extended', 'allume-feu', 'piece'),
  ('extended', 'allumettes', 'boite'),
  ('extended', 'ampoules', 'piece'),
  ('initial', 'assouplissant', 'litre'),
  ('extended', 'blocs-wc', 'piece'),
  ('extended', 'briquet', 'piece'),
  ('extended', 'deboucheur', 'litre'),
  ('extended', 'degraissant', 'litre'),
  ('extended', 'desinfectant-du-linge', 'litre'),
  ('extended', 'desinfectant-menager', 'litre'),
  ('extended', 'desodorisant', 'piece'),
  ('extended', 'detachant-du-linge', 'litre'),
  ('extended', 'detartrant', 'litre'),
  ('extended', 'diffuseur-antimoustiques', 'piece'),
  ('initial', 'eau-de-javel', 'litre'),
  ('initial', 'eponges', 'piece'),
  ('initial', 'essuie-tout', 'rouleau'),
  ('extended', 'film-alimentaire', 'rouleau'),
  ('extended', 'insecticide', 'piece'),
  ('initial', 'lessive', 'litre'),
  ('extended', 'liquide-de-rincage-pour-lave-vaisselle', 'litre'),
  ('initial', 'liquide-vaisselle', 'litre'),
  ('extended', 'nettoyant-multiusage', 'litre'),
  ('initial', 'nettoyant-sol', 'litre'),
  ('extended', 'nettoyant-vitres', 'litre'),
  ('extended', 'papier-aluminium', 'rouleau'),
  ('extended', 'papier-cuisson', 'rouleau'),
  ('initial', 'papier-toilette', 'rouleau'),
  ('extended', 'pastilles-lave-vaisselle', 'piece'),
  ('extended', 'piles', 'piece'),
  ('extended', 'sacs-congelation', 'paquet'),
  ('initial', 'sacs-poubelle', 'paquet'),
  ('extended', 'savon-noir-menager', 'litre'),
  ('extended', 'sel-regenerant-pour-lave-vaisselle', 'kg'),
  ('extended', 'apres-shampooing', 'litre'),
  ('extended', 'bain-de-bouche', 'litre'),
  ('extended', 'brosse-a-dents', 'piece'),
  ('extended', 'coton', 'paquet'),
  ('extended', 'couches', 'paquet'),
  ('extended', 'creme-hydratante', 'piece'),
  ('initial', 'dentifrice', 'piece'),
  ('extended', 'deodorant', 'piece'),
  ('initial', 'gel-douche', 'litre'),
  ('initial', 'lingettes', 'paquet'),
  ('initial', 'mouchoirs-en-papier', 'paquet'),
  ('extended', 'protections-hygieniques', 'paquet'),
  ('extended', 'rasoirs', 'piece'),
  ('initial', 'savon-liquide', 'litre'),
  ('extended', 'savon-solide', 'kg'),
  ('extended', 'serum-physiologique', 'boite'),
  ('initial', 'shampooing', 'litre');

-- Prix utilisable tel quel pour l'unité cible ? (même règle que pricing.ts ; poids <-> pièce seulement avec le poids d'une pièce)
CREATE FUNCTION pg_temp.fits027(target text, ref_unit text, w numeric) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN target = 'kg' THEN ref_unit IN ('kg', 'g') OR (ref_unit = 'piece' AND w IS NOT NULL)
    WHEN target = 'litre' THEN ref_unit IN ('litre', 'ml')
    WHEN target = 'piece' THEN ref_unit = 'piece' OR (ref_unit IN ('kg', 'g') AND w IS NOT NULL)
    ELSE ref_unit = target END
$$;
-- Conversion EXACTE d'un prix « par contenant » vers l'unité cible, d'après le contenu écrit du contenant :
--   poids  : « 500 g », « 1 kg », « flacon de 310 g »        -> prix pour 500 g, 1 kg, 310 g ;
--   volume : « 1 litre », « flacon de 750 ml », « 1,5 litre » -> prix pour 1 L, 750 mL, 1,5 L ;
--   compte : « 12 rouleaux », « 8 cubes », « 5 », « 3 blocs de 38 g » -> prix pour 12 rouleaux, 8 cubes, 5 ou 3 pièces.
-- NULL si le contenu n'est pas connu (le prix est alors conservé tel quel).
CREATE FUNCTION pg_temp.conv027(target text, ref_qty numeric, ref_unit text, packaging text, OUT qty numeric, OUT unit text) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m text[]; v numeric;
BEGIN
  qty := NULL; unit := NULL;
  IF packaging IS NULL OR ref_unit NOT IN ('piece','paquet','bouteille','brique','pot','boite') THEN RETURN; END IF;
  IF target IN ('kg', 'litre') THEN
    m := regexp_match(packaging, '^\s*(?:[[:alpha:]]+ de\s+)?(\d+(?:[.,]\d{1,3})?)\s*(g|kg|ml|l|litres?)\s*$', 'i');
    IF m IS NULL THEN RETURN; END IF;
    v := ref_qty * replace(m[1], ',', '.')::numeric;
    IF target = 'kg' AND lower(m[2]) IN ('g', 'kg') THEN
      IF lower(m[2]) = 'kg' THEN v := v * 1000; END IF;               -- en grammes
      IF v <> round(v) THEN RETURN; END IF;
      IF v % 1000 = 0 THEN qty := round(v / 1000, 3); unit := 'kg'; ELSE qty := round(v, 3); unit := 'g'; END IF;
    ELSIF target = 'litre' AND lower(m[2]) NOT IN ('g', 'kg') THEN
      IF lower(m[2]) <> 'ml' THEN v := v * 1000; END IF;              -- en millilitres
      IF v <> round(v) THEN RETURN; END IF;
      IF v % 1000 = 0 THEN qty := round(v / 1000, 3); unit := 'litre'; ELSE qty := round(v, 3); unit := 'ml'; END IF;
    END IF;
  ELSIF target IN ('rouleau', 'cube') THEN
    m := regexp_match(packaging, '^\s*(\d+)\s*(rouleaux?|cubes?)\s*$', 'i');
    IF m IS NOT NULL AND left(lower(m[2]), length(target)) = target THEN qty := ref_qty * m[1]::numeric; unit := target; END IF;
    -- « rouleau de 20 mètres » : le contenant EST un rouleau (sa longueur reste écrite dans le conditionnement)
    IF target = 'rouleau' AND qty IS NULL AND packaging ~* '^\s*rouleau\M' THEN qty := ref_qty; unit := 'rouleau'; END IF;
  ELSIF target = 'piece' THEN
    m := coalesce(regexp_match(packaging, '^\s*(\d+)\s*$'), regexp_match(packaging, '^\s*(\d+)\s+blocs?\s', 'i'));
    IF m IS NOT NULL THEN qty := ref_qty * m[1]::numeric; unit := 'piece'; END IF;
  END IF;
END $$;

-- ---- Catalogue commun -------------------------------------------------------------------------------------------------------
-- Unités du catalogue AVANT ce changement (servent à reconnaître les unités des familles qui viennent du catalogue).
CREATE TEMP TABLE c027 ON COMMIT DROP AS
  SELECT 'initial'::text AS origin, i.key, i.category, i.unit AS old_unit FROM initial_catalog i
  UNION ALL SELECT 'extended', e.key, e.category, e.unit FROM extended_catalog e WHERE e.key IS NOT NULL;

INSERT INTO unit_corrections (migration, subject, ref, old_unit, new_unit, outcome)
SELECT '027', 'initial_catalog', i.key, i.unit, t.unit, 'unit_changed' FROM initial_catalog i JOIN t027 t ON t.origin = 'initial' AND t.key = i.key WHERE i.unit <> t.unit;
UPDATE initial_catalog i SET unit = t.unit FROM t027 t WHERE t.origin = 'initial' AND t.key = i.key AND i.unit <> t.unit;
INSERT INTO unit_corrections (migration, subject, ref, old_unit, new_unit, outcome)
SELECT '027', 'extended_catalog', e.key, e.unit, t.unit, 'unit_changed' FROM extended_catalog e JOIN t027 t ON t.origin = 'extended' AND t.key = e.key WHERE e.unit IS DISTINCT FROM t.unit;
UPDATE extended_catalog e SET unit = t.unit FROM t027 t WHERE t.origin = 'extended' AND t.key = e.key AND e.unit IS DISTINCT FROM t.unit;

-- ---- Produits des familles rattachés au catalogue ---------------------------------------------------------------------------
CREATE TEMP TABLE p027 ON COMMIT DROP AS
  SELECT p.id, p.family_id, p.unit AS old_unit, t.unit AS new_unit,
         -- Unités « du catalogue » : actuelle, départ du rayon (règle des migrations 009 et des ajouts), cas particuliers de 009.
         p.unit = c.old_unit
           OR p.unit = CASE WHEN c.category IN ('legumes','fruits','viandes') THEN 'kg' WHEN c.category = 'boissons' THEN 'bouteille'
                            WHEN c.category IN ('epicerie','surgeles') THEN 'paquet' ELSE 'piece' END
           OR (c.key IN ('persil','coriandre','menthe') AND p.unit = 'paquet') OR (c.key = 'ail' AND p.unit = 'piece') AS from_catalogue
    FROM products p
    JOIN c027 c ON (c.origin = 'initial' AND c.key = p.catalog_key)
               OR (c.origin = 'extended' AND c.key = (SELECT e.key FROM extended_catalog e WHERE e.id = p.extended_id))
    JOIN t027 t ON t.origin = c.origin AND t.key = c.key
   WHERE p.unit <> t.unit;

INSERT INTO unit_corrections (migration, family_id, subject, ref, old_unit, new_unit, outcome)
SELECT '027', family_id, 'product', id::text, old_unit, new_unit, CASE WHEN from_catalogue THEN 'unit_changed' ELSE 'unit_kept_custom' END FROM p027;
UPDATE products p SET unit = x.new_unit FROM p027 x WHERE x.id = p.id AND x.from_catalogue;

-- ---- Prix des familles de ces produits --------------------------------------------------------------------------------------
CREATE TEMP TABLE fp027 ON COMMIT DROP AS
  SELECT f.family_id, f.product_id, x.old_unit, x.new_unit, f.amount, f.ref_qty, f.ref_unit, f.packaging, f.piece_weight_g,
         (pg_temp.conv027(x.new_unit, f.ref_qty, f.ref_unit, f.packaging)).*
    FROM family_prices f JOIN p027 x ON x.id = f.product_id AND x.from_catalogue
   WHERE NOT pg_temp.fits027(x.new_unit, f.ref_unit, f.piece_weight_g);
INSERT INTO unit_corrections (migration, family_id, subject, ref, old_unit, new_unit, old_value, new_value, outcome)
SELECT '027', family_id, 'family_price', product_id::text, old_unit, new_unit,
       jsonb_build_object('amount', amount, 'refQty', ref_qty, 'refUnit', ref_unit, 'packaging', packaging, 'pieceWeightG', piece_weight_g),
       CASE WHEN unit IS NOT NULL THEN jsonb_build_object('amount', amount, 'refQty', qty, 'refUnit', unit, 'packaging', CASE WHEN packaging ~* '^\s*rouleau\M' THEN packaging END, 'pieceWeightG', NULL) END,
       CASE WHEN unit IS NOT NULL THEN 'price_converted' ELSE 'price_to_confirm' END
  FROM fp027;
UPDATE family_prices f SET ref_qty = x.qty, ref_unit = x.unit, packaging = CASE WHEN x.packaging ~* '^\s*rouleau\M' THEN x.packaging END, piece_weight_g = NULL
  FROM fp027 x WHERE x.family_id = f.family_id AND x.product_id = f.product_id AND x.unit IS NOT NULL;

-- ---- Base commune des prix (montants et dates conservés ; prix proposés non vérifiés : non importés) ---------------------------
CREATE TEMP TABLE bp027 ON COMMIT DROP AS
  SELECT b.origin, b.key, t.unit AS new_unit, b.amount, b.ref_qty, b.ref_unit, b.packaging, b.piece_weight_g,
         (pg_temp.conv027(t.unit, b.ref_qty, b.ref_unit, b.packaging)).*
    FROM base_prices b JOIN t027 t ON t.origin = b.origin AND t.key = b.key
   WHERE NOT pg_temp.fits027(t.unit, b.ref_unit, b.piece_weight_g);
INSERT INTO unit_corrections (migration, subject, ref, old_unit, new_unit, old_value, new_value, outcome)
SELECT '027', 'base_price', origin || ':' || key, ref_unit, new_unit,
       jsonb_build_object('amount', amount, 'refQty', ref_qty, 'refUnit', ref_unit, 'packaging', packaging, 'pieceWeightG', piece_weight_g),
       CASE WHEN unit IS NOT NULL THEN jsonb_build_object('amount', amount, 'refQty', qty, 'refUnit', unit, 'packaging', CASE WHEN packaging ~* '^\s*rouleau\M' THEN packaging END, 'pieceWeightG', NULL) END,
       CASE WHEN unit IS NOT NULL THEN 'price_converted' ELSE 'price_to_confirm' END
  FROM bp027;
UPDATE base_prices b SET ref_qty = x.qty, ref_unit = x.unit, packaging = CASE WHEN x.packaging ~* '^\s*rouleau\M' THEN x.packaging END, piece_weight_g = NULL
  FROM bp027 x WHERE x.origin = b.origin AND x.key = b.key AND x.unit IS NOT NULL;

-- Tous les téléphones relisent le catalogue (unités, noms, prix).
UPDATE families SET catalog_rev = catalog_rev + 1;

DROP FUNCTION pg_temp.conv027(text, numeric, text, text);
DROP FUNCTION pg_temp.fits027(text, text, numeric);
