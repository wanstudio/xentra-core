/**
 * P3 PRODUCT/CATALOG — client cart-store boundaries
 *
 * Product Detail + Add-to-Cart must preserve branch provenance and never let
 * the client invent domain authority. Multi-branch cart is allowed; the product
 * page is only ever a presentation + provenance carrier. These tests exercise
 * the real browser store (store.js IIFE) in the same harness as cartScope.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');

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

test('P3-03 product page add-to-cart preserves branch provenance', () => {
  const Store = freshStore();
  Store.addItem(product('272', 'Paket Semar', 35000), 1, { branch_id: 41, branch_name: 'Cabang Senayan' });

  const line = Store.getCartItemsForBranch('41')[0];
  assert.ok(line, 'one line in the branch scope');
  assert.strictEqual(String(line.id), '272', 'product identity preserved');
  assert.strictEqual(line.branch_id, '41', 'provenance branch id preserved (normalized to string)');
  assert.strictEqual(line.branch_name, 'Cabang Senayan', 'provenance branch name preserved');
  assert.strictEqual(Store.getCartBranchGroups().length, 1);
});

test('P3-04 adding a Branch-B product never destroys the Branch-A scope', () => {
  const Store = freshStore();
  Store.addItem(product('272'), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  Store.addItem(product('345'), 2, { branch_id: 'branch_b', branch_name: 'Cabang B' });

  const groups = Store.getCartBranchGroups();
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(Store.getCartItemsForBranch('branch_a').length, 1, 'Branch A untouched');
  assert.strictEqual(Store.getCartItemsForBranch('branch_b').length, 1, 'Branch B present');
  assert.strictEqual(Store.getCartItemsForBranch('branch_b')[0].quantity, 2);
  assert.strictEqual(Store.getCartCount(), 3);
});

test('P3-05 adding another Branch-A product stays in the SAME Branch-A scope (one line, no cross-scope merge)', () => {
  const Store = freshStore();
  Store.addItem(product('288', 'Es Kopi', 15000), 1, { branch_id: 'branch_a' });
  Store.addItem(product('286', 'Ayam Bakar', 28000), 1, { branch_id: 'branch_a' });
  Store.addItem(product('288', 'Es Kopi', 15000), 1, { branch_id: 'branch_a' });

  const items = Store.getCartItemsForBranch('branch_a');
  assert.strictEqual(items.length, 2, 'two distinct lines within the same branch scope');
  assert.strictEqual(items.find((i) => i.id === '288').quantity, 2, 'same-product add merged inside Branch-A scope');
  assert.strictEqual(Store.getCartBranchGroups().length, 1, 'still exactly one scope');
});

test('P3-06 no branch context: add does not invent any authority (unassigned line, matchedBranch untouched)', () => {
  const Store = freshStore();

  Store.addItem(product('272', 'Paket Semar', 35000), 1);

  const line = Store.getState().cart.items[0];
  assert.ok(line);
  assert.strictEqual(line.branch_id, null, 'no branch provenance is invented (null = legacy unassigned)');
  assert.strictEqual(line.branch_name, null);

  // Legacy unassigned scope, same as pre-P2 single-branch behavior.
  const unassigned = Store.getCartItemsForBranch(null);
  assert.strictEqual(unassigned.length, 1);

  // Discovery/AUTO resolution stays untouched by a product-page add.
  assert.strictEqual(Store.getState().matchedBranch, null, 'add-from-product never writes matchedBranch');
  assert.strictEqual(Store.getState().branchContext, null, 'add-from-product never writes branchContext');
});

test('P3-07 product-page add never creates an order or a fulfillment_branch_id', () => {
  const Store = freshStore();

  Store.setBranchContext({ branch_id: 41, branch_name: 'Cabang Senayan' });
  Store.addItem(product('272'), 2, { branch_id: 41, branch_name: 'Cabang Senayan' });

  const state = Store.getState();
  assert.strictEqual(state.fulfillment_branch_id, undefined, 'no fulfillment_branch_id is created from the product page');
  assert.strictEqual(state.order_id, undefined, 'no order is created from the product page');
  assert.ok(!Array.isArray(state.orders), 'no order collection exists client-side');
  assert.strictEqual(state.matchedBranch, null, 'AUTO resolution is not triggered by cart adds');

  // Cart delta is the ONLY mutation from an add.
  const keys = Object.keys(state).sort();
  assert.deepStrictEqual(keys, ['branchContext', 'brand', 'cart', 'customerSession', 'location', 'matchedBranch', 'notes', 'orderContext', 'orderType', 'promo']);
});

test('P3-08 client price/stock are display-only and can never become server authority', () => {
  const Store = freshStore();

  // Even an explicitly unavailable product can be presented; the client store
  // simply records display data. Availability enforcement lives server-side at
  // PrePaymentVerificationGate/Eligibility — the store exposes no API surface
  // that writes stock, availability, or acceptance.
  const uiProduct = product('272', 'Paket Semar', 35000);
  uiProduct.is_available = false;
  Store.addItem(uiProduct, 1, { branch_id: 41, branch_name: 'Cabang Senayan' });

  const line = Store.getCartItemsForBranch('41')[0];
  assert.strictEqual(line.price, 35000, 'price recorded as display copy only');
  assert.strictEqual(line.is_available, undefined, 'availability is not persisted into the cart');

  // The store public surface never mutates inventory/availability/acceptance.
  const publicMethods = Object.keys(window.Xentra.Store).sort();
  const forbidden = publicMethods.filter((m) => /stock|availab|accept|inventory|fulfillment/i.test(m));
  assert.deepStrictEqual(forbidden, [], 'no stock/availability/acceptance/fulfillment mutators are exposed');

  // Cart ops never touch server-resolved state.
  const state = Store.getState();
  assert.strictEqual(state.matchedBranch, null);
  assert.strictEqual(state.branchContext, null);
});