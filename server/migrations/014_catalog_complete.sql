-- Catalogue complet : unités par produit, alias de recherche, fusion Salade verte → Laitue, renommages validés,
-- nouveaux articles du catalogue complémentaire. GÉNÉRÉ par scripts/catalogue-docs.py — ne pas éditer à la main.
-- Aucune unité de famille existante n'est modifiée ; aucun article n'est activé dans une famille ; aucune ligne n'est supprimée.
ALTER TABLE initial_catalog ADD COLUMN aliases text NOT NULL DEFAULT '';
ALTER TABLE initial_catalog ADD COLUMN former_names text[] NOT NULL DEFAULT '{}';
ALTER TABLE extended_catalog ADD COLUMN unit text CHECK (unit IS NULL OR unit IN ('piece','paquet','bouteille','brique','pot','boite','kg'));
ALTER TABLE extended_catalog ADD COLUMN former_names text[] NOT NULL DEFAULT '{}';
ALTER TABLE extended_catalog ADD COLUMN merged_into text REFERENCES initial_catalog(key);

UPDATE initial_catalog SET unit = 'piece' WHERE key = 'laitue';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET aliases = 'salade salade verte' WHERE key = 'laitue';
UPDATE initial_catalog SET unit = 'pot' WHERE key = 'creme-fraiche';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'boite' WHERE key = 'fromage-en-portions';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'paquet' WHERE key = 'fromage-rape';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'pot' WHERE key = 'fromage-a-tartiner';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'pot' WHERE key = 'yaourt-aromatise';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'pot' WHERE key = 'yaourt-nature';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'bouteille' WHERE key = 'yaourt-a-boire';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'boite' WHERE key = 'concentre-de-tomates';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'bouteille' WHERE key = 'huile-de-table';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET aliases = 'huile vegetale' WHERE key = 'huile-de-table';
UPDATE initial_catalog SET unit = 'bouteille' WHERE key = 'huile-d-olive';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET aliases = 'sel de table' WHERE key = 'sel';
UPDATE initial_catalog SET unit = 'boite' WHERE key = 'thon-en-conserve';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'paquet' WHERE key = 'cafe';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'pot' WHERE key = 'confiture';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'pot' WHERE key = 'miel';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'paquet' WHERE key = 'pain-de-mie';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'boite' WHERE key = 'the';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'bouteille' WHERE key = 'assouplissant';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'bouteille' WHERE key = 'eau-de-javel';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'paquet' WHERE key = 'essuie-tout';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'bouteille' WHERE key = 'lessive';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'bouteille' WHERE key = 'liquide-vaisselle';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'bouteille' WHERE key = 'nettoyant-sol';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'paquet' WHERE key = 'papier-toilette';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'paquet' WHERE key = 'sacs-poubelle';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'paquet' WHERE key = 'eponges';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'bouteille' WHERE key = 'gel-douche';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'paquet' WHERE key = 'lingettes';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'paquet' WHERE key = 'mouchoirs-en-papier';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'bouteille' WHERE key = 'savon-liquide';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET unit = 'bouteille' WHERE key = 'shampooing';  -- catalogue de départ : nouvelles familles seulement
UPDATE initial_catalog SET former_names = '{"salade verte"}' WHERE key = 'laitue';
UPDATE initial_catalog SET former_names = '{"sel"}' WHERE key = 'sel';

-- « Sel » devient « Sel alimentaire » (même identifiant) ; les articles familiaux restés « Sel » suivent, sauf conflit de nom.
UPDATE initial_catalog SET name = 'Sel alimentaire' WHERE key = 'sel';
UPDATE products p SET name = 'Sel alimentaire' WHERE p.catalog_key = 'sel' AND p.name = 'Sel'
   AND NOT EXISTS (SELECT 1 FROM products x WHERE x.family_id = p.family_id AND lower(x.name) = 'sel alimentaire' AND x.brand IS NOT DISTINCT FROM p.brand);

UPDATE extended_catalog SET name = 'Boisson végétale', key = 'boisson-vegetale', former_names = '{"lait d''amande"}' WHERE key = 'lait-d-amande';
UPDATE extended_catalog SET name = 'Gâteaux secs marocains', key = 'gateaux-secs-marocains', former_names = '{"gâteaux secs"}' WHERE key = 'gateaux-secs';
UPDATE extended_catalog SET name = 'Maïs frais', key = 'mais-frais', former_names = '{"maïs"}' WHERE key = 'mais';
UPDATE extended_catalog SET name = 'Piments frais', key = 'piments-frais', former_names = '{"piments"}' WHERE key = 'piments';
UPDATE extended_catalog SET merged_into = 'laitue' WHERE key = 'salade-verte';  -- Salade verte : absorbé par la Laitue, jamais supprimé

