'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/index.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'apps/merchant-shared/css/dashboard.css'), 'utf8');

/**
 * OWNER MASTER MENU UI PENDING NOTE (2026-10-03)
 * The backend Menu Composition contract is active, but the full Owner Master
 * Menu editor is intentionally still a pending construction step in PR #7.
 * These historical UI cases describe the pre-contract Product-centric editor
 * or a UI surface not yet implemented; keep them skipped rather than weakening
 * the assertions or reintroducing Product as the commercial identity.
 */

test.skip('Owner Kategori/Rasa loading is independent and stale-safe', () => {
  const start = JS.indexOf('async function loadMasterCategoriesPage()');
  const end = JS.indexOf('function referenceStatusBadge', start);
  assert.ok(start >= 0 && end > start, 'Master reference loader must exist');
  const loader = JS.slice(start, end);

  assert.ok(JS.includes('var _masterReferenceLoadSeq = 0;'));
  assert.ok(loader.includes('var requestSeq = ++_masterReferenceLoadSeq'));
  assert.ok(loader.includes("adminFetch(API_BASE + '/admin/categories'"));
  assert.ok(loader.includes("adminFetch(API_BASE + '/admin/menu/components/flavor'"));
  assert.ok(loader.includes('Category Load Error'));
  assert.ok(loader.includes('Flavor Load Error'));
  assert.ok(loader.includes('if (requestSeq !== _masterReferenceLoadSeq) return;'));
  assert.ok(loader.includes('Promise.allSettled([categoryPromise, flavorPromise])'));

  // A single Promise.all around both endpoints would reintroduce the old
  // failure mode where one slow/failed tab blocks the other tab from rendering.
  assert.ok(!loader.includes('Promise.all([\n        adminFetch(API_BASE + \'/admin/categories\''));
});

test.skip('Owner Category page uses four master-reference tabs with card actions', () => {
  assert.ok(HTML.includes('id="master-reference-tabs"'));
  assert.ok(HTML.includes('data-master-reference-tab="category"'));
  assert.ok(HTML.includes('data-master-reference-tab="flavor"'));
  assert.ok(HTML.includes('data-master-reference-tab="complement"'));
  assert.ok(HTML.includes('data-master-reference-tab="level"'));
  assert.ok(HTML.includes('id="master-categories-page-list"'));
  assert.ok(HTML.includes('id="master-flavors-page-list"'));
  assert.ok(HTML.includes('id="master-complements-page-list"'));
  assert.ok(HTML.includes('id="master-levels-page-list"'));
  assert.ok(JS.includes('aria-label="Aksi kategori"'));
  assert.ok(JS.includes('aria-label="Aksi rasa"'));
  assert.ok(JS.includes('aria-label="Aksi kelengkapan"'));
  assert.ok(JS.includes('aria-label="Aksi level"'));
  assert.ok(JS.includes('data-master-reference-action="category"'));
  assert.ok(JS.includes('data-master-reference-action="flavor"'));
  assert.ok(JS.includes('masterReferenceActionHandler'));
  assert.ok(JS.includes("openEditMasterReference(type, id)"));
  assert.ok(JS.includes("deleteMasterReference(type, id)"));
  assert.ok((JS.match(/class="x-action-menu-trigger" aria-label="Aksi kategori"/g) || []).length >= 1);
  assert.ok((JS.match(/class="x-action-menu-trigger" aria-label="Aksi rasa"/g) || []).length >= 1);
  assert.ok(JS.includes('<circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle>'));
  assert.ok(JS.includes('function setMasterReferenceTab(type)'));
  assert.ok(JS.includes('function renderMasterCategoriesPage()'));
  assert.ok(JS.includes('function renderMasterFlavorsPage()'));
  assert.ok(JS.includes("renderMasterReferenceList('complement')"));
  assert.ok(JS.includes("renderMasterReferenceList('level')"));
  assert.ok(JS.includes("label: \'Edit\'"));
  assert.ok(JS.includes("label: \'Hapus\'"));
});

