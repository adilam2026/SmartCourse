-- Généré par scripts/gen-catalog-sql.py — 80 produits exacts du cahier des charges.
CREATE TABLE categories (
  key       text PRIMARY KEY,
  label     text NOT NULL,
  position  integer NOT NULL
);

CREATE TABLE photo_assets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_family_id      uuid REFERENCES families(id),   -- NULL = photo commune (catalogue initial / étendu)
  storage_key          text NOT NULL,
  content_hash         text NOT NULL,
  mime                 text NOT NULL,
  width                integer NOT NULL,
  height               integer NOT NULL,
  bytes                integer NOT NULL,
  source_name          text NOT NULL,
  source_url           text,
  license              text NOT NULL,
  license_url          text,
  author               text,
  attribution_required boolean NOT NULL DEFAULT false,
  attribution_text     text,
  imported_at          timestamptz NOT NULL DEFAULT now(),
  imported_by          uuid REFERENCES profiles(id)
);

-- Une photo est immuable : on n'en modifie jamais une, on en ajoute une nouvelle.
CREATE FUNCTION photo_assets_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'photo_assets est immuable (% interdit)', TG_OP;
END $$;
CREATE TRIGGER photo_assets_no_update BEFORE UPDATE OR DELETE ON photo_assets
  FOR EACH ROW EXECUTE FUNCTION photo_assets_immutable();

CREATE TABLE initial_catalog (
  key            text PRIMARY KEY,
  category       text NOT NULL REFERENCES categories(key),
  name           text NOT NULL,
  position       integer NOT NULL,
  photo_asset_id uuid REFERENCES photo_assets(id)
);

CREATE TABLE extended_catalog (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category       text NOT NULL REFERENCES categories(key),
  name           text NOT NULL,
  brand          text,
  search_text    text NOT NULL,
  photo_asset_id uuid REFERENCES photo_assets(id),
  source         text NOT NULL DEFAULT 'manual'
);
CREATE INDEX extended_catalog_search_idx ON extended_catalog (search_text text_pattern_ops);

CREATE TABLE products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      uuid NOT NULL REFERENCES families(id),
  category       text NOT NULL REFERENCES categories(key),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  brand          text CHECK (brand IS NULL OR length(brand) BETWEEN 1 AND 40),
  active         boolean NOT NULL DEFAULT true,
  photo_asset_id uuid REFERENCES photo_assets(id),
  catalog_key    text REFERENCES initial_catalog(key),
  extended_id    uuid REFERENCES extended_catalog(id),
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Un même produit (nom + marque) ne peut exister qu'une fois par famille. Pas de DELETE : l'historique référence products.id.
CREATE UNIQUE INDEX products_identity_idx ON products (family_id, lower(name), coalesce(lower(brand), ''));
CREATE INDEX products_family_idx ON products (family_id, category, position);

INSERT INTO categories (key,label,position) VALUES
  ('legumes','Légumes et herbes',0),
  ('fruits','Fruits',1),
  ('laitages','Laitages et œufs',2),
  ('epicerie','Épicerie',3),
  ('viandes','Viandes et poisson',4),
  ('surgeles','Surgelés',5),
  ('pain','Pain et petit-déjeuner',6),
  ('boissons','Boissons',7),
  ('maison','Maison',8),
  ('hygiene','Hygiène',9);
