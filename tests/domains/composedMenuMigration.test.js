'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const { ensureComposedMenuSchema } = require('../../domains/catalog/schema/ComposedMenuSchema');
const { ComposedMenuMigrationService, generatedSku } = require('../../domains/catalog/services/ComposedMenuMigrationService');

const ORG = 'cmm_test_org';
const BRAND = 'cmm_test_brand';
const CATEGORY = 'cmm_test_category';
const CATEGORY_OTHER = 'cmm_test_category_other';
const BRANCH = 'cmm_test_branch';
const BRANCH_CATEGORY = 'cmm_test_branch_category';
const PRODUCT_SIMPLE = 'cmm_product_simple';
const PRODUCT_STOCK = 'cmm_product_stock';
const PRODUCT_COMPLEMENT = 'cmm_product_complement';
const PRODUCT_DUPLICATE = 'cmm_product_duplicate';
const COMPLEMENT = 'cmm_complement';

test.before(async () => {
  await db.ready;
  ensureComposedMenuSchema({
    queryMany(sql, params = []) { return db.prepare(sql).all(...params); },
    queryOne(sql, params = []) { return db.prepare(sql).get(...params); },
    execute(sql, params = []) { return db.prepare(sql).run(...params); },
    exec(sql) { return db.exec(sql); }
  });

  db.prepare(
    "INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'CMM Org', 'cmm-org')"
  ).run(ORG);
  db.prepare(
    "INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'CMM Brand', 'cmm-brand')"
  ).run(BRAND, ORG);
  db.prepare(
    "INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Makanan CMM', 'makanan-cmm', 1)"
  ).run(CATEGORY, BRAND);
  db.prepare(
    "INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Makanan Other CMM', 'makanan-other-cmm', 1)"
  ).run(CATEGORY_OTHER, BRAND);
  db.prepare(
    "INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, 'CMM Branch', 'cmm-branch', 'Test', 0, 0, 1)"
  ).run(BRANCH, BRAND);
  db.prepare(
    "INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'CMM Category', 'cmm-category', 1, 1)"
  ).run(BRANCH_CATEGORY, BRAND, BRANCH);

  db.prepare(
    "INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, is_active) VALUES (?, ?, ?, 'Ayam CMM Simple', 'ayam-cmm-simple', 'Simple product', 28000, 1)"
  ).run(PRODUCT_SIMPLE, BRAND, CATEGORY);
  db.prepare(
    "INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, is_active) VALUES (?, ?, ?, 'Ayam CMM Stock', 'ayam-cmm-stock', 'Stock product', 30000, 1)"
  ).run(PRODUCT_STOCK, BRAND, CATEGORY);
  db.prepare(
    "INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, is_active) VALUES (?, ?, ?, 'Ayam CMM Complement', 'ayam-cmm-complement', 'Complement product', 32000, 1)"
  ).run(PRODUCT_COMPLEMENT, BRAND, CATEGORY);
  db.prepare(
    "INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, is_active) VALUES (?, ?, ?, 'Ayam CMM Duplicate', 'ayam-cmm-duplicate', 'Duplicate identity product', 33000, 1)"
  ).run(PRODUCT_DUPLICATE, BRAND, CATEGORY);

  db.prepare(
    "INSERT OR IGNORE INTO menu_complements (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Nasi CMM', 'nasi-cmm', 1)"
  ).run(COMPLEMENT);
  db.prepare(
    "DELETE FROM product_complements WHERE product_id IN (?, ?, ?, ?)"
  ).run(PRODUCT_SIMPLE, PRODUCT_STOCK, PRODUCT_COMPLEMENT, PRODUCT_DUPLICATE);
});

test('dry-run plans deterministic SKU when legacy stock requires a Product SKU without mutating Product/Menu/Inventory', () => {
  db.prepare(
    "INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold) VALUES (?, ?, 30000, 7, 1, 2)"
  ).run(BRANCH, PRODUCT_STOCK);

  const plan = ComposedMenuMigrationService.reconcileProduct({
    brandId: BRAND,
    productId: PRODUCT_STOCK
  });

  assert.equal(plan.status, 'legacy');
  assert.equal(plan.target.sku, generatedSku(BRAND, PRODUCT_STOCK));
  assert.equal(plan.target.sku_generated, true);
  assert.equal(plan.applied, false);
  assert.equal(plan.persisted, false);

  const product = db.prepare('SELECT sku FROM products WHERE id = ?').get(PRODUCT_STOCK);
  assert.equal(product.sku, null);
  const menu = db.prepare(
    "SELECT id FROM menus WHERE brand_id = ? AND menu_type = 'SINGLE' AND id LIKE ?"
  ).get(BRAND, '%');
  assert.equal(menu, undefined);
  db.prepare('DELETE FROM branch_products WHERE branch_id = ? AND product_id = ?').run(BRANCH, PRODUCT_STOCK);
});

