'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../server/database/db');
const ComposedProductService = require('../../domains/catalog/services/ComposedProductService');
const ComposedMenuService = require('../../domains/catalog/services/ComposedMenuService');

const ORG = 'sku_inventory_auto_org';
const BRAND = 'sku_inventory_auto_brand';
const BRANCH_ACTIVE_A = 'sku_inventory_auto_branch_a';
const BRANCH_ACTIVE_B = 'sku_inventory_auto_branch_b';
const BRANCH_INACTIVE = 'sku_inventory_auto_branch_inactive';

test.before(async () => {
  await db.ready;
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'SKU Inventory Auto Org', 'sku-inventory-auto-org')").run(ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'SKU Inventory Auto Brand', 'sku-inventory-auto-brand')").run(BRAND, ORG);
  db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, 'Active A', 'sku-auto-a', 'Test', 0, 0, 1)").run(BRANCH_ACTIVE_A, BRAND);
  db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, 'Active B', 'sku-auto-b', 'Test', 0, 0, 1)").run(BRANCH_ACTIVE_B, BRAND);
  db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, 'Inactive', 'sku-auto-inactive', 'Test', 0, 0, 0)").run(BRANCH_INACTIVE, BRAND);
});

test('creating a SKU Product automatically provisions zero-stock inventory rows for every active branch', () => {
  const product = ComposedProductService.createProduct({
    brandId: BRAND,
    name: 'Nasi SKU Auto',
    sku: 'SKU-AUTO-CREATE-001'
  });

  const rows = db.prepare(
    'SELECT branch_id, product_id, stock_qty, low_stock_threshold FROM branch_product_inventory WHERE product_id = ? ORDER BY branch_id'
  ).all(product.id);

  assert.deepEqual(Array.from(rows).map(row => ({
    branch_id: row.branch_id,
    product_id: row.product_id,
    stock_qty: Number(row.stock_qty),
    low_stock_threshold: Number(row.low_stock_threshold)
  })), [
    { branch_id: BRANCH_ACTIVE_A, product_id: product.id, stock_qty: 0, low_stock_threshold: 5 },
    { branch_id: BRANCH_ACTIVE_B, product_id: product.id, stock_qty: 0, low_stock_threshold: 5 }
  ]);
});

test('adding SKU to an existing Product automatically provisions active-branch inventory rows', () => {
  const product = ComposedProductService.createProduct({
    brandId: BRAND,
    name: 'Nasi SKU Added Later'
  });

  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM branch_product_inventory WHERE product_id = ?').get(product.id).n,
    0
  );

  const updated = ComposedMenuService.setProductSku({
    brandId: BRAND,
    productId: product.id,
    sku: 'SKU-AUTO-LATER-001'
  });

  assert.equal(updated.sku, 'SKU-AUTO-LATER-001');

  const rows = db.prepare(
    'SELECT branch_id, stock_qty FROM branch_product_inventory WHERE product_id = ? ORDER BY branch_id'
  ).all(product.id);

  assert.deepEqual(Array.from(rows).map(row => ({
    branch_id: row.branch_id,
    stock_qty: Number(row.stock_qty)
  })), [
    { branch_id: BRANCH_ACTIVE_A, stock_qty: 0 },
    { branch_id: BRANCH_ACTIVE_B, stock_qty: 0 }
  ]);
});

test('SKU-less Product does not create canonical inventory rows', () => {
  const product = ComposedProductService.createProduct({
    brandId: BRAND,
    name: 'Lalapan Non Stock Auto'
  });

  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM branch_product_inventory WHERE product_id = ?').get(product.id).n,
    0
  );
});

test.after(() => {
  db.prepare('DELETE FROM inventory_movements WHERE product_id IN (SELECT id FROM products WHERE brand_id = ?)').run(BRAND);
  db.prepare('DELETE FROM branch_product_inventory WHERE product_id IN (SELECT id FROM products WHERE brand_id = ?)').run(BRAND);
  db.prepare('DELETE FROM product_sku_history WHERE brand_id = ?').run(BRAND);
  db.prepare('DELETE FROM products WHERE brand_id = ?').run(BRAND);
  db.prepare('DELETE FROM branches WHERE brand_id = ?').run(BRAND);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
