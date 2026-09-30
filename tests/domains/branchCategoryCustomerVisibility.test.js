'use strict';

/**
 * REGRESSION TESTS — BRANCH CATEGORY ACTIVE STATE & CUSTOMER VISIBILITY
 *
 * Contract: docs/decisions/branch-category-active-state-customer-visibility-v1.md
 *
 * A deactivated Branch Category must disappear from the resolved Customer Menu, together with the
 * products grouped ONLY under deactivated categories. Management surfaces (Merchant App menu) keep
 * seeing everything, otherwise a deactivated category could never be reactivated.
 */

const test = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const MasterMenuResolver = require('../../domains/catalog/services/MasterMenuResolver');

const ORG = 'bcvis_org';
const BRAND = 'bcvis_brand';
const BRANCH = 'bcvis_branch';
const MASTER_CAT = 'bcvis_master_cat';

const CAT_ACTIVE = 'bcvis_cat_active';
const CAT_INACTIVE = 'bcvis_cat_inactive';
const CAT_LEGACY = 'bcvis_cat_legacy';

const PRODUCT_ACTIVE_ONLY = 'bcvis_p_active_only';
const PRODUCT_INACTIVE_ONLY = 'bcvis_p_inactive_only';
const PRODUCT_BOTH = 'bcvis_p_both';
const PRODUCT_UNCATEGORISED = 'bcvis_p_uncategorised';

function seedProduct(id, name) {
  db.prepare(
    `INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, image_url, is_active)
     VALUES (?, ?, ?, ?, ?, 'Desc', 15000, 15000, 'x.png', 1)`
  ).run(id, BRAND, MASTER_CAT, name, id);
  db.prepare(
    'INSERT OR IGNORE INTO branch_products (branch_id, product_id, stock, is_available) VALUES (?, ?, NULL, 1)'
  ).run(BRANCH, id);
}

function link(productId, categoryId) {
  db.prepare(
    'INSERT OR IGNORE INTO branch_product_categories (branch_id, product_id, branch_category_id) VALUES (?, ?, ?)'
  ).run(BRANCH, productId, categoryId);
}

test.before(() => {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'BC Visibility Org', 'bc-visibility-org')").run(ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'BC Visibility Brand', 'bc-visibility-brand')").run(BRAND, ORG);
  db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES (?, ?, 'BC Visibility Branch', 'bc-visibility-branch', 'Jl. Test', -5.4, 105.2, 1)").run(BRANCH, BRAND);
  db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Kategori Master', 'kategori-master-bcvis', 1)").run(MASTER_CAT, BRAND);

  db.prepare("INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'Menu Favorit', 'bcvis-favorit', 1, 1)").run(CAT_ACTIVE, BRAND, BRANCH);
  db.prepare("INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'Promo Lama', 'bcvis-promo-lama', 2, 1)").run(CAT_INACTIVE, BRAND, BRANCH);
  db.prepare("INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'Kategori Lama', 'bcvis-kategori-lama', 3, 1)").run(CAT_LEGACY, BRAND, BRANCH);

  seedProduct(PRODUCT_ACTIVE_ONLY, 'Hanya di kategori aktif');
  seedProduct(PRODUCT_INACTIVE_ONLY, 'Hanya di kategori nonaktif');
  seedProduct(PRODUCT_BOTH, 'Ada di dua kategori');
  seedProduct(PRODUCT_UNCATEGORISED, 'Tanpa kategori');

  link(PRODUCT_ACTIVE_ONLY, CAT_ACTIVE);
  link(PRODUCT_INACTIVE_ONLY, CAT_INACTIVE);
  link(PRODUCT_BOTH, CAT_ACTIVE);
  link(PRODUCT_BOTH, CAT_INACTIVE);
});

test('active Branch Category is returned with its products', () => {
  const menu = MasterMenuResolver.resolveBranchMenu({ brandId: BRAND, branchId: BRANCH });
  const categoryIds = menu.categories.map((c) => c.id);
  assert.ok(categoryIds.includes(CAT_ACTIVE), 'active category must be listed');
  const productIds = menu.products.map((p) => p.product_id);
  assert.ok(productIds.includes(PRODUCT_ACTIVE_ONLY));
});

