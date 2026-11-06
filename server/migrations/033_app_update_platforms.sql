-- Mise à jour de l'application : Android ET iPhone, réglages séparés (page /gestion/mise-a-jour), sans nouvelle publication.
--  - latest_code : dernière version disponible (numéro technique : versionCode Android, CFBundleVersion iPhone) → proposition facultative ;
--  - min_code    : version minimale autorisée, appliquée SEULEMENT si required_active (interrupteur, coupé en un geste sans perdre le numéro) ;
--  - min_os      : système minimal de la version exigée (niveau d'API Android, version majeure d'iOS) : un appareil qui ne peut pas
--                  l'installer n'est jamais bloqué ;
--  - store_url   : fiche officielle (Google Play, App Store) ; iPhone : à renseigner quand l'application existe sur l'App Store.
-- Rien n'est activé par cette migration : l'état Android est repris tel quel, l'iPhone démarre sans proposition ni blocage.
ALTER TABLE app_update_policy DROP CONSTRAINT app_update_policy_platform_check;
ALTER TABLE app_update_policy ADD CONSTRAINT app_update_policy_platform_check CHECK (platform IN ('android', 'ios'));
ALTER TABLE app_update_policy ALTER COLUMN store_url DROP NOT NULL;
ALTER TABLE app_update_policy ADD COLUMN required_active boolean NOT NULL DEFAULT false;
ALTER TABLE app_update_policy ADD COLUMN min_os integer CHECK (min_os IS NULL OR min_os > 0);
UPDATE app_update_policy SET required_active = (min_code IS NOT NULL);
ALTER TABLE app_update_policy ADD CONSTRAINT app_update_required_complete CHECK (NOT required_active OR (min_code IS NOT NULL AND store_url IS NOT NULL));
INSERT INTO app_update_policy (platform, store_url) VALUES ('ios', NULL) ON CONFLICT (platform) DO NOTHING;

ALTER TABLE app_update_history ADD COLUMN required_active boolean;
ALTER TABLE app_update_history ADD COLUMN min_os integer;
UPDATE app_update_history SET required_active = (min_code IS NOT NULL);
