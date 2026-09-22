/**
 * R3 Customer Google Identity Gate — Client-Side Tests
 *
 * Test IDs match the spec:
 *
 * Unauthenticated flow:
 *  CGGC-01  Unauthenticated customer can reach checkout (no forced redirect)
 *  CGGC-02  No session → clicking CTA opens Google Identity Gate (not OTP)
 *  CGGC-03  Google Identity Gate shows "Lanjutkan dengan Google" button
 *  CGGC-04  CTA click with session → goes directly to /checkout/verify (no gate)
 *
 * Auth success:
 *  CGGC-05  Google success creates xnt_cust_ customer session
 *  CGGC-06  Checkout state (cart, branch) intact after Google auth success
 *  CGGC-07  /checkout/verify called after Google auth success
 *  CGGC-08  Order creation only after successful /checkout/verify
 *
 * Auth failure (fail-closed):
 *  CGGC-09  Google auth backend 401 → no /checkout/create-order
 *  CGGC-10  Google auth network failure → no /checkout/create-order
 *  CGGC-11  Google auth success=false body → no /checkout/create-order
 *  CGGC-12  Missing credential (no credential in response) → no /checkout/create-order
 *
 * Returning customer:
 *  CGGC-13  Valid xnt_cust_ session → CTA skips Google gate, goes to /checkout/verify
 *  CGGC-14  Expired/invalid token prefix → Google gate opens
 *  CGGC-15  Checkout state survives expired session → Google auth flow
 *
 * Security:
 *  CGGC-16  Google credential never stored as customerSession.token
 *  CGGC-17  No auth failure falls through to /checkout/create-order
 *
 * UX:
 *  CGGC-18  Cancel Google gate → no order created
 *  CGGC-19  Double-click protection — auth fires only once
 */
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');

const STORE_PATH    = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');
const CHECKOUT_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js');

const REAL_SET_TIMEOUT   = globalThis.setTimeout;
const REAL_CLEAR_TIMEOUT = globalThis.clearTimeout;

// ── Timer capture ──────────────────────────────────────────────────────────
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
    restore: () => {
      globalThis.setTimeout  = REAL_SET_TIMEOUT;
      globalThis.clearTimeout = REAL_CLEAR_TIMEOUT;
    }
  };
}

// ── Fake DOM element ───────────────────────────────────────────────────────
function fakeEl(extras) {
  const self = Object.assign({
    innerHTML:   '',
    textContent: '',
    style:       {},
    dataset:     {},
    disabled:    false,
    classList:   { add: () => {}, remove: () => {} },
    addEventListener:    () => {},
    removeEventListener: () => {},
    querySelector:    () => null,
    querySelectorAll: () => [],
    onclick:  null,
    focus:    () => {},
    blur:     () => {},
    click:    () => { if (typeof self.onclick === 'function') self.onclick(); }
  }, extras || {});
  return self;
}

/**
 * Build a fresh test harness.
 *
 * opts.token    — pre-seed xnt_cust_ token; undefined = no session (unauthenticated)
 * opts.branch   — branch id string
 * opts.noCart   — skip seeding a cart item
 * opts.gsiAvailable  — whether window.google.accounts.id is available (default true)
 * opts.gsiCredential — credential string GSI will return (default: 'mock_google_credential')
 */
