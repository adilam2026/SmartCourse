-- Achats ouverts PAR PLATEFORME (Android, iPhone), indépendamment : ouverture et fermeture explicites (admin-cli), journalisées.
-- Une famille n'est bloquée par la règle des listes gratuites que si au moins un de ses ADMINISTRATEURS utilise un appareil qui
-- permet d'acheter : plateforme ouverte ET version de l'application au moins égale à la première version qui sait acheter.
-- Sinon la famille continue de créer ses listes (le compteur continue de compter) : personne n'est bloqué sans solution.
-- Rien n'est ouvert par cette migration.
CREATE TABLE purchase_platforms (
  platform          text PRIMARY KEY CHECK (platform IN ('android', 'ios')),
  enabled           boolean NOT NULL DEFAULT false,
  min_version       integer CHECK (min_version IS NULL OR min_version > 0),  -- versionCode Android / numéro de build iPhone
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR min_version IS NOT NULL)
);
INSERT INTO purchase_platforms (platform) VALUES ('android'), ('ios');

CREATE TABLE purchase_platforms_history (
  id          bigserial PRIMARY KEY,
  platform    text NOT NULL,
  enabled     boolean NOT NULL,
  min_version integer,
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

-- Appareils utilisés par chaque profil (plateforme, numéro technique de version), transmis par l'application à chaque requête.
-- Aucune donnée personnelle de l'appareil : seulement « android » / « ios » et un numéro de version.
CREATE TABLE profile_clients (
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  platform   text NOT NULL CHECK (platform IN ('android', 'ios')),
  version    integer NOT NULL CHECK (version >= 0),
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, platform)
);
