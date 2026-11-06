-- Retour arrière MANUEL de 033 : l'iPhone n'a plus de réglage ; Android garde sa version minimale seulement si elle était active.
BEGIN;
DELETE FROM app_update_policy WHERE platform = 'ios';
DELETE FROM app_update_history WHERE platform = 'ios';
UPDATE app_update_policy SET min_code = NULL WHERE NOT required_active;
ALTER TABLE app_update_policy DROP CONSTRAINT app_update_required_complete;
ALTER TABLE app_update_policy DROP COLUMN min_os;
ALTER TABLE app_update_policy DROP COLUMN required_active;
UPDATE app_update_policy SET store_url = 'https://play.google.com/store/apps/details?id=app.smartcourse.courses.natif' WHERE store_url IS NULL;
ALTER TABLE app_update_policy ALTER COLUMN store_url SET NOT NULL;
ALTER TABLE app_update_policy DROP CONSTRAINT app_update_policy_platform_check;
ALTER TABLE app_update_policy ADD CONSTRAINT app_update_policy_platform_check CHECK (platform = 'android');
ALTER TABLE app_update_history DROP COLUMN min_os;
ALTER TABLE app_update_history DROP COLUMN required_active;
DELETE FROM schema_migrations WHERE name = '033_app_update_platforms.sql';
COMMIT;
