/**
 * Checkout quantity performance / reactive state — client Store reactivity
 * contract.
 *
 * Locked behavioral contract (Notion: Checkout is single-branch transaction
 * scope; delivery/promotion are independent domains; cart state is MEMORY-first
 * -> UI first -> PERSIST second):
 *  1. notify() broadcasts a LIGHTWEIGHT mutation descriptor ({ type: ... }),
 *     never a deep-cloned full-state snapshot (the old notify() JSON-cloned the
 *     entire app state on EVERY mutation and every subscriber then re-read the
 *     state itself — 100% wasted work, synchronous to every qty click).
 *  2. Cart mutations expose { type: 'cart' } so the checkout subscriber can
 *     filter out irrelevant ops (e.g. orderType/branch changes) instead of
 *     re-rendering / re-quoting on every notification.
 *  3. Ordering inside a cart op is mutate -> notify -> save (memory first,
 *     persistence second) — persistence is still synchronous within the same
 *     tick so recovery semantics are unchanged.
 *  4. getState() remains a detached snapshot for the callers that need one.
 *  5. Rapid qty interaction (1->2->3->4) is branch-scoped, one event per tap,
 *     and never bleeds into other branches. (The quote itself is async +
 *     debounced + latest-wins on the checkout page; the store only guarantees
 *     the state transitions are cheap, sequential and correct.)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');

const CART_KEY = 'xentra_v2_cart';

function freshStore(seedStorage) {
  const storage = seedStorage || {};
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };
  delete require.cache[STORE_PATH];
  require(STORE_PATH);
  return globalThis.window.Xentra.Store;
}

function product(id, name, price) {
  return { id: id, name: name || ('Produk ' + id), price: price || 10000 };
}

test('PERF notify broadcasts a mutation descriptor, NOT a deep-cloned state snapshot', () => {
  const Store = freshStore();
  Store.addItem(product('272'), 1, { branch_id: 'branch_a' });

  let seen = [];
  Store.subscribe((m) => seen.push(m));

  Store.setQty('272', 2, 'branch_a');

  assert.strictEqual(seen.length, 1, 'exactly one notification for one mutation');
  const m = seen[0];
  assert.ok(m && typeof m === 'object', 'subscriber receives a mutation descriptor');
  assert.strictEqual(m.type, 'cart', 'descriptor carries the change type');
  assert.strictEqual(m.cart, undefined, 'descriptor is NOT a full state snapshot');
  assert.strictEqual(m.items, undefined, 'descriptor carries no state payload');
  assert.notStrictEqual(m, Store.getState(), 'never the deep-cloned app state');
});

test('PERF snapshot semantics preserved: getState() returns a detached clone the subscriber never needs', () => {
  const Store = freshStore();
  Store.addItem(product('272'), 1);

  const snap = Store.getState();
  snap.cart.items[0].quantity = 99;
  snap.promo.enabled = true;

  assert.strictEqual(Store.getCartCount(), 1, 'mutating the snapshot cannot corrupt live state');
  assert.strictEqual(Store.getState().promo.enabled, false);
});

test('PERF ordering: memory first -> UI (notify) -> PERSIST second, still synchronous per op', () => {
  const storage = {};
  const Store = freshStore(storage);
  Store.addItem(product('272'), 1, { branch_id: 'branch_a' });

  let persistedDuringNotify = null;
  let memoryDuringNotify = null;
  Store.subscribe(() => {
    persistedDuringNotify = storage[CART_KEY];
    memoryDuringNotify = Store.getState().cart.items[0].quantity;
  });

  Store.setQty('272', 2, 'branch_a');

  // Inside the notification the LIVE state already reflects the change
  // (memory first)…
  assert.strictEqual(memoryDuringNotify, 2, 'store state is updated before subscribers run');
  // …but persistence has not happened yet (UI first, persist second).
  const during = JSON.parse(persistedDuringNotify);
  assert.strictEqual(during.items[0].quantity, 1, 'localStorage still holds the previous value during notify');

  // Persistence still lands synchronously within the SAME call (recovery contract).
  const after = JSON.parse(storage[CART_KEY]);
  assert.strictEqual(after.items[0].quantity, 2, 'persisted once the mutation call returns');
});

test('PERF cart ops type cart; non-cart ops expose distinct types so subscribers can filter', () => {
  const Store = freshStore();
  const types = [];
  Store.subscribe((m) => types.push(m && m.type));

  Store.addItem(product('272'), 1, { branch_id: 'branch_a' });
  Store.setQty('272', 2, 'branch_a');
  Store.setNote('272', 'tanpa pedas');
  Store.setLocation({ latitude: 1, longitude: 2 });
  Store.setMatchedBranch({ branch: { id: 'x' } });
  Store.setOrderType('pickup');
  Store.removeCartItem('272', 'branch_a');
  Store.removeBranchItems('branch_a');
  Store.clearCart();

  const cart = types.filter((t) => t === 'cart').length;
  assert.strictEqual(cart, 6, 'six cart ops emit cart events (add/setQty/setNote/removeCartItem/removeBranchItems/clearCart)');
  assert.ok(types.includes('location'), 'setLocation emits a location event');
  assert.ok(types.includes('branch'), 'setMatchedBranch emits a branch event');
  assert.ok(types.includes('orderType'), 'setOrderType emits a distinct event');
  assert.strictEqual(types.filter((t) => t === 'cart').length + types.filter((t) => t !== 'cart').length, types.length);
});

test('PERF a checkout-style filtered subscriber only wakes for cart/location (no unrelated rerenders)', () => {
  const Store = freshStore();
  Store.addItem(product('272'), 1, { branch_id: 'branch_a' });

  let wakeups = [];
  Store.subscribe((m) => {
    const mt = m && m.type;
    if (mt !== 'cart' && mt !== 'location') return; // checkout subscriber filter
    wakeups.push(mt);
  });

  Store.setOrderType('pickup');       // fulfillment switch: ignored by subscriber
  Store.setMatchedBranch({ branch: { id: 'y' } }); // loop-breaking branch notify: ignored
  Store.setQty('272', 2, 'branch_a'); // qty tap: subscriber wakes once
  Store.setLocation({ latitude: 3 }); // address change: subscriber wakes

  assert.deepStrictEqual(wakeups, ['cart', 'location'], 'only cart/location mutations reach the checkout-style subscriber');
});

test('BUGFIX perf rapid interaction 1->2->3->4: branch-scoped, one event per tap, final state correct', () => {
  const storage = {};
  const Store = freshStore(storage);
  Store.addItem(product('272', 'Paket Semar', 35000), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  Store.addItem(product('272', 'Paket Semar', 35000), 1, { branch_id: 'branch_b', branch_name: 'Cabang B' });

  let notifications = 0;
  Store.subscribe(() => { notifications += 1; });

  // Rapid "+ + + +" on the branch A line: qty 1 -> 2 -> 3 -> 4.
  let a = Store.findCartItem('272', 'branch_a');
  Store.setQty('272', Number(a.quantity) + 1, 'branch_a');
  a = Store.findCartItem('272', 'branch_a');
  Store.setQty('272', Number(a.quantity) + 1, 'branch_a');
  a = Store.findCartItem('272', 'branch_a');
  Store.setQty('272', Number(a.quantity) + 1, 'branch_a');

  assert.strictEqual(Store.findCartItem('272', 'branch_a').quantity, 4, 'branch A reached qty 4 (1 -> 2 -> 3 -> 4)');
  assert.strictEqual(Store.findCartItem('272', 'branch_b').quantity, 1, 'branch B line never bled into by the rapid taps');
  assert.strictEqual(Store.getCartCount(), 5, '4 + 1');
  assert.strictEqual(Store.getCartSubtotal(), 35000 * 4 + 35000 * 1);
  assert.strictEqual(notifications, 3, 'exactly one cheap notification per tap — nothing else fired');

  const reloaded = freshStore(storage);
  assert.strictEqual(reloaded.findCartItem('272', 'branch_a').quantity, 4, 'rapid interaction survives reload');
  assert.strictEqual(reloaded.findCartItem('272', 'branch_b').quantity, 1);
});

test('BUGFIX perf minus to zero via rapid taps removes only its own branch line', () => {
  const Store = freshStore();
  Store.addItem(product('288'), 1, { branch_id: 'branch_a' });
  Store.addItem(product('288'), 3, { branch_id: 'branch_b' });

  Store.setQty('288', 0, 'branch_a');

  assert.strictEqual(Store.getCartItemsForBranch('branch_a').length, 0);
  assert.strictEqual(Store.findCartItem('288', 'branch_b').quantity, 3, 'other branch untouched');
  assert.strictEqual(Store.getCartBranchGroups().length, 1);
});

test('PERF empty-cart clear still emits a cart event and empty state is coherent', () => {
  const Store = freshStore();
  Store.addItem(product('272'), 1);
  Store.addItem(product('345'), 2);

  let cartEvents = 0;
  Store.subscribe((m) => { if (m && m.type === 'cart') cartEvents += 1; });

  Store.removeCartItem('272', null);
  Store.removeCartItem('345', null);

  assert.strictEqual(Store.getCartItemsForBranch(null).length, 0);
  assert.strictEqual(Store.getCartCount(), 0);
  assert.strictEqual(cartEvents, 2, 'each removal is one cart event, even when the cart empties');
});