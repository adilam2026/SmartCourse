-- Mise à jour de l'application Android : version conseillée et version minimale autorisée, réglées par les gestionnaires
-- (page /gestion/mise-a-jour) sans redéploiement ni nouvelle application. DÉSACTIVÉES par défaut : aucune version n'est conseillée
-- ni exigée tant qu'un gestionnaire ne l'a pas décidé. Toute modification est journalisée.

CREATE TABLE app_update_policy (
  platform        text PRIMARY KEY CHECK (platform = 'android'),
  latest_code     integer CHECK (latest_code IS NULL OR latest_code > 0),   -- « Mise à jour conseillée » en dessous (versionCode)
  min_code        integer CHECK (min_code IS NULL OR min_code > 0),         -- « Mise à jour obligatoire » en dessous (versionCode)
  store_url       text NOT NULL,
  updated_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Jamais exiger plus que la version publiée et conseillée.
  CHECK (min_code IS NULL OR (latest_code IS NOT NULL AND min_code <= latest_code))
);
INSERT INTO app_update_policy (platform, store_url) VALUES ('android', 'https://play.google.com/store/apps/details?id=app.smartcourse.courses.natif');

CREATE TABLE app_update_history (
  id           bigserial PRIMARY KEY,
  platform     text NOT NULL,
  latest_code  integer,
  min_code     integer,
  changed_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  note         text CHECK (note IS NULL OR char_length(note) <= 200)
);
