-- Unités adaptées : brique, pot, boîte s'ajoutent à pièce, paquet, bouteille, kg.
-- Aucune donnée n'est convertie : une ancienne « pièce » reste une « pièce » (achats, historique, événements compris).
-- Seule la liste des valeurs admises s'élargit ; le choix de l'unité d'un produit se fait ensuite dans Réglages.

ALTER TABLE initial_catalog DROP CONSTRAINT IF EXISTS initial_catalog_unit_check;
ALTER TABLE initial_catalog ADD CONSTRAINT initial_catalog_unit_check CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','kg'));
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_unit_check;
ALTER TABLE products ADD CONSTRAINT products_unit_check CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','kg'));
ALTER TABLE list_items DROP CONSTRAINT IF EXISTS list_items_unit_check;
ALTER TABLE list_items ADD CONSTRAINT list_items_unit_check CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','kg'));
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_unit_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_unit_check CHECK (unit IS NULL OR unit IN ('piece','paquet','bouteille','brique','pot','boite','kg'));
ALTER TABLE list_events DROP CONSTRAINT IF EXISTS list_events_unit_check;
ALTER TABLE list_events ADD CONSTRAINT list_events_unit_check CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','kg'));