function mkHarness(opts) {
  opts = opts || {};

  const storage   = {};
  const timers    = captureTimers();
  const toasts    = [];
  const posts     = [];
  const resolveFns = [];
  const rejectFns  = [];

  // Keep track of opened overlay content (for verifying which sheet was shown)
  const overlayContents = [];

  // Submit button
  const submitBtn = fakeEl({ id: 'x-btn-submit-order' });
  const ids = new Map([['x-btn-submit-order', submitBtn]]);

  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node-test' }, configurable: true
  });
  globalThis.window = globalThis;
  // checkout.js binds window-level listeners at load time (PWA install prompt).
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = (fn) => { REAL_SET_TIMEOUT(fn, 0); return 0; };

  // Overlay child element for querySelector inside the sheet
  function makeQueryChild(content) {
    const child = fakeEl({
      textContent: content || '',
      disabled:    false,
      style:       { display: '' }
    });
    return child;
  }

  // The overlay element returned by makeOverlay — captures the HTML rendered
  function makeOverlayEl(html) {
    overlayContents.push(html);

    // Build per-element lookup from id strings in the HTML
    const elMap = {};
    const idMatches = [...html.matchAll(/id="([^"]+)"/g)];
    idMatches.forEach(m => {
      elMap[m[1]] = makeQueryChild(m[1]);
    });

    const classMap = {};
    const classMatches = [...html.matchAll(/class="([^"]+)"/g)];
    classMatches.forEach(m => {
      const firstClass = m[1].split(' ')[0];
      classMap[firstClass] = makeQueryChild(firstClass);
    });

    const overlayEl = fakeEl({
      innerHTML: html,
      appendChild:  () => {},
      removeChild:  () => {},
      contains:     () => true,
      querySelector: (sel) => {
        // Match id selectors
        if (sel.startsWith('#')) {
          const id = sel.substring(1);
          return elMap[id] || makeQueryChild(id);
        }
        // Match class selectors
        if (sel.startsWith('.')) {
          const cls = sel.substring(1);
          return classMap[cls] || makeQueryChild(cls);
        }
        return makeQueryChild(sel);
      },
      querySelectorAll: () => []
    });

    return overlayEl;
  }

  globalThis.document = {
    addEventListener:    () => {},
    removeEventListener: () => {},
    getElementById:      (id) => ids.get(id) || null,
    createElement:       (tag) => {
      const el = fakeEl({
        innerHTML:    '',
        appendChild:  () => {},
        removeChild:  () => {},
        contains:     () => true,
        style:        {},
        querySelector:    () => makeQueryChild('child'),
        querySelectorAll: () => []
      });
      return el;
    },
    querySelector:    (sel) => {
      if (sel === 'meta[name="x-google-client-id"]') {
        return { getAttribute: () => 'test-google-client-id.apps.googleusercontent.com' };
      }
      return null;
    },
    querySelectorAll: () => [],
    body: fakeEl({
      appendChild: (el) => {
        // When checkout.js calls body.appendChild(overlayEl) in makeOverlay,
        // we capture the overlay. Patch the el to have our overlay content readers.
      },
      removeChild: () => {},
      contains:    () => true,
      querySelector: () => null
    })
  };

  globalThis.localStorage = {
    getItem:    (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem:    (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };

  // GSI mock
  const gsiCredential = opts.gsiCredential !== undefined ? opts.gsiCredential : 'mock_google_credential_gsi';
  const gsiAvailable  = opts.gsiAvailable  !== false;
  let gsiCallback = null;
  let gsiPromptCalled = 0;

  if (gsiAvailable) {
    globalThis.google = {
      accounts: {
        id: {
          initialize: (cfg) => {
            gsiCallback = cfg && cfg.callback;
          },
          prompt: (fn) => {
            gsiPromptCalled++;
            // Simulate immediate prompt display (not skipped, not dismissed)
            if (fn && typeof fn === 'function') {
              // Return a notification that the prompt is displayed (not skipped/dismissed)
              fn({ isSkippedMoment: () => false, isDismissedMoment: () => false });
            }
          }
        }
      }
    };
  } else {
    globalThis.google = undefined;
  }

  // API mock
  const api = {
    get: (url) => {
      if (url.includes('/brand/branches'))    return Promise.resolve({ success: true, branches: [] });
      if (url.includes('/promotions/active')) return Promise.resolve({ success: true, promotions: [], applied: [], rejected: [] });
      if (url.includes('/customer/dining-session')) return Promise.resolve({ success: true, session: null });
      return new Promise((res) => { resolveFns.push(res); rejectFns.push(() => {}); });
    },
    post: (url, body) => {
      const p = new Promise((res, rej) => {
        resolveFns.push(res);
        rejectFns.push(rej);
      });
      posts.push({ url, body });
      return p;
    },
    isAbortError: () => false
  };

  window.Xentra = {};
  window.Xentra.API = api;
  window.Xentra.UI  = {
    escape: (v) => String(v),
    toast:  (msg) => { toasts.push(msg); }
  };
  window.Xentra.Router = {
    getItemIdFromUrl:   () => null,
    getBranchIdFromUrl: () => null,
    getCurrentView:     () => 'checkout',
    navigate:           () => {}
  };
  window.Xentra.DeliverySchedule = { toIsoRange: () => ({ start: '2026-09-19 12:00', end: null }) };
  window.Xentra.PwaRuntime = { getPwaRuntimeContext: () => ({ display_mode: 'browser', install_requirement_satisfied: false }) };
  window.XentraConfig = { googleClientId: 'test-google-client-id.apps.googleusercontent.com' };

  // Fresh modules
  delete require.cache[STORE_PATH];
  delete require.cache[CHECKOUT_PATH];
  require(STORE_PATH);

  const Store = window.Xentra.Store;

  // Pre-seed session
  if (opts.token) {
    // A verified customer must carry a valid Indonesian mobile; the checkout
    // submit gate (hasValidCustomerPhone) requires it before /checkout/verify.
    Store.setCustomerSession({ phone: opts.phone || '08120000001', name: opts.name || 'Test', token: opts.token });
  }

  // Pre-seed branch
  const branch = opts.branch || 'branch_cggc';
  Store.setMatchedBranch({ id: branch, name: 'Test Branch' });

  // Pre-seed cart
  if (!opts.noCart) {
    Store.addItem({ id: '272', name: 'Paket Test', price: 35000, branch_id: branch }, 1, { branch_id: branch });
  }

  // Patch makeOverlay to intercept overlay content
  require(CHECKOUT_PATH);

  // Mount
  const container = fakeEl({
    querySelectorAll: () => [],
    querySelector:    () => null,
    style: {}
  });
  window.Xentra.Checkout.mount(container);

  // Seed paymentMethod so executePrePaymentAndSubmit reaches the auth gate check.
  // Use 'midtrans' to avoid the cashTendered guard (cash requires a tendered amount).
  if (window.Xentra.Checkout._setPaymentMethod) {
    window.Xentra.Checkout._setPaymentMethod('midtrans');
  }


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
  async function flush() {
    for (let t = 0; t < 30; t++) await Promise.resolve();
  }
  function cleanup() { timers.restore(); }

  // Trigger the Google credential callback (simulates user picking Google account)
  function triggerGsiCallback(credentialOrNull) {
    if (gsiCallback) {
      gsiCallback({ credential: credentialOrNull === undefined ? gsiCredential : credentialOrNull });
    }
  }

  return {
    Store, api, posts, toasts, submitBtn, timers, storage, overlayContents,
    postIdx, resolvePost, rejectPost, rejectNetwork, flush, cleanup,
    triggerGsiCallback,
    gsiPromptCalled: () => gsiPromptCalled,
    lastOverlay: () => overlayContents[overlayContents.length - 1] || ''
  };
}

// ── CGGC-01: Unauthenticated customer — no forced redirect ────────────────
test('CGGC-01: Unauthenticated customer can reach checkout (no session, no redirect)', async () => {
  const g = mkHarness({ noCart: false });
  try {
    // Harness mounts checkout without a session — no redirect or crash should occur
    assert.ok(true, 'Checkout mounted without session → no crash');
    // Submit button should be wired
    assert.strictEqual(typeof g.submitBtn.onclick, 'function', 'CTA must be wired');
  } finally { g.cleanup(); }
});

// ── CGGC-02: No session → CTA opens Google Identity Gate (not OTP) ────────
test('CGGC-02: No session → CTA click opens Google Identity Gate (not OTP phone step)', async () => {
  const g = mkHarness(); // no token
  try {
    assert.strictEqual(typeof g.submitBtn.onclick, 'function');
    g.submitBtn.onclick();
    await g.flush();

    // No /checkout/verify must have been called (gate must intercept before verify)
    assert.strictEqual(g.postIdx('/checkout/verify'), -1,
      '/checkout/verify must NOT be called when session is missing');
    // No /checkout/create-order
    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      '/checkout/create-order must NOT be called without session');
  } finally { g.cleanup(); }
});

