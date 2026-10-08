'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const { InventoryAdjustmentService } = require('../../domains/inventory');
const InventoryRepository = require('../../core/data/repositories/InventoryRepository');

const ORG = 'org_inventory_adjust_v1';
const BRAND = 'brand_inventory_adjust_v1';
const BRANCH = 'branch_inventory_adjust_v1';
const LOCATION = 'loc_inventory_adjust_v1';
const PRODUCT = 'prod_inventory_adjust_v1';

test.before(async () => {
  await db.readyPromise;

  db.prepare(
    'INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)'
  ).run(ORG, 'Inventory Adjustment Test Org', 'inventory-adjustment-test-org');

  db.prepare(
    'INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)'
  ).run(BRAND, ORG, 'Inventory Adjustment Test Brand', 'inventory-adjustment-test-brand');

  db.prepare(
    'INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, ?, ?, ?, 0, 0, 1)'
  ).run(BRANCH, BRAND, 'Inventory Adjustment Test Branch', 'inventory-adjustment-test-branch', 'Test');

  db.prepare(
    "INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, 'BRANCH', 1)"
  ).run(LOCATION, ORG, BRANCH, 'INV-ADJ', 'Inventory Adjustment Stock');

  db.prepare(
    'INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, is_active, sku, product_stock_uom_id) VALUES (?, ?, ?, ?, 0, 1, ?, ?)'
  ).run(PRODUCT, BRAND, 'Inventory Adjustment Product', 'inventory-adjustment-product', 'INV-ADJ-001', 'uom_pcs');

  db.prepare(
    "INSERT OR REPLACE INTO product_stock_balances (stock_location_id, product_id, quantity, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version) VALUES (?, ?, 10, 100000, 10000, 'AVAILABLE', 1)"
  ).run(LOCATION, PRODUCT);

  db.prepare(
    "INSERT OR REPLACE INTO product_stock_movements (id, stock_location_id, product_id, movement_type, quantity, previous_quantity, current_quantity, unit_cost, total_cost, currency_code, valuation_method, cost_basis_type, source_type, source_reference, posting_mutation_id, valuation_version, posting_timestamp, resolver_version) VALUES (?, ?, ?, 'OPENING_STOCK', 10, 0, 10, 10000, 100000, 'IDR', 'MOVING_AVERAGE', 'OPENING_ACTUAL', 'TEST', 'INV-ADJ-SEED', ?, 1, '2026-10-08T08:00:00.000Z', 'v1')"
  ).run('mov_inventory_adjust_seed', LOCATION, PRODUCT, 'inventory-adjust-seed-mut');
});

test.after(() => {
  db.prepare('DELETE FROM product_stock_movements WHERE stock_location_id = ?').run(LOCATION);
  db.prepare('DELETE FROM product_stock_balances WHERE stock_location_id = ?').run(LOCATION);
  db.prepare('DELETE FROM stock_locations WHERE id = ?').run(LOCATION);
  db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT);
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});


test('branch inventory view prefers canonical Product Stock over migration quantities', () => {
  const inventoryRepository = new InventoryRepository();
  db.prepare(
    'INSERT OR REPLACE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, 3, 1)'
  ).run(BRANCH, PRODUCT);

  const rows = inventoryRepository.findBranchProductInventoryView({
    branchId: BRANCH,
    brandId: BRAND
  });
  const row = rows.find(item => String(item.product_id) === PRODUCT);

  assert.ok(row);
  assert.equal(Number(row.stock), 10);
  assert.equal(row.stock_source, 'canonical');
  assert.equal(Number(row.branch_inventory_quantity), 3);
});

test('positive audit adjustment requires explicit incoming cost evidence', () => {
  assert.throws(
    () => InventoryAdjustmentService.postProductAdjustment({
      branchId: BRANCH,
      productId: PRODUCT,
      movementType: 'audit_adjustment',
      quantity: 2,
      mutationId: 'inventory-adjust-missing-cost',
      currencyCode: 'IDR',
      actorId: 'manager-1',
      postingTimestamp: '2026-10-08T09:00:00.000Z'
    }),
    error => error && error.code === 'INBOUND_COST_UNRESOLVED'
  );

  const balance = db.prepare(
    'SELECT quantity, carrying_value, valuation_version FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?'
  ).get(LOCATION, PRODUCT);
  assert.equal(Number(balance.quantity), 10);
  assert.equal(Number(balance.carrying_value), 100000);
  assert.equal(Number(balance.valuation_version), 1);
});

