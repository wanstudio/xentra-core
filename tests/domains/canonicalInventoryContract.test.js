'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const { ensureComposedMenuSchema } = require('../../domains/catalog/schema/ComposedMenuSchema');
const InventoryStockService = require('../../domains/inventory/services/InventoryStockService');
const InventoryMovementModel = require('../../domains/inventory/models/InventoryMovementModel');

const ORG = 'canonical_inventory_test_org';
const BRAND = 'canonical_inventory_test_brand';
const CATEGORY = 'canonical_inventory_test_category';
const PRODUCT = 'canonical_inventory_test_product';
const BRANCH = 'canonical_inventory_test_branch';

test.before(async () => {
  await db.ready;
  ensureComposedMenuSchema({
    queryMany(sql, params = []) { return db.prepare(sql).all(...params); },
    queryOne(sql, params = []) { return db.prepare(sql).get(...params); },
    execute(sql, params = []) { return db.prepare(sql).run(...params); },
    exec(sql) { return db.exec(sql); }
  });
});

test('SKU Product stock is owned by branch_product_inventory and does not require Branch Menu adoption', () => {
  db.prepare(
    "INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'Canonical Inventory Test Org', 'canonical-inventory-test-org')"
  ).run(ORG);
  db.prepare(
    "INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Canonical Inventory Test Brand', 'canonical-inventory-test-brand')"
  ).run(BRAND, ORG);
  db.prepare(
    "INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Inventory Test', 'inventory-test', 1)"
  ).run(CATEGORY, BRAND);
  db.prepare(
    "INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active, sku) VALUES (?, ?, ?, 'Stock Product', 'stock-product', 0, 1, 'INV-CANONICAL-001')"
  ).run(PRODUCT, BRAND, CATEGORY);
  db.prepare(
    "INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, 'Inventory Branch', 'inventory-branch', 'Test', 0, 0, 1)"
  ).run(BRANCH, BRAND);

  // Deliberately no branch_products row and no branch_menus row:
  // stock identity must remain independent from sale adoption.
  const inbound = InventoryStockService.recordMovement({
    branch_id: BRANCH,
    product_id: PRODUCT,
    movement_type: InventoryMovementModel.MOVEMENT_TYPES.AUDIT_ADJUSTMENT,
    quantity: 5,
    actor_id: 'inventory-test'
  });

  assert.equal(inbound.success, true);
  assert.equal(inbound.current_stock, 5);
  assert.equal(InventoryStockService.getStock(BRANCH, PRODUCT), 5);

  const canonicalRow = db.prepare(
    'SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?'
  ).get(BRANCH, PRODUCT);
  assert.equal(Number(canonicalRow.stock_qty), 5);

  const legacyRow = db.prepare(
    'SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?'
  ).get(BRANCH, PRODUCT);
  assert.equal(legacyRow, undefined);

  const outbound = InventoryStockService.recordMovement({
    branch_id: BRANCH,
    product_id: PRODUCT,
    movement_type: InventoryMovementModel.MOVEMENT_TYPES.WASTE_SPOILAGE,
    quantity: -2,
    actor_id: 'inventory-test'
  });

  assert.equal(outbound.current_stock, 3);

  assert.throws(() => {
    InventoryStockService.recordMovement({
      branch_id: BRANCH,
      product_id: PRODUCT,
      movement_type: InventoryMovementModel.MOVEMENT_TYPES.WASTE_SPOILAGE,
      quantity: -4,
      actor_id: 'inventory-test'
    });
  }, /Stok tidak boleh negatif/);

  assert.equal(InventoryStockService.getStock(BRANCH, PRODUCT), 3);
});

test('SKU Product inventory rejects cross-brand Branch mutation before stock changes', () => {
  const foreignBranch = 'canonical_inventory_test_foreign_branch';

  db.prepare(
    "INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'Canonical Inventory Foreign Org', 'canonical-inventory-foreign-org')"
  ).run('canonical_inventory_foreign_org');
  db.prepare(
    "INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Canonical Inventory Foreign Brand', 'canonical-inventory-foreign-brand')"
  ).run('canonical_inventory_foreign_brand', 'canonical_inventory_foreign_org');
  db.prepare(
    "INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, 'Foreign Inventory Branch', 'foreign-inventory-branch', 'Test', 0, 0, 1)"
  ).run(foreignBranch, 'canonical_inventory_foreign_brand');

  assert.throws(() => {
    InventoryStockService.recordMovement({
      branch_id: foreignBranch,
      product_id: PRODUCT,
      movement_type: InventoryMovementModel.MOVEMENT_TYPES.AUDIT_ADJUSTMENT,
      quantity: 1,
      actor_id: 'inventory-test'
    });
  }, /Branch\/Product brand mismatch/);

  const row = db.prepare(
    'SELECT stock_qty FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?'
  ).get(foreignBranch, PRODUCT);
  assert.equal(row, undefined);
});

test.after(() => {
  db.prepare('DELETE FROM inventory_movements WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_product_inventory WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_menus WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_products WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT);
  db.prepare('DELETE FROM branches WHERE id IN (?, ?)').run(BRANCH, 'canonical_inventory_test_foreign_branch');
  db.prepare('DELETE FROM categories WHERE id = ?').run(CATEGORY);
  db.prepare('DELETE FROM brands WHERE id IN (?, ?)')
    .run(BRAND, 'canonical_inventory_foreign_brand');
  db.prepare('DELETE FROM organizations WHERE id IN (?, ?)')
    .run(ORG, 'canonical_inventory_foreign_org');
});
