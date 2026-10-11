-- Clé stable pour le catalogue étendu : les identifiants (uuid) sont tirés au hasard à chaque base, donc inutilisables
-- pour associer une image de façon identique entre environnements. La clé (slug du nom) l'est.
ALTER TABLE extended_catalog ADD COLUMN key text;
UPDATE extended_catalog
   SET key = trim(both '-' from regexp_replace(search_text, '[^a-z0-9]+', '-', 'g'))
 WHERE key IS NULL;
ALTER TABLE extended_catalog ALTER COLUMN key SET NOT NULL;
CREATE UNIQUE INDEX extended_catalog_key_idx ON extended_catalog (key);
-- Parcours « Tous les produits » : tri/filtre par catégorie.
CREATE INDEX extended_catalog_cat_idx ON extended_catalog (category, name);
