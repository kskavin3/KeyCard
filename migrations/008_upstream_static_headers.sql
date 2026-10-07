ALTER TABLE upstream_configs
  ADD COLUMN IF NOT EXISTS static_headers JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'upstream_configs_static_headers_object'
  ) THEN
    ALTER TABLE upstream_configs
      ADD CONSTRAINT upstream_configs_static_headers_object
      CHECK (jsonb_typeof(static_headers) = 'object');
  END IF;
END $$;
