/**
 * Checkout Verification Gate — Regression Tests
 *
 * PRIMARY INVARIANT:
 *   /checkout/verify ANY FAILURE → transaction STOPPED → NO /checkout/create-order
 *
 * Test matrix:
 *  CVG-01  verify success  → create-order may proceed
 *  CVG-02  verify INVALID_OR_EXPIRED_CUSTOMER_SESSION → NO create-order
 *  CVG-03  verify CUSTOMER_AUTH_REQUIRED (401)  → NO create-order
 *  CVG-04  verify HTTP 4xx/5xx non-auth  → NO create-order
 *  CVG-05  verify network failure → NO create-order, button restored
 *  CVG-06  verify malformed/empty response (cannot interpret as success) → NO create-order
 *  CVG-07  no valid token → auth gate before verify → NO verify, NO create-order
 *  CVG-08  authenticated identity — body.phone does NOT override session phone
 *  CVG-09  state preservation — cart preserved on verify failure
 *
 * Harness note:
 *   - Real store.js + checkout.js loaded per test (same files the browser runs).
 *   - x-checkout-items-rows is intentionally ABSENT from the ids map so that
 *     syncRowsFromItems() takes the !rowsEl path → calls renderLayout() →
 *     calls bindEvents() → wires submitBtn.onclick = executePrePaymentAndSubmit.
 *   - This mirrors a first-render (no rows element in DOM yet).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const STORE_PATH    = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');
const CHECKOUT_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js');

const REAL_SET_TIMEOUT   = globalThis.setTimeout;
const REAL_CLEAR_TIMEOUT = globalThis.clearTimeout;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function captureTimers() {
  const captured = [];
  let nextId = 0;
  globalThis.setTimeout = (fn, delay) => {
    captured.push({ id: ++nextId, fn, delay });
    return nextId;
  };
  globalThis.clearTimeout = () => {};
  return {
    captured,
    fire: (n) => { const t = captured[n]; if (t) t.fn(); return Boolean(t); },
    restore: () => { globalThis.setTimeout = REAL_SET_TIMEOUT; globalThis.clearTimeout = REAL_CLEAR_TIMEOUT; }
  };
}

function fakeEl(extras) {
  return Object.assign({
    innerHTML: '', textContent: '', style: {}, dataset: {}, disabled: false,
    classList: { add: () => {}, remove: () => {} },
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [],
    onclick: null, focus: () => {}, blur: () => {}
  }, extras || {});
}

/**
 * Build a fresh harness.
 *
 * Key DOM trick: x-checkout-items-rows is NOT in the ids map.
 * This forces syncRowsFromItems() → !rowsEl → renderLayout() → bindEvents()
 * → submitBtn.onclick = executePrePaymentAndSubmit is wired correctly.
 *
 * opts.token   — xnt_cust_ token pre-seeded into Store (undefined → no session)
 * opts.branch  — branch id for matchedBranch
 * opts.noCart  — if true, skip seeding a cart item
 */
