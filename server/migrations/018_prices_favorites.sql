-- Prix indicatifs, préférences d'affichage par profil, favoris (modèles de liste), prix communautaires et unité « litre ».
-- Aucune donnée existante n'est modifiée ni supprimée : tout est ajout (colonnes avec valeur par défaut, nouvelles tables).
-- Les unités de produits déjà utilisés ne changent pas ; « litre » est seulement une valeur de plus que les administrateurs peuvent choisir.

-- ---- Unité « litre » ------------------------------------------------------------------------------------------
ALTER TABLE initial_catalog  DROP CONSTRAINT IF EXISTS initial_catalog_unit_check;
ALTER TABLE initial_catalog  ADD CONSTRAINT initial_catalog_unit_check  CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','kg','litre'));
ALTER TABLE extended_catalog DROP CONSTRAINT IF EXISTS extended_catalog_unit_check;
ALTER TABLE extended_catalog ADD CONSTRAINT extended_catalog_unit_check CHECK (unit IS NULL OR unit IN ('piece','paquet','bouteille','brique','pot','boite','kg','litre'));
ALTER TABLE products         DROP CONSTRAINT IF EXISTS products_unit_check;
ALTER TABLE products         ADD CONSTRAINT products_unit_check         CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','kg','litre'));
ALTER TABLE list_items       DROP CONSTRAINT IF EXISTS list_items_unit_check;
ALTER TABLE list_items       ADD CONSTRAINT list_items_unit_check       CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','kg','litre'));
ALTER TABLE purchases        DROP CONSTRAINT IF EXISTS purchases_unit_check;
ALTER TABLE purchases        ADD CONSTRAINT purchases_unit_check        CHECK (unit IS NULL OR unit IN ('piece','paquet','bouteille','brique','pot','boite','kg','litre'));
ALTER TABLE list_events      DROP CONSTRAINT IF EXISTS list_events_unit_check;
ALTER TABLE list_events      ADD CONSTRAINT list_events_unit_check      CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','kg','litre'));

-- ---- Préférences d'affichage des prix, propres à chaque profil (désactivées par défaut) ----------------------------
ALTER TABLE profiles ADD COLUMN show_prices boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN show_totals boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD CONSTRAINT profiles_totals_need_prices CHECK (NOT show_totals OR show_prices);
-- Version des préférences : un autre téléphone du même profil sait qu'il doit les relire.
ALTER TABLE profiles ADD COLUMN prefs_rev integer NOT NULL DEFAULT 0;

-- ---- Base initiale des prix (commune, importée depuis un tableau validé ; jamais modifiée par une famille) -------
CREATE TABLE base_prices (
  origin          text NOT NULL CHECK (origin IN ('initial','extended')),
  key             text NOT NULL,                               -- clé stable exacte du produit du catalogue
  amount          numeric(10,2) NOT NULL CHECK (amount > 0),   -- en dirhams marocains
  currency        text NOT NULL DEFAULT 'MAD' CHECK (currency = 'MAD'),
  ref_qty         numeric(10,3) NOT NULL CHECK (ref_qty > 0),  -- quantité de référence du prix (1 kg, 500 g, 1 paquet…)
  ref_unit        text NOT NULL CHECK (ref_unit IN ('kg','g','litre','ml','piece','paquet','bouteille','brique','pot','boite')),
  packaging       text CHECK (packaging IS NULL OR length(packaging) BETWEEN 1 AND 60),   -- contenu de référence : « 250 g », « 1 L »…
  piece_weight_g  numeric(8,2) CHECK (piece_weight_g IS NULL OR piece_weight_g > 0),       -- poids connu d'une pièce (conversion pièce ↔ kg)
  kind            text NOT NULL CHECK (kind IN ('observed','average','rounded')),          -- observation d'une capture, ou prix moyen / arrondi proposé
  source          text NOT NULL CHECK (length(source) BETWEEN 1 AND 120),
  observed_on     date NOT NULL,                               -- date de la capture
  note            text,
  imported_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (origin, key)
);

