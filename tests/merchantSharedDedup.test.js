'use strict';

/**
 * Merchant shared layer — single-source contract.
 *
 * Guards the extraction invariant: shared infrastructure lives once in
 * apps/merchant-shared and every surface consumes it instead of keeping
 * private copies.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const DASHBOARD_JS = read('apps/merchant-dashboard/assets/js/dashboard.js');
const MERCHANT_APP_JS = read('apps/merchant-app/assets/js/merchant-app.js');
const SHARED_JS = read('apps/merchant-shared/js/shared.js');
const ACTION_MENU_JS = read('apps/merchant-shared/js/action-menu.js');
const CROP_EDITOR_JS = read('apps/merchant-shared/js/crop-editor.js');
const BRANCH_CATALOG_JS = read('apps/merchant-shared/js/branch-catalog.js');
const DASHBOARD_HTML = read('apps/merchant-dashboard/index.html');
const MERCHANT_APP_HTML = read('apps/merchant-app/index.html');

test('MERCHANT SHARED — single source, no duplication', async (t) => {

  await t.test('1. shared primitives are defined once in dedicated merchant-shared modules', () => {
    assert.ok(ACTION_MENU_JS.includes('window.XentraActionMenu = XentraActionMenu'), 'action-menu.js owns XentraActionMenu');
    assert.ok(CROP_EDITOR_JS.includes('window.XentraCropEditor = XentraCropEditor'), 'crop-editor.js owns XentraCropEditor');
    assert.ok(!SHARED_JS.includes('var XentraActionMenu = (function'), 'shared.js must not own XentraActionMenu');
    assert.ok(!SHARED_JS.includes('var XentraCropEditor = (function'), 'shared.js must not own XentraCropEditor');

    assert.ok(!DASHBOARD_JS.includes('var XentraActionMenu = (function'), 'dashboard.js must not redefine XentraActionMenu');
    assert.ok(!DASHBOARD_JS.includes('var XentraCropEditor = (function'), 'dashboard.js must not redefine XentraCropEditor');
    assert.ok(!MERCHANT_APP_JS.includes('var XentraActionMenu = (function'), 'merchant-app.js must not redefine XentraActionMenu');
    assert.ok(!MERCHANT_APP_JS.includes('var XentraCropEditor = (function'), 'merchant-app.js must not redefine XentraCropEditor');
  });

  await t.test('2. auth/session guards are defined once, in merchant-shared', () => {
    ['isBranchManager', 'checkAuth', 'handleHandoffExchange', 'validateServerSession'].forEach((fn) => {
      assert.ok(
        new RegExp('function ' + fn + '\\(').test(SHARED_JS),
        'shared.js must define ' + fn
      );
      assert.ok(
        !new RegExp('(async )?function ' + fn + '\\(').test(DASHBOARD_JS),
        'dashboard.js must not redefine ' + fn
      );
      assert.ok(
        !new RegExp('(async )?function ' + fn + '\\(').test(MERCHANT_APP_JS),
        'merchant-app.js must not redefine ' + fn
      );
    });
  });

  await t.test('3. branch catalog helpers are defined once, in merchant-shared', () => {
    ['getActiveBranchId', 'loadInlineBranchCatalog', 'renderInlineAdoptedProducts', 'renderInlineAvailableProducts']
      .forEach((fn) => {
        assert.ok(
          new RegExp('function ' + fn + '\\(').test(BRANCH_CATALOG_JS),
          'branch-catalog.js must define ' + fn
        );
        assert.ok(
          !new RegExp('(async )?function ' + fn + '\\(').test(DASHBOARD_JS),
          'dashboard.js must not redefine ' + fn
        );
        assert.ok(
          !new RegExp('(async )?function ' + fn + '\\(').test(MERCHANT_APP_JS),
          'merchant-app.js must not redefine ' + fn
        );
      });

    assert.ok(
      !DASHBOARD_JS.includes('var currentManagingBranchId = null'),
      'branch catalog state must not be redeclared in dashboard.js'
    );
    assert.ok(
      BRANCH_CATALOG_JS.includes('window.XentraBranchCatalog'),
      'branch-catalog.js must expose XentraBranchCatalog'
    );
  });

  await t.test('4. merchant-app contains only Branch Manager surfaces', () => {
    assert.ok(
      !MERCHANT_APP_JS.includes('PLATFORM_ROUTE_META'),
      'merchant-app.js must not contain Platform routing'
    );
    assert.ok(
      !MERCHANT_APP_JS.includes('renderPlatformNavigation'),
      'merchant-app.js must not contain Platform navigation'
    );
    ['tab-overview', 'tab-platform-overview', 'panel-owner-catalog'].forEach((id) => {
      assert.ok(
        !MERCHANT_APP_HTML.includes('id="' + id + '"'),
        'merchant-app/index.html must not contain ' + id
      );
    });
  });

  await t.test('5. both surfaces load shared primitives before branch catalog/surface code', () => {
    function assertLoadOrder(html, surfaceJsPath, label) {
      const shared = html.indexOf('/merchant-shared/js/shared.js');
      const action = html.indexOf('/merchant-shared/js/action-menu.js');
      const crop = html.indexOf('/merchant-shared/js/crop-editor.js');
      const catalog = html.indexOf('/merchant-shared/js/branch-catalog.js');
      const surface = html.indexOf(surfaceJsPath);

      assert.ok(shared >= 0 && action >= 0 && crop >= 0 && catalog >= 0 && surface >= 0, label + ' must load all required scripts');
      assert.ok(shared < action && action < crop && crop < catalog && catalog < surface,
        label + ' must load shared.js, action-menu.js, crop-editor.js, branch-catalog.js, then surface JS');
    }

    assertLoadOrder(DASHBOARD_HTML, '/dashboard/assets/js/dashboard.js', 'merchant-dashboard');
    assertLoadOrder(MERCHANT_APP_HTML, '/merchant-app/assets/js/merchant-app.js', 'merchant-app');

    assert.ok(
      !/\/dashboard\/assets\//.test(MERCHANT_APP_HTML),
      'merchant-app must not depend on merchant-dashboard assets'
    );
  });
});
