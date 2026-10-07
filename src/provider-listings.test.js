import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const database = process.env.KEYCARD_TEST_DATABASE_URL;
test('provider listing ownership, validation, scoped operations and discovery', {
  skip: !database && 'Set KEYCARD_TEST_DATABASE_URL for provider listing integration tests.',
}, async () => {
  const schema = `keycard_listing_test_${randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: database });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(database);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  process.env.KEYCARD_PROVIDER_ID = 'provider-test';
  process.env.KEYCARD_PROVIDER_NAME = 'Listing Test Provider';
  process.env.KEYCARD_ENCRYPTION_KEY = randomBytes(32).toString('base64');

  const pool = new Pool({ connectionString: url.href });
  let server, appPool;
  try {
    await pool.query(await readFile(new URL('../src/server/schema.sql', import.meta.url), 'utf8'));
    await pool.query("INSERT INTO providers(provider_id,name) VALUES('provider-test','Test'),('provider-other','Other')");
    await pool.query("INSERT INTO api_listings(listing_id,provider_id,name,description,capabilities) VALUES('owned-by-other','provider-other','Original','Untouched',$1)", [JSON.stringify(['other'])]);
    await pool.query("INSERT INTO upstream_configs(listing_id,base_url,allowed_hosts) VALUES('owned-by-other','https://example.com',ARRAY['example.com'])");
    await pool.query("INSERT INTO api_credentials(listing_id,auth_mode,auth_field,encrypted_secret,nonce,auth_tag) VALUES('owned-by-other','header','x-api-key','original','nonce','tag')");
    await pool.query(`INSERT INTO api_operations(operation_id,listing_id,name,description,method,path,input_schema,output_schema,price_lovelace)
      VALUES('shared','owned-by-other','Other operation','Owned by another provider','GET','/',
        '{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,1500000)`);

    const { app } = await import('./server/app.ts');
    ({ pool: appPool } = await import('./server/db.ts'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const payoutAddress = 'addr_test1qqul6su3r8wjg7904fdxz2r8753fju9tmpt42xecxqh86e8varjpg3ku0cuglt0rl0ckg59mx779xdffzyhrlfwmhgrsttpen0';
    const payload = listingId => ({
      listing: { listingId, name: `Listing ${listingId}`, description: 'A valid listing.', capabilities: ['search'] },
      upstream: { baseUrl: 'https://example.com', requestTimeoutMs: 5000, staticHeaders: { 'anthropic-version': '2023-06-01' } },
      credential: { mode: 'header', field: 'x-api-key', value: 'secret-value' },
      operations: [{ operationId: 'shared', name: 'Search', description: 'Search operation.', method: 'GET', path: '/',
        inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, priceLovelace: '1500000', enabled: true }],
      payoutAddress,
    });
    const save = body => fetch(`${origin}/api/registry/services`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });

    const firstSave = await save(payload('mine-one'));
    assert.equal(firstSave.status, 201);
    const firstResult = await firstSave.json();
    assert.match(firstResult.proxyEndpoints[0].proxyId, /^[0-9a-f-]{36}$/);
    assert.match(firstResult.proxyEndpoints[0].proxyUrl, /\/api\/proxy\/[0-9a-f-]{36}$/);
    const storedHeaders = (await pool.query("SELECT static_headers FROM upstream_configs WHERE listing_id='mine-one'")).rows[0].static_headers;
    assert.deepEqual(storedHeaders, { 'anthropic-version': '2023-06-01' });
    const secondSave = await save(payload('mine-two'));
    assert.equal(secondSave.status, 201, 'operation IDs must be scoped to each listing');
    const secondResult = await secondSave.json();
    assert.notEqual(firstResult.proxyEndpoints[0].proxyId, secondResult.proxyEndpoints[0].proxyId);
    const update = await save({ ...payload('mine-one'), listing: { ...payload('mine-one').listing, description: 'Updated safely.' } });
    assert.equal(update.status, 201);
    assert.equal((await update.json()).proxyEndpoints[0].proxyId, firstResult.proxyEndpoints[0].proxyId, 'proxy IDs must remain stable across updates');

    const takeover = payload('owned-by-other');
    takeover.listing.name = 'Hijacked';
    assert.equal((await save(takeover)).status, 409);
    const preserved = (await pool.query(`SELECT l.provider_id,l.name,u.base_url,c.encrypted_secret
      FROM api_listings l JOIN upstream_configs u USING(listing_id) JOIN api_credentials c USING(listing_id)
      WHERE listing_id='owned-by-other'`)).rows[0];
    assert.deepEqual(preserved, { provider_id: 'provider-other', name: 'Original', base_url: 'https://example.com', encrypted_secret: 'original' });

    const invalidText = payload('invalid-text');
    invalidText.listing.name = '   ';
    assert.equal((await save(invalidText)).status, 400);
    const invalidCapability = payload('invalid-capability');
    invalidCapability.listing.capabilities = [{ nested: true }];
    assert.equal((await save(invalidCapability)).status, 400);
    const duplicateOperations = payload('duplicate-operations');
    duplicateOperations.operations.push({ ...duplicateOperations.operations[0] });
    assert.equal((await save(duplicateOperations)).status, 400);
    const noEnabledOperations = payload('no-enabled-operations');
    noEnabledOperations.operations[0].enabled = false;
    assert.equal((await save(noEnabledOperations)).status, 400);

    const discovery = await (await fetch(`${origin}/api/discovery?capability=search`)).json();
    assert.deepEqual(discovery.items.map(item => item.listingId).sort(), ['mine-one', 'mine-two']);
    assert.equal(discovery.items.every(item => item.operations[0].pricing.asset === 'lovelace'), true);
    assert.equal(discovery.items.every(item => item.operations[0].proxyUrl.endsWith(item.operations[0].proxyId)), true);
    const registrySearch = await (await fetch(`${origin}/api/registry/services?q=updated`)).json();
    assert.deepEqual(registrySearch.items.map(item => item.listingId), ['mine-one']);
    const service = await (await fetch(`${origin}/api/registry/services/mine-one`)).json();
    assert.equal(service.listingId, 'mine-one');
    const relevant = await (await fetch(`${origin}/api/discovery?query=search&limit=1`)).json();
    assert.deepEqual({ query: relevant.query, count: relevant.count }, { query: 'search', count: 1 });
    assert.equal(relevant.items[0].relevanceScore > 0, true);
    assert.equal((await (await fetch(`${origin}/api/discovery?query=missing`)).json()).count, 0);
    assert.equal((await fetch(`${origin}/api/discovery?limit=0`)).status, 400);
    const proxyPath = new URL(discovery.items[0].operations[0].proxyUrl).pathname;
    const challenge = await fetch(`${origin}${proxyPath}`, {
      headers: { 'Idempotency-Key': randomBytes(32).toString('hex') },
    });
    assert.equal(challenge.status, 402, 'the opaque proxy route must resolve and issue an x402 challenge');
    assert.ok(challenge.headers.get('payment-required'));
    const legacyChallenge = await fetch(`${origin}/api/proxy/${discovery.items[0].listingId}/${discovery.items[0].operations[0].operationId}`, {
      headers: { 'Idempotency-Key': randomBytes(32).toString('hex') },
    });
    assert.equal(legacyChallenge.status, 402, 'the existing two-part route must remain compatible');
    assert.equal((await fetch(`${origin}/api/proxy/not-a-proxy-id`)).status, 404);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    if (appPool) await appPool.end();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
