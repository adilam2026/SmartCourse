-- 030 : décisions finales sur les unités (1er novembre 2026). Elles remplacent les unités correspondantes du lot catalogue.
-- Règle : une unité représente un contenant ou un article complet (1 pot de miel de 250 g = 1 pièce ; 1 paquet de 10 sachets de
-- sucre vanillé = 1 pièce). Le poids, le volume et le nombre de sachets restent des informations de format, séparées.
-- Les références nouvelles du lot (migration 029) ont déjà ces unités ; celle-ci corrige les références EXISTANTES.
--
-- Même méthode que 027, dont elle réutilise le journal unit_corrections (retour arrière exact) :
--  * Familles : l'unité d'un produit rattaché au catalogue change SEULEMENT si elle vient du catalogue (unité actuelle du catalogue,
--    unité de départ de son rayon, ou cas particuliers de 009) ; une unité choisie par la famille est conservée et journalisée
--    (« unit_kept_custom »). Identifiants inchangés.
--  * Jamais modifiés : lignes de listes, achats, événements, favoris (quantité et unité figées : un achat passé reste « 0,5 kg »,
--    les statistiques gardent chaque unité à part).
--  * Prix (communs et des familles) : convertis seulement quand c'est exact, montant jamais modifié :
--      - prix d'un contenant (pot, boîte, paquet, bouteille, brique ; sachet pour les potages) -> le même prix pour 1 pièce,
--        le contenu écrit restant le format (« pot » de 430 g -> 1 pièce, format « 430 g ») ;
--      - prix ramené au poids par 027 depuis un contenant (journal 027) -> le contenant d'origine, 1 pièce ;
--      - prix au kg d'un produit de la famille dont le format donne un poids unique (« pot de 250 g ») -> même prix au kg,
--        poids d'une pièce = 250 g (le montant d'une ligne est alors exact) ;
--    sinon le prix est CONSERVÉ tel quel et signalé à compléter (« price_to_confirm ») : un prix au kg n'est jamais réutilisé
--    directement comme prix à la pièce.

-- ---- Unités décidées (références existantes) --------------------------------------------------------------------------------
CREATE TEMP TABLE t030 (origin text, key text, unit text) ON COMMIT DROP;
INSERT INTO t030 VALUES
  -- Condiments et sauces
  ('extended', 'moutarde', 'piece'), ('extended', 'mayonnaise', 'piece'), ('extended', 'ketchup', 'piece'),
  ('initial', 'concentre-de-tomates', 'piece'), ('extended', 'sauce-tomate', 'piece'),
  -- Pâtes à tartiner et compotes
  ('initial', 'confiture', 'piece'), ('initial', 'miel', 'piece'), ('extended', 'beurre-de-cacahuetes', 'piece'),
  ('extended', 'caramel-a-tartiner', 'piece'), ('extended', 'compote-de-fruits', 'piece'),
  ('extended', 'pate-a-tartiner', 'piece'),  -- comme « Pâte à tartiner Nutella » (référence distincte, aucun doublon)
  -- Sucres, levures, aides à la pâtisserie
  ('initial', 'sucre', 'piece'), ('extended', 'sucre-glace', 'piece'), ('extended', 'sucre-vanille', 'piece'),
  ('initial', 'levure-chimique', 'piece'), ('extended', 'levure-de-boulanger', 'piece'),
  ('extended', 'chapelure', 'piece'), ('extended', 'fecule-de-mais', 'piece'), ('extended', 'bicarbonate-alimentaire', 'piece'),
  ('extended', 'cacao-en-poudre', 'piece'),
  -- Petit-déjeuner, biscuits, pain de mie
  ('extended', 'cereales', 'piece'), ('extended', 'flocons-d-avoine', 'piece'),
  ('extended', 'biscuits', 'piece'), ('extended', 'biscottes', 'piece'), ('extended', 'gateaux-secs-marocains', 'piece'),
  ('initial', 'pain-de-mie', 'piece'),
  -- Café, thé, tisane, sel
  ('initial', 'cafe', 'piece'), ('extended', 'the-en-vrac', 'piece'), ('extended', 'tisane-en-vrac', 'piece'),
  ('initial', 'sel', 'piece'),
  -- Maison
  ('extended', 'lessive-en-poudre', 'piece'), ('extended', 'savon-noir-en-pate', 'piece'),
  ('extended', 'sel-regenerant-pour-lave-vaisselle', 'piece'),
  -- Fruits et légumes vendus entiers
  ('extended', 'choux-fleurs', 'piece'), ('extended', 'melon', 'piece'), ('extended', 'pasteque', 'piece'),
  -- Conserves et laitages
  ('extended', 'mais-en-conserve', 'piece'), ('extended', 'pesto', 'piece'),
  ('extended', 'lait-concentre', 'piece'), ('extended', 'lait-en-poudre', 'piece'),
  -- Autres changements validés
  ('initial', 'fromage-en-portions', 'kg'),
  ('extended', 'epinards', 'botte');

