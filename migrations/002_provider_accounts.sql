CREATE TABLE IF NOT EXISTS provider_users (
  user_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(provider_id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_users_provider_idx ON provider_users(provider_id);
