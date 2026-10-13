-- Création de famille autonome depuis l'application (sans jeton d'installation) :
-- une demande est d'abord enregistrée, un code à 6 chiffres est envoyé à l'adresse ; la famille n'est créée qu'à la
-- vérification de ce code. Aucune donnée existante n'est modifiée.
CREATE TABLE family_signups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identifiant choisi par l'application pour cette demande : un double appui renvoie la même demande (aucun doublon).
  request_id       uuid NOT NULL UNIQUE,
  email            text NOT NULL CHECK (length(email) BETWEEN 5 AND 254),
  email_hash       text NOT NULL,
  ip_hash          text,
  family_name      text NOT NULL,
  display_name     text NOT NULL,
  login            text NOT NULL,
  city             text NOT NULL,
  secret_hash      text NOT NULL,
  code_hash        text NOT NULL,
  attempts         int NOT NULL DEFAULT 0,
  sends            int NOT NULL DEFAULT 1,
  last_sent_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  -- Remplacée par une demande plus récente pour la même adresse, ou abandonnée (trop d'essais) : plus utilisable.
  superseded_at    timestamptz,
  completed_at     timestamptz,
  family_id        uuid REFERENCES families(id) ON DELETE SET NULL,
  profile_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX family_signups_email_idx ON family_signups (email_hash, created_at);
CREATE INDEX family_signups_ip_idx ON family_signups (ip_hash, created_at);
CREATE INDEX family_signups_created_idx ON family_signups (created_at);
-- Une seule demande en attente par adresse (la plus récente) : deux demandes concurrentes ne créent jamais deux familles.
CREATE UNIQUE INDEX family_signups_one_open ON family_signups (email_hash) WHERE completed_at IS NULL AND superseded_at IS NULL;

ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_kind_check;
ALTER TABLE email_log ADD CONSTRAINT email_log_kind_check CHECK (kind IN ('verify_email', 'reset_password', 'family_code', 'test', 'signup_code'));
