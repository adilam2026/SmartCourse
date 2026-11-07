-- Retour arrière MANUEL de 034 : plus de distinction par plateforme (la règle des listes gratuites redevient celle de 031/032).
BEGIN;
DROP TABLE IF EXISTS profile_clients;
DROP TABLE IF EXISTS purchase_platforms_history;
DROP TABLE IF EXISTS purchase_platforms;
DELETE FROM schema_migrations WHERE name = '034_purchase_platforms.sql';
COMMIT;
