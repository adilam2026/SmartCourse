-- Catalogue revision per family: a counter that changes whenever one of the family's products is added, changed
-- (name, category, brand, active, picture, position) or removed. Clients compare it with the revision of the catalogue
-- they hold and only download the (≈ 15 KB) catalogue when it differs: the periodic read costs a few hundred bytes.
ALTER TABLE families ADD COLUMN catalog_rev bigint NOT NULL DEFAULT 0;

CREATE FUNCTION bump_catalog_rev() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE families SET catalog_rev = catalog_rev + 1 WHERE id = coalesce(NEW.family_id, OLD.family_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER products_bump_catalog_rev
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION bump_catalog_rev();
