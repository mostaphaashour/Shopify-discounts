import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseApp, extendOneMonth, expiryMillis } from '../lib/access.ts';
const now = Date.parse('2026-10-04T12:00:00Z');
const paid = { enabled: true, paymentVerified: true, amount: 10, currency: 'USD', plan: 'monthly', expiresAt: '2026-11-04T12:00:00Z' };

test('only the admin can use the app without an approved active subscription', () => {
  assert.equal(canUseApp(true, null, now), true);
  assert.equal(canUseApp(false, null, now), false);
  assert.equal(canUseApp(false, { enabled: true }, now), false);
  assert.equal(canUseApp(false, paid, now), true);
  for (const change of [{ paymentVerified: false }, { enabled: false }, { amount: 0 }, { currency: 'EGP' }, { plan: 'one-time' }, { expiresAt: '2026-10-04T12:00:00Z' }, { expiresAt: 'invalid' }]) {
    assert.equal(canUseApp(false, { ...paid, ...change }, now), false);
  }
});

test('client payment claim does not unlock access', () => {
  assert.equal(canUseApp(false, { status: 'approved', paymentState: 'claimed_paid', enabled: true }, now), false);
});

test('monthly renewal extends an active period and restarts an expired period', () => {
  assert.equal(extendOneMonth(Date.parse('2026-11-04T12:00:00Z'), now).toISOString(), '2026-12-04T12:00:00.000Z');
  assert.equal(extendOneMonth(Date.parse('2026-09-01T12:00:00Z'), now).toISOString(), '2026-11-04T12:00:00.000Z');
});

test('calendar-month expiry clamps end-of-month and handles leap years', () => {
  assert.equal(extendOneMonth(0, Date.parse('2027-01-31T10:00:00Z')).toISOString(), '2027-02-28T10:00:00.000Z');
  assert.equal(extendOneMonth(0, Date.parse('2028-01-31T10:00:00Z')).toISOString(), '2028-02-29T10:00:00.000Z');
  assert.equal(expiryMillis({ expiresAt: { toMillis: () => now } }), now);
});