-- Prix « par sachet » : un sachet est la pièce pour les potages, mais un PETIT sachet d'un paquet pour le sucre vanillé et la
-- levure chimique (1 paquet de 10 sachets = 1 pièce) : ces prix-là ne sont pas convertibles.
CREATE TEMP TABLE sachet030 (key text) ON COMMIT DROP;
INSERT INTO sachet030 VALUES ('soupe-aux-lentilles'), ('soupe-poulet-et-vermicelles'), ('soupe-de-legumes'), ('creme-de-poulet');

-- ---- Format de référence d'une référence commune (information affichée, jamais une conversion ni un prix) -----------------
-- Copié dans le format du produit d'une famille quand elle l'ajoute ; une famille garde toujours le format qu'elle a saisi.
ALTER TABLE initial_catalog  ADD COLUMN IF NOT EXISTS format text CHECK (format IS NULL OR length(format) <= 60);
ALTER TABLE extended_catalog ADD COLUMN IF NOT EXISTS format text CHECK (format IS NULL OR length(format) <= 60);
ALTER TABLE unit_corrections DROP CONSTRAINT IF EXISTS unit_corrections_outcome_check;
ALTER TABLE unit_corrections ADD CONSTRAINT unit_corrections_outcome_check
  CHECK (outcome IN ('unit_changed', 'unit_kept_custom', 'price_converted', 'price_to_confirm', 'renamed', 'created', 'format_set'));

