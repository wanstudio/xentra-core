'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const ComposedMenuService = require('../../domains/catalog/services/ComposedMenuService');
const ComposedMenuResolver = require('../../domains/catalog/services/ComposedMenuResolver');
const ComposedProductService = require('../../domains/catalog/services/ComposedProductService');

const ORG = 'cost_vocab_v11_org';
const BRAND = 'cost_vocab_v11_brand';
const CATEGORY = 'cost_vocab_v11_category';
const TITLE = 'cost_vocab_v11_title';
const PRODUCT = 'cost_vocab_v11_product';
const MENU = 'cost_vocab_v11_menu';

test.before(async () => {
  await db.ready;

  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(
    ORG, 'Cost Vocabulary v1.1 Org', 'cost-vocab-v11-org'
  );

  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(
    BRAND, ORG, 'Cost Vocabulary v1.1 Brand', 'cost-vocab-v11-brand'
  );

  db.prepare('INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, ?, ?, 1)').run(
    CATEGORY, BRAND, 'Cost Vocabulary Category', 'cost-vocab-category'
  );

  db.prepare('INSERT OR IGNORE INTO menu_titles (id, brand_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, ?, 0, 1)').run(
    TITLE, BRAND, 'Cost Vocabulary Menu', 'cost-vocabulary-menu'
  );

  db.prepare('INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active, sku, cost_price) VALUES (?, ?, ?, ?, ?, 0, 1, ?, 99999)').run(
    PRODUCT, BRAND, CATEGORY, 'Cost Vocabulary Product', 'cost-vocabulary-product', 'CV11-001'
  );
});

test('Menu resolver does not expose legacy cost_price as Menu cost authority', () => {
  try {
    const menu = ComposedMenuService.createMenu({
      brandId: BRAND,
      categoryId: CATEGORY,
      titleId: TITLE,
      sellingPrice: 25000,
      status: 'ACTIVE',
      components: [{ product_id: PRODUCT, quantity: 1 }]
    });

    db.prepare('UPDATE menus SET cost_price = 12345 WHERE id = ?').run(menu.id);

    const resolved = ComposedMenuResolver.resolveMenu({
      brandId: BRAND,
      menuId: menu.id
    });

    assert.equal(Object.prototype.hasOwnProperty.call(resolved, 'cost_price'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(resolved, 'hpp'), false);
    assert.equal(resolved.price, 25000);
    assert.equal(resolved.components[0].product_id, PRODUCT);

    db.prepare('DELETE FROM menu_items WHERE menu_id = ?').run(menu.id);
    db.prepare('DELETE FROM menus WHERE id = ?').run(menu.id);
  } finally {
    db.prepare('DELETE FROM menu_items WHERE menu_id = ?').run(MENU);
    db.prepare('DELETE FROM menus WHERE id = ?').run(MENU);
  }
});

test('Product canonical API does not expose legacy cost_price as Product cost authority', () => {
  const product = ComposedProductService.findProduct({
    brandId: BRAND,
    productId: PRODUCT
  });

  assert.equal(Object.prototype.hasOwnProperty.call(product, 'cost_price'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(product, 'hpp'), false);
  assert.equal(product.sku, 'CV11-001');
});

test.after(() => {
  db.prepare('DELETE FROM menu_items WHERE menu_id = ?').run(MENU);
  db.prepare('DELETE FROM menus WHERE id = ?').run(MENU);
  db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT);
  db.prepare('DELETE FROM menu_titles WHERE id = ?').run(TITLE);
  db.prepare('DELETE FROM categories WHERE id = ?').run(CATEGORY);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
