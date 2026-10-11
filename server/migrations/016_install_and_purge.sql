-- Installation en deux temps (famille « en attente » tant que l'adresse de récupération n'est pas vérifiée) et
-- suppression définitive d'une famille (la seule porte qui contourne l'immutabilité des archives, réservée à ce traitement).

ALTER TABLE families ADD COLUMN setup_completed_at timestamptz;
-- Les familles existantes sont déjà installées : rien ne change pour elles.
UPDATE families SET setup_completed_at = created_at;

ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_kind_check;
ALTER TABLE email_log ADD CONSTRAINT email_log_kind_check CHECK (kind IN ('verify_email', 'reset_password', 'family_code', 'test'));

-- Listes clôturées, validations et événements restent immuables ; seule la suppression d'une famille entière (transaction qui pose
-- app.family_purge) peut les effacer, et seulement en DELETE.
CREATE OR REPLACE FUNCTION forbid_archived_list_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st  list_status;
  lid uuid;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.family_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'lists' THEN
    IF OLD.status = 'archived' THEN
      RAISE EXCEPTION 'liste archivée : modification interdite';
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN lid := OLD.list_id; ELSE lid := NEW.list_id; END IF;
    SELECT status INTO st FROM lists WHERE id = lid;
    IF st = 'archived' THEN
      RAISE EXCEPTION 'liste archivée : modification interdite (%)', TG_TABLE_NAME;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.family_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% est en ajout seulement (% interdit)', TG_TABLE_NAME, TG_OP;
END $$;
