-- Each operation receives a stable, opaque public routing identifier. It is
-- discoverable rather than secret; x402 payment authorization still protects
-- invocation of the upstream operation.
ALTER TABLE api_operations ADD COLUMN IF NOT EXISTS proxy_id UUID;
UPDATE api_operations SET proxy_id = gen_random_uuid() WHERE proxy_id IS NULL;
ALTER TABLE api_operations ALTER COLUMN proxy_id SET DEFAULT gen_random_uuid();
ALTER TABLE api_operations ALTER COLUMN proxy_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS api_operations_proxy_id_idx ON api_operations(proxy_id);