test('negative waste adjustment uses current Product Moving Average', () => {
  const result = InventoryAdjustmentService.postProductAdjustment({
    branchId: BRANCH,
    productId: PRODUCT,
    movementType: 'waste_spoilage',
    quantity: -2,
    mutationId: 'inventory-adjust-waste-001',
    actorId: 'manager-1',
    notes: 'Barang rusak',
    postingTimestamp: '2026-10-08T09:30:00.000Z'
  });

  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.movement_type, 'WASTE');
  assert.equal(Number(result.quantity), -2);
  assert.equal(Number(result.unit_cost), 10000);
  assert.equal(Number(result.total_cost), -20000);

  const balance = db.prepare(
    'SELECT quantity, carrying_value, moving_average_unit_cost, valuation_version FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?'
  ).get(LOCATION, PRODUCT);
  assert.equal(Number(balance.quantity), 8);
  assert.equal(Number(balance.carrying_value), 80000);
  assert.equal(Number(balance.moving_average_unit_cost), 10000);
  assert.equal(Number(balance.valuation_version), 2);
});

test('positive audit adjustment updates moving average and is idempotent', () => {
  const result = InventoryAdjustmentService.postProductAdjustment({
    branchId: BRANCH,
    productId: PRODUCT,
    movementType: 'audit_adjustment',
    quantity: 2,
    mutationId: 'inventory-adjust-audit-001',
    unitCost: 12000,
    currencyCode: 'IDR',
    actorId: 'manager-1',
    postingTimestamp: '2026-10-08T10:00:00.000Z'
  });

  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.movement_type, 'ADJUSTMENT_IN');
  assert.equal(Number(result.quantity), 2);
  assert.equal(Number(result.total_cost), 24000);

  const replay = InventoryAdjustmentService.postProductAdjustment({
    branchId: BRANCH,
    productId: PRODUCT,
    movementType: 'audit_adjustment',
    quantity: 999,
    mutationId: 'inventory-adjust-audit-001',
    unitCost: 999999,
    currencyCode: 'IDR',
    actorId: 'manager-1',
    postingTimestamp: '2026-10-08T11:00:00.000Z'
  });

  assert.equal(replay.idempotent, true);
  assert.equal(Number(replay.quantity), 2);
  assert.equal(Number(replay.total_cost), 24000);

  const balance = db.prepare(
    'SELECT quantity, carrying_value, moving_average_unit_cost, valuation_version FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?'
  ).get(LOCATION, PRODUCT);
  assert.equal(Number(balance.quantity), 10);
  assert.equal(Number(balance.carrying_value), 104000);
  assert.equal(Number(balance.moving_average_unit_cost), 10400);
  assert.equal(Number(balance.valuation_version), 3);

  const movements = db.prepare(
    "SELECT COUNT(*) AS count FROM product_stock_movements WHERE source_reference = 'inventory-adjust-audit-001'"
  ).get();
  assert.equal(Number(movements.count), 1);
});

test('negative adjustment cannot make canonical Product Stock negative', () => {
  assert.throws(
    () => InventoryAdjustmentService.postProductAdjustment({
      branchId: BRANCH,
      productId: PRODUCT,
      movementType: 'waste_spoilage',
      quantity: -999,
      mutationId: 'inventory-adjust-waste-fail',
      actorId: 'manager-1',
      postingTimestamp: '2026-10-08T12:00:00.000Z'
    }),
    error => error && error.code === 'INSUFFICIENT_STOCK'
  );

  const balance = db.prepare(
    'SELECT quantity, carrying_value, valuation_version FROM product_stock_balances WHERE stock_location_id = ? AND product_id = ?'
  ).get(LOCATION, PRODUCT);
  assert.equal(Number(balance.quantity), 10);
  assert.equal(Number(balance.carrying_value), 104000);
  assert.equal(Number(balance.valuation_version), 3);
});