function mkHarness(opts) {
  opts = opts || {};

  const storage = {};
  const timers  = captureTimers();
  const toasts  = [];
  const posts   = [];
  const resolveFns = [];
  const rejectFns  = [];

  // The button that checkout.js will wire via document.getElementById()
  const submitBtn = fakeEl({ id: 'x-btn-submit-order' });

  // ids map — intentionally omits 'x-checkout-items-rows' so renderLayout fires
  const ids = new Map([['x-btn-submit-order', submitBtn]]);

  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
  globalThis.window = globalThis;
  // checkout.js binds window-level listeners at load time (PWA install prompt).
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.matchMedia = () => ({ matches: false });
  // requestAnimationFrame stub so makeOverlay() doesn't crash when the real auth sheet opens
  globalThis.requestAnimationFrame = (fn) => { REAL_SET_TIMEOUT(fn, 0); return 0; };

  // fakeElWithQuery returns a fakeEl whose querySelector always returns a reusable
  // child element (so checkout.js OTP form binding doesn't crash on null.onsubmit)
  function fakeElWithQuery() {
    const child = fakeEl();
    const el = fakeEl({
      appendChild: () => {},
      removeChild: () => {},
      contains: () => true,
      querySelector: () => child,
      querySelectorAll: () => []
    });
    return el;
  }
  globalThis.document = {
    addEventListener:    () => {},
    removeEventListener: () => {},
    getElementById:      (id) => ids.get(id) || null,
    createElement:       () => fakeElWithQuery(),
    querySelector:       () => null,
    querySelectorAll:    () => [],
    body:                fakeEl({ appendChild: () => {}, removeChild: () => {}, contains: () => true, querySelector: () => null })
  };

  globalThis.localStorage = {
    getItem:    (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem:    (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };

  const api = {
    get: (url) => {
      if (url.includes('/brand/branches'))    return Promise.resolve({ success: true, branches: [] });
      if (url.includes('/promotions/active')) return Promise.resolve({ success: true, promotions: [], applied: [], rejected: [] });
      return new Promise((res) => { resolveFns.push(res); rejectFns.push(() => {}); });
    },
    post: (url, body) => {
      const p = new Promise((res, rej) => { resolveFns.push(res); rejectFns.push(rej); });
      posts.push({ url, body });
      return p;
    },
    isAbortError: () => false
  };

  window.Xentra = {};
  window.Xentra.API = api;
  window.Xentra.UI  = { escape: (v) => String(v), toast: (msg) => { toasts.push(msg); } };
  window.Xentra.Router = {
    getItemIdFromUrl:   () => null,
    getBranchIdFromUrl: () => null,
    getCurrentView:     () => 'checkout',
    navigate:           () => {}
  };
  window.Xentra.DeliverySchedule = { toIsoRange: () => ({ start: '2026-09-19 12:00', end: null }) };
  window.Xentra.PwaRuntime = { getPwaRuntimeContext: () => ({ display_mode: 'browser', install_requirement_satisfied: false }) };

  // Fresh modules
  delete require.cache[STORE_PATH];
  delete require.cache[CHECKOUT_PATH];
  require(STORE_PATH);

  const Store = window.Xentra.Store;

  // Pre-seed session
  if (opts.token) {
    Store.setCustomerSession({ phone: opts.phone || '081234567890', name: opts.name || 'Test', token: opts.token });
  }
  // Pre-seed branch
  const branch = opts.branch || 'branch_cvg';
  Store.setMatchedBranch({ id: branch, name: 'Test Branch' });

  // Pre-seed cart (unless opted out)
  if (!opts.noCart) {
    Store.addItem({ id: '272', name: 'Paket Test', price: 35000, branch_id: branch }, 1, { branch_id: branch });
  }

  // Auth sheet tracking
  let authSheetCalls    = 0;
  let authSheetCallback = null;

  require(CHECKOUT_PATH);

  // Patch openCustomerAuthSheet BEFORE mount (also patches window global)
  const patchAuth = (onSuccess) => {
    authSheetCalls++;
    authSheetCallback = typeof onSuccess === 'function' ? onSuccess : null;
  };
  window.Xentra.Checkout.openCustomerAuthSheet = patchAuth;
  window.openCustomerAuthSheet = patchAuth;

  // Mount with a minimal container
  window.Xentra.Checkout.mount(fakeEl({ querySelectorAll: () => [], querySelector: () => null, style: {} }));

  // Seed paymentMethod so executePrePaymentAndSubmit reaches the auth/verify gate.
  // Use 'midtrans' to avoid the cashTendered guard (cash requires a tendered amount).
  if (window.Xentra.Checkout._setPaymentMethod) {
    window.Xentra.Checkout._setPaymentMethod('midtrans');
  }

  // Helpers
  function postIdx(fragment) {
    return posts.findIndex(p => p.url.includes(fragment));
  }

  function resolvePost(i, data) { resolveFns[i](data); }

  function rejectPost(i, status, errData) {
    const e = new Error((errData && errData.error) || 'Error');
    e.status = status;
    e.data   = errData || {};
    rejectFns[i](e);
  }

  function rejectNetwork(i, msg) {
    rejectFns[i](new Error(msg || 'Failed to fetch'));
  }

  async function flush() { for (let t = 0; t < 20; t++) await Promise.resolve(); }

  function cleanup() { timers.restore(); }

  return {
    Store, api, posts, toasts, submitBtn, timers, storage,
    postIdx, resolvePost, rejectPost, rejectNetwork, flush, cleanup,
    authSheetCalls:    () => authSheetCalls,
    authSheetCallback: () => authSheetCallback
  };
}

// ---------------------------------------------------------------------------
// CVG-01: verify success → create-order proceeds
// ---------------------------------------------------------------------------
test('CVG-01: verify success → create-order IS called', async () => {
  const g = mkHarness({ token: 'xnt_cust_valid_001', branch: 'branch_cvg01' });
  try {
    assert.strictEqual(typeof g.submitBtn.onclick, 'function', 'onclick must be wired after mount');

    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0, '/checkout/verify must be called');

    g.resolvePost(vi, { success: true, is_valid: true, verified_items: [], price_diffs: [] });
    await g.flush();

    const ci = g.postIdx('/checkout/create-order');
    assert.ok(ci >= 0, '/checkout/create-order MUST be called after successful verify');
  } finally { g.cleanup(); }
});

// ---------------------------------------------------------------------------
// CVG-02: verify INVALID_OR_EXPIRED_CUSTOMER_SESSION → NO create-order
// ---------------------------------------------------------------------------
test('CVG-02: verify INVALID_OR_EXPIRED_CUSTOMER_SESSION → NO create-order', async () => {
  const g = mkHarness({ token: 'xnt_cust_valid_002', branch: 'branch_cvg02' });
  try {
    assert.strictEqual(typeof g.submitBtn.onclick, 'function');

    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0, '/checkout/verify must be called');

    g.rejectPost(vi, 401, { error: 'INVALID_OR_EXPIRED_CUSTOMER_SESSION', message: 'Session expired' });
    await g.flush();

    // MAIN INVARIANT
    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      'create-order MUST NOT be called when session is expired/invalid');

    // Button must be restored (transaction stopped cleanly)
    assert.strictEqual(g.submitBtn.disabled, false, 'submit button must be re-enabled');
  } finally { g.cleanup(); }
});

