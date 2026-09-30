const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const shellJs = fs.readFileSync(path.join(root, 'apps/merchant-shared/js/presentation-shells.js'), 'utf8');
const shellCss = fs.readFileSync(path.join(root, 'apps/merchant-shared/css/presentation-shells.css'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(root, 'apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(root, 'apps/merchant-dashboard/index.html'), 'utf8');

test('PRES-01: reusable presentation shell exposes composition API', () => {
  assert.ok(shellJs.includes('window.XentraPresentation'));
  assert.ok(shellJs.includes('open: open'));
  assert.ok(shellJs.includes('close: close'));
  assert.ok(shellJs.includes("type = options.type || 'modal'"));
  assert.ok(shellJs.includes("x-presentation-' + type"));
});

test('PRES-02: presentation shells are containers, not feature logic', () => {
  assert.ok(!shellJs.includes('CategoryEditor'));
  assert.ok(!shellJs.includes('ProductEditor'));
  assert.ok(!shellJs.includes('admin/categories'));
  assert.ok(!shellJs.includes('admin/menu/components'));
});

test('PRES-03: bottom sheet shell is reusable and responsive', () => {
  assert.ok(shellCss.includes('.x-presentation-bottom-sheet'));
  assert.ok(shellCss.includes('env(safe-area-inset-bottom'));
  assert.ok(shellCss.includes('@media (min-width: 769px)'));
});

test('PRES-04: Master Reference editor is feature content composed into Bottom Sheet', () => {
  assert.ok(dashboardHtml.includes('id="master-reference-editor"'));
  assert.ok(dashboardHtml.includes('id="master-reference-quick-add-anchor"'));
  assert.ok(!dashboardHtml.includes('id="master-reference-editor" class="x-modal-backdrop"'));
  assert.ok(dashboardJs.includes("id: 'master-reference-quick-add'"));
  assert.ok(dashboardJs.includes("type: 'bottom-sheet'"));
  assert.ok(dashboardJs.includes("content: content"));
});

test('PRES-05: Master Reference business/API flow remains in feature controller', () => {
  assert.ok(dashboardJs.includes('async function saveMasterReferenceQuickAdd()'));
  assert.ok(dashboardJs.includes('method: referenceId ? \'PUT\' : \'POST\''));
  assert.ok(dashboardJs.includes('meta.payload(name)'));
  assert.ok(dashboardJs.includes('renderMasterReferenceList(type)'));
});

test('PRES-06: destructive confirmation uses generic Dialog presentation, not feature-coupled modal', () => {
  assert.ok(shellJs.includes('confirm: confirm'));
  assert.ok(shellJs.includes("type: 'dialog'"));
  assert.ok(shellJs.includes('data-confirm-ok'));
  assert.ok(dashboardJs.includes("id: 'delete-master-reference'"));
  assert.ok(dashboardJs.includes("id: 'delete-master-product'"));
  assert.ok(!dashboardJs.includes("confirm('Hapus ' + noun"));
});

test('PRES-07: Product Master Add/Edit remains a Page presentation', () => {
  assert.ok(dashboardHtml.includes('id="product-editor-view"'));
  assert.ok(dashboardHtml.includes('id="product-editor-title"'));
  assert.ok(dashboardJs.includes("route === 'catalog/products/new'"));
  assert.ok(dashboardJs.includes("/edit$/.test(route)"));
  assert.ok(dashboardJs.includes("navigateTo('catalog/products/new')"));
  assert.ok(dashboardJs.includes("navigateTo('catalog/products/' + encodeURIComponent(id) + '/edit')"));
  assert.ok(!dashboardHtml.includes('id="modal-product-title"'));
});