-- ---- Prix personnalisés d'une famille (priment toujours sur la base initiale) ---------------------------------
CREATE TABLE family_prices (
  family_id       uuid NOT NULL REFERENCES families(id),
  product_id      uuid NOT NULL REFERENCES products(id),
  amount          numeric(10,2) NOT NULL CHECK (amount > 0),
  ref_qty         numeric(10,3) NOT NULL CHECK (ref_qty > 0),
  ref_unit        text NOT NULL CHECK (ref_unit IN ('kg','g','litre','ml','piece','paquet','bouteille','brique','pot','boite')),
  packaging       text CHECK (packaging IS NULL OR length(packaging) BETWEEN 1 AND 60),
  piece_weight_g  numeric(8,2) CHECK (piece_weight_g IS NULL OR piece_weight_g > 0),
  source          text NOT NULL DEFAULT 'family' CHECK (source IN ('family','community')),
  updated_by      uuid REFERENCES profiles(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, product_id)
);

-- ---- Prix figé sur chaque ligne de liste au moment de la validation (les listes archivées gardent le leur) ------
ALTER TABLE list_items ADD COLUMN price_amount     numeric(10,2);
ALTER TABLE list_items ADD COLUMN price_ref_qty    numeric(10,3);
ALTER TABLE list_items ADD COLUMN price_ref_unit   text;
ALTER TABLE list_items ADD COLUMN price_packaging  text;
ALTER TABLE list_items ADD COLUMN price_weight_g   numeric(8,2);
ALTER TABLE list_items ADD COLUMN price_source     text;      -- 'base' | 'family' | 'community' ; NULL = aucun prix connu à la validation

-- ---- Favoris : modèles de liste d'une famille -------------------------------------------------------------------
CREATE TABLE list_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES families(id),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_by  uuid NOT NULL REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX list_templates_name_idx ON list_templates (family_id, lower(name));
CREATE TABLE list_template_items (
  template_id uuid NOT NULL REFERENCES list_templates(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id),
  quantity    numeric(8,3) NOT NULL CHECK (quantity > 0 AND quantity <= 999),
  unit        text NOT NULL CHECK (unit IN ('piece','paquet','bouteille','brique','pot','boite','kg','litre')),
  position    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, product_id)
);

-- ---- Partage communautaire des prix (aucun nom, e-mail, code famille ni historique : une empreinte opaque sert à limiter les envois) --
CREATE TABLE price_contributions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin       text NOT NULL CHECK (origin IN ('initial','extended')),
  key          text NOT NULL,
  amount       numeric(10,2) NOT NULL CHECK (amount > 0),
  ref_qty      numeric(10,3) NOT NULL CHECK (ref_qty > 0),
  ref_unit     text NOT NULL CHECK (ref_unit IN ('kg','g','litre','ml','piece','paquet','bouteille','brique','pot','boite')),
  packaging    text CHECK (packaging IS NULL OR length(packaging) BETWEEN 1 AND 60),
  piece_weight_g numeric(8,2),
  observed_on  date NOT NULL,
  city         text CHECK (city IS NULL OR length(city) BETWEEN 1 AND 60),
  store        text CHECK (store IS NULL OR length(store) BETWEEN 1 AND 60),
  contributor  text NOT NULL,                      -- empreinte opaque de la famille (limitation des envois), jamais affichée
  created_at   timestamptz NOT NULL DEFAULT now(),
  excluded     boolean NOT NULL DEFAULT false      -- écarté (incohérent ou signalé)
);
CREATE INDEX price_contributions_product_idx ON price_contributions (origin, key) WHERE NOT excluded;
CREATE INDEX price_contributions_contributor_idx ON price_contributions (contributor, created_at);
CREATE TABLE price_reports (
  contribution_id uuid NOT NULL REFERENCES price_contributions(id) ON DELETE CASCADE,
  reporter        text NOT NULL,                   -- empreinte opaque de la famille qui signale
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contribution_id, reporter)
);
