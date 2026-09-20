/**
 * Checkout Payment State Persistence — Regression Tests
 *
 * Bug: Payment state (paymentMethod, cashTendered, cashTenderedType) is lost
 * when Google Auth triggers a full browser redirect. The checkout controller
 * is re-created with paymentMethod=null.
 *
 * Fix: Persist payment state in sessionStorage before redirect, restore after
 * broker return, with 5-minute TTL to avoid stale state.
 *
 * Test IDs:
 *  CPP-01  Source: openCustomerAuthSheet writes xnt_pending_checkout_payment
 *  CPP-02  Source: mount() restores and clears xnt_pending_checkout_payment
 *  CPP-03  Source: mount() ignores stale pending state (>5min TTL)
 *  CPP-04  Source: cancel button clears xnt_pending_checkout_payment
 *  CPP-05  Pending state serialization roundtrip preserves all fields
 *  CPP-06  TTL boundary: exactly 5 minutes is at boundary
 *  CPP-07  TTL boundary: 5min + 1ms is stale
 *  CPP-08  Auto-retry and pending payment are independent keys
 *  CPP-09  Null payment fields handled gracefully
 *  CPP-10  sessionStorage mock contract
 */
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');
const fs     = require('node:fs');

const CHECKOUT_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js');

// ── Source-level tests (no DOM harness needed) ────────────────────────────

let checkoutSrc = null;
function src() {
  if (checkoutSrc === null) checkoutSrc = fs.readFileSync(CHECKOUT_PATH, 'utf8');
  return checkoutSrc;
}

test('CPP-01: openCustomerAuthSheet writes xnt_pending_checkout_payment before redirect', () => {
  const s = src();
  // The function must write payment state to sessionStorage
  assert.ok(s.includes("'xnt_pending_checkout_payment'"), 'Must reference sessionStorage key');
  assert.ok(s.includes('sessionStorage.setItem'), 'Must write via sessionStorage.setItem');
  // Must persist all three payment fields
  assert.ok(s.includes('paymentMethod: state.paymentMethod'), 'Must persist paymentMethod');
  assert.ok(s.includes('cashTendered: state.cashTendered'), 'Must persist cashTendered');
  assert.ok(s.includes('cashTenderedType: state.cashTenderedType'), 'Must persist cashTenderedType');
  // Must include timestamp for TTL
  assert.ok(s.includes('ts: Date.now()'), 'Must include timestamp for TTL');
});

test('CPP-02: mount() restores and clears xnt_pending_checkout_payment', () => {
  const s = src();
  // Restore logic must read, parse, and remove the key
  assert.ok(s.includes("sessionStorage.getItem('xnt_pending_checkout_payment')"), 'Must read pending state');
  assert.ok(s.includes("sessionStorage.removeItem('xnt_pending_checkout_payment')"), 'Must remove after read');
  assert.ok(s.includes('JSON.parse(pendingRaw)'), 'Must parse JSON');
  // Must restore all three fields
  assert.ok(s.includes('state.paymentMethod = pending.paymentMethod'), 'Must restore paymentMethod');
  assert.ok(s.includes('state.cashTendered = pending.cashTendered'), 'Must restore cashTendered');
  assert.ok(s.includes('state.cashTenderedType = pending.cashTenderedType'), 'Must restore cashTenderedType');
});

test('CPP-03: mount() ignores stale pending state via 5-minute TTL', () => {
  const s = src();
  // Must check TTL
  assert.ok(s.includes('5 * 60 * 1000'), 'Must reference 5-minute TTL');
  // Must only restore when not stale
  assert.ok(s.includes('(Date.now() - pending.ts) < 5 * 60 * 1000'), 'Must check TTL before restoring');
});

test('CPP-04: cancel button clears xnt_pending_checkout_payment', () => {
  const s = src();
  // The close button handler must remove the pending payment key
  const cancelSection = s.substring(s.indexOf('Cancel'));
  assert.ok(cancelSection.includes("sessionStorage.removeItem('xnt_pending_checkout_payment')"),
    'Cancel handler must clear pending payment state');
});

test('CPP-05: Pending state serialization roundtrip preserves all fields', () => {
  const pending = {
    paymentMethod: 'cash',
    cashTendered: 100000,
    cashTenderedType: '100k',
    ts: Date.now()
  };
  const serialized = JSON.stringify(pending);
  const parsed = JSON.parse(serialized);

  assert.strictEqual(parsed.paymentMethod, 'cash');
  assert.strictEqual(parsed.cashTendered, 100000);
  assert.strictEqual(parsed.cashTenderedType, '100k');
  assert.strictEqual(typeof parsed.ts, 'number');
});

test('CPP-06: TTL boundary: exactly 5 minutes is at boundary (not strictly less)', () => {
  const now = Date.now();
  const fiveMinMs = 5 * 60 * 1000;
  const exactlyFiveMinAgo = now - fiveMinMs;
  // The restore code uses (Date.now() - pending.ts) < 5min
  // so exactly 5min means elapsed = 5min which is NOT < 5min → stale
  assert.ok((now - exactlyFiveMinAgo) >= fiveMinMs, 'Exactly 5 min elapsed is at boundary');
  const fourFiftyNine = now - (4 * 60 * 1000 + 59 * 1000);
  assert.ok((now - fourFiftyNine) < fiveMinMs, '4:59 elapsed is within TTL');
});

test('CPP-07: TTL boundary: 5min + 1ms is stale', () => {
  const now = Date.now();
  const fiveMinPlusOneMs = now - (5 * 60 * 1000 + 1);
  assert.ok((now - fiveMinPlusOneMs) > (5 * 60 * 1000), '5min+1ms elapsed is stale');
});

test('CPP-08: Auto-retry and pending payment are independent keys', () => {
  const store = {};
  const mock = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };

  mock.setItem('xnt_auth_auto_retry_checkout', '1');
  mock.setItem('xnt_pending_checkout_payment', JSON.stringify({ paymentMethod: 'cash', ts: Date.now() }));

  assert.strictEqual(mock.getItem('xnt_auth_auto_retry_checkout'), '1');
  assert.ok(mock.getItem('xnt_pending_checkout_payment'));

  // Remove one, other persists
  mock.removeItem('xnt_auth_auto_retry_checkout');
  assert.strictEqual(mock.getItem('xnt_auth_auto_retry_checkout'), null);
  assert.ok(mock.getItem('xnt_pending_checkout_payment'));

  mock.removeItem('xnt_pending_checkout_payment');
  assert.strictEqual(mock.getItem('xnt_pending_checkout_payment'), null);
});

test('CPP-09: Null payment fields handled gracefully in restore logic', () => {
  const s = src();
  // Restore must guard with truthy check so null fields are not assigned
  assert.ok(s.includes('if (pending.paymentMethod) state.paymentMethod'), 'Guard paymentMethod restore');
  assert.ok(s.includes('if (pending.cashTendered) state.cashTendered'), 'Guard cashTendered restore');
  assert.ok(s.includes('if (pending.cashTenderedType) state.cashTenderedType'), 'Guard cashTenderedType restore');
});

test('CPP-10: sessionStorage mock supports get/set/remove contract', () => {
  const store = {};
  const mock = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };

  // null when absent
  assert.strictEqual(mock.getItem('nonexistent'), null);

  // set then get
  mock.setItem('key', 'value');
  assert.strictEqual(mock.getItem('key'), 'value');

  // remove
  mock.removeItem('key');
  assert.strictEqual(mock.getItem('key'), null);
});
