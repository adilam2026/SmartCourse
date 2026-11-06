-- Créations de listes gratuites par famille (10), puis abonnement annuel ou achat à vie, partagés par toute la famille.
-- AUCUNE activation ici : l'interrupteur est éteint et aucune famille n'est concernée tant que la commande d'administration
-- « quota-activate » n'a pas été lancée. Les anciennes listes ne sont jamais comptées. Migration additive : l'ancien serveur
-- l'ignore. Retour arrière : « quota-deactivate » (aucun blocage, compteurs et achats gardés) ; suppression complète :
-- server/rollback/031_list_quota.down.sql (à n'utiliser qu'avec l'accord du propriétaire, hors du chargement automatique).

CREATE TABLE list_quota_settings (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled       boolean NOT NULL DEFAULT false,
  free_lists    integer NOT NULL DEFAULT 10 CHECK (free_lists BETWEEN 0 AND 1000),
  activated_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO list_quota_settings (id) VALUES (true);

CREATE TABLE list_quota_history (
  id               bigserial PRIMARY KEY,
  enabled          boolean NOT NULL,
  families_started integer NOT NULL DEFAULT 0,
  note             text CHECK (note IS NULL OR char_length(note) <= 200),
  changed_at       timestamptz NOT NULL DEFAULT now()
);

-- Compteur PERMANENT de la famille : démarre à son activation (NULL = règle jamais appliquée à cette famille) ; il ne baisse jamais
-- (suppression ou archivage d'une liste ne rend aucun crédit).
ALTER TABLE families
  ADD COLUMN list_quota_since    timestamptz,
  ADD COLUMN list_creations_used integer NOT NULL DEFAULT 0 CHECK (list_creations_used >= 0);

-- Familles créées pendant que la règle est active : leurs dix créations gratuites commencent tout de suite.
CREATE FUNCTION families_list_quota_start() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.list_quota_since IS NULL AND (SELECT enabled FROM list_quota_settings WHERE id) THEN
    NEW.list_quota_since := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER families_list_quota_start BEFORE INSERT ON families FOR EACH ROW EXECUTE FUNCTION families_list_quota_start();

-- Une ligne par création effective de liste (traçabilité, et clé d'idempotence : une requête rejouée retrouve la même création).
CREATE TABLE list_creations (
  id           bigserial PRIMARY KEY,
  family_id    uuid NOT NULL REFERENCES families(id),
  list_id      uuid UNIQUE REFERENCES lists(id) ON DELETE SET NULL,   -- liste supprimée plus tard : la création reste comptée
  created_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  request_key  uuid,                                                   -- lot de demandes (création implicite) ou requestId (« Créer une liste »)
  kind         text NOT NULL CHECK (kind IN ('explicit', 'implicit')),
  counted      boolean NOT NULL,                                       -- faux avant l'activation de la règle pour la famille
  entitled     boolean NOT NULL DEFAULT false,                         -- créée sous un droit payant actif
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX list_creations_request ON list_creations (family_id, request_key) WHERE request_key IS NOT NULL;
CREATE INDEX list_creations_family ON list_creations (family_id, created_at);

-- Droits payants de la famille (abonnement annuel ou achat à vie), vérifiés auprès du store par le serveur.
CREATE TABLE family_entitlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        uuid NOT NULL REFERENCES families(id),
  platform         text NOT NULL CHECK (platform IN ('google', 'apple')),
  product_id       text NOT NULL CHECK (char_length(product_id) <= 100),
  kind             text NOT NULL CHECK (kind IN ('annual', 'lifetime')),
  purchase_key     text NOT NULL CHECK (char_length(purchase_key) <= 512),   -- jeton Google lié / originalTransactionId Apple
  buyer_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  status           text NOT NULL CHECK (status IN ('active', 'grace', 'on_hold', 'cancelled', 'expired', 'refunded', 'revoked', 'pending')),
  expires_at       timestamptz,                                              -- abonnement : fin de la période payée
  auto_renewing    boolean NOT NULL DEFAULT false,
  environment      text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  verified_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, purchase_key)                                            -- un achat n'est jamais rattaché à deux familles
);
CREATE INDEX family_entitlements_family ON family_entitlements (family_id);

CREATE TABLE entitlement_events (
  id             bigserial PRIMARY KEY,
  entitlement_id uuid REFERENCES family_entitlements(id) ON DELETE CASCADE,
  family_id      uuid REFERENCES families(id),
  source         text NOT NULL CHECK (source IN ('client', 'google_notification', 'apple_notification', 'reconcile', 'operator')),
  type           text NOT NULL CHECK (char_length(type) <= 80),
  event_key      text CHECK (event_key IS NULL OR char_length(event_key) <= 200),  -- identifiant de notification du store (rejeu ignoré)
  details        jsonb,
  received_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX entitlement_events_key ON entitlement_events (source, event_key) WHERE event_key IS NOT NULL;