INSERT INTO initial_catalog (key,category,name,position) VALUES
  ('tomates','legumes','Tomates',0),
  ('pommes-de-terre','legumes','Pommes de terre',1),
  ('oignons','legumes','Oignons',2),
  ('carottes','legumes','Carottes',3),
  ('courgettes','legumes','Courgettes',4),
  ('concombres','legumes','Concombres',5),
  ('poivrons-verts','legumes','Poivrons verts',6),
  ('poivrons-rouges','legumes','Poivrons rouges',7),
  ('aubergines','legumes','Aubergines',8),
  ('haricots-verts','legumes','Haricots verts',9),
  ('laitue','legumes','Laitue',10),
  ('ail','legumes','Ail',11),
  ('persil','legumes','Persil',12),
  ('coriandre','legumes','Coriandre',13),
  ('menthe','legumes','Menthe',14),
  ('bananes','fruits','Bananes',0),
  ('pommes','fruits','Pommes',1),
  ('oranges','fruits','Oranges',2),
  ('clementines','fruits','Clémentines',3),
  ('citrons','fruits','Citrons',4),
  ('fraises','fruits','Fraises',5),
  ('raisins','fruits','Raisins',6),
  ('avocats','fruits','Avocats',7),
  ('poires','fruits','Poires',8),
  ('fruits-de-saison','fruits','Fruits de saison',9),
  ('lait','laitages','Lait',0),
  ('beurre','laitages','Beurre',1),
  ('fromage-en-portions','laitages','Fromage en portions',2),
  ('fromage-a-tartiner','laitages','Fromage à tartiner',3),
  ('fromage-rape','laitages','Fromage râpé',4),
  ('yaourt-nature','laitages','Yaourt nature',5),
  ('yaourt-aromatise','laitages','Yaourt aromatisé',6),
  ('yaourt-a-boire','laitages','Yaourt à boire',7),
  ('creme-fraiche','laitages','Crème fraîche',8),
  ('oeufs','laitages','Œufs',9),
  ('huile-de-table','epicerie','Huile de table',0),
  ('huile-d-olive','epicerie','Huile d’olive',1),
  ('sucre','epicerie','Sucre',2),
  ('farine','epicerie','Farine',3),
  ('semoule-fine','epicerie','Semoule fine',4),
  ('riz','epicerie','Riz',5),
  ('pates','epicerie','Pâtes',6),
  ('vermicelles','epicerie','Vermicelles',7),
  ('lentilles','epicerie','Lentilles',8),
  ('pois-chiches','epicerie','Pois chiches',9),
  ('concentre-de-tomates','epicerie','Concentré de tomates',10),
  ('sel','epicerie','Sel',11),
  ('poivre','epicerie','Poivre',12),
  ('cumin','epicerie','Cumin',13),
  ('levure-chimique','epicerie','Levure chimique',14),
  ('poulet','viandes','Poulet',0),
  ('viande-hachee','viandes','Viande hachée',1),
  ('viande-de-boeuf','viandes','Viande de bœuf',2),
  ('poisson','viandes','Poisson',3),
  ('thon-en-conserve','viandes','Thon en conserve',4),
  ('petits-pois-surgeles','surgeles','Petits pois surgelés',0),
  ('frites-surgelees','surgeles','Frites surgelées',1),
  ('pain-de-mie','pain','Pain de mie',0),
  ('pain','pain','Pain',1),
  ('confiture','pain','Confiture',2),
  ('miel','pain','Miel',3),
  ('cafe','pain','Café',4),
  ('the','pain','Thé',5),
  ('eau-minerale','boissons','Eau minérale',0),
  ('jus-de-fruits','boissons','Jus de fruits',1),
  ('liquide-vaisselle','maison','Liquide vaisselle',0),
  ('lessive','maison','Lessive',1),
  ('assouplissant','maison','Assouplissant',2),
  ('eau-de-javel','maison','Eau de Javel',3),
  ('nettoyant-sol','maison','Nettoyant sol',4),
  ('papier-toilette','maison','Papier toilette',5),
  ('essuie-tout','maison','Essuie-tout',6),
  ('sacs-poubelle','maison','Sacs-poubelle',7),
  ('eponges','maison','Éponges',8),
  ('savon-liquide','hygiene','Savon liquide',0),
  ('dentifrice','hygiene','Dentifrice',1),
  ('shampooing','hygiene','Shampooing',2),
  ('gel-douche','hygiene','Gel douche',3),
  ('mouchoirs-en-papier','hygiene','Mouchoirs en papier',4),
  ('lingettes','hygiene','Lingettes',5);
