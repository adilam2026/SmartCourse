-- Catalogue : six références (farines et semoules au kilo, Pâte à tartiner Nutella), catégorie « Autres », produits créés par une
-- famille pour elle seule, propositions volontaires au catalogue commun et gestionnaires de l'application.
-- Aucun article n'est activé dans une famille existante ; aucun produit masqué n'est réactivé ; aucune ligne de liste, aucun achat,
-- aucun prix n'est modifié (les lignes gardent l'unité figée à leur ajout).

-- ---- Catégorie « Autres » (par défaut pour un produit créé sans catégorie) ----------------------------------------------------
INSERT INTO categories (key, label, position)
SELECT 'autres', 'Autres', coalesce(max(position), 0) + 1 FROM categories
ON CONFLICT (key) DO NOTHING;

-- ---- Nouvelles références (distinctes de « Farine » et de la « Pâte à tartiner » générique, conservées) ---------------------
INSERT INTO extended_catalog (category, name, search_text, source, key, unit) VALUES
  ('epicerie','Farine fino','farine fino farine fine msemen','seed-v3','farine-fino','kg'),
  ('epicerie','Farine force','farine force farine de force farine a pain','seed-v3','farine-force','kg'),
  ('epicerie','Pâte à tartiner Nutella','pate a tartiner nutella nutella chocolat a tartiner pate a tartiner','seed-v3','pate-a-tartiner-nutella','pot')
ON CONFLICT (key) DO NOTHING;

-- ---- Références réutilisées : même identifiant, unité au kilo ----------------------------------------------------------------
-- Semoule couscous = l'ancien « Couscous » : renommé, l'ancien nom reste trouvable et reconnu.
UPDATE extended_catalog
   SET name = 'Semoule couscous', unit = 'kg', search_text = 'semoule couscous couscous graine de couscous',
       former_names = (SELECT array_agg(DISTINCT x) FROM unnest(former_names || '{"couscous"}'::text[]) x)
 WHERE key = 'couscous';
UPDATE extended_catalog SET unit = 'kg', search_text = 'farine complete farine integrale' WHERE key = 'farine-complete';
UPDATE initial_catalog SET unit = 'kg', aliases = 'semoule' WHERE key = 'semoule-fine';

-- Articles des familles liés à ces références : nom et unité suivent seulement s'ils sont restés ceux du catalogue
-- (un nom ou une unité choisis par la famille ne sont jamais écrasés).
UPDATE products p SET name = 'Semoule couscous'
 WHERE p.extended_id = (SELECT id FROM extended_catalog WHERE key = 'couscous') AND p.name = 'Couscous' AND p.brand IS NULL
   AND NOT EXISTS (SELECT 1 FROM products q WHERE q.family_id = p.family_id AND lower(q.name) = 'semoule couscous' AND q.brand IS NULL);
UPDATE products SET unit = 'kg'
 WHERE unit = 'paquet'
   AND (extended_id IN (SELECT id FROM extended_catalog WHERE key IN ('couscous','farine-complete')) OR catalog_key = 'semoule-fine');

-- ---- Propositions au catalogue commun ----------------------------------------------------------------------------------------
-- Seul ce qu'une personne envoie volontairement : nom, catégorie, unité, description. Jamais publiées sans un gestionnaire.
CREATE TABLE catalog_proposals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  proposed_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  category     text NOT NULL REFERENCES categories(key),
  unit         text NOT NULL,
  description  text CHECK (description IS NULL OR char_length(description) <= 300),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  result_origin text CHECK (result_origin IS NULL OR result_origin IN ('initial','extended')),
  result_key   text,
  note         text CHECK (note IS NULL OR char_length(note) <= 300)
);
CREATE UNIQUE INDEX catalog_proposals_one_pending ON catalog_proposals (product_id) WHERE status = 'pending';
CREATE INDEX catalog_proposals_status ON catalog_proposals (status, created_at);

-- ---- Gestionnaires de l'application (distincts des administrateurs de famille) ---------------------------------------------
-- Ajoutés un par un (migration ou variable CATALOG_MANAGERS) ; aucun rôle de famille ne donne cet accès.
CREATE TABLE catalog_managers (
  profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now()
);

-- Les applications rechargent leur catalogue (nouveaux noms et unités).
UPDATE families SET catalog_rev = catalog_rev + 1;
