-- Operation identifiers are scoped to a listing in every public route and
-- schema. Make the database key match that contract so common IDs such as
-- `search` can safely appear in listings owned by different providers.
ALTER TABLE api_operations DROP CONSTRAINT IF EXISTS api_operations_pkey;
ALTER TABLE api_operations DROP CONSTRAINT IF EXISTS api_operations_listing_id_operation_id_key;
ALTER TABLE api_operations ADD CONSTRAINT api_operations_pkey PRIMARY KEY (listing_id, operation_id);

-- Keep persisted records valid even if a future writer bypasses the HTTP
-- validation layer.
ALTER TABLE api_listings ADD CONSTRAINT api_listings_name_length
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 160);
ALTER TABLE api_listings ADD CONSTRAINT api_listings_description_length
  CHECK (char_length(btrim(description)) BETWEEN 1 AND 4000);
ALTER TABLE api_listings ADD CONSTRAINT api_listings_capabilities_shape
  CHECK (jsonb_typeof(capabilities) = 'array' AND jsonb_array_length(capabilities) BETWEEN 1 AND 20);
ALTER TABLE api_operations ADD CONSTRAINT api_operations_name_length
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE api_operations ADD CONSTRAINT api_operations_description_length
  CHECK (char_length(btrim(description)) BETWEEN 1 AND 2000);
ALTER TABLE api_operations ADD CONSTRAINT api_operations_path_shape
  CHECK (char_length(path) BETWEEN 1 AND 2048 AND path LIKE '/%');
ALTER TABLE api_operations ADD CONSTRAINT api_operations_markup_range
  CHECK (markup_basis_points BETWEEN 0 AND 1000000);
