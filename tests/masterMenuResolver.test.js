'use strict';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db');
const MasterMenuResolver = require('../domains/catalog/services/MasterMenuResolver');

const ORG = 'mmc_resolver_org';
const BRAND = 'mmc_resolver_brand';
const BRANCH = 'mmc_resolver_branch';
const CATEGORY = 'mmc_resolver_cat';
const BCAT = 'mmc_resolver_bcat';
const PRODUCT = 'mmc_resolver_product';
const FLAVOR = 'mmc_resolver_flavor';
const COMPLEMENT_1 = 'mmc_resolver_cmp1';
const COMPLEMENT_2 = 'mmc_resolver_cmp2';
const LEVEL = 'mmc_resolver_level';

test.before(() => {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'MMC Resolver Org', 'mmc-resolver-org')").run(ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'MMC Resolver Brand', 'mmc-resolver-brand')").run(BRAND, ORG);
  db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, 'Resolver Branch', 'resolver-branch', 'Jl. Test', -5.4, 105.2, 1)").run(BRANCH, BRAND);
  db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Ayam Tulang Lunak', 'ayam-tulang-lunak', 1)").run(CATEGORY, BRAND);
  db.prepare("INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order) VALUES (?, ?, ?, 'Menu Favorit', 'menu-favorit', 1)").run(BCAT, BRAND, BRANCH);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, image_url, is_active) VALUES (?, ?, ?, 'Master Internal Name', 'master-internal-name', 'Desc', 28000, 30000, 'ayam.png', 1)").run(PRODUCT, BRAND, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Lombok Ijo', 'lombok-ijo-resolver', 1)").run(FLAVOR, BRAND);
  db.prepare("INSERT OR IGNORE INTO menu_complements (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Nasi', 'nasi-resolver', 1)").run(COMPLEMENT_1, BRAND);
  db.prepare("INSERT OR IGNORE INTO menu_complements (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Lalapan', 'lalapan-resolver', 1)").run(COMPLEMENT_2, BRAND);
  db.prepare("INSERT OR IGNORE INTO menu_levels (id, brand_id, name, slug, sort_order, is_active) VALUES (?, ?, 'Level 3', 'level-3-resolver', 3, 1)").run(LEVEL, BRAND);
  db.prepare("INSERT OR IGNORE INTO branch_products (branch_id, product_id, stock, is_available) VALUES (?, ?, NULL, 1)").run(BRANCH, PRODUCT);
  db.prepare("INSERT OR IGNORE INTO branch_product_categories (branch_id, product_id, branch_category_id) VALUES (?, ?, ?)").run(BRANCH, PRODUCT, BCAT);
  db.prepare("INSERT OR IGNORE INTO product_flavors (product_id, flavor_id) VALUES (?, ?)").run(PRODUCT, FLAVOR);
  db.prepare("INSERT OR IGNORE INTO product_complements (product_id, complement_id, sort_order) VALUES (?, ?, 0)").run(PRODUCT, COMPLEMENT_1);
  db.prepare("INSERT OR IGNORE INTO product_complements (product_id, complement_id, sort_order) VALUES (?, ?, 1)").run(PRODUCT, COMPLEMENT_2);
  db.prepare("INSERT OR IGNORE INTO product_levels (product_id, level_id) VALUES (?, ?)").run(PRODUCT, LEVEL);
});

test('Master resolver maps structured composition to Customer view fields', () => {
  const rows = MasterMenuResolver.resolveMasterProducts({ brandId: BRAND, productIds: [PRODUCT] });
  assert.equal(rows.length, 1);
  const p = rows[0];
  assert.equal(p.product_id, PRODUCT);
  assert.equal(p.title, 'Ayam Tulang Lunak');
  assert.equal(p.subtitle, 'Lombok Ijo');
  assert.deepEqual(p.detail, ['Nasi', 'Lalapan']);
  assert.equal(p.indicator, 'Level 3');
  assert.equal(p.indicator_level, 3);
  assert.equal(p.image, 'ayam.png');
  assert.equal(p.price, 28000);
  assert.equal(p.master.name, 'Master Internal Name');
});

test('Branch resolver contains adopted Product and Branch Category but no legacy override fields', () => {
  const menu = MasterMenuResolver.resolveBranchMenu({ brandId: BRAND, branchId: BRANCH });
  assert.equal(menu.products.length, 1);
  const p = menu.products[0];
  assert.equal(p.product_id, PRODUCT);
  assert.deepEqual(p.categories.map(c => c.name), ['Menu Favorit']);
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'name_override'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'description_override'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'image_override'), false);
});

