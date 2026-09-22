'use strict';

/**
 * KDS Add-on boundary.
 *
 * MVP:
 *   Branch Manager operates the required order flow from Merchant App,
 *   including confirmed → preparing → ready.
 *
 * Future:
 *   apps/kitchen-app may become the dedicated Kitchen surface when the
 *   KDS SaaS feature entitlement is enabled for a branch.
 *
 * No active KDS login/route is required in MVP.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const KITCHEN_HTML = read('apps/kitchen-app/index.html');
const KITCHEN_JS = read('apps/kitchen-app/assets/js/kitchen-app.js');
const MERCHANT_APP_JS = read('apps/merchant-app/assets/js/merchant-app.js');
const DASHBOARD_JS = read('apps/merchant-dashboard/assets/js/dashboard.js');
const LOGIN_HTML = read('apps/merchant-dashboard/login.html');
const APP_SERVER = read('server/app.js');

test('KDS ADD-ON BOUNDARY — held/future surface, MVP stays in Merchant App', async (t) => {
  await t.test('1. held/future KDS artifact exists but is not the MVP surface', () => {
    assert.ok(exists('apps/kitchen-app/index.html'), 'future KDS entry artifact must exist');
    assert.ok(exists('apps/kitchen-app/assets/js/kitchen-app.js'), 'future KDS JS must exist');
    assert.ok(exists('apps/kitchen-app/assets/css/kitchen-app.css'), 'future KDS CSS must exist');
  });

  await t.test('2. future KDS keeps a dedicated kitchen UX', () => {
    assert.ok(KITCHEN_HTML.includes('kds-board'), 'future KDS must retain its own board');
    ['x-dash-nav', 'x-dash-sidebar', 'x-dash-topbar', 'x-branch-selector'].forEach((shellId) => {
      assert.ok(!KITCHEN_HTML.includes(shellId), 'future KDS must not reuse merchant shell (' + shellId + ')');
    });
  });

  await t.test('3. future KDS reuses shared infrastructure and Core endpoints', () => {
    assert.ok(KITCHEN_HTML.includes('/merchant-shared/css/shared.css'));
    assert.ok(KITCHEN_HTML.includes('/merchant-shared/js/shared.js'));
    assert.ok(KITCHEN_JS.includes('window.XentraShared'));
    assert.ok(KITCHEN_JS.includes("'/kitchen/queue'"));
    assert.ok(KITCHEN_JS.includes("'/kitchen/orders/'"));
  });

  await t.test('4. MVP has no active KDS server route', () => {
    assert.ok(!APP_SERVER.includes("'/kitchen-app/assets'"), 'KDS assets must not be mounted as an active MVP route');
    assert.ok(!APP_SERVER.includes('../apps/kitchen-app/index.html'), 'KDS entry must not be served as an active MVP route');
  });

  await t.test('5. login/dashboard do not force kitchen staff into a separate KDS login', () => {
    assert.ok(!LOGIN_HTML.includes("'/kitchen-app/'"), 'login must not redirect kitchen role to KDS');
    assert.ok(!DASHBOARD_JS.includes("window.location.replace('/kitchen-app/')"), 'dashboard must not redirect kitchen role to KDS');
  });

  await t.test('6. Merchant App owns the MVP kitchen-stage actions', () => {
    assert.ok(MERCHANT_APP_JS.includes("confirmed: 'preparing'"), 'BM must drive confirmed → preparing in MVP');
    assert.ok(MERCHANT_APP_JS.includes("preparing: 'ready'"), 'BM must drive preparing → ready in MVP');
    assert.ok(MERCHANT_APP_JS.includes('Mulai Masak'), 'BM must expose Mulai Masak');
    assert.ok(MERCHANT_APP_JS.includes('Tandai Siap'), 'BM must expose Tandai Siap');
    assert.ok(MERCHANT_APP_JS.includes("ready: isDelivery ? 'out_for_delivery' : 'completed'"), 'BM keeps dispatch/completion behavior');
  });

  await t.test('7. future KDS remains kitchen-only for its own authority', () => {
    assert.ok(KITCHEN_JS.includes("action: 'preparing'"));
    assert.ok(KITCHEN_JS.includes("action: 'ready'"));
    ['out_for_delivery', "'completed'", 'branch-acceptance'].forEach((forbidden) => {
      assert.ok(!KITCHEN_JS.includes(forbidden), 'future KDS must not offer ' + forbidden);
    });
  });

  await t.test('8. no stale kitchen-display legacy path remains', () => {
    assert.ok(!exists('apps/kitchen-display'), 'legacy kitchen-display path must remain absent');
  });
});