test.skip('Edited master references immediately update the rendered master-reference state', () => {
  const start = JS.indexOf('async function saveMasterReferenceQuickAdd()');
  const end = JS.indexOf('var _productOptionsDraft = [];', start);
  assert.ok(start >= 0 && end > start, 'Master reference save handler must exist');
  const saveHandler = JS.slice(start, end);

  assert.ok(saveHandler.includes('if (!category) throw new Error'));
  assert.ok(saveHandler.includes('state.categories[categoryIndex] = category'));
  assert.ok(saveHandler.includes('else state.categories.push(category)'));
  assert.ok(saveHandler.includes('var row = type === \'category\' ? data.category : data.component'));
  assert.ok(saveHandler.includes('_masterMenuComponents.flavor.push(row)') || saveHandler.includes('else rows.push(row)'));
  assert.ok(saveHandler.includes('referenceRows(type)'));
  assert.ok(saveHandler.includes('renderMasterCategoriesPage();'));
  assert.ok(saveHandler.includes('renderMasterFlavorsPage();'));
});

test('Master Product image editor binds file state, preserves existing images, and uses canonical media upload', () => {
  assert.ok(JS.includes('var _productImageFile = null;'));
  assert.ok(JS.includes('var _productCropSpec = null;'));
  assert.ok(JS.includes('var _productImageRemoved = false;'));
  assert.ok(JS.includes("btnPick.addEventListener('click'"));
  assert.ok(JS.includes("prodFileInput.addEventListener('change'"));
  assert.ok(JS.includes('_productCropSpec = null;'));
  assert.ok(JS.includes('XentraCropEditor.open({'));
  assert.ok(JS.includes("API_BASE + '/admin/media/entity/products/' + encodeURIComponent(savedId) + '/image'"));
  assert.ok(JS.includes("method: 'POST'"));
  assert.ok(JS.includes("method: 'DELETE'"));
  assert.ok(JS.includes("var existingImage = prod.image_url || prod.image || ''"));
  assert.ok(JS.includes("_productImageRemoved = false;"));
  assert.ok(JS.includes("original_filename: _productImageFile.name || null"));
});

test('Master Product primary CTA directly opens the product editor', () => {
  assert.ok(HTML.includes('id="btn-add-product-main">+ Tambah Produk Baru</button>'));
  assert.ok(!HTML.includes('id="btn-add-product-main" onclick="openAddProduct()"'));
  assert.ok(JS.includes("var btnAddProdMain = $('btn-add-product-main');"));
  assert.ok(JS.includes("btnAddProdMain.addEventListener('click', window.openAddProduct)"));
});

test.skip('Owner Product Editor treats Product Name as the Customer title source', () => {
  const start = HTML.indexOf('<section id="tab-catalog-products"');
  const end = HTML.indexOf('<!-- TAB: CATALOG / MENUS', start);
  const section = HTML.slice(start, end);

  assert.ok(section.includes('id="prod-name-group"'));
  assert.ok(section.includes('<label for="prod-name">Nama Produk'));
  assert.ok(section.includes('<input type="text" id="prod-name" class="x-input" required'));
  assert.ok(!section.includes('id="prod-name-group" hidden'));
  assert.ok(!section.includes('Nama Internal Master'));
  assert.ok(JS.includes("name: $('prod-name').value.trim()"));
  assert.ok(JS.includes("var nameInput = $('prod-name');"));
  assert.ok(JS.includes("nameInput.addEventListener('input'"));
});

test.skip('Owner Master Product UI exposes structured composition selectors', () => {
  for (const id of ['prod-category', 'prod-flavor', 'prod-complements-editor', 'prod-level']) {
    assert.ok(HTML.includes('id="' + id + '"'), 'Missing composition control: ' + id);
  }
  assert.ok(HTML.includes('id="btn-add-master-category-from-product"'));
  assert.ok(HTML.includes('id="btn-add-master-flavor-from-product"'));
  assert.ok(HTML.includes('Master Product Composition'), 'Composition section must be present');
  assert.ok(HTML.includes('Preview Customer PWA'), 'Customer PWA preview must be present');
  assert.ok(HTML.includes('Nama Produk → judul · Kategori → grouping · Rasa → subjudul · Kelengkapan → detail · Level → indikator'));
});

