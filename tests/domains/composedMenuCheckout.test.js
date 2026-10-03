'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const { ensureComposedMenuSchema } = require('../../domains/catalog/schema/ComposedMenuSchema');
const ComposedMenuService = require('../../domains/catalog/services/ComposedMenuService');
const { verifyComposedCheckout } = require('../../domains/commerce/services/ComposedMenuCheckoutService');

const ORG = 'cmc_test_org';
const BRAND = 'cmc_test_brand';
const CATEGORY = 'cmc_test_category';
const BRANCH = 'cmc_test_branch';
const SUB_A = 'cmc_sub_a';
const SUB_B = 'cmc_sub_b';
const ORIGINAL = 'cmc_rasa_original';
const PEDAS = 'cmc_rasa_pedas';
const PRODUCT_A = 'cmc_product_a';
const PRODUCT_B = 'cmc_product_b';
const PRODUCT_NOSTOCK = 'cmc_product_nostock';
const MENU_A = 'cmc_menu_a';
const MENU_B = 'cmc_menu_b';
const MENU_PACKAGE = 'cmc_menu_package';

test.before(async () => {
  await db.ready;
  ensureComposedMenuSchema({
    queryMany(sql, params = []) { return db.prepare(sql).all(...params); },
    queryOne(sql, params = []) { return db.prepare(sql).get(...params); },
    execute(sql, params = []) { return db.prepare(sql).run(...params); },
    exec(sql) { return db.exec(sql); }
  });

  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'CMC Org', 'cmc-org')").run(ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'CMC Brand', 'cmc-brand')").run(BRAND, ORG);
  db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'CMC Category', 'cmc-category', 1)").run(CATEGORY, BRAND);
  db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, 'CMC Branch', 'cmc-branch', 'Test', 0, 0, 1)").run(BRANCH, BRAND);

  db.prepare("INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'Ayam CMC', 'ayam-cmc', 1, 1)").run(SUB_A, BRAND, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'Minuman CMC', 'minuman-cmc', 2, 1)").run(SUB_B, BRAND, CATEGORY);

  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, sort_order, is_active) VALUES (?, ?, 'Original', 'original-cmc', 0, 1)").run(ORIGINAL, BRAND);
  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, sort_order, is_active) VALUES (?, ?, 'Pedas CMC', 'pedas-cmc', 1, 1)").run(PEDAS, BRAND);

  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active, sku) VALUES (?, ?, ?, 'Ayam Atomic CMC', 'ayam-atomic-cmc', 18000, 1, 'CMC-A-001')").run(PRODUCT_A, BRAND, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active, sku) VALUES (?, ?, ?, 'Nasi Atomic CMC', 'nasi-atomic-cmc', 8000, 1, 'CMC-B-001')").run(PRODUCT_B, BRAND, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, ?, ?, 'Lalapan Non Stock CMC', 'lalapan-non-stock-cmc', 4000, 1)").run(PRODUCT_NOSTOCK, BRAND, CATEGORY);

  db.prepare("INSERT OR IGNORE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', ?, ?, 22000, 'ACTIVE')").run(MENU_A, BRAND, SUB_A, ORIGINAL);
  db.prepare("INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)").run(MENU_A, PRODUCT_A);

  db.prepare("INSERT OR IGNORE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', ?, ?, 24000, 'ACTIVE')").run(MENU_B, BRAND, SUB_A, PEDAS);
  db.prepare("INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)").run(MENU_B, PRODUCT_A);

  db.prepare("INSERT OR IGNORE INTO menus (id, brand_id, menu_type, package_name, selling_price, status) VALUES (?, ?, 'PACKAGE', 'Paket CMC', 28000, 'ACTIVE')").run(MENU_PACKAGE, BRAND);
  db.prepare("INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 2, 0)").run(MENU_PACKAGE, PRODUCT_A);
  db.prepare("INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 1)").run(MENU_PACKAGE, PRODUCT_B);

  db.prepare("INSERT OR REPLACE INTO branch_menus (branch_id, menu_id, is_available, price_override) VALUES (?, ?, 1, 23000)").run(BRANCH, MENU_A);
  db.prepare("INSERT OR REPLACE INTO branch_menus (branch_id, menu_id, is_available, price_override) VALUES (?, ?, 1, NULL)").run(BRANCH, MENU_B);
  db.prepare("INSERT OR REPLACE INTO branch_menus (branch_id, menu_id, is_available, price_override) VALUES (?, ?, 1, 30000)").run(BRANCH, MENU_PACKAGE);

  db.prepare("INSERT OR REPLACE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, 3, 1)").run(BRANCH, PRODUCT_A);
  db.prepare("INSERT OR REPLACE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, 2, 1)").run(BRANCH, PRODUCT_B);
});