test('Branch display-name override is optional and only changes Customer title', () => {
  db.prepare('UPDATE branch_products SET name_override = NULL WHERE branch_id = ? AND product_id = ?').run(BRANCH, PRODUCT);

  const fallback = MasterMenuResolver.resolveBranchMenu({
    brandId: BRAND,
    branchId: BRANCH,
    exposeBranchPresentationOverrides: true
  }).products[0];
  assert.equal(fallback.title, 'Ayam Tulang Lunak');
  assert.equal(fallback.subtitle, 'Lombok Ijo');
  assert.equal(fallback.display_name_override, null);

  db.prepare('UPDATE branch_products SET name_override = ? WHERE branch_id = ? AND product_id = ?')
    .run('Es Teh Jumbo', BRANCH, PRODUCT);

  const overridden = MasterMenuResolver.resolveBranchMenu({
    brandId: BRAND,
    branchId: BRANCH,
    exposeBranchPresentationOverrides: true
  }).products[0];
  assert.equal(overridden.title, 'Es Teh Jumbo');
  assert.equal(overridden.subtitle, null);
  assert.equal(overridden.display_name_override, 'Es Teh Jumbo');

  const customerScoped = MasterMenuResolver.resolveBranchMenu({
    brandId: BRAND,
    branchId: BRANCH
  }).products[0];
  assert.equal(Object.prototype.hasOwnProperty.call(customerScoped, 'display_name_override'), false);

  db.prepare('UPDATE branch_products SET name_override = NULL WHERE branch_id = ? AND product_id = ?')
    .run(BRANCH, PRODUCT);
});

test('Resolver derives Level intensity from historical Level name when sort order is absent', () => {
  db.prepare("UPDATE menu_levels SET sort_order = NULL WHERE id = ?").run(LEVEL);
  const rows = MasterMenuResolver.resolveMasterProducts({ brandId: BRAND, productIds: [PRODUCT] });
  assert.equal(rows[0].indicator, 'Level 3');
  assert.equal(rows[0].indicator_level, 3);
  db.prepare("UPDATE menu_levels SET sort_order = 3 WHERE id = ?").run(LEVEL);
});

test('Inactive referenced Master component remains visible on existing Product', () => {
  db.prepare('UPDATE menu_flavors SET is_active = 0 WHERE id = ?').run(FLAVOR);
  const rows = MasterMenuResolver.resolveMasterProducts({ brandId: BRAND, productIds: [PRODUCT] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subtitle, 'Lombok Ijo');
  db.prepare('UPDATE menu_flavors SET is_active = 1 WHERE id = ?').run(FLAVOR);
});

test('Inactive Master Product is not returned by strict forward resolver', () => {
  db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(PRODUCT);
  const menu = MasterMenuResolver.resolveBranchMenu({ brandId: BRAND, branchId: BRANCH });
  assert.equal(menu.products.length, 0);
  db.prepare('UPDATE products SET is_active = 1 WHERE id = ?').run(PRODUCT);
});

test.after(() => {
  db.prepare('DELETE FROM product_flavors WHERE product_id = ?').run(PRODUCT);
  db.prepare('DELETE FROM product_complements WHERE product_id = ?').run(PRODUCT);
  db.prepare('DELETE FROM product_levels WHERE product_id = ?').run(PRODUCT);
  db.prepare('DELETE FROM branch_product_categories WHERE branch_id = ? AND product_id = ?').run(BRANCH, PRODUCT);
  db.prepare('DELETE FROM branch_products WHERE branch_id = ? AND product_id = ?').run(BRANCH, PRODUCT);
  db.prepare('DELETE FROM menu_levels WHERE id = ?').run(LEVEL);
  db.prepare('DELETE FROM menu_complements WHERE id IN (?, ?)').run(COMPLEMENT_1, COMPLEMENT_2);
  db.prepare('DELETE FROM menu_flavors WHERE id = ?').run(FLAVOR);
  db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT);
  db.prepare('DELETE FROM branch_categories WHERE id = ?').run(BCAT);
  db.prepare('DELETE FROM categories WHERE id = ?').run(CATEGORY);
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
