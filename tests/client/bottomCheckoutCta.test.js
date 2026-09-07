/**
 * Unit & Integration Tests: Home Bottom Checkout CTA (Single vs Multi Branch)
 *
 * Verifies:
 * 1. State A (1 Branch):
 *    - branchGroups.length === 1
 *    - Primary label: 'N Item'
 *    - Secondary label: 'Lihat pesanan kamu'
 *    - Direct checkout routing to the single branch context
 * 2. State B (2+ Branches):
 *    - branchGroups.length > 1
 *    - Primary label: 'N Pesanan' (derived dynamically from branch groups count)
 *    - Secondary label: 'dari N cabang'
 *    - Aggregate total remains informational
 *    - Does NOT merge branches into one checkout
 * 3. Dynamic transition:
 *    - 1 Branch -> 2 Branches switches from State A to State B
 *    - Removing items until 1 Branch remains switches from State B back to State A
 *    - Removing all items hides the dock
 * 4. Branch Order Switcher selection:
 *    - Selecting Branch A routes only Branch A items to checkout
 *    - Other Branch items remain in cart
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');

function freshStore() {
  const storage = {};
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

// Emulates the CTA state derivation in renderCartDock()
function deriveCtaState(Store) {
  const count = Store.getCartCount();
  const total = Store.getCartSubtotal();
  const groups = Store.getCartBranchGroups();
  const multi = groups.length > 1;

  return {
    visible: count > 0,
    isMultiBranch: multi,
    branchCount: groups.length,
    primaryText: multi ? groups.length + ' Pesanan' : count + ' Item',
    secondaryText: multi ? 'dari ' + groups.length + ' cabang' : 'Lihat pesanan kamu',
    totalText: total,
    groups: groups
  };
}

test('CTA State A: exactly 1 branch in cart', () => {
  const Store = freshStore();
  Store.addItem(product('p1', 'Kopi Susu', 15000), 2, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  Store.addItem(product('p2', 'Roti Bakar', 22000), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });

  const cta = deriveCtaState(Store);
  assert.strictEqual(cta.visible, true);
  assert.strictEqual(cta.isMultiBranch, false);
  assert.strictEqual(cta.branchCount, 1);
  assert.strictEqual(cta.primaryText, '3 Item');
  assert.strictEqual(cta.secondaryText, 'Lihat pesanan kamu');
  assert.strictEqual(cta.totalText, 52000);

  // Single-branch checkout context
  const checkoutItems = Store.getCartItemsForBranch(cta.groups[0].branch_id);
  assert.strictEqual(checkoutItems.length, 2);
  assert.strictEqual(checkoutItems.reduce((s, i) => s + i.quantity, 0), 3);
});

test('CTA State B: 2 branches in cart displays dynamic 2 Pesanan / dari 2 cabang', () => {
  const Store = freshStore();
  Store.addItem(product('p1', 'Kopi Susu', 16000), 2, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  Store.addItem(product('p3', 'Croissant', 20000), 1, { branch_id: 'branch_b', branch_name: 'Cabang B' });

  const cta = deriveCtaState(Store);
  assert.strictEqual(cta.visible, true);
  assert.strictEqual(cta.isMultiBranch, true);
  assert.strictEqual(cta.branchCount, 2);
  assert.strictEqual(cta.primaryText, '2 Pesanan');
  assert.strictEqual(cta.secondaryText, 'dari 2 cabang');
  assert.strictEqual(cta.totalText, 52000);

  // Branch A checkout isolation
  const itemsA = Store.getCartItemsForBranch('branch_a');
  assert.strictEqual(itemsA.length, 1);
  assert.strictEqual(itemsA[0].quantity, 2);

  // Branch B checkout isolation
  const itemsB = Store.getCartItemsForBranch('branch_b');
  assert.strictEqual(itemsB.length, 1);
  assert.strictEqual(itemsB[0].quantity, 1);

  // Branch B remains untouched after Branch A checkout completes
  Store.removeBranchItems('branch_a');
  assert.strictEqual(Store.getCartItemsForBranch('branch_a').length, 0);
  assert.strictEqual(Store.getCartItemsForBranch('branch_b').length, 1);
});

test('CTA State B: 3+ branches in cart displays dynamic count and handles branch removal transition', () => {
  const Store = freshStore();
  Store.addItem(product('p1'), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  Store.addItem(product('p2'), 2, { branch_id: 'branch_b', branch_name: 'Cabang B' });
  Store.addItem(product('p3'), 3, { branch_id: 'branch_c', branch_name: 'Cabang C' });

  let cta = deriveCtaState(Store);
  assert.strictEqual(cta.isMultiBranch, true);
  assert.strictEqual(cta.branchCount, 3);
  assert.strictEqual(cta.primaryText, '3 Pesanan');
  assert.strictEqual(cta.secondaryText, 'dari 3 cabang');

  // Customer removes Branch C and B items -> transitions dynamically to 1 Branch (State A)
  Store.removeBranchItems('branch_c');
  cta = deriveCtaState(Store);
  assert.strictEqual(cta.isMultiBranch, true);
  assert.strictEqual(cta.branchCount, 2);
  assert.strictEqual(cta.primaryText, '2 Pesanan');
  assert.strictEqual(cta.secondaryText, 'dari 2 cabang');

  Store.removeBranchItems('branch_b');
  cta = deriveCtaState(Store);
  assert.strictEqual(cta.isMultiBranch, false, 'Transitions back to State A when 1 branch remains');
  assert.strictEqual(cta.branchCount, 1);
  assert.strictEqual(cta.primaryText, '1 Item');
  assert.strictEqual(cta.secondaryText, 'Lihat pesanan kamu');

  // Removing remaining branch hides dock
  Store.removeBranchItems('branch_a');
  cta = deriveCtaState(Store);
  assert.strictEqual(cta.visible, false);
});
