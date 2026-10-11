-- Protection de l'administrateur principal, adresse de récupération vérifiée, jetons à usage unique, journal des e-mails.
-- Aucune donnée existante n'est modifiée en dehors des nouvelles colonnes ; les codes à 6 chiffres actuels restent valides.

ALTER TABLE profiles ADD COLUMN is_primary boolean NOT NULL DEFAULT false;
-- L'administrateur principal d'une famille existante = son plus ancien administrateur.
UPDATE profiles p SET is_primary = true
 WHERE p.id = (SELECT x.id FROM profiles x WHERE x.family_id = p.family_id AND x.role = 'admin' ORDER BY x.created_at, x.id LIMIT 1);
CREATE UNIQUE INDEX profiles_one_primary_idx ON profiles (family_id) WHERE is_primary;

ALTER TABLE profiles ADD COLUMN recovery_email text CHECK (recovery_email IS NULL OR length(recovery_email) BETWEEN 5 AND 254);
ALTER TABLE profiles ADD COLUMN recovery_email_verified_at timestamptz;
CREATE INDEX profiles_recovery_email_idx ON profiles (lower(recovery_email)) WHERE recovery_email_verified_at IS NOT NULL;

-- Jetons envoyés par e-mail : seul leur empreinte est conservée ; durée courte ; usage unique.
CREATE TABLE auth_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  profile_id  uuid NOT NULL REFERENCES profiles(id),
  email       text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX auth_tokens_profile_idx ON auth_tokens (profile_id, purpose, created_at DESC);

-- Journal des envois : « accepté » par le service d'envoi ≠ « reçu » dans la boîte (état « remis » seulement si le service le signale).
CREATE TABLE email_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                text NOT NULL CHECK (kind IN ('verify_email', 'reset_password', 'family_code')),
  profile_id          uuid REFERENCES profiles(id),
  recipient_hash      text NOT NULL,
  recipient_masked    text NOT NULL,
  provider            text NOT NULL DEFAULT 'brevo',
  provider_message_id text,
  status              text NOT NULL CHECK (status IN ('queued', 'accepted', 'delivered', 'bounced', 'failed', 'unknown', 'not_configured')),
  detail              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_log_recipient_idx ON email_log (recipient_hash, kind, created_at DESC);
CREATE INDEX email_log_message_idx ON email_log (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX email_log_profile_idx ON email_log (profile_id, created_at DESC);
