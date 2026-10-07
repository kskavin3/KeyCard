import { pool } from './db.js';

export async function bootstrapRegistryProvider() {
  const providerId = process.env.KEYCARD_PROVIDER_ID ?? 'provider-demo';
  const providerName = process.env.KEYCARD_PROVIDER_NAME ?? 'KeyCard Demo Provider';
  await pool.query(
    `INSERT INTO providers(provider_id,name,payout_address) VALUES($1,$2,$3)
     ON CONFLICT(provider_id) DO UPDATE SET name=EXCLUDED.name,
       payout_address=COALESCE(providers.payout_address,EXCLUDED.payout_address)`,
    [providerId, providerName, process.env.KEYCARD_PAY_TO ?? null],
  );
}
