import { HTTPFacilitatorClient } from '@x402/core/server';
import { x402ResourceServer } from '@x402/core/server';
import { addressCredentials, decodeCardanoTransaction } from '@x402/cardano';
import { ExactCardanoScheme } from '@x402/cardano/exact/server';
import { pool } from './db.js';
import { createChainEvidence } from './chain-evidence.js';
import { createAdaUsdRate, toLovelace } from './ada-price.js';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';

const network = 'cardano:preprod' as const;
const asset = 'lovelace';
const facilitatorUrl = process.env.FACILITATOR_URL ?? 'https://x402.preprod.dev.ecosyseng.cf-deployments.org';
const maxTimeoutSeconds = 300;
const minimumLovelace = BigInt(process.env.KEYCARD_MIN_PAYMENT_LOVELACE ?? '1500000');

if (minimumLovelace <= 0n) throw new Error('KEYCARD_MIN_PAYMENT_LOVELACE must be a positive integer.');

const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl, timeoutMs: Number(process.env.KEYCARD_FACILITATOR_TIMEOUT_MS ?? '20000') });
const resourceServer = new x402ResourceServer(facilitator)
  .register(network, new ExactCardanoScheme());

type RequestContext = { path: string; adapter: { getUrl(): string } };

function identifiers(context: RequestContext) {
  const match = /^\/api\/proxy\/([^/]+)\/([^/]+)$/.exec(context.path);
  if (!match) throw new Error('Invalid paid resource path.');
  return { listingId: decodeURIComponent(match[1]), operationId: decodeURIComponent(match[2]) };
}

async function getPaymentTarget(context: RequestContext) {
  const { listingId, operationId } = identifiers(context);
  const result = await pool.query(
    `SELECT l.availability, o.enabled, p.payout_address
       FROM api_listings l
       JOIN api_operations o USING (listing_id)
       JOIN providers p USING (provider_id)
      WHERE l.listing_id = $1 AND o.operation_id = $2`,
    [listingId, operationId],
  );
  const row = result.rows[0];
  if (!row || row.availability !== 'available' || !row.enabled) throw new Error('Paid API operation is unavailable.');
  let validPreprodAddress = typeof row.payout_address === 'string' && row.payout_address.startsWith('addr_test1');
  if (validPreprodAddress) {
    try { addressCredentials(row.payout_address as string); } catch { validPreprodAddress = false; }
  }
  if (!validPreprodAddress) {
    throw new Error('Set KEYCARD_PAY_TO to a valid Cardano Preprod address before enabling paid calls.');
  }
  return { ...row, payout_address: row.payout_address as string };
}

const getAdaUsdRate = createAdaUsdRate();

async function getPaymentPrice(context: RequestContext) {
  const { listingId, operationId } = identifiers(context);
  const result = await pool.query(
    `SELECT o.price_usd_micros, o.markup_basis_points
       FROM api_operations o
       JOIN api_listings l USING (listing_id)
      WHERE l.listing_id = $1 AND o.operation_id = $2
        AND l.availability = 'available' AND o.enabled = TRUE`,
    [listingId, operationId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Paid API operation is unavailable.');
  const priceMicros = (BigInt(String(row.price_usd_micros)) * BigInt(10_000 + row.markup_basis_points) + 9_999n) / 10_000n;
  const lovelace = toLovelace(priceMicros.toString(), await getAdaUsdRate(), minimumLovelace);
  return { asset, amount: lovelace.toString() };
}

const accepts = {
  scheme: 'exact',
  network,
  payTo: (context: RequestContext) => getPaymentTarget(context).then(row => row.payout_address),
  price: getPaymentPrice,
  maxTimeoutSeconds,
  // The Cardano facilitator verifies and broadcasts the payer-signed
  // transaction; require one newer L1 confirmation before treating it as paid.
  extra: { confirmationPolicy: { l1Confirmations: 1 } },
};

let initialization: Promise<void> | undefined;
export async function issueQuote(path: string) {
  initialization ??= resourceServer.initialize().catch(error => { initialization = undefined; throw error; });
  await initialization;
  const context = { path, adapter: { getUrl: () => path } };
  const { listingId, operationId } = identifiers(context);
  const provider = await pool.query('SELECT provider_id FROM api_listings WHERE listing_id = $1', [listingId]);
  const requirements = (await resourceServer.buildPaymentRequirementsFromOptions([accepts], context))[0];
  return { requirements, providerId: provider.rows[0].provider_id as string, listingId, operationId };
}

export const paymentGateway = {
  verify: (payload: PaymentPayload, requirements: PaymentRequirements) => facilitator.verify(payload, requirements),
  settle: (payload: PaymentPayload, requirements: PaymentRequirements) => facilitator.settle(payload, requirements),
  transaction(payload: PaymentPayload) {
    if (typeof payload.payload?.transaction !== 'string') throw new Error('Missing signed transaction.');
    return decodeCardanoTransaction(payload.payload.transaction).txHash;
  },
  confirmed: (payload: PaymentPayload, requirements: PaymentRequirements) => chain.confirmed(payload, requirements),
};

const chain = createChainEvidence({ projectId: () => process.env.BLOCKFROST_PROJECT_ID });
export const verifyRefund = chain.verifyRefund;