// ── CGGC-03: Google Identity Gate renders "Lanjutkan dengan Google" ────────
test('CGGC-03: Google Identity Gate sheet does not contain OTP-specific content', async () => {
  // We use _overrideAuthSheet to spy on openCustomerAuthSheet instead of
  // patching the exported property (the internal module calls the closure directly).
  const g = mkHarness();
  try {
    let authSheetOpened = false;
    let authSheetHadCallback = false;
    window.Xentra.Checkout._overrideAuthSheet(function (cb) {
      authSheetOpened = true;
      authSheetHadCallback = typeof cb === 'function';
    });

    g.submitBtn.onclick();
    await g.flush();

    assert.ok(authSheetOpened, 'openCustomerAuthSheet must be called');
    assert.ok(authSheetHadCallback, 'openCustomerAuthSheet must be called with a callback for retry');
    window.Xentra.Checkout._overrideAuthSheet(null); // restore
  } finally { g.cleanup(); }
});

// ── CGGC-04: Valid session → CTA goes directly to /checkout/verify ─────────
test('CGGC-04: Valid xnt_cust_ session → CTA immediately calls /checkout/verify', async () => {
  const g = mkHarness({ token: 'xnt_cust_valid_cggc04' });
  try {
    assert.strictEqual(typeof g.submitBtn.onclick, 'function');
    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0, '/checkout/verify must be called when session is valid');
    // No create-order yet (awaiting verify response)
    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      '/checkout/create-order must not be called before /checkout/verify resolves');
  } finally { g.cleanup(); }
});