test('canonical checkout uses Branch Menu price and Menu snapshot authority', () => {
  const result = verifyComposedCheckout({
    brandId: BRAND,
    branchId: BRANCH,
    items: [
      { menu_id: MENU_A, quantity: 1, expected_price: 23000 }
    ]
  });

  assert.equal(result.is_valid, true);
  assert.equal(result.verified_items.length, 1);
  assert.equal(result.verified_items[0].unit_price, 23000);
  assert.equal(result.verified_items[0].menu_id, MENU_A);
  assert.equal(result.verified_items[0].product_id, PRODUCT_A);
  assert.equal(result.verified_items[0].menu_snapshot.menu_id, MENU_A);
  assert.equal(result.verified_items[0].component_snapshot[0].sku, 'CMC-A-001');
});

test('canonical checkout aggregates shared Product stock across Menu lines', () => {
  const result = verifyComposedCheckout({
    brandId: BRAND,
    branchId: BRANCH,
    items: [
      { menu_id: MENU_A, quantity: 2, expected_price: 46000 },
      { menu_id: MENU_B, quantity: 2, expected_price: 48000 }
    ]
  });

  // Four Menu units consume four units of Product A, while Branch only has three.
  assert.equal(result.is_valid, false);
  assert.equal(result.status, 'OUT_OF_STOCK');
  assert.ok(result.errors.some(error => String(error).includes(PRODUCT_A)));
});

test('canonical Menu Paket consumes component quantities and allows SKU-less non-stock components', () => {
  db.prepare("INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 2)").run(MENU_PACKAGE, PRODUCT_NOSTOCK);

  const result = verifyComposedCheckout({
    brandId: BRAND,
    branchId: BRANCH,
    items: [
      { menu_id: MENU_PACKAGE, quantity: 1, expected_price: 30000 }
    ]
  });

  assert.equal(result.is_valid, true);
  assert.equal(result.verified_items[0].menu_type, 'PACKAGE');

  const packageComponents = result.verified_items[0].component_snapshot;
  assert.deepEqual(
    packageComponents.map(row => [row.product_id, row.quantity]),
    [
      [PRODUCT_A, 2],
      [PRODUCT_B, 1],
      [PRODUCT_NOSTOCK, 1]
    ]
  );
});

test('canonical checkout rejects client option/modifier payload until canonical option pricing is modeled', () => {
  const result = verifyComposedCheckout({
    brandId: BRAND,
    branchId: BRANCH,
    items: [
      { menu_id: MENU_A, quantity: 1, options: [{ id: 'x', quantity: 1 }] }
    ]
  });

  assert.equal(result.is_valid, false);
  assert.ok(result.errors.includes('CANONICAL_MENU_OPTIONS_NOT_MODELED'));
});

test.after(() => {
  db.prepare('DELETE FROM order_items WHERE menu_id IN (?, ?, ?)').run(MENU_A, MENU_B, MENU_PACKAGE);
  db.prepare('DELETE FROM branch_menus WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_product_inventory WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM menu_items WHERE menu_id IN (?, ?, ?)').run(MENU_A, MENU_B, MENU_PACKAGE);
  db.prepare('DELETE FROM menus WHERE id IN (?, ?, ?)').run(MENU_A, MENU_B, MENU_PACKAGE);
  db.prepare('DELETE FROM sub_categories WHERE id IN (?, ?)').run(SUB_A, SUB_B);
  db.prepare('DELETE FROM menu_flavors WHERE id IN (?, ?)').run(ORIGINAL, PEDAS);
  db.prepare('DELETE FROM products WHERE id IN (?, ?, ?)').run(PRODUCT_A, PRODUCT_B, PRODUCT_NOSTOCK);
  db.prepare('DELETE FROM branch_categories WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
  db.prepare('DELETE FROM categories WHERE id = ?').run(CATEGORY);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