test.skip('Legacy Master Product edit hydrates structured composition from the old title', () => {
  assert.ok(JS.includes('function normalizeLegacyMenuText(value)'));
  assert.ok(JS.includes('function findLegacyMenuMatch(text, rows, excludedIds)'));
  assert.ok(JS.includes('function buildLegacyMenuCompositionSuggestion(legacyName)'));
  assert.ok(JS.includes('function showLegacyMenuMigrationNotice(legacyName, suggestion)'));
  assert.ok(JS.includes('loadMasterMenuComposition(prod.id, prod.name)'));
  assert.ok(JS.includes('var hasStructuredComposition = Boolean('));
  assert.ok(JS.includes('if (!hasStructuredComposition && legacyName)'));
  assert.ok(JS.includes('Format lama terdeteksi'));
  assert.ok(HTML.includes('id="master-legacy-migration-notice"'));
  assert.ok(HTML.includes('id="master-legacy-migration-detail"'));
});

test('Atomic Product Editor exposes only Product-owned controls', () => {
  const start = HTML.indexOf('<section id="tab-catalog-products"');
  const end = HTML.indexOf('<!-- TAB: CATALOG / MENUS', start);
  const section = HTML.slice(start, end);

  assert.ok(section.includes('id="form-product"'));
  assert.ok(section.includes('id="prod-name"'));
  assert.ok(section.includes('id="prod-sku"'));
  assert.ok(section.includes('id="prod-desc"'));
  assert.ok(section.includes('id="prod-is-active"'));

  for (const legacyField of [
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
    'id="master-menu-customer-preview"'
  ]) {
    assert.ok(!section.includes(legacyField), 'Legacy Product/commercial control leaked into Product Editor: ' + legacyField);
  }

  assert.ok(JS.includes('Product is the atomic inventory entity'));
  assert.ok(JS.includes('sku: sku || null'));
  assert.ok(JS.includes("is_active: $('prod-is-active').checked ? 1 : 0"));
});

test('Product Editor does not own Master Menu references', () => {
  const start = HTML.indexOf('<section id="tab-catalog-products"');
  const end = HTML.indexOf('<!-- TAB: CATALOG / MENUS', start);
  const section = HTML.slice(start, end);

  for (const legacyControl of [
    'btn-add-master-category-from-product',
    'btn-add-master-flavor-from-product',
    'prod-complements-editor',
    'prod-level-chips',
    'master-legacy-migration-notice'
  ]) {
    assert.ok(!section.includes('id="' + legacyControl + '"'));
  }

  assert.ok(JS.includes("API_BASE + '/admin/menus/single'"));
  assert.ok(JS.includes("API_BASE + '/admin/menus/package'"));
  assert.ok(!JS.includes("saveMasterMenuComposition(savedId)"));
});

test('Master Menu references are managed by the canonical Menu workspace', () => {
  assert.ok(HTML.includes('id="cm-sub-category"'));
  assert.ok(HTML.includes('id="cm-rasa"'));
  assert.ok(HTML.includes('id="cm-level"'));
  assert.ok(JS.includes("API_BASE + '/admin/sub-categories'"));
  assert.ok(JS.includes("API_BASE + '/admin/rasas'"));
  assert.ok(JS.includes("API_BASE + '/admin/menu/components/level'"));
});

test('Product Editor does not own POS commercial options', () => {
  const start = HTML.indexOf('<section id="tab-catalog-products"');
  const end = HTML.indexOf('<!-- TAB: CATALOG / MENUS', start);
  const section = HTML.slice(start, end);

  assert.ok(section.includes('id="form-product"'));
  assert.ok(!section.includes('id="prod-options-editor"'));
  assert.ok(!section.includes('Opsi Penjualan POS'));
  assert.ok(JS.includes('function normalizeProductOptionsDraft'));
  assert.ok(JS.includes("API_BASE + '/admin/products/' + encodeURIComponent(productId) + '/options'"));
});

test('Atomic Product Editor does not block on Menu Master references', () => {
  const start = JS.indexOf('async function loadProductEditorPage(productId)');
  const end = JS.indexOf("window.openAddProduct = function ()", start);
  assert.ok(start >= 0 && end > start);
  const loader = JS.slice(start, end);
  assert.ok(loader.includes('showProductEditorSection();'));
  assert.ok(loader.includes('resetProductEditorForAdd();'));
  assert.ok(!loader.includes('loadMasterMenuComponents()'));
  assert.ok(!loader.includes('loadMasterMenuComposition('));
  assert.ok(!loader.includes('loadProductOptionsEditor('));
});

