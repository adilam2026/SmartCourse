-- Correction des unités de 27 produits du catalogue (validée par le propriétaire, captures 1 à 12) et cohérence des prix.
--
-- Ce qui change :
--   * l'unité du catalogue commun (catalogue de départ et catalogue étendu) ;
--   * l'unité du même produit dans CHAQUE famille (produits rattachés à la clé du catalogue ; un produit créé par une famille sous
--     son propre nom n'est pas concerné) ;
--   * les prix (base commune et prix des familles) SEULEMENT quand la conversion est exacte : un conditionnement de poids connu
--     devient un prix au poids (« 10 DH / paquet de 500 g » → « 10 DH / 500 g », soit 20 DH/kg ; « 120 DH / paquet de 1 kg » →
--     « 120 DH / kg »).
-- Ce qui ne change jamais :
--   * les lignes des listes déjà créées, les achats, les événements et les favoris : quantité, unité et prix y restent figés ;
--   * un prix dont la conversion est impossible (pièce → kg sans poids, kg → pièce sans poids, sachet sans poids…) : il est
--     conservé tel quel ; l'application le signale « à ressaisir » et ne l'utilise pour aucun montant (unités incompatibles).
-- Chaque modification est inscrite dans unit_corrections (valeurs avant / après) : retour arrière exact possible.
-- Papier toilette, essuie-tout et sacs-poubelle (capture 13) : en attente de confirmation, NON modifiés.

CREATE TABLE unit_corrections (
  id          bigserial PRIMARY KEY,
  migration   text NOT NULL,
  family_id   uuid,                       -- NULL : catalogue commun ou base commune des prix
  subject     text NOT NULL CHECK (subject IN ('initial_catalog', 'extended_catalog', 'product', 'base_price', 'family_price')),
  ref         text NOT NULL,              -- clé du catalogue, ou identifiant du produit de la famille
  old_unit    text,
  new_unit    text NOT NULL,
  old_price   jsonb,
  new_price   jsonb,
  outcome     text NOT NULL CHECK (outcome IN ('unit_changed', 'price_converted', 'price_to_reenter')),
  applied_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX unit_corrections_family_idx ON unit_corrections (family_id) WHERE family_id IS NOT NULL;

CREATE TEMP TABLE t027 (origin text NOT NULL, key text NOT NULL, unit text NOT NULL) ON COMMIT DROP;
INSERT INTO t027 (origin, key, unit) VALUES
  -- À la pièce (captures 1 et 12)
  ('initial', 'persil', 'piece'), ('initial', 'coriandre', 'piece'), ('initial', 'menthe', 'piece'),
  ('extended', 'brocolis', 'piece'), ('extended', 'celeri', 'piece'), ('initial', 'poulet', 'piece'),
  -- Au poids, en kg (captures 2 à 11)
  ('extended', 'fenouil', 'kg'), ('extended', 'mangues', 'kg'), ('extended', 'raisins-secs', 'kg'), ('extended', 'noix-de-coco', 'kg'),
  ('extended', 'fromage-en-tranches', 'kg'), ('extended', 'mozzarella', 'kg'),
  ('initial', 'riz', 'kg'), ('initial', 'pates', 'kg'), ('initial', 'vermicelles', 'kg'), ('initial', 'lentilles', 'kg'), ('initial', 'pois-chiches', 'kg'),
  ('initial', 'poivre', 'kg'), ('initial', 'cumin', 'kg'),
  ('extended', 'amandes', 'kg'), ('extended', 'citrons-confits', 'kg'), ('extended', 'cornichons', 'kg'),
  ('extended', 'curcuma', 'kg'), ('extended', 'fecule-de-mais', 'kg'), ('extended', 'noix', 'kg'), ('extended', 'noix-de-cajou', 'kg'),
  ('extended', 'sucre-glace', 'kg');

-- Prix exprimé dans un format utilisable pour l'unité cible ? (même règle que pricing.ts : poids ↔ pièce seulement avec le poids d'une pièce)
CREATE FUNCTION pg_temp.price_fits_027(target text, ref_unit text, w numeric) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE target
    WHEN 'kg' THEN ref_unit IN ('kg', 'g') OR (ref_unit = 'piece' AND w IS NOT NULL)
    WHEN 'piece' THEN ref_unit = 'piece' OR (ref_unit IN ('kg', 'g') AND w IS NOT NULL)
    ELSE false END
$$;

-- Conversion EXACTE vers un prix au poids : unité comptée dont le conditionnement est un poids (« 500 g », « 1 kg », « 1,5 kg »).
-- Renvoie NULL quand elle est impossible (le prix est alors conservé tel quel, à ressaisir).
CREATE FUNCTION pg_temp.to_weight_027(ref_qty numeric, ref_unit text, packaging text, OUT qty numeric, OUT unit text) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m text[]; n numeric; grams numeric;
BEGIN
  qty := NULL; unit := NULL;
  IF ref_unit IN ('kg', 'g', 'litre', 'ml') OR packaging IS NULL THEN RETURN; END IF;
  m := regexp_match(packaging, '^\s*(\d+(?:[.,]\d{1,3})?)\s*(g|kg)\s*$', 'i');
  IF m IS NULL THEN RETURN; END IF;
  n := replace(m[1], ',', '.')::numeric;
  grams := ref_qty * n * CASE WHEN lower(m[2]) = 'kg' THEN 1000 ELSE 1 END;
  IF grams <= 0 OR grams <> round(grams) THEN RETURN; END IF;
  IF grams % 1000 = 0 THEN qty := grams / 1000; unit := 'kg'; ELSE qty := grams; unit := 'g'; END IF;
END $$;