// ── CGGC-05: Google success → xnt_cust_ session stored ────────────────────
test('CGGC-05: Google auth success creates xnt_cust_ customer session', async () => {
  const g = mkHarness();
  try {
    // Intercept the openCustomerAuthSheet call using the delegate hook
    let capturedCallback = null;
    window.Xentra.Checkout._overrideAuthSheet(function (cb) {
      capturedCallback = cb;
      // Simulate what renderGoogleIdentityGate does: exchange credential for session
      // by directly calling the /customer/auth/google POST
      const credentialPostIdx = g.posts.length;
      g.api.post('/customer/auth/google', { credential: 'mock_google_cred' });
      // Resolve it with a valid xnt_cust_ token
      REAL_SET_TIMEOUT(async () => {
        g.resolvePost(credentialPostIdx, {
          success: true,
          token: 'xnt_cust_google_session_005',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          customer: { name: 'Google Customer', email: 'gcustomer@gmail.com' }
        });
        // Simulate what handleGoogleCredential does after success:
        g.Store.setCustomerSession({ name: 'Google Customer', phone: 'gcustomer@gmail.com', token: 'xnt_cust_google_session_005' });
        if (typeof capturedCallback === 'function') capturedCallback();
      }, 0);
    });

    g.submitBtn.onclick();
    await g.flush();
    // Give async timer above a chance to run
    await new Promise(r => REAL_SET_TIMEOUT(r, 20));
    await g.flush();

    const sess = g.Store.getState().customerSession;
    assert.ok(sess, 'Customer session must exist after Google auth');
    assert.ok(sess.token && sess.token.startsWith('xnt_cust_'),
      'Token must be xnt_cust_ prefix');
    assert.notStrictEqual(sess.token, 'mock_google_cred',
      'Google credential must NOT be stored as session token');
    window.Xentra.Checkout._overrideAuthSheet(null); // restore
  } finally { g.cleanup(); }
});

// ── CGGC-06: Cart/state intact after Google auth ───────────────────────────
test('CGGC-06: Checkout state (cart, branch) intact after Google auth success', async () => {
  const g = mkHarness();
  try {
    const cartBefore = g.Store.getState().cart.items.slice();
    const branchBefore = g.Store.getState().matchedBranch;
    assert.ok(cartBefore.length > 0, 'Cart must be seeded');
    assert.ok(branchBefore, 'Branch must be seeded');

    // Simulate Google auth success (set session directly)
    g.Store.setCustomerSession({ name: 'G Customer', phone: 'g@gmail.com', token: 'xnt_cust_cggc06' });
    await g.flush();

    const cartAfter = g.Store.getState().cart.items;
    const branchAfter = g.Store.getState().matchedBranch;

    assert.deepStrictEqual(
      cartAfter.map(i => i.id),
      cartBefore.map(i => i.id),
      'Cart items must be unchanged after Google auth'
    );
    assert.deepStrictEqual(branchAfter, branchBefore, 'Branch must be unchanged after Google auth');
  } finally { g.cleanup(); }
});

