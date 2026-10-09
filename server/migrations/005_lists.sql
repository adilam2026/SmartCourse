CREATE TYPE list_status AS ENUM ('active', 'archived');
CREATE TYPE item_status AS ENUM ('to_buy', 'purchased', 'removed');

CREATE TABLE lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES families(id),
  status      list_status NOT NULL DEFAULT 'active',
  created_by  uuid NOT NULL REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_by   uuid REFERENCES profiles(id),
  closed_at   timestamptz,
  CHECK ((status = 'archived') = (closed_at IS NOT NULL AND closed_by IS NOT NULL))
);
-- Une seule liste active par famille, garantie par la base.
CREATE UNIQUE INDEX lists_one_active_per_family ON lists (family_id) WHERE status = 'active';
CREATE INDEX lists_family_closed_idx ON lists (family_id, closed_at DESC) WHERE status = 'archived';

CREATE TABLE list_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id                 uuid NOT NULL REFERENCES lists(id),
  family_id               uuid NOT NULL REFERENCES families(id),
  product_id              uuid NOT NULL REFERENCES products(id),
  status                  item_status NOT NULL DEFAULT 'to_buy',
  rev                     integer NOT NULL DEFAULT 1,
  added_by                uuid NOT NULL REFERENCES profiles(id),
  added_at                timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  snapshot_name           text,
  snapshot_brand          text,
  snapshot_photo_asset_id uuid REFERENCES photo_assets(id),
  UNIQUE (list_id, product_id)   -- un produit n'apparaît qu'une fois dans une liste
);
CREATE INDEX list_items_list_idx ON list_items (list_id);

CREATE TABLE purchases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_item_id  uuid NOT NULL REFERENCES list_items(id),
  list_id       uuid NOT NULL REFERENCES lists(id),
  family_id     uuid NOT NULL REFERENCES families(id),
  purchased_by  uuid NOT NULL REFERENCES profiles(id),
  purchased_at  timestamptz NOT NULL DEFAULT now(),
  voided_by     uuid REFERENCES profiles(id),
  voided_at     timestamptz,
  void_reason   text CHECK (void_reason IS NULL OR length(void_reason) <= 300),
  CHECK ((voided_at IS NULL) = (voided_by IS NULL))
);
-- Au plus un achat non corrigé par article.
CREATE UNIQUE INDEX purchases_one_open_per_item ON purchases (list_item_id) WHERE voided_at IS NULL;
CREATE INDEX purchases_list_idx ON purchases (list_id);

-- Journal d'idempotence : rejouer une opération (même profil, même op_id) renvoie le résultat d'origine.
CREATE TABLE op_log (
  profile_id  uuid NOT NULL REFERENCES profiles(id),
  op_id       uuid NOT NULL,
  type        text NOT NULL,
  list_id     uuid REFERENCES lists(id),
  result      jsonb,
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, op_id)
);

-- Défense en profondeur : une liste archivée n'est plus modifiable, même par du SQL direct.
-- (La clôture écrit les figés AVANT de passer la liste en « archived ».)
CREATE FUNCTION forbid_archived_list_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st  list_status;
  lid uuid;
BEGIN
  IF TG_TABLE_NAME = 'lists' THEN
    IF OLD.status = 'archived' THEN
      RAISE EXCEPTION 'liste archivée : modification interdite';
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN lid := OLD.list_id; ELSE lid := NEW.list_id; END IF;
    SELECT status INTO st FROM lists WHERE id = lid;
    IF st = 'archived' THEN
      RAISE EXCEPTION 'liste archivée : modification interdite (%)', TG_TABLE_NAME;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER lists_archived_guard BEFORE UPDATE OR DELETE ON lists
  FOR EACH ROW EXECUTE FUNCTION forbid_archived_list_change();
CREATE TRIGGER list_items_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON list_items
  FOR EACH ROW EXECUTE FUNCTION forbid_archived_list_change();
CREATE TRIGGER purchases_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON purchases
  FOR EACH ROW EXECUTE FUNCTION forbid_archived_list_change();
