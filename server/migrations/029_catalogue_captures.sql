-- 029 : lot catalogue du 1er novembre 2026 (89 captures, 81 articles : 45 références ajoutées, 36 existantes réutilisées).
-- AJOUTS UNIQUEMENT. Aucun identifiant, historique, favori, prix personnel ni image personnelle n'est modifié ou supprimé.
--  * Nouvelles références : clés stables, ON CONFLICT (key) DO NOTHING (relançable) ; elles apparaissent dans le catalogue
--    complet, chaque famille les ajoute si elle le souhaite (rien n'est ajouté d'office aux familles).
--  * Références existantes : seuls les mots de recherche sont complétés (noms relevés sur les emballages : « cheveux d'ange »,
--    « huile de tournesol », « sucre granulé »…) ; noms, unités et identifiants inchangés.
--  * Deux références rejoignent leurs voisines, dans les catégories existantes (aucune sous-catégorie) : Raisins secs (Fruits →
--    Épicerie, avec les fruits secs) et Céréales (Épicerie → Pain et petit-déjeuner, avec granola et flocons d'avoine). Les
--    articles des familles ne suivent que s'ils sont encore dans la catégorie d'origine (une catégorie choisie par la famille
--    n'est jamais modifiée).
--  * Unités (décisions du 1er novembre 2026) : un contenant ou un article complet = 1 pièce (soupes en sachet, sauces, sucres,
--    vermicelles de Chine, granola, café soluble, confiture, chips) ; le poids ou le volume reste une information de format.
--    Poissons, fruits secs et olives au poids, boissons au litre. Aucune conversion g ↔ mL.
--  * Prix relevés NON importés (date de prise de vue inconnue) : voir docs/catalogue/import-2026-11-01/references.csv.
INSERT INTO extended_catalog (category,name,search_text,source,key,unit) VALUES
('epicerie','Pistaches','pistaches','captures-20261101','pistaches','kg'),
('epicerie','Cacahuètes salées','cacahuetes salees','captures-20261101','cacahuetes-salees','kg'),
('epicerie','Pruneaux','pruneaux','captures-20261101','pruneaux','kg'),
('epicerie','Abricots secs','abricots secs','captures-20261101','abricots-secs','kg'),
('epicerie','Raisins secs blonds','raisins secs blonds','captures-20261101','raisins-secs-blonds','kg'),
('epicerie','Soupe aux lentilles','soupe aux lentilles','captures-20261101','soupe-aux-lentilles','piece'),
('epicerie','Soupe poulet et vermicelles','soupe poulet et vermicelles','captures-20261101','soupe-poulet-et-vermicelles','piece'),
('epicerie','Soupe de légumes','soupe de legumes','captures-20261101','soupe-de-legumes','piece'),
('epicerie','Crème de poulet','creme de poulet','captures-20261101','creme-de-poulet','piece'),
('epicerie','Olives meslala','olives meslala','captures-20261101','olives-meslala','kg'),
('epicerie','Olives vertes en tranches','olives vertes en tranches','captures-20261101','olives-vertes-en-tranches','kg'),
('epicerie','Olives rouges','olives rouges','captures-20261101','olives-rouges','kg'),
('epicerie','Olives vertes au citron','olives vertes au citron','captures-20261101','olives-vertes-au-citron','kg'),
('epicerie','Olives noires façon grecque','olives noires facon grecque','captures-20261101','olives-noires-facon-grecque','kg'),
('epicerie','Assaisonnement au citron','assaisonnement au citron','captures-20261101','assaisonnement-au-citron','piece'),
('epicerie','Sucre en lingots','sucre en lingots','captures-20261101','sucre-en-lingots','piece'),
('epicerie','Sucre en morceaux','sucre en morceaux','captures-20261101','sucre-en-morceaux','piece'),
('epicerie','Sauce algérienne','sauce algerienne','captures-20261101','sauce-algerienne','piece'),
('epicerie','Sauce barbecue','sauce barbecue','captures-20261101','sauce-barbecue','piece'),
('epicerie','Vermicelles de Chine','vermicelles de chine','captures-20261101','vermicelles-de-chine','piece'),
('boissons','Boisson énergisante','boisson energisante','captures-20261101','boisson-energisante','litre'),
('boissons','Soda à l''orange','soda a l''orange','captures-20261101','soda-a-l-orange','litre'),
('boissons','Tonic','tonic','captures-20261101','tonic','litre'),
('boissons','Soda au citron','soda au citron','captures-20261101','soda-au-citron','litre'),
('boissons','Cola','cola','captures-20261101','cola','litre'),
('boissons','Soda à l''orange sans sucre','soda a l''orange sans sucre','captures-20261101','soda-a-l-orange-sans-sucre','litre'),
('boissons','Soda à la pomme','soda a la pomme','captures-20261101','soda-a-la-pomme','litre'),
('boissons','Soda à l''ananas','soda a l''ananas','captures-20261101','soda-a-l-ananas','litre'),
('epicerie','Chips','chips chips au fromage et aux oignons','captures-20261101','chips-au-fromage-et-aux-oignons','piece'),
('pain','Granola aux trois chocolats','granola aux trois chocolats','captures-20261101','granola-aux-trois-chocolats','piece'),
('pain','Café soluble','cafe soluble','captures-20261101','cafe-soluble','piece'),
('pain','Confiture de figue','confiture de figue','captures-20261101','confiture-de-figue','piece'),
('viandes','Saint-Pierre métallisé','saint-pierre metallise','captures-20261101','saint-pierre-metallise','kg'),
('viandes','Espadon','espadon','captures-20261101','espadon','kg'),
('viandes','Sole','sole','captures-20261101','sole','kg'),
('viandes','Anneaux de calamar','anneaux de calamar','captures-20261101','anneaux-de-calamar','kg'),
('viandes','Merlan colin','merlan colin','captures-20261101','merlan-colin','kg'),
('viandes','Bar','bar','captures-20261101','bar','kg'),
('viandes','Merlan ration','merlan ration','captures-20261101','merlan-ration','kg'),
('viandes','Crevettes grises','crevettes grises','captures-20261101','crevettes-grises','kg'),
('viandes','Dorade royale','dorade royale','captures-20261101','dorade-royale','kg'),
('viandes','Crevettes roses','crevettes roses','captures-20261101','crevettes-roses','kg'),
('viandes','Lamelles de calamar','lamelles de calamar','captures-20261101','lamelles-de-calamar','kg'),
('viandes','Pageot royal','pageot royal','captures-20261101','pageot-royal','kg'),
('viandes','Pageot chama','pageot chama','captures-20261101','pageot-chama','kg')
ON CONFLICT (key) DO NOTHING;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'noix de cajou grillees') WHERE key='noix-de-cajou' AND strpos(coalesce(search_text,''),'noix de cajou grillees')=0;
UPDATE extended_catalog SET category='epicerie' WHERE key='raisins-secs' AND category='fruits';
UPDATE products p SET category='epicerie' WHERE p.extended_id=(SELECT id FROM extended_catalog WHERE key='raisins-secs') AND p.category='fruits';
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'raisins secs noirs') WHERE key='raisins-secs' AND strpos(coalesce(search_text,''),'raisins secs noirs')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'noix decortiquees') WHERE key='noix' AND strpos(coalesce(search_text,''),'noix decortiquees')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'amandes') WHERE key='amandes' AND strpos(coalesce(search_text,''),'amandes')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'chapelure') WHERE key='chapelure' AND strpos(coalesce(search_text,''),'chapelure')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'olives mixtes') WHERE key='olives' AND strpos(coalesce(search_text,''),'olives mixtes')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'vinaigre blanc') WHERE key='vinaigre' AND strpos(coalesce(search_text,''),'vinaigre blanc')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'sucre granule') WHERE key='sucre' AND strpos(coalesce(aliases,''),'sucre granule')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'sauce tomate pour pizza') WHERE key='sauce-tomate' AND strpos(coalesce(search_text,''),'sauce tomate pour pizza')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'concentre de tomates') WHERE key='concentre-de-tomates' AND strpos(coalesce(aliases,''),'concentre de tomates')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'harissa') WHERE key='harissa' AND strpos(coalesce(search_text,''),'harissa')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'moutarde') WHERE key='moutarde' AND strpos(coalesce(search_text,''),'moutarde')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'mayonnaise') WHERE key='mayonnaise' AND strpos(coalesce(search_text,''),'mayonnaise')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'ketchup') WHERE key='ketchup' AND strpos(coalesce(search_text,''),'ketchup')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'huile d''olive') WHERE key='huile-d-olive' AND strpos(coalesce(aliases,''),'huile d''olive')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'huile de tournesol') WHERE key='huile-de-table' AND strpos(coalesce(aliases,''),'huile de tournesol')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'levure boulangere seche') WHERE key='levure-de-boulanger' AND strpos(coalesce(search_text,''),'levure boulangere seche')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'levure chimique') WHERE key='levure-chimique' AND strpos(coalesce(aliases,''),'levure chimique')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'sucre vanille') WHERE key='sucre-vanille' AND strpos(coalesce(search_text,''),'sucre vanille')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'farine') WHERE key='farine' AND strpos(coalesce(aliases,''),'farine')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'farine complete') WHERE key='farine-complete' AND strpos(coalesce(search_text,''),'farine complete')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'farine finot') WHERE key='farine-fino' AND strpos(coalesce(search_text,''),'farine finot')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'lentilles') WHERE key='lentilles' AND strpos(coalesce(aliases,''),'lentilles')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'pois chiches') WHERE key='pois-chiches' AND strpos(coalesce(aliases,''),'pois chiches')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'haricots blancs') WHERE key='haricots-blancs' AND strpos(coalesce(search_text,''),'haricots blancs')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'cheveux d''ange') WHERE key='vermicelles' AND strpos(coalesce(aliases,''),'cheveux d''ange')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'semoule fine') WHERE key='semoule-fine' AND strpos(coalesce(aliases,''),'semoule fine')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'couscous fin') WHERE key='couscous' AND strpos(coalesce(search_text,''),'couscous fin')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'eau gazeuse') WHERE key='eau-gazeuse' AND strpos(coalesce(search_text,''),'eau gazeuse')=0;
UPDATE extended_catalog SET category='pain' WHERE key='cereales' AND category='epicerie';
UPDATE products p SET category='pain' WHERE p.extended_id=(SELECT id FROM extended_catalog WHERE key='cereales') AND p.category='epicerie';
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'cereales au chocolat') WHERE key='cereales' AND strpos(coalesce(search_text,''),'cereales au chocolat')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'baguette au sesame') WHERE key='baguette' AND strpos(coalesce(search_text,''),'baguette au sesame')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'miel multifleurs') WHERE key='miel' AND strpos(coalesce(aliases,''),'miel multifleurs')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'confiture d''abricot') WHERE key='confiture' AND strpos(coalesce(aliases,''),'confiture d''abricot')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'sel alimentaire') WHERE key='sel' AND strpos(coalesce(aliases,''),'sel alimentaire')=0;
UPDATE extended_catalog SET search_text = concat_ws(' ', search_text, 'lben') WHERE key='lben' AND strpos(coalesce(search_text,''),'lben')=0;
UPDATE initial_catalog SET aliases = concat_ws(' ', aliases, 'lait entier uht') WHERE key='lait' AND strpos(coalesce(aliases,''),'lait entier uht')=0;