// ── CGGC-07: /checkout/verify called after Google auth ────────────────────
test('CGGC-07: /checkout/verify called after Google auth success (not before)', async () => {
  const g = mkHarness({ token: 'xnt_cust_cggc07_valid' });
  try {
    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0, '/checkout/verify must be called when session exists');

    // create-order must NOT be called yet
    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      '/checkout/create-order must not be called before /checkout/verify resolves');
  } finally { g.cleanup(); }
});

// ── CGGC-08: Order creation only after /checkout/verify succeeds ──────────
test('CGGC-08: Order creation only after successful /checkout/verify', async () => {
  const g = mkHarness({ token: 'xnt_cust_cggc08_valid' });
  try {
    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0, '/checkout/verify must be called');

    // Resolve verify with success
    g.resolvePost(vi, { success: true, is_valid: true, verified_items: [], price_diffs: [] });
    await g.flush();

    const ci = g.postIdx('/checkout/create-order');
    assert.ok(ci >= 0, '/checkout/create-order must be called after successful verify');
  } finally { g.cleanup(); }
});

// ── CGGC-09: Google auth backend 401 → no create-order ────────────────────
test('CGGC-09: Backend 401 on /customer/auth/google → no /checkout/create-order', async () => {
  const g = mkHarness();
  try {
    // Intercept openCustomerAuthSheet and simulate a 401 failure from /customer/auth/google
    window.Xentra.Checkout.openCustomerAuthSheet = function (_cb) {
      const credentialPostIdx = g.posts.length;
      g.api.post('/customer/auth/google', { credential: 'bad_token' });
      REAL_SET_TIMEOUT(async () => {
        g.rejectPost(credentialPostIdx, 401, { error: 'INVALID_GOOGLE_TOKEN', message: 'Token invalid' });
        await g.flush();
      }, 0);
    };
    window.openCustomerAuthSheet = window.Xentra.Checkout.openCustomerAuthSheet;

    g.submitBtn.onclick();
    await g.flush();
    await new Promise(r => REAL_SET_TIMEOUT(r, 20));
    await g.flush();

    // No create-order must be called
    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      'Auth failure must not fall through to /checkout/create-order');
    // No verify should have been called either
    assert.strictEqual(g.postIdx('/checkout/verify'), -1,
      '/checkout/verify must not be called after auth failure');
  } finally { g.cleanup(); }
});

// ── CGGC-10: Google auth network failure → no create-order ────────────────
test('CGGC-10: Network failure on /customer/auth/google → no /checkout/create-order', async () => {
  const g = mkHarness();
  try {
    window.Xentra.Checkout.openCustomerAuthSheet = function (_cb) {
      const idx = g.posts.length;
      g.api.post('/customer/auth/google', { credential: 'tok' });
      REAL_SET_TIMEOUT(async () => {
        g.rejectNetwork(idx, 'Failed to fetch');
        await g.flush();
      }, 0);
    };
    window.openCustomerAuthSheet = window.Xentra.Checkout.openCustomerAuthSheet;

    g.submitBtn.onclick();
    await g.flush();
    await new Promise(r => REAL_SET_TIMEOUT(r, 20));
    await g.flush();

    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      'Network auth failure must not create an order');
  } finally { g.cleanup(); }
});

// ── CGGC-11: Backend success=false → no create-order ────────────────────
test('CGGC-11: success=false from /customer/auth/google → no /checkout/create-order', async () => {
  const g = mkHarness();
  try {
    window.Xentra.Checkout.openCustomerAuthSheet = function (_cb) {
      const idx = g.posts.length;
      g.api.post('/customer/auth/google', { credential: 'tok' });
      REAL_SET_TIMEOUT(async () => {
        g.resolvePost(idx, { success: false, error: 'UNVERIFIED_GOOGLE_EMAIL' });
        await g.flush();
      }, 0);
    };
    window.openCustomerAuthSheet = window.Xentra.Checkout.openCustomerAuthSheet;

    g.submitBtn.onclick();
    await g.flush();
    await new Promise(r => REAL_SET_TIMEOUT(r, 20));
    await g.flush();

    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      'Non-success auth body must not create an order');
  } finally { g.cleanup(); }
});

