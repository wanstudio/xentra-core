'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../server/database/db');
const ComposedMenuService = require('../domains/catalog/services/ComposedMenuService');
const ComposedMenuResolver = require('../domains/catalog/services/ComposedMenuResolver');

const ORG = 'cmv1_test_org';
const BRAND = 'cmv1_test_brand';
const OTHER_BRAND = 'cmv1_test_brand_other';
const CATEGORY = 'cmv1_test_category';
const CATEGORY_OTHER = 'cmv1_test_category_other';
const SUBCATEGORY = 'cmv1_test_subcategory';
const PRODUCT_A = 'cmv1_test_product_a';
const PRODUCT_B = 'cmv1_test_product_b';
const BRANCH = 'cmv1_test_branch';
const BRANCH_CATEGORY = 'cmv1_test_branch_category';

test.before(async () => {
  await db.ready;
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'Composed Menu Test Org', 'cmv1-test-org')").run(ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Composed Menu Test Brand', 'cmv1-test-brand')").run(BRAND, ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Composed Menu Other Brand', 'cmv1-test-brand-other')").run(OTHER_BRAND, ORG);
  db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Makanan CMV1', 'makanan-cmv1', 1)").run(CATEGORY, BRAND);
  db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Makanan Other CMV1', 'makanan-other-cmv1', 1)").run(CATEGORY_OTHER, OTHER_BRAND);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, ?, ?, 'Ayam CMV1', 'ayam-cmv1', 0, 1)").run(PRODUCT_A, BRAND, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, ?, ?, 'Nasi CMV1', 'nasi-cmv1', 0, 1)").run(PRODUCT_B, BRAND, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, 'Branch CMV1', 'branch-cmv1', 'Test', 0, 0, 1)").run(BRANCH, BRAND);
  db.prepare("INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'Favorit CMV1', 'favorit-cmv1', 1, 1)").run(BRANCH_CATEGORY, BRAND, BRANCH);
});

test('foundation creates Product SKU, Sub Category and Original Rasa without changing Product customer identity', () => {
  const sku = ComposedMenuService.setProductSku({
    brandId: BRAND,
    productId: PRODUCT_A,
    sku: ' ayam-cmv1-001 '
  });
  assert.equal(sku.sku, 'ayam-cmv1-001');

  const sub = ComposedMenuService.createSubCategory({
    brandId: BRAND,
    categoryId: CATEGORY,
    name: 'Ayam Bakar CMV1'
  });
  assert.equal(sub.category_id, CATEGORY);
  assert.equal(sub.name, 'Ayam Bakar CMV1');

  const original = ComposedMenuService.ensureOriginalRasa({ brandId: BRAND });
  assert.equal(original.name, 'Original');

  const menus = db.prepare("SELECT name, price FROM products WHERE id = ?").all(PRODUCT_A);
  assert.equal(menus[0].name, 'Ayam CMV1');
  assert.equal(Number(menus[0].price), 0);
});

test('Menu Satuan is backed by exactly one Product and resolves title from Sub Category', () => {
  const sub = db.prepare("SELECT id FROM sub_categories WHERE brand_id = ? AND name = 'Ayam Bakar CMV1'").get(BRAND);
  const menu = ComposedMenuService.createSingleMenu({
    brandId: BRAND,
    productId: PRODUCT_A,
    subCategoryId: sub.id,
    sellingPrice: 28000,
    status: 'ACTIVE'
  });

  assert.equal(menu.menu_type, 'SINGLE');
  const items = db.prepare('SELECT menu_id, product_id, quantity FROM menu_items WHERE menu_id = ?').all(menu.id);
  assert.deepEqual(items, [{ menu_id: menu.id, product_id: PRODUCT_A, quantity: 1 }]);

  const resolved = ComposedMenuResolver.resolveMenu({ brandId: BRAND, menuId: menu.id });
  assert.equal(resolved.title, 'Ayam Bakar CMV1');
  assert.equal(resolved.subtitle, null);
  assert.equal(resolved.price, 28000);
  assert.equal(resolved.components[0].product_id, PRODUCT_A);
});

test('Duplicate Menu Satuan identity is blocked by Sub Category + Rasa', () => {
  const sub = db.prepare("SELECT id FROM sub_categories WHERE brand_id = ? AND name = 'Ayam Bakar CMV1'").get(BRAND);
  assert.throws(
    () => ComposedMenuService.createSingleMenu({
      brandId: BRAND,
      productId: PRODUCT_A,
      subCategoryId: sub.id,
      sellingPrice: 30000
    }),
    /MENU_SATUAN_ALREADY_EXISTS/
  );
});

test('Menu Paket requires at least two total component units and uses fixed quantities', () => {
  assert.throws(
    () => ComposedMenuService.createPackageMenu({
      brandId: BRAND,
      packageName: 'Paket Satu Unit CMV1',
      sellingPrice: 10000,
      components: [{ product_id: PRODUCT_A, quantity: 1 }]
    }),
    /MENU_PACKAGE_MIN_TWO_UNITS/
  );

  const menu = ComposedMenuService.createPackageMenu({
    brandId: BRAND,
    packageName: 'Paket Ayam x2 CMV1',
    sellingPrice: 45000,
    components: [
      { product_id: PRODUCT_A, quantity: 2 }
    ],
    status: 'ACTIVE'
  });

  assert.equal(menu.menu_type, 'PACKAGE');
  const items = db.prepare(
    'SELECT product_id, quantity FROM menu_items WHERE menu_id = ? ORDER BY sort_order'
  ).all(menu.id);
  assert.deepEqual(items, [{ product_id: PRODUCT_A, quantity: 2 }]);
});

test('Package update revalidates the effective composition and rejects an empty Package', () => {
  const menu = ComposedMenuService.createPackageMenu({
    brandId: BRAND,
    packageName: 'Paket Revalidation CMV1',
    sellingPrice: 39000,
    components: [{ product_id: PRODUCT_B, quantity: 2 }],
    status: 'ACTIVE'
  });

  db.prepare('DELETE FROM menu_items WHERE menu_id = ?').run(menu.id);

  assert.throws(
    () => ComposedMenuService.updatePackageMenu({
      brandId: BRAND,
      menuId: menu.id,
      sellingPrice: 39000
    }),
    /MENU_PACKAGE_COMPONENTS_REQUIRED/
  );
});

test('Master Menu resolver fails closed when an active Menu references an inactive Product', () => {
  const menu = ComposedMenuService.createPackageMenu({
    brandId: BRAND,
    packageName: 'Paket Invalid Component CMV1',
    sellingPrice: 42000,
    components: [{ product_id: PRODUCT_B, quantity: 2 }],
    status: 'ACTIVE'
  });

  db.prepare(
    'UPDATE products SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ? AND brand_id = ?'
  ).run(PRODUCT_B, BRAND);

  const resolved = ComposedMenuResolver.resolveMasterMenu({
    brandId: BRAND,
    menuIds: [menu.id]
  });

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].is_available, false);
  assert.equal(resolved[0].blocking_reason, 'COMPONENT_UNAVAILABLE');

  db.prepare(
    'UPDATE products SET is_active = 1, updated_at = datetime(\'now\') WHERE id = ? AND brand_id = ?'
  ).run(PRODUCT_B, BRAND);
});

test('Rasa master uniqueness is normalized within one Brand', () => {
  const rasa = ComposedMenuService.createRasa({
    brandId: BRAND,
    name: 'Lombok Ijo CMV1'
  });
  assert.equal(rasa.name, 'Lombok Ijo CMV1');

  assert.throws(
    () => ComposedMenuService.createRasa({
      brandId: BRAND,
      name: '  lombok ijo cmv1  '
    }),
    /RASA_ALREADY_EXISTS/
  );
});

test('Branch Menu adoption is separate from Product Inventory and package availability is component-driven', () => {
  const menus = db.prepare("SELECT id FROM menus WHERE brand_id = ? AND menu_type = 'PACKAGE' LIMIT 1").get(BRAND);
  ComposedMenuService.adoptMenuToBranch({
    brandId: BRAND,
    branchId: BRANCH,
    menuId: menus.id,
    isAvailable: true,
    branchCategoryIds: [BRANCH_CATEGORY]
  });

  db.prepare(
    'INSERT OR REPLACE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?)'
  ).run(BRANCH, PRODUCT_A, 5, 1);

  const resolved = ComposedMenuResolver.resolveBranchMenu({
    brandId: BRAND,
    branchId: BRANCH,
    menuIds: [menus.id],
    includeUnavailable: true
  });

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].is_available, true);
  assert.equal(resolved[0].inventory.available_quantity, 2);

  db.prepare(
    'UPDATE branch_product_inventory SET stock_qty = 3, updated_at = datetime("now") WHERE branch_id = ? AND product_id = ?'
  ).run(BRANCH, PRODUCT_A);

  const stockout = ComposedMenuResolver.resolveBranchMenu({
    brandId: BRAND,
    branchId: BRANCH,
    menuIds: [menus.id],
    includeUnavailable: true
  });

  assert.equal(stockout[0].is_available, false);
  assert.equal(stockout[0].blocking_reason, 'OUT_OF_STOCK');
});

test('SKU removal is blocked while active branch stock remains positive and history is written', () => {
  ComposedMenuService.setProductSku({
    brandId: BRAND,
    productId: PRODUCT_A,
    sku: 'sku-remove-cmv1'
  });
  assert.throws(
    () => ComposedMenuService.setProductSku({
      brandId: BRAND,
      productId: PRODUCT_A,
      sku: null
    }),
    /PRODUCT_SKU_REMOVAL_BLOCKED_STOCK/
  );

  db.prepare(
    'UPDATE branch_product_inventory SET stock_qty = 0 WHERE branch_id = ? AND product_id = ?'
  ).run(BRANCH, PRODUCT_A);
  db.prepare(
    'UPDATE branch_products SET stock = 0 WHERE branch_id = ? AND product_id = ?'
  ).run(BRANCH, PRODUCT_A);

  const removed = ComposedMenuService.setProductSku({
    brandId: BRAND,
    productId: PRODUCT_A,
    sku: null,
    actorId: 'cmv1-owner',
    actorRole: 'owner'
  });
  assert.equal(removed.sku, null);

  const history = db.prepare(
    'SELECT previous_sku, new_sku, actor_id, actor_role FROM product_sku_history WHERE brand_id = ? AND product_id = ? ORDER BY changed_at DESC LIMIT 1'
  ).get(BRAND, PRODUCT_A);
  assert.equal(history.previous_sku, 'sku-remove-cmv1');
  assert.equal(history.new_sku, null);
  assert.equal(history.actor_id, 'cmv1-owner');
  assert.equal(history.actor_role, 'owner');

  ComposedMenuService.setProductSku({
    brandId: BRAND,
    productId: PRODUCT_A,
    sku: 'sku-cmv1-final'
  });
});

test('Cross-brand Product SKU and taxonomy references are rejected', () => {
  assert.throws(
    () => ComposedMenuService.setProductSku({
      brandId: OTHER_BRAND,
      productId: PRODUCT_A,
      sku: 'foreign'
    }),
    /MASTER_PRODUCT_NOT_FOUND/
  );

  assert.throws(
    () => ComposedMenuService.createSubCategory({
      brandId: BRAND,
      categoryId: CATEGORY_OTHER,
      name: 'Foreign Category CMV1'
    }),
    /CATEGORY_NOT_FOUND/
  );
});

test.after(() => {
  db.prepare('DELETE FROM branch_menu_categories WHERE branch_id = ? AND menu_id IN (SELECT id FROM menus WHERE brand_id = ?)').run(BRANCH, BRAND);
  db.prepare('DELETE FROM branch_menus WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_product_inventory WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM menu_items WHERE menu_id IN (SELECT id FROM menus WHERE brand_id = ?)').run(BRAND);
  db.prepare('DELETE FROM menus WHERE brand_id = ?').run(BRAND);
  db.prepare('DELETE FROM sub_categories WHERE brand_id = ? AND id = ?').run(BRAND, SUBCATEGORY);
  db.prepare('DELETE FROM sub_categories WHERE brand_id = ? AND name = ?').run(BRAND, 'Ayam Bakar CMV1');
  db.prepare('DELETE FROM menu_flavors WHERE brand_id = ? AND name = ?').run(BRAND, 'Original');
  db.prepare('DELETE FROM products WHERE id IN (?, ?)').run(PRODUCT_A, PRODUCT_B);
  db.prepare('DELETE FROM branch_categories WHERE id = ?').run(BRANCH_CATEGORY);
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
  db.prepare('DELETE FROM categories WHERE id IN (?, ?)').run(CATEGORY, CATEGORY_OTHER);
  db.prepare('DELETE FROM brands WHERE id IN (?, ?)').run(BRAND, OTHER_BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
