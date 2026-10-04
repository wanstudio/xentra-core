const test = require('node:test');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const shellJs = fs.readFileSync(path.join(root, 'apps/merchant-shared/js/presentation-shells.js'), 'utf8');
const shellCss = fs.readFileSync(path.join(root, 'apps/merchant-shared/css/presentation-shells.css'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(root, 'apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(root, 'apps/merchant-dashboard/index.html'), 'utf8');
const branchCatalogJs = fs.readFileSync(path.join(root, 'apps/merchant-dashboard/assets/js/branch-catalog-ui.js'), 'utf8');
const merchantMenuJs = fs.readFileSync(path.join(root, 'apps/merchant-app/assets/js/menu.js'), 'utf8');

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
  assert.ok(dashboardJs.includes("id: 'archive-master-product'"));
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


test('PRES-08: Branch Add/Edit is a focused Page, not a legacy modal', () => {
  assert.ok(dashboardHtml.includes('id="branch-editor-view"'));
  assert.ok(dashboardHtml.includes('id="form-branch"'));
  assert.ok(!dashboardHtml.includes('id="modal-branch"'));
  assert.ok(dashboardJs.includes("route === 'branches/new'"));
  assert.ok(dashboardJs.includes("/^branches\\/[^/]+\\/edit$/.test(route)"));
  assert.ok(dashboardJs.includes("navigateTo(branchId ? ('branches/' + encodeURIComponent(branchId) + '/edit') : 'branches/new')"));
  assert.ok(dashboardJs.includes("id: 'delete-branch'"));
});

test('PRES-09: Branch Catalog uses the canonical Branch Detail Menu Page', () => {
  assert.ok(!dashboardHtml.includes('id="modal-branch-catalog"'));
  assert.ok(dashboardJs.includes("navigateTo('branches/' + encodeURIComponent(branchId) + '/menu')") || fs.readFileSync(path.join(root, 'apps/merchant-dashboard/assets/js/branch-catalog-ui.js'), 'utf8').includes("branches/' + encodeURIComponent(branchId) + '/menu"));
  assert.ok(dashboardJs.includes("openBranchCatalogModal(") || dashboardJs.includes("openBranchCatalogModal"));
});


test('PRES-10: Team lightweight editors compose into Bottom Sheet and reset token into Dialog', () => {
  assert.ok(dashboardJs.includes("openExistingCardInPresentation('modal-user', 'team-user-editor', 'bottom-sheet')"));
  assert.ok(dashboardJs.includes("openExistingCardInPresentation('modal-invite-user', 'team-invite-editor', 'bottom-sheet')"));
  assert.ok(dashboardJs.includes("openExistingCardInPresentation('modal-reset-password', 'team-reset-password', 'dialog')"));
  assert.ok(dashboardJs.includes("'delete-user'"));
  assert.ok(dashboardJs.includes("'disable-user'"));
  assert.ok(!dashboardJs.includes("confirm('Nonaktifkan akun"));
});

test('PRES-11: Marketing Promotion and Banner editors are focused Page surfaces', () => {
  assert.ok(dashboardHtml.includes('id="marketing-promotion-editor-view"'));
  assert.ok(dashboardHtml.includes('id="marketing-banner-editor-view"'));
  assert.ok(dashboardJs.includes("route === 'marketing/promotions/new'"));
  assert.ok(dashboardJs.includes("/^marketing\\/promotions\\/[^/]+\\/edit$/.test(route)"));
  assert.ok(dashboardJs.includes("route === 'marketing/banners/new'"));
  assert.ok(dashboardJs.includes("/^marketing\\/banners\\/[^/]+\\/edit$/.test(route)"));
  assert.ok(dashboardJs.includes('function mountPromotionEditorPage()'));
  assert.ok(dashboardJs.includes('function mountMarketingBannerEditorPage()'));
});

test('PRES-12: Marketing Banner assignment is Bottom Sheet and preview is Dialog', () => {
  assert.ok(dashboardJs.includes("openExistingCardInPresentation('modal-marketing-banner-assignment', 'marketing-banner-assignment', 'bottom-sheet')"));
  assert.ok(dashboardJs.includes("openExistingCardInPresentation('modal-marketing-banner-preview', 'marketing-banner-preview', 'dialog')"));
});


test('PRES-14: Merchant Menu display-name editor uses canonical presentation transport', () => {
  assert.ok(merchantMenuJs.includes('XentraPresentation.open({'));
  assert.ok(merchantMenuJs.includes("type: 'bottom-sheet'"));
  assert.ok(merchantMenuJs.includes('updateBranchMenuDisplayName'));
  assert.ok(merchantMenuJs.includes("label: 'Ubah Nama Tampil'"));
});

test('PRES-13: Owner Dashboard legacy interactive surfaces use canonical presentation shells', () => {
  assert.ok(dashboardJs.includes("openExistingCardInPresentation('modal-master-menu-components', 'master-menu-component-manager', 'bottom-sheet')"));
  assert.ok(dashboardJs.includes("requestTextInputSheet({ title: 'Edit '"));
  assert.ok(dashboardJs.includes("requestTextInputSheet({ title: 'Tambah Master '"));
  assert.ok(branchCatalogJs.includes("openBranchCatalogSheet('modal-adopt-product', 'branch-adopt-product')"));
  assert.ok(branchCatalogJs.includes("requestBranchTextInput({ title: 'Tambah Kategori Cabang'"));
  assert.ok(dashboardJs.includes("requestTextInputSheet({ title: 'Tambah Kategori Cabang'"));
  assert.ok(dashboardJs.includes("requestTextInputSheet({ title: 'Tolak Pesanan'"));
});

test('PRES-14: Owner Dashboard destructive confirmations do not use native confirm()', () => {
  const dashboardWithoutHelper = dashboardJs.replace(/function confirmFeatureAction[\s\S]*?\n  }\n/, '');
  const branchWithoutHelper = branchCatalogJs.replace(/async function confirmBranchCatalogAction[\s\S]*?\n  }\n/, '');
  assert.equal((dashboardWithoutHelper.match(/(?<![.\w])confirm\s*\(/g) || []).length, 0);
  assert.equal((branchWithoutHelper.match(/(?<![.\w])confirm\s*\(/g) || []).length, 0);
});

test('PRES-15: Owner Dashboard no longer uses native prompt() for feature input', () => {
  const dashboardWithoutHelper = dashboardJs.replace(/function requestTextInputSheet[\s\S]*?\n  }\n/, '');
  const branchWithoutHelper = branchCatalogJs.replace(/function requestBranchTextInput[\s\S]*?\n  }\n/, '');
  assert.equal((dashboardWithoutHelper.match(/\bprompt\s*\(/g) || []).length, 0);
  assert.equal((branchWithoutHelper.match(/\bprompt\s*\(/g) || []).length, 0);
});

test('PRES-16: Owner Dashboard keeps legacy modal markup only as feature content composed by XentraPresentation', () => {
  assert.ok(dashboardHtml.includes('id="modal-master-menu-components"'));
  assert.ok(dashboardHtml.includes('id="modal-adopt-product"'));
  assert.ok(dashboardJs.includes("openExistingCardInPresentation('modal-master-menu-components'"));
  assert.ok(branchCatalogJs.includes("openBranchCatalogSheet('modal-adopt-product'"));
});