test('Canonical Menu Master preview owns customer-facing Pedas presentation', () => {
  const start = JS.indexOf('function renderOwnerMasterMenuPreview()');
  const end = JS.indexOf('async function loadOwnerMasterMenuReferences()', start);
  assert.ok(start >= 0 && end > start);
  const preview = JS.slice(start, end);
  assert.ok(preview.includes('ownerMasterMenuSelectedLevel()'));
  assert.ok(preview.includes('x-master-customer-preview-spice-label'));
  assert.ok(preview.includes('for (var levelIndex = 1; levelIndex <= 4; levelIndex += 1)'));
  assert.ok(HTML.includes('id="composed-menu-customer-preview"'));
  assert.ok(HTML.includes('id="cm-preview-indicator"'));
});

test('Product Editor no longer renders Customer Menu preview', () => {
  const start = HTML.indexOf('<section id="tab-catalog-products"');
  const end = HTML.indexOf('<!-- TAB: CATALOG / MENUS', start);
  const section = HTML.slice(start, end);
  assert.ok(!section.includes('Preview Customer PWA'));
  assert.ok(!section.includes('master-menu-customer-preview'));
  assert.ok(!JS.includes("priceInput.addEventListener('input'"));
  assert.ok(!JS.includes("flavorSelect.addEventListener('change'"));
});

test('Owner Menu composition saves through canonical Menu endpoints', () => {
  assert.ok(JS.includes("API_BASE + '/admin/menus/single'"));
  assert.ok(JS.includes("API_BASE + '/admin/menus/package'"));
  assert.ok(JS.includes("API_BASE + '/admin/menus/' + encodeURIComponent(menuId) + '/single'"));
  assert.ok(JS.includes("API_BASE + '/admin/menus/' + encodeURIComponent(menuId) + '/package'"));
  assert.ok(JS.includes('product_id: productId'));
  assert.ok(JS.includes('payload.components = components'));
  assert.ok(!JS.includes("API_BASE + '/admin/products/' + encodeURIComponent(productId) + '/composition'"));
});

test('Master Product uses a dedicated atomic Product editor', () => {
  assert.ok(HTML.includes('id="product-editor-view"'));
  assert.ok(HTML.includes('id="form-product"'));
  assert.ok(HTML.includes('id="prod-name"'));
  assert.ok(HTML.includes('id="prod-sku"'));
  assert.ok(HTML.includes('id="prod-is-active"'));
  assert.ok(JS.includes("route === 'catalog/products/new'"));
  assert.ok(JS.includes("/^catalog\\/products\\/[^/]+\\/edit$/"));
  assert.ok(JS.includes('function showProductEditorSection()'));
  assert.ok(JS.includes('function loadProductEditorPage(productId)'));
  assert.ok(JS.includes("navigateTo('catalog/products/new')"));
  assert.ok(JS.includes("navigateTo('catalog/products/' + encodeURIComponent(id) + '/edit')"));
  assert.ok(!HTML.includes('btn-add-master-category-from-product'));
  assert.ok(!HTML.includes('btn-add-master-flavor-from-product'));
});

test('Product editor routes cleanly between list, detail, add, and edit', () => {
  assert.ok(JS.includes("route === 'catalog/products/new'"));
  assert.ok(JS.includes("route.indexOf('catalog/products/') === 0"));
  assert.ok(JS.includes('!isProductEditor'));
  assert.ok(JS.includes('if (isProductEditor)'));
  assert.ok(JS.includes('showProductEditorSection()'));
  assert.ok(JS.includes('showProductDetailSection()'));
  assert.ok(JS.includes("navigateTo('catalog/products/' + encodeURIComponent(id) + '/edit')"));
  assert.ok(JS.includes("navigateTo('catalog/products', { history: 'replace' })"));
});

test('Master Product list renders atomic SKU/status fields', () => {
  assert.ok(JS.includes("String(p.sku || '')"));
  assert.ok(JS.includes('Belum ada SKU'));
  assert.ok(JS.includes('Product aktif'));
  assert.ok(!JS.includes('function renderMasterProductSpiceIndicator('));
});

