'use strict';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const MasterMenuCompositionService = require('../../domains/catalog/services/MasterMenuCompositionService');
const { ProductMenuMigrationService } = require('../../domains/catalog/services/ProductMenuMigrationService');

const ORG = 'pmm_test_org';
const BRAND = 'pmm_test_brand';
const CATEGORY = 'pmm_test_category';
const PRODUCT_WITH_COMPOSITION = 'pmm_product_composed';
const PRODUCT_LEGACY = 'pmm_product_legacy';
const FLAVOR = 'pmm_flavor';

test.before(() => {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'PMM Org', 'pmm-org')").run(ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'PMM Brand', 'pmm-brand')").run(BRAND, ORG);
  db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Ayam', 'ayam', 1)").run(CATEGORY, BRAND);
  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Lombok Ijo', 'lombok-ijo', 1)").run(FLAVOR, BRAND);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active, menu_schema_version, menu_migration_status) VALUES (?, ?, ?, 'Ayam Lombok', 'ayam-lombok', 25000, 1, 1, 'legacy')").run(PRODUCT_WITH_COMPOSITION, BRAND, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active, menu_schema_version, menu_migration_status) VALUES (?, ?, ?, 'Ayam Lama', 'ayam-lama', 23000, 1, 1, 'legacy')").run(PRODUCT_LEGACY, BRAND, CATEGORY);
  db.prepare('DELETE FROM product_flavors WHERE product_id IN (?, ?)').run(PRODUCT_WITH_COMPOSITION, PRODUCT_LEGACY);
  db.prepare('DELETE FROM product_complements WHERE product_id IN (?, ?)').run(PRODUCT_WITH_COMPOSITION, PRODUCT_LEGACY);
  db.prepare('DELETE FROM product_levels WHERE product_id IN (?, ?)').run(PRODUCT_WITH_COMPOSITION, PRODUCT_LEGACY);
});

test('reconciliation recognizes an existing canonical structured Product', () => {
  MasterMenuCompositionService.saveComposition({
    brandId: BRAND,
    productId: PRODUCT_WITH_COMPOSITION,
    categoryId: CATEGORY,
    flavorId: FLAVOR,
    complementIds: [],
    levelId: null
  });

  const result = ProductMenuMigrationService.reconcileProduct({
    brandId: BRAND,
    productId: PRODUCT_WITH_COMPOSITION
  });
  assert.equal(result.status, 'migrated');
  assert.equal(result.schema_version, 2);

  const product = db.prepare(
    'SELECT menu_schema_version, menu_migration_status FROM products WHERE id = ?'
  ).get(PRODUCT_WITH_COMPOSITION);
  assert.deepEqual(product, { menu_schema_version: 2, menu_migration_status: 'migrated' });
});

test('ambiguous legacy Product is never guessed into structured relations', () => {
  const result = ProductMenuMigrationService.reconcileProduct({
    brandId: BRAND,
    productId: PRODUCT_LEGACY
  });
  assert.equal(result.status, 'needs_review');
  assert.ok(result.errors.includes('LEGACY_STRUCTURED_FIELDS_NOT_DETERMINISTIC'));

  const relations = {
    flavor: db.prepare('SELECT COUNT(*) AS n FROM product_flavors WHERE product_id = ?').get(PRODUCT_LEGACY).n,
    complement: db.prepare('SELECT COUNT(*) AS n FROM product_complements WHERE product_id = ?').get(PRODUCT_LEGACY).n,
    level: db.prepare('SELECT COUNT(*) AS n FROM product_levels WHERE product_id = ?').get(PRODUCT_LEGACY).n
  };
  assert.deepEqual(relations, { flavor: 0, complement: 0, level: 0 });
});

test('canonical Product save records migration state atomically and repeatably', () => {
  MasterMenuCompositionService.saveComposition({
    brandId: BRAND,
    productId: PRODUCT_LEGACY,
    categoryId: CATEGORY,
    flavorId: FLAVOR,
    complementIds: [],
    levelId: null
  });

  const first = db.prepare(
    'SELECT menu_schema_version, menu_migration_status FROM products WHERE id = ?'
  ).get(PRODUCT_LEGACY);
  assert.deepEqual(first, { menu_schema_version: 2, menu_migration_status: 'migrated' });

  const migration1 = db.prepare(
    'SELECT attempt_count FROM product_menu_migrations WHERE product_id = ?'
  ).get(PRODUCT_LEGACY);

  MasterMenuCompositionService.saveComposition({
    brandId: BRAND,
    productId: PRODUCT_LEGACY,
    categoryId: CATEGORY,
    flavorId: FLAVOR,
    complementIds: [],
    levelId: null
  });

  const migration2 = db.prepare(
    'SELECT attempt_count FROM product_menu_migrations WHERE product_id = ?'
  ).get(PRODUCT_LEGACY);
  assert.equal(migration2.attempt_count, migration1.attempt_count + 1);
});

test('verification cannot promote an unreconciled legacy Product', () => {
  const result = ProductMenuMigrationService.verifyProduct({
    brandId: BRAND,
    productId: PRODUCT_LEGACY
  });
  assert.equal(result.status, 'needs_review');
  assert.ok(result.errors.includes('MIGRATION_NOT_RECONCILED'));

  const product = db.prepare(
    'SELECT menu_schema_version, menu_migration_status FROM products WHERE id = ?'
  ).get(PRODUCT_LEGACY);
  assert.deepEqual(product, { menu_schema_version: 1, menu_migration_status: 'needs_review' });
});

test('verification marks a valid canonical Product as verified', () => {
  const result = ProductMenuMigrationService.verifyProduct({
    brandId: BRAND,
    productId: PRODUCT_WITH_COMPOSITION
  });
  assert.equal(result.status, 'verified');

  const product = db.prepare(
    'SELECT menu_schema_version, menu_migration_status FROM products WHERE id = ?'
  ).get(PRODUCT_WITH_COMPOSITION);
  assert.deepEqual(product, { menu_schema_version: 2, menu_migration_status: 'verified' });
});

test.after(() => {
  db.prepare('DELETE FROM product_menu_migrations WHERE product_id IN (?, ?)').run(PRODUCT_WITH_COMPOSITION, PRODUCT_LEGACY);
  db.prepare('DELETE FROM product_flavors WHERE product_id IN (?, ?)').run(PRODUCT_WITH_COMPOSITION, PRODUCT_LEGACY);
  db.prepare('DELETE FROM products WHERE id IN (?, ?)').run(PRODUCT_WITH_COMPOSITION, PRODUCT_LEGACY);
  db.prepare('DELETE FROM menu_flavors WHERE id = ?').run(FLAVOR);
  db.prepare('DELETE FROM categories WHERE id = ?').run(CATEGORY);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