UPDATE extended_catalog SET unit = 'piece', search_text = 'aneth' WHERE key = 'aneth';
UPDATE extended_catalog SET unit = 'kg', search_text = 'betteraves' WHERE key = 'betteraves';
UPDATE extended_catalog SET unit = 'piece', search_text = 'brocolis brocoli' WHERE key = 'brocolis';
UPDATE extended_catalog SET unit = 'kg', search_text = 'champignons' WHERE key = 'champignons';
UPDATE extended_catalog SET unit = 'piece', search_text = 'chou vert' WHERE key = 'chou';
UPDATE extended_catalog SET unit = 'piece', search_text = 'choux-fleurs chou fleur' WHERE key = 'choux-fleurs';
UPDATE extended_catalog SET unit = 'piece', search_text = 'celeri branche' WHERE key = 'celeri';
UPDATE extended_catalog SET unit = 'piece', search_text = 'fenouil' WHERE key = 'fenouil';
UPDATE extended_catalog SET unit = 'kg', search_text = 'gingembre' WHERE key = 'gingembre';
UPDATE extended_catalog SET unit = 'piece', search_text = 'mais frais mais epi' WHERE key = 'mais-frais';
UPDATE extended_catalog SET unit = 'kg', search_text = 'navets' WHERE key = 'navets';
UPDATE extended_catalog SET unit = 'kg', search_text = 'petits pois' WHERE key = 'petits-pois';
UPDATE extended_catalog SET unit = 'kg', search_text = 'piments frais' WHERE key = 'piments-frais';
UPDATE extended_catalog SET unit = 'kg', search_text = 'poireaux' WHERE key = 'poireaux';
UPDATE extended_catalog SET unit = 'kg', search_text = 'potiron courge citrouille' WHERE key = 'potiron';
UPDATE extended_catalog SET unit = 'kg', search_text = 'radis' WHERE key = 'radis';
UPDATE extended_catalog SET unit = 'kg', search_text = 'epinards' WHERE key = 'epinards';
UPDATE extended_catalog SET unit = 'kg', search_text = 'abricots' WHERE key = 'abricots';
UPDATE extended_catalog SET unit = 'piece', search_text = 'ananas' WHERE key = 'ananas';
UPDATE extended_catalog SET unit = 'kg', search_text = 'cerises' WHERE key = 'cerises';
UPDATE extended_catalog SET unit = 'kg', search_text = 'dattes' WHERE key = 'dattes';
UPDATE extended_catalog SET unit = 'kg', search_text = 'figues' WHERE key = 'figues';
UPDATE extended_catalog SET unit = 'kg', search_text = 'grenades' WHERE key = 'grenades';
UPDATE extended_catalog SET unit = 'kg', search_text = 'kiwis' WHERE key = 'kiwis';
UPDATE extended_catalog SET unit = 'kg', search_text = 'mangues' WHERE key = 'mangues';
UPDATE extended_catalog SET unit = 'kg', search_text = 'melon' WHERE key = 'melon';
UPDATE extended_catalog SET unit = 'kg', search_text = 'pasteque' WHERE key = 'pasteque';
UPDATE extended_catalog SET unit = 'kg', search_text = 'prunes' WHERE key = 'prunes';
UPDATE extended_catalog SET unit = 'kg', search_text = 'peches' WHERE key = 'peches';
UPDATE extended_catalog SET unit = 'pot', search_text = 'creme dessert flan danette' WHERE key = 'creme-dessert';
UPDATE extended_catalog SET unit = 'pot', search_text = 'fromage blanc' WHERE key = 'fromage-blanc';
UPDATE extended_catalog SET unit = 'pot', search_text = 'fromage frais' WHERE key = 'fromage-frais';
UPDATE extended_catalog SET unit = 'boite', search_text = 'lait concentre sucre' WHERE key = 'lait-concentre';
UPDATE extended_catalog SET unit = 'boite', search_text = 'lait en poudre' WHERE key = 'lait-en-poudre';
UPDATE extended_catalog SET unit = 'bouteille', search_text = 'lben petit lait lait fermente' WHERE key = 'lben';
UPDATE extended_catalog SET unit = 'boite', search_text = 'mozzarella' WHERE key = 'mozzarella';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'amandes' WHERE key = 'amandes';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'biscuits' WHERE key = 'biscuits';
UPDATE extended_catalog SET unit = 'boite', search_text = 'cacao en poudre' WHERE key = 'cacao-en-poudre';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'cannelle' WHERE key = 'cannelle';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'couscous' WHERE key = 'couscous';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'curcuma' WHERE key = 'curcuma';
UPDATE extended_catalog SET unit = 'boite', search_text = 'cereales' WHERE key = 'cereales';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'farine complete' WHERE key = 'farine-complete';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'haricots blancs loubia' WHERE key = 'haricots-blancs';
UPDATE extended_catalog SET unit = 'pot', search_text = 'harissa' WHERE key = 'harissa';
UPDATE extended_catalog SET unit = 'bouteille', search_text = 'ketchup' WHERE key = 'ketchup';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'levure de boulanger levure boulangere' WHERE key = 'levure-de-boulanger';
UPDATE extended_catalog SET unit = 'pot', search_text = 'mayonnaise' WHERE key = 'mayonnaise';
UPDATE extended_catalog SET unit = 'boite', search_text = 'mais en conserve mais conserve' WHERE key = 'mais-en-conserve';
UPDATE extended_catalog SET unit = 'pot', search_text = 'moutarde' WHERE key = 'moutarde';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'noix' WHERE key = 'noix';
UPDATE extended_catalog SET unit = 'pot', search_text = 'olives olive verte noire' WHERE key = 'olives';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'paprika' WHERE key = 'paprika';
UPDATE extended_catalog SET unit = 'pot', search_text = 'pate a tartiner chocolat tartiner' WHERE key = 'pate-a-tartiner';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'sucre glace' WHERE key = 'sucre-glace';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'sucre vanille' WHERE key = 'sucre-vanille';
UPDATE extended_catalog SET unit = 'bouteille', search_text = 'vinaigre' WHERE key = 'vinaigre';
UPDATE extended_catalog SET unit = 'kg', search_text = 'agneau' WHERE key = 'agneau';
UPDATE extended_catalog SET unit = 'kg', search_text = 'crevettes' WHERE key = 'crevettes';
UPDATE extended_catalog SET unit = 'kg', search_text = 'dinde' WHERE key = 'dinde';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'jambon de dinde' WHERE key = 'jambon-de-dinde';
UPDATE extended_catalog SET unit = 'kg', search_text = 'merguez' WHERE key = 'merguez';
UPDATE extended_catalog SET unit = 'boite', search_text = 'sardines en conserve' WHERE key = 'sardines-en-conserve';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'saucisses' WHERE key = 'saucisses';
UPDATE extended_catalog SET unit = 'piece', search_text = 'glaces glace creme glacee' WHERE key = 'glaces';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'legumes surgeles' WHERE key = 'legumes-surgeles';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'poisson pane nuggets poisson' WHERE key = 'poisson-pane';
UPDATE extended_catalog SET unit = 'piece', search_text = 'pate feuilletee' WHERE key = 'pate-feuilletee';
UPDATE extended_catalog SET unit = 'piece', search_text = 'baguette' WHERE key = 'baguette';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'biscottes' WHERE key = 'biscottes';
UPDATE extended_catalog SET unit = 'piece', search_text = 'brioche' WHERE key = 'brioche';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'crepes msemen' WHERE key = 'crepes';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'gateaux secs marocains gateaux marocains sables cornes de gazelle ghriba' WHERE key = 'gateaux-secs-marocains';
UPDATE extended_catalog SET unit = 'piece', search_text = 'pain complet' WHERE key = 'pain-complet';
UPDATE extended_catalog SET unit = 'bouteille', search_text = 'boisson gazeuse soda limonade' WHERE key = 'boisson-gazeuse';
UPDATE extended_catalog SET unit = 'brique', search_text = 'boisson vegetale amande avoine soja riz lait vegetal lait d''amande' WHERE key = 'boisson-vegetale';
UPDATE extended_catalog SET unit = 'boite', search_text = 'cafe en capsules capsules cafe' WHERE key = 'cafe-en-capsules';
UPDATE extended_catalog SET unit = 'bouteille', search_text = 'eau gazeuse' WHERE key = 'eau-gazeuse';
UPDATE extended_catalog SET unit = 'bouteille', search_text = 'sirop' WHERE key = 'sirop';
UPDATE extended_catalog SET unit = 'boite', search_text = 'tisane infusion verveine' WHERE key = 'tisane';
UPDATE extended_catalog SET unit = 'piece', search_text = 'ampoules' WHERE key = 'ampoules';
UPDATE extended_catalog SET unit = 'bouteille', search_text = 'degraissant' WHERE key = 'degraissant';
UPDATE extended_catalog SET unit = 'piece', search_text = 'desodorisant maison' WHERE key = 'desodorisant';
UPDATE extended_catalog SET unit = 'bouteille', search_text = 'detartrant' WHERE key = 'detartrant';
UPDATE extended_catalog SET unit = 'piece', search_text = 'film alimentaire film etirable' WHERE key = 'film-alimentaire';
UPDATE extended_catalog SET unit = 'piece', search_text = 'papier aluminium alu' WHERE key = 'papier-aluminium';
UPDATE extended_catalog SET unit = 'boite', search_text = 'pastilles lave-vaisselle tablettes lave vaisselle' WHERE key = 'pastilles-lave-vaisselle';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'piles' WHERE key = 'piles';
UPDATE extended_catalog SET unit = 'boite', search_text = 'sacs congelation sacs zip' WHERE key = 'sacs-congelation';
UPDATE extended_catalog SET unit = 'bouteille', search_text = 'apres-shampooing apres shampoing demelant' WHERE key = 'apres-shampooing';
UPDATE extended_catalog SET unit = 'piece', search_text = 'brosse a dents brosses a dents' WHERE key = 'brosse-a-dents';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'coton demaquillant cotons tiges' WHERE key = 'coton';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'couches bebe' WHERE key = 'couches';
UPDATE extended_catalog SET unit = 'pot', search_text = 'creme hydratante creme visage corps' WHERE key = 'creme-hydratante';
UPDATE extended_catalog SET unit = 'piece', search_text = 'deodorant' WHERE key = 'deodorant';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'protections hygieniques serviettes hygieniques' WHERE key = 'protections-hygieniques';
UPDATE extended_catalog SET unit = 'paquet', search_text = 'rasoirs' WHERE key = 'rasoirs';
UPDATE extended_catalog SET unit = 'boite', search_text = 'serum physiologique serum physio dosettes' WHERE key = 'serum-physiologique';

