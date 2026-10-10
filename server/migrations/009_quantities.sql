-- Quantités, unités, validations datées et événements de liste.
-- Compatible avec les données existantes : aucune ligne n'est supprimée, les colonnes ajoutées ont une valeur par défaut,
-- l'historique existant reçoit un événement « ajout » à la date d'ajout d'origine.

-- ---- Unité par produit : pièce, paquet, bouteille ou kg ---------------------------------------------------------
ALTER TABLE initial_catalog ADD COLUMN unit text NOT NULL DEFAULT 'piece' CHECK (unit IN ('piece','paquet','bouteille','kg'));
ALTER TABLE products        ADD COLUMN unit text NOT NULL DEFAULT 'piece' CHECK (unit IN ('piece','paquet','bouteille','kg'));

-- Valeurs de départ raisonnables (modifiables article par article dans Réglages → Catalogue).
UPDATE initial_catalog SET unit = CASE
  WHEN key IN ('persil','coriandre','menthe') THEN 'paquet'
  WHEN key = 'ail' THEN 'piece'
  WHEN category IN ('legumes','fruits','viandes') THEN 'kg'
  WHEN category = 'boissons' THEN 'bouteille'
  WHEN category IN ('epicerie','surgeles') THEN 'paquet'
  ELSE 'piece' END;
UPDATE products p SET unit = i.unit FROM initial_catalog i WHERE i.key = p.catalog_key;
UPDATE products SET unit = CASE
  WHEN category IN ('legumes','fruits','viandes') THEN 'kg'
  WHEN category = 'boissons' THEN 'bouteille'
  WHEN category IN ('epicerie','surgeles') THEN 'paquet'
  ELSE 'piece' END
 WHERE catalog_key IS NULL;

-- ---- Lignes de liste : quantité demandée et unité (unité figée à l'ajout) ----------------------------------------
ALTER TABLE list_items ADD COLUMN quantity numeric(8,3) NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 999);
ALTER TABLE list_items ADD COLUMN unit text NOT NULL DEFAULT 'piece' CHECK (unit IN ('piece','paquet','bouteille','kg'));

-- Achats : produit, quantité et unité figés au moment de l'achat (NULL = achat antérieur à cette fonction : quantité inconnue).
ALTER TABLE purchases ADD COLUMN product_id uuid REFERENCES products(id);
ALTER TABLE purchases ADD COLUMN quantity numeric(8,3) CHECK (quantity IS NULL OR quantity > 0);
ALTER TABLE purchases ADD COLUMN unit text CHECK (unit IS NULL OR unit IN ('piece','paquet','bouteille','kg'));

-- Les listes archivées sont verrouillées par des déclencheurs : on les suspend le temps de cette migration seulement.
ALTER TABLE list_items DISABLE TRIGGER list_items_archived_guard;
ALTER TABLE purchases DISABLE TRIGGER purchases_archived_guard;
UPDATE list_items i SET unit = p.unit FROM products p WHERE p.id = i.product_id;
UPDATE purchases pu SET product_id = i.product_id FROM list_items i WHERE i.id = pu.list_item_id;
ALTER TABLE purchases ALTER COLUMN product_id SET NOT NULL;
ALTER TABLE list_items ENABLE TRIGGER list_items_archived_guard;
ALTER TABLE purchases ENABLE TRIGGER purchases_archived_guard;
CREATE INDEX purchases_stats_idx ON purchases (family_id, purchased_at) WHERE voided_at IS NULL;

-- ---- Une demande après achat est une NOUVELLE ligne : plusieurs lignes « achetées » + une seule ligne ouverte par produit ----
-- « corrected » : ligne achetée dont l'achat a été corrigé alors qu'une nouvelle demande du même produit existait ; sa quantité a été
-- reportée sur la ligne ouverte et la ligne n'apparaît plus (comme « removed »).
ALTER TYPE item_status ADD VALUE 'corrected';
ALTER TABLE list_items DROP CONSTRAINT list_items_list_id_product_id_key;
CREATE UNIQUE INDEX list_items_one_open_per_product ON list_items (list_id, product_id) WHERE status IN ('to_buy','removed');

-- ---- Validations (un appui sur « Valider » = un groupe, avec auteur et heure) et événements -----------------------
CREATE TABLE validations (
  id          uuid PRIMARY KEY,                                  -- identifiant du lot, créé par l'appareil (rejouable sans doublon)
  list_id     uuid NOT NULL REFERENCES lists(id),
  family_id   uuid NOT NULL REFERENCES families(id),
  actor_id    uuid NOT NULL REFERENCES profiles(id),
  at          timestamptz NOT NULL,                              -- moment où la personne a validé (horloge de l'appareil, bornée)
  received_at timestamptz NOT NULL DEFAULT now()                 -- moment où le serveur l'a reçu
);
CREATE INDEX validations_list_idx ON validations (list_id, at);

CREATE TABLE list_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigint GENERATED ALWAYS AS IDENTITY,
  list_id       uuid NOT NULL REFERENCES lists(id),
  family_id     uuid NOT NULL REFERENCES families(id),
  item_id       uuid NOT NULL REFERENCES list_items(id),
  product_id    uuid NOT NULL REFERENCES products(id),
  validation_id uuid NOT NULL REFERENCES validations(id),
  kind          text NOT NULL CHECK (kind IN ('add','qty','remove','request_again')),
  qty_before    numeric(8,3),
  qty_after     numeric(8,3),
  unit          text NOT NULL CHECK (unit IN ('piece','paquet','bouteille','kg')),
  actor_id      uuid NOT NULL REFERENCES profiles(id),
  at            timestamptz NOT NULL
);
CREATE INDEX list_events_list_idx ON list_events (list_id, seq);
CREATE INDEX list_events_item_idx ON list_events (item_id, seq);

-- Historique existant : un « ajout » par article, groupé par (liste, auteur, minute) à la date d'ajout d'origine.
INSERT INTO validations (id, list_id, family_id, actor_id, at, received_at)
SELECT gen_random_uuid(), list_id, family_id, added_by, date_trunc('minute', added_at), date_trunc('minute', added_at)
  FROM list_items WHERE status <> 'removed'
 GROUP BY list_id, family_id, added_by, date_trunc('minute', added_at);
INSERT INTO list_events (list_id, family_id, item_id, product_id, validation_id, kind, qty_before, qty_after, unit, actor_id, at)
SELECT i.list_id, i.family_id, i.id, i.product_id, v.id, 'add', NULL, 1, i.unit, i.added_by, i.added_at
  FROM list_items i
  JOIN validations v ON v.list_id = i.list_id AND v.actor_id = i.added_by AND v.at = date_trunc('minute', i.added_at)
 WHERE i.status <> 'removed';

-- Journal en ajout seulement : un événement ou une validation ne se modifie ni ne s'efface.
CREATE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% est en ajout seulement (% interdit)', TG_TABLE_NAME, TG_OP;
END $$;
CREATE TRIGGER validations_append_only BEFORE UPDATE OR DELETE ON validations FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER list_events_append_only BEFORE UPDATE OR DELETE ON list_events FOR EACH ROW EXECUTE FUNCTION append_only();
-- Liste clôturée = immuable, y compris son journal.
CREATE TRIGGER validations_archived_guard BEFORE INSERT ON validations FOR EACH ROW EXECUTE FUNCTION forbid_archived_list_change();
CREATE TRIGGER list_events_archived_guard BEFORE INSERT ON list_events FOR EACH ROW EXECUTE FUNCTION forbid_archived_list_change();
