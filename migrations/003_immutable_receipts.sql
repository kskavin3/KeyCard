CREATE TABLE IF NOT EXISTS call_receipts (
  receipt_id TEXT PRIMARY KEY REFERENCES paid_calls(call_id),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
