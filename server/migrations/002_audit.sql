CREATE TABLE audit_log (
  id               bigserial PRIMARY KEY,
  family_id        uuid REFERENCES families(id),
  actor_profile_id uuid REFERENCES profiles(id),   -- NULL = opération d'exploitation (script de secours)
  action           text NOT NULL,
  target_profile_id uuid REFERENCES profiles(id),
  details          jsonb NOT NULL DEFAULT '{}',
  at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_family_idx ON audit_log(family_id, at DESC);