test('apply migrates a simple legacy Product to one Menu Satuan with Original Rasa', () => {
  const result = ComposedMenuMigrationService.reconcileProduct({
    brandId: BRAND,
    productId: PRODUCT_SIMPLE,
    apply: true
  });

  assert.equal(result.status, 'migrated');
  assert.equal(result.applied, true);

  const menu = db.prepare(
    "SELECT m.id, m.menu_type, m.selling_price, mi.product_id, mi.quantity, m.rasa_id, m.sub_category_id " +
    "FROM menus m JOIN menu_items mi ON mi.menu_id = m.id " +
    "WHERE m.brand_id = ? AND mi.product_id = ? AND m.menu_type = 'SINGLE'"
  ).get(BRAND, PRODUCT_SIMPLE);

  assert.ok(menu);
  assert.equal(Number(menu.selling_price), 28000);
  assert.equal(Number(menu.quantity), 1);

  const sub = db.prepare(
    'SELECT id, category_id, name FROM sub_categories WHERE id = ?'
  ).get(menu.sub_category_id);
  assert.equal(String(sub.category_id), CATEGORY);
  assert.equal(sub.name, 'Ayam CMM Simple');

  const rasa = db.prepare(
    'SELECT id, name FROM menu_flavors WHERE id = ?'
  ).get(menu.rasa_id);
  assert.equal(rasa.name, 'Original');

  const migration = db.prepare(
    'SELECT status, attempt_count FROM composed_menu_migrations WHERE product_id = ?'
  ).get(PRODUCT_SIMPLE);
  assert.equal(migration.status, 'migrated');
  assert.equal(Number(migration.attempt_count), 1);
});

test('migration respects Product reuse when another Menu already uses the same Product', () => {
  const otherSub = 'cmm_reuse_other_subcategory';
  const otherRasa = 'cmm_reuse_other_rasa';
  const otherMenu = 'cmm_reuse_other_menu';

  db.prepare(
    "INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, is_active) VALUES (?, ?, ?, 'Stock Existing Other Menu', 'stock-existing-other-menu', 1)"
  ).run(otherSub, BRAND, CATEGORY);
  db.prepare(
    "INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Lombok CMM Reuse', 'lombok-cmm-reuse', 1)"
  ).run(otherRasa, BRAND);
  db.prepare(
    "INSERT OR IGNORE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', ?, ?, 44000, 'ACTIVE')"
  ).run(otherMenu, BRAND, otherSub, otherRasa);
  db.prepare(
    "INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)"
  ).run(otherMenu, PRODUCT_STOCK);

  const plan = ComposedMenuMigrationService.reconcileProduct({
    brandId: BRAND,
    productId: PRODUCT_STOCK
  });

  assert.equal(plan.status, 'legacy');
  assert.equal(plan.existing_menu_id, null);
  assert.equal(plan.target_requires_owner_review, false);

  const result = ComposedMenuMigrationService.reconcileProduct({
    brandId: BRAND,
    productId: PRODUCT_STOCK,
    apply: true
  });
  assert.equal(result.status, 'migrated');

  const reused = db.prepare(
    'SELECT selling_price, status FROM menus WHERE id = ?'
  ).get(otherMenu);
  assert.equal(Number(reused.selling_price), 44000);
  assert.equal(reused.status, 'ACTIVE');

  const canonicalMenus = db.prepare(
    "SELECT m.id, m.selling_price FROM menus m JOIN menu_items mi ON mi.menu_id = m.id WHERE m.brand_id = ? AND m.menu_type = 'SINGLE' AND mi.product_id = ? AND mi.quantity = 1"
  ).all(BRAND, PRODUCT_STOCK);
  assert.equal(canonicalMenus.length, 2);
});

test('apply migrates legacy branch adoption, branch categories and stock into canonical boundaries', () => {
  db.prepare(
    "INSERT OR REPLACE INTO branch_products (branch_id, product_id, branch_category_id, price, stock, is_available, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(BRANCH, PRODUCT_STOCK, BRANCH_CATEGORY, 30500, 7, 1, 2);
  db.prepare(
    "INSERT OR IGNORE INTO branch_product_categories (branch_id, product_id, branch_category_id) VALUES (?, ?, ?)"
  ).run(BRANCH, PRODUCT_STOCK, BRANCH_CATEGORY);

  const result = ComposedMenuMigrationService.reconcileProduct({
    brandId: BRAND,
    productId: PRODUCT_STOCK,
    apply: true
  });

  assert.equal(result.status, 'migrated');
  assert.equal(result.applied, true);

  const product = db.prepare('SELECT sku FROM products WHERE id = ?').get(PRODUCT_STOCK);
  assert.equal(product.sku, generatedSku(BRAND, PRODUCT_STOCK));

  const menu = db.prepare(
    "SELECT m.id, m.sub_category_id, m.rasa_id FROM menus m JOIN menu_items mi ON mi.menu_id = m.id " +
    "WHERE m.id = ? AND m.brand_id = ? AND m.menu_type = 'SINGLE' AND mi.product_id = ?"
  ).get(result.menu_id, BRAND, PRODUCT_STOCK);
  assert.ok(menu);

  const branchMenu = db.prepare(
    'SELECT is_available, price_override FROM branch_menus WHERE branch_id = ? AND menu_id = ?'
  ).get(BRANCH, result.menu_id);
  assert.equal(Number(branchMenu.is_available), 1);
  assert.equal(Number(branchMenu.price_override), 30500);

  const branchCategory = db.prepare(
    'SELECT branch_category_id FROM branch_menu_categories WHERE branch_id = ? AND menu_id = ?'
  ).get(BRANCH, menu.id);
  assert.equal(branchCategory.branch_category_id, BRANCH_CATEGORY);

  const inventory = db.prepare(
    'SELECT stock_qty, low_stock_threshold FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?'
  ).get(BRANCH, PRODUCT_STOCK);
  assert.equal(Number(inventory.stock_qty), 7);
  assert.equal(Number(inventory.low_stock_threshold), 2);
});

test('migration is idempotent and verification is explicit', () => {
  const first = ComposedMenuMigrationService.reconcileProduct({
    brandId: BRAND,
    productId: PRODUCT_SIMPLE,
    apply: true
  });
  assert.equal(first.status, 'migrated');

  const firstCount = db.prepare(
    "SELECT COUNT(*) AS n FROM menu_items mi JOIN menus m ON m.id = mi.menu_id WHERE m.brand_id = ? AND mi.product_id = ? AND m.menu_type = 'SINGLE'"
  ).get(BRAND, PRODUCT_SIMPLE).n;

  const second = ComposedMenuMigrationService.reconcileProduct({
    brandId: BRAND,
    productId: PRODUCT_SIMPLE,
    apply: true
  });
  assert.equal(second.status, 'migrated');

  const secondCount = db.prepare(
    "SELECT COUNT(*) AS n FROM menu_items mi JOIN menus m ON m.id = mi.menu_id WHERE m.brand_id = ? AND mi.product_id = ? AND m.menu_type = 'SINGLE'"
  ).get(BRAND, PRODUCT_SIMPLE).n;
  assert.equal(Number(secondCount), Number(firstCount));

  const verified = ComposedMenuMigrationService.verifyProduct({
    brandId: BRAND,
    productId: PRODUCT_SIMPLE
  });
  assert.equal(verified.status, 'verified');
  assert.deepEqual(verified.errors, []);
});

test('legacy Complement data is not silently converted into Menu Paket', () => {
  db.prepare(
    "INSERT INTO product_complements (product_id, complement_id, sort_order) VALUES (?, ?, 0)"
  ).run(PRODUCT_COMPLEMENT, COMPLEMENT);

  const plan = ComposedMenuMigrationService.reconcileProduct({
    brandId: BRAND,
    productId: PRODUCT_COMPLEMENT
  });

  assert.equal(plan.status, 'needs_review');
  assert.ok(plan.issues.includes('LEGACY_COMPLEMENTS_REQUIRE_OWNER_REVIEW'));
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM menus WHERE brand_id = ? AND id LIKE ?").get(BRAND, '%').n >= 1,
    true
  );
  const migratedMenu = db.prepare(
    "SELECT COUNT(*) AS n FROM menus m JOIN menu_items mi ON mi.menu_id = m.id WHERE mi.product_id = ?"
  ).get(PRODUCT_COMPLEMENT);
  assert.equal(Number(migratedMenu.n), 0);
});

