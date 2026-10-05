import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encodeSession, decodeSession, sessionCookie, MAX_SESSION_AGE } from '../lib/session-cookie.ts';

test('encrypted session survives requests, binds user, rejects tampering and expires', () => {
  const previous = process.env.SESSION_ENCRYPTION_KEY;
  try {
    process.env.SESSION_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    const now = Date.now();
    const session = { uid: 'user-a', shop: 'test.myshopify.com', clientId: 'client', secret: 'private-secret', token: 'private-token', createdAt: now, expiresAt: now + MAX_SESSION_AGE, currency: 'USD', name: 'Shop' };
    const cookie = encodeSession(session, false);
    assert.deepEqual(decodeSession(cookie, 'user-a', false, now), session);
    assert.equal(cookie.includes(session.secret), false);
    assert.equal(decodeSession(cookie, 'user-b', false, now), null);
    assert.equal(decodeSession(cookie, 'user-a', false, now + MAX_SESSION_AGE), null);
    const tampered = Buffer.from(cookie, 'base64url'); tampered[30] ^= 1;
    assert.equal(decodeSession(tampered.toString('base64url'), 'user-a', false, now), null);
    assert.throws(() => encodeSession({ ...session, secret: 'x'.repeat(4000) }, false), /حد الكوكي/);
    process.env.SESSION_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    assert.equal(decodeSession(cookie, 'user-a', false, now), null);
    delete process.env.SESSION_ENCRYPTION_KEY;
    assert.throws(() => encodeSession(session, false), /SESSION_ENCRYPTION_KEY/);
  } finally {
    if (previous === undefined) delete process.env.SESSION_ENCRYPTION_KEY; else process.env.SESSION_ENCRYPTION_KEY = previous;
  }
});
test('cookie uses secure browser flags and deletion expires it', () => {
  assert.match(sessionCookie('value', true), /HttpOnly; SameSite=Strict; Path=\/api\/shopify; Max-Age=86400; Secure/);
  assert.match(sessionCookie('', true, 0), /Max-Age=0; Secure/);
});
