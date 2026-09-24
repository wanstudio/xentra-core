'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ProductOptionsModel = require('../domains/catalog/models/ProductOptionsModel');
const db = require('../server/database/db');

const CONFIG = { version: 1, groups: [
  { id: 'size', name: 'Ukuran', type: 'variant', required: true, options: [
    { id: 'regular', name: 'Regular', price_adjustment: 0 },
    { id: 'large', name: 'Large', price_adjustment: 5000 }
  ] },
  { id: 'addon', name: 'Tambahan', type: 'addon', min: 0, max: 2, options: [
    { id: 'egg', name: 'Telur', price_adjustment: 5000 },
    { id: 'cheese', name: 'Keju', price_adjustment: 4000 }
  ] }
] };

test('options empty config', () => {
  const result = ProductOptionsModel.resolveSelections(null, []);
  assert.deepEqual(result.snapshot, []);
  assert.equal(result.adjustment, 0);
});

test('variant plus addons resolve price adjustment', () => {
  const result = ProductOptionsModel.resolveSelections(CONFIG, [
    { group_id: 'size', option_id: 'large' },
    { group_id: 'addon', option_id: 'egg' },
    { group_id: 'addon', option_id: 'cheese' }
  ]);
  assert.equal(result.adjustment, 14000);
  assert.deepEqual(result.snapshot.map(x => x.option_id), ['large', 'egg', 'cheese']);
});

test('required variant is enforced', () => {
  assert.throws(() => ProductOptionsModel.resolveSelections(CONFIG, []), /wajib dipilih/);
});

test('unknown option is rejected', () => {
  assert.throws(() => ProductOptionsModel.resolveSelections(CONFIG, [{ group_id: 'size', option_id: 'nope' }]), /tidak valid/);
});

test('variant is single choice', () => {
  assert.throws(() => ProductOptionsModel.resolveSelections(CONFIG, [
    { group_id: 'size', option_id: 'regular' },
    { group_id: 'size', option_id: 'large' }
  ]), /hanya boleh memilih satu/);
});

test('order_items has option snapshot column', () => {
  const columns = db.prepare('PRAGMA table_info(order_items)').all();
  assert.ok(columns.some(c => c.name === 'modifiers_snapshot'));
});

test('products has option config column', () => {
  const columns = db.prepare('PRAGMA table_info(products)').all();
  assert.ok(columns.some(c => c.name === 'options_config'));
});
