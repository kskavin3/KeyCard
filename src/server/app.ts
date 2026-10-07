import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsPlugin from 'ajv-formats';
import express, { type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { addressCredentials } from '@x402/cardano';
import { pool } from './db.js';
import { decryptCredential, encryptCredential } from './credentials.js';
import { assertAllowedDestination, safeFetch } from './proxy-security.js';
import { issueQuote, issueQuoteForOperation, paymentGateway } from './payments.js';
import { createPaidHandler, PgCallStore } from './paid-calls.js';
import { effectivePriceLovelace } from './money.js';
import { providerPaymentsRouter } from './modules/provider-payments/router.js';
import { resolveOperationRequest } from './operation-request.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
(addFormatsPlugin as unknown as (instance: Ajv2020) => void)(ajv);

const [commonSchema, listingSchema, operationSchema] = await Promise.all([
  readFile(resolve(process.cwd(), 'schemas/common.schema.json'), 'utf8').then(JSON.parse),
  readFile(resolve(process.cwd(), 'schemas/api-listing.schema.json'), 'utf8').then(JSON.parse),
  readFile(resolve(process.cwd(), 'schemas/operation.schema.json'), 'utf8').then(JSON.parse),
]);
ajv.addSchema(commonSchema);
const validateListing = ajv.compile(listingSchema);
const validateOperation = ajv.compile(operationSchema);

type OperationInput = {
  operationId?: string;
  name: string;
  description: string;
  method: string;
  path: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  priceLovelace: string;
  markupBasisPoints?: number;
  enabled?: boolean;
};

type ListingInput = {
  listingId?: string;
  name: string;
  description: string;
  capabilities: string[];
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use('/provider', express.static(resolve(process.cwd(), 'public/provider'), { index: 'index.html' }));

const configuredOrigin = process.env.KEYCARD_PUBLIC_ORIGIN?.replace(/\/$/, '');
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const configuredIsLocal = configuredOrigin
  ? ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(configuredOrigin).hostname)
  : false;
const publicOrigin = vercelHost && (!configuredOrigin || configuredIsLocal)
  ? `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
  : configuredOrigin ?? 'http://localhost:4020';
const defaultProviderId = process.env.KEYCARD_PROVIDER_ID ?? 'provider-demo';
const providerName = process.env.KEYCARD_PROVIDER_NAME ?? 'KeyCard Demo Provider';
const minimumLovelace = BigInt(process.env.KEYCARD_MIN_PAYMENT_LOVELACE ?? '1500000');

function invalid(message: string) {
  const error = new Error(message);
  Object.assign(error, { status: 400 });
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function positiveIntegerString(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,23}$/.test(value);
}

function validPreprodAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('addr_test1')) return false;
  try { addressCredentials(value); return true; } catch { return false; }
}

function safePublicListing(row: any, operations: any[]) {
  const listing = {
    listingId: row.listing_id,
    providerId: row.provider_id,
    name: row.name,
    description: row.description,
    proxyUrl: `${publicOrigin}/api/proxy/${encodeURIComponent(row.listing_id)}`,
    capabilities: row.capabilities,
    operationIds: operations.map(operation => operation.operationId),
    availability: row.availability,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
  if (!validateListing(listing)) throw new Error('Stored listing failed its public schema.');
  return listing;
}

function safePublicOperation(row: any) {
  const operation = {
    operationId: row.operation_id,
    listingId: row.listing_id,
    proxyId: String(row.proxy_id),
    proxyUrl: `${publicOrigin.replace(/\/$/, '')}/api/proxy/${encodeURIComponent(String(row.proxy_id))}`,
    name: row.name,
    description: row.description,
    method: row.method,
    path: row.path,
    inputSchema: row.input_schema,
    outputSchema: row.output_schema,
    pricing: {
      model: 'fixed-per-call',
      priceLovelace: String(row.price_lovelace),
      effectivePriceLovelace: effectivePriceLovelace(String(row.price_lovelace), row.markup_basis_points, minimumLovelace),
      asset: 'lovelace',
      markupBasisPoints: row.markup_basis_points,
    },
    enabled: row.enabled,
  };
  if (!validateOperation(operation)) throw new Error('Stored operation failed its public schema.');
  return operation;
}

async function getListingOperations(listingId: string, onlyEnabled = false) {
  const result = await pool.query(
    `SELECT * FROM api_operations WHERE listing_id = $1 ${onlyEnabled ? 'AND enabled = TRUE' : ''} ORDER BY operation_id`,
    [listingId],
  );
  return result.rows;
}

async function forwardUpstream(listingId: string, operationId: string, req: Request, preview = false, ownerId?: string) {
  const result = await pool.query(
    `SELECT l.listing_id, l.provider_id, l.availability,
            u.base_url, u.allowed_hosts, u.request_timeout_ms, u.static_headers,
            c.auth_mode, c.auth_field, c.encrypted_secret, c.nonce, c.auth_tag,
            o.operation_id, o.method, o.path, o.input_schema, o.output_schema, o.enabled
       FROM api_listings l
       JOIN upstream_configs u USING (listing_id)
       JOIN api_credentials c USING (listing_id)
       JOIN api_operations o USING (listing_id)
      WHERE l.listing_id = $1 AND o.operation_id = $2`,
    [listingId, operationId],
  );
  const row = result.rows[0];
  if (!row || (ownerId && row.provider_id !== ownerId)) throw Object.assign(new Error('Listing not found.'), { status: 404 });
  if (row.availability !== 'available' || !row.enabled) throw Object.assign(new Error('Operation is unavailable.'), { status: 409 });
  if (!preview && req.method !== row.method) throw Object.assign(new Error(`Use ${row.method} for this operation.`), { status: 405 });

  const input = preview ? (req.body ?? {}) : (row.method === 'GET' || row.method === 'DELETE' ? req.query : (req.body ?? {}));
  const validateInput = ajv.compile(row.input_schema);
  if (!validateInput(input)) throw Object.assign(new Error('Request does not match the operation input schema.'), { status: 400 });

  const requestInput = input as Record<string, unknown>;
  const resolvedRequest = resolveOperationRequest(row.path, requestInput);
  const baseUrl = new URL(row.base_url);
  const destination = new URL(resolvedRequest.path, baseUrl);
  const credential = decryptCredential(row);
  const headers: Record<string, string> = { accept: 'application/json' };
  for (const [name, value] of Object.entries(row.static_headers ?? {})) headers[name] = String(value);
  if (row.auth_mode === 'header') headers[row.auth_field] = credential;
  if (!['GET', 'DELETE'].includes(row.method)) headers['content-type'] = 'application/json';

  const queryOrBody = resolvedRequest.input;
  if (row.method === 'GET' || row.method === 'DELETE') {
    for (const [key, value] of Object.entries(queryOrBody)) {
      if (value === undefined || value === null) continue;
      destination.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
  }
  // The provider's credential takes precedence over untrusted query input.
  if (row.auth_mode === 'query') destination.searchParams.set(row.auth_field, credential);

  let upstream: globalThis.Response;
  try {
    upstream = await safeFetch(destination, row.allowed_hosts, {
      method: row.method,
      headers,
      body: ['GET', 'DELETE'].includes(row.method) ? undefined : JSON.stringify(resolvedRequest.input),
      redirect: 'error',
      signal: AbortSignal.timeout(row.request_timeout_ms),
    });
  } catch {
    throw Object.assign(new Error('Upstream request failed or timed out.'), { status: 502 });
  }
  if (upstream.status === 429) {
    const rawRetryAfter = upstream.headers.get('retry-after');
    const retryAt = rawRetryAfter && Number.isNaN(Number(rawRetryAfter)) ? Date.parse(rawRetryAfter) : NaN;
    const retrySeconds = rawRetryAfter && Number.isFinite(Number(rawRetryAfter))
      ? Number(rawRetryAfter)
      : Number.isFinite(retryAt) ? Math.ceil((retryAt - Date.now()) / 1000) : 30;
    await upstream.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error('Upstream service is rate limited.'), { status: 429, retryAfter: Math.max(1, Math.min(3600, retrySeconds)) });
  }
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error('Upstream service returned an error.'), { status: 502 });
  }

  let payload: unknown;
  try {
    const contentLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 1_048_576) throw new Error('Upstream response is too large.');
    if (!upstream.body) throw new Error('Upstream response is empty.');
    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 1_048_576) {
        await reader.cancel();
        throw new Error('Upstream response is too large.');
      }
      chunks.push(value);
    }
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Upstream response was not valid JSON.'), { status: 502 });
  }
  const validateOutput = ajv.compile(row.output_schema);
  if (!validateOutput(payload)) throw Object.assign(new Error('Upstream response did not match the operation output schema.'), { status: 502 });
  return payload;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/cardano/validate-address', (req, res) => {
  const address = req.body?.address;
  return validPreprodAddress(address)
    ? res.json({ valid: true, network: 'cardano:preprod', address })
    : res.status(400).json({ error: 'Provide a valid Cardano Preprod payment address.' });
});

app.get('/api/provider/listings', async (_req, res, next) => {
  try {
    const listings = await pool.query(
      'SELECT l.*, u.base_url, u.allowed_hosts, u.request_timeout_ms, c.auth_mode, c.auth_field FROM api_listings l JOIN upstream_configs u USING (listing_id) JOIN api_credentials c USING (listing_id) WHERE l.provider_id = $1 ORDER BY l.created_at DESC',
      [defaultProviderId],
    );
    const output = await Promise.all(listings.rows.map(async row => ({
      listingId: row.listing_id,
      name: row.name,
      description: row.description,
      capabilities: row.capabilities,
      availability: row.availability,
      upstreamBaseUrl: row.base_url,
      allowedHosts: row.allowed_hosts,
      requestTimeoutMs: row.request_timeout_ms,
      credentialConfigured: true,
      authMode: row.auth_mode,
      authField: row.auth_field,
      operations: (await getListingOperations(row.listing_id)).map(safePublicOperation),
    })));
    res.json({ items: output });
  } catch (error) { next(error); }
});

app.post(['/api/provider/listings', '/api/registry/services'], async (req, res, next) => {
  let client: PoolClient | undefined;
  try {
    const currentProviderId = defaultProviderId;
    const { listing, upstream, credential, operations } = req.body ?? {};
    if (!isRecord(listing) || !isRecord(upstream) || !isRecord(credential) || !Array.isArray(operations)) {
      throw invalid('Provide listing, upstream, credential, and operations.');
    }
    const listingInput = listing as ListingInput;
    const listingId = listingInput.listingId ?? `listing-${randomUUID()}`;
    const listingName = typeof listingInput.name === 'string' ? listingInput.name.trim() : '';
    const listingDescription = typeof listingInput.description === 'string' ? listingInput.description.trim() : '';
    if (!validId(listingId) || listingName.length < 1 || listingName.length > 160 || listingDescription.length < 1 || listingDescription.length > 4000) {
      throw invalid('Listing needs a valid ID, name, and description.');
    }
    if (!Array.isArray(listingInput.capabilities) || listingInput.capabilities.length === 0 || listingInput.capabilities.length > 20) {
      throw invalid('Provide between one and twenty capabilities.');
    }
    if (listingInput.capabilities.some(value => typeof value !== 'string')) throw invalid('Capabilities must be text values.');
    const capabilities = [...new Set(listingInput.capabilities.map(value => value.trim()))];
    if (capabilities.some(value => value.length < 1 || value.length > 100)) {
      throw invalid('Capability names must contain between one and 100 characters.');
    }

    const baseUrlText = upstream.baseUrl;
    if (typeof baseUrlText !== 'string') throw invalid('Upstream base URL is required.');
    let parsedBaseUrl: URL;
    try { parsedBaseUrl = new URL(baseUrlText); } catch { throw invalid('Upstream base URL must be a valid HTTPS origin.'); }
    let baseUrl: URL;
    try { baseUrl = await assertAllowedDestination(baseUrlText, [parsedBaseUrl.hostname]); }
    catch { throw invalid('Upstream must use a public HTTPS host on port 443.'); }
    if (baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) throw invalid('Upstream base URL must contain only the HTTPS origin.');

    const authMode = credential.mode;
    const authField = credential.field;
    const secret = credential.value;
    if (typeof authMode !== 'string' || !['header', 'query'].includes(authMode) || typeof authField !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(authField)) {
      throw invalid('Credential mode must be header or query, with a simple field name.');
    }
    if (authMode === 'header' && /^(host|cookie|content-length|connection|transfer-encoding)$/i.test(authField)) {
      throw invalid('This HTTP header cannot carry an upstream API key.');
    }
    if (typeof secret !== 'string' || secret.length < 4 || secret.length > 512) throw invalid('Provide a valid upstream API credential.');
    const staticHeadersInput = upstream.staticHeaders ?? {};
    if (!isRecord(staticHeadersInput) || Object.keys(staticHeadersInput).length > 10) throw invalid('Provide at most ten static upstream headers.');
    const staticHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(staticHeadersInput)) {
      if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name) || typeof value !== 'string' || value.length < 1 || value.length > 256) {
        throw invalid('Static upstream headers must use simple names and text values.');
      }
      if (/^(host|cookie|set-cookie|content-length|connection|transfer-encoding)$/i.test(name) || name.toLowerCase() === authField.toLowerCase()) {
        throw invalid('A static upstream header cannot override transport or credential headers.');
      }
      staticHeaders[name] = value;
    }
    const requestTimeoutMs = upstream.requestTimeoutMs ?? 5000;
    if (typeof requestTimeoutMs !== 'number' || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 250 || requestTimeoutMs > 30000) {
      throw invalid('Request timeout must be between 250 and 30,000 milliseconds.');
    }
    if (operations.length === 0 || operations.length > 20) throw invalid('Provide between one and twenty operations.');

    const normalizedOperations = operations.map((raw: unknown, index: number) => {
      if (!isRecord(raw)) throw invalid(`Operation ${index + 1} must be an object.`);
      const operation = raw as OperationInput;
      const operationId = operation.operationId ?? `operation-${randomUUID()}`;
      const proxyId = randomUUID();
      const name = typeof operation.name === 'string' ? operation.name.trim() : '';
      const description = typeof operation.description === 'string' ? operation.description.trim() : '';
      if (!validId(operationId) || name.length < 1 || name.length > 120 || description.length < 1 || description.length > 2000) throw invalid(`Operation ${index + 1} has invalid identifiers or text.`);
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(operation.method)) throw invalid(`Operation ${operationId} has an unsupported method.`);
      if (typeof operation.path !== 'string' || operation.path.length > 2048 || !operation.path.startsWith('/') || operation.path.startsWith('//') || operation.path.includes('?') || operation.path.includes('#') || operation.path.split('/').some(part => part === '..')) {
        throw invalid(`Operation ${operationId} must use a safe absolute path without query or traversal segments.`);
      }
      if (!positiveIntegerString(operation.priceLovelace)) throw invalid(`Operation ${operationId} needs a positive integer lovelace cost.`);
      const markupBasisPoints = operation.markupBasisPoints ?? 200;
      if (!Number.isInteger(markupBasisPoints) || markupBasisPoints < 0 || markupBasisPoints > 1_000_000) throw invalid(`Operation ${operationId} has an invalid markup.`);
      if (!isRecord(operation.inputSchema) || !ajv.validateSchema(operation.inputSchema)) throw invalid(`Operation ${operationId} has an invalid input JSON Schema.`);
      if (!isRecord(operation.outputSchema) || !ajv.validateSchema(operation.outputSchema)) throw invalid(`Operation ${operationId} has an invalid output JSON Schema.`);
      const publicOperation = {
        operationId,
        listingId,
        proxyId,
        proxyUrl: `${publicOrigin.replace(/\/$/, '')}/api/proxy/${proxyId}`,
        name,
        description,
        method: operation.method,
        path: operation.path,
        inputSchema: operation.inputSchema,
        outputSchema: operation.outputSchema,
        pricing: {
          model: 'fixed-per-call',
          priceLovelace: operation.priceLovelace,
          effectivePriceLovelace: effectivePriceLovelace(operation.priceLovelace, markupBasisPoints, minimumLovelace),
          asset: 'lovelace',
          markupBasisPoints,
        },
        enabled: operation.enabled ?? true,
      };
      if (!validateOperation(publicOperation)) throw invalid(`Operation ${operationId} does not match the KeyCard operation contract.`);
      return { ...operation, operationId, proxyId, name, description, markupBasisPoints };
    });
    const operationIds = normalizedOperations.map(operation => operation.operationId);
    if (new Set(operationIds).size !== operationIds.length) throw invalid('Operation IDs must be unique within a listing.');
    if (!normalizedOperations.some(operation => operation.enabled !== false)) throw invalid('Enable at least one operation.');
    const encrypted = encryptCredential(secret);
    const payoutAddress = req.body?.payoutAddress ?? process.env.KEYCARD_PAY_TO;
    if (!validPreprodAddress(payoutAddress)) throw invalid('Provide a valid Cardano Preprod payout address.');

    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO providers (provider_id, name, payout_address)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider_id) DO UPDATE SET payout_address = EXCLUDED.payout_address`,
      [currentProviderId, providerName, payoutAddress],
    );
    const existingListing = await client.query('SELECT provider_id FROM api_listings WHERE listing_id = $1 FOR UPDATE', [listingId]);
    if (existingListing.rows[0] && existingListing.rows[0].provider_id !== currentProviderId) {
      throw Object.assign(new Error('Listing ID is already owned by another provider.'), { status: 409 });
    }
    const savedListing = await client.query(
      `INSERT INTO api_listings (listing_id, provider_id, name, description, capabilities)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (listing_id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, capabilities = EXCLUDED.capabilities, updated_at = now()
       WHERE api_listings.provider_id = EXCLUDED.provider_id
       RETURNING listing_id`,
      [listingId, currentProviderId, listingName, listingDescription, JSON.stringify(capabilities)],
    );
    if (savedListing.rowCount !== 1) throw Object.assign(new Error('Listing ID is already owned by another provider.'), { status: 409 });
    await client.query(
      'DELETE FROM api_operations WHERE listing_id = $1 AND NOT (operation_id = ANY($2::text[]))',
      [listingId, operationIds],
    );
    await client.query(
      `INSERT INTO upstream_configs (listing_id, base_url, allowed_hosts, request_timeout_ms, static_headers)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (listing_id) DO UPDATE SET base_url = EXCLUDED.base_url, allowed_hosts = EXCLUDED.allowed_hosts, request_timeout_ms = EXCLUDED.request_timeout_ms, static_headers = EXCLUDED.static_headers`,
      [listingId, baseUrl.origin, [baseUrl.hostname], requestTimeoutMs, JSON.stringify(staticHeaders)],
    );
    await client.query(
      `INSERT INTO api_credentials (listing_id, auth_mode, auth_field, encrypted_secret, nonce, auth_tag, key_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (listing_id) DO UPDATE SET auth_mode = EXCLUDED.auth_mode, auth_field = EXCLUDED.auth_field, encrypted_secret = EXCLUDED.encrypted_secret, nonce = EXCLUDED.nonce, auth_tag = EXCLUDED.auth_tag, key_version = EXCLUDED.key_version, updated_at = now()`,
      [listingId, authMode, authField, encrypted.encryptedSecret, encrypted.nonce, encrypted.authTag, encrypted.keyVersion],
    );
    for (const operation of normalizedOperations) {
      await client.query(
        `INSERT INTO api_operations (operation_id, listing_id, proxy_id, name, description, method, path, input_schema, output_schema, price_lovelace, markup_basis_points, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (listing_id, operation_id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, method = EXCLUDED.method, path = EXCLUDED.path, input_schema = EXCLUDED.input_schema, output_schema = EXCLUDED.output_schema, price_lovelace = EXCLUDED.price_lovelace, markup_basis_points = EXCLUDED.markup_basis_points, enabled = EXCLUDED.enabled, updated_at = now()`,
        [operation.operationId, listingId, operation.proxyId, operation.name, operation.description, operation.method, operation.path, JSON.stringify(operation.inputSchema), JSON.stringify(operation.outputSchema), operation.priceLovelace, operation.markupBasisPoints, operation.enabled ?? true],
      );
    }
    await client.query('COMMIT');
    const proxyRows = await client.query(
      'SELECT operation_id,proxy_id FROM api_operations WHERE listing_id=$1 ORDER BY operation_id',
      [listingId],
    );
    return res.status(201).json({
      listingId,
      operationIds,
      proxyEndpoints: proxyRows.rows.map(row => ({
        operationId: row.operation_id,
        proxyId: String(row.proxy_id),
        proxyUrl: `${publicOrigin.replace(/\/$/, '')}/api/proxy/${encodeURIComponent(String(row.proxy_id))}`,
      })),
    });
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally {
    client?.release();
  }
});

