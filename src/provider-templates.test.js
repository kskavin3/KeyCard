import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerTemplates, cloneProviderTemplate } from '../public/provider/provider-templates.js';

test('preconfigured providers have safe HTTPS origins, credentials and usable operations', () => {
  assert.deepEqual(Object.keys(providerTemplates), ['openai', 'claude', 'gemini', 'elevenlabs']);
  for (const template of Object.values(providerTemplates)) {
    const origin = new URL(template.baseUrl);
    assert.equal(origin.protocol, 'https:');
    assert.equal(origin.pathname, '/');
    assert.ok(['header', 'query'].includes(template.credential.mode));
    assert.ok(template.credential.field);
    assert.ok(template.operations.length > 0);
    assert.ok(template.operations.length <= 20);
    assert.equal(template.catalogUpdatedAt, '2026-10-07');
    assert.match(template.docsUrl, /^https:\/\//);
    const operationIds = new Set();
    for (const operation of template.operations) {
      assert.match(operation.id, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
      assert.equal(operationIds.has(operation.id), false);
      operationIds.add(operation.id);
      assert.match(operation.path, /^\/(?!\/)/);
      assert.ok(operation.name);
      assert.ok(operation.description);
      assert.ok(operation.inputSchema && operation.outputSchema);
    }
  }
  assert.equal(providerTemplates.claude.staticHeaders['anthropic-version'], '2023-06-01');
  assert.equal(providerTemplates.gemini.credential.field, 'x-goog-api-key');
  assert.equal(providerTemplates.elevenlabs.operations.find(operation => operation.id === 'text-to-speech').outputSchema.required[0], 'audio_base64');
  assert.deepEqual(Object.fromEntries(Object.entries(providerTemplates).map(([id, template]) => [id, template.operations.length])), {
    openai: 20, claude: 19, gemini: 20, elevenlabs: 12,
  });
});

test('provider templates are cloned before wizard edits', () => {
  const copy = cloneProviderTemplate('openai');
  copy.operations[0].priceAda = '99';
  assert.equal(providerTemplates.openai.operations[0].priceAda, '1.5');
  assert.equal(cloneProviderTemplate('missing'), null);
});
