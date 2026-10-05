import test from 'node:test';
import assert from 'node:assert/strict';
import { requireUser } from '../lib/firebase-server.ts';

test('missing or non-Bearer authentication is rejected before any Shopify call', async () => {
  for (const headers of [{}, { authorization: 'Basic anything' }]) {
    await assert.rejects(requireUser(new Request('http://127.0.0.1:3000/api/shopify', { headers })), error => error.status === 401);
  }
});

test('Firebase configuration is fail-closed, and forged tokens do not grant access', async () => {
  const previous = process.env.FIREBASE_PROJECT_ID;
  const oldPublic = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const oldEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  try {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const request = () => new Request('http://127.0.0.1:3000/api/shopify', { headers: { authorization: 'Bearer invalid-token' } });
    await assert.rejects(requireUser(request()), error => error.status === 503);
    process.env.FIREBASE_PROJECT_ID = 'sku-tests';
    await assert.rejects(requireUser(request()), error => error.status === 401);
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    await assert.rejects(requireUser(request()), error => error.status === 503);
  } finally {
    for (const [key, value] of Object.entries({ FIREBASE_PROJECT_ID: previous, NEXT_PUBLIC_FIREBASE_PROJECT_ID: oldPublic, FIREBASE_AUTH_EMULATOR_HOST: oldEmulator })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
