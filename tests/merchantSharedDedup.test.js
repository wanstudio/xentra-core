'use strict';

/**
 * Merchant shared layer — boundary contract.
 *
 * Shared infrastructure stays in merchant-shared; surface-specific catalog UI
 * belongs to the owning app.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const DASHBOARD_JS = read('apps/merchant-dashboard/assets/js/dashboard.js');
const MERCHANT_APP_JS = read('apps/merchant-app/assets/js/merchant-app.js');
const MERCHANT_MENU_JS = read('apps/merchant-app/assets/js/menu.js');
const SHARED_JS = read('apps/merchant-shared/js/shared.js');
const ACTION_MENU_JS = read('apps/merchant-shared/js/action-menu.js');
const CROP_EDITOR_JS = read('apps/merchant-shared/js/crop-editor.js');
const CATALOG_CLIENT_JS = read('apps/merchant-shared/js/catalog-client.js');
const OWNER_CATALOG_UI_JS = read('apps/merchant-dashboard/assets/js/branch-catalog-ui.js');
const MERCHANT_CATALOG_UI_JS = read('apps/merchant-app/assets/js/branch-catalog-ui.js');
const DASHBOARD_HTML = read('apps/merchant-dashboard/index.html');
const MERCHANT_APP_HTML = read('apps/merchant-app/index.html');

test('MERCHANT SHARED — boundary ownership', async (t) => {
  await t.test('1. generic shared primitives remain dedicated', () => {
    assert.ok(ACTION_MENU_JS.includes('window.XentraActionMenu = XentraActionMenu'));
    assert.ok(CROP_EDITOR_JS.includes('window.XentraCropEditor = XentraCropEditor'));
    assert.ok(!SHARED_JS.includes('var XentraActionMenu = (function'));
    assert.ok(!SHARED_JS.includes('var XentraCropEditor = (function'));
    assert.ok(!DASHBOARD_JS.includes('var XentraActionMenu = (function'));
    assert.ok(!DASHBOARD_JS.includes('var XentraCropEditor = (function'));
    assert.ok(!MERCHANT_APP_JS.includes('var XentraActionMenu = (function'));
    assert.ok(!MERCHANT_APP_JS.includes('var XentraCropEditor = (function'));
  });

  await t.test('2. catalog transport is shared once and UI is not in generic shared', () => {
    assert.ok(CATALOG_CLIENT_JS.includes('window.XentraCatalogClient'));
    [
      'getBranchCatalog',
      'setBranchProductAvailability',
      'removeBranchProduct',
      'uploadBranchProductImage',
      'updateBranchProductOverride',
      'createBranchCategory',
      'updateBranchCategory',
      'uploadBranchCategoryImage',
      'deleteBranchCategory',
      'reorderBranchCategories',
      'adoptProduct'
    ].forEach((fn) => assert.match(CATALOG_CLIENT_JS, new RegExp('function ' + fn + '\(')));

    assert.doesNotMatch(CATALOG_CLIENT_JS, /document\.getElementById|innerHTML|XentraCropEditor/);
    assert.doesNotMatch(SHARED_JS, /BranchCatalog|branch catalog/i);
  });

  await t.test('3. surface-owned catalog UI is physically separated', () => {
    assert.ok(OWNER_CATALOG_UI_JS.includes('window.XentraOwnerBranchCatalog'));
    assert.ok(MERCHANT_CATALOG_UI_JS.includes('window.XentraMerchantBranchCatalog'));

    [
      'openBranchCatalogModal',
      'closeBranchCatalogModal',
      'renderBranchAdoptedProducts',
      'renderBranchAvailableMasterProducts',
      'openAdoptModal',
      'closeAdoptModal'
    ].forEach((fn) => {
      assert.match(OWNER_CATALOG_UI_JS, new RegExp(fn.replace('$','\\$')));
      assert.doesNotMatch(MERCHANT_CATALOG_UI_JS, new RegExp(fn.replace('$','\\$')));
    });

    [
      'loadInlineBranchCatalog',
      'renderInlineCategoriesBar',
      'renderInlineAdoptedProducts',
      'renderInlineAvailableProducts',
      'openBranchCategoryCreateModal',
      'openBranchCategoryEditModal',
      'openBranchOverrideModal',
      'saveBranchProductOverride'
    ].forEach((fn) => {
      assert.match(MERCHANT_CATALOG_UI_JS, new RegExp(fn.replace('$','\\$')));
      assert.doesNotMatch(CATALOG_CLIENT_JS, new RegExp(fn.replace('$','\\$')));
    });
  });

  await t.test('4. consumer surfaces use their own catalog UI namespace', () => {
    assert.ok(DASHBOARD_JS.includes('XentraOwnerBranchCatalog'));
    assert.ok(MERCHANT_MENU_JS.includes('XentraMerchantBranchCatalog'));
    assert.ok(!DASHBOARD_JS.includes('window.XentraBranchCatalog'));
    assert.ok(!MERCHANT_MENU_JS.includes('window.XentraBranchCatalog'));
  });

  await t.test('5. script load order matches the new ownership boundaries', () => {
    const assertLoadOrder = (html, surfacePath, label, surfaceModule) => {
      const shared = html.indexOf('/merchant-shared/js/shared.js');
      const action = html.indexOf('/merchant-shared/js/action-menu.js');
      const crop = html.indexOf('/merchant-shared/js/crop-editor.js');
      const client = html.indexOf('/merchant-shared/js/catalog-client.js');
      const ui = html.indexOf(surfaceModule);
      const surface = html.indexOf(surfacePath);
      assert.ok(shared >= 0 && action >= 0 && crop >= 0 && client >= 0 && ui >= 0 && surface >= 0, label + ' missing required scripts');
      assert.ok(shared < action && action < crop && crop < client && client < ui && ui < surface,
        label + ' must load shared primitives, catalog client, surface catalog UI, then surface JS');
    };

    assertLoadOrder(
      DASHBOARD_HTML,
      '/dashboard/assets/js/dashboard.js',
      'merchant-dashboard',
      '/merchant-dashboard/assets/js/branch-catalog-ui.js'
    );
    assertLoadOrder(
      MERCHANT_APP_HTML,
      '/merchant-app/assets/js/merchant-app.js',
      'merchant-app',
      '/merchant-app/assets/js/branch-catalog-ui.js'
    );

    assert.ok(!/\/dashboard\/assets\//.test(MERCHANT_APP_HTML));
  });
});
