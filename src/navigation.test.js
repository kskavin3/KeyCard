import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('public navigation exposes the demo and both provider workflows', async () => {
  const home = await read('../index.html');
  for (const target of ['#how-it-works', '#playground', '/provider/', '/provider/onboard.html']) {
    assert.match(home, new RegExp(`href=["']${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
  }
});

test('provider page exposes every authenticated management feature', async () => {
  const dashboard = await read('../public/provider/index.html');
  for (const feature of ['listing-form', 'preview-form', 'refresh-payments', 'payment-list', 'refresh-listings', 'listing-list']) {
    assert.match(dashboard, new RegExp(`id="${feature}"`));
  }
  assert.match(dashboard, /href="\/provider\/onboard\.html"/);
});

test('onboarding retains direct access to the dashboard', async () => {
  const onboarding = await read('../public/provider/onboard.html');
  assert.match(onboarding, /href="\/provider\/"/);
});
