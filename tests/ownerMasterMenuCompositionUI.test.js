'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/index.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');

test('Owner Category page uses two master-reference tabs with card actions', () => {
  assert.ok(HTML.includes('id="master-reference-tabs"'));
  assert.ok(HTML.includes('data-master-reference-tab="category"'));
  assert.ok(HTML.includes('data-master-reference-tab="flavor"'));
  assert.ok(HTML.includes('id="master-categories-page-list"'));
  assert.ok(HTML.includes('id="master-flavors-page-list"'));
  assert.ok(JS.includes('aria-label="Aksi kategori"'));
  assert.ok(JS.includes('aria-label="Aksi rasa"'));
  assert.ok((JS.match(/class="x-action-menu-trigger" aria-label="Aksi kategori"/g) || []).length >= 1);
  assert.ok((JS.match(/class="x-action-menu-trigger" aria-label="Aksi rasa"/g) || []).length >= 1);
  assert.ok(JS.includes('<circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle>'));
  assert.ok(JS.includes('function setMasterReferenceTab(type)'));
  assert.ok(JS.includes('function renderMasterCategoriesPage()'));
  assert.ok(JS.includes('function renderMasterFlavorsPage()'));
  assert.ok(JS.includes("label: \'Edit\'"));
  assert.ok(JS.includes("label: \'Hapus\'"));
});

test('Owner Master Product UI exposes structured composition selectors', () => {
  for (const id of ['prod-category', 'prod-flavor', 'prod-complements-editor', 'prod-level']) {
    assert.ok(HTML.includes('id="' + id + '"'), 'Missing composition control: ' + id);
  }
  assert.ok(HTML.includes('id="btn-add-master-category-from-product"'));
  assert.ok(HTML.includes('id="btn-add-master-flavor-from-product"'));
  assert.ok(HTML.includes('Master Product Composition'), 'Composition section must be present');
  assert.ok(HTML.includes('Preview Customer PWA'), 'Customer PWA preview must be present');
});

test('Customer presentation mapping is explicit in Owner UI', () => {
  assert.match(HTML, /Kategori.*Judul Customer|Kategori.*judul.*Customer/i);
  assert.match(HTML, /Rasa.*Subtitle Customer/i);
  assert.match(HTML, /Kelengkapan.*Detail Customer/i);
  assert.match(HTML, /Level.*Indikator Customer/i);
  assert.match(HTML, /Kategori → judul · Rasa → subjudul · Kelengkapan → detail · Level → indikator/);
});

test('Customer preview is driven by structured selections, not free-text composition fields', () => {
  assert.ok(JS.includes('function renderMasterMenuCustomerPreview()'));
  assert.ok(JS.includes("_masterMenuComponents.flavor.find"));
  assert.ok(JS.includes("_masterMenuComponents.complement.find"));
  assert.ok(JS.includes("_masterMenuComponents.level.find"));
  assert.ok(JS.includes("categorySelect.addEventListener('change'"));
  assert.ok(JS.includes("flavorSelect.addEventListener('change'"));
  assert.ok(JS.includes("levelSelect.addEventListener('change'"));
  assert.ok(JS.includes("priceInput.addEventListener('input'"));
  assert.ok(JS.includes("renderMasterMenuCustomerPreview();"));
});

test('Master Category and Flavor edit/delete endpoints are wired', () => {
  const route = fs.readFileSync(path.join(ROOT, 'server/routes/admin-catalog.js'), 'utf8');
  const compositionRoute = fs.readFileSync(path.join(ROOT, 'server/routes/admin-menu-composition.js'), 'utf8');
  assert.ok(route.includes("router.put('/admin/categories/:id'"));
  assert.ok(route.includes("router.delete('/admin/categories/:id'"));
  assert.ok(compositionRoute.includes("router.put('/admin/menu/components/:type/:id'"));
  assert.ok(compositionRoute.includes("router.delete('/admin/menu/components/:type/:id'"));
  assert.ok(JS.includes("deleteEndpoint: function (id) { return API_BASE + '/admin/menu/components/flavor/'"));
  assert.ok(JS.includes("method: referenceId ? 'PUT' : 'POST'"));
  assert.ok(JS.includes("method: 'DELETE'"));
});

test('Owner composition saves through the canonical Master composition API', () => {
  assert.ok(JS.includes("/admin/products/' + encodeURIComponent(productId) + '/composition"));
  assert.ok(JS.includes('category_id: categoryId'));
  assert.ok(JS.includes('flavor_id:'));
  assert.ok(JS.includes('complement_ids: _masterMenuSelected.complement_ids.slice()'));
  assert.ok(JS.includes('level_id:'));
});

test('Inactive Master component values are not exposed as new selector choices', () => {
  assert.ok(JS.includes("if (!row.is_active && !selected) return;"));
  assert.ok(JS.includes("var suffix = row.is_active ? '' : ' (Nonaktif)';"));
  assert.ok(JS.includes("API_BASE + '/admin/menu/components/' + type"));
  assert.ok(!JS.includes("active_only=true"), 'Component manager must retain inactive rows so they can be reactivated');
});

test('Master Product uses one assembly workspace with contextual quick-add modal', () => {
  assert.ok(HTML.includes('id="modal-master-reference-quick-add"'));
  assert.ok(HTML.includes('id="master-reference-quick-add-type"'));
  assert.ok(HTML.includes('id="master-reference-quick-add-name"'));
  assert.ok(HTML.includes('id="master-reference-quick-add-id"'));
  assert.ok(JS.includes('function openMasterReferenceQuickAdd(type)'));
  assert.ok(JS.includes("openMasterReferenceQuickAdd('category')"));
  assert.ok(JS.includes("openMasterReferenceQuickAdd('flavor')"));
  assert.ok(JS.includes("API_BASE + '/admin/categories'"));
  assert.ok(JS.includes("API_BASE + '/admin/menu/components/flavor'"));
  assert.ok(HTML.includes('id="tab-catalog-categories"'));
  assert.ok(HTML.includes('id="master-categories-page-list"'));
  assert.ok(!HTML.includes('id="btn-manage-menu-components"'));
});

test('New Product form does not introduce legacy branch override composition fields', () => {
  const start = HTML.indexOf('<!-- MODAL: ADD / EDIT PRODUCT -->');
  const end = HTML.indexOf('<!-- MODAL: MASTER MENU COMPONENT MANAGER -->', start);
  assert.ok(start >= 0 && end > start, 'Product modal boundaries must exist');
  const form = HTML.slice(start, end);
  for (const legacyField of ['name_override', 'description_override', 'image_override', 'branch_category_id']) {
    assert.ok(!form.includes(legacyField), 'Legacy field leaked into Owner Master Product UI: ' + legacyField);
  }
});