test('existing Menu Satuan identity conflict is surfaced before mutation', () => {
  const subId = 'cmm_existing_subcategory';
  const rasaId = 'cmm_existing_rasa';

  db.prepare(
    "INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, is_active) VALUES (?, ?, ?, 'Ayam CMM Duplicate', 'ayam-cmm-duplicate-sub', 1)"
  ).run(subId, BRAND, CATEGORY);
  db.prepare(
    "INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Original CMM Duplicate', 'original-cmm-duplicate', 1)"
  ).run(rasaId, BRAND);
  db.prepare(
    "INSERT OR IGNORE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES ('cmm_existing_menu', ?, 'SINGLE', ?, ?, 25000, 'ACTIVE')"
  ).run(BRAND, subId, rasaId);
  db.prepare(
    "INSERT OR IGNORE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES ('cmm_existing_menu', ?, 'SINGLE', ?, ?, 25000, 'ACTIVE')"
  ).run(BRAND, subId, rasaId);
  db.prepare(
    "INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES ('cmm_existing_menu', ?, 1, 0)"
  ).run(PRODUCT_SIMPLE);

  // Force the product to use the conflicting Rasa explicitly.
  db.prepare(
    "INSERT OR REPLACE INTO product_flavors (product_id, flavor_id) VALUES (?, ?)"
  ).run(PRODUCT_DUPLICATE, rasaId);

  const plan = ComposedMenuMigrationService.reconcileProduct({
    brandId: BRAND,
    productId: PRODUCT_DUPLICATE
  });

  assert.equal(plan.status, 'needs_review');
  assert.ok(plan.issues.includes('MENU_SATUAN_IDENTITY_CONFLICT'));
});

test.after(() => {
  db.prepare('DELETE FROM composed_menu_migrations WHERE brand_id = ?').run(BRAND);
  db.prepare('DELETE FROM branch_menu_categories WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_menus WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_product_inventory WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_product_categories WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_products WHERE branch_id = ?').run(BRANCH);
  db.prepare("DELETE FROM menu_items WHERE menu_id IN (SELECT id FROM menus WHERE brand_id = ?)").run(BRAND);
  db.prepare('DELETE FROM menus WHERE brand_id = ?').run(BRAND);
  db.prepare('DELETE FROM sub_categories WHERE brand_id = ?').run(BRAND);
  db.prepare('DELETE FROM product_flavors WHERE product_id IN (?, ?, ?, ?)').run(
    PRODUCT_SIMPLE, PRODUCT_STOCK, PRODUCT_COMPLEMENT, PRODUCT_DUPLICATE
  );
  db.prepare('DELETE FROM product_complements WHERE product_id IN (?, ?, ?, ?)').run(
    PRODUCT_SIMPLE, PRODUCT_STOCK, PRODUCT_COMPLEMENT, PRODUCT_DUPLICATE
  );
  db.prepare('DELETE FROM product_levels WHERE product_id IN (?, ?, ?, ?)').run(
    PRODUCT_SIMPLE, PRODUCT_STOCK, PRODUCT_COMPLEMENT, PRODUCT_DUPLICATE
  );
  db.prepare('DELETE FROM product_sku_history WHERE product_id IN (?, ?, ?, ?)').run(
    PRODUCT_SIMPLE, PRODUCT_STOCK, PRODUCT_COMPLEMENT, PRODUCT_DUPLICATE
  );
  db.prepare('DELETE FROM menu_flavors WHERE brand_id = ?').run(BRAND);
  db.prepare('DELETE FROM menu_complements WHERE id = ?').run(COMPLEMENT);
  db.prepare('DELETE FROM products WHERE id IN (?, ?, ?, ?)').run(
    PRODUCT_SIMPLE, PRODUCT_STOCK, PRODUCT_COMPLEMENT, PRODUCT_DUPLICATE
  );
  db.prepare('DELETE FROM branch_categories WHERE id = ?').run(BRANCH_CATEGORY);
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
  db.prepare('DELETE FROM categories WHERE id IN (?, ?)').run(CATEGORY, CATEGORY_OTHER);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
