-- Espace plateforme (consultation seulement) : « Photos manquantes » et « Usage de l'application ».
-- Le droit est attribué à l'identifiant INTERNE d'un profil, lié à SA famille (clé étrangère composée : impossible de rattacher
-- un profil à une autre famille). Attribution et retrait seulement côté serveur (admin-cli platform-grant / platform-revoke),
-- journalisés. Aucun rôle de famille ne donne ce droit. Personne ne l'a après cette migration.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_id_family ON profiles (id, family_id);

CREATE TABLE platform_admins (
  profile_id uuid PRIMARY KEY,
  family_id  uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  note       text CHECK (note IS NULL OR char_length(note) <= 200),
  FOREIGN KEY (profile_id, family_id) REFERENCES profiles (id, family_id) ON DELETE CASCADE
);

CREATE TABLE platform_admins_history (
  id         bigserial PRIMARY KEY,
  profile_id uuid NOT NULL,
  family_id  uuid NOT NULL,
  action     text NOT NULL CHECK (action IN ('grant', 'revoke')),
  note       text CHECK (note IS NULL OR char_length(note) <= 200),
  at         timestamptz NOT NULL DEFAULT now()
);

-- Familles exclues des statistiques et des photos manquantes (démonstration, vérification des stores, recette, interne).
-- Liste EXPLICITE (aucun marqueur fiable n'existe dans les données) : admin-cli platform-exclude / platform-include.
CREATE TABLE platform_excluded_families (
  family_id uuid PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  reason    text NOT NULL CHECK (reason IN ('demo', 'verification', 'recette', 'interne')),
  added_at  timestamptz NOT NULL DEFAULT now()
);
