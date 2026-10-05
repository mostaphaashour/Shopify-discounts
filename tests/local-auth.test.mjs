import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_COOKIE, localAuthEnabled, loginLocal, localUser, logoutLocal } from '../lib/local-auth.ts';
import { requireUser } from '../lib/firebase-server.ts';
const request = (cookie = '', host = '127.0.0.1:3000') => new Request('http://127.0.0.1:3000/api/shopify', { headers: { host, cookie } });

test('temporary account requires real credentials and authorizes the server with a cookie', async () => {
  assert.equal(localUser(request()), null);
  assert.throws(() => loginLocal(request(), 'admin', 'wrong'));
  const id = loginLocal(request(), 'admin', 'SkuLocal!8n4R27');
  const loggedIn = request(`${LOCAL_COOKIE}=${id}`);
  assert.ok(localUser(loggedIn));
  assert.equal((await requireUser(loggedIn)).uid, `temporary:${id}`);
  assert.equal(localUser(request(`${LOCAL_COOKIE}=fake`)), null);
  assert.equal(localUser(request(`${LOCAL_COOKIE}=${id}`, 'example.com')), null);
  logoutLocal(loggedIn);
  assert.equal(localUser(loggedIn), null);
  await assert.rejects(requireUser(loggedIn), error => error.status === 401);
});

test('temporary login disables when Firebase is configured or explicitly switched off', () => {
  const names = ['NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_APP_ID', 'LOCAL_TEMP_LOGIN'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names.slice(0, 4)) process.env[name] = 'configured-test-value';
    assert.equal(localAuthEnabled(), false);
    assert.throws(() => loginLocal(request(), 'admin', 'SkuLocal!8n4R27'));
    for (const name of names.slice(0, 4)) delete process.env[name];
    process.env.LOCAL_TEMP_LOGIN = 'false';
    assert.equal(localAuthEnabled(), false);
  } finally {
    for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  }
});
