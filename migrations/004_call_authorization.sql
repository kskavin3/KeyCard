ALTER TABLE paid_calls ADD COLUMN IF NOT EXISTS authorization_method TEXT NOT NULL DEFAULT 'payment'
  CHECK (authorization_method IN ('payment', 'sponsorship'));