app.put(['/api/provider/listings/:listingId/credential', '/api/registry/services/:listingId/credential'], async (req, res, next) => {
  try {
    const { mode, field, value } = req.body ?? {};
    if (!['header', 'query'].includes(mode) || typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(field) || typeof value !== 'string' || value.length < 4 || value.length > 512) {
      throw invalid('Provide a valid credential mode, field, and value.');
    }
    if (mode === 'header' && /^(host|cookie|content-length|connection|transfer-encoding)$/i.test(field)) {
      throw invalid('This HTTP header cannot carry an upstream API key.');
    }
    const listing = await pool.query('SELECT listing_id FROM api_listings WHERE listing_id = $1 AND provider_id = $2', [req.params.listingId, defaultProviderId]);
    if (listing.rowCount !== 1) return res.status(404).json({ error: 'Listing not found.' });
    const encrypted = encryptCredential(value);
    await pool.query(
      `UPDATE api_credentials SET auth_mode = $2, auth_field = $3, encrypted_secret = $4, nonce = $5, auth_tag = $6, key_version = $7, updated_at = now() WHERE listing_id = $1`,
      [req.params.listingId, mode, field, encrypted.encryptedSecret, encrypted.nonce, encrypted.authTag, encrypted.keyVersion],
    );
    return res.json({ credentialConfigured: true });
  } catch (error) { return next(error); }
});

