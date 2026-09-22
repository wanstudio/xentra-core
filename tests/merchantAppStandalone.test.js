'use strict';

/**
 * Merchant App extraction — standalone surface contract.
 *
 * Verifies apps/merchant-app is a self-contained Branch Manager entry point:
 * it boots on its own, renders only Branch Manager surfaces, reuses
 * merchant-shared, enforces a single polling timer and keeps the Order Center
 * behaviour from the BM-2 work intact.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'apps/merchant-app/index.html');
const JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/merchant-app.js');
const SHARED_JS_PATH = path.join(ROOT, 'apps/merchant-shared/js/shared.js');
const BRANCH_CATALOG_JS_PATH = path.join(ROOT, 'apps/merchant-shared/js/branch-catalog.js');

const BM_ROUTES = [
  'hari-ini', 'pesanan', 'meja', 'menu', 'promo', 'stok', 'staff', 'reports', 'jam-operasional'
];

test('MERCHANT APP — standalone branch manager surface', async (t) => {

  await t.test('1. boots standalone with BM navigation, no Owner/Platform DOM, one polling timer', async () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const dom = new JSDOM(html, {
      url: 'https://app.mybangjo.com/merchant-app/',
      runScripts: 'dangerously'
    });
    const win = dom.window;

    win.localStorage.setItem('xentra_merchant_token', 'test-token');
    win.localStorage.setItem('xentra_merchant_user', JSON.stringify({
      id: 'u-bm-1',
      role: 'branch_manager',
      branch_id: 'branch_bangjo_barat',
      branch_name: 'Bangjo Barat'
    }));
    win.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
      text: async () => '{}'
    });

    // Track ACTIVE interval timers (duplicate pollers would accumulate here).
    const active = new Set();
    const origSetInterval = win.setInterval.bind(win);
    const origClearInterval = win.clearInterval.bind(win);
    win.setInterval = function (...args) { const id = origSetInterval(...args); active.add(id); return id; };
    win.clearInterval = function (id) { active.delete(id); return origClearInterval(id); };

    win.eval(fs.readFileSync(SHARED_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(BRANCH_CATALOG_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(JS_PATH, 'utf8'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await new Promise((r) => setTimeout(r, 200));

    const routes = Array.from(win.document.querySelectorAll('#x-dash-nav .x-nav-item'))
      .map((b) => b.dataset.route);
    assert.deepEqual(routes, BM_ROUTES, 'merchant-app nav must expose exactly the Branch Manager routes');

    const activeTab = win.document.querySelector('.x-tab-content.active');
    assert.ok(activeTab, 'a tab section must be active after boot');
    assert.equal(activeTab.id, 'tab-hari-ini', 'default BM route is Hari Ini');
    assert.equal(active.size, 0, 'Hari Ini must not run a polling timer');

    ['tab-overview', 'tab-platform-overview', 'panel-owner-catalog', 'x-branch-selector', 'modal-mkt-promotion']
      .forEach((id) => {
        assert.equal(win.document.getElementById(id), null, id + ' must not exist in the Merchant App surface');
      });

    // Switching to the order queue starts exactly one poller (no duplicates).
    win.navigateTo('pesanan');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(
      (win.document.querySelector('.x-tab-content.active') || {}).id,
      'tab-bm-pesanan',
      'Pesanan route activates the BM order queue'
    );
    assert.equal(active.size, 1, 'exactly one polling timer is active on the order queue');

    win.navigateTo('stok');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(active.size, 0, 'leaving the order queue stops the polling timer');

    win.close();
  });

  await t.test('2. index.html is self-contained (no merchant-dashboard asset dependency)', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert.ok(!/\/dashboard\/assets\//.test(html), 'must not load merchant-dashboard assets');
    assert.ok(html.includes('/merchant-shared/css/shared.css'), 'must load merchant-shared css');
    assert.ok(html.includes('/merchant-shared/css/dashboard.css'), 'must load the shared surface stylesheet');
    assert.ok(html.includes('/merchant-shared/js/shared.js'), 'must load shared.js');
    assert.ok(html.includes('/merchant-shared/js/branch-catalog.js'), 'must load branch-catalog.js');
    assert.ok(html.includes('/merchant-app/assets/js/merchant-app.js'), 'must load merchant-app.js');
  });

  await t.test('3. Order Center behaviour from BM-2 is preserved', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    assert.ok(js.includes('bm-order-card-attention'), 'mobile attention card styling hook');
    assert.ok(js.includes('playNewOrderAudibleChime'), 'audible new-order chime');
    assert.ok(js.includes('seenPendingOrderIds'), 'diff-based new order detection');
    assert.ok(js.includes('acceptance_deadline_at'), 'acceptance deadline comes from the server field');
    assert.ok(!js.includes('ACCEPTANCE_WINDOW_MS'), 'no local deadline reconstruction');
    assert.ok(!js.includes('+ 180000'), 'no hard-coded acceptance window');
    assert.ok(js.includes('/branch-acceptance'), 'ACCEPT goes through the dedicated branch-acceptance endpoint');
  });

  await t.test('4. Merchant App is served at /merchant-app without changing /dashboard', () => {
    const appSource = fs.readFileSync(path.join(ROOT, 'server/app.js'), 'utf8');
    assert.ok(appSource.includes("'/merchant-app/assets'"), '/merchant-app/assets must be mounted');
    assert.ok(appSource.includes('../apps/merchant-app/index.html'), '/merchant-app must serve the Merchant App entry');
    assert.ok(
      appSource.includes('../apps/merchant-dashboard/index.html'),
      '/dashboard must keep serving the legacy Owner dashboard'
    );
  });
});
