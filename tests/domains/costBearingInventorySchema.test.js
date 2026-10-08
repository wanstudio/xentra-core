'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');

db.initSchema(db);

// Material master is a later domain implementation. For this schema contract test,
// provide the minimum parent table required by the target FK inside the isolated test DB.
db.exec(`
  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL
  );
`);

const ORG = 'org_cost_schema_test';
const ORG_2 = 'org_cost_schema_test_2';
const BRAND = 'brand_cost_schema_test';
const BRANCH = 'branch_cost_schema_test';
const PRODUCT = 'product_cost_schema_test';
const LOCATION_A = 'location_cost_schema_a';
const LOCATION_B = 'location_cost_schema_b';
const LOCATION_OTHER_ORG = 'location_cost_schema_other_org';

function setupFixture() {
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, plan)
    VALUES (?, ?, ?, 'test')
  `).run(ORG, 'Cost Schema Test Org', 'cost-schema-test-org');

  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, plan)
    VALUES (?, ?, ?, 'test')
  `).run(ORG_2, 'Cost Schema Test Org 2', 'cost-schema-test-org-2');

  db.prepare(`
    INSERT OR IGNORE INTO brands (id, organization_id, name, slug)
    VALUES (?, ?, ?, ?)
  `).run(BRAND, ORG, 'Cost Schema Test Brand', 'cost-schema-test-brand');

  db.prepare(`
    INSERT OR IGNORE INTO branches (
      id, brand_id, name, slug, address_text, latitude, longitude, is_active
    ) VALUES (?, ?, ?, ?, 'Test Address', 0, 0, 1)
  `).run(BRANCH, BRAND, 'Cost Schema Branch', 'cost-schema-branch');

  db.prepare(`
    INSERT OR IGNORE INTO products (
      id, brand_id, name, slug, price, is_active
    ) VALUES (?, ?, ?, ?, 10000, 1)
  `).run(PRODUCT, BRAND, 'Cost Schema Product', 'cost-schema-product');

  db.prepare(`
    INSERT OR IGNORE INTO materials (id, organization_id, name)
    VALUES ('material_cost_schema_test', ?, 'Cost Schema Material')
  `).run(ORG);

  db.prepare(`
    INSERT OR IGNORE INTO stock_locations (
      id, organization_id, branch_id, code, name, location_type, is_active
    ) VALUES (?, ?, ?, 'COST-A', 'Cost Test Location A', 'BRANCH', 1)
  `).run(LOCATION_A, ORG, BRANCH);

  db.prepare(`
    INSERT OR IGNORE INTO stock_locations (
      id, organization_id, branch_id, code, name, location_type, is_active
    ) VALUES (?, ?, ?, 'COST-B', 'Cost Test Location B', 'BRANCH', 1)
  `).run(LOCATION_B, ORG, BRANCH);

  db.prepare(`
    INSERT OR IGNORE INTO stock_locations (
      id, organization_id, branch_id, code, name, location_type, is_active
    ) VALUES (?, ?, NULL, 'OTHER-ORG', 'Other Org Location', 'CENTRAL_WAREHOUSE', 1)
  `).run(LOCATION_OTHER_ORG, ORG_2);

  db.prepare(`
    INSERT OR IGNORE INTO product_stock_balances (
      stock_location_id, product_id, quantity, carrying_value,
      moving_average_unit_cost, cost_availability_status, valuation_version
    ) VALUES (?, ?, 10, 100000, 10000, 'AVAILABLE', 0)
  `).run(LOCATION_A, PRODUCT);

  db.prepare(`
    INSERT OR IGNORE INTO material_stock_balances (
      stock_location_id, material_id, quantity_base, carrying_value,
      moving_average_unit_cost, cost_availability_status, valuation_version
    ) VALUES (?, 'material_cost_schema_test', 10, 100000, 10000, 'AVAILABLE', 0)
  `).run(LOCATION_A);

  db.prepare(`
    INSERT OR IGNORE INTO product_stock_balances (
      stock_location_id, product_id, quantity, carrying_value,
      moving_average_unit_cost, cost_availability_status, valuation_version
    ) VALUES (?, ?, 2, 20000, 10000, 'AVAILABLE', 0)
  `).run(LOCATION_B, PRODUCT);
}

setupFixture();

