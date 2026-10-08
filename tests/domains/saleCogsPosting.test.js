'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const InventoryRepository = require('../../core/data/repositories/InventoryRepository');
const { InventorySalePostingService } = require('../../domains/inventory');
const { CostOfSalesService } = require('../../domains/costing');

const inventory = new InventoryRepository();

const ORG = 'org_sale_cogs_v1';
const BRAND = 'brand_sale_cogs_v1';
const BRANCH = 'branch_sale_cogs_v1';
const LOCATION = 'loc_sale_cogs_v1';
const PRODUCT_A = 'prod_sale_cogs_a';
const PRODUCT_B = 'prod_sale_cogs_b';

test.before(async () => {
  await db.readyPromise;

  db.prepare(
    'INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)'
  ).run(ORG, 'Sale COGS Test Org', 'sale-cogs-test-org');

  db.prepare(
    'INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)'
  ).run(BRAND, ORG, 'Sale COGS Test Brand', 'sale-cogs-test-brand');

  db.prepare(
    'INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(BRANCH, BRAND, 'Sale COGS Test Branch', 'sale-cogs-test-branch', 'Test', 0, 0);

  db.prepare(
    "INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, 'BRANCH', 1)"
  ).run(LOCATION, ORG, BRANCH, 'SALE-COGS', 'Sale COGS Stock');

  db.prepare(
    'INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, is_active, sku, product_stock_uom_id) VALUES (?, ?, ?, ?, 0, 1, ?, ?), (?, ?, ?, ?, 0, 1, ?, ?)'
  ).run(
    PRODUCT_A, BRAND, 'Sale Product A', 'sale-product-a', 'SALE-COGS-A', 'uom_pcs',
    PRODUCT_B, BRAND, 'Sale Product B', 'sale-product-b', 'SALE-COGS-B', 'uom_pcs'
  );

  db.prepare(
    "INSERT OR IGNORE INTO product_stock_balances (stock_location_id, product_id, quantity, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version) VALUES (?, ?, 10, 100000, 10000, 'AVAILABLE', 1), (?, ?, 10, 50000, 5000, 'AVAILABLE', 1)"
  ).run(LOCATION, PRODUCT_A, LOCATION, PRODUCT_B);

  db.prepare(
    "INSERT OR IGNORE INTO product_stock_movements (id, stock_location_id, product_id, movement_type, quantity, previous_quantity, current_quantity, unit_cost, total_cost, currency_code, valuation_method, cost_basis_type, source_type, source_reference, posting_mutation_id, valuation_version, posting_timestamp, resolver_version) VALUES (?, ?, ?, 'OPENING_STOCK', 10, 0, 10, 10000, 100000, 'IDR', 'MOVING_AVERAGE', 'OPENING_ACTUAL', 'TEST', 'SALE-SEED-A', ?, 1, '2026-10-08T08:00:00.000Z', 'v1'), (?, ?, ?, 'OPENING_STOCK', 10, 0, 10, 5000, 50000, 'IDR', 'MOVING_AVERAGE', 'OPENING_ACTUAL', 'TEST', 'SALE-SEED-B', ?, 1, '2026-10-08T08:00:00.000Z', 'v1')"
  ).run(
    'mov_sale_seed_a', LOCATION, PRODUCT_A, 'sale-seed-a-mut',
    'mov_sale_seed_b', LOCATION, PRODUCT_B, 'sale-seed-b-mut'
  );
});

test.after(() => {
  db.prepare('DELETE FROM cost_of_sales_snapshot_lines WHERE cost_of_sales_snapshot_id IN (SELECT id FROM cost_of_sales_snapshots WHERE source_reference LIKE ?)', ['sale-cogs-%']);
  db.prepare('DELETE FROM cost_of_sales_snapshots WHERE source_reference LIKE ?', ['sale-cogs-%']);
  db.prepare('DELETE FROM product_stock_movements WHERE stock_location_id = ?', LOCATION);
  db.prepare('DELETE FROM product_stock_balances WHERE stock_location_id = ?', LOCATION);
  db.prepare('DELETE FROM stock_locations WHERE id = ?', LOCATION);
  db.prepare('DELETE FROM products WHERE id IN (?, ?)', PRODUCT_A, PRODUCT_B);
  db.prepare('DELETE FROM branches WHERE id = ?', BRANCH);
  db.prepare('DELETE FROM brands WHERE id = ?', BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?', ORG);
});

test('canonical Sale resolves Product Moving Average, posts SALE movements, and captures COGS snapshot', () => {
  inventory.beginTransaction();
  try {
    const result = InventorySalePostingService.postCanonicalSale({
      branchId: BRANCH,
      sourceType: 'ORDER',
      sourceReference: 'sale-cogs-001',
      actorId: 'merchant-1',
      postingTimestamp: '2026-10-08T10:00:00.000Z',
      requirements: [
        { product_id: PRODUCT_A, product_name: 'Sale Product A', quantity: 2, source_item_reference: 'item-a' },
        { product_id: PRODUCT_B, product_name: 'Sale Product B', quantity: 3, source_item_reference: 'item-b' }
      ]
    });

    assert.equal(result.status, 'AVAILABLE');
    assert.equal(result.currency_code, 'IDR');
    assert.equal(result.total_cost, 35000);
    assert.equal(result.cost_lines.length, 2);

    const cogs = CostOfSalesService.capture({
      sourceType: 'ORDER',
      sourceReference: 'sale-cogs-001',
      totalCost: result.total_cost,
      currencyCode: result.currency_code,
      costLines: result.cost_lines
    });

    assert.equal(cogs.success, true);
    assert.equal(cogs.idempotent, false);
    assert.equal(Number(cogs.snapshot.total_cost), 35000);
    assert.equal(cogs.lines.length, 2);

    const balanceA = inventory.findProductValuationBalance({
      stockLocationId: LOCATION,
      productId: PRODUCT_A
    });
    const balanceB = inventory.findProductValuationBalance({
      stockLocationId: LOCATION,
      productId: PRODUCT_B
    });

    assert.equal(Number(balanceA.quantity), 8);
    assert.equal(Number(balanceA.carrying_value), 80000);
    assert.equal(Number(balanceA.moving_average_unit_cost), 10000);
    assert.equal(Number(balanceA.valuation_version), 2);

    assert.equal(Number(balanceB.quantity), 7);
    assert.equal(Number(balanceB.carrying_value), 35000);
    assert.equal(Number(balanceB.moving_average_unit_cost), 5000);
    assert.equal(Number(balanceB.valuation_version), 2);

    const movementA = inventory.findProductValuationMovementByPostingMutationId('sale_' +
      require('crypto').createHash('sha256').update('sale-cogs-001:' + PRODUCT_A).digest('hex').slice(0, 24));
    assert.equal(movementA.movement_type, 'SALE');
    assert.equal(Number(movementA.quantity), -2);
    assert.equal(Number(movementA.total_cost), -20000);
    assert.equal(movementA.cost_basis_type, 'CURRENT_MOVING_AVERAGE');

    inventory.commitTransaction();
  } catch (error) {
    try { inventory.rollbackTransaction(); } catch (_) {}
    throw error;
  }
});

test('same canonical Sale replay is idempotent and does not duplicate COGS', () => {
  inventory.beginTransaction();
  try {
    const result = InventorySalePostingService.postCanonicalSale({
      branchId: BRANCH,
      sourceType: 'ORDER',
      sourceReference: 'sale-cogs-001',
      actorId: 'merchant-1',
      postingTimestamp: '2026-10-08T11:00:00.000Z',
      requirements: [
        { product_id: PRODUCT_A, quantity: 999 },
        { product_id: PRODUCT_B, quantity: 999 }
      ]
    });

    assert.equal(result.status, 'AVAILABLE');
    assert.equal(result.idempotent, true);
    assert.equal(result.total_cost, 35000);
    inventory.commitTransaction();
  } catch (error) {
    try { inventory.rollbackTransaction(); } catch (_) {}
    throw error;
  }

  const snapshotCount = db.prepare(
    "SELECT COUNT(*) AS count FROM cost_of_sales_snapshots WHERE source_reference = 'sale-cogs-001'"
  ).get().count;
  assert.equal(Number(snapshotCount), 1);
});

test('canonical Sale rejects insufficient stock without partially committing another Product', () => {
  inventory.beginTransaction();
  try {
    assert.throws(
      () => InventorySalePostingService.postCanonicalSale({
        branchId: BRANCH,
        sourceType: 'ORDER',
        sourceReference: 'sale-cogs-fail',
        actorId: 'merchant-1',
        postingTimestamp: '2026-10-08T12:00:00.000Z',
        requirements: [
          { product_id: PRODUCT_A, quantity: 1 },
          { product_id: PRODUCT_B, quantity: 100 }
        ]
      }),
      error => error && error.code === 'INSUFFICIENT_STOCK'
    );

    inventory.rollbackTransaction();
  } catch (error) {
    try { inventory.rollbackTransaction(); } catch (_) {}
    throw error;
  }

  const balanceA = inventory.findProductValuationBalance({
    stockLocationId: LOCATION,
    productId: PRODUCT_A
  });
  assert.equal(Number(balanceA.quantity), 8);

  const failedMovement = db.prepare(
    "SELECT COUNT(*) AS count FROM product_stock_movements WHERE source_reference = 'sale-cogs-fail'"
  ).get().count;
  assert.equal(Number(failedMovement), 0);
});

test('missing Product identity fails closed and never invents COGS', () => {
  assert.throws(
    () => InventorySalePostingService.postCanonicalSale({
      branchId: BRANCH,
      sourceType: 'ORDER',
      sourceReference: 'sale-cogs-legacy',
      actorId: 'merchant-1',
      postingTimestamp: '2026-10-08T13:00:00.000Z',
      requirements: [
        { product_id: 'missing-canonical-product-balance', quantity: 1 }
      ]
    }),
    error => error && error.code === 'PRODUCT_NOT_FOUND'
  );
});