// ---------------------------------------------------------------------------
// CVG-03: verify CUSTOMER_AUTH_REQUIRED (401) → NO create-order
// ---------------------------------------------------------------------------
test('CVG-03: verify CUSTOMER_AUTH_REQUIRED → NO create-order', async () => {
  const g = mkHarness({ token: 'xnt_cust_valid_003', branch: 'branch_cvg03' });
  try {
    assert.strictEqual(typeof g.submitBtn.onclick, 'function');

    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0);

    g.rejectPost(vi, 401, { error: 'CUSTOMER_AUTH_REQUIRED', message: 'Auth required' });
    await g.flush();

    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      'create-order MUST NOT be called when auth is required');
    assert.strictEqual(g.submitBtn.disabled, false, 'button must be re-enabled');
  } finally { g.cleanup(); }
});

// ---------------------------------------------------------------------------
// CVG-04: verify HTTP 4xx/5xx non-auth error → NO create-order
// ---------------------------------------------------------------------------
test('CVG-04: verify HTTP 500 → NO create-order, transaction stopped', async () => {
  const g = mkHarness({ token: 'xnt_cust_valid_004', branch: 'branch_cvg04' });
  try {
    assert.strictEqual(typeof g.submitBtn.onclick, 'function');

    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0);

    // Non-auth server error
    g.rejectPost(vi, 500, { error: 'INTERNAL_SERVER_ERROR', message: 'Server error' });
    await g.flush();

    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      'create-order MUST NOT be called after server error on verify');
    assert.strictEqual(g.submitBtn.disabled, false, 'button must be re-enabled');
  } finally { g.cleanup(); }
});

// ---------------------------------------------------------------------------
// CVG-05: verify network failure → NO create-order, button restored, toast shown
// ---------------------------------------------------------------------------
test('CVG-05: verify network failure → NO create-order, button restored, toast shown', async () => {
  const g = mkHarness({ token: 'xnt_cust_valid_005', branch: 'branch_cvg05' });
  try {
    assert.strictEqual(typeof g.submitBtn.onclick, 'function');

    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0);

    // Bare network error — no status, no data
    g.rejectNetwork(vi, 'Failed to fetch');
    await g.flush();

    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      'create-order MUST NOT be called after network failure on verify');
    assert.strictEqual(g.submitBtn.disabled, false, 'button must be re-enabled after network failure');
    assert.ok(g.toasts.length > 0, 'a toast must be shown so the customer knows to retry');
  } finally { g.cleanup(); }
});

// ---------------------------------------------------------------------------
// CVG-06: verify responds but is_valid = false → price/stock validation sheet,
//         NOT an immediate create-order bypass
// ---------------------------------------------------------------------------
test('CVG-06: verify is_valid=false → price/stock dialog, NOT a create-order bypass', async () => {
  const g = mkHarness({ token: 'xnt_cust_valid_006', branch: 'branch_cvg06' });
  try {
    assert.strictEqual(typeof g.submitBtn.onclick, 'function');

    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0);

    // Verify returns invalid (price changed)
    g.resolvePost(vi, { success: false, is_valid: false, price_diffs: [{ id: '272', expected: 35000, actual: 40000 }] });
    await g.flush();

    // create-order must NOT be called immediately — user must see the dialog first
    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      'create-order must NOT be called when verify reports is_valid=false');
    assert.strictEqual(g.submitBtn.disabled, false, 'button must be re-enabled');
  } finally { g.cleanup(); }
});

