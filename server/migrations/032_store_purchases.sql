-- Vérification des achats par le serveur (Google Play, App Store) : lien achat ↔ famille.
--
-- store_account_token : identifiant aléatoire, propre à la famille, transmis au store au moment de l'achat
-- (Google : obfuscatedAccountId ; Apple : appAccountToken). Le serveur n'accepte un achat que s'il porte le jeton de la famille
-- qui le présente : un achat fait pour une famille ne peut pas être récupéré par une autre, même avec le même compte store.
-- Aléatoire (pas dérivé de l'identifiant de la famille) : le store n'apprend rien sur la famille.
ALTER TABLE families ADD COLUMN store_account_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX families_store_account_token ON families (store_account_token);

-- Un abonnement Google repris ou changé reçoit un nouveau jeton (linkedPurchaseToken) : l'ancienne ligne est marquée remplacée.
ALTER TABLE family_entitlements DROP CONSTRAINT family_entitlements_status_check;
ALTER TABLE family_entitlements ADD CONSTRAINT family_entitlements_status_check
  CHECK (status IN ('active', 'grace', 'on_hold', 'cancelled', 'expired', 'refunded', 'revoked', 'pending', 'replaced'));
ALTER TABLE family_entitlements ADD COLUMN replaced_by uuid REFERENCES family_entitlements(id) ON DELETE SET NULL;
ALTER TABLE family_entitlements ADD COLUMN store_ref text CHECK (store_ref IS NULL OR char_length(store_ref) <= 200); -- orderId Google / transactionId Apple (support)

-- Achats présentés mais refusés (autre famille, mauvais produit, environnement de test refusé) : trace, sans jeton complet.
ALTER TABLE entitlement_events DROP CONSTRAINT entitlement_events_source_check;
ALTER TABLE entitlement_events ADD CONSTRAINT entitlement_events_source_check
  CHECK (source IN ('client', 'google_notification', 'apple_notification', 'reconcile', 'operator', 'refused'));