app.patch(['/api/provider/listings/:listingId/availability', '/api/registry/services/:listingId/availability'], async (req, res, next) => {
  try {
    const { availability } = req.body ?? {};
    if (!['available', 'temporarily-unavailable', 'disabled'].includes(availability)) throw invalid('Choose a valid listing availability state.');
    const updated = await pool.query(
      'UPDATE api_listings SET availability = $3, updated_at = now() WHERE listing_id = $1 AND provider_id = $2 RETURNING listing_id',
      [req.params.listingId, defaultProviderId, availability],
    );
    if (updated.rowCount !== 1) return res.status(404).json({ error: 'Listing not found.' });
    return res.json({ listingId: req.params.listingId, availability });
  } catch (error) { return next(error); }
});

app.get(['/api/discovery', '/api/registry/services'], async (req, res, next) => {
  try {
    const term = (value: unknown, name: string) => {
      if (value === undefined) return undefined;
      if (typeof value !== 'string') throw invalid(`${name} must be a single string.`);
      const normalized = value.trim().toLowerCase();
      if (!normalized || normalized.length > 100) throw invalid(`${name} must contain 1-100 characters.`);
      return normalized;
    };
    const capability = term(req.query.capability, 'capability');
    const query = term(req.query.query ?? req.query.q, 'query');
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (typeof rawLimit !== 'undefined' && (typeof rawLimit !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 50)) {
      throw invalid('limit must be an integer from 1 to 50.');
    }
    // ponytail: substring ranking scans the MVP registry; add Postgres full-text
    // search or a trigram index when listing volume makes this measurably slow.
    const listingsResult = await pool.query(
      `SELECT l.*,
        ((CASE WHEN $1::text IS NOT NULL AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(l.capabilities) c(value) WHERE lower(c.value) = $1
          ) THEN 100 ELSE 0 END) +
         (CASE WHEN $2::text IS NOT NULL AND (lower(l.name) = $2 OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(l.capabilities) c(value) WHERE lower(c.value) = $2
          )) THEN 80 ELSE 0 END) +
         (CASE WHEN $2::text IS NOT NULL AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(l.capabilities) c(value) WHERE position($2 in lower(c.value)) > 0
          ) THEN 40 ELSE 0 END) +
         (CASE WHEN $2::text IS NOT NULL AND position($2 in lower(l.name)) > 0 THEN 30 ELSE 0 END) +
         (CASE WHEN $2::text IS NOT NULL AND EXISTS (
            SELECT 1 FROM api_operations o WHERE o.listing_id = l.listing_id AND o.enabled = TRUE
              AND (position($2 in lower(o.name)) > 0 OR position($2 in lower(o.description)) > 0)
          ) THEN 20 ELSE 0 END) +
         (CASE WHEN $2::text IS NOT NULL AND position($2 in lower(l.description)) > 0 THEN 10 ELSE 0 END)
        )::integer AS relevance_score
       FROM api_listings l
       WHERE l.availability = 'available'
         AND EXISTS (SELECT 1 FROM api_operations o WHERE o.listing_id = l.listing_id AND o.enabled = TRUE)
         AND ($1::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(l.capabilities) c(value) WHERE lower(c.value) = $1
         ))
         AND ($2::text IS NULL OR position($2 in lower(l.name)) > 0 OR position($2 in lower(l.description)) > 0
           OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.capabilities) c(value) WHERE position($2 in lower(c.value)) > 0)
           OR EXISTS (SELECT 1 FROM api_operations o WHERE o.listing_id = l.listing_id AND o.enabled = TRUE
             AND (position($2 in lower(o.name)) > 0 OR position($2 in lower(o.description)) > 0)))
       ORDER BY relevance_score DESC, l.updated_at DESC
       LIMIT $3`,
      [capability ?? null, query ?? null, limit],
    );
    const items = [];
    for (const row of listingsResult.rows) {
      const operationRows = await getListingOperations(row.listing_id, true);
      const operations = operationRows.map(safePublicOperation);
      items.push({ ...safePublicListing(row, operations), relevanceScore: Number(row.relevance_score), operations });
    }
    return res.json({ query: query ?? null, capability: capability ?? null, count: items.length, items });
  } catch (error) { return next(error); }
});

