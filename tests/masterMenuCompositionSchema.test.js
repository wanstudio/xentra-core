'use strict';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db');

const ORG = 'mmc_schema_org';
const BRAND_A = 'mmc_schema_brand_a';
const BRAND_B = 'mmc_schema_brand_b';
const CATEGORY = 'mmc_schema_cat_a';
const PRODUCT = 'mmc_schema_product_a';
const FLAVOR_A = 'mmc_schema_flavor_a';
const FLAVOR_B = 'mmc_schema_flavor_b';
const COMPLEMENT = 'mmc_schema_complement_a';
const LEVEL_A = 'mmc_schema_level_a';
const LEVEL_B = 'mmc_schema_level_b';

test.before(() => {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'MMC Schema Org', 'mmc-schema-org')").run(ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'MMC Brand A', 'mmc-brand-a')").run(BRAND_A, ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'MMC Brand B', 'mmc-brand-b')").run(BRAND_B, ORG);
  db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES (?, ?, 'MMC Category', 'mmc-category')").run(CATEGORY, BRAND_A);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, ?, ?, 'MMC Product', 'mmc-product', 10000, 1)").run(PRODUCT, BRAND_A, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug) VALUES (?, ?, 'Pedas', 'pedas')").run(FLAVOR_A, BRAND_A);
  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug) VALUES (?, ?, 'Manis', 'manis')").run(FLAVOR_B, BRAND_B);
  db.prepare("INSERT OR IGNORE INTO menu_complements (id, brand_id, name, slug) VALUES (?, ?, 'Nasi', 'nasi')").run(COMPLEMENT, BRAND_A);
  db.prepare("INSERT OR IGNORE INTO menu_levels (id, brand_id, name, slug) VALUES (?, ?, 'Level 1', 'level-1')").run(LEVEL_A, BRAND_A);
  db.prepare("INSERT OR IGNORE INTO menu_levels (id, brand_id, name, slug) VALUES (?, ?, 'Level 2', 'level-2')").run(LEVEL_B, BRAND_A);
});

test('master menu composition tables exist', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('menu_flavors','menu_complements','menu_levels','product_flavors','product_complements','product_levels') ORDER BY name").all().map(r => r.name);
  assert.deepEqual(tables, ['menu_complements','menu_flavors','menu_levels','product_complements','product_flavors','product_levels']);
});

test('one Flavor per Product is enforced', () => {
  db.prepare('DELETE FROM product_flavors WHERE product_id = ?').run(PRODUCT);
  db.prepare('INSERT INTO product_flavors (product_id, flavor_id) VALUES (?, ?)').run(PRODUCT, FLAVOR_A);
  assert.throws(() => db.prepare('INSERT INTO product_flavors (product_id, flavor_id) VALUES (?, ?)').run(PRODUCT, FLAVOR_B), /PRODUCT_FLAVOR_BRAND_MISMATCH/);
  assert.throws(() => db.prepare('INSERT INTO product_flavors (product_id, flavor_id) VALUES (?, ?)').run(PRODUCT, FLAVOR_A), /UNIQUE/);
});

test('one Level per Product is enforced', () => {
  db.prepare('DELETE FROM product_levels WHERE product_id = ?').run(PRODUCT);
  db.prepare('INSERT INTO product_levels (product_id, level_id) VALUES (?, ?)').run(PRODUCT, LEVEL_A);
  assert.throws(() => db.prepare('INSERT INTO product_levels (product_id, level_id) VALUES (?, ?)').run(PRODUCT, LEVEL_B));
});

test('Complement relations preserve explicit display order', () => {
  db.prepare('DELETE FROM product_complements WHERE product_id = ?').run(PRODUCT);
  db.prepare('INSERT INTO product_complements (product_id, complement_id, sort_order) VALUES (?, ?, ?)').run(PRODUCT, COMPLEMENT, 2);
  const row = db.prepare('SELECT sort_order FROM product_complements WHERE product_id = ? AND complement_id = ?').get(PRODUCT, COMPLEMENT);
  assert.equal(row.sort_order, 2);
});

test('Product/component cross-brand relations are rejected', () => {
  assert.throws(() => db.prepare('INSERT INTO product_flavors (product_id, flavor_id) VALUES (?, ?)').run(PRODUCT, FLAVOR_B), /PRODUCT_FLAVOR_BRAND_MISMATCH/);
});

test('order_items receives nullable menu_snapshot column', () => {
  const cols = db.prepare('PRAGMA table_info(order_items)').all().map(r => r.name);
  assert.ok(cols.includes('menu_snapshot'));
});

test.after(() => {
  db.prepare('DELETE FROM product_flavors WHERE product_id = ?').run(PRODUCT);
  db.prepare('DELETE FROM product_complements WHERE product_id = ?').run(PRODUCT);
  db.prepare('DELETE FROM product_levels WHERE product_id = ?').run(PRODUCT);
  db.prepare('DELETE FROM menu_levels WHERE id IN (?, ?)').run(LEVEL_A, LEVEL_B);
  db.prepare('DELETE FROM menu_complements WHERE id = ?').run(COMPLEMENT);
  db.prepare('DELETE FROM menu_flavors WHERE id IN (?, ?)').run(FLAVOR_A, FLAVOR_B);
  db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT);
  db.prepare('DELETE FROM categories WHERE id = ?').run(CATEGORY);
  db.prepare('DELETE FROM brands WHERE id IN (?, ?)').run(BRAND_A, BRAND_B);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
