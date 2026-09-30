'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/index.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'apps/merchant-shared/css/dashboard.css'), 'utf8');

test('Owner Kategori/Rasa loading is independent and stale-safe', () => {
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

test('Owner Category page uses four master-reference tabs with card actions', () => {
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

test('Edited master references immediately update the rendered master-reference state', () => {
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

test('Master Product primary CTA directly opens the product editor', () => {
  assert.ok(HTML.includes('id="btn-add-product-main">+ Tambah Produk Baru</button>'));
  assert.ok(!HTML.includes('id="btn-add-product-main" onclick="openAddProduct()"'));
  assert.ok(JS.includes("var btnAddProdMain = $('btn-add-product-main');"));
  assert.ok(JS.includes("btnAddProdMain.addEventListener('click', window.openAddProduct)"));
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

test('Legacy Master Product edit hydrates structured composition from the old title', () => {
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

test('Master Product composition uses the correct control type per field', () => {
  const start = HTML.indexOf('<section id="tab-catalog-products"');
  const end = HTML.indexOf('<!-- TAB: CATALOG / MENUS', start);
  const section = HTML.slice(start, end);

  // Category and Flavor are single-select native dropdowns with contextual + buttons.
  assert.ok(section.includes('<select id="prod-category" class="x-input" required>'));
  assert.ok(section.includes('<select id="prod-flavor" class="x-input">'));
  assert.ok(section.includes('id="btn-add-master-category-from-product"'));
  assert.ok(section.includes('id="btn-add-master-flavor-from-product"'));
  assert.ok(section.includes('class="x-master-select-with-add"'));
  assert.ok(section.includes('class="x-master-select-add"'));

  // Complement is the only multi-select chip grid.
  assert.ok(section.includes('id="prod-complements-editor"'));
  assert.ok(section.includes('class="x-master-choice-grid x-master-complement-grid"'));

  // Level Pedas is a horizontal progressive selector, not a dropdown.
  assert.ok(section.includes('id="prod-level-chips"'));
  assert.ok(section.includes('aria-label="Pilih Level Pedas"'));
  assert.ok(section.includes('<input type="hidden" id="prod-level"'));
  assert.ok(!section.includes('<select id="prod-level"'));
  assert.ok(JS.includes('function renderMasterLevelSelector('));
  assert.ok(JS.includes('data-master-level-id'));
  assert.ok(CSS.includes('.x-master-choice-chip.is-selected'));
  assert.ok(CSS.includes('.x-master-spice-level'));
  assert.ok(CSS.includes('.x-master-spice-level-segment.is-filled'));
});
 
test('Master Product empty references remain create-only and actionable', () => {
  const start = HTML.indexOf('<section id="tab-catalog-products"');
  const end = HTML.indexOf('<!-- TAB: CATALOG / MENUS', start);
  const section = HTML.slice(start, end);

  // Product Editor may create a missing reference, but must not expose
  // edit/delete controls for reference masters from inside the product form.
  assert.ok(section.includes('id="btn-add-master-category-from-product"'));
  assert.ok(section.includes('id="btn-add-master-flavor-from-product"'));
  assert.ok(section.includes('data-master-choice-add="1"'));
  assert.ok(section.includes('Tambah Kelengkapan'));
  assert.ok(!section.includes('Aksi kategori'));
  assert.ok(!section.includes('Aksi rasa'));
  assert.ok(!section.includes('Aksi kelengkapan'));
  assert.ok(!section.includes('Hapus Kategori'));
  assert.ok(!section.includes('Hapus Rasa'));
  assert.ok(!section.includes('Hapus Kelengkapan'));

  // Empty state must present the + affordance rather than a dead-end message.
  assert.ok(section.includes('id="prod-complements-editor"'));
  assert.ok(!section.includes('Belum ada Master Kelengkapan.'));
  assert.ok(JS.includes('Empty Master Kelengkapan is still an actionable state'));
});

test('Adding a Master Complement from Product Editor auto-selects it', () => {
  const start = JS.indexOf('async function saveMasterReferenceQuickAdd()');
  const end = JS.indexOf('var _productOptionsDraft = [];', start);
  assert.ok(start >= 0 && end > start);
  const handler = JS.slice(start, end);

  assert.ok(handler.includes("type === 'complement'"));
  assert.ok(handler.includes('_masterMenuSelected.complement_ids.indexOf(newComplementId)'));
  assert.ok(handler.includes('_masterMenuSelected.complement_ids.push(newComplementId)'));
  assert.ok(handler.includes('renderMasterMenuSelectors();'));
});

test('Master Product editor keeps Flavor optional and exposes multi-select complements plus horizontal Level Pedas selector', () => {
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
  assert.ok(JS.includes("navigateTo('catalog/products/' + encodeURIComponent(savedId))"));
});

test('Master Product editor stays inside Catalog Products tab and remains mobile-safe', () => {
  const tabStart = HTML.indexOf('<section id="tab-catalog-products"');
  const tabEnd = HTML.indexOf('<!-- TAB: CATALOG / MENUS', tabStart);
  const editorStart = HTML.indexOf('<section id="product-editor-view"');
  const editorEnd = HTML.indexOf('</section>', editorStart);
  assert.ok(tabStart >= 0 && tabEnd > tabStart, 'Catalog Products tab must exist');
  assert.ok(editorStart > tabStart && editorEnd > editorStart && editorEnd < tabEnd,
    'Product editor must be contained inside Catalog Products tab');
  assert.ok(!HTML.includes('id="modal-product"'), 'Legacy product modal must be removed');
  assert.ok(CSS.includes('#product-editor-view.x-card-panel'), 'Product editor needs dedicated responsive page styles');
  assert.ok(CSS.includes('#product-editor-view #prod-options-editor [style*="grid-template-columns"]'),
    'Dynamic POS option grids must collapse on mobile');
  for (const legacyField of ['name_override', 'description_override', 'image_override', 'branch_category_id']) {
    const form = HTML.slice(editorStart, editorEnd);
    assert.ok(!form.includes(legacyField), 'Legacy field leaked into Owner Master Product UI: ' + legacyField);
  }
});


test('Level Pedas uses a compact progressive selector, not a dropdown', () => {
  assert.ok(HTML.includes('aria-label="Pilih Level Pedas"'));
  assert.ok(JS.includes('data-master-level-id'));
  assert.ok(JS.includes('selectedIndex >= 0 && index <= selectedIndex'));
  assert.ok(CSS.includes('.x-master-spice-level'));
  assert.ok(CSS.includes('.x-master-spice-level-segment.is-filled'));
  assert.ok(!CSS.includes('.x-master-level-grid'));
});

test('Master Kategori page does not expose Level as a category tab', () => {
  assert.ok(HTML.includes('id="master-reference-tabs"'));
  assert.ok(!HTML.includes('data-master-reference-tab="level"'));
  assert.ok(!HTML.includes('id="master-reference-level-panel"'));
});
