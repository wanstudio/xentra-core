/**
 * Checkout upsell branch-scope — checkout.js integration tests.
 *
 * Runs the REAL customer-pwa checkout module (not a copy or emulation) under a
 * minimal DOM/API/timer harness to prove the locked Checkout Upsell Branch
 * Scope contract (docs/XENTRA_CART_CHECKOUT_CONTRACT.md):
 *
 *   Checkout = ONE fulfillment cycle for exactly ONE Branch
 *   Upsell   = products from the Checkout fulfillment Branch ONLY
 *   Order    = that same Branch
 *
 * Required coverage:
 *  - A  single-branch checkout: upsell is fetched via the authoritative
 *       Branch-scoped contract GET /catalog/menu?branch_id=<fulfillment branch>
 *  - B  multi-branch cart scoped to one branch (and the reverse branch): the
 *       rail never reads the unscoped global /catalog/menu and never falls back
 *       to globally defined products (even when a Branch has < 3 products)
 *  - C  upsell add-to-cart lands under the fulfillment Branch (never as an
 *       unassigned/global line that a branch-scoped checkout silently drops)
 *  - D  a delivery quote resolving a DIFFERENT fulfillment Branch re-scopes the
 *       rail to the new authoritative branch (stale-scope cards never persist)
 *  - E  the authoritative data contract EXISTS (branch-scoped catalog endpoint
 *       is real and used); when the fulfillment Branch cannot be resolved at
 *       all, the rail stays hidden instead of leaking global products
 *  - F  when the delivery quote resolves a fulfillment Branch that differs from
 *       the checkout's URL scope, an upsell ADD still lands in the VISIBLE
 *       checkout scope (the scope getCheckoutItems reads), so the added item
 *       appears in the checkout item list immediately and joins this order —
 *       never silently parked in another branch scope
 *  - G  pressing minus to zero moves the cleared line back into the upsell rail
 *       immediately (the rail never drains as the customer trims the list)
 *  - G2 a cleared line that is NOT part of the branch catalog pool still re-
 *       enters the rail (removal memory, not a catalog-pool coincidence)
 *
 * Harness notes:
 *  - checkout.js is loaded fresh per test (same file the browser runs).
 *  - global setTimeout/clearTimeout are captured BEFORE the debounce is armed,
 *    so the 400ms trailing delivery debounce never fires on real time.
 *  - API.get responses are branch-aware: the harness records every catalog URL
 *    and returns branch-only product pools keyed by branch_id.
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

function deliverable(branchId) {
  return {
    eligible: true,
    delivery: { final_delivery_fee: 5000, discount_amount: 0 },
    branch: { id: branchId, name: 'Cabang ' + branchId }
  };
}

// Catalog fixtures mirror the REAL GET /catalog/menu response contract
// (server/routes/api.js): top-level categories[]/all_products[]/products.items,
// branch-scoped — each branch sees ONLY its own adopted products.
const CATALOG = {
  branch_a: {
    success: true,
    categories: [{ id: 'cat_a', name: 'Menu', products: [
      { id: 'pA1', name: 'A1 Telur Asin Mantap', price: 10000, image_url: '' },
      { id: 'pA2', name: 'A2 Rawon Stroke', price: 12000, image_url: '' },
      { id: 'pA3', name: 'A3 Es Dawet', price: 8000, image_url: '' }
    ] }],
    all_products: [
      { id: 'pA1', name: 'A1 Telur Asin Mantap', price: 10000, image_url: '' },
      { id: 'pA2', name: 'A2 Rawon Stroke', price: 12000, image_url: '' },
      { id: 'pA3', name: 'A3 Es Dawet', price: 8000, image_url: '' }
    ],
    products: { items: [
      { id: 'pA1', name: 'A1 Telur Asin Mantap', price: 10000, image_url: '' },
      { id: 'pA2', name: 'A2 Rawon Stroke', price: 12000, image_url: '' },
      { id: 'pA3', name: 'A3 Es Dawet', price: 8000, image_url: '' }
    ] }
  },
  branch_b: {
    success: true,
    categories: [{ id: 'cat_b', name: 'Menu', products: [
      { id: 'pB1', name: 'B1 Kopi Susu Malang', price: 15000, image_url: '' }
    ] }],
    all_products: [{ id: 'pB1', name: 'B1 Kopi Susu Malang', price: 15000, image_url: '' }],
    products: { items: [{ id: 'pB1', name: 'B1 Kopi Susu Malang', price: 15000, image_url: '' }] }
  }
};

// What an unscoped GET /catalog/menu returns (cross-branch/global pool).
// The checkout upsell must NEVER call this; if it ever does, the tests fail.
const GLOBAL_CATALOG = {
  success: true,
  categories: [{ id: 'cat_g', name: 'Global', products: [
    { id: 'pG1', name: 'GLOBAL Semar Special', price: 35000, image_url: '' },
    { id: 'pG2', name: 'GLOBAL Mie Gurih', price: 15000, image_url: '' }
  ] }],
  all_products: [
    { id: 'pG1', name: 'GLOBAL Semar Special', price: 35000, image_url: '' },
    { id: 'pG2', name: 'GLOBAL Mie Gurih', price: 15000, image_url: '' }
  ],
  products: { items: [
    { id: 'pG1', name: 'GLOBAL Semar Special', price: 35000, image_url: '' },
    { id: 'pG2', name: 'GLOBAL Mie Gurih', price: 15000, image_url: '' }
  ] }
};

const BRANCHES = [
  { id: 'branch_a', name: 'Cabang A' },
  { id: 'branch_b', name: 'Cabang B' }
];

// Fresh store + checkout module with a branch-aware DOM/API harness.
// `opts.routerBranch` is what the SPA router reports for a scoped checkout URL
// (#checkout/branch/<id>); null means an unscoped checkout entry.
// `opts.branches` overrides the /brand/branches response (null -> empty list).
function freshHarness(seedCart, opts) {
  opts = opts || {};
  const storage = {};
  const timers = installTimerCapture();

  // Minimal DOM: rows element lets syncRowsFromItems take the targeted row-patch
  // path; the upsell elements capture the rendered rail + add-buttons.
  const qtyNode = { textContent: '' };
  const rowEl = fakeEl({
    querySelector: (sel) => (sel.indexOf('x-quantity-value') >= 0 ? qtyNode : null)
  });
  const rowsEl = fakeEl({
    querySelector: (sel) => (sel.indexOf('data-item-key') >= 0 ? rowEl : null)
  });
  const wrapEl = fakeEl({ style: {} });
  const trackButtons = [];
  let trackRawHtml = '';
  const trackEl = fakeEl({
    style: {},
    addEventListener: () => {},
    querySelectorAll: (sel) => (sel.indexOf('x-upsell-add-btn') >= 0 ? trackButtons : [])
  });
  Object.defineProperty(trackEl, 'innerHTML', {
    configurable: true,
    get: () => trackRawHtml,
    set: (html) => {
      trackRawHtml = String(html || '');
      trackButtons.length = 0;
      const re = /data-add-upsell="([^"]+)"/g;
      let m;
      while ((m = re.exec(trackRawHtml)) !== null) {
        const pid = m[1];
        trackButtons.push({ pid: pid, getAttribute: (a) => (a === 'data-add-upsell' ? pid : null), onclick: null });
      }
    }
  });
  const ids = new Map([
    ['x-checkout-items-rows', rowsEl],
    ['x-upsell-container', wrapEl],
    ['x-addon-track', trackEl]
  ]);

  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  globalThis.window = globalThis;
  // enableTrackDragScroll attaches passive mousemove/mouseup listeners on window.
  globalThis.window.addEventListener = () => {};
  globalThis.window.removeEventListener = () => {};
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
  const catalogCalls = []; // every catalog URL the page issued
  const api = {
    get: (url) => {
      if (url.indexOf('/brand/branches') === 0) {
        return Promise.resolve({ success: true, branches: opts.branches || [] });
      }
      if (url.indexOf('/promotions/active') === 0) {
        return Promise.resolve({ success: true, promotions: [], applied: [], rejected: [] });
      }
      if (url === '/catalog/menu' || url.indexOf('/catalog/menu?') === 0) {
        catalogCalls.push(url);
        if (url === '/catalog/menu') return Promise.resolve(GLOBAL_CATALOG); // must never happen
        const q = url.indexOf('?branch_id=');
        if (q >= 0) {
          const bid = url.slice(q + '?branch_id='.length);
          return Promise.resolve(CATALOG[bid] || { success: true, data: { categories: [] } });
        }
        return Promise.resolve(GLOBAL_CATALOG);
      }
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
  window.Xentra.UI = {
    escape: (v) => String(v),
    toast: () => {},
    upsellCard: (p) => '<div class="x-upsell-card x-upsell-add-btn" data-add-upsell="' + p.id + '" data-name="' + p.name + '">' + p.name + '</div>'
  };
  window.Xentra.Router = {
    getItemIdFromUrl: () => null,
    getBranchIdFromUrl: () => (opts.routerBranch || null),
    getCurrentView: () => 'checkout',
    navigate: () => {}
  };

  delete require.cache[STORE_PATH];
  delete require.cache[CHECKOUT_PATH];
  require(STORE_PATH);

  const notifications = [];
  window.Xentra.Store.subscribe((m) => notifications.push(m && m.type));
  if (seedCart) seedCart(window.Xentra.Store);

  // Minus/plus buttons live inside the checkout layout; the harness exposes a
  // fixed set so bindItemEvents can wire the real minus handler, which the
  // "cleared line returns to the rail" tests drive.
  const minusButtons = (opts.minusItems || []).map((m) => ({
    dataset: { minusItem: m.pid, branchItem: m.bid || '' }
  }));
  const mountEl = fakeEl({
    querySelectorAll: (sel) => (sel.indexOf('data-minus-item') >= 0 ? minusButtons : [])
  });

  require(CHECKOUT_PATH);
  window.Xentra.Checkout.mount(mountEl);

  return {
    Store: window.Xentra.Store,
    api: api,
    posts: posts,
    resolvers: resolvers,
    storage: storage,
    rowsEl: rowsEl,
    qtyNode: qtyNode,
    wrapEl: wrapEl,
    trackEl: trackEl,
    trackButtons: trackButtons,
    minusButtons: minusButtons,
    catalogCalls: catalogCalls,
    notifications: notifications,
    timers: timers,
    resolvePost: (i, res) => { resolvers[i](res); },
    flush: async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); },
    catalogUpsellCalls: () => catalogCalls.filter((u) => u.indexOf('branch_id=') >= 0),
    unscopedCatalogCalls: () => catalogCalls.filter((u) => u === '/catalog/menu'),
    cleanup: () => timers.restore()
  };
}

test('A: single-branch checkout upsell uses only the fulfillment-branch catalog contract', async () => {
  const g = freshHarness((Store) => {
    Store.addItem(product('cartA', 'Sudah di keranjang A'), 2, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  }, { routerBranch: 'branch_a', branches: BRANCHES });
  try {
    await g.flush();

    const scopeCalls = g.catalogUpsellCalls();
    assert.strictEqual(g.unscopedCatalogCalls().length, 0, 'A: unscoped global GET /catalog/menu was NEVER called by the checkout');
    assert.ok(scopeCalls.length >= 1, 'A: branch-scoped upsell fetch was issued');
    assert.ok(scopeCalls.every((u) => u === '/catalog/menu?branch_id=branch_a'), 'A: every upsell fetch is for the Checkout fulfillment branch ONLY');
    assert.ok(scopeCalls.length === 1, 'A: exactly one upsell fetch (no redundant re-fetch while branch is stable)');

    const html = g.trackEl.innerHTML;
    assert.ok(html.indexOf('A1 Telur Asin Mantap') >= 0, 'A: rail contains branch_a product A1');
    assert.ok(html.indexOf('A2 Rawon Stroke') >= 0, 'A: rail contains branch_a product A2');
    assert.ok(html.indexOf('A3 Es Dawet') >= 0, 'A: rail contains branch_a product A3');
    assert.ok(html.indexOf('pB1') === -1 && html.indexOf('B1 Kopi') === -1, 'A: NO branch_b product ever crosses into this checkout');
    assert.ok(html.indexOf('GLOBAL') === -1, 'A: NO global-catalog fallback product ever appears');
    assert.strictEqual(g.wrapEl.style.display, 'block', 'A: rail is visible with branch-scoped items');
  } finally {
    g.cleanup();
  }
});

test('B/C: multi-branch cart scoped to the OTHER branch (reverse): rail + add lands under branch_b only', async () => {
  const g = freshHarness((Store) => {
    Store.addItem(product('cartA', 'Sudah di keranjang A'), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });
    Store.addItem(product('cartB', 'Sudah di keranjang B'), 1, { branch_id: 'branch_b', branch_name: 'Cabang B' });
  }, { routerBranch: 'branch_b', branches: BRANCHES });
  try {
    await g.flush();

    const scopeCalls = g.catalogUpsellCalls();
    assert.ok(scopeCalls.length >= 1, 'C: reverse checkout still fetches branch-scoped upsell');
    assert.ok(scopeCalls.every((u) => u === '/catalog/menu?branch_id=branch_b'), 'C: scope is the checkout branch (branch_b), NOT the cart-mixed brand scope');
    assert.strictEqual(g.unscopedCatalogCalls().length, 0, 'B: unscoped global catalog never called for a multi-branch cart');

    const html = g.trackEl.innerHTML;
    assert.ok(html.indexOf('B1 Kopi Susu Malang') >= 0, 'B: branch_b product shown for the branch_b checkout');
    assert.ok(html.indexOf('A1') === -1 && html.indexOf('A2') === -1 && html.indexOf('A3') === -1, 'B: branch_a products NEVER leak into the branch_b rail');
    assert.ok(html.indexOf('GLOBAL') === -1, 'B: <3 products on branch_b still does NOT pad the rail from the global catalog');
    assert.ok(html.split('x-upsell-card').length - 1 === 1, 'B: branch_b contributes exactly its own single product — no fallback padding');

    // Upsell add: must enter the cart under the fulfillment branch (branch_b).
    assert.strictEqual(g.Store.findCartItem('pB1', 'branch_b'), null, 'before add, pB1 not in the branch_b cart yet');
    assert.strictEqual(g.trackButtons.length, 1, 'one add button rendered');
    g.trackButtons[0].onclick({ stopPropagation: () => {} });

    const added = g.Store.findCartItem('pB1', 'branch_b');
    assert.ok(added, 'B: upsell item added to the cart');
    assert.strictEqual(added.quantity, 1, 'added qty 1');
    assert.strictEqual(added.branch_id, 'branch_b', 'B: added UNDER the fulfillment branch, never unassigned');
    assert.strictEqual(added.branch_name, 'Cabang B', 'B: provenance carries the fulfillment branch name');
    assert.strictEqual(g.Store.findCartItem('pB1', '__unassigned__'), null, 'B: NO unassigned/global line was created');
    assert.strictEqual(g.Store.findCartItem('pB1', 'branch_a'), null, 'B: never merges into the other branch scope');
  } finally {
    g.cleanup();
  }
});

test('D: a delivery quote resolving a DIFFERENT fulfillment branch re-scopes the rail', async () => {
  const g = freshHarness((Store) => {
    Store.addItem(product('cartA', 'Sudah di keranjang A'), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  }, { branches: BRANCHES }); // no explicit branch scope: the Order branch is decided by the delivery quote
  try {
    await g.flush(); // branches prefill -> fulfillment branch branch_a -> upsell branch_a
    assert.strictEqual(g.unscopedCatalogCalls().length, 0, 'D: global catalog never called');
    assert.ok(g.catalogUpsellCalls().some((u) => u === '/catalog/menu?branch_id=branch_a'), 'D: initial scope branch_a');

    // The delivery domain resolves a different fulfillment branch (branch_b).
    g.resolvePost(g.posts.length - 1, deliverable('branch_b'));
    await g.flush();

    const scopeCalls = g.catalogUpsellCalls();
    assert.ok(scopeCalls.some((u) => u === '/catalog/menu?branch_id=branch_b'), 'D: rail re-scoped to the newly authoritative branch (branch_b)');
    const html = g.trackEl.innerHTML;
    assert.ok(html.indexOf('B1 Kopi Susu Malang') >= 0, 'D: new fulfillment branch product shown');
    assert.ok(html.indexOf('A1') === -1 && html.indexOf('A2') === -1 && html.indexOf('A3') === -1, 'D: stale branch_a cards were dropped, never persisted');
    assert.ok(html.indexOf('GLOBAL') === -1, 'D: still no global fallback');
  } finally {
    g.cleanup();
  }
});

test('F: quote resolving a different branch does NOT park the upsell add outside the visible checkout list', async () => {
  const g = freshHarness((Store) => {
    Store.addItem(product('cartB', 'Sudah di keranjang B'), 1, { branch_id: 'branch_b', branch_name: 'Cabang B' });
  }, { routerBranch: 'branch_b', branches: BRANCHES }); // checkout URL-scoped to branch_b
  try {
    await g.flush();

    // The delivery quote resolves a DIFFERENT authoritative branch (branch_a):
    // the rail re-scopes to branch_a (fulfillment authority)...
    g.resolvePost(g.posts.length - 1, deliverable('branch_a'));
    await g.flush();
    assert.ok(g.trackEl.innerHTML.indexOf('A1 Telur Asin Mantap') >= 0, 'F: fulfillment branch re-scoped the rail to branch_a');

    // ...but the checkout ITEM LIST still reads the URL scope (branch_b).
    // Clicking + must land the item in THAT visible scope, not branch_a.
    const btn = g.trackButtons.find((b) => b.pid === 'pA1');
    assert.ok(btn, 'F: add button for the re-scoped branch_a product exists');
    btn.onclick({ stopPropagation: () => {} });
    await g.flush();

    const added = g.Store.findCartItem('pA1', 'branch_b');
    assert.ok(added, 'F: upsell item entered the VISIBLE checkout scope (branch_b)');
    assert.strictEqual(added.quantity, 1, 'F: added qty 1');
    assert.strictEqual(added.branch_name, 'Cabang B', 'F: provenance carries the visible checkout scope name');
    assert.strictEqual(g.Store.findCartItem('pA1', 'branch_a'), null, 'F: nothing was parked in the differing fulfillment branch scope');
    assert.strictEqual(g.Store.findCartItem('pA1', '__unassigned__'), null, 'F: no unassigned line was created');

    // The checkout item list (getCheckoutItems -> getCartItemsForBranch(branch_b))
    // rebuilt and now visibly contains the added item.
    assert.ok(g.rowsEl.innerHTML.indexOf('A1 Telur Asin Mantap') >= 0,
      'F: the added item appears in the visible checkout item list immediately');
  } finally {
    g.cleanup();
  }
});

test('G: minus to zero moves the cleared line back into the upsell rail (rail never drains)', async () => {
  const g = freshHarness((Store) => {
    Store.addItem(product('pA1', 'A1 Telur Asin Mantap', 10000), 2, { branch_id: 'branch_a', branch_name: 'Cabang A' });
    Store.addItem(product('cartB', 'Sudah di keranjang B2', 12000), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  }, { routerBranch: 'branch_a', branches: BRANCHES, minusItems: [{ pid: 'pA1', bid: 'branch_a' }] });
  try {
    await g.flush();

    assert.ok(g.trackEl.innerHTML.indexOf('A1 Telur Asin Mantap') === -1, 'G: in-cart item is not offered in the rail');
    assert.strictEqual(g.Store.getCartItemsForBranch('branch_a').length, 2, 'G: both lines in the branch_a cart');

    g.minusButtons[0].onclick({}); // 2 -> 1
    await g.flush();
    assert.strictEqual(g.Store.findCartItem('pA1', 'branch_a').quantity, 1, 'G: qty 1 after first minus');
    assert.ok(g.trackEl.innerHTML.indexOf('A1 Telur Asin Mantap') === -1, 'G: still in cart -> still excluded from the rail');

    g.minusButtons[0].onclick({}); // 1 -> 0: cleared -> re-enters the rail
    await g.flush();
    assert.strictEqual(g.Store.findCartItem('pA1', 'branch_a'), null, 'G: line removed from the checkout list');
    assert.ok(g.trackEl.innerHTML.indexOf('A1 Telur Asin Mantap') >= 0, 'G: cleared item immediately appears in the upsell rail');
    assert.ok(g.trackEl.innerHTML.indexOf('A2 Rawon Stroke') >= 0, 'G: rail still carries the rest of the branch catalog (never drained)');
  } finally {
    g.cleanup();
  }
});

test('G2: a cleared line NOT in the branch catalog pool still returns (removal memory, not pool luck)', async () => {
  const g = freshHarness((Store) => {
    Store.addItem(product('pX1', 'X Item Spesial Pembeli', 25000), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });
    Store.addItem(product('cartB', 'Sudah di keranjang B2', 12000), 3, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  }, { routerBranch: 'branch_a', branches: BRANCHES, minusItems: [{ pid: 'pX1', bid: 'branch_a' }] });
  try {
    await g.flush();

    // pX1 is in the cart but NOT in CATALOG.branch_a -> never offered initially.
    assert.ok(g.trackEl.innerHTML.indexOf('X Item Spesial Pembeli') === -1, 'G2: foreign in-cart item not offered initially');

    g.minusButtons[0].onclick({}); // clear it
    await g.flush();
    assert.strictEqual(g.Store.findCartItem('pX1', 'branch_a'), null, 'G2: item removed from the list');
    assert.ok(g.trackEl.innerHTML.indexOf('X Item Spesial Pembeli') >= 0,
      'G2: removed item re-enters the rail even though the branch catalog pool never contained it');
    assert.ok(g.trackEl.innerHTML.indexOf('A1 Telur Asin Mantap') >= 0, 'G2: catalog pool still present alongside');
  } finally {
    g.cleanup();
  }
});

test('E: no data-contract gap — branch-scoped contract is used; unresolved branch renders NOTHING (no global leak)', async () => {
  const g = freshHarness(null, {}); // empty cart, no branch context, no scoped URL
  try {
    await g.flush();

    assert.strictEqual(g.catalogCalls.length, 0, 'E: with NO resolvable branch, the checkout issues ZERO catalog fetches (never a global one)');
    assert.strictEqual(g.wrapEl.style.display, 'none', 'E: rail stays hidden until the fulfillment branch is resolved');
    assert.strictEqual(g.trackEl.innerHTML, '', 'E: nothing is rendered while the branch is unresolved');
  } finally {
    g.cleanup();
  }
});