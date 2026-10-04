'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const {
  ComposedMenuService,
  ComposedMenuResolver
} = require('../../domains/catalog');

const ORG = 'bmcv1_org';
const BRAND = 'bmcv1_brand';
const BRANCH = 'bmcv1_branch';
const CATEGORY = 'bmcv1_category';
const SUB = 'bmcv1_sub';
const RASA = 'bmcv1_rasa';
const PRODUCT = 'bmcv1_product';
const MENU = 'bmcv1_menu';
const BCAT = 'bmcv1_branch_category';

test.before(async () => {
  await db.ready;

  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'BMCV1 Org', 'bmcv1-org')").run(ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'BMCV1 Brand', 'bmcv1-brand')").run(BRAND, ORG);
  db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'BMCV1 Category', 'bmcv1-category', 1)").run(CATEGORY, BRAND);
  db.prepare("INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'BMCV1 Sub', 'bmcv1-sub', 1, 1)").run(SUB, BRAND, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, sort_order, is_active) VALUES (?, ?, 'Original', 'bmcv1-original', 1, 1)").run(RASA, BRAND);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, regular_price, sku, is_active) VALUES (?, ?, ?, 'BMCV1 Product', 'bmcv1-product', 10000, 10000, 'BMCV1-SKU-001', 1)").run(PRODUCT, BRAND, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', ?, ?, 12000, 'ACTIVE')").run(MENU, BRAND, SUB, RASA);
  db.prepare("INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)").run(MENU, PRODUCT);
  db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, 'BMCV1 Branch', 'bmcv1-branch', 'Jl Test', 0, 0, 1)").run(BRANCH, BRAND);
  db.prepare("INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'BMCV1 Branch Category', 'bmcv1-branch-category', 1, 1)").run(BCAT, BRAND, BRANCH);
  db.prepare("INSERT OR REPLACE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, 10, 1)").run(BRANCH, PRODUCT);
  db.prepare("DELETE FROM branch_menus WHERE branch_id = ? AND menu_id = ?").run(BRANCH, MENU);
  db.prepare("DELETE FROM branch_products WHERE branch_id = ? AND product_id = ?").run(BRANCH, PRODUCT);
});

test('canonical branch adoption writes branch_menus, not branch_products', () => {
  const result = ComposedMenuService.adoptMenuToBranch({
    brandId: BRAND,
    branchId: BRANCH,
    menuId: MENU,
    branchCategoryIds: [BCAT]
  });

  assert.equal(result.branch_menu.menu_id, MENU);
  assert.equal(result.branch_menu.branch_id, BRANCH);
  assert.equal(Number(result.branch_menu.is_available), 1);

  const canonical = db.prepare(
    'SELECT menu_id, branch_id, is_available, price_override, display_name_override FROM branch_menus WHERE branch_id = ? AND menu_id = ?'
  ).get(BRANCH, MENU);
  assert.ok(canonical);
  assert.equal(canonical.display_name_override, null);

  const legacy = db.prepare(
    'SELECT 1 AS found FROM branch_products WHERE branch_id = ? AND product_id = ?'
  ).get(BRANCH, PRODUCT);
  assert.equal(legacy, undefined);

  const memberships = db.prepare(
    'SELECT branch_category_id FROM branch_menu_categories WHERE branch_id = ? AND menu_id = ?'
  ).all(BRANCH, MENU);
  assert.deepEqual(memberships.map(r => r.branch_category_id), [BCAT]);
});

test('branch Menu availability and display-name override mutate only the canonical boundary', () => {
  ComposedMenuService.setBranchMenuDisplayName({
    brandId: BRAND,
    branchId: BRANCH,
    menuId: MENU,
    name: 'BMCV1 Customer Title'
  });

  const resolved = ComposedMenuResolver.resolveBranchMenu({
    brandId: BRAND,
    branchId: BRANCH,
    includeUnavailable: true
  })[0];

  assert.equal(resolved.menu_id, MENU);
  assert.equal(resolved.title, 'BMCV1 Customer Title');
  assert.equal(resolved.display_name_override, 'BMCV1 Customer Title');

  ComposedMenuService.setBranchMenuAvailability({
    brandId: BRAND,
    branchId: BRANCH,
    menuId: MENU,
    isAvailable: false
  });

  const unavailable = ComposedMenuResolver.resolveBranchMenu({
    brandId: BRAND,
    branchId: BRANCH,
    includeUnavailable: true
  })[0];

  assert.equal(unavailable.is_available, false);
  assert.equal(unavailable.blocking_reason, 'BRANCH_MENU_UNAVAILABLE');
});

test('removing a branch Menu removes branch_menus and its Menu category memberships', () => {
  ComposedMenuService.removeMenuFromBranch({
    brandId: BRAND,
    branchId: BRANCH,
    menuId: MENU
  });

  assert.equal(
    db.prepare('SELECT 1 AS found FROM branch_menus WHERE branch_id = ? AND menu_id = ?').get(BRANCH, MENU),
    undefined
  );
  assert.equal(
    db.prepare('SELECT 1 AS found FROM branch_menu_categories WHERE branch_id = ? AND menu_id = ?').get(BRANCH, MENU),
    undefined
  );

  const product = db.prepare('SELECT 1 AS found FROM products WHERE id = ? AND brand_id = ?').get(PRODUCT, BRAND);
  assert.ok(product, 'removing a branch Menu never deletes the Master Product');
});
