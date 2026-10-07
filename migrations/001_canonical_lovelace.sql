ALTER TABLE api_operations ADD COLUMN IF NOT EXISTS price_lovelace NUMERIC(24, 0);

-- Older development records used USD micro-units. There is no honest permanent
-- conversion without a timestamped exchange rate, so preserve operability at
-- the configured Cardano minimum and require providers to review the migrated
-- price in the dashboard.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'api_operations' AND column_name = 'price_usd_micros'
  ) THEN
    EXECUTE 'UPDATE api_operations SET price_lovelace = GREATEST(COALESCE(price_usd_micros, 0), 1500000) WHERE price_lovelace IS NULL';
  ELSE
    UPDATE api_operations SET price_lovelace = 1500000 WHERE price_lovelace IS NULL;
  END IF;
END $$;

ALTER TABLE api_operations ALTER COLUMN price_lovelace SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_operations_price_lovelace_positive') THEN
    ALTER TABLE api_operations ADD CONSTRAINT api_operations_price_lovelace_positive CHECK (price_lovelace > 0) NOT VALID;
  END IF;
END $$;
ALTER TABLE api_operations VALIDATE CONSTRAINT api_operations_price_lovelace_positive;
ALTER TABLE api_operations DROP COLUMN IF EXISTS price_usd_micros;
