'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const CSS_PATH = path.join(__dirname, '../apps/merchant-shared/css/dashboard.css');
const JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');

const html = fs.readFileSync(HTML_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const js = fs.readFileSync(JS_PATH, 'utf8');

test('Owner Mobile Command Center (Beranda)', async (t) => {

  // --------------------------------------------------------------------------
  // 1. Structure & Elements
  // --------------------------------------------------------------------------

  await t.test('OCC-01: command center container exists in tab-overview', () => {
    assert.ok(html.includes('id="x-owner-command-center"'),
      '#x-owner-command-center must exist in index.html');
    assert.ok(html.includes('class="x-owner-command-center"'),
      '.x-owner-command-center class must exist');
    assert.ok(html.includes('class="x-desktop-overview-view"'),
      '.x-desktop-overview-view must exist to wrap desktop overview layout');
  });

  await t.test('OCC-02: Periode selector (today, 7d, 30d) and custom range form exist in 2 rows', () => {
    assert.ok(html.includes('id="occ-period-select"'),
      '#occ-period-select must exist');
    assert.ok(!html.includes('id="occ-period-badge"'),
      '#occ-period-badge must be removed');
    assert.ok(html.includes('class="x-occ-preset-row"'),
      '.x-occ-preset-row must exist for Row 1');
    assert.ok(html.includes('class="x-occ-custom-range-row"'),
      '.x-occ-custom-range-row must exist for Row 2');
    assert.ok(html.includes('id="occ-start-date"'),
      '#occ-start-date must exist');
    assert.ok(html.includes('id="occ-end-date"'),
      '#occ-end-date must exist');
    assert.ok(html.includes('id="btn-occ-search"'),
      '#btn-occ-search must exist');
    assert.ok(html.includes('value="today" selected'),
      'Default period option must be "today"');
    assert.ok(html.includes('value="7d"'),
      'Option 7d must exist');
    assert.ok(html.includes('value="30d"'),
      'Option 30d must exist');

    const selectSection = html.substring(
      html.indexOf('id="occ-period-select"'),
      html.indexOf('</select>')
    );
    assert.ok(!selectSection.includes('value="month"'),
      'Option month must not exist in quick presets');
    assert.ok(!selectSection.includes('value="all"'),
      'Option all must not exist in quick presets');
    assert.ok(!selectSection.includes('value="custom"'),
      'Option custom must not exist in quick presets');
  });

  await t.test('OCC-03: Hero KPI elements exist for Penjualan, Trend, and mini metrics', () => {
    assert.ok(html.includes('id="occ-hero-sales"'),
      '#occ-hero-sales must exist for primary sales number');
    assert.ok(html.includes('id="occ-hero-trend"'),
      '#occ-hero-trend must exist for comparison trend');
    assert.ok(html.includes('id="occ-hero-orders"'),
      '#occ-hero-orders must exist for orders count');
    assert.ok(html.includes('id="occ-hero-aov"'),
      '#occ-hero-aov must exist for avg order value');
    assert.ok(html.includes('id="occ-hero-customers"'),
      '#occ-hero-customers must exist for customers count');
  });

  await t.test('OCC-04: Branch Performance section exists with dynamic title and link', () => {
    assert.ok(html.includes('id="occ-branch-section"'),
      '#occ-branch-section must exist');
    assert.ok(html.includes('id="occ-branch-title"'),
      '#occ-branch-title must exist');
    assert.ok(html.includes('id="occ-branch-link"'),
      '#occ-branch-link must exist');
    assert.ok(html.includes('id="occ-branch-content"'),
      '#occ-branch-content must exist');
  });

  await t.test('OCC-05: Orders Summary section exists with 4 status metrics', () => {
    assert.ok(html.includes('id="occ-orders-section"'),
      '#occ-orders-section must exist');
    assert.ok(html.includes('id="occ-orders-total"'),
      '#occ-orders-total must exist');
    assert.ok(html.includes('id="occ-orders-completed"'),
      '#occ-orders-completed must exist');
    assert.ok(html.includes('id="occ-orders-in-progress"'),
      '#occ-orders-in-progress must exist');
    assert.ok(html.includes('id="occ-orders-cancelled"'),
      '#occ-orders-cancelled must exist');
  });

  await t.test('OCC-06: Top Products section exists with link to catalog', () => {
    assert.ok(html.includes('id="occ-products-section"'),
      '#occ-products-section must exist');
    assert.ok(html.includes('id="occ-products-link"'),
      '#occ-products-link must exist');
    assert.ok(html.includes('id="occ-products-content"'),
      '#occ-products-content must exist');
  });

  await t.test('OCC-07: Attention section exists with normal reassurance state', () => {
    assert.ok(html.includes('id="occ-attention-section"'),
      '#occ-attention-section must exist');
    assert.ok(html.includes('id="occ-attention-content"'),
      '#occ-attention-content must exist');
    assert.ok(html.includes('Semua berjalan normal'),
      'Default reassurance state "Semua berjalan normal" must be present');
  });

  await t.test('OCC-08: Quick Access section exists with exactly 5 shortcut chips', () => {
    assert.ok(html.includes('id="occ-quick-access-section"'),
      '#occ-quick-access-section must exist');
    const occSection = html.substring(
      html.indexOf('id="occ-quick-access-section"'),
      html.indexOf('<!-- Desktop Overview View')
    );
    const chips = occSection.match(/class="x-occ-quick-chip"/g) || [];
    assert.strictEqual(chips.length, 5,
      `Expected 5 quick access chips, got ${chips.length}`);

    const expectedLabels = ['Produk', 'Cabang', 'Promo', 'Pembayaran', 'Laporan'];
    for (const label of expectedLabels) {
      assert.ok(occSection.includes(label),
        `Quick access chip "${label}" must exist in HTML`);
    }
  });

  // --------------------------------------------------------------------------
  // 2. Locked Visual Order in DOM
  // --------------------------------------------------------------------------

  await t.test('OCC-09: Verified locked visual order in DOM', () => {
    const posFocus = html.indexOf('id="x-topbar-focus-scope"');
    const posPeriod = html.indexOf('class="x-occ-period-bar"');
    const posHero = html.indexOf('id="occ-hero-card"');
    const posBranch = html.indexOf('id="occ-branch-section"');
    const posOrders = html.indexOf('id="occ-orders-section"');
    const posProducts = html.indexOf('id="occ-products-section"');
    const posAttention = html.indexOf('id="occ-attention-section"');
    const posQuick = html.indexOf('id="occ-quick-access-section"');
    const posBottomNav = html.indexOf('id="x-owner-bottom-nav"');

    assert.ok(posFocus < posPeriod, 'FOCUS must appear before PERIODE');
    assert.ok(posPeriod < posHero, 'PERIODE must appear before HERO KPI');
    assert.ok(posHero < posBranch, 'HERO KPI must appear before PERFORMA CABANG');
    assert.ok(posBranch < posOrders, 'PERFORMA CABANG must appear before RINGKASAN PESANAN');
    assert.ok(posOrders < posProducts, 'RINGKASAN PESANAN must appear before PRODUK TERLARIS');
    assert.ok(posProducts < posAttention, 'PRODUK TERLARIS must appear before PERHATIAN');
    assert.ok(posAttention < posQuick, 'PERHATIAN must appear before QUICK ACCESS');
    assert.ok(posQuick < posBottomNav, 'QUICK ACCESS must appear before BOTTOM NAV');
  });

  // --------------------------------------------------------------------------
  // 3. CSS Responsive Rules
  // --------------------------------------------------------------------------

  await t.test('OCC-10: CSS responsive layout hides desktop view and displays command center on mobile', () => {
    assert.ok(css.includes('.x-desktop-overview-view { display: none !important; }'),
      'Mobile media query must hide desktop overview view');
    assert.ok(css.includes('.x-owner-command-center { display: none !important; }'),
      'Desktop media query must hide owner command center');
    assert.ok(css.includes('.x-desktop-overview-view { display: block !important; }'),
      'Desktop media query must display desktop overview view');
  });

  // --------------------------------------------------------------------------
  // 4. JS Implementation
  // --------------------------------------------------------------------------

  await t.test('OCC-11: dashboard.js defines all required Command Center functions', () => {
    assert.ok(js.includes('function setOverviewPeriodPreset('),
      'setOverviewPeriodPreset must be defined in dashboard.js');
    assert.ok(js.includes('function renderOccHeroKpi('),
      'renderOccHeroKpi must be defined in dashboard.js');
    assert.ok(js.includes('function renderOccBranchPerformance('),
      'renderOccBranchPerformance must be defined in dashboard.js');
    assert.ok(js.includes('function renderOccOrdersSummary('),
      'renderOccOrdersSummary must be defined in dashboard.js');
    assert.ok(js.includes('function renderOccTopProducts('),
      'renderOccTopProducts must be defined in dashboard.js');
    assert.ok(js.includes('function renderOccAttention('),
      'renderOccAttention must be defined in dashboard.js');
    assert.ok(js.includes('function renderOccEmpty('),
      'renderOccEmpty must be defined in dashboard.js');
  });

  await t.test('OCC-12: dashboard.js hooks Command Center renderers into renderOverviewData and renderOverviewEmpty', () => {
    assert.ok(js.includes('renderOccHeroKpi(kpis);'),
      'renderOverviewData must call renderOccHeroKpi');
    assert.ok(js.includes('renderOccBranchPerformance(overview);'),
      'renderOverviewData must call renderOccBranchPerformance');
    assert.ok(js.includes('renderOccOrdersSummary(overview);'),
      'renderOverviewData must call renderOccOrdersSummary');
    assert.ok(js.includes('renderOccTopProducts(overview);'),
      'renderOverviewData must call renderOccTopProducts');
    assert.ok(js.includes('renderOccAttention(overview);'),
      'renderOverviewData must call renderOccAttention');
    assert.ok(js.includes('renderOccEmpty();'),
      'renderOverviewEmpty must call renderOccEmpty');
  });

  await t.test('OCC-13A: mobile period control is compact and custom dates are progressive disclosure', () => {
    assert.ok(html.includes('id="btn-occ-custom-toggle"'),
      'Custom date toggle must exist');
    assert.ok(html.includes('id="occ-custom-range-row" hidden'),
      'Custom date row must start collapsed');
    assert.ok(css.includes('.x-occ-custom-range-row[hidden]'),
      'CSS must preserve collapsed custom range state');
  });

  await t.test('OCC-13B: mobile overview has explicit loading/error/accessibility hooks', () => {
    assert.ok(html.includes('aria-busy="true"'),
      'Command center must expose busy state');
    assert.ok(css.includes('.x-occ-error-state'),
      'Mobile error state styling must exist');
    assert.ok(css.includes(':focus-visible'),
      'Mobile controls must have visible focus styling');
    assert.ok(css.includes('prefers-reduced-motion: reduce'),
      'Reduced-motion support must exist');
    assert.ok(js.includes('function renderOccError()'),
      'renderOccError must be defined');
  });

  await t.test('OCC-13C: branch performance rows are actionable touch targets', () => {
    assert.ok(js.includes('class="x-occ-branch-row" aria-label="Buka cabang '),
      'Branch performance rows must be actionable links');
    assert.ok(css.includes('.x-occ-branch-row:active'),
      'Branch rows must provide touch feedback');
  });

  await t.test('OCC-13: initOverviewControls wires occ-period-select, custom range inputs, and btn-occ-search', () => {
    assert.ok(js.includes('var occSelect = $(\'occ-period-select\');'),
      'initOverviewControls must reference occ-period-select');
    assert.ok(js.includes('setOverviewPeriodPreset(this.value);'),
      'occ-period-select change must trigger setOverviewPeriodPreset');
    assert.ok(js.includes('var btnOccSearch = $(\'btn-occ-search\');'),
      'initOverviewControls must reference btn-occ-search');
    assert.ok(js.includes('btnOccSearch.addEventListener(\'click\', doOccSearch);'),
      'btn-occ-search must trigger doOccSearch');
  });

  // --------------------------------------------------------------------------
  // 5. Backend /admin/overview Integration
  // --------------------------------------------------------------------------

  await t.test('OCC-14: /admin/overview API returns orders_summary and attention metrics', async (t2) => {
    const http = require('node:http');
    const db = require('../server/database/db');
    require('./helpers/demoFixtures.js')();
    const app = require('../server/app');

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));

    try {
      const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
      assert.ok(ownerUser, 'Owner user must exist');
      const ownerSession = global.TokenSessionStore.createSession(ownerUser, 'brand_bangjo');
      const ownerToken = ownerSession.token;

      const port = server.address().port;
      const res = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path: '/api/v1/admin/overview',
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Host: 'app.mybangjo.com',
            Authorization: `Bearer ${ownerToken}`
          }
        }, (response) => {
          let data = '';
          response.on('data', chunk => { data += chunk; });
          response.on('end', () => {
            resolve({
              status: response.statusCode,
              body: JSON.parse(data)
            });
          });
        });
        req.on('error', reject);
        req.end();
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const data = res.body.data;

      // Verify orders_summary
      assert.ok(data.orders_summary, 'orders_summary must exist in response');
      assert.strictEqual(typeof data.orders_summary.total, 'number');
      assert.strictEqual(typeof data.orders_summary.completed, 'number');
      assert.strictEqual(typeof data.orders_summary.in_progress, 'number');
      assert.strictEqual(typeof data.orders_summary.cancelled, 'number');

      // Verify needs_attention pending_payments_count
      assert.ok(data.needs_attention, 'needs_attention must exist');
      assert.strictEqual(typeof data.needs_attention.pending_payments_count, 'number');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  await t.test('OCC-15: /admin/overview handles branch_id=all and date filters properly', async (t2) => {
    const http = require('node:http');
    const db = require('../server/database/db');
    require('./helpers/demoFixtures.js')();
    const app = require('../server/app');

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));

    try {
      const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
      const ownerSession = global.TokenSessionStore.createSession(ownerUser, 'brand_bangjo');
      const ownerToken = ownerSession.token;
      const port = server.address().port;

      const fetchOverview = (queryString) => new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path: '/api/v1/admin/overview' + (queryString ? '?' + queryString : ''),
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Host: 'app.mybangjo.com',
            Authorization: `Bearer ${ownerToken}`
          }
        }, (response) => {
          let data = '';
          response.on('data', chunk => { data += chunk; });
          response.on('end', () => {
            resolve({
              status: response.statusCode,
              body: JSON.parse(data)
            });
          });
        });
        req.on('error', reject);
        req.end();
      });

      // branch_id=all should not be treated literally and should return brand-wide data
      const resAll = await fetchOverview('branch_id=all');
      assert.strictEqual(resAll.status, 200);
      assert.strictEqual(resAll.body.success, true);
      assert.ok(resAll.body.data.kpis.orders >= 0, 'branch_id=all should succeed');

      // Date range filtering with YYYY-MM-DD
      const resDate = await fetchOverview('branch_id=all&start_date=2020-01-01&end_date=2099-12-31');
      assert.strictEqual(resDate.status, 200);
      assert.strictEqual(resDate.body.success, true);
      assert.ok(resDate.body.data.kpis.orders >= 0, 'date range query should succeed');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
