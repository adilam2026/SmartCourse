-- Options avancées de la famille (désactivées par défaut, AUCUNE famille existante n'est activée) et plusieurs listes actives.
-- Additive : l'ancienne application et l'ancien serveur continuent de fonctionner tant qu'une famille n'a qu'une liste en cours.
ALTER TABLE families ADD COLUMN multi_lists_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE families ADD COLUMN budget_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE families ADD COLUMN features_updated_at timestamptz;
ALTER TABLE families ADD COLUMN features_updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Nom facultatif d'une liste (« Courses semaine », « Fête de samedi »…) ; liste consultée par chaque profil.
ALTER TABLE lists ADD COLUMN name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 40);
ALTER TABLE profiles ADD COLUMN current_list_id uuid REFERENCES lists(id) ON DELETE SET NULL;

-- « Une seule liste en cours » reste la règle, sauf si la famille a activé l'option : la contrainte devient un déclencheur.
-- Il renvoie la même erreur d'unicité (23505) que l'ancien index, déjà gérée par le serveur ; un verrou par famille départage
-- deux créations simultanées.
DROP INDEX IF EXISTS lists_one_active_per_family;
CREATE FUNCTION lists_single_active_unless_enabled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    PERFORM pg_advisory_xact_lock(hashtext('lists-active-' || NEW.family_id::text));
    IF NOT (SELECT multi_lists_enabled FROM families WHERE id = NEW.family_id)
       AND EXISTS (SELECT 1 FROM lists WHERE family_id = NEW.family_id AND status = 'active' AND id <> NEW.id) THEN
      RAISE EXCEPTION 'une liste est déjà en cours' USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lists_single_active BEFORE INSERT OR UPDATE OF status ON lists FOR EACH ROW EXECUTE FUNCTION lists_single_active_unless_enabled();
CREATE INDEX lists_active_by_family ON lists (family_id, created_at DESC) WHERE status = 'active';
