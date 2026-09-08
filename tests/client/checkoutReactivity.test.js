/**
 * Checkout quantity fast-path performance — checkout.js integration tests.
 *
 * Runs the REAL customer-pwa checkout module (not a copy or emulation) under a
 * minimal DOM/API/timer harness to prove the locked reactive cart contract:
 *
 *   user tap -> mutate authoritative Cart State -> UI immediately -> async
 *   reconciliation (delivery quote: trailing-debounced + latest-wins)
 *
 * Required coverage:
 *  - T1  immediate + : state qty == 2 right after the tap, no network waited
 *  - T2  immediate - : state qty == 1 right after the tap
 *  - T3  rapid + + + + + : final quantity correct, not blocked by secondary work
 *  - T4  latest state wins: an older revision reply arriving LAST is rejected
 *  - T5  back-to-home consistency: checkout mutation visible to home-style reads
 *  - T6  branch isolation (SKU A / branch B untouched)
 *  - T7  multi-branch cart preserved
 *  - T8  single-branch checkout read boundary
 *  - T9  no blocking network: local state/UI update completes while the delivery
 *        POST is still pending
 *  - T10 reconciliation correctness: an applied quote never reverts newer cart
 *        changes (no qty rollback)
 *
 * Harness notes:
 *  - checkout.js is loaded fresh per test (same file the browser runs).
 *  - global setTimeout/clearTimeout are captured BEFORE the debounce is armed,
 *    so the 400ms trailing debounce never fires on real time; tests fire it
 *    manually or not at all (deterministic, no sleep).
 *  - API.post returns user-controllable pending promises so the test can make a
 *    stale reply arrive after the newer one was requested.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');
const CHECKOUT_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js');

// Fixed real timers: each harness installs a capture shim on top of these.
const REAL_SET_TIMEOUT = globalThis.setTimeout;
const REAL_CLEAR_TIMEOUT = globalThis.clearTimeout;

const CART_KEY = 'xentra_v2_cart';
const BRANCH_KEY = 'xentra_v2_branch';

function fakeEl(overrides) {
  return Object.assign({
    innerHTML: '',
    textContent: '',
    style: {},
    dataset: {},
    classList: { add: () => {}, remove: () => {} },
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    onclick: null
  }, overrides || {});
}

function installTimerCapture() {
  const captured = [];
  let nextId = 0;
  globalThis.setTimeout = (fn, delay) => {
    captured.push({ id: ++nextId, fn: fn, delay: delay });
    return nextId;
  };
  globalThis.clearTimeout = () => {};
  return {
    captured: captured,
    fire: function (n) { const t = captured[n]; if (t) t.fn(); return Boolean(t); },
    restore: function () { globalThis.setTimeout = REAL_SET_TIMEOUT; globalThis.clearTimeout = REAL_CLEAR_TIMEOUT; }
  };
}

function product(id, name, price) {
  return { id: id, name: name || ('Produk ' + id), price: price || 35000 };
}

// Fresh store + checkout module with a minimal DOM/API harness. `seedCart` runs
// after the store loads but before the checkout module mounts so the mount-time
// delivery quote actually sees cart lines.
function freshHarness(seedCart) {
  const storage = {};
  const timers = installTimerCapture();

  // Minimal DOM: a persistent rows element lets syncRowsFromItems take the
  // targeted row-patch path after the first full render; qtyNode records the
  // patched visible quantity.
  const qtyNode = { textContent: '' };
  const rowEl = fakeEl({
    querySelector: (sel) => (sel.indexOf('x-quantity-value') >= 0 ? qtyNode : null)
  });
  const rowsEl = fakeEl({
    querySelector: (sel) => (sel.indexOf('data-item-key') >= 0 ? rowEl : null)
  });
  const ids = new Map([['x-checkout-items-rows', rowsEl]]);

  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  globalThis.window = globalThis;
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.document = {
    addEventListener: () => {},
    getElementById: (id) => ids.get(id) || null
  };
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };

  const posts = [];
  const resolvers = [];
  const api = {
    get: (url) => {
      if (url.indexOf('/brand/branches') === 0) return Promise.resolve({ success: true, branches: [] });
      if (url.indexOf('/promotions/active') === 0) return Promise.resolve({ success: true, promotions: [], applied: [], rejected: [] });
      return Promise.resolve({ success: true });
    },
    post: (url, body) => {
      const promise = new Promise((resolve) => { resolvers.push(resolve); });
      posts.push({ url: url, body: body });
      return promise;
    }
  };

  window.Xentra = window.Xentra || {};
  window.Xentra.API = api;
  window.Xentra.UI = { escape: (v) => String(v), toast: () => {} };
  window.Xentra.Router = {
    getItemIdFromUrl: () => null,
    getBranchIdFromUrl: () => null,
    getCurrentView: () => 'checkout',
    navigate: () => {}
  };

  delete require.cache[STORE_PATH];
  delete require.cache[CHECKOUT_PATH];
  require(STORE_PATH);

  const notifications = [];
  window.Xentra.Store.subscribe((m) => notifications.push(m && m.type));
  if (seedCart) seedCart(window.Xentra.Store);

  require(CHECKOUT_PATH);
  window.Xentra.Checkout.mount(fakeEl());

  return {
    Store: window.Xentra.Store,
    api: api,
    posts: posts,
    resolvers: resolvers,
    storage: storage,
    rowsEl: rowsEl,
    qtyNode: qtyNode,
    notifications: notifications,
    timers: timers,
    resolvePost: (i, res) => { resolvers[i](res); },
    flush: async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); },
    cleanup: () => timers.restore()
  };
}

function deliverable(branchId) {
  return {
    eligible: true,
    delivery: { final_delivery_fee: 5000, discount_amount: 0 },
    branch: { id: branchId, name: 'Cabang ' + branchId }
  };
}

function cartEventCount(notifications) {
  return notifications.filter((t) => t === 'cart').length;
}

test('T1/T2 immediate +/-: authoritative state mutates in the same tick while the delivery POST is still pending', () => {
  const g = freshHarness((Store) => {
    Store.addItem(product('272', 'Paket Semar'), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  });
  try {
    assert.strictEqual(g.posts.length, 1, 'mount issued a delivery quote; it is still unresolved (network in flight)');

    const baselineCart = cartEventCount(g.notifications);

    g.Store.setQty('272', 2, 'branch_a'); // tap +

    assert.strictEqual(g.Store.findCartItem('272', 'branch_a').quantity, 2, 'T1: state qty immediately 2');
    assert.strictEqual(g.Store.getCartSubtotal(), 70000, 'subtotal immediately updated');
    assert.strictEqual(g.Store.getCartCount(), 2, 'cart count immediately updated');
    assert.strictEqual(JSON.parse(g.storage[CART_KEY]).items[0].quantity, 2, 'persisted in the same tick (recovery contract)');
    assert.strictEqual(g.qtyNode.textContent, '2', 'visible quantity patched in place');
    assert.strictEqual(g.posts.length, 1, 'T9: the + tap issued NO network call');

    g.Store.setQty('272', 1, 'branch_a'); // tap -

    assert.strictEqual(g.Store.findCartItem('272', 'branch_a').quantity, 1, 'T2: state qty immediately 1');
    assert.strictEqual(JSON.parse(g.storage[CART_KEY]).items[0].quantity, 1, 'minus persisted too');
    assert.strictEqual(g.posts.length, 1, 'the - tap issued NO network call');

    assert.strictEqual(cartEventCount(g.notifications) - baselineCart, 2, 'exactly one cheap cart event per tap');
  } finally {
    g.cleanup();
  }
});

test('T3/T9 rapid + + + + + : local state/UI complete per tap, full burst coalesces to ONE follow-up quote', () => {
  const g = freshHarness((Store) => {
    Store.addItem(product('272', 'Paket Semar'), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  });
  try {
    assert.strictEqual(g.posts.length, 1, 'mount delquote is pending');
    const marker = g.rowsEl.innerHTML;
    const baselineCart = cartEventCount(g.notifications);

    for (let i = 0; i < 5; i++) {
      const it = g.Store.findCartItem('272', 'branch_a');
      g.Store.setQty('272', Number(it.quantity) + 1, 'branch_a');
    }

    assert.strictEqual(g.Store.findCartItem('272', 'branch_a').quantity, 6, 'T3: final qty correct after + + + + +');
    assert.strictEqual(g.Store.getCartSubtotal(), 35000 * 6, 'subtotal follows the authoritative qty');
    assert.strictEqual(JSON.parse(g.storage[CART_KEY]).items[0].quantity, 6, 'persisted after the burst');
    assert.strictEqual(g.qtyNode.textContent, '6', 'visible quantity patched in place');
    assert.strictEqual(g.rowsEl.innerHTML, marker, 'row DOM was patched, never rebuilt per tap');
    assert.strictEqual(cartEventCount(g.notifications) - baselineCart, 5, 'five taps -> five cheap cart events, nothing else');
    assert.strictEqual(g.posts.length, 1, 'T9: ZERO network calls during the burst (mount quote still pending)');
    assert.strictEqual(g.timers.captured.length, 5, 'each tap armed a newer debounce, superseding the previous one');

    g.timers.fire(g.timers.captured.length - 1); // only the trailing (latest) debounce fires
    assert.strictEqual(g.posts.length, 2, 'the whole burst coalesced into a single reconcile quote');
  } finally {
    g.cleanup();
  }
});

test('T4/T10 latest state wins: a stale delivery reply (older revision arriving last) is rejected', async () => {
  const g = freshHarness((Store) => {
    Store.addItem(product('272', 'Paket Semar'), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  });
  try {
    assert.strictEqual(g.posts.length, 1, 'mount issued revision-1 quote');
    assert.strictEqual(g.storage[BRANCH_KEY], undefined, 'no branch resolved yet');

    // User keeps tapping: cart reaches revision > 1 and schedules a NEW quote.
    for (let i = 0; i < 3; i++) {
      const it = g.Store.findCartItem('272', 'branch_a');
      g.Store.setQty('272', Number(it.quantity) + 1, 'branch_a');
    }
    assert.strictEqual(g.Store.findCartItem('272', 'branch_a').quantity, 4);
    g.timers.fire(g.timers.captured.length - 1); // trailing quote for the newest revision
    assert.strictEqual(g.posts.length, 2, 'a follow-up (newer revision) quote was issued');

    // Stale answer for the OLD revision arrives AFTER the newer one was
    // requested — it must be dropped without any state/DOM/network effect.
    g.resolvePost(0, deliverable('branch_old'));
    await g.flush();

    assert.strictEqual(g.Store.getState().matchedBranch, null, 'T4: stale revision was rejected — nothing applied');
    assert.strictEqual(g.storage[BRANCH_KEY], undefined, 'T4: stale revision was rejected — nothing persisted');
    assert.strictEqual(g.posts.length, 2, 'stale reply did not re-trigger the quote path');
    assert.strictEqual(g.Store.findCartItem('272', 'branch_a').quantity, 4, 'newest cart qty untouched by the stale reply');

    // Latest answer applies and becomes the persisted branch.
    g.resolvePost(1, deliverable('branch_latest'));
    await g.flush();

    const applied = g.Store.getState().matchedBranch;
    assert.ok(applied && applied.branch && applied.branch.id === 'branch_latest', 'latest revision applied');
    assert.strictEqual(JSON.parse(g.storage[BRANCH_KEY]).branch.id, 'branch_latest', 'applied branch persisted');
    assert.strictEqual(g.Store.findCartItem('272', 'branch_a').quantity, 4, 'T10: reconciliation never rolled back the newer cart change');
  } finally {
    g.cleanup();
  }
});

test('T5/T6/T7/T8 back-to-home consistency and branch isolation from the SAME authoritative store', () => {
  const g = freshHarness((Store) => {
    Store.addItem(product('272', 'Paket Semar'), 2, { branch_id: 'branch_a', branch_name: 'Cabang A' });
    Store.addItem(product('272', 'Paket Semar'), 1, { branch_id: 'branch_b', branch_name: 'Cabang B' });
  });
  try {
    // Home-style reads: cart dock (count/subtotal/groups) + catalog row qty.
    const homeRead = () => ({
      count: g.Store.getCartCount(),
      subtotal: g.Store.getCartSubtotal(),
      groups: g.Store.getCartBranchGroups().length,
      line: g.Store.findCartItem('272', 'branch_a'),
      totalQtyOfA: g.Store.getCartItemsForBranch('branch_a')[0].quantity
    });
    const before = homeRead();
    assert.strictEqual(before.line.quantity, 2);
    assert.strictEqual(before.groups, 2, 'T7: multi-branch cart exists (two scopes)');

    // Checkout (single-branch) tap on branch A.
    g.Store.setQty('272', 5, 'branch_a');

    const after = homeRead();
    assert.strictEqual(after.line.quantity, 5, 'T5: Back to Home shows the latest qty from shared state');
    assert.strictEqual(after.totalQtyOfA, 5, 'T8: checkout single-branch read agrees on the same line');
    assert.strictEqual(after.count, 6, 'dock count = 5 + 1');
    assert.strictEqual(after.subtotal, 35000 * 6, 'dock subtotal derived from the same state');
    assert.strictEqual(g.Store.findCartItem('272', 'branch_b').quantity, 1, 'T6: branch B line never bled into');
    assert.strictEqual(g.Store.getCartBranchGroups().length, 2, 'T7: still two branch scopes after the mutation');
  } finally {
    g.cleanup();
  }
});