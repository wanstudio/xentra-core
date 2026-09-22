'use strict';

/**
 * Kitchen surface extraction.
 *
 * Proves the kitchen UI now lives in its own app, that it reuses the shared
 * contract and existing Core endpoints instead of duplicating logic, and that
 * the legacy surfaces no longer drive the kitchen stages of the order
 * lifecycle.
 *
 * Authority contract (unchanged):
 *   Kitchen        confirmed → preparing → ready
 *   Branch Manager pending → confirmed/rejected  + dispatch (ready → out_for_delivery)
 *   Driver         pickup → on_delivery → delivered (delivery-job lifecycle)
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

test('KITCHEN APP EXTRACTION — dedicated surface, no legacy KDS', async (t) => {

  await t.test('1. the kitchen app exists as its own entry point', () => {
    assert.ok(exists('apps/kitchen-app/index.html'), 'apps/kitchen-app/index.html must exist');
    assert.ok(exists('apps/kitchen-app/assets/js/kitchen-app.js'), 'kitchen-app.js must exist');
    assert.ok(exists('apps/kitchen-app/assets/css/kitchen-app.css'), 'kitchen-app.css must exist');
  });

  await t.test('2. the kitchen shell is its own UX, not the merchant/owner shell', () => {
    assert.ok(KITCHEN_HTML.includes('kds-board'), 'must render a kitchen board');
    ['x-dash-nav', 'x-dash-sidebar', 'x-dash-topbar', 'x-branch-selector'].forEach((shellId) => {
      assert.ok(!KITCHEN_HTML.includes(shellId), 'kitchen shell must not reuse the merchant shell (' + shellId + ')');
    });
  });

  await t.test('3. it reuses the shared contract instead of duplicating infrastructure', () => {
    assert.ok(KITCHEN_HTML.includes('/merchant-shared/css/shared.css'), 'must load shared css');
    assert.ok(KITCHEN_HTML.includes('/merchant-shared/js/shared.js'), 'must load shared js');
    assert.ok(KITCHEN_JS.includes('window.XentraShared'), 'must consume the shared auth/DOM helpers');
    assert.ok(!KITCHEN_JS.includes('localStorage.getItem'), 'must not re-implement session storage');
    assert.ok(!KITCHEN_JS.includes('function showToast'), 'must not re-implement shared UI helpers');
  });

  await t.test('4. it uses the existing Core endpoints and only the kitchen transitions', () => {
    assert.ok(KITCHEN_JS.includes("'/kitchen/queue'"), 'must read the existing kitchen queue endpoint');
    assert.ok(KITCHEN_JS.includes("'/kitchen/orders/'"), 'must use the existing kitchen status endpoint');
    assert.ok(KITCHEN_JS.includes("advance(order, 'preparing')") ||
              KITCHEN_JS.includes("action: 'preparing'"), 'kitchen must drive confirmed → preparing');
    assert.ok(KITCHEN_JS.includes("action: 'ready'"), 'kitchen must drive preparing → ready');
    ['out_for_delivery', "'completed'", 'branch-acceptance'].forEach((forbidden) => {
      assert.ok(!KITCHEN_JS.includes(forbidden),
        'kitchen surface must not offer ' + forbidden + ' (not a kitchen authority)');
    });
  });

  await t.test('5. the server serves the kitchen app with the same tenant guard', () => {
    assert.ok(APP_SERVER.includes("'/kitchen-app/assets'"), '/kitchen-app/assets must be mounted');
    assert.ok(APP_SERVER.includes('../apps/kitchen-app/index.html'), '/kitchen-app must serve the kitchen entry');
    assert.ok(/\\\/kitchen-app\(/i.test(APP_SERVER) || APP_SERVER.includes('/^\\/kitchen-app'),
      'a /kitchen-app route must exist');
  });

  await t.test('6. kitchen staff are routed to the kitchen app after login', () => {
    assert.ok(DASHBOARD_JS.includes("window.location.replace('/kitchen-app/')"),
      'dashboard boot must send the kitchen role to /kitchen-app');
    assert.ok(LOGIN_HTML.includes("'/kitchen-app/'"),
      'login must send the kitchen role straight to /kitchen-app');
  });

  await t.test('7. legacy surfaces no longer drive the kitchen stages', () => {
    // merchant-app (Branch Manager)
    assert.ok(!MERCHANT_APP_JS.includes("confirmed: 'preparing'"),
      'BM surface must not map confirmed → preparing');
    assert.ok(!MERCHANT_APP_JS.includes("preparing: 'ready'"),
      'BM surface must not map preparing → ready');
    ['Mulai Masak', 'Tandai Siap', 'Mulai Memasak'].forEach((label) => {
      assert.ok(!MERCHANT_APP_JS.includes(label), 'BM surface must not expose the kitchen action "' + label + '"');
    });
    assert.ok(MERCHANT_APP_JS.includes("ready: isDelivery ? 'out_for_delivery' : 'completed'"),
      'BM surface keeps dispatch only');

    // Owner dashboard
    assert.ok(!DASHBOARD_JS.includes("confirmed: 'preparing'"),
      'Owner surface must not map confirmed → preparing');
    assert.ok(DASHBOARD_JS.includes("var canAdvance = ord.status === 'pending'"),
      'Owner order actions are limited to the acceptance exception path');
  });

  await t.test('8. the orphaned kitchen-display prototype is gone', () => {
    assert.ok(!exists('apps/kitchen-display'), 'apps/kitchen-display must be removed (superseded by kitchen-app)');
  });
});