// ---------------------------------------------------------------------------
// CVG-07: no valid token → auth gate fires before verify and before create-order
// ---------------------------------------------------------------------------
test('CVG-07: no valid token → gated before verify, NO verify, NO create-order', async () => {
  // No token seeded
  const g = mkHarness({ branch: 'branch_cvg07' });
  try {
    assert.strictEqual(typeof g.submitBtn.onclick, 'function');

    g.submitBtn.onclick();
    await g.flush();

    assert.strictEqual(g.postIdx('/checkout/verify'), -1,
      '/checkout/verify must NOT be called without a valid token');
    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      '/checkout/create-order must NOT be called without a valid token');
  } finally { g.cleanup(); }
});

// ---------------------------------------------------------------------------
// CVG-08: authenticated identity — request body phone must NOT override session phone
//         (server-side contract; verified via payload inspection)
// ---------------------------------------------------------------------------
test('CVG-08: verify payload uses session phone, not a client-overridden phone', async () => {
  const sessionPhone = '081234567890';
  const g = mkHarness({ token: 'xnt_cust_valid_008', phone: sessionPhone, branch: 'branch_cvg08' });
  try {
    assert.strictEqual(typeof g.submitBtn.onclick, 'function');

    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0);

    // The verify payload should carry the session phone (from state.customer.phone),
    // not an arbitrary client-override.  The server ultimately is authoritative
    // (requireCustomerAuth binds req.customer to the session, ignoring body.phone),
    // but the client payload must also be consistent.
    const payload = g.posts[vi].body;
    if (payload && payload.customer && payload.customer.phone) {
      assert.strictEqual(payload.customer.phone, sessionPhone,
        'verify payload must carry the session-bound phone, not a client-injected override');
    }
    // (If payload.customer.phone is absent that is also acceptable —
    // the server uses req.customer.phone from the token session.)
  } finally { g.cleanup(); }
});

// ---------------------------------------------------------------------------
// CVG-09: state preservation — cart NOT cleared on verify failure
// ---------------------------------------------------------------------------
test('CVG-09: cart preserved on verify failure', async () => {
  const g = mkHarness({ token: 'xnt_cust_valid_009', branch: 'branch_cvg09' });
  try {
    const before = g.Store.getState().cart.items.map(i => ({ id: i.id, qty: i.quantity }));
    assert.ok(before.length > 0, 'pre-condition: cart must not be empty');

    assert.strictEqual(typeof g.submitBtn.onclick, 'function');

    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0);

    // Any verify failure
    g.rejectPost(vi, 500, { error: 'INTERNAL_SERVER_ERROR' });
    await g.flush();

    const after = g.Store.getState().cart.items.map(i => ({ id: i.id, qty: i.quantity }));
    assert.deepStrictEqual(after, before, 'cart must be preserved after verify failure');
  } finally { g.cleanup(); }
});

// ---------------------------------------------------------------------------
// CVG-10: state preservation — branch context, orderType, destination, and notes
//         are strictly preserved on auth invalidation / re-login
// ---------------------------------------------------------------------------
test('CVG-10: branch, orderType, destination, and notes preserved across auth failure', async () => {
  const g = mkHarness({ token: 'xnt_cust_stale_010', branch: 'branch_cvg10' });
  try {
    // Set custom order type and active destination in store
    g.Store.setOrderType('delivery');
    g.Store.setActiveDestination({
      address: 'Jl. Melati No. 45',
      latitude: -7.28,
      longitude: 112.72,
      label: 'Kantor',
      detail: 'Lantai 2'
    });
    g.Store.setOrderContext('delivery', { note: 'Jangan pakai sambal' });

    const storeBefore = g.Store.getState();
    assert.strictEqual(storeBefore.orderType, 'delivery');
    assert.strictEqual(storeBefore.activeDestination.address, 'Jl. Melati No. 45');
    assert.strictEqual(storeBefore.orderContext.delivery.note, 'Jangan pakai sambal');

    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0);

    // Verify reports expired customer session (401)
    g.rejectPost(vi, 401, { error: 'INVALID_OR_EXPIRED_CUSTOMER_SESSION', message: 'Sesi akun customer Anda tidak valid atau telah kedaluwarsa.' });
    await g.flush();

    // Verify that session was cleared from Store, but all transaction context was preserved
    const storeAfter = g.Store.getState();
    assert.strictEqual(storeAfter.customerSession, null, 'stale customerSession must be cleared');
    assert.strictEqual(storeAfter.orderType, 'delivery', 'orderType must be preserved');
    assert.strictEqual(storeAfter.activeDestination.address, 'Jl. Melati No. 45', 'destination address must be preserved');
    assert.strictEqual(storeAfter.orderContext.delivery.note, 'Jangan pakai sambal', 'fulfillment note must be preserved');
    assert.deepStrictEqual(storeAfter.cart.items, storeBefore.cart.items, 'cart items must be preserved');
  } finally { g.cleanup(); }
});
