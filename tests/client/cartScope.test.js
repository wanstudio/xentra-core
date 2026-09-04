/**
 * R1 CART/CHECKOUT BOUNDARY — client cart store contract
 *
 * Locked rule: MULTI-BRANCH CART IS ALLOWED; CHECKOUT IS SINGLE-BRANCH;
 * ORDER IS SINGLE-BRANCH. These tests exercise `apps/customer-pwa/.../store.js`
 * (a browser IIFE) inside a minimal Node harness (localStorage + window
 * shims) to prove the cart can represent items from different branches, group
 * them per branch, keep line identity scoped by branch, and remove ONE branch
 * scope without touching the others (R1.5 independent checkout).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');

function freshStore(seedStorage) {
  // Minimal browser shims required by store.js (it only touches window +
  // localStorage; it never touches document/DOM). Passing a seedStorage object
  // simulates a persisted localStorage surfacing across a page reload.
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

test('R1 legacy cart: items without branch provenance form ONE unassigned scope (single-branch behavior unchanged)', () => {
  const Store = freshStore();

  Store.addItem(product('272', 'Paket Semar', 35000), 1);
  Store.addItem(product('345', 'Mie Gurih', 15000), 2);
  // Legacy merge by product id still works without branch context.
  Store.addItem(product('272', 'Paket Semar', 35000), 1);

  const groups = Store.getCartBranchGroups();
  assert.strictEqual(groups.length, 1, 'exactly one cart scope for a legacy cart');
  assert.strictEqual(groups[0].branch_id, null, 'legacy group is unassigned');
  assert.strictEqual(groups[0].items.length, 2, 'two distinct lines');
  assert.strictEqual(groups[0].items[0].quantity, 2, 'same-product add merged in the unassigned scope');
  assert.strictEqual(Store.getCartCount(), 4);
  assert.strictEqual(Store.getCartSubtotal(), 35000 * 2 + 15000 * 2);
  assert.strictEqual(Store.getCartItemsForBranch(null).length, 2, 'null branch = legacy unassigned scope');
  assert.strictEqual(Store.getCartItemsForBranch('branch_x').length, 0);
});

test('R1 multi-branch cart: items from different branches are representable and grouped per branch', () => {
  const Store = freshStore();

  Store.addItem(product('272'), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });
  Store.addItem(product('345'), 2, { branch_id: 'branch_b', branch_name: 'Cabang B' });
  Store.addItem(product('286'), 1, { branch_id: 'branch_a', branch_name: 'Cabang A' });

  const groups = Store.getCartBranchGroups();
  assert.strictEqual(groups.length, 2, 'two branch scopes');
  const gA = groups.find((g) => String(g.branch_id) === 'branch_a');
  const gB = groups.find((g) => String(g.branch_id) === 'branch_b');
  assert.ok(gA && gB, 'both scopes present');
  assert.strictEqual(gA.branch_name, 'Cabang A');
  assert.strictEqual(gA.items.length, 2, 'branch A carries two lines');
  assert.strictEqual(gB.items.length, 1, 'branch B carries one line');
  assert.strictEqual(gB.items[0].quantity, 2);
  assert.strictEqual(Store.getCartItemsForBranch('branch_a').length, 2);
  assert.strictEqual(Store.getCartItemsForBranch('branch_b').length, 1);
  assert.strictEqual(Store.getCartCount(), 4, 'quantities are summed across the whole cart');
});

test('R1 line identity is branch-scoped: the same catalog product in two branches stays two separate lines', () => {
  const Store = freshStore();

  Store.addItem(product('288', 'Es Kopi', 15000), 1, { branch_id: 'branch_a' });
  Store.addItem(product('288', 'Es Kopi', 15000), 1, { branch_id: 'branch_b' });

  const all = Store.getState().cart.items;
  assert.strictEqual(all.length, 2, 'same product id across two branches must NOT merge into one line');
  assert.strictEqual(all[0].branch_id, 'branch_a');
  assert.strictEqual(all[1].branch_id, 'branch_b');

  // Re-adding under branch A merges only the A line (scope-aware merge).
  Store.addItem(product('288', 'Es Kopi', 15000), 1, { branch_id: 'branch_a' });
  const after = Store.getState().cart.items;
  assert.strictEqual(after.length, 2, 'still two lines');
  assert.strictEqual(after.find((i) => i.branch_id === 'branch_a').quantity, 2);
  assert.strictEqual(after.find((i) => i.branch_id === 'branch_b').quantity, 1);
  assert.strictEqual(Store.getCartBranchGroups().length, 2);
});

test('R1 group order is deterministic (first-seen cart order), not key/DB order', () => {
  const Store = freshStore();

  Store.addItem(product('272'), 1, { branch_id: 'branch_b' });
  Store.addItem(product('345'), 1, { branch_id: 'branch_a' });
  Store.addItem(product('286'), 1, { branch_id: 'branch_b' });

  const groups = Store.getCartBranchGroups();
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(String(groups[0].branch_id), 'branch_b', 'first-seen scope leads');
  assert.strictEqual(String(groups[1].branch_id), 'branch_a');
});

test('R1.5 independent checkout: removing one branch scope leaves every other scope intact', () => {
  const Store = freshStore();

  Store.addItem(product('272', 'Paket Semar', 35000), 1, { branch_id: 'branch_a' });
  Store.addItem(product('345', 'Mie Gurih', 15000), 2, { branch_id: 'branch_b' });
  Store.addItem(product('401', 'Es Teh', 5000), 3, { branch_id: 'branch_c' });

  // Branch A checkout completes and is removed from the cart.
  Store.removeBranchItems('branch_a');

  const groups = Store.getCartBranchGroups();
  assert.strictEqual(groups.length, 2, 'branch B and C remain');
  assert.strictEqual(Store.getCartItemsForBranch('branch_a').length, 0);
  assert.strictEqual(Store.getCartItemsForBranch('branch_b').length, 1);
  assert.strictEqual(Store.getCartItemsForBranch('branch_b')[0].quantity, 2);
  assert.strictEqual(Store.getCartItemsForBranch('branch_c').length, 1);
  assert.strictEqual(Store.getCartSubtotal(), 15000 * 2 + 5000 * 3, 'remaining scopes keep their lines and totals');
});

test('R1 mixed legacy + provenanced cart: null scope and branch scope are separate and removable independently', () => {
  const Store = freshStore();

  Store.addItem(product('272'), 1); // legacy, unassigned
  Store.addItem(product('345'), 1, { branch_id: 'branch_a' });

  const groups = Store.getCartBranchGroups();
  assert.strictEqual(groups.length, 2, 'legacy and branch scopes coexist');
  assert.strictEqual(groups[0].branch_id, null);
  assert.strictEqual(String(groups[1].branch_id), 'branch_a');

  // Removing the unassigned (legacy) scope must not touch the provenanced one.
  Store.removeBranchItems(null);
  const after = Store.getCartBranchGroups();
  assert.strictEqual(after.length, 1);
  assert.strictEqual(String(after[0].branch_id), 'branch_a');
});

test('R1 legacy ops (setQty/removeItem/clearCart) still behave correctly on provenanced lines', () => {
  const Store = freshStore();

  Store.addItem(product('272'), 2, { branch_id: 'branch_a' });
  Store.addItem(product('345'), 1, { branch_id: 'branch_b' });

  Store.setQty('272', 0); // remove the branch_a line by id (legacy op)
  assert.strictEqual(Store.getCartBranchGroups().length, 1);
  assert.strictEqual(Store.getCartItemsForBranch('branch_b').length, 1);

  Store.addItem(product('272'), 1, { branch_id: 'branch_a' });
  assert.strictEqual(Store.getCartBranchGroups().length, 2);

  Store.clearCart();
  assert.deepStrictEqual(Store.getState().cart, { items: [] }, 'clearCart still wipes every scope');
  assert.strictEqual(Store.getCartBranchGroups().length, 0);
});

test('R1 scope helpers are read-only: invoking them never mutates the cart', () => {
  const Store = freshStore();

  Store.addItem(product('272'), 1, { branch_id: 'branch_a' });
  Store.addItem(product('345'), 1, { branch_id: 'branch_b' });

  const before = JSON.stringify(Store.getState().cart.items);
  Store.getCartBranchGroups();
  Store.getCartItemsForBranch('branch_a');
  Store.getCartItemsForBranch(null);
  const after = JSON.stringify(Store.getState().cart.items);
  assert.strictEqual(after, before, 'group/scope reads are side-effect free');
  assert.strictEqual(Store.getState().cart.items.length, 2);
});

test('P2 branchContext persists and stays separate from matchedBranch (discovery vs AUTO authority)', () => {
  // One shared backing store: a second freshStore(sharedStorage) behaves like a
  // real page reload over the same persisted localStorage.
  const sharedStorage = {};
  const Store = freshStore(sharedStorage);

  // P2 core invariant: Home discovery/selection writes branchContext; the
  // transaction-level AUTO match writes matchedBranch. They must never be
  // conflated because one is a customer-selection prefill signal and the
  // other is Core's authoritative resolution.
  assert.strictEqual(Store.getState().branchContext, null, 'no branch context by default');
  assert.strictEqual(Store.getState().matchedBranch, null, 'no matched branch by default');

  // Home picks a nearby branch (customer-selected).
  Store.setBranchContext({ branch_id: 41, branch_name: 'Cabang Senayan' });
  assert.strictEqual(Store.getState().branchContext.branch_id, 41);
  assert.strictEqual(Store.getState().branchContext.branch_name, 'Cabang Senayan');
  // Setting discovery context must NOT leak into the transaction match result.
  assert.strictEqual(Store.getState().matchedBranch, null, 'branchContext must not set matchedBranch');

  // Checkout later resolves the authoritative match for delivery.
  Store.setMatchedBranch({ id: 99, name: 'Auto Cabang' });
  assert.strictEqual(Store.getState().matchedBranch.id, 99);
  // And the resolution must NOT overwrite the customer's discovery context.
  assert.strictEqual(Store.getState().branchContext.branch_id, 41, 'matchedBranch must not clobber branchContext');

  // Branch context survives a reload (persisted under a dedicated key).
  const reloaded = freshStore(sharedStorage);
  assert.strictEqual(reloaded.getState().branchContext.branch_id, 41, 'branchContext persists across reload');
  assert.strictEqual(reloaded.getState().matchedBranch.id, 99, 'matchedBranch is separately persisted');
});

test('P2 branchContext add-to-cart provenance flows into the cart scope', () => {
  const Store = freshStore();

  // Home active branch → provenance on the added line.
  Store.addItem(product('272', 'Paket Semar'), 1, { branch_id: 41, branch_name: 'Cabang Senayan' });

  const groups = Store.getCartBranchGroups();
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(String(groups[0].branch_id), '41');
  assert.strictEqual(groups[0].branch_name, 'Cabang Senayan');
  assert.strictEqual(Store.getCartItemsForBranch('41').length, 1);
});
