const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/index.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/js/menu-first-ui.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/css/menu-first.css'), 'utf8');

test('Menu-first Owner UI assets are loaded', () => {
  assert.ok(HTML.includes('/merchant-dashboard/assets/css/menu-first.css'));
  assert.ok(HTML.includes('/merchant-dashboard/assets/js/menu-first-ui.js'));
});

test('Basic menu flow exposes customer-facing fields', () => {
  assert.ok(JS.includes('Nama Menu'));
  assert.ok(JS.includes('Harga Jual (Rp)'));
  assert.ok(JS.includes('Kategori'));
  assert.ok(JS.includes('Foto Menu'));
  assert.ok(JS.includes('Menu biasa'));
  assert.ok(JS.includes('Simpan Menu'));
});

test('Technical concepts are hidden from the basic path', () => {
  assert.ok(JS.includes("['master-menu-single-fields', 'cm-sub-category']"));
  assert.ok(JS.includes("hideTechnicalGroup('cm-status')"));
  assert.ok(JS.includes('x-menu-first-advanced'));
});

test('Simple menu keeps Product as an internal non-SKU backing object only', () => {
  assert.ok(JS.includes("'/admin/composed/products'"));
  assert.ok(JS.includes('sku:null'));
  assert.ok(JS.includes('ensureBackingProduct'));
});

test('Simple menu internally bridges legacy dependencies without exposing them to the merchant', () => {
  assert.ok(JS.includes("'/admin/sub-categories?category_id='"));
  assert.ok(JS.includes("'/admin/rasas?active_only=1'"));
  assert.ok(JS.includes('ensureHiddenSubCategory'));
  assert.ok(JS.includes('ensureOriginalRasa'));
});

test('Catalog navigation is Menu-first while advanced Product/Stock remains reachable', () => {
  assert.ok(JS.includes("parentSpan.textContent='Menu'"));
  assert.ok(JS.includes("menuSpan.textContent='Menu'"));
  assert.ok(JS.includes("branchSpan.textContent='Menu Cabang'"));
  assert.ok(JS.includes("productSpan.textContent='Produk & Stok'"));
});

test('Existing presentation primitives are reused instead of replaced', () => {
  assert.ok(CSS.includes('.x-menu-first-basics'));
  assert.ok(CSS.includes('.x-menu-first-advanced'));
  assert.ok(CSS.includes('.x-menu-first-save-row'));
});

test('Canonical save wiring remains behind the UI layer', () => {
  assert.ok(JS.includes('event.stopImmediatePropagation()'));
  assert.ok(JS.includes('form.requestSubmit()'));
});
