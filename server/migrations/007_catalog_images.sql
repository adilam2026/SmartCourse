-- Provenance of generated images, idempotent catalogue sync, controlled purge, archive snapshot of the category.

ALTER TABLE photo_assets ADD COLUMN source_sha256 text;                    -- sha256 of the ORIGINAL input file
ALTER TABLE photo_assets ADD COLUMN generated boolean NOT NULL DEFAULT false;  -- "Image générée avec ChatGPT": no external licence claimed
CREATE INDEX photo_assets_source_sha_idx ON photo_assets (source_sha256) WHERE source_sha256 IS NOT NULL;

-- Photos stay immutable: no UPDATE, ever. DELETE is refused too, except inside the purge routine, which sets
-- app.photo_purge for its own transaction and only deletes assets that nothing references.
CREATE OR REPLACE FUNCTION photo_assets_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.photo_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'photo_assets est immuable (% interdit)', TG_OP;
END $$;

-- "Is this image still used?" must be cheap: index every reference.
CREATE INDEX products_photo_idx ON products (photo_asset_id) WHERE photo_asset_id IS NOT NULL;
CREATE INDEX extended_catalog_photo_idx ON extended_catalog (photo_asset_id) WHERE photo_asset_id IS NOT NULL;
CREATE INDEX list_items_snapshot_photo_idx ON list_items (snapshot_photo_asset_id) WHERE snapshot_photo_asset_id IS NOT NULL;
CREATE INDEX initial_catalog_photo_idx ON initial_catalog (photo_asset_id) WHERE photo_asset_id IS NOT NULL;

-- A closed list keeps the category it had at closing (renaming/moving a product later must not rewrite history).
ALTER TABLE list_items ADD COLUMN snapshot_category text REFERENCES categories(key);
