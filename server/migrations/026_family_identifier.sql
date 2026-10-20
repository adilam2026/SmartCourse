-- Identifiant famille de connexion (choisi par l'administrateur) et codes d'accès provisoires des nouveaux membres.
-- Migration ADDITIVE : aucune colonne existante modifiée, aucune donnée réécrite. L'ancien serveur ignore ces ajouts.

-- Espace de noms UNIQUE de tout ce qui désigne une famille à la connexion : son code famille d'origine (8 caractères),
-- son identifiant actuel et ses anciens identifiants (alias permanents). La clé est l'empreinte SHA-256 du nom en minuscules :
--   * unicité insensible à la casse garantie par la base, même pour des demandes simultanées (clé primaire) ;
--   * un code ou un identifiant n'est jamais réattribué : à la suppression d'une famille, seule l'empreinte reste (nom effacé).
CREATE TABLE family_aliases (
  alias_hash  bytea PRIMARY KEY CHECK (length(alias_hash) = 32),
  alias       text CHECK (alias IS NULL OR alias ~ '^[A-Za-z0-9_]{4,30}$'),
  family_id   uuid REFERENCES families(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('code', 'current', 'former')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX family_aliases_family_idx ON family_aliases (family_id);
-- Un seul identifiant actuel par famille.
CREATE UNIQUE INDEX family_aliases_one_current ON family_aliases (family_id) WHERE kind = 'current';

-- Codes famille existants : réservés dans le même espace (ils restent un moyen de connexion permanent).
INSERT INTO family_aliases (alias_hash, alias, family_id, kind)
SELECT sha256(convert_to(lower(code), 'UTF8')), code, id, 'code' FROM families
ON CONFLICT (alias_hash) DO NOTHING;

-- Identifiant choisi pendant la création de la famille (vérifié de nouveau au moment de créer).
ALTER TABLE family_signups ADD COLUMN family_login_id text CHECK (family_login_id IS NULL OR family_login_id ~ '^[A-Za-z0-9_]{4,30}$');

-- Code d'accès provisoire d'un nouveau membre : valable jusqu'à secret_expires_at, utilisable une seule fois (secret_used_at),
-- remplacé par le code que la personne choisit à sa première connexion. Les profils existants ne sont pas concernés (false).
ALTER TABLE profiles ADD COLUMN secret_temporary boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN secret_expires_at timestamptz;
ALTER TABLE profiles ADD COLUMN secret_used_at timestamptz;
