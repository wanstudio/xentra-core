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
const COMPLEMENT = 'pmm_complement';
const AMBIGUOUS_FLAVOR = 'pmm_flavor_ambiguous';

test.before(() => {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'PMM Org', 'pmm-org')").run(ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'PMM Brand', 'pmm-brand')").run(BRAND, ORG);
  db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Ayam', 'ayam', 1)").run(CATEGORY, BRAND);
  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Lombok Ijo', 'lombok-ijo', 1)").run(FLAVOR, BRAND);
  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Pedas', 'pedas', 1)").run(AMBIGUOUS_FLAVOR, BRAND);
  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, is_active) VALUES ('pmm_flavor_ambiguous_2', ?, 'Gurih', 'gurih', 1)").run(BRAND);
  db.prepare("INSERT OR IGNORE INTO menu_complements (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Nasi', 'nasi', 1)").run(COMPLEMENT, BRAND);
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

test('deterministic legacy name mapping produces a migration candidate without mutating data in dry-run', () => {
  db.prepare('DELETE FROM product_flavors WHERE product_id = ?').run(PRODUCT_LEGACY);
  db.prepare('DELETE FROM product_complements WHERE product_id = ?').run(PRODUCT_LEGACY);
  db.prepare('DELETE FROM product_levels WHERE product_id = ?').run(PRODUCT_LEGACY);
  db.prepare("UPDATE products SET name = 'Ayam Lombok Ijo', menu_schema_version = 1, menu_migration_status = 'legacy' WHERE id = ?").run(PRODUCT_LEGACY);

  const plan = ProductMenuMigrationService.planProductMigration({
    brandId: BRAND,
    productId: PRODUCT_LEGACY
  });
  assert.equal(plan.status, 'candidate');
  assert.equal(plan.suggested_composition.category_id, CATEGORY);
  assert.equal(plan.suggested_composition.flavor_id, FLAVOR);
  assert.deepEqual(plan.suggested_composition.complement_ids, []);

  const state = db.prepare('SELECT menu_schema_version, menu_migration_status FROM products WHERE id = ?').get(PRODUCT_LEGACY);
  assert.deepEqual(state, { menu_schema_version: 1, menu_migration_status: 'legacy' });

  db.prepare("UPDATE products SET name = 'Ayam Lama', menu_schema_version = 1, menu_migration_status = 'legacy' WHERE id = ?").run(PRODUCT_LEGACY);
});

test('apply converts an unambiguous legacy Product through the canonical composition path', () => {
  db.prepare("UPDATE products SET name = 'Ayam Lombok Ijo Nasi', menu_schema_version = 1, menu_migration_status = 'legacy' WHERE id = ?").run(PRODUCT_LEGACY);

  const result = ProductMenuMigrationService.applyProductMigration({
    brandId: BRAND,
    productId: PRODUCT_LEGACY
  });

  assert.equal(result.applied, true);
  assert.equal(result.status, 'migrated');

  const composition = db.prepare(
    'SELECT flavor_id FROM product_flavors WHERE product_id = ?'
  ).get(PRODUCT_LEGACY);
  const complements = db.prepare(
    'SELECT complement_id FROM product_complements WHERE product_id = ? ORDER BY sort_order ASC'
  ).all(PRODUCT_LEGACY);

  assert.equal(composition.flavor_id, FLAVOR);
  assert.deepEqual(complements.map(row => row.complement_id), [COMPLEMENT]);

  const state = db.prepare(
    'SELECT menu_schema_version, menu_migration_status FROM products WHERE id = ?'
  ).get(PRODUCT_LEGACY);
  assert.deepEqual(state, { menu_schema_version: 2, menu_migration_status: 'migrated' });

  // Idempotent re-run must not create duplicate relations.
  const again = ProductMenuMigrationService.applyProductMigration({
    brandId: BRAND,
    productId: PRODUCT_LEGACY
  });
  assert.equal(again.applied, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_complements WHERE product_id = ?').get(PRODUCT_LEGACY).n, 1);
});

test('ambiguous single-valued component match is held for Owner review', () => {
  db.prepare('DELETE FROM product_flavors WHERE product_id = ?').run(PRODUCT_LEGACY);
  db.prepare('DELETE FROM product_complements WHERE product_id = ?').run(PRODUCT_LEGACY);
  db.prepare('DELETE FROM product_levels WHERE product_id = ?').run(PRODUCT_LEGACY);
  db.prepare("UPDATE products SET name = 'Ayam Pedas Gurih', menu_schema_version = 1, menu_migration_status = 'legacy' WHERE id = ?").run(PRODUCT_LEGACY);

  const plan = ProductMenuMigrationService.planProductMigration({
    brandId: BRAND,
    productId: PRODUCT_LEGACY
  });
  assert.equal(plan.status, 'needs_review');
  assert.ok(plan.errors.includes('AMBIGUOUS_FLAVOR_MATCH'));

  const state = db.prepare(
    'SELECT menu_schema_version, menu_migration_status FROM products WHERE id = ?'
  ).get(PRODUCT_LEGACY);
  assert.deepEqual(state, { menu_schema_version: 1, menu_migration_status: 'legacy' });

  db.prepare("UPDATE products SET name = 'Ayam Lama' WHERE id = ?").run(PRODUCT_LEGACY);
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
  db.prepare('DELETE FROM menu_flavors WHERE id IN (?, ?, ?)').run(FLAVOR, AMBIGUOUS_FLAVOR, 'pmm_flavor_ambiguous_2');
  db.prepare('DELETE FROM menu_complements WHERE id = ?').run(COMPLEMENT);
  db.prepare('DELETE FROM categories WHERE id = ?').run(CATEGORY);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
