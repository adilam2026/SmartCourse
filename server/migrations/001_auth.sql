CREATE TABLE install_tokens (
  id           bigserial PRIMARY KEY,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  consumed_at  timestamptz,
  family_id    uuid
);

CREATE TABLE families (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6,12}$'),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE install_tokens ADD FOREIGN KEY (family_id) REFERENCES families(id);

CREATE TYPE profile_role AS ENUM ('admin', 'parent', 'staff');

CREATE TABLE profiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        uuid NOT NULL REFERENCES families(id),
  display_name     text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  login            text NOT NULL CHECK (login ~ '^[a-z0-9._-]{2,30}$'),
  role             profile_role NOT NULL,
  secret_hash      text NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, login)
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES profiles(id),
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
CREATE INDEX sessions_profile_idx ON sessions(profile_id) WHERE revoked_at IS NULL;