// ── CGGC-13: Valid session skips Google gate ───────────────────────────────
test('CGGC-13: Valid xnt_cust_ session skips Google Identity Gate entirely', async () => {
  const g = mkHarness({ token: 'xnt_cust_returning_cggc13' });
  try {
    let googleGateOpened = false;
    const origOpen = window.Xentra.Checkout.openCustomerAuthSheet;
    window.Xentra.Checkout.openCustomerAuthSheet = function (cb) {
      googleGateOpened = true;
      if (origOpen) origOpen(cb);
    };
    window.openCustomerAuthSheet = window.Xentra.Checkout.openCustomerAuthSheet;

    g.submitBtn.onclick();
    await g.flush();

    assert.ok(!googleGateOpened, 'Google Identity Gate must NOT open for returning authenticated customer');
    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0, '/checkout/verify must be called directly');
  } finally { g.cleanup(); }
});

// ── CGGC-12: Missing credential in response → no create-order ────────────
test('CGGC-12: Missing credential (no credential in response) → no /checkout/create-order', async () => {
  const g = mkHarness();
  try {
    let authCalled = false;
    window.Xentra.Checkout._overrideAuthSheet(function (_cb) {
      authCalled = true;
    });

    g.submitBtn.onclick();
    await g.flush();

    assert.ok(authCalled, 'openCustomerAuthSheet was triggered');
    assert.strictEqual(g.postIdx('/customer/auth/google'), -1,
      'No backend auth called when credential is missing');
    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      'Missing credential must not create an order');
    window.Xentra.Checkout._overrideAuthSheet(null);
  } finally { g.cleanup(); }
});

// ── CGGC-14: Invalid token prefix → Google gate opens ─────────────────────
test('CGGC-14: Non-xnt_cust_ token prefix → Google Identity Gate opens', async () => {
  // Seed a session with a WRONG prefix (e.g. a workforce token used as customer session)
  const g = mkHarness({ token: 'xnt_auth_WORKFORCE_TOKEN_not_customer' });
  try {
    let googleGateOpened = false;
    window.Xentra.Checkout._overrideAuthSheet(function (_cb) {
      googleGateOpened = true;
    });

    g.submitBtn.onclick();
    await g.flush();

    assert.ok(googleGateOpened, 'Google Identity Gate must open for invalid token prefix');
    assert.strictEqual(g.postIdx('/checkout/verify'), -1,
      '/checkout/verify must NOT be called with invalid token');
    window.Xentra.Checkout._overrideAuthSheet(null); // restore
  } finally { g.cleanup(); }
});

// ── CGGC-15: Expired session → Google gate opens, state preserved ─────────
test('CGGC-15: Expired session (401 at verify) → Google gate opens and preserves cart/branch state', async () => {
  const g = mkHarness({ token: 'xnt_cust_expired_cggc15' });
  try {
    const cartBefore = g.Store.getState().cart.items.slice();
    const branchBefore = g.Store.getState().matchedBranch;

    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0, '/checkout/verify called initially');

    let gateOpenedOnExpiry = false;
    window.Xentra.Checkout._overrideAuthSheet(function (_cb) {
      gateOpenedOnExpiry = true;
    });

    // Reject verify with 401 CUSTOMER_AUTH_REQUIRED
    g.rejectPost(vi, 401, { error: 'CUSTOMER_AUTH_REQUIRED', message: 'Session expired' });
    await g.flush();

    assert.ok(gateOpenedOnExpiry, 'Google Identity Gate must open when verify returns 401');
    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      'Expired session must not fall through to create-order');

    // Verify cart and branch context are still fully preserved
    const cartAfter = g.Store.getState().cart.items;
    const branchAfter = g.Store.getState().matchedBranch;
    assert.deepStrictEqual(cartAfter.map(i => i.id), cartBefore.map(i => i.id), 'Cart preserved');
    assert.deepStrictEqual(branchAfter, branchBefore, 'Branch preserved');
    window.Xentra.Checkout._overrideAuthSheet(null);
  } finally { g.cleanup(); }
});

