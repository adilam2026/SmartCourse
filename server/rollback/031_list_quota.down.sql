-- Suppression COMPLÈTE de la migration 031 (quota de listes et droits payants). Jamais exécuté automatiquement (hors de migrations/).
-- À n'utiliser qu'avec l'accord du propriétaire : les achats enregistrés (droits des familles) seraient perdus.
-- Le retour arrière ordinaire est « admin-cli quota-deactivate --execute » (aucun blocage, rien d'effacé).
BEGIN;
DROP TABLE IF EXISTS entitlement_events;
DROP TABLE IF EXISTS family_entitlements;
DROP TABLE IF EXISTS list_creations;
DROP TRIGGER IF EXISTS families_list_quota_start ON families;
DROP FUNCTION IF EXISTS families_list_quota_start();
ALTER TABLE families DROP COLUMN IF EXISTS list_creations_used, DROP COLUMN IF EXISTS list_quota_since;
DROP TABLE IF EXISTS list_quota_history;
DROP TABLE IF EXISTS list_quota_settings;
DELETE FROM schema_migrations WHERE name = '031_list_quota.sql';
COMMIT;
