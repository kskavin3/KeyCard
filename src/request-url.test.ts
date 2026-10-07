import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicRequestUrl, withoutVercelRewriteQuery } from './server/request-url.js';

const route = '/api/proxy/17d76e4c-4344-467b-845b-3f0dd2ec14e5';
const injected = 'proxy%2F17d76e4c-4344-467b-845b-3f0dd2ec14e5';

test('payment resource URL omits Vercel routing query and preserves caller query', () => {
  const url = publicRequestUrl(
    `${route}?city=Singapore&path=${injected}`,
    route,
    'https://key-card-one.vercel.app',
    true,
  );
  assert.equal(url, `https://key-card-one.vercel.app${route}?city=Singapore`);
});

test('only one matching rewrite parameter is removed when caller also supplied path', () => {
  const url = publicRequestUrl(
    `${route}?path=${injected}&path=custom%2Fvalue`,
    route,
    'https://key-card-one.vercel.app',
    true,
  );
  assert.equal(url, `https://key-card-one.vercel.app${route}?path=custom%2Fvalue`);
});

test('ordinary path query is preserved outside Vercel', () => {
  const url = publicRequestUrl(
    `${route}?path=${injected}`,
    route,
    'https://key-card-one.vercel.app',
    false,
  );
  assert.equal(url, `https://key-card-one.vercel.app${route}?path=${injected}`);
});

test('upstream query removes only Vercel routing value', () => {
  assert.deepEqual(withoutVercelRewriteQuery({ city: 'Singapore', path: ['caller', route.slice('/api/'.length)] }, route, true), {
    city: 'Singapore', path: 'caller',
  });
});
