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

test('provider page exposes every registry management feature', async () => {
  const dashboard = await read('../public/provider/index.html');
  for (const feature of ['listing-form', 'preview-form', 'refresh-payments', 'payment-list', 'refresh-listings', 'listing-list']) {
    assert.match(dashboard, new RegExp(`id="${feature}"`));
  }
  assert.match(dashboard, /href="\/provider\/onboard\.html"/);
});

test('onboarding retains direct access to the dashboard', async () => {
  const onboarding = await read('../public/provider/onboard.html');
  assert.match(onboarding, /href="\/provider\/"/);
  for (const provider of ['openai', 'claude', 'gemini', 'elevenlabs', 'custom']) {
    assert.match(onboarding, new RegExp(`data-provider="${provider}"`));
  }
  assert.match(onboarding, /id="custom-spec-flow"/);
  assert.match(onboarding, /id="preset-api-key"/);
});

test('the provider registry and onboarding have no authentication flow', async () => {
  const [onboarding, onboardingScript, dashboardScript] = await Promise.all([
    read('../public/provider/onboard.html'),
    read('../public/provider/onboard.js'),
    read('../public/provider/dashboard.js'),
  ]);

  assert.doesNotMatch(onboarding, /id="dashboard-(?:provider-id|pw)"/);
  assert.doesNotMatch(onboardingScript, /apiFetch\('\/api\/provider\/(?:me|session)'/);
  assert.doesNotMatch(dashboardScript, /provider\/(?:me|session)|sign-in|sign-out|returnTo/);
});
