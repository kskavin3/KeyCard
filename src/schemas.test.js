import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schemaNames = [
  'api-listing',
  'operation',
  'quote',
  'payment',
  'receipt',
  'advault-entry',
];
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const common = JSON.parse(await readFile(new URL('../schemas/common.schema.json', import.meta.url)));
ajv.addSchema(common);

const schemas = new Map(await Promise.all(schemaNames.map(async name => {
  const schema = JSON.parse(await readFile(new URL(`../schemas/${name}.schema.json`, import.meta.url)));
  return [name, ajv.compile(schema)];
})));

const listing = {
  listingId: 'listing-weather',
  providerId: 'provider-demo',
  name: 'Current weather',
  description: 'Current conditions for a location.',
  proxyUrl: 'https://keycard.example/proxy/weather/current',
  capabilities: ['weather', 'current-conditions'],
  operationIds: ['weather-current'],
  availability: 'available',
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
};

test('all application schemas compile as JSON Schema Draft 2020-12', () => {
  assert.equal(schemas.size, schemaNames.length);
});

test('public listings accept discoverable data and reject provider secrets', () => {
  const validate = schemas.get('api-listing');
  assert.equal(validate(listing), true);
  assert.equal(validate({ ...listing, upstreamApiKey: 'must-not-leak' }), false);
});

test('operations expose canonical and effective ADA prices as lovelace strings', () => {
  const validate = schemas.get('operation');
  const operation = {
    operationId: 'weather-current', listingId: listing.listingId,
    proxyId: '2d246c0e-52d2-4e99-94a0-6fb1877c98dd',
    proxyUrl: 'https://keycard.example/api/proxy/2d246c0e-52d2-4e99-94a0-6fb1877c98dd',
    name: 'Current weather', description: 'Returns current conditions.',
    method: 'GET', path: '/weather',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', additionalProperties: true },
    pricing: { model: 'fixed-per-call', priceLovelace: '2000000', effectivePriceLovelace: '2040000', asset: 'lovelace', markupBasisPoints: 200 },
    enabled: true,
  };
  assert.equal(validate(operation), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...operation, pricing: { ...operation.pricing, priceLovelace: 2000000 } }), false);
});

test('quotes require the pinned Cardano Preprod exact/lovelace contract', () => {
  const validate = schemas.get('quote');
  const quote = {
    x402Version: 2,
    quoteId: 'quote-1',
    listingId: listing.listingId,
    operationId: 'weather-current',
    requestId: 'request-1',
    requestHash: `sha256:${'a'.repeat(64)}`,
    scheme: 'exact',
    network: 'cardano:preprod',
    amount: '1000000',
    asset: 'lovelace',
    assetTransferMethod: 'default',
    payTo: 'addr_test1qz0',
    maxTimeoutSeconds: 300,
    issuedAt: '2026-10-07T00:00:00.000Z',
    expiresAt: '2026-10-07T00:05:00.000Z',
  };
  assert.equal(validate(quote), true);
  assert.equal(validate({ ...quote, network: 'cardano:mainnet' }), false);
  assert.equal(validate({ ...quote, amount: 1000000 }), false);
});
