import test from 'node:test';
import assert from 'node:assert/strict';
import { adaToLovelace, applyMarkupLovelace, effectivePriceLovelace, formatLovelace } from './server/money.ts';
import { adaToLovelace as browserAdaToLovelace, formatAda } from '../public/provider/money.js';

test('ADA values round-trip through canonical integer lovelace', () => {
  assert.equal(adaToLovelace('2.5'), '2500000');
  assert.equal(adaToLovelace('0.000001'), '1');
  assert.equal(formatLovelace('2500000'), '2.5');
  assert.throws(() => adaToLovelace('0.0000001'), /six decimal/);
  assert.equal(browserAdaToLovelace('2.5'), '2500000');
  assert.equal(formatAda('2500000'), '2.500000 ADA');
});

test('markup rounds upward and the Cardano minimum is explicit', () => {
  assert.equal(applyMarkupLovelace('2500000', 200), '2550000');
  assert.equal(applyMarkupLovelace('1', 1), '2');
  assert.equal(effectivePriceLovelace('100000', 0, 1500000n), '1500000');
});
