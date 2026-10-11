-- Notifications téléphone (Web Push) pour les parents et administrateurs.
-- Aucune donnée existante n'est modifiée : trois nouvelles tables.

-- Clés VAPID du serveur (une seule ligne, créée au premier démarrage). La clé privée ne sort jamais du serveur.
CREATE TABLE push_config (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  public_key  text NOT NULL,
  private_key text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Un abonnement = un appareil (l'adresse `endpoint` est propre à l'appareil et au navigateur) rattaché à UN profil.
-- Plusieurs appareils par profil sont permis ; un même appareil n'appartient jamais à deux profils à la fois.
CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       uuid NOT NULL REFERENCES families(id),
  profile_id      uuid NOT NULL REFERENCES profiles(id),
  endpoint        text NOT NULL UNIQUE CHECK (length(endpoint) <= 2048),
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failures        int NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_profile_idx ON push_subscriptions (family_id, profile_id);

-- Une notification par validation, une seule fois : la clé primaire empêche tout doublon (nouvel envoi du téléphone,
-- synchronisation répétée). Le contenu envoyé est conservé pour la traçabilité.
CREATE TABLE push_events (
  validation_id uuid PRIMARY KEY REFERENCES validations(id),
  family_id     uuid NOT NULL REFERENCES families(id),
  list_id       uuid NOT NULL REFERENCES lists(id),
  actor_id      uuid NOT NULL REFERENCES profiles(id),
  title         text NOT NULL,
  body          text NOT NULL,
  recipients    int NOT NULL DEFAULT 0,
  delivered     int NOT NULL DEFAULT 0,
  failed        int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
