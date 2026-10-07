import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { pool } from './db.js';

async function passwordDigest(password: string, salt: string) {
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, 32, (error, key) => error ? reject(error) : resolve(key as Buffer));
  });
  return derived.toString('base64url');
}

export async function bootstrapProviderAccount() {
  const providerId = process.env.KEYCARD_PROVIDER_ID ?? 'provider-demo';
  const providerName = process.env.KEYCARD_PROVIDER_NAME ?? 'KeyCard Demo Provider';
  const password = process.env.KEYCARD_DASHBOARD_PASSWORD;
  if (!password) throw new Error('KEYCARD_DASHBOARD_PASSWORD must be set before starting KeyCard.');
  const salt = randomBytes(16).toString('base64url');
  const digest = await passwordDigest(password, salt);
  await pool.query(
    `INSERT INTO providers(provider_id,name,payout_address) VALUES($1,$2,$3)
     ON CONFLICT(provider_id) DO UPDATE SET name=EXCLUDED.name,
       payout_address=COALESCE(providers.payout_address,EXCLUDED.payout_address)`,
    [providerId, providerName, process.env.KEYCARD_PAY_TO ?? null],
  );
  await pool.query(
    `INSERT INTO provider_users(user_id,provider_id,display_name,password_salt,password_hash)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,
       password_salt=EXCLUDED.password_salt,password_hash=EXCLUDED.password_hash,updated_at=now()`,
    [`${providerId}:owner`, providerId, providerName, salt, digest],
  );
}

export async function authenticateProvider(providerId: string, password: unknown) {
  if (typeof password !== 'string' || !password) return false;
  const result = await pool.query('SELECT password_salt,password_hash FROM provider_users WHERE provider_id=$1', [providerId]);
  const account = result.rows[0];
  if (!account) return false;
  const actual = Buffer.from(await passwordDigest(password, account.password_salt), 'utf8');
  const expected = Buffer.from(String(account.password_hash), 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
