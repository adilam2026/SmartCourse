-- Retour arrière MANUEL de 032 (hors migrations chargées automatiquement). À exécuter avant celui de 031 si les deux sont annulés.
-- Les droits déjà vérifiés restent en place ; seules les lignes « replaced » et « refused » sont ramenées à des valeurs admises par 031.
BEGIN;
UPDATE family_entitlements SET status = 'expired' WHERE status = 'replaced';
DELETE FROM entitlement_events WHERE source = 'refused';
ALTER TABLE entitlement_events DROP CONSTRAINT entitlement_events_source_check;
ALTER TABLE entitlement_events ADD CONSTRAINT entitlement_events_source_check
  CHECK (source IN ('client', 'google_notification', 'apple_notification', 'reconcile', 'operator'));
ALTER TABLE family_entitlements DROP COLUMN store_ref;
ALTER TABLE family_entitlements DROP COLUMN replaced_by;
ALTER TABLE family_entitlements DROP CONSTRAINT family_entitlements_status_check;
ALTER TABLE family_entitlements ADD CONSTRAINT family_entitlements_status_check
  CHECK (status IN ('active', 'grace', 'on_hold', 'cancelled', 'expired', 'refunded', 'revoked', 'pending'));
DROP INDEX families_store_account_token;
ALTER TABLE families DROP COLUMN store_account_token;
DELETE FROM schema_migrations WHERE name = '032_store_purchases.sql';
COMMIT;