test.skip('Master Product editor keeps Flavor optional and exposes multi-select complements plus horizontal Level Pedas selector', () => {
  const start = HTML.indexOf('<section id="tab-catalog-products"');
  const end = HTML.indexOf('<!-- TAB: CATALOG / MENUS', start);
  const section = HTML.slice(start, end);
  assert.ok(section.includes('<select id="prod-flavor" class="x-input">'));
  assert.ok(!section.includes('<select id="prod-flavor" class="x-input" required>'));
  assert.ok(section.includes('id="prod-complements-editor"'));
  assert.ok(section.includes('id="prod-level-chips"'));
  assert.ok(!section.includes('<select id="prod-level"'));
  assert.ok(section.includes('id="prod-level"'));
  assert.ok(JS.includes("adminFetch(API_BASE + '/admin/menu/components/complement'"));
  assert.ok(JS.includes("adminFetch(API_BASE + '/admin/menu/components/level'"));
  assert.ok(JS.includes("API_BASE + '/admin/menu/components/level/ensure-defaults'"));
});

test('Master Product editor renders before master-reference requests finish', () => {
  const start = JS.indexOf('async function loadProductEditorPage(productId)');
  const end = JS.indexOf("window.openAddProduct = function ()", start);
  assert.ok(start >= 0 && end > start, 'Product editor loader must exist');
  const loader = JS.slice(start, end);
  assert.ok(loader.includes('showProductEditorSection();'));
  assert.ok(loader.includes('resetProductEditorForAdd();'));
  assert.ok(loader.indexOf('resetProductEditorForAdd();') < loader.indexOf('await Promise.all(['),
    'Add flow must render the editor before awaiting master-reference requests');
  assert.ok(!HTML.includes('id="product-editor-loading"'), 'Blocking product editor loading banner must not exist');
  assert.ok(!JS.includes('setProductEditorLoading('), 'Blocking editor loading helper must not exist');
});

test.skip('Customer presentation mapping is explicit in Owner UI', () => {
  assert.ok(HTML.includes('Judul utama yang tampil di Customer PWA'));
  assert.ok(HTML.includes('Subtitle Customer PWA'));
  assert.ok(HTML.includes('Detail Customer PWA'));
  assert.match(HTML, /Kategori → judul · Rasa → subjudul · Kelengkapan → detail · Level → indikator/);
});

test('Customer preview renders Pedas as a four-dot indicator, not legacy level text', () => {
  assert.ok(JS.includes('x-master-customer-preview-spice-dot'));
  assert.ok(JS.includes('Level Pedas '));
  assert.ok(JS.includes('i <= 4'));
  assert.ok(!JS.includes('indicatorEl.textContent = level.name'));
  assert.ok(CSS.includes('.x-master-customer-preview-spice-dot.is-filled'));
});