-- ---- Catalogue commun -----------------------------------------------------------------------------------------
INSERT INTO unit_corrections (migration, subject, ref, old_unit, new_unit, outcome)
SELECT '027', 'initial_catalog', i.key, i.unit, t.unit, 'unit_changed' FROM initial_catalog i JOIN t027 t ON t.origin = 'initial' AND t.key = i.key WHERE i.unit <> t.unit;
UPDATE initial_catalog i SET unit = t.unit FROM t027 t WHERE t.origin = 'initial' AND t.key = i.key AND i.unit <> t.unit;

INSERT INTO unit_corrections (migration, subject, ref, old_unit, new_unit, outcome)
SELECT '027', 'extended_catalog', e.key, e.unit, t.unit, 'unit_changed' FROM extended_catalog e JOIN t027 t ON t.origin = 'extended' AND t.key = e.key WHERE e.unit IS DISTINCT FROM t.unit;
UPDATE extended_catalog e SET unit = t.unit FROM t027 t WHERE t.origin = 'extended' AND t.key = e.key AND e.unit IS DISTINCT FROM t.unit;

-- ---- Produits des familles (rattachés au catalogue) -------------------------------------------------------------
CREATE TEMP TABLE p027 ON COMMIT DROP AS
  SELECT p.id, p.family_id, p.unit AS old_unit, t.unit AS new_unit
    FROM products p JOIN t027 t ON t.origin = 'initial' AND p.catalog_key = t.key
   WHERE p.unit <> t.unit
  UNION ALL
  SELECT p.id, p.family_id, p.unit, t.unit
    FROM products p JOIN extended_catalog e ON e.id = p.extended_id JOIN t027 t ON t.origin = 'extended' AND t.key = e.key
   WHERE p.unit <> t.unit;

INSERT INTO unit_corrections (migration, family_id, subject, ref, old_unit, new_unit, outcome)
SELECT '027', family_id, 'product', id::text, old_unit, new_unit, 'unit_changed' FROM p027;
UPDATE products p SET unit = x.new_unit FROM p027 x WHERE x.id = p.id;

-- ---- Prix des familles de ces produits ---------------------------------------------------------------------------
CREATE TEMP TABLE fp027 ON COMMIT DROP AS
  SELECT f.family_id, f.product_id, x.old_unit, x.new_unit, f.amount, f.ref_qty, f.ref_unit, f.packaging, f.piece_weight_g,
         (pg_temp.to_weight_027(f.ref_qty, f.ref_unit, f.packaging)).*
    FROM family_prices f JOIN p027 x ON x.id = f.product_id
   WHERE NOT pg_temp.price_fits_027(x.new_unit, f.ref_unit, f.piece_weight_g);

INSERT INTO unit_corrections (migration, family_id, subject, ref, old_unit, new_unit, old_price, new_price, outcome)
SELECT '027', family_id, 'family_price', product_id::text, old_unit, new_unit,
       jsonb_build_object('amount', amount, 'refQty', ref_qty, 'refUnit', ref_unit, 'packaging', packaging, 'pieceWeightG', piece_weight_g),
       CASE WHEN new_unit = 'kg' AND unit IS NOT NULL THEN jsonb_build_object('amount', amount, 'refQty', qty, 'refUnit', unit, 'packaging', NULL, 'pieceWeightG', NULL) END,
       CASE WHEN new_unit = 'kg' AND unit IS NOT NULL THEN 'price_converted' ELSE 'price_to_reenter' END
  FROM fp027;
UPDATE family_prices f SET ref_qty = x.qty, ref_unit = x.unit, packaging = NULL, piece_weight_g = NULL
  FROM fp027 x WHERE x.family_id = f.family_id AND x.product_id = f.product_id AND x.new_unit = 'kg' AND x.unit IS NOT NULL;

-- ---- Base commune des prix ----------------------------------------------------------------------------------------
CREATE TEMP TABLE bp027 ON COMMIT DROP AS
  SELECT b.origin, b.key, t.unit AS new_unit, b.amount, b.ref_qty, b.ref_unit, b.packaging, b.piece_weight_g,
         (pg_temp.to_weight_027(b.ref_qty, b.ref_unit, b.packaging)).*
    FROM base_prices b JOIN t027 t ON t.origin = b.origin AND t.key = b.key
   WHERE NOT pg_temp.price_fits_027(t.unit, b.ref_unit, b.piece_weight_g);

INSERT INTO unit_corrections (migration, subject, ref, old_unit, new_unit, old_price, new_price, outcome)
SELECT '027', 'base_price', origin || ':' || key, ref_unit, new_unit,
       jsonb_build_object('amount', amount, 'refQty', ref_qty, 'refUnit', ref_unit, 'packaging', packaging, 'pieceWeightG', piece_weight_g),
       CASE WHEN new_unit = 'kg' AND unit IS NOT NULL THEN jsonb_build_object('amount', amount, 'refQty', qty, 'refUnit', unit, 'packaging', NULL, 'pieceWeightG', NULL) END,
       CASE WHEN new_unit = 'kg' AND unit IS NOT NULL THEN 'price_converted' ELSE 'price_to_reenter' END
  FROM bp027;
UPDATE base_prices b SET ref_qty = x.qty, ref_unit = x.unit, packaging = NULL, piece_weight_g = NULL
  FROM bp027 x WHERE x.origin = b.origin AND x.key = b.key AND x.new_unit = 'kg' AND x.unit IS NOT NULL;

-- Catalogue commun et base des prix changés : tous les téléphones relisent le catalogue (les produits des familles ont déjà
-- déclenché products_bump_catalog_rev).
UPDATE families SET catalog_rev = catalog_rev + 1;

DROP FUNCTION pg_temp.to_weight_027(numeric, text, text);
DROP FUNCTION pg_temp.price_fits_027(text, text, numeric);
