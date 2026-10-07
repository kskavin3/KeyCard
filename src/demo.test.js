import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreview } from './demo.js';

test('discovery selects the cheapest available service, excluding a cheaper unavailable one', () => {
  const preview = createPreview('weather', 'paid');
  assert.equal(preview.provider.name, 'Weather Now');
  assert.equal(preview.matchCount, 2);
  assert.equal(preview.agentCost, 0.01);
});

test('invalid demo selections are rejected', () => {
  assert.throws(() => createPreview('unknown', 'paid'));
  assert.throws(() => createPreview('search', 'unknown'));
  assert.throws(() => createPreview('toString', 'paid'));
});