-- Mots de recherche des nouvelles références : le nom du rayon courant (« poisson », « soda »…), sans créer de sous-catégorie.
UPDATE extended_catalog SET search_text = search_text || ' poisson' WHERE source = 'captures-20261101' AND key IN
  ('saint-pierre-metallise','espadon','sole','merlan-colin','bar','merlan-ration','dorade-royale','pageot-royal','pageot-chama')
  AND strpos(search_text, 'poisson') = 0;
UPDATE extended_catalog SET search_text = search_text || ' fruits de mer' WHERE source = 'captures-20261101' AND key IN
  ('anneaux-de-calamar','lamelles-de-calamar','crevettes-grises','crevettes-roses') AND strpos(search_text, 'fruits de mer') = 0;
UPDATE extended_catalog SET search_text = search_text || ' soda boisson gazeuse' WHERE source = 'captures-20261101' AND key IN
  ('cola','tonic','soda-a-l-orange','soda-au-citron','soda-a-l-orange-sans-sucre','soda-a-la-pomme','soda-a-l-ananas')
  AND strpos(search_text, 'boisson gazeuse') = 0;
UPDATE extended_catalog SET search_text = search_text || ' fruits secs' WHERE source = 'captures-20261101' AND key IN
  ('pistaches','cacahuetes-salees','pruneaux','abricots-secs','raisins-secs-blonds') AND strpos(search_text, 'fruits secs') = 0;
UPDATE extended_catalog SET search_text = search_text || ' potage' WHERE source = 'captures-20261101' AND key IN
  ('soupe-aux-lentilles','soupe-poulet-et-vermicelles','soupe-de-legumes','creme-de-poulet') AND strpos(search_text, 'potage') = 0;

-- Les téléphones rechargent le catalogue (mots de recherche, catégories) à la prochaine synchronisation.
UPDATE families SET catalog_rev = catalog_rev + 1;
