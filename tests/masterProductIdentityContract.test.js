'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const ownerHtml = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/index.html'), 'utf8');
const ownerJs = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');
const adminCatalog = fs.readFileSync(path.join(ROOT, 'server/routes/admin-catalog.js'), 'utf8');
const composedMenuRoute = fs.readFileSync(path.join(ROOT, 'server/routes/admin-composed-menu.js'), 'utf8');
const composedMenuResolver = fs.readFileSync(path.join(ROOT, 'domains/catalog/services/ComposedMenuResolver.js'), 'utf8');
const contract = fs.readFileSync(path.join(ROOT, 'docs/proposals/xentra-taxonomy-composed-menu-v1.md'), 'utf8');

test('Product contract separates atomic Product ownership from commercial Menu ownership', () => {
  const start = ownerHtml.indexOf('<section id="tab-catalog-products"');
  const end = ownerHtml.indexOf('<!-- TAB: CATALOG / MASTER MENUS', start);
  const section = ownerHtml.slice(start, end);

  assert.ok(section.includes('id="prod-name"'));
  assert.ok(section.includes('id="prod-sku"'));
  assert.ok(section.includes('id="prod-desc"'));
  assert.ok(section.includes('id="prod-is-active"'));

  for (const forbidden of [
    'id="prod-category"',
    'id="prod-flavor"',
    'id="prod-complements-editor"',
    'id="prod-level-chips"',
    'id="prod-price"',
    'id="prod-regular-price"',
    'id="prod-pricing-mode"',
    'id="prod-min-price"',
    'id="prod-max-price"',
    'id="prod-options-editor"',
    'id="master-menu-customer-preview"',
    'Preview Customer PWA'
  ]) {
    assert.ok(!section.includes(forbidden), 'Product UI still owns commercial/Menu field: ' + forbidden);
  }

  assert.ok(ownerJs.includes("sku: sku || null"));
  assert.ok(ownerJs.includes("is_active: $('prod-is-active').checked ? 1 : 0"));
  assert.ok(ownerJs.includes("API_BASE + '/admin/composed/products'"));
  assert.ok(!ownerJs.includes("saveMasterMenuComposition(savedId)"));
});

test('Product Editor loader hydrates only atomic Product data', () => {
  const start = ownerJs.indexOf('async function loadProductEditorPage(productId)');
  const end = ownerJs.indexOf("window.openAddProduct = function ()", start);
  assert.ok(start >= 0 && end > start);
  const loader = ownerJs.slice(start, end);

  assert.ok(loader.includes('showProductEditorSection();'));
  assert.ok(loader.includes('resetProductEditorForAdd();'));
  // Contract composed hanya punya LIST (GET /admin/composed/products).
  // Tidak ada GET by-id, jadi loader mengambil Product dari list canonical —
  // bukan /admin/composed/products/:id (pernah 404) atau legacy /admin/products/:id.
  assert.ok(loader.includes("API_BASE + '/admin/composed/products?active_only=0'"));
  assert.ok(!/composed\/products\/'\s*\+\s*encodeURIComponent\(productId\)/.test(loader));
  assert.ok(!loader.includes("'/admin/products/'"));
  assert.ok(!loader.includes('loadMasterMenuComponents()'));
  assert.ok(!loader.includes('loadMasterMenuComposition('));
  assert.ok(!loader.includes('loadProductOptionsEditor('));
});

test('Product list displays atomic identity fields instead of commercial pricing', () => {
  const sectionStart = ownerJs.indexOf('function getFilteredMasterProducts()');
  const sectionEnd = ownerJs.indexOf('// PRODUCT DETAIL VIEW', sectionStart);
  const renderer = ownerJs.slice(sectionStart, sectionEnd);

  assert.ok(renderer.includes('String(p.sku || \'\')'));
  assert.ok(renderer.includes('Belum ada SKU'));
  assert.ok(renderer.includes('Product aktif'));
  assert.ok(!renderer.includes('prod.price'));
  assert.ok(!renderer.includes('regular_price'));
  assert.ok(!renderer.includes('pricing_mode'));
  assert.ok(!renderer.includes('category_id'));
});

test('Product API accepts atomic creation without commercial category/price', () => {
  const postStart = adminCatalog.indexOf("router.post('/admin/products'");
  const postEnd = adminCatalog.indexOf("router.put('/admin/products/:id'", postStart);
  const post = adminCatalog.slice(postStart, postEnd);

  assert.ok(post.includes('if (!normalizedName)'));
  assert.ok(!post.includes('if (!category_id)'));
  assert.ok(!post.includes('price === undefined || price === null || price === \'\''));
  assert.ok(post.includes('compatibilityPrice'));
  assert.ok(post.includes('compatibilityRegularPrice'));
  assert.ok(post.includes('sku'));
  assert.ok(post.includes('INSERT INTO products'));
});

test('Product API preserves legacy fields only as compatibility fields', () => {
  assert.ok(contract.includes('selling price/category'));
  assert.ok(contract.includes('Product does **not** own the canonical selling price'));
  assert.ok(composedMenuResolver.includes('selling_price'));
  assert.ok(!composedMenuResolver.includes('product.price'));
  assert.ok(composedMenuRoute.includes("router.post('/admin/menus/single'"));
  assert.ok(composedMenuRoute.includes("router.post('/admin/menus/package'"));
});

test('Product SKU is brand-scoped and cannot silently collide', () => {
  assert.ok(adminCatalog.includes('PRODUCT_SKU_ALREADY_EXISTS'));
  assert.ok(ownerJs.includes('sku: sku || null'));
  assert.ok(ownerHtml.includes('SKU unik dalam Brand'));
  assert.ok(fs.readFileSync(path.join(ROOT, 'domains/catalog/schema/ComposedMenuSchema.js'), 'utf8').includes('idx_products_brand_sku_normalized'));
});

test('Customer-facing taxonomy and price stay in canonical Menu workspace', () => {
  const start = ownerJs.indexOf('var _ownerMasterMenuState = {');
  assert.ok(start >= 0);
  const controller = ownerJs.slice(start);

  assert.ok(controller.includes("API_BASE + '/admin/menus/single'"));
  assert.ok(controller.includes("API_BASE + '/admin/menus/package'"));
  assert.ok(controller.includes("API_BASE + '/admin/menus/' + encodeURIComponent(menuId) + '/single'"));
  assert.ok(controller.includes("API_BASE + '/admin/menus/' + encodeURIComponent(menuId) + '/package'"));
  assert.ok(controller.includes('sub_category_id: subCategoryId'));
  assert.ok(controller.includes('rasa_id: rasaId'));
  assert.ok(controller.includes('level_id: levelId'));
  assert.ok(controller.includes('selling_price: price'));
  assert.ok(controller.includes('payload.package_name = packageName'));
  assert.ok(controller.includes('payload.components = components'));
});

test('Canonical Menu resolver owns Customer title/subtitle semantics', () => {
  assert.ok(composedMenuResolver.includes('function resolveCustomerTitle(menu)'));
  assert.ok(composedMenuResolver.includes("menu.menu_type === 'PACKAGE'"));
  assert.ok(composedMenuResolver.includes('(menu.sub_category_name || \'\')'));
  assert.ok(composedMenuResolver.includes('!rasaIsOriginal ? menu.rasa_name : null'));
  assert.ok(composedMenuResolver.includes('price: Number(menu.selling_price)'));
});