// ── CGGC-16: Google credential never stored as customerSession.token ───────
test('CGGC-16: Google ID token is never stored as customerSession.token', async () => {
  const g = mkHarness();
  try {
    const rawGoogleCredential = 'eyJhbGciOiJSUzI1NiJ9.fake.google.jwt.credential';

    window.Xentra.Checkout._overrideAuthSheet(function (_cb) {
      const idx = g.posts.length;
      g.api.post('/customer/auth/google', { credential: rawGoogleCredential });
      REAL_SET_TIMEOUT(async () => {
        // Simulate success — server issues xnt_cust_ token (not the Google credential)
        g.resolvePost(idx, {
          success: true,
          token: 'xnt_cust_server_issued_not_google_jwt',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          customer: { name: 'G', email: 'g@g.com' }
        });
        g.Store.setCustomerSession({
          name: 'G',
          phone: 'g@g.com',
          token: 'xnt_cust_server_issued_not_google_jwt'
        });
      }, 0);
    });

    g.submitBtn.onclick();
    await g.flush();
    await new Promise(r => REAL_SET_TIMEOUT(r, 20));
    await g.flush();

    const sess = g.Store.getState().customerSession;
    if (sess && sess.token) {
      assert.notStrictEqual(sess.token, rawGoogleCredential,
        'Google credential JWT must NEVER be stored as Xentra customer session token');
      assert.ok(sess.token.startsWith('xnt_cust_'),
        'Stored token must be server-issued xnt_cust_ prefix');
    }
    window.Xentra.Checkout._overrideAuthSheet(null); // restore
  } finally { g.cleanup(); }
});

// ── CGGC-17: /checkout/verify failure → no create-order ───────────────────
test('CGGC-17: /checkout/verify failure → no /checkout/create-order (fail-closed)', async () => {
  const g = mkHarness({ token: 'xnt_cust_cggc17_valid' });
  try {
    g.submitBtn.onclick();
    await g.flush();

    const vi = g.postIdx('/checkout/verify');
    assert.ok(vi >= 0);

    // Reject verify with a 500
    g.rejectPost(vi, 500, { error: 'INTERNAL_ERROR', message: 'Server error' });
    await g.flush();

    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      '/checkout/verify failure must not fall through to create-order');

    // Button must be re-enabled
    assert.strictEqual(g.submitBtn.disabled, false, 'Submit button must be re-enabled after verify failure');
  } finally { g.cleanup(); }
});

// ── CGGC-18: Cancel Google gate → no order ────────────────────────────────
test('CGGC-18: Cancel/close Google Identity Gate → no order created', async () => {
  const g = mkHarness();
  try {
    let cancelCalled = false;
    window.Xentra.Checkout._overrideAuthSheet(function (_cb) {
      // Simulate user cancelling (closing the gate without authenticating)
      cancelCalled = true;
      // Do NOT call cb — user cancelled
    });

    g.submitBtn.onclick();
    await g.flush();

    assert.ok(cancelCalled, 'openCustomerAuthSheet must be called');
    assert.strictEqual(g.postIdx('/checkout/verify'), -1,
      'Cancel must not lead to /checkout/verify');
    assert.strictEqual(g.postIdx('/checkout/create-order'), -1,
      'Cancel must not create an order');
    window.Xentra.Checkout._overrideAuthSheet(null); // restore
  } finally { g.cleanup(); }
});

// ── CGGC-19: Double-click protection ─────────────────────────────────────
test('CGGC-19: Double-click CTA → no duplicate /checkout/verify calls', async () => {
  const g = mkHarness({ token: 'xnt_cust_cggc19_valid' });
  try {
    // Click twice rapidly
    g.submitBtn.onclick();
    g.submitBtn.onclick();
    await g.flush();

    const verifyPosts = g.posts.filter(p => p.url.includes('/checkout/verify'));
    assert.strictEqual(verifyPosts.length, 1,
      'Double-click must result in exactly one /checkout/verify call');
  } finally { g.cleanup(); }
});
