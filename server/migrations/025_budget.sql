-- Module Budget (option familiale « Gestion du budget », désactivée par défaut : families.budget_enabled, migration 024).
-- Migration ADDITIVE : nouvelles tables seulement. L'ancien serveur les ignore.
-- Montants en unités mineures entières (centimes, millimes…) selon les décimales de la devise : aucun nombre flottant.

-- Réglages : devise proposée selon le pays, confirmée à l'activation, figée dès la première opération (contrôle applicatif).
CREATE TABLE finance_settings (
  family_id        uuid PRIMARY KEY REFERENCES families(id),
  currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  decimals         smallint NOT NULL CHECK (decimals BETWEEN 0 AND 3),
  budgets_enabled  boolean NOT NULL DEFAULT false,   -- budgets mensuels facultatifs
  account_enabled  boolean NOT NULL DEFAULT false,   -- suivi « Mon compte » facultatif
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES profiles(id)
);

-- Droits financiers distincts. Les administrateurs ont tous les droits ; les autres profils n'en ont aucun sans ligne ici.
CREATE TABLE finance_rights (
  profile_id       uuid PRIMARY KEY REFERENCES profiles(id),
  family_id        uuid NOT NULL REFERENCES families(id),
  can_manage       boolean NOT NULL DEFAULT false,   -- paramètres, catégories, budgets, Mon compte, droits
  can_view         boolean NOT NULL DEFAULT false,   -- consulter le suivi (solde, entrées, toutes les dépenses)
  can_record       boolean NOT NULL DEFAULT false,   -- saisir les paiements des listes (et corriger les siens)
  can_edit         boolean NOT NULL DEFAULT false,   -- ajouter et modifier toutes les opérations
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES profiles(id)
);
CREATE INDEX finance_rights_family ON finance_rights (family_id);

-- Catégories financières (distinctes des catégories de produits). « courses » est la catégorie système des paiements de liste.
CREATE TABLE finance_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid NOT NULL REFERENCES families(id),
  system_key   text CHECK (system_key IN ('courses', 'transport', 'maison', 'autres')),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  position     int NOT NULL DEFAULT 100,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES profiles(id)
);
CREATE UNIQUE INDEX finance_categories_name ON finance_categories (family_id, lower(btrim(name)));
CREATE UNIQUE INDEX finance_categories_system ON finance_categories (family_id, system_key) WHERE system_key IS NOT NULL;

-- Commerces habituels de la famille (BIM, Carrefour… et commerces personnalisés).
CREATE TABLE finance_merchants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid NOT NULL REFERENCES families(id),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  uses          int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX finance_merchants_name ON finance_merchants (family_id, lower(btrim(name)));

-- Opérations : dépenses et entrées d'argent, un seul historique. Une dépense a exactement UNE catégorie (donc un seul budget).
CREATE TABLE finance_operations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid NOT NULL REFERENCES families(id),
  kind          text NOT NULL CHECK (kind IN ('expense', 'income')),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor < 1000000000000),
  currency      text NOT NULL,
  category_id   uuid REFERENCES finance_categories(id),
  merchant_id   uuid REFERENCES finance_merchants(id),
  label         text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 80),
  note          text CHECK (note IS NULL OR length(note) <= 300),
  op_date       date NOT NULL,                       -- date effective du paiement : elle fixe le mois budgétaire
  list_id       uuid REFERENCES lists(id) ON DELETE SET NULL,   -- liste supprimée : la dépense reste réelle
  source        text NOT NULL CHECK (source IN ('list_payment', 'manual')),
  request_id    uuid NOT NULL,                       -- identifiant de saisie : une relance réseau ne crée jamais un doublon
  rev           int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL REFERENCES profiles(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid NOT NULL REFERENCES profiles(id),
  voided_at     timestamptz,                         -- annulation explicite et traçable (jamais d'effacement)
  voided_by     uuid REFERENCES profiles(id),
  void_reason   text,
  UNIQUE (family_id, request_id),
  CHECK ((kind = 'expense' AND category_id IS NOT NULL) OR (kind = 'income' AND category_id IS NULL AND merchant_id IS NULL AND list_id IS NULL)),
  CHECK (kind = 'expense' OR label IS NOT NULL),
  CHECK (source = 'manual' OR kind = 'expense')
);
CREATE INDEX finance_operations_month ON finance_operations (family_id, op_date) WHERE voided_at IS NULL;
CREATE INDEX finance_operations_list ON finance_operations (list_id) WHERE list_id IS NOT NULL;

-- Traçabilité : chaque création, correction et annulation, avec l'état avant / après.
CREATE TABLE finance_operation_history (
  id            bigserial PRIMARY KEY,
  family_id     uuid NOT NULL REFERENCES families(id),
  operation_id  uuid NOT NULL REFERENCES finance_operations(id),
  action        text NOT NULL CHECK (action IN ('create', 'update', 'void')),
  at            timestamptz NOT NULL DEFAULT now(),
  by_profile    uuid NOT NULL REFERENCES profiles(id),
  before        jsonb,
  after         jsonb
);
CREATE INDEX finance_operation_history_op ON finance_operation_history (operation_id);

-- Budgets mensuels : un montant prévu par catégorie et par mois (premier jour du mois). Définir un budget n'est jamais une dépense.
CREATE TABLE finance_budgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid NOT NULL REFERENCES families(id),
  category_id   uuid NOT NULL REFERENCES finance_categories(id),
  month         date NOT NULL CHECK (extract(day FROM month) = 1),
  amount_minor  bigint NOT NULL CHECK (amount_minor >= 0 AND amount_minor < 1000000000000),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid NOT NULL REFERENCES profiles(id),
  UNIQUE (family_id, category_id, month)
);

-- Mon compte : un seul compte de suivi familial. Solde = solde initial (au DÉBUT de la date de référence) + entrées − dépenses
-- datées de cette date ou après. Chaque saisie ou correction du solde initial est conservée (jamais remplacée en silence).
CREATE TABLE finance_account_history (
  id              bigserial PRIMARY KEY,
  family_id       uuid NOT NULL REFERENCES families(id),
  opening_minor   bigint NOT NULL CHECK (abs(opening_minor) < 1000000000000),
  reference_date  date NOT NULL,
  reason          text CHECK (reason IS NULL OR length(reason) <= 200),
  at              timestamptz NOT NULL DEFAULT now(),
  by_profile      uuid NOT NULL REFERENCES profiles(id)
);
CREATE INDEX finance_account_history_family ON finance_account_history (family_id, id DESC);

-- Paiements d'une liste confirmés comme complets (sinon : « non renseignés » s'il n'y a aucun paiement, « à compléter » sinon).
-- Table à part : une liste clôturée reste intouchable (déclencheur lists_archived_guard), la saisie ultérieure ne la rouvre pas.
CREATE TABLE list_payment_status (
  list_id      uuid PRIMARY KEY REFERENCES lists(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL REFERENCES families(id),
  complete_at  timestamptz NOT NULL DEFAULT now(),
  complete_by  uuid NOT NULL REFERENCES profiles(id)
);