test('deactivated Branch Category disappears from the Customer Menu', () => {
  db.prepare('UPDATE branch_categories SET is_active = 0 WHERE id = ?').run(CAT_INACTIVE);
  try {
    const menu = MasterMenuResolver.resolveBranchMenu({ brandId: BRAND, branchId: BRANCH });
    const categoryIds = menu.categories.map((c) => c.id);
    assert.equal(categoryIds.includes(CAT_INACTIVE), false, 'deactivated category must not be listed');
  } finally {
    db.prepare('UPDATE branch_categories SET is_active = 1 WHERE id = ?').run(CAT_INACTIVE);
  }
});

test('product grouped only under a deactivated category is not shown', () => {
  db.prepare('UPDATE branch_categories SET is_active = 0 WHERE id = ?').run(CAT_INACTIVE);
  try {
    const menu = MasterMenuResolver.resolveBranchMenu({ brandId: BRAND, branchId: BRANCH });
    const productIds = menu.products.map((p) => p.product_id);
    assert.equal(productIds.includes(PRODUCT_INACTIVE_ONLY), false, 'product of a deactivated category must be hidden');
  } finally {
    db.prepare('UPDATE branch_categories SET is_active = 1 WHERE id = ?').run(CAT_INACTIVE);
  }
});

test('product also grouped under an active category is still shown', () => {
  db.prepare('UPDATE branch_categories SET is_active = 0 WHERE id = ?').run(CAT_INACTIVE);
  try {
    const menu = MasterMenuResolver.resolveBranchMenu({ brandId: BRAND, branchId: BRANCH });
    const productIds = menu.products.map((p) => p.product_id);
    assert.ok(productIds.includes(PRODUCT_BOTH), 'one active category is enough to stay visible');
    const both = menu.products.find((p) => p.product_id === PRODUCT_BOTH);
    assert.equal(both.categories.some((c) => c.id === CAT_INACTIVE), false, 'the deactivated category must not be exposed on the product');
  } finally {
    db.prepare('UPDATE branch_categories SET is_active = 1 WHERE id = ?').run(CAT_INACTIVE);
  }
});

test('uncategorised product is still shown — absence of a category is not deactivation', () => {
  const menu = MasterMenuResolver.resolveBranchMenu({ brandId: BRAND, branchId: BRANCH });
  const productIds = menu.products.map((p) => p.product_id);
  assert.ok(productIds.includes(PRODUCT_UNCATEGORISED));
});

test('rows predating the column (is_active NULL) are treated as active', () => {
  db.prepare('UPDATE branch_categories SET is_active = NULL WHERE id = ?').run(CAT_LEGACY);
  try {
    const menu = MasterMenuResolver.resolveBranchMenu({ brandId: BRAND, branchId: BRANCH });
    const legacy = menu.categories.find((c) => c.id === CAT_LEGACY);
    assert.ok(legacy, 'legacy row must still be listed');
    assert.equal(legacy.is_active, 1, 'NULL must resolve to active');
  } finally {
    db.prepare('UPDATE branch_categories SET is_active = 1 WHERE id = ?').run(CAT_LEGACY);
  }
});

test('management resolution keeps seeing the deactivated category so it can be reactivated', () => {
  db.prepare('UPDATE branch_categories SET is_active = 0 WHERE id = ?').run(CAT_INACTIVE);
  try {
    const menu = MasterMenuResolver.resolveBranchMenu({ brandId: BRAND, branchId: BRANCH, includeInactiveCategories: true });
    const inactive = menu.categories.find((c) => c.id === CAT_INACTIVE);
    assert.ok(inactive, 'Merchant App must still list the deactivated category');
    assert.equal(inactive.is_active, 0, 'and must be told that it is inactive');
  } finally {
    db.prepare('UPDATE branch_categories SET is_active = 1 WHERE id = ?').run(CAT_INACTIVE);
  }
});

test.after(() => {
  db.prepare('DELETE FROM branch_product_categories WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_products WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_categories WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM products WHERE brand_id = ?').run(BRAND);
  db.prepare('DELETE FROM categories WHERE id = ?').run(MASTER_CAT);
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
