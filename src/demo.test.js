import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreview } from './demo.js';

test('discovery selects the cheapest available service, excluding a cheaper unavailable one', () => {
  const preview = createPreview('weather', 'paid');
  assert.equal(preview.provider.name, 'Weather Now');
  assert.equal(preview.matchCount, 2);
  assert.equal(preview.agentCost, 0.01);
});

test('sponsorship covers the cost and verifies adVault before granting access', () => {
  const preview = createPreview('image', 'sponsored');
  assert.equal(preview.provider.price, 0.25);
  assert.equal(preview.agentCost, 0);
  assert.equal(preview.response.paid_by, 'example_sponsor');
  assert.equal(preview.response.demo, true);
  assert.match(preview.steps.at(-2), /receipt verified/);
  assert.match(preview.steps.at(-1), /200 OK/);
});

test('invalid demo selections are rejected', () => {
  assert.throws(() => createPreview('unknown', 'paid'));
  assert.throws(() => createPreview('search', 'unknown'));
  assert.throws(() => createPreview('toString', 'paid'));
});
