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
const BRANCH_CATALOG_JS = read('apps/merchant-shared/js/branch-catalog.js');
const DASHBOARD_HTML = read('apps/merchant-dashboard/index.html');
const MERCHANT_APP_HTML = read('apps/merchant-app/index.html');

test('MERCHANT SHARED — single source, no duplication', async (t) => {

  await t.test('1. shared widgets are defined once, in merchant-shared', () => {
    assert.ok(SHARED_JS.includes('window.XentraActionMenu = XentraActionMenu'), 'shared.js owns XentraActionMenu');
    assert.ok(SHARED_JS.includes('window.XentraCropEditor = XentraCropEditor'), 'shared.js owns XentraCropEditor');

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

  await t.test('5. both surfaces load the shared layer in the same order', () => {
    const legacyOrder = DASHBOARD_HTML.indexOf('/merchant-shared/js/shared.js') <
      DASHBOARD_HTML.indexOf('/merchant-shared/js/branch-catalog.js') &&
      DASHBOARD_HTML.indexOf('/merchant-shared/js/branch-catalog.js') <
      DASHBOARD_HTML.indexOf('/dashboard/assets/js/dashboard.js');
    assert.ok(legacyOrder, 'merchant-dashboard must load shared.js, branch-catalog.js, then dashboard.js');

    const appOrder = MERCHANT_APP_HTML.indexOf('/merchant-shared/js/shared.js') <
      MERCHANT_APP_HTML.indexOf('/merchant-shared/js/branch-catalog.js') &&
      MERCHANT_APP_HTML.indexOf('/merchant-shared/js/branch-catalog.js') <
      MERCHANT_APP_HTML.indexOf('/merchant-app/assets/js/merchant-app.js');
    assert.ok(appOrder, 'merchant-app must load shared.js, branch-catalog.js, then merchant-app.js');

    assert.ok(
      !/\/dashboard\/assets\//.test(MERCHANT_APP_HTML),
      'merchant-app must not depend on merchant-dashboard assets'
    );
  });
});
