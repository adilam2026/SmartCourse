-- Pays et ville DE LA FAMILLE (les membres en héritent). Migration additive : aucune donnée existante n'est modifiée ni supprimée.
-- Les familles existantes restent sans pays tant qu'un administrateur ne l'a pas confirmé (le Maroc n'est jamais supposé) ;
-- l'application propose alors un préremplissage, seulement depuis une ville reconnue.
ALTER TABLE families ADD COLUMN country text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
ALTER TABLE families ADD COLUMN city text CHECK (city IS NULL OR char_length(city) BETWEEN 1 AND 60);
ALTER TABLE families ADD COLUMN location_confirmed_at timestamptz;
ALTER TABLE families ADD CONSTRAINT families_city_needs_morocco CHECK (city IS NULL OR country = 'MA');

-- Création autonome : le pays est demandé ; la ville seulement pour le Maroc.
ALTER TABLE family_signups ADD COLUMN country text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
ALTER TABLE family_signups ALTER COLUMN city DROP NOT NULL;