async function providerPreview(req: Request, res: Response, next: (error?: unknown) => void) {
  try {
    const payload = await forwardUpstream(String(req.params.listingId), String(req.params.operationId), req, true, defaultProviderId);
    res.json({ preview: true, result: payload, requestHash: `sha256:${createHash('sha256').update(JSON.stringify(req.body ?? req.query)).digest('hex')}` });
  } catch (error) { next(error); }
}

app.all('/api/provider/preview/:listingId/:operationId', providerPreview);

const callStore = new PgCallStore(pool);
app.all('/api/proxy/:listingId/:operationId', createPaidHandler({
  store: callStore, gateway: paymentGateway, origin: publicOrigin, quote: issueQuote,
  upstream: req => forwardUpstream(String(req.params.listingId), String(req.params.operationId), req),
}));

app.all('/api/proxy/:proxyId', async (req, res, next) => {
  try {
    const proxyId = String(req.params.proxyId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proxyId)) {
      return res.status(404).json({ error: 'Proxy endpoint not found.' });
    }
    const result = await pool.query(
      'SELECT listing_id,operation_id FROM api_operations WHERE proxy_id=$1',
      [proxyId],
    );
    const operation = result.rows[0];
    if (!operation) return res.status(404).json({ error: 'Proxy endpoint not found.' });
    const handler = createPaidHandler({
      store: callStore,
      gateway: paymentGateway,
      origin: publicOrigin,
      quote: () => issueQuoteForOperation(operation.listing_id, operation.operation_id),
      upstream: request => forwardUpstream(operation.listing_id, operation.operation_id, request),
    });
    return handler(req, res, next);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/registry/services/:listingId', async (req, res, next) => {
  try {
    const listingResult = await pool.query(
      `SELECT * FROM api_listings
       WHERE listing_id = $1 AND availability = 'available'
         AND EXISTS (SELECT 1 FROM api_operations o WHERE o.listing_id = api_listings.listing_id AND o.enabled = TRUE)`,
      [req.params.listingId],
    );
    const listing = listingResult.rows[0];
    if (!listing) return res.status(404).json({ error: 'Service not found.' });
    const operations = (await getListingOperations(listing.listing_id, true)).map(safePublicOperation);
    return res.json({ ...safePublicListing(listing, operations), operations });
  } catch (error) { return next(error); }
});