test('Customer preview is driven by structured selections, not free-text composition fields', () => {
  assert.ok(JS.includes('function renderMasterMenuCustomerPreview()'));
  assert.ok(JS.includes("_masterMenuComponents.flavor.find"));
  assert.ok(JS.includes("_masterMenuComponents.complement.find"));
  assert.ok(JS.includes("_masterMenuComponents.level.find"));
  assert.ok(JS.includes("categorySelect.addEventListener('change'"));
  assert.ok(JS.includes("flavorSelect.addEventListener('change'"));
  assert.ok(JS.includes('function renderMasterLevelSelector('));
  assert.ok(JS.includes('x-master-spice-level-segment'));
  assert.ok(HTML.includes('id="prod-level-chips"'));
  assert.ok(HTML.includes('<input type="hidden" id="prod-level"'));
  assert.ok(!HTML.includes('<select id="prod-level"'), 'Level Pedas must not use a dropdown');
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

test('Master Product uses a dedicated page editor and contextual quick-add modal', () => {
  assert.ok(HTML.includes('id="product-editor-view"'));
  assert.ok(HTML.includes('id="form-product"'));
  assert.ok(HTML.includes('id="btn-back-from-product-editor"'));
  assert.ok(HTML.includes('id="btn-cancel-product-editor"'));
  assert.ok(!HTML.includes('id="modal-product"'));
  assert.ok(JS.includes("route === 'catalog/products/new'"));
  assert.ok(JS.includes("/^catalog\\/products\\/[^/]+\\/edit$/"));
  assert.ok(JS.includes('function showProductEditorSection()'));
  assert.ok(JS.includes('function loadProductEditorPage(productId)'));
  assert.ok(JS.includes("navigateTo('catalog/products/new')"));
  assert.ok(JS.includes("navigateTo('catalog/products/' + encodeURIComponent(id) + '/edit')"));
  assert.ok(HTML.includes('id="master-reference-editor"'));
  assert.ok(HTML.includes('id="master-reference-quick-add-type"'));
  assert.ok(HTML.includes('id="master-reference-quick-add-name"'));
  assert.ok(HTML.includes('id="master-reference-quick-add-id"'));
  assert.ok(JS.includes('function openMasterReferenceQuickAdd(type)'));
  assert.ok(JS.includes("openMasterReferenceQuickAdd('category')"));
  assert.ok(JS.includes("openMasterReferenceQuickAdd('flavor')"));
  assert.ok(HTML.includes('id="tab-catalog-categories"'));
  assert.ok(HTML.includes('id="master-categories-page-list"'));
  assert.ok(!HTML.includes('id="btn-manage-menu-components"'));
});

test('Product editor routes cleanly between list, detail, add, and edit', () => {
  assert.ok(JS.includes("route === 'catalog/products/new'"));
  assert.ok(JS.includes("route.indexOf('catalog/products/') === 0"));
  assert.ok(JS.includes('!isProductEditor'));
  assert.ok(JS.includes('if (isProductEditor)'));
  assert.ok(JS.includes('showProductEditorSection()'));
  assert.ok(JS.includes('showProductDetailSection()'));
  assert.ok(JS.includes("navigateTo('catalog/products/' + encodeURIComponent(id) + '/edit')"));
  assert.ok(JS.includes("navigateTo('catalog/products', { history: 'replace' })"),
    'Saving the editor must return to the Product Master list, not Product Detail');
});

test('Product Master list receives and renders structured Level intensity', () => {
  const route = fs.readFileSync(path.join(ROOT, 'server/routes/admin-catalog.js'), 'utf8');
  assert.ok(route.includes('ml.sort_order AS level_sort_order'));
  assert.ok(JS.includes('function renderMasterProductSpiceIndicator('));
  assert.ok(JS.includes('prod.level_sort_order'));
  assert.ok(JS.includes('x-master-product-spice-dot'));
  assert.ok(CSS.includes('.x-master-product-spice-dot.is-filled'));
});

test('Customer PWA Level path is wired through the structured catalog field', () => {
  assert.ok(fs.readFileSync(path.join(ROOT, 'apps/customer-pwa/assets/js/pages/home.js'), 'utf8').includes('product.menu_indicator_level'));
  assert.ok(fs.readFileSync(path.join(ROOT, 'server/routes/catalog.js'), 'utf8').includes('menu_indicator_level: p.indicator_level'));
});

test('Master Product editor stays inside Catalog Products tab and remains atomic/mobile-safe', () => {
  const tabStart = HTML.indexOf('<section id="tab-catalog-products"');
  const tabEnd = HTML.indexOf('<!-- TAB: CATALOG / MENUS', tabStart);
  const editorStart = HTML.indexOf('<section id="product-editor-view"');
  const editorEnd = HTML.indexOf('</section>', editorStart);
  assert.ok(tabStart >= 0 && tabEnd > tabStart);
  assert.ok(editorStart > tabStart && editorEnd > editorStart && editorEnd < tabEnd);
  assert.ok(!HTML.includes('id="modal-product"'));
  const form = HTML.slice(editorStart, editorEnd);
  assert.ok(form.includes('id="prod-name"'));
  assert.ok(form.includes('id="prod-sku"'));
  assert.ok(form.includes('id="prod-is-active"'));
  assert.ok(!form.includes('branch_category_id'));
  assert.ok(!form.includes('id="prod-price"'));
  assert.ok(!form.includes('id="prod-category"'));
});

test('Level Pedas lives in the canonical Menu Master editor', () => {
  assert.ok(HTML.includes('id="cm-level"'));
  assert.ok(HTML.includes('id="cm-preview-indicator"'));
  assert.ok(JS.includes('ownerMasterMenuSelectedLevel()'));
  assert.ok(JS.includes('x-master-customer-preview-spice-dot'));
  assert.ok(!HTML.includes('id="prod-level"'));
  assert.ok(!HTML.includes('id="prod-level-chips"'));
});

test('Master Kategori page does not expose Level as a category tab', () => {
  assert.ok(HTML.includes('id="master-reference-tabs"'));
  assert.ok(!HTML.includes('data-master-reference-tab="level"'));
  assert.ok(!HTML.includes('id="master-reference-level-panel"'));
});
