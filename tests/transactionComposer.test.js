const { describe, it } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/js/TransactionComposer.js'), 'utf8');

function makeComposer() {
  const context = { window: {}, Object, Array, JSON, Date, Math, String, Number, Boolean };
  vm.runInNewContext(source, context);
  return new context.window.XentraPos.TransactionComposer({ orderType: 'dine_in' });
}

describe('TransactionComposer', () => {
  it('starts in NEW mode with no action-specific state', () => {
    const c = makeComposer();
    assert.strictEqual(c.getMode(), 'new');
    assert.deepStrictEqual(c.getDisplayItems(), []);
    assert.strictEqual(c.getOrderId(), null);
    assert.strictEqual(c.getHeldBillId(), null);
    assert.strictEqual(c.canAdd(), false);
  });

  it('keeps NEW mode valid for menu-first and table-first flows', () => {
    const c = makeComposer();
    c.setTable({ id: 'table-1', table_number: '12' });
    assert.strictEqual(c.getMode(), 'new');
    assert.strictEqual(c.getOrderType(), 'dine_in');
    c.addItem({ product_id: 'p1', name: 'Nasi', unit_price: 20000, quantity: 1 });
    assert.strictEqual(c.getMode(), 'new');
    assert.strictEqual(c.total(), 20000);
  });

  it('opens EXISTING only when canonical order is locked and has items', () => {
    const c = makeComposer();
    c.openExisting({
      orderId: 'o1',
      heldBillId: 'h1',
      orderType: 'dine_in',
      table: { id: 'table-1', table_number: '12' },
      order: { id: 'o1', status: 'pending' },
      items: [{ product_id: 'p1', name: 'Nasi', unit_price: 20000, quantity: 1 }]
    });
    assert.strictEqual(c.getMode(), 'new');
    c.refreshExisting({
      orderId: 'o1',
      order: { id: 'o1', status: 'confirmed' },
      items: [{ product_id: 'p1', name: 'Nasi', unit_price: 20000, quantity: 1 }]
    });
    assert.strictEqual(c.getMode(), 'existing');
    assert.strictEqual(c.canAdd(), true);
  });

  it('prevents mutation of an EXISTING order and exposes ADDITION explicitly', () => {
    const c = makeComposer();
    c.openExisting({
      orderId: 'o1',
      orderType: 'dine_in',
      table: { table_number: '12' },
      order: { id: 'o1', status: 'preparing' },
      items: [{ product_id: 'p1', name: 'Nasi', unit_price: 20000, quantity: 1 }]
    });
    assert.strictEqual(c.getMode(), 'existing');
    assert.throws(() => c.addItem({ product_id: 'p2', name: 'Kopi', unit_price: 10000, quantity: 1 }), /Gunakan Tambah Pesanan/);
    c.beginAddition();
    assert.strictEqual(c.getMode(), 'addition');
    c.addItem({ product_id: 'p2', name: 'Kopi', unit_price: 10000, quantity: 1 });
    assert.strictEqual(c.total(), 10000);
    assert.strictEqual(c.getDisplayItems()[0].product_id, 'p2');
    c.cancelAddition();
    assert.strictEqual(c.getMode(), 'existing');
    assert.strictEqual(c.getDisplayItems()[0].product_id, 'p1');
  });

  it('does not expose ADDITION for an empty/new composer', () => {
    const c = makeComposer();
    assert.strictEqual(c.canAdd(), false);
    assert.throws(() => c.beginAddition(), /hanya dapat dibuat/);
  });

  it('locks transaction type and table changes while EXISTING/ADDITION is open', () => {
    const c = makeComposer();
    c.openExisting({
      orderId: 'o1',
      orderType: 'dine_in',
      table: { table_number: '12' },
      order: { id: 'o1', status: 'ready' },
      items: [{ product_id: 'p1', name: 'Nasi', unit_price: 20000, quantity: 1 }]
    });
    assert.throws(() => c.setOrderType('pickup'), /tidak dapat diubah/);
    assert.throws(() => c.setTable({ table_number: '13' }), /tidak dapat diubah/);
    c.beginAddition();
    assert.throws(() => c.setOrderType('pickup'), /tidak dapat diubah/);
  });
});
