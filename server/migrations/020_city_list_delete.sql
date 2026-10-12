-- Ville du profil (prix de la communauté par ville) et suppression volontaire d'une liste clôturée par un administrateur.
-- Aucune donnée existante n'est modifiée : la ville est ajoutée vide (demandée plus tard aux profils existants).
ALTER TABLE profiles ADD COLUMN city text;

-- Les archives restent protégées contre toute modification ordinaire. La seule porte de suppression d'UNE liste : le traitement
-- « supprimer la liste » pose app.list_delete = identifiant de CETTE liste, dans sa transaction ; seules les lignes de cette liste peuvent alors être supprimées.
CREATE OR REPLACE FUNCTION list_delete_allowed(lid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.list_delete', true) = lid::text, false)
$$;

CREATE OR REPLACE FUNCTION forbid_archived_list_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st  list_status;
  lid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.family_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    IF TG_TABLE_NAME = 'lists' THEN
      IF list_delete_allowed(OLD.id) THEN RETURN OLD; END IF;
    ELSIF list_delete_allowed(OLD.list_id) THEN
      RETURN OLD;
    END IF;
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
  IF TG_OP = 'DELETE' AND (current_setting('app.family_purge', true) = 'on' OR list_delete_allowed(OLD.list_id)) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% est en ajout seulement (% interdit)', TG_TABLE_NAME, TG_OP;
END $$;
