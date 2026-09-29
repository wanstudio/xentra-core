'use strict';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db');
const MasterMenuCompositionService = require('../domains/catalog/services/MasterMenuCompositionService');

const ORG = 'mmc_service_org';
const BRAND_A = 'mmc_service_brand_a';
const BRAND_B = 'mmc_service_brand_b';
const CATEGORY_A = 'mmc_service_category_a';
const PRODUCT = 'mmc_service_product_a';
const FLAVOR = 'mmc_service_flavor_a';
const COMPLEMENT_1 = 'mmc_service_complement_1';
const COMPLEMENT_2 = 'mmc_service_complement_2';
const LEVEL = 'mmc_service_level_a';

test.before(() => {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'MMC Service Org', 'mmc-service-org')").run(ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'MMC Service Brand A', 'mmc-service-brand-a')").run(BRAND_A, ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'MMC Service Brand B', 'mmc-service-brand-b')").run(BRAND_B, ORG);
  db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Ayam', 'ayam', 1)").run(CATEGORY_A, BRAND_A);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, ?, ?, 'Ayam Test', 'ayam-test', 25000, 1)").run(PRODUCT, BRAND_A, CATEGORY_A);
  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Lombok Ijo', 'lombok-ijo', 1)").run(FLAVOR, BRAND_A);
  db.prepare("INSERT OR IGNORE INTO menu_complements (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Nasi', 'nasi', 1)").run(COMPLEMENT_1, BRAND_A);
  db.prepare("INSERT OR IGNORE INTO menu_complements (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Lalapan', 'lalapan', 1)").run(COMPLEMENT_2, BRAND_A);
  db.prepare("INSERT OR IGNORE INTO menu_levels (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Level 2', 'level-2', 1)").run(LEVEL, BRAND_A);
});

test('Master component create/list is Brand-scoped', () => {
  const created = MasterMenuCompositionService.createComponent({ brandId: BRAND_A, type: 'flavor', name: 'Manis Gurih' });
  assert.equal(created.brand_id, BRAND_A);
  const rows = MasterMenuCompositionService.listComponents({ brandId: BRAND_A, type: 'flavor', activeOnly: true });
  assert.ok(rows.some(row => row.id === created.id));
  db.prepare('DELETE FROM menu_flavors WHERE id = ?').run(created.id);
});

test('Master Product composition is saved as structured relations', () => {
  const composition = MasterMenuCompositionService.saveComposition({
    brandId: BRAND_A, productId: PRODUCT, categoryId: CATEGORY_A, flavorId: FLAVOR,
    complementIds: [COMPLEMENT_1, COMPLEMENT_2], levelId: LEVEL
  });
  assert.equal(composition.product_id, PRODUCT);
  assert.equal(composition.category.id, CATEGORY_A);
  assert.equal(composition.flavor.id, FLAVOR);
  assert.deepEqual(composition.complements.map(c => c.id), [COMPLEMENT_1, COMPLEMENT_2]);
  assert.equal(composition.level.id, LEVEL);
});

test('Inactive components cannot be selected into a new composition', () => {
  db.prepare('UPDATE menu_levels SET is_active = 0 WHERE id = ?').run(LEVEL);
  assert.throws(() => MasterMenuCompositionService.saveComposition({
    brandId: BRAND_A, productId: PRODUCT, categoryId: CATEGORY_A, levelId: LEVEL
  }), /MASTER_LEVEL_INACTIVE/);
  db.prepare('UPDATE menu_levels SET is_active = 1 WHERE id = ?').run(LEVEL);
});

test('Cross-brand component selection is rejected', () => {
  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, is_active) VALUES ('mmc_service_foreign_flavor', ?, 'Foreign', 'foreign', 1)").run(BRAND_B);
  assert.throws(() => MasterMenuCompositionService.saveComposition({
    brandId: BRAND_A, productId: PRODUCT, categoryId: CATEGORY_A, flavorId: 'mmc_service_foreign_flavor'
  }), /MASTER_FLAVOR_INVALID/);
});

test('Composition can omit optional Flavor, Complements, and Level', () => {
  const composition = MasterMenuCompositionService.saveComposition({
    brandId: BRAND_A, productId: PRODUCT, categoryId: CATEGORY_A, flavorId: null, complementIds: [], levelId: null
  });
  assert.equal(composition.flavor, null);
  assert.deepEqual(composition.complements, []);
  assert.equal(composition.level, null);
});

test.after(() => {
  db.prepare('DELETE FROM product_flavors WHERE product_id = ?').run(PRODUCT);
  db.prepare('DELETE FROM product_complements WHERE product_id = ?').run(PRODUCT);
  db.prepare('DELETE FROM product_levels WHERE product_id = ?').run(PRODUCT);
  db.prepare('DELETE FROM menu_levels WHERE id = ?').run(LEVEL);
  db.prepare('DELETE FROM menu_complements WHERE id IN (?, ?)').run(COMPLEMENT_1, COMPLEMENT_2);
  db.prepare('DELETE FROM menu_flavors WHERE id IN (?, ?)').run(FLAVOR, 'mmc_service_foreign_flavor');
  db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT);
  db.prepare('DELETE FROM categories WHERE id = ?').run(CATEGORY_A);
  db.prepare('DELETE FROM brands WHERE id IN (?, ?)').run(BRAND_A, BRAND_B);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