-- ---- Nom : « Céréales » -> « Céréales au chocolat » (même identifiant ; l'ancien nom reste reconnu) -------------------------
INSERT INTO unit_corrections (migration, subject, ref, old_value, new_value, outcome)
SELECT '030', 'extended_catalog', 'cereales', jsonb_build_object('name', e.name), jsonb_build_object('name', 'Céréales au chocolat'), 'renamed'
  FROM extended_catalog e WHERE e.key = 'cereales' AND e.name = 'Céréales';
UPDATE extended_catalog e SET name = 'Céréales au chocolat',
       search_text = concat_ws(' ', 'cereales au chocolat', e.search_text),
       former_names = (SELECT array_agg(DISTINCT x) FROM unnest(e.former_names || ARRAY['céréales']) x)
 WHERE e.key = 'cereales' AND e.name = 'Céréales';
-- Articles des familles : le nom suit seulement s'il est resté celui du catalogue (un nom choisi par la famille est gardé).
INSERT INTO unit_corrections (migration, family_id, subject, ref, old_value, new_value, outcome)
SELECT '030', p.family_id, 'product', p.id::text, jsonb_build_object('name', p.name), jsonb_build_object('name', 'Céréales au chocolat'), 'renamed'
  FROM products p
 WHERE p.extended_id = (SELECT id FROM extended_catalog WHERE key = 'cereales') AND p.name = 'Céréales' AND p.brand IS NULL
   AND NOT EXISTS (SELECT 1 FROM products q WHERE q.family_id = p.family_id AND lower(q.name) = 'céréales au chocolat');
UPDATE products p SET name = 'Céréales au chocolat'
 WHERE p.extended_id = (SELECT id FROM extended_catalog WHERE key = 'cereales') AND p.name = 'Céréales' AND p.brand IS NULL
   AND NOT EXISTS (SELECT 1 FROM products q WHERE q.family_id = p.family_id AND lower(q.name) = 'céréales au chocolat');

-- ---- Conversion exacte d'un prix vers l'unité cible (NULL si elle ne l'est pas) ----------------------------------------------
-- target 'piece' : prix d'un contenant -> 1 pièce par contenant (le contenu écrit reste le format) ;
-- target 'kg'    : prix d'un contenant au contenu écrit en poids (« 120 g », « boîte de 120 g ») -> prix pour ce poids.
CREATE FUNCTION pg_temp.conv030(target text, key text, ref_qty numeric, ref_unit text, packaging text, OUT qty numeric, OUT unit text, OUT pack text)
LANGUAGE plpgsql STABLE AS $$
DECLARE m text[]; v numeric;
BEGIN
  qty := NULL; unit := NULL; pack := packaging;
  IF target = 'piece' THEN
    IF ref_unit IN ('pot', 'boite', 'paquet', 'bouteille', 'brique')
       OR (ref_unit = 'sachet' AND EXISTS (SELECT 1 FROM sachet030 s WHERE s.key = conv030.key)) THEN
      qty := ref_qty; unit := 'piece';
    END IF;
  ELSIF target = 'kg' AND ref_unit IN ('piece', 'pot', 'boite', 'paquet') THEN
    m := regexp_match(coalesce(packaging, ''), '^\s*(?:[[:alpha:]]+ de\s+)?(\d+(?:[.,]\d{1,3})?)\s*(g|kg)\s*$', 'i');
    IF m IS NOT NULL THEN
      v := ref_qty * replace(m[1], ',', '.')::numeric * CASE WHEN lower(m[2]) = 'kg' THEN 1000 ELSE 1 END;
      IF v = round(v) THEN
        IF v % 1000 = 0 THEN qty := round(v / 1000, 3); unit := 'kg'; ELSE qty := round(v, 3); unit := 'g'; END IF;
        pack := NULL;
      END IF;
    END IF;
  END IF;
END $$;
-- Prix déjà utilisable pour l'unité cible (même règle que pricing.ts : même nature, ou poids d'une pièce connu).
CREATE FUNCTION pg_temp.fits030(target text, ref_unit text, w numeric) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN target = 'kg' THEN ref_unit IN ('kg', 'g') OR (ref_unit = 'piece' AND w IS NOT NULL)
    WHEN target = 'litre' THEN ref_unit IN ('litre', 'ml')
    WHEN target = 'piece' THEN ref_unit = 'piece' OR (ref_unit IN ('kg', 'g') AND w IS NOT NULL)
    ELSE ref_unit = target END
$$;
-- Prix ramené au poids par 027 depuis un contenant : contenant d'origine (journal 027, valeurs encore identiques).
CREATE FUNCTION pg_temp.origin027(subj text, r text, fam uuid, amount numeric, ref_qty numeric, ref_unit text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT u.old_value FROM unit_corrections u
   WHERE u.migration = '027' AND u.outcome = 'price_converted' AND u.subject = subj AND u.ref = r AND u.family_id IS NOT DISTINCT FROM fam
     AND u.old_value->>'refUnit' IN ('pot', 'boite', 'paquet', 'bouteille', 'brique')
     AND (u.new_value->>'amount')::numeric = amount AND (u.new_value->>'refQty')::numeric = ref_qty AND u.new_value->>'refUnit' = ref_unit
   ORDER BY u.id DESC LIMIT 1
$$;

-- ---- Catalogue commun ----------------------------------------------------------------------------------------------------
CREATE TEMP TABLE c030 ON COMMIT DROP AS
  SELECT 'initial'::text AS origin, i.key, i.category, i.unit AS old_unit FROM initial_catalog i
  UNION ALL SELECT 'extended', e.key, e.category, e.unit FROM extended_catalog e WHERE e.key IS NOT NULL;
INSERT INTO unit_corrections (migration, subject, ref, old_unit, new_unit, outcome)
SELECT '030', 'initial_catalog', i.key, i.unit, t.unit, 'unit_changed' FROM initial_catalog i JOIN t030 t ON t.origin = 'initial' AND t.key = i.key WHERE i.unit <> t.unit;
UPDATE initial_catalog i SET unit = t.unit FROM t030 t WHERE t.origin = 'initial' AND t.key = i.key AND i.unit <> t.unit;
INSERT INTO unit_corrections (migration, subject, ref, old_unit, new_unit, outcome)
SELECT '030', 'extended_catalog', e.key, e.unit, t.unit, 'unit_changed' FROM extended_catalog e JOIN t030 t ON t.origin = 'extended' AND t.key = e.key WHERE e.unit IS DISTINCT FROM t.unit;
UPDATE extended_catalog e SET unit = t.unit FROM t030 t WHERE t.origin = 'extended' AND t.key = e.key AND e.unit IS DISTINCT FROM t.unit;

-- ---- Produits des familles rattachés au catalogue ----------------------------------------------------------------------
CREATE TEMP TABLE p030 ON COMMIT DROP AS
  SELECT p.id, p.family_id, p.unit AS old_unit, t.unit AS new_unit, c.key, p.format,
         p.unit = c.old_unit
           OR p.unit = CASE WHEN c.category IN ('legumes','fruits','viandes') THEN 'kg' WHEN c.category = 'boissons' THEN 'bouteille'
                            WHEN c.category IN ('epicerie','surgeles') THEN 'paquet' ELSE 'piece' END
           OR (c.key IN ('persil','coriandre','menthe') AND p.unit = 'paquet') OR (c.key = 'ail' AND p.unit = 'piece') AS from_catalogue
    FROM products p
    JOIN c030 c ON (c.origin = 'initial' AND c.key = p.catalog_key)
               OR (c.origin = 'extended' AND c.key = (SELECT e.key FROM extended_catalog e WHERE e.id = p.extended_id))
    JOIN t030 t ON t.origin = c.origin AND t.key = c.key
   WHERE p.unit <> t.unit;
INSERT INTO unit_corrections (migration, family_id, subject, ref, old_unit, new_unit, outcome)
SELECT '030', family_id, 'product', id::text, old_unit, new_unit, CASE WHEN from_catalogue THEN 'unit_changed' ELSE 'unit_kept_custom' END FROM p030;
UPDATE products p SET unit = x.new_unit FROM p030 x WHERE x.id = p.id AND x.from_catalogue;

-- ---- Prix des familles de ces produits ----------------------------------------------------------------------------------
CREATE TEMP TABLE fp030 ON COMMIT DROP AS
  SELECT f.family_id, f.product_id, x.key, x.old_unit, x.new_unit, x.format, f.amount, f.ref_qty, f.ref_unit, f.packaging, f.piece_weight_g,
         (pg_temp.conv030(x.new_unit, x.key, f.ref_qty, f.ref_unit, f.packaging)).*,
         pg_temp.origin027('family_price', f.product_id::text, f.family_id, f.amount, f.ref_qty, f.ref_unit) AS o27,
         -- format écrit d'un poids unique : « 250 g », « pot de 250 g », « 1 kg » (jamais « 10 x 7,5 g »)
         (SELECT replace(m[1], ',', '.')::numeric * CASE WHEN lower(m[2]) = 'kg' THEN 1000 ELSE 1 END
            FROM regexp_match(coalesce(x.format, ''), '^\s*(?:[[:alpha:]]+ de\s+)?(\d+(?:[.,]\d{1,2})?)\s*(g|kg)\s*$', 'i') m) AS format_g
    FROM family_prices f JOIN p030 x ON x.id = f.product_id AND x.from_catalogue
   WHERE NOT pg_temp.fits030(x.new_unit, f.ref_unit, f.piece_weight_g);
CREATE TEMP TABLE fpr030 ON COMMIT DROP AS
  SELECT family_id, product_id, old_unit, new_unit, amount, ref_qty, ref_unit, packaging, piece_weight_g,
         CASE WHEN unit IS NOT NULL THEN qty
              WHEN new_unit = 'piece' AND o27 IS NOT NULL THEN (o27->>'refQty')::numeric
              WHEN new_unit = 'piece' AND ref_unit IN ('kg', 'g') AND format_g IS NOT NULL THEN ref_qty END AS n_qty,
         CASE WHEN unit IS NOT NULL THEN unit
              WHEN new_unit = 'piece' AND o27 IS NOT NULL THEN 'piece'
              WHEN new_unit = 'piece' AND ref_unit IN ('kg', 'g') AND format_g IS NOT NULL THEN ref_unit END AS n_unit,
         CASE WHEN unit IS NOT NULL THEN pack
              WHEN new_unit = 'piece' AND o27 IS NOT NULL THEN o27->>'packaging'
              ELSE packaging END AS n_pack,
         CASE WHEN unit IS NULL AND o27 IS NULL AND new_unit = 'piece' AND ref_unit IN ('kg', 'g') AND format_g IS NOT NULL THEN format_g END AS n_w
    FROM fp030;
INSERT INTO unit_corrections (migration, family_id, subject, ref, old_unit, new_unit, old_value, new_value, outcome)
SELECT '030', family_id, 'family_price', product_id::text, old_unit, new_unit,
       jsonb_build_object('amount', amount, 'refQty', ref_qty, 'refUnit', ref_unit, 'packaging', packaging, 'pieceWeightG', piece_weight_g),
       CASE WHEN n_unit IS NOT NULL THEN jsonb_build_object('amount', amount, 'refQty', n_qty, 'refUnit', n_unit, 'packaging', n_pack, 'pieceWeightG', n_w) END,
       CASE WHEN n_unit IS NOT NULL THEN 'price_converted' ELSE 'price_to_confirm' END
  FROM fpr030;
UPDATE family_prices f SET ref_qty = x.n_qty, ref_unit = x.n_unit, packaging = x.n_pack, piece_weight_g = x.n_w
  FROM fpr030 x WHERE x.family_id = f.family_id AND x.product_id = f.product_id AND x.n_unit IS NOT NULL;

-- ---- Base commune des prix (montants et dates conservés) ----------------------------------------------------------------
CREATE TEMP TABLE bp030 ON COMMIT DROP AS
  SELECT b.origin, b.key, t.unit AS new_unit, b.amount, b.ref_qty, b.ref_unit, b.packaging, b.piece_weight_g,
         (pg_temp.conv030(t.unit, b.key, b.ref_qty, b.ref_unit, b.packaging)).*,
         pg_temp.origin027('base_price', b.origin || ':' || b.key, NULL, b.amount, b.ref_qty, b.ref_unit) AS o27
    FROM base_prices b JOIN t030 t ON t.origin = b.origin AND t.key = b.key
   WHERE NOT pg_temp.fits030(t.unit, b.ref_unit, b.piece_weight_g);
CREATE TEMP TABLE bpr030 ON COMMIT DROP AS
  SELECT origin, key, new_unit, amount, ref_qty, ref_unit, packaging, piece_weight_g,
         CASE WHEN unit IS NOT NULL THEN qty WHEN new_unit = 'piece' AND o27 IS NOT NULL THEN (o27->>'refQty')::numeric END AS n_qty,
         CASE WHEN unit IS NOT NULL THEN unit WHEN new_unit = 'piece' AND o27 IS NOT NULL THEN 'piece' END AS n_unit,
         CASE WHEN unit IS NOT NULL THEN pack WHEN new_unit = 'piece' AND o27 IS NOT NULL THEN o27->>'packaging' ELSE packaging END AS n_pack
    FROM bp030;
INSERT INTO unit_corrections (migration, subject, ref, old_unit, new_unit, old_value, new_value, outcome)
SELECT '030', 'base_price', origin || ':' || key, ref_unit, new_unit,
       jsonb_build_object('amount', amount, 'refQty', ref_qty, 'refUnit', ref_unit, 'packaging', packaging, 'pieceWeightG', piece_weight_g),
       CASE WHEN n_unit IS NOT NULL THEN jsonb_build_object('amount', amount, 'refQty', n_qty, 'refUnit', n_unit, 'packaging', n_pack, 'pieceWeightG', NULL) END,
       CASE WHEN n_unit IS NOT NULL THEN 'price_converted' ELSE 'price_to_confirm' END
  FROM bpr030;
UPDATE base_prices b SET ref_qty = x.n_qty, ref_unit = x.n_unit, packaging = x.n_pack, piece_weight_g = NULL
  FROM bpr030 x WHERE x.origin = b.origin AND x.key = b.key AND x.n_unit IS NOT NULL;

-- ---- Format de référence du Sucre (APRÈS les prix : seul un format saisi par la famille peut servir à une conversion ;
-- le format de référence n'en déclenche jamais, et 5,20 DH/kg n'est jamais transformé en prix du paquet).
-- Sucre (« sucre granulé ») : paquet de 2 kg. Le prix relevé sur la capture (9,95 DH le paquet) reste un relevé, non importé
-- (date de prise de vue inconnue) ; le prix commun de 5,20 DH/kg n'est jamais réutilisé comme prix à la pièce.
UPDATE initial_catalog SET format = 'paquet de 2 kg' WHERE key = 'sucre' AND format IS NULL;
INSERT INTO unit_corrections (migration, family_id, subject, ref, old_value, new_value, outcome)
SELECT '030', p.family_id, 'product', p.id::text, jsonb_build_object('format', p.format), jsonb_build_object('format', 'paquet de 2 kg'), 'format_set'
  FROM products p WHERE p.catalog_key = 'sucre' AND p.format IS NULL;
UPDATE products SET format = 'paquet de 2 kg' WHERE catalog_key = 'sucre' AND format IS NULL;

-- Tous les téléphones relisent le catalogue (unités, noms, prix).
UPDATE families SET catalog_rev = catalog_rev + 1;
