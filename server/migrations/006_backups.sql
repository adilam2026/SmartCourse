CREATE TABLE backup_runs (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('backup', 'verify')),
  at          timestamptz NOT NULL DEFAULT now(),
  ok          boolean NOT NULL,
  backup_key  text,
  detail      jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX backup_runs_kind_idx ON backup_runs (kind, at DESC);
