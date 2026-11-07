-- Retour arrière MANUEL de 035 : l'espace plateforme disparaît (aucune donnée des familles n'est touchée).
BEGIN;
DROP TABLE IF EXISTS platform_excluded_families;
DROP TABLE IF EXISTS platform_admins_history;
DROP TABLE IF EXISTS platform_admins;
DROP INDEX IF EXISTS profiles_id_family;
DELETE FROM schema_migrations WHERE name = '035_platform_space.sql';
COMMIT;
