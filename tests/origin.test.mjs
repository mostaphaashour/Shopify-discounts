import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOrigin } from '../lib/request-origin.ts';
const request = (origin, host = 'shopify-discounty.netlify.app') => new Request('https://internal/api/shopify', { headers: { ...(origin ? { origin } : {}), host } });
test('HTTPS production and custom domains accepted only for their own host', () => {
  assert.equal(checkOrigin(request('https://shopify-discounty.netlify.app')).secure, true);
  assert.equal(checkOrigin(request('https://app.example.com', 'app.example.com')).local, false);
});
test('foreign, absent, malformed and insecure origins rejected', () => {
  for (const origin of [undefined, 'null', 'https://evil.example', 'http://shopify-discounty.netlify.app', 'https://shopify-discounty.netlify.app/path']) assert.throws(() => checkOrigin(request(origin)));
});
test('local development permitted with matching port', () => {
  assert.equal(checkOrigin(request('http://127.0.0.1:3000', '127.0.0.1:3000')).local, true);
  assert.throws(() => checkOrigin(request('http://127.0.0.1:3001', '127.0.0.1:3000')));
});
