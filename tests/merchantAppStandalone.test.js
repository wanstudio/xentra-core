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
const ORDER_JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/orders.js');
const HARI_INI_JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/hari-ini.js');
const JAM_OPERASIONAL_JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/jam-operasional.js');
const REPORTS_JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/reports.js');
const TABLES_JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/tables.js');
const CONTEXT_JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/context.js');
const MENU_JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/menu.js');
const STOCK_JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/stock.js');
const PROMOTIONS_JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/promotions.js');
const STAFF_JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/staff.js');
const SHARED_JS_PATH = path.join(ROOT, 'apps/merchant-shared/js/shared.js');
const BRANCH_CATALOG_JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/branch-catalog-ui.js');

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
    win.eval(fs.readFileSync(CONTEXT_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(MENU_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(HARI_INI_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(JAM_OPERASIONAL_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(REPORTS_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(TABLES_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(STOCK_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(PROMOTIONS_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(STAFF_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(ORDER_JS_PATH, 'utf8'));
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
    assert.ok(html.includes('/merchant-shared/js/branch-catalog-ui.js'), 'must load branch-catalog-ui.js');
    assert.ok(html.includes('/merchant-app/assets/js/context.js'), 'must load context.js');
    assert.ok(html.includes('/merchant-app/assets/js/menu.js'), 'must load menu.js');
    assert.ok(html.includes('/merchant-app/assets/js/hari-ini.js'), 'must load hari-ini.js');
    assert.ok(html.includes('/merchant-app/assets/js/jam-operasional.js'), 'must load jam-operasional.js');
    assert.ok(html.includes('/merchant-app/assets/js/reports.js'), 'must load reports.js');
    assert.ok(html.includes('/merchant-app/assets/js/tables.js'), 'must load tables.js');
    assert.ok(html.includes('/merchant-app/assets/js/stock.js'), 'must load stock.js');
    assert.ok(html.includes('/merchant-app/assets/js/promotions.js'), 'must load promotions.js');
    assert.ok(html.includes('/merchant-app/assets/js/staff.js'), 'must load staff.js');
    assert.ok(html.includes('/merchant-app/assets/js/orders.js'), 'must load orders.js');
    assert.ok(html.includes('/merchant-app/assets/js/merchant-app.js'), 'must load merchant-app.js');
  });

  await t.test('2i. Staff module is the canonical implementation', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const staffJs = fs.readFileSync(STAFF_JS_PATH, 'utf8');

    for (const name of [
      'loadBMStaff',
      'renderBMStaffTable',
      'openBMAddCashierModal',
      'toggleBMStaffStatus',
      'resetBMStaffPassword'
    ]) {
      const count = (staffJs.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g')) || []).length;
      assert.equal(count, 1, name + ' must have exactly one implementation in staff.js');
      assert.ok(!js.includes('function ' + name + '(') && !js.includes('async function ' + name + '('),
        name + ' must not be implemented in merchant-app.js');
    }

    assert.ok(staffJs.includes('var _bmStaffState = {'), '_bmStaffState must live in staff.js');
    assert.ok(!js.includes('var _bmStaffState = {'), '_bmStaffState must not live in merchant-app.js');
  });

  await t.test('2h. Promotions module is the canonical implementation', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const promoJs = fs.readFileSync(PROMOTIONS_JS_PATH, 'utf8');

    for (const name of [
      'loadBMPromotions',
      'updateBMPromoStats',
      'renderBMPromotionsList',
      'toggleBMPromoActivation',
      'renderBMRedemptionsTable'
    ]) {
      const count = (promoJs.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g')) || []).length;
      assert.equal(count, 1, name + ' must have exactly one implementation in promotions.js');
      assert.ok(!js.includes('function ' + name + '(') && !js.includes('async function ' + name + '('),
        name + ' must not be implemented in merchant-app.js');
    }

    assert.ok(promoJs.includes('var _bmPromoState = {'), '_bmPromoState must live in promotions.js');
    assert.ok(!js.includes('var _bmPromoState = {'), '_bmPromoState must not live in merchant-app.js');
  });

  await t.test('2g. Stock module is the canonical implementation', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const stockJs = fs.readFileSync(STOCK_JS_PATH, 'utf8');

    for (const name of [
      'loadBMStock',
      'updateBMStockStats',
      'onBMStockFilterChange',
      'renderBMStockTable',
      'openBMStockAdjustmentModal',
      'closeBMStockAdjustModal',
      'onBMAdjustTypeChange',
      'submitBMStockAdjustment'
    ]) {
      const count = (stockJs.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g')) || []).length;
      assert.equal(count, 1, name + ' must have exactly one implementation in stock.js');
      assert.ok(!js.includes('function ' + name + '(') && !js.includes('async function ' + name + '('),
        name + ' must not be implemented in merchant-app.js');
    }

    assert.ok(stockJs.includes('var _bmStockState = {'), '_bmStockState must live in stock.js');
    assert.ok(!js.includes('var _bmStockState = {'), '_bmStockState must not live in merchant-app.js');
  });

  await t.test('2f. Menu module owns menu state/controller and tables consume shared branch context', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const menuJs = fs.readFileSync(MENU_JS_PATH, 'utf8');
    const tablesJs = fs.readFileSync(TABLES_JS_PATH, 'utf8');
    const contextJs = fs.readFileSync(CONTEXT_JS_PATH, 'utf8');

    for (const name of [
      'loadBMMenu',
      'updateBMMenuStats',
      'onBMMenuFilterChange',
      'setBMMenuCategoryFilter',
      'renderBMMenuCategoriesBar',
      'renderBMMenuTable',
      'toggleBMProductAvailability',
      'updateBMAddCatalogFooter',
      'renderBMAddCatalogList',
      'saveBMBranchCategoryOrder'
    ]) {
      const count = (menuJs.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g')) || []).length;
      assert.equal(count, 1, name + ' must have exactly one implementation in menu.js');
      assert.ok(!js.includes('function ' + name + '(') && !js.includes('async function ' + name + '('),
        name + ' must not be implemented in merchant-app.js');
    }

    assert.ok(menuJs.includes('var _bmMenuState = {'), '_bmMenuState must live in menu.js');
    assert.ok(!js.includes('var _bmMenuState = {'), '_bmMenuState must not live in merchant-app.js');
    assert.ok(contextJs.includes('window.getBMTargetBranchId = getBMTargetBranchId;'),
      'branch context resolver must be exported explicitly');
    assert.ok(tablesJs.includes('getBMTargetBranchId()'),
      'tables module must use the shared branch context resolver');
    assert.ok(!tablesJs.includes('function getBMTargetBranchId()'),
      'tables module must not own the shared branch context resolver');
  });

  await t.test('2e. Tables module is the canonical implementation', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const tablesJs = fs.readFileSync(TABLES_JS_PATH, 'utf8');

    for (const name of [
      'loadBMTables',
      'updateBMTableStats',
      'onBMTablesFilterChange',
      'renderBMTablesGrid',
      'openBMTableQr',
      'showBMTableQrOverlay',
      'printBMTableQr',
      'toggleBMTableBlocked',
      'completeBMTableSession'
    ]) {
      const count = (tablesJs.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g')) || []).length;
      assert.equal(count, 1, name + ' must have exactly one implementation in tables.js');
      assert.ok(!js.includes('function ' + name + '(') && !js.includes('async function ' + name + '('),
        name + ' must not be implemented in merchant-app.js');
    }

    assert.ok(tablesJs.includes('var _bmTablesState = {'), '_bmTablesState must live in tables.js');
    assert.ok(!js.includes('var _bmTablesState = {'), '_bmTablesState must not live in merchant-app.js');
  });

  await t.test('2d. Reports module is the canonical implementation', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const reportsJs = fs.readFileSync(REPORTS_JS_PATH, 'utf8');

    const count = (reportsJs.match(/async function loadBMReports\s*\(/g) || []).length;
    assert.equal(count, 1, 'loadBMReports must have exactly one implementation in reports.js');
    assert.ok(!js.includes('async function loadBMReports(') && !js.includes('function loadBMReports('),
      'loadBMReports must not be implemented in merchant-app.js');
  });

  await t.test('2c. Jam Operasional module is the canonical implementation', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const jamJs = fs.readFileSync(JAM_OPERASIONAL_JS_PATH, 'utf8');

    const count = (jamJs.match(/async function loadBMJamOperasional\s*\(/g) || []).length;
    assert.equal(count, 1, 'loadBMJamOperasional must have exactly one implementation in jam-operasional.js');
    assert.ok(!js.includes('async function loadBMJamOperasional(') && !js.includes('function loadBMJamOperasional('),
      'loadBMJamOperasional must not be implemented in merchant-app.js');
  });

  await t.test('2a. Hari Ini module is the canonical implementation', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const hariIniJs = fs.readFileSync(HARI_INI_JS_PATH, 'utf8');

    for (const name of [
      'loadHariIni',
      'renderHariIniPromos',
      'renderHariIniRecentActivity',
      'renderHariIniPendingOrders',
      'renderHariIniAttention',
      'renderHariIniLowStock',
      'toggleBranchOpen',
      'toggleBranchOnlineOrders'
    ]) {
      const count = (hariIniJs.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g')) || []).length;
      assert.equal(count, 1, name + ' must have exactly one implementation in hari-ini.js');
      assert.ok(!js.includes('function ' + name + '(') && !js.includes('async function ' + name + '('),
        name + ' must not be implemented in merchant-app.js');
    }

    assert.ok(!js.includes('var _hariIniState = {'), '_hariIniState must live in hari-ini.js');
    assert.ok(hariIniJs.includes('var _hariIniState = {'), '_hariIniState must live in hari-ini.js');
  });

  await t.test('2b. Order Center module is the canonical implementation', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const orderJs = fs.readFileSync(ORDER_JS_PATH, 'utf8');
    for (const name of [
      'startBMOrdersPolling',
      'loadBMOrders',
      'renderBMOrdersTable',
      'advanceBMOrderStatus',
      'openBMRejectModal',
      'viewBMOrderDetail',
      'checkInBMReservation',
      'noShowBMReservation'
    ]) {
      const count = (orderJs.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g')) || []).length;
      assert.equal(count, 1, name + ' must have exactly one implementation in orders.js');
      assert.ok(!js.includes('function ' + name + '(') && !js.includes('async function ' + name + '('),
        name + ' must not be implemented in merchant-app.js');
    }
  });

  await t.test('3. Order Center is extracted from the shell and behaviour is preserved', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const orderJs = fs.readFileSync(ORDER_JS_PATH, 'utf8');
    assert.ok(orderJs.includes('async function loadBMOrders('), 'loadBMOrders must live in orders.js');
    assert.ok(!js.includes('async function loadBMOrders('), 'merchant-app.js must not contain loadBMOrders implementation');
    assert.ok(orderJs.includes('bm-order-card-attention'), 'mobile attention card styling hook');
    assert.ok(orderJs.includes('playNewOrderAudibleChime'), 'audible new-order chime');
    assert.ok(orderJs.includes('seenPendingOrderIds'), 'diff-based new order detection');
    assert.ok(orderJs.includes('acceptance_deadline_at'), 'acceptance deadline comes from the server field');
    assert.ok(!orderJs.includes('ACCEPTANCE_WINDOW_MS'), 'no local deadline reconstruction');
    assert.ok(!orderJs.includes('+ 180000'), 'no hard-coded acceptance window');
    assert.ok(orderJs.includes('/branch-acceptance'), 'ACCEPT goes through the dedicated branch-acceptance endpoint');
  });

  await t.test('6. reservation orders have dedicated filter/data/actions in Merchant App', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const orderJs = fs.readFileSync(ORDER_JS_PATH, 'utf8');

    assert.ok(html.includes('<option value="reservation">Reservasi</option>'),
      'order type filter must expose Reservation');

    assert.ok(orderJs.includes('RESERVASI'), 'reservation must not be rendered as pickup');
    assert.ok(orderJs.includes('reservationGuests'), 'reservation guest count must be rendered');
    assert.ok(orderJs.includes('reservationInfo'), 'reservation date/time summary must be rendered');
    assert.ok(orderJs.includes('/pos/reservations/'),
      'Merchant App must call the reservation operational API');
    assert.ok(orderJs.includes('checkInBMReservation'),
      'Merchant App must expose reservation check-in action');
    assert.ok(orderJs.includes('noShowBMReservation'),
      'Merchant App must expose reservation no-show action');
    assert.ok(orderJs.includes('getBMReservationScheduleMs'),
      'queue must classify reservation schedule explicitly');
    assert.ok(orderJs.includes('aIsUpcomingReservation'),
      'queue must keep upcoming reservations in a dedicated visibility tier');

    assert.ok(orderJs.includes('bm-detail-reservation-datetime'),
      'detail view must expose reservation schedule');
    assert.ok(orderJs.includes('bm-detail-reservation-guests'),
      'detail view must expose guest count');
    assert.equal(orderJs.includes('Reservasi\\\\s*'), false,
      'guest count parser must not contain an invalid double-escaped regex');

  });

  await t.test('7. upcoming reservations stay visible in operational queue order', async () => {
    const dom = new JSDOM('<table><tbody id="bm-orders-tbody"></tbody></table><div id="bm-orders-cards-container"></div>', {
      url: 'https://app.mybangjo.com/merchant-app/',
      runScripts: 'dangerously'
    });
    const win = dom.window;

    const escapeHtml = (value) => String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    win.XentraShared = {
      API_BASE: 'https://example.test',
      $: (id) => win.document.getElementById(id),
      esc: escapeHtml,
      formatMoney: (v) => String(v || 0),
      showToast: () => {},
      adminFetch: async () => ({
        ok: true,
        json: async () => ({
          success: true,
          orders: [
            { id: 'regular-confirmed', order_number: 'REG-1', status: 'confirmed', order_type: 'delivery', created_at: '2099-01-01T12:00:00' },
            { id: 'reservation-late', order_number: 'RSV-LATE', status: 'confirmed', order_type: 'reservation', scheduled_slot_start: '2099-01-02T18:00:00' },
            { id: 'reservation-soon', order_number: 'RSV-SOON', status: 'confirmed', order_type: 'reservation', scheduled_slot_start: '2099-01-02T12:00:00' }
          ]
        })
      }),
      getAuthHeaders: () => ({}),
      getStoredUser: () => ({ branch_id: 'branch-test' }),
      isBranchManager: () => true,
      checkAuth: () => true,
      clearStoredSession: () => {},
      redirectToLogin: () => {},
      handleHandoffExchange: () => {},
      validateServerSession: () => {},
      enforceSurface: () => {}
    };
    win.XentraBranchCatalog = {
      getActiveBranchId: () => 'branch-test',
      loadInlineBranchCatalog: () => {},
      setHooks: () => {},
      setBmMenuState: () => {},
      state: {}
    };

    // orders.js consumes the shared contract through XentraShared; use
    // lightweight stubs here so the test isolates queue rendering and sorting.
    win.eval(fs.readFileSync(ORDER_JS_PATH, 'utf8'));
    await win.loadBMOrders();

    const cardIds = Array.from(win.document.querySelectorAll('#bm-orders-cards-container [data-order-id]'))
      .map((el) => el.getAttribute('data-order-id'));

    assert.deepEqual(
      cardIds,
      ['reservation-soon', 'reservation-late', 'regular-confirmed'],
      'upcoming reservations must be surfaced before ordinary non-pending orders and ordered by nearest schedule'
    );

    win.close();
  });

  await t.test('5. tombol keluar di header benar-benar mengeluarkan pengguna', async () => {
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

    // merchant-app tidak punya router SPA sendiri, jadi redirectToLogin() memakai
    // checkAppRoute kalau ada — dipakai di sini untuk menangkap pengalihannya.
    let redirected = false;
    win.checkAppRoute = function () { redirected = true; };
    let confirmAnswer = false;
    win.confirm = function () { return confirmAnswer; };

    win.eval(fs.readFileSync(SHARED_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(BRANCH_CATALOG_JS_PATH, 'utf8'));
    win.eval(fs.readFileSync(JS_PATH, 'utf8'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await new Promise((r) => setTimeout(r, 200));

    const btn = win.document.getElementById('btn-logout');
    assert.ok(btn, 'header harus punya tombol keluar');

    // Dibatalkan: sesi tetap utuh, tidak ada pengalihan.
    confirmAnswer = false;
    btn.click();
    assert.equal(win.localStorage.getItem('xentra_merchant_token'), 'test-token',
      'membatalkan konfirmasi tidak boleh mengeluarkan pengguna');
    assert.equal(redirected, false, 'batal = tidak dialihkan');

    // Dikonfirmasi: sesi dibersihkan lalu dialihkan ke login terpadu.
    confirmAnswer = true;
    btn.click();
    assert.equal(win.localStorage.getItem('xentra_merchant_token'), null,
      'token sesi merchant harus dihapus saat keluar');
    assert.equal(win.localStorage.getItem('xentra_merchant_user'), null,
      'data pengguna harus dihapus saat keluar');
    assert.equal(redirected, true, 'setelah keluar harus dialihkan ke login terpadu');

    // Tanpa router SPA, redirectToLogin() jatuh ke /login — bukan ke halaman lain.
    const js = fs.readFileSync(JS_PATH, 'utf8');
    assert.ok(!/(function\s+checkAppRoute|checkAppRoute\s*=)/.test(js),
      'merchant-app tidak boleh mengklaim punya router SPA sendiri');

    win.close();
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
