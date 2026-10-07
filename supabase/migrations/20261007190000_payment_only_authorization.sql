ALTER TABLE paid_calls
  DROP CONSTRAINT IF EXISTS paid_calls_authorization_method_check;

ALTER TABLE paid_calls
  ADD CONSTRAINT paid_calls_authorization_method_check
  CHECK (authorization_method = 'payment');
