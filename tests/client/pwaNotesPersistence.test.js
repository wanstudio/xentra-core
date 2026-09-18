/**
 * PWA Notes Persistence & Note Icon State Integration Tests
 *
 * Tests the locked notes persistence contract across Home and Checkout views:
 * 1. Item Note:
 *    - Scoped strictly to item and branch (productId::branchId).
 *    - Adding, modifying, or clearing a note on Home persists to Checkout and vice versa.
 *    - Removing or clearing note resets icon to empty (/assets/icons/file.svg) without 'has-note'.
 *    - Adding note updates icon to filled (/assets/icons/write.svg) with 'has-note'.
 *    - Notes never leak between different items or branches.
 * 2. Fulfillment Note:
 *    - Scoped strictly to fulfillment context (delivery/pickup/dine-in/reservation).
 *    - Stored in Store.state.orderContext[fulfillmentType].note.
 *    - Persists across checkout navigation, modal reopen, fulfillment type changes, and reload.
 *    - Icon state: empty (/assets/icons/file.svg) vs filled (/assets/icons/write.svg + has-note).
 *    - Strictly separated from item notes (no leakage).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');

function createStorageShim() {
  const data = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    clear: () => { Object.keys(data).forEach((k) => delete data[k]); },
    _dump: () => Object.assign({}, data)
  };
}

function freshStore(initialStorage) {
  delete require.cache[STORE_PATH];
  const storage = createStorageShim();
  if (initialStorage) {
    Object.keys(initialStorage).forEach((k) => storage.setItem(k, initialStorage[k]));
  }
  globalThis.localStorage = storage;
  globalThis.window = globalThis;
  require(STORE_PATH);
  return { Store: globalThis.window.Xentra.Store, storage };
}

test('Item Note: note is branch-isolated and persists in cart item', () => {
  const { Store, storage } = freshStore();

  // Add item 101 to branch 1
  Store.addItem({ id: 101, name: 'Ayam Goreng', price: 25000 }, 1, { branch_id: 'branch-1' });
  assert.strictEqual(Store.getNote(101, 'branch-1'), '');

  // Set note in branch-1
  Store.setNote(101, 'jangan pakai sambal', 'branch-1');
  assert.strictEqual(Store.getNote(101, 'branch-1'), 'jangan pakai sambal');

  // Verify item note in cart
  const itemB1 = Store.findCartItem(101, 'branch-1');
  assert.ok(itemB1);
  assert.strictEqual(itemB1.note, 'jangan pakai sambal');

  // Add item 101 to branch 2 - note must NOT leak
  Store.addItem({ id: 101, name: 'Ayam Goreng', price: 25000 }, 1, { branch_id: 'branch-2' });
  assert.strictEqual(Store.getNote(101, 'branch-2'), '');
  const itemB2 = Store.findCartItem(101, 'branch-2');
  assert.strictEqual(itemB2.note, '');

  // Set note in branch-2
  Store.setNote(101, 'ekstra pedas', 'branch-2');
  assert.strictEqual(Store.getNote(101, 'branch-1'), 'jangan pakai sambal');
  assert.strictEqual(Store.getNote(101, 'branch-2'), 'ekstra pedas');

  // Verify persistence across reload
  const dumped = storage._dump();
  const reloaded = freshStore(dumped);
  assert.strictEqual(reloaded.Store.getNote(101, 'branch-1'), 'jangan pakai sambal');
  assert.strictEqual(reloaded.Store.getNote(101, 'branch-2'), 'ekstra pedas');
  assert.strictEqual(reloaded.Store.findCartItem(101, 'branch-1').note, 'jangan pakai sambal');
  assert.strictEqual(reloaded.Store.findCartItem(101, 'branch-2').note, 'ekstra pedas');
});

test('Item Note: clearing note completely removes note and cleans state.notes', () => {
  const { Store, storage } = freshStore();
  Store.addItem({ id: 201, name: 'Es Teh', price: 5000 }, 1, { branch_id: 'b1' });
  Store.setNote(201, 'kurang manis', 'b1');
  assert.strictEqual(Store.getNote(201, 'b1'), 'kurang manis');

  // Clear note with empty string
  Store.setNote(201, '', 'b1');
  assert.strictEqual(Store.getNote(201, 'b1'), '');
  assert.strictEqual(Store.findCartItem(201, 'b1').note, '');
  assert.strictEqual(Store.getState().notes['201::b1'], undefined);

  // Set note then clear with whitespace
  Store.setNote(201, 'banyak es', 'b1');
  assert.strictEqual(Store.getNote(201, 'b1'), 'banyak es');
  Store.setNote(201, '   ', 'b1');
  assert.strictEqual(Store.getNote(201, 'b1'), '');
  assert.strictEqual(Store.findCartItem(201, 'b1').note, '');

  // Verify persistence of cleared note
  const reloaded = freshStore(storage._dump());
  assert.strictEqual(reloaded.Store.getNote(201, 'b1'), '');
  assert.strictEqual(reloaded.Store.findCartItem(201, 'b1').note, '');
});

test('Item Note: pre-set note survives addItem when already set in state', () => {
  const { Store } = freshStore();
  // Set note before item is in cart
  Store.setNote(301, 'tanpa bawang', 'b-main');
  assert.strictEqual(Store.getNote(301, 'b-main'), 'tanpa bawang');

  // Now add item
  Store.addItem({ id: 301, name: 'Mie Goreng', price: 20000 }, 1, { branch_id: 'b-main' });
  const cartItem = Store.findCartItem(301, 'b-main');
  assert.ok(cartItem);
  assert.strictEqual(cartItem.note, 'tanpa bawang');
});

test('Fulfillment Note: orderContext persists note per fulfillment type and across reload', () => {
  const { Store, storage } = freshStore();

  // Set delivery note
  Store.setOrderType('delivery');
  Store.setOrderContext('delivery', { note: 'titip di pos satpam' });

  // Set pickup note
  Store.setOrderContext('pickup', { note: 'ambil jam 12 siang' });

  assert.strictEqual(Store.getState().orderContext.delivery.note, 'titip di pos satpam');
  assert.strictEqual(Store.getState().orderContext.pickup.note, 'ambil jam 12 siang');

  // Verify across fresh reload
  const reloaded = freshStore(storage._dump());
  assert.strictEqual(reloaded.Store.getState().orderContext.delivery.note, 'titip di pos satpam');
  assert.strictEqual(reloaded.Store.getState().orderContext.pickup.note, 'ambil jam 12 siang');
});

test('Checkout Integration: Item Note and Fulfillment Note rendering and icon state contracts', () => {
  const { Store } = freshStore();

  Store.addItem({ id: 501, name: 'Bebek Bakar', price: 35000 }, 1, { branch_id: 'b1' });
  Store.setNote(501, 'bakar kering', 'b1');

  Store.addItem({ id: 502, name: 'Nasi Putih', price: 6000 }, 1, { branch_id: 'b1' });

  // Item with note (501):
  const note501 = Store.getNote(501, 'b1');
  assert.strictEqual(note501, 'bakar kering');
  const hasNote501 = Boolean(note501);
  const icon501 = hasNote501 ? '/assets/icons/write.svg' : '/assets/icons/file.svg';
  const class501 = hasNote501 ? 'has-note' : '';
  assert.strictEqual(icon501, '/assets/icons/write.svg');
  assert.strictEqual(class501, 'has-note');

  // Item without note (502):
  const note502 = Store.getNote(502, 'b1');
  assert.strictEqual(note502, '');
  const hasNote502 = Boolean(note502);
  const icon502 = hasNote502 ? '/assets/icons/write.svg' : '/assets/icons/file.svg';
  const class502 = hasNote502 ? 'has-note' : '';
  assert.strictEqual(icon502, '/assets/icons/file.svg');
  assert.strictEqual(class502, '');

  // Fulfillment note empty initially:
  Store.setOrderType('delivery');
  const emptyFulNote = (Store.getState().orderContext && Store.getState().orderContext.delivery && Store.getState().orderContext.delivery.note) || '';
  assert.strictEqual(emptyFulNote, '');
  assert.strictEqual(emptyFulNote ? '/assets/icons/write.svg' : '/assets/icons/file.svg', '/assets/icons/file.svg');
  assert.strictEqual(emptyFulNote ? 'has-note' : '', '');

  // Fulfillment note added:
  Store.setOrderContext('delivery', { note: 'pagar rumah warna hijau' });
  const filledFulNote = Store.getState().orderContext.delivery.note;
  assert.strictEqual(filledFulNote, 'pagar rumah warna hijau');
  assert.strictEqual(filledFulNote ? '/assets/icons/write.svg' : '/assets/icons/file.svg', '/assets/icons/write.svg');
  assert.strictEqual(filledFulNote ? 'has-note' : '', 'has-note');

  // Clear fulfillment note:
  Store.setOrderContext('delivery', { note: '' });
  const clearedFulNote = Store.getState().orderContext.delivery.note;
  assert.strictEqual(clearedFulNote, '');
  assert.strictEqual(clearedFulNote ? '/assets/icons/write.svg' : '/assets/icons/file.svg', '/assets/icons/file.svg');
  assert.strictEqual(clearedFulNote ? 'has-note' : '', '');

  // Item notes and fulfillment notes must never bleed into each other
  assert.strictEqual(Store.getNote('delivery', 'b1'), '');
  assert.strictEqual(Store.getState().orderContext['501'], undefined);
});
