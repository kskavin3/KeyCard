CREATE TABLE IF NOT EXISTS providers (
  provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payout_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_listings (
  listing_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(provider_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  capabilities JSONB NOT NULL,
  availability TEXT NOT NULL DEFAULT 'available'
    CHECK (availability IN ('available', 'temporarily-unavailable', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upstream_configs (
  listing_id TEXT PRIMARY KEY REFERENCES api_listings(listing_id) ON DELETE CASCADE,
  base_url TEXT NOT NULL,
  allowed_hosts TEXT[] NOT NULL,
  request_timeout_ms INTEGER NOT NULL DEFAULT 5000
    CHECK (request_timeout_ms BETWEEN 250 AND 30000)
);

CREATE TABLE IF NOT EXISTS api_credentials (
  listing_id TEXT PRIMARY KEY REFERENCES api_listings(listing_id) ON DELETE CASCADE,
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('header', 'query')),
  auth_field TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  nonce TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_operations (
  operation_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES api_listings(listing_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  path TEXT NOT NULL,
  input_schema JSONB NOT NULL,
  output_schema JSONB NOT NULL,
  price_usd_micros NUMERIC(24, 0) NOT NULL CHECK (price_usd_micros > 0),
  markup_basis_points INTEGER NOT NULL DEFAULT 200 CHECK (markup_basis_points >= 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, operation_id)
);

CREATE INDEX IF NOT EXISTS api_listings_available_idx
  ON api_listings (availability, updated_at DESC);
CREATE INDEX IF NOT EXISTS api_operations_listing_enabled_idx
  ON api_operations (listing_id, enabled);

-- Call IDs are hashes of secret client idempotency keys. Retain these rows:
-- removing a receipt also removes its replay protection.
CREATE TABLE IF NOT EXISTS paid_calls (
  call_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(provider_id),
  listing_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  requirements JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'quoted' CHECK (state IN
    ('quoted', 'verified', 'executing', 'result_ready', 'settling', 'completed', 'failed', 'review')),
  tx_hash TEXT UNIQUE,
  payment_payload JSONB,
  payer TEXT,
  response_status INTEGER,
  response_body JSONB,
  settlement JSONB,
  payment_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  refund_status TEXT NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'due', 'paid')),
  refund_tx_hash TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paid_calls_provider_idx ON paid_calls(provider_id, created_at DESC);

-- A transfer may satisfy only one payment or refund obligation, including
-- across the two roles. Claims and call updates commit in one transaction.
CREATE TABLE IF NOT EXISTS payment_transactions (
  tx_hash TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES paid_calls(call_id) DEFERRABLE INITIALLY DEFERRED,
  purpose TEXT NOT NULL CHECK (purpose IN ('payment', 'refund')),
  UNIQUE (call_id, purpose)
);