test('cost-bearing inventory target schema provisions required tables and indexes', () => {
  const tables = db.prepare(`
    SELECT name
      FROM sqlite_master
     WHERE type = 'table'
       AND name IN (
         'stock_locations',
         'material_stock_balances',
         'material_stock_movements',
         'product_stock_balances',
         'product_stock_movements'
       )
  `).all().map((row) => row.name);

  assert.deepEqual(
    new Set(tables),
    new Set([
      'stock_locations',
      'material_stock_balances',
      'material_stock_movements',
      'product_stock_balances',
      'product_stock_movements'
    ])
  );
});

test('product stock valuation is organization-scoped by Stock Location', () => {
  assert.throws(
    () => db.prepare(`
      INSERT INTO product_stock_balances (
        stock_location_id, product_id, quantity, carrying_value,
        moving_average_unit_cost, valuation_version
      ) VALUES (?, ?, 1, 10000, 10000, 0)
    `).run(LOCATION_OTHER_ORG, PRODUCT),
    /PRODUCT_STOCK_LOCATION_ORG_SCOPE_MISMATCH/
  );
});

test('product balance enforces non-negative valuation and value/quantity invariant', () => {
  assert.throws(
    () => db.prepare(`
      INSERT INTO product_stock_balances (
        stock_location_id, product_id, quantity, carrying_value,
        moving_average_unit_cost, cost_availability_status, valuation_version
      ) VALUES (?, ?, -1, -10000, 10000, 'AVAILABLE', 0)
    `).run(LOCATION_A, PRODUCT),
    /CHECK constraint failed/
  );

  assert.throws(
    () => db.prepare(`
      INSERT INTO product_stock_balances (
        stock_location_id, product_id, quantity, carrying_value,
        moving_average_unit_cost, cost_availability_status, valuation_version
      ) VALUES (?, ?, 2, 10000, 10000, 'AVAILABLE', 0)
    `).run(LOCATION_B, PRODUCT),
    /CHECK constraint failed/
  );
});

test('product movement records signed cost evidence and must match resulting balance', () => {
  // Move Location A from 10 units to 30 units at a new incoming cost of 12,000.
  db.prepare(`
    UPDATE product_stock_balances
       SET quantity = 30,
           carrying_value = 340000,
           moving_average_unit_cost = 11333.333333333334,
           cost_availability_status = 'AVAILABLE',
           valuation_version = 1
     WHERE stock_location_id = ? AND product_id = ?
  `).run(LOCATION_A, PRODUCT);

  db.prepare(`
    INSERT INTO product_stock_movements (
      id, stock_location_id, product_id, movement_type,
      quantity, previous_quantity, current_quantity,
      unit_cost, total_cost, currency_code, valuation_method, cost_basis_type,
      source_type, source_reference, posting_mutation_id,
      valuation_version, posting_timestamp, resolver_version
    ) VALUES (
      'movement_cost_schema_product_in_1', ?, ?, 'ADJUSTMENT_IN',
      20, 10, 30,
      12000, 240000, 'IDR', 'MOVING_AVERAGE', 'COUNT_CORRECTION',
      'TEST', 'TEST-IN-1', 'mutation-product-in-1',
      1, '2026-10-08T19:00:00+07:00', 'v1'
    )
  `).run(LOCATION_A, PRODUCT);

  const movement = db.prepare(`
    SELECT quantity, unit_cost, total_cost, valuation_method,
           cost_basis_type, current_quantity, valuation_version
      FROM product_stock_movements
     WHERE id = 'movement_cost_schema_product_in_1'
  `).get();

  assert.equal(movement.quantity, 20);
  assert.equal(movement.unit_cost, 12000);
  assert.equal(movement.total_cost, 240000);
  assert.equal(movement.valuation_method, 'MOVING_AVERAGE');
  assert.equal(movement.cost_basis_type, 'COUNT_CORRECTION');
  assert.equal(movement.current_quantity, 30);
  assert.equal(movement.valuation_version, 1);
});

test('posted product movement is immutable', () => {
  assert.throws(
    () => db.prepare(`
      UPDATE product_stock_movements
         SET total_cost = 1
       WHERE id = 'movement_cost_schema_product_in_1'
    `).run(),
    /POSTED_STOCK_MOVEMENT_IMMUTABLE/
  );

  assert.throws(
    () => db.prepare(`
      DELETE FROM product_stock_movements
       WHERE id = 'movement_cost_schema_product_in_1'
    `).run(),
    /POSTED_STOCK_MOVEMENT_IMMUTABLE/
  );
});