INSERT INTO extended_catalog (category, name, search_text, source, key, unit) VALUES
  ('legumes','Basilic','basilic','seed-v2','basilic','piece'),
  ('legumes','Ciboulette','ciboulette','seed-v2','ciboulette','piece'),
  ('legumes','Fèves fraîches','feves fraiches foul fave verte','seed-v2','feves-fraiches','kg'),
  ('legumes','Romarin','romarin','seed-v2','romarin','piece'),
  ('legumes','Roquette','roquette','seed-v2','roquette','piece'),
  ('legumes','Sauge','sauge','seed-v2','sauge','piece'),
  ('legumes','Thym','thym zaatar frais','seed-v2','thym','piece'),
  ('fruits','Châtaignes','chataignes','seed-v2','chataignes','kg'),
  ('fruits','Coings','coings','seed-v2','coings','kg'),
  ('fruits','Framboises','framboises','seed-v2','framboises','paquet'),
  ('fruits','Fruit de la passion','fruit de la passion maracuja','seed-v2','fruit-de-la-passion','piece'),
  ('fruits','Mûres','mures','seed-v2','mures','paquet'),
  ('fruits','Noix de coco','noix de coco','seed-v2','noix-de-coco','piece'),
  ('fruits','Pamplemousse','pamplemousse','seed-v2','pamplemousse','kg'),
  ('fruits','Papaye','papaye','seed-v2','papaye','piece'),
  ('fruits','Raisins secs','raisins secs raisin sec','seed-v2','raisins-secs','paquet'),
  ('laitages','Crème chantilly','creme chantilly chantilly','seed-v2','creme-chantilly','piece'),
  ('laitages','Crème de cuisson','creme de cuisson creme liquide','seed-v2','creme-de-cuisson','brique'),
  ('laitages','Fromage en tranches','fromage en tranches fromage tranche cheddar','seed-v2','fromage-en-tranches','paquet'),
  ('laitages','Margarine','margarine','seed-v2','margarine','boite'),
  ('laitages','Smen','smen beurre rance','seed-v2','smen','pot'),
  ('epicerie','Bicarbonate alimentaire','bicarbonate alimentaire bicarbonate soude','seed-v2','bicarbonate-alimentaire','paquet'),
  ('epicerie','Bouillon','bouillon cube','seed-v2','bouillon','boite'),
  ('epicerie','Chapelure','chapelure','seed-v2','chapelure','paquet'),
  ('epicerie','Citrons confits','citrons confits citron confit msyar','seed-v2','citrons-confits','pot'),
  ('epicerie','Cornichons','cornichons','seed-v2','cornichons','pot'),
  ('epicerie','Feuilles de brick','feuilles de brick brick warqa feuilles de pastilla','seed-v2','feuilles-de-brick','paquet'),
  ('epicerie','Fèves sèches','foul feves seches bissara','seed-v2','feves-seches','paquet'),
  ('epicerie','Fécule de maïs','fecule de mais maizena fecule','seed-v2','fecule-de-mais','paquet'),
  ('epicerie','Graines de sésame','graines de sesame sesame','seed-v2','graines-de-sesame','paquet'),
  ('epicerie','Huile d''argan alimentaire','huile d''argan alimentaire argan','seed-v2','huile-d-argan-alimentaire','bouteille'),
  ('epicerie','Mélange d''épices','melange d''epices ras el hanout epices tajine','seed-v2','melange-d-epices','pot'),
  ('epicerie','Noix de cajou','noix de cajou cajou','seed-v2','noix-de-cajou','paquet'),
  ('epicerie','Pesto','pesto','seed-v2','pesto','pot'),
  ('epicerie','Piment en poudre','piment en poudre piment moulu','seed-v2','piment-en-poudre','pot'),
  ('epicerie','Pois cassés','pois casses','seed-v2','pois-casses','paquet'),
  ('epicerie','Safran','safran zaafrane','seed-v2','safran','pot'),
  ('epicerie','Sauce tomate','sauce tomate coulis tomate passata','seed-v2','sauce-tomate','boite'),
  ('epicerie','Édulcorant','edulcorant sucrette stevia','seed-v2','edulcorant','boite'),
  ('pain','Amlou','amlou argan','seed-v2','amlou','pot'),
  ('pain','Beurre de cacahuètes','beurre de cacahuetes beurre cacahuete','seed-v2','beurre-de-cacahuetes','pot'),
  ('pain','Caramel à tartiner','caramel a tartiner speculoos','seed-v2','caramel-a-tartiner','pot'),
  ('pain','Compote de fruits','compote de fruits compote pomme','seed-v2','compote-de-fruits','pot'),
  ('pain','Flocons d''avoine','flocons d''avoine avoine porridge','seed-v2','flocons-d-avoine','paquet'),
  ('boissons','Thé glacé','the glace ice tea','seed-v2','the-glace','bouteille'),
  ('maison','Aide au repassage','aide au repassage repassage amidon','seed-v2','aide-au-repassage','bouteille'),
  ('maison','Allume-feu','allume-feu allume feu charbon','seed-v2','allume-feu','paquet'),
  ('maison','Allumettes','allumettes','seed-v2','allumettes','boite'),
  ('maison','Blocs WC','blocs wc bloc wc javel toilettes','seed-v2','blocs-wc','paquet'),
  ('maison','Briquet','briquet cuisine','seed-v2','briquet','piece'),
  ('maison','Diffuseur antimoustiques','diffuseur antimoustiques anti moustiques prise','seed-v2','diffuseur-antimoustiques','piece'),
  ('maison','Déboucheur','deboucheur canalisation','seed-v2','deboucheur','bouteille'),
  ('maison','Désinfectant du linge','desinfectant du linge desinfectant lessive','seed-v2','desinfectant-du-linge','bouteille'),
  ('maison','Désinfectant ménager','desinfectant menager desinfectant surfaces','seed-v2','desinfectant-menager','bouteille'),
  ('maison','Détachant du linge','detachant du linge detachant','seed-v2','detachant-du-linge','bouteille'),
  ('maison','Insecticide','insecticide anti insectes moustiques','seed-v2','insecticide','bouteille'),
  ('maison','Liquide de rinçage pour lave-vaisselle','liquide de rincage pour lave-vaisselle rincage lave vaisselle','seed-v2','liquide-de-rincage-pour-lave-vaisselle','bouteille'),
  ('maison','Nettoyant multiusage','nettoyant multiusage multi surfaces','seed-v2','nettoyant-multiusage','bouteille'),
  ('maison','Nettoyant vitres','nettoyant vitres vitres','seed-v2','nettoyant-vitres','bouteille'),
  ('maison','Papier cuisson','papier cuisson papier sulfurise','seed-v2','papier-cuisson','piece'),
  ('maison','Savon noir ménager','savon noir menager savon noir','seed-v2','savon-noir-menager','bouteille'),
  ('maison','Sel régénérant pour lave-vaisselle','sel regenerant pour lave-vaisselle sel lave vaisselle','seed-v2','sel-regenerant-pour-lave-vaisselle','paquet'),
  ('hygiene','Bain de bouche','bain de bouche','seed-v2','bain-de-bouche','bouteille'),
  ('hygiene','Savon solide','savon solide savon pain savon de marseille','seed-v2','savon-solide','piece')
ON CONFLICT (key) DO NOTHING;
