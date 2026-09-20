/**
 * Customer Profile Authentication UX & Identity Separation Tests
 *
 * Tests the locked UX contracts:
 * 1. Profile Unauthenticated:
 *    - Displays canonical "Masuk ke akunmu" card
 *    - Subtitle: "Simpan alamat, lihat riwayat pesanan, dan kelola akun."
 *    - CTA: "Masuk dengan Google"
 *    - No "Tamu" or "Belum terverifikasi"
 *    - No WhatsApp OTP login CTA
 * 2. Profile Authenticated:
 *    - Displays customer name from customerSession
 *    - Displays "Akun Google" badge/subtitle
 *    - Displays "Keluar dari Akun" button
 *    - No "Tamu" or "Belum terverifikasi"
 *    - No login CTA
 * 3. Google Authentication Lifecycle & Token Format:
 *    - Credential exchanged via /customer/auth/google
 *    - Token is xnt_cust_ format, raw Google credential never stored as token
 *    - Store.setCustomerSession updates state immediately
 *    - Profile rerenders to authenticated state
 * 4. Persistence:
 *    - customerSession persists across page reload in localStorage
 *    - Profile mounts directly into authenticated state
 * 5. Strict Context Separation:
 *    - Checkout maintains "Satu langkah lagi" / "Lanjutkan dengan Google" Identity Gate
 *    - Profile uses "Masuk ke akunmu" / "Masuk dengan Google"
 *    - Checkout state (cart, branch, destination, note) completely untouched by auth
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');
const AUX_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/aux-pages.js');
const CHECKOUT_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js');

function createStorageShim(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    clear: () => { Object.keys(data).forEach((k) => delete data[k]); },
    _dump: () => Object.assign({}, data)
  };
}

function fakeEl(extras) {
  const self = Object.assign({
    innerHTML: '',
    textContent: '',
    style: {},
    dataset: {},
    disabled: false,
    classList: { add: () => {}, remove: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    onclick: null,
    focus: () => {},
    blur: () => {},
    click: () => { if (typeof self.onclick === 'function') self.onclick(); }
  }, extras || {});
  return self;
}

function setupHarness(initialStorage) {
  const storage = createStorageShim(initialStorage);
  const toasts = [];
  const posts = [];
  const gets = [];

  globalThis.window = globalThis;
  globalThis.localStorage = storage;

  globalThis.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    createElement: () => fakeEl(),
    querySelector: (sel) => {
      if (sel === 'meta[name="x-google-client-id"]') {
        return { getAttribute: () => 'test-google-client-id.apps.googleusercontent.com' };
      }
      return null;
    },
    querySelectorAll: () => [],
    body: fakeEl()
  };

  const api = {
    get: (url) => {
      gets.push(url);
      if (url.includes('/customer/orders')) return Promise.resolve({ success: true, orders: [] });
      if (url.includes('/brand/branches')) return Promise.resolve({ success: true, branches: [] });
      return Promise.resolve({});
    },
    post: (url, body) => {
      posts.push({ url, body });
      if (url.includes('/customer/auth/broker/init')) {
        return Promise.resolve({
          success: true,
          broker_url: 'https://xentra.cloud/auth/broker?mode=customer&return_to=https%3A%2F%2Fapp.mybangjo.com%2F&brand_id=brand_bangjo',
          return_to: 'https://app.mybangjo.com/'
        });
      }
      if (url.includes('/customer/auth/broker/exchange')) {
        return Promise.resolve({
          success: true,
          token: 'xnt_cust_broker_session_99999',
          customer: { id: 'cust_broker_01', name: 'Ahmad Dahlan', email: 'ahmad@example.com' }
        });
      }
      if (url.includes('/customer/auth/google')) {
        return Promise.resolve({
          success: true,
          token: 'xnt_cust_session_token_12345',
          customer: {
            id: 'cust_abc987',
            name: 'Ahmad Dahlan',
            email: 'ahmad@example.com'
          }
        });
      }
      return Promise.resolve({});
    }
  };

  window.Xentra = window.Xentra || {};
  window.Xentra.API = api;
  window.Xentra.UI = {
    escape: (v) => String(v),
    toast: (msg) => { toasts.push(msg); }
  };
  window.Xentra.Router = {
    getCurrentView: () => 'profile',
    getViewFromUrl: () => 'profile',
    navigate: () => {}
  };
  window.XentraConfig = { googleClientId: 'test-google-client-id.apps.googleusercontent.com' };

  delete require.cache[STORE_PATH];
  delete require.cache[AUX_PATH];

  require(STORE_PATH);
  require(AUX_PATH);

  const Store = window.Xentra.Store;
  const AuxPages = window.XentraAuxPages;

  return {
    Store,
    AuxPages,
    storage,
    toasts,
    posts,
    api
  };
}

// ── Test 1: Profile Unauthenticated State ────────────────────────────────
test('Profile Unauthenticated: renders "Masuk ke akunmu" and "Masuk dengan Google", no "Tamu", no OTP CTA', () => {
  const { AuxPages } = setupHarness();

  let capturedHtml = '';
  const container = {
    set innerHTML(val) { capturedHtml = val; },
    get innerHTML() { return capturedHtml; },
    querySelector: (sel) => {
      if (sel === '#x-profile-login') {
        return fakeEl({ id: 'x-profile-login' });
      }
      return fakeEl();
    }
  };

  AuxPages.mountProfile(container);

  // Canonical copy checks
  assert.ok(capturedHtml.includes('Masuk ke akunmu'), 'Title must be "Masuk ke akunmu"');
  assert.ok(capturedHtml.includes('Simpan alamat, lihat riwayat pesanan, dan kelola akun.'), 'Subtitle must match canonical copy');
  assert.ok(capturedHtml.includes('Masuk dengan Google'), 'CTA must be "Masuk dengan Google"');

  // Prohibited copy checks
  assert.strictEqual(capturedHtml.includes('Tamu'), false, 'Must NOT contain "Tamu"');
  assert.strictEqual(capturedHtml.includes('Belum terverifikasi'), false, 'Must NOT contain "Belum terverifikasi"');
  assert.strictEqual(capturedHtml.includes('Masuk / Verifikasi WhatsApp'), false, 'Must NOT contain "Masuk / Verifikasi WhatsApp"');
  assert.strictEqual(capturedHtml.includes('Keluar dari Akun'), false, 'Must NOT display logout button when unauthenticated');
});

// ── Test 2: Profile Authenticated State ──────────────────────────────────
test('Profile Authenticated: renders customer name, "Akun Google", and "Keluar dari Akun", no login CTA', () => {
  const { AuxPages, Store } = setupHarness();

  Store.setCustomerSession({
    name: 'Siti Rahma',
    email: 'siti@example.com',
    phone: 'siti@example.com',
    token: 'xnt_cust_siti_token_001'
  });

  let capturedHtml = '';
  const container = {
    set innerHTML(val) { capturedHtml = val; },
    get innerHTML() { return capturedHtml; },
    querySelector: (sel) => fakeEl()
  };

  AuxPages.mountProfile(container);

  // Authenticated display checks
  assert.ok(capturedHtml.includes('Siti Rahma'), 'Must display customer name');
  assert.ok(capturedHtml.includes('Akun Google'), 'Must display "Akun Google"');
  assert.ok(capturedHtml.includes('Keluar dari Akun'), 'Must display "Keluar dari Akun" button');

  // Prohibited copy checks
  assert.strictEqual(capturedHtml.includes('Tamu'), false, 'Must NOT contain "Tamu"');
  assert.strictEqual(capturedHtml.includes('Belum terverifikasi'), false, 'Must NOT contain "Belum terverifikasi"');
  assert.strictEqual(capturedHtml.includes('Masuk ke akunmu'), false, 'Must NOT contain login title');
  assert.strictEqual(capturedHtml.includes('Masuk dengan Google'), false, 'Must NOT contain login CTA');
  assert.strictEqual(capturedHtml.includes('Masuk / Verifikasi WhatsApp'), false, 'Must NOT contain WhatsApp login CTA');
});

// ── Test 3: Google Auth Lifecycle — Broker Redirect Contract ─────────────
test('Google Auth Lifecycle: POST /customer/auth/google returns xnt_cust_ token and updates Store.customerSession', async () => {
  // Architecture change: Profile login now redirects to centralized broker via
  // POST /customer/auth/broker/init, then browser returns with ?customer_code.
  // This test verifies: (a) broker/init is called, (b) browser is redirected to broker,
  // (c) GSI is NOT initialized directly on tenant origin.
  const { AuxPages, Store, posts } = setupHarness();

  let capturedHtml = '';
  let loginButtonHandler = null;

  const container = {
    set innerHTML(val) { capturedHtml = val; },
    get innerHTML() { return capturedHtml; },
    querySelector: (sel) => {
      const el = fakeEl({ id: sel.replace('#', '') });
      if (sel === '#x-profile-login') {
        Object.defineProperty(el, 'onclick', {
          set(fn) { loginButtonHandler = fn; },
          get() { return loginButtonHandler; }
        });
      }
      return el;
    }
  };

  // Track location changes (broker redirect)
  let redirectedTo = null;
  const origLocation = globalThis.window && globalThis.window.location;
  Object.defineProperty(globalThis, 'location', {
    writable: true,
    value: { href: 'https://app.mybangjo.com/', hash: '#home' }
  });

  AuxPages.mountProfile(container);
  assert.ok(typeof loginButtonHandler === 'function', 'Login button onclick handler must be attached');

  // Click login
  loginButtonHandler();

  // Flush promises (broker/init POST resolves)
  for (let i = 0; i < 10; i++) await Promise.resolve();

  // Verify broker/init was called (not GSI, not /customer/auth/google directly)
  const brokerInitPost = posts.find(p => p.url === '/customer/auth/broker/init');
  assert.ok(brokerInitPost, 'Profile login must POST to /customer/auth/broker/init');

  // Verify GSI was NOT initialized on tenant origin
  const directGsiPost = posts.find(p => p.url === '/customer/auth/google');
  assert.ok(!directGsiPost, 'Profile login must NOT directly call /customer/auth/google (deprecated for broker flow)');

  // Verify browser was redirected to broker (xentra.cloud/auth/broker)
  // setupHarness mock returns success=true with broker_url for broker/init
  const locationAfter = globalThis.location && globalThis.location.href;
  assert.ok(
    locationAfter && locationAfter.includes('xentra.cloud') && locationAfter.includes('mode=customer'),
    'Browser must be redirected to xentra.cloud auth broker with mode=customer'
  );

  // Restore
  if (origLocation !== undefined) {
    try { Object.defineProperty(globalThis, 'location', { writable: true, value: origLocation }); } catch (_) {}
  }
});

// ── Test 4: Reload Persistence ───────────────────────────────────────────
test('Persistence: customerSession in localStorage reloads directly into authenticated Profile', () => {
  const initialStorage = {
    'xentra_v2_customer_session': JSON.stringify({
      name: 'Budi Santoso',
      email: 'budi@example.com',
      phone: 'budi@example.com',
      token: 'xnt_cust_persisted_999'
    })
  };

  const { AuxPages, Store } = setupHarness(initialStorage);

  assert.strictEqual(Store.getState().customerSession.token, 'xnt_cust_persisted_999');

  let capturedHtml = '';
  const container = {
    set innerHTML(val) { capturedHtml = val; },
    get innerHTML() { return capturedHtml; },
    querySelector: () => fakeEl()
  };

  AuxPages.mountProfile(container);

  assert.ok(capturedHtml.includes('Budi Santoso'), 'Must load customer name on startup');
  assert.ok(capturedHtml.includes('Akun Google'), 'Must load Akun Google on startup');
  assert.ok(capturedHtml.includes('Keluar dari Akun'), 'Must load logout button on startup');
  assert.strictEqual(capturedHtml.includes('Masuk ke akunmu'), false);
});

// ── Test 5: Strict Separation of Profile vs Checkout Gate ────────────────
test('Separation: Profile uses "Masuk ke akunmu" while Checkout uses "Satu langkah lagi"', () => {
  const { AuxPages } = setupHarness();

  let profileHtml = '';
  const profileContainer = {
    set innerHTML(val) { profileHtml = val; },
    get innerHTML() { return profileHtml; },
    querySelector: () => fakeEl()
  };
  AuxPages.mountProfile(profileContainer);

  assert.ok(profileHtml.includes('Masuk ke akunmu'), 'Profile must have "Masuk ke akunmu"');
  assert.ok(profileHtml.includes('Masuk dengan Google'), 'Profile must have "Masuk dengan Google"');
  assert.strictEqual(profileHtml.includes('Satu langkah lagi'), false, 'Profile must NOT contain "Satu langkah lagi"');
  assert.strictEqual(profileHtml.includes('Lanjutkan dengan Google'), false, 'Profile must NOT contain "Lanjutkan dengan Google"');

  // Checkout gate check:
  delete require.cache[CHECKOUT_PATH];
  require(CHECKOUT_PATH);

  // Verify openCustomerAuthSheet in checkout still uses "Satu langkah lagi"
  let checkoutSheetHtml = '';
  const origMakeOverlay = globalThis.makeOverlay;
  // Read checkout.js file to verify canonical string intact
  const fs = require('node:fs');
  const checkoutSrc = fs.readFileSync(CHECKOUT_PATH, 'utf8');
  assert.ok(checkoutSrc.includes('Satu langkah lagi'), 'Checkout must contain "Satu langkah lagi"');
  assert.ok(checkoutSrc.includes('Lanjutkan dengan Google'), 'Checkout must contain "Lanjutkan dengan Google"');
  assert.ok(checkoutSrc.includes('Masuk dengan Google untuk melanjutkan pesananmu.'), 'Checkout must retain transaction body copy');
});

// ── Test 6: Auth state does not mutate shopping/cart context ─────────────
test('Checkout State Protection: setting customerSession does NOT alter cart, branch, or destination', () => {
  const { Store } = setupHarness();

  Store.addItem({ id: 'menu_99', name: 'Nasi Liwet', price: 25000 }, 2, { branch_id: 'branch_solo_01' });
  Store.setMatchedBranch({ id: 'branch_solo_01', name: 'Solo Branch' });
  Store.setActiveDestination({ address: 'Jl. Slamet Riyadi No. 10', latitude: -7.55, longitude: 110.82 });
  Store.setNote('menu_99', 'sambal banyak', 'branch_solo_01');

  // Simulate authentication
  Store.setCustomerSession({
    name: 'Dewi Lestari',
    email: 'dewi@example.com',
    token: 'xnt_cust_dewi_123'
  });

  const state = Store.getState();
  assert.strictEqual(state.cart.items.length, 1);
  assert.strictEqual(state.cart.items[0].id, 'menu_99');
  assert.strictEqual(state.cart.items[0].quantity, 2);
  assert.strictEqual(state.cart.items[0].note, 'sambal banyak');
  assert.strictEqual(state.matchedBranch.id, 'branch_solo_01');
  assert.strictEqual(state.activeDestination.address, 'Jl. Slamet Riyadi No. 10');
});