test('transfer source and destination preserve carried value', () => {
  db.prepare(`
    UPDATE product_stock_balances
       SET quantity = 25,
           carrying_value = 283333.3333333333,
           moving_average_unit_cost = 11333.333333333334,
           cost_availability_status = 'AVAILABLE',
           valuation_version = 2
     WHERE stock_location_id = ? AND product_id = ?
  `).run(LOCATION_A, PRODUCT);

  db.prepare(`
    INSERT INTO product_stock_movements (
      id, stock_location_id, product_id, movement_type,
      quantity, previous_quantity, current_quantity,
      unit_cost, total_cost, currency_code, valuation_method, cost_basis_type,
      source_type, source_reference, posting_mutation_id,
      valuation_version, posting_timestamp, resolver_version
    ) VALUES (
      'movement_cost_schema_transfer_out', ?, ?, 'TRANSFER_OUT',
      -5, 30, 25,
      11333.333333333334, -56666.66666666667, 'IDR', 'MOVING_AVERAGE', 'CURRENT_MOVING_AVERAGE',
      'TEST', 'TRANSFER-1', 'mutation-transfer-out-1',
      2, '2026-10-08T19:05:00+07:00', 'v1'
    )
  `).run(LOCATION_A, PRODUCT);

  db.prepare(`
    UPDATE product_stock_balances
       SET quantity = 7,
           carrying_value = 76666.66666666667,
           moving_average_unit_cost = 10952.380952380952,
           cost_availability_status = 'AVAILABLE',
           valuation_version = 1
     WHERE stock_location_id = ? AND product_id = ?
  `).run(LOCATION_B, PRODUCT);

  db.prepare(`
    INSERT INTO product_stock_movements (
      id, stock_location_id, product_id, movement_type,
      quantity, previous_quantity, current_quantity,
      unit_cost, total_cost, currency_code, valuation_method, cost_basis_type,
      source_type, source_reference, source_movement_id,
      posting_mutation_id, valuation_version, posting_timestamp, resolver_version
    ) VALUES (
      'movement_cost_schema_transfer_in', ?, ?, 'TRANSFER_IN',
      5, 2, 7,
      11333.333333333334, 56666.66666666667, 'IDR', 'MOVING_AVERAGE', 'TRANSFER_CARRIED',
      'TEST', 'TRANSFER-1', 'movement_cost_schema_transfer_out',
      'mutation-transfer-in-1', 1, '2026-10-08T19:06:00+07:00', 'v1'
    )
  `).run(LOCATION_B, PRODUCT);

  const outbound = db.prepare(`
    SELECT total_cost FROM product_stock_movements
     WHERE id = 'movement_cost_schema_transfer_out'
  `).get();
  const inbound = db.prepare(`
    SELECT total_cost FROM product_stock_movements
     WHERE id = 'movement_cost_schema_transfer_in'
  `).get();

  assert.equal(Math.abs(outbound.total_cost), inbound.total_cost);
});

test('movement rejects inconsistent total cost and cannot use zero as implicit unknown cost', () => {
  assert.throws(
    () => db.prepare(`
      INSERT INTO product_stock_movements (
        id, stock_location_id, product_id, movement_type,
        quantity, previous_quantity, current_quantity,
        unit_cost, total_cost, currency_code, valuation_method, cost_basis_type,
        source_type, source_reference, posting_mutation_id,
        valuation_version, posting_timestamp, resolver_version
      ) VALUES (
        'movement_cost_schema_bad_total', ?, ?, 'SALE',
        -1, 10, 9,
        10000, -1, 'IDR', 'MOVING_AVERAGE', 'CURRENT_MOVING_AVERAGE',
        'TEST', 'TEST-BAD-TOTAL', 'mutation-bad-total',
        3, '2026-10-08T19:10:00+07:00', 'v1'
      )
    `).run(LOCATION_A, PRODUCT),
    /CHECK constraint failed/
  );

  const cols = db.prepare('PRAGMA table_info(product_stock_movements)').all().map((row) => row.name);
  assert.equal(cols.includes('unit_cost'), true);
  assert.equal(cols.includes('total_cost'), true);
  assert.equal(cols.includes('cost_basis_type'), true);
  assert.equal(cols.includes('posting_mutation_id'), true);
  assert.equal(cols.includes('resolver_version'), true);
  assert.equal(cols.includes('currency_code'), true);
  const balanceCols = db.prepare('PRAGMA table_info(product_stock_balances)').all().map((row) => row.name);
  assert.equal(balanceCols.includes('cost_availability_status'), true);
});