app.use('/api/provider', providerPaymentsRouter);

// --- Provider-level call endpoint ---
// POST /api/call/:providerId
//   Without PAYMENT-SIGNATURE: returns per-operation fee quotes
//   With PAYMENT-SIGNATURE + operationId: executes the paid call for that operation
app.post('/api/call/:providerId', async (req, res, next) => {
  try {
    const providerId = String(req.params.providerId);
    if (!validId(providerId)) return res.status(400).json({ error: 'Invalid provider ID.' });

    // Look up all enabled operations for this provider
    const listingsResult = await pool.query(
      `SELECT l.listing_id FROM api_listings l
       WHERE l.provider_id = $1 AND l.availability = 'available'`,
      [providerId],
    );
    if (listingsResult.rows.length === 0) return res.status(404).json({ error: 'Provider not found or has no available listings.' });
    const listingIds = listingsResult.rows.map(r => r.listing_id);

    const opsResult = await pool.query(
      `SELECT o.operation_id, o.listing_id, o.name, o.description, o.method, o.path,
              o.input_schema, o.price_lovelace, o.markup_basis_points, o.proxy_id
         FROM api_operations o
        WHERE o.listing_id = ANY($1::text[]) AND o.enabled = TRUE
        ORDER BY o.listing_id, o.operation_id`,
      [listingIds],
    );
    const allOps = opsResult.rows;
    if (allOps.length === 0) return res.status(404).json({ error: 'Provider has no enabled operations.' });

    // If there's a PAYMENT-SIGNATURE, the caller wants to execute a specific operation
    if (req.get('PAYMENT-SIGNATURE')) {
      const operationId = req.body?.operationId;
      if (typeof operationId !== 'string') return res.status(400).json({ error: 'Provide operationId in the request body when paying.' });
      const op = allOps.find(o => o.operation_id === operationId);
      if (!op) return res.status(404).json({ error: `Operation '${operationId}' not found for this provider.` });

      // Delegate to the standard paid-call handler. Rewrite params so forwardUpstream works.
      (req.params as any).listingId = op.listing_id;
      (req.params as any).operationId = op.operation_id;
      // The input for the upstream call is in body.input
      if (req.body?.input !== undefined) req.body = req.body.input;

      const handler = createPaidHandler({
        store: callStore,
        gateway: paymentGateway,
        origin: publicOrigin,
        quote: () => issueQuoteForOperation(op.listing_id, op.operation_id),
        upstream: request => forwardUpstream(op.listing_id, op.operation_id, request),
      });
      return handler(req, res, next);
    }

    // No payment header → return fee quotes for requested operations
    const requested: Array<{ operationId: string; input?: unknown }> = Array.isArray(req.body?.operations) ? req.body.operations : [];
    // If no specific operations requested, quote all available ones
    const opsToQuote = requested.length > 0
      ? requested.map(r => {
          const op = allOps.find(o => o.operation_id === r.operationId);
          if (!op) throw Object.assign(new Error(`Operation '${r.operationId}' not found for this provider.`), { status: 404 });
          return op;
        })
      : allOps;

    const quotes = await Promise.all(opsToQuote.map(async op => {
      const quote = await issueQuoteForOperation(op.listing_id, op.operation_id);
      return {
        operationId: op.operation_id,
        listingId: op.listing_id,
        name: op.name,
        description: op.description,
        method: op.method,
        path: op.path,
        pricing: {
          priceLovelace: String(op.price_lovelace),
          effectivePriceLovelace: effectivePriceLovelace(String(op.price_lovelace), op.markup_basis_points, minimumLovelace),
          asset: 'lovelace',
          markupBasisPoints: op.markup_basis_points,
        },
        paymentRequirements: quote.requirements,
        proxyUrl: `${publicOrigin.replace(/\/$/, '')}/api/proxy/${encodeURIComponent(String(op.proxy_id))}`,
      };
    }));

    return res.json({
      providerId,
      endpoint: `${publicOrigin.replace(/\/$/, '')}/api/call/${encodeURIComponent(providerId)}`,
      operations: quotes,
      usage: {
        step1: 'POST this endpoint with { "operations": [{ "operationId": "...", "input": {...} }] } to get fee quotes.',
        step2: 'POST this endpoint with { "operationId": "...", "input": {...} } plus Idempotency-Key and PAYMENT-SIGNATURE headers to execute a paid call.',
        note: 'Each operation is paid independently. Submit one PAYMENT-SIGNATURE per operation.',
      },
    });
  } catch (error) { next(error); }
});

app.use((error: any, _req: Request, res: Response, _next: unknown) => {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status === 429 && Number.isInteger(error?.retryAfter)) res.setHeader('Retry-After', String(error.retryAfter));
  if (status >= 500) console.error('KeyCard request failed:', error?.message ?? 'Unknown server error');
  return res.status(status).json({ error: status >= 500 ? 'The request could not be completed.' : error.message });
});

export { app };
