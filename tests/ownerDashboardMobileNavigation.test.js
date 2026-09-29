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

test('Owner Dashboard Mobile Navigation', async t => {

  // --------------------------------------------------------------------------
  // HTML structure
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-01: bottom nav element exists with correct id', () => {
    assert.ok(html.includes('id="x-owner-bottom-nav"'),
      'x-owner-bottom-nav nav must exist');
  });

  await t.test('OWNER-MOB-02: bottom nav has exactly 5 nav items', () => {
    const matches = html.match(/class="x-owner-nav-item[^"]*"/g) || [];
    assert.strictEqual(matches.length, 5,
      `Expected 5 .x-owner-nav-item elements, got ${matches.length}`);
  });

  await t.test('OWNER-MOB-03: bottom nav labels match contract (Beranda, Bisnis, Pesanan, Keuangan, Lainnya)', () => {
    const required = ['Beranda', 'Bisnis', 'Pesanan', 'Keuangan', 'Lainnya'];
    for (const label of required) {
      assert.ok(html.includes(label),
        `Bottom nav label "${label}" must be present in HTML`);
    }
  });

  await t.test('OWNER-MOB-04: each bottom nav item has data-route attribute', () => {
    // data-route drives navigateTo
    const navSection = html.substring(
      html.indexOf('id="x-owner-bottom-nav"'),
      html.indexOf('</nav>', html.indexOf('id="x-owner-bottom-nav"')) + 6
    );
    const routeAttrs = navSection.match(/data-route="[^"]+"/g) || [];
    assert.strictEqual(routeAttrs.length, 5,
      `Expected 5 data-route attrs in bottom nav, got ${routeAttrs.length}`);
  });

  await t.test('OWNER-MOB-05: each bottom nav item has data-tab-module attribute for active sync', () => {
    const navSection = html.substring(
      html.indexOf('id="x-owner-bottom-nav"'),
      html.indexOf('</nav>', html.indexOf('id="x-owner-bottom-nav"')) + 6
    );
    const moduleAttrs = navSection.match(/data-tab-module="[^"]+"/g) || [];
    assert.strictEqual(moduleAttrs.length, 5,
      `Expected 5 data-tab-module attrs in bottom nav, got ${moduleAttrs.length}`);
  });

  await t.test('OWNER-MOB-06: bottom nav routes map to correct modules (beranda, bisnis, pesanan, keuangan, lainnya)', () => {
    const navSection = html.substring(
      html.indexOf('id="x-owner-bottom-nav"'),
      html.indexOf('</nav>', html.indexOf('id="x-owner-bottom-nav"')) + 6
    );
    const expectedModules = ['beranda', 'bisnis', 'pesanan', 'keuangan', 'lainnya'];
    for (const mod of expectedModules) {
      assert.ok(navSection.includes(`data-tab-module="${mod}"`),
        `Bottom nav must have data-tab-module="${mod}"`);
    }
  });

  // --------------------------------------------------------------------------
  // Focus selector (branch context)
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-07: Focus selector element (#x-branch-selector) exists in topbar', () => {
    assert.ok(html.includes('id="x-branch-selector"') || html.includes('id="x-topbar-focus-scope"'),
      'Focus selector wrapper must exist in topbar');
  });

  await t.test('OWNER-MOB-08: Focus selector uses existing dash-branch-context select', () => {
    assert.ok(html.includes('id="dash-branch-context"'),
      '#dash-branch-context select must be present (Focus uses existing selector)');
  });

  await t.test('OWNER-MOB-09: Focus selector default option label is Semua Cabang', () => {
    assert.ok(html.includes('Semua Cabang'),
      'Default branch option must read "Semua Cabang"');
  });

  // --------------------------------------------------------------------------
  // Hub sections (Bisnis and Lainnya)
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-10: tab-business hub section exists', () => {
    assert.ok(html.includes('id="tab-business"'),
      'tab-business content section must be present');
  });

  await t.test('OWNER-MOB-11: tab-more hub section exists', () => {
    assert.ok(html.includes('id="tab-more"'),
      'tab-more content section must be present');
  });

  await t.test('OWNER-MOB-11A: Business hub exposes the canonical management groups', () => {
    const business = html.substring(
      html.indexOf('id="tab-business"'),
      html.indexOf('id="tab-more"')
    );
    for (const label of ['Katalog', 'Operasional', 'Pelanggan &amp; Pemasaran', 'Tim &amp; Akses', 'Insight &amp; Laporan', 'Brand']) {
      assert.ok(business.includes(label), 'Business hub must expose section "' + label.replace(/&amp;/g, '&') + '"');
    }
    for (const route of ["catalog/products", "catalog/categories", "stock", "branches", "customers", "marketing", "team", "reports", "settings/business/profile"]) {
      assert.ok(business.includes("navigateTo('" + route + "')"), 'Business hub must expose route "' + route + '"');
    }
    assert.ok(!business.includes('Menu &amp; Paket'), 'Business hub must not expose the old combined Menu & Paket entry');
    assert.ok(!business.includes("navigateTo('catalog/menus')"), 'Branch Menu must not be presented as a Master Catalog hub card');
  });

  await t.test('OWNER-MOB-11B: More hub is reserved for system/settings/account concerns', () => {
    const more = html.substring(
      html.indexOf('id="tab-more"'),
      html.indexOf('id="tab-platform-overview"')
    );
    for (const route of ["settings", "settings/integrations", "settings/notifications", "settings/security"]) {
      assert.ok(more.includes("navigateTo('" + route + "')"), 'More hub must expose route "' + route + '"');
    }
    assert.ok(!more.includes("navigateTo('team')"), 'More hub must not duplicate Team');
    assert.ok(!more.includes("navigateTo('reports')"), 'More hub must not duplicate Reports');
    assert.ok(!more.includes("navigateTo('settings/business/profile')"), 'More hub must not duplicate Brand Identity');
  });

  // --------------------------------------------------------------------------
  // Desktop sidebar preservation
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-12: desktop sidebar element is still present', () => {
    assert.ok(html.includes('id="x-dash-sidebar"'),
      'Desktop sidebar must not be removed');
  });

  await t.test('OWNER-MOB-13: desktop sidebar has existing nav items (Overview, Orders)', () => {
    assert.ok(html.includes('data-route="overview"'), 'Sidebar overview nav item must exist');
    assert.ok(html.includes('data-route="orders"'), 'Sidebar orders nav item must exist');
    assert.ok(html.includes('data-route="catalog/menus"') && html.includes('<span>Menu Cabang</span>'), 'Sidebar must label the branch-specific Menu route as Menu Cabang');
  });

  await t.test('OWNER-MOB-13A: redundant sidebar close button is not rendered in Owner Dashboard', () => {
    // Owner mobile drawer already has safe close paths via hamburger, overlay,
    // navigation selection, Escape, and breakpoint handling. Keep the legacy
    // close control out of the Owner DOM; the shared CSS/JS remains available
    // for surfaces that still use the control.
    assert.ok(!html.includes('id="btn-sidebar-close"'),
      'Owner Dashboard must not render the redundant sidebar close button');
  });

  // --------------------------------------------------------------------------
  // CSS
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-14: CSS defines .x-owner-bottom-nav hidden by default', () => {
    assert.ok(css.includes('.x-owner-bottom-nav') && css.includes('display: none'),
      '.x-owner-bottom-nav must be defined in CSS with display:none default');
  });

  await t.test('OWNER-MOB-15: CSS shows .x-owner-bottom-nav at mobile breakpoint', () => {
    assert.ok(css.includes('.x-owner-bottom-nav') && css.includes('display: grid'),
      '.x-owner-bottom-nav must use display:grid inside media query');
  });

  await t.test('OWNER-MOB-16: CSS defines .x-owner-nav-item styles', () => {
    assert.ok(css.includes('.x-owner-nav-item'),
      '.x-owner-nav-item must be styled in CSS');
  });

  await t.test('OWNER-MOB-17: CSS overrides Focus selector display:none on mobile for owner', () => {
    // The CSS must undo the ≤900px and ≤768px hide rules so owner sees focus on mobile
    const afterOwnerNav = css.indexOf('OWNER DASHBOARD — Mobile Bottom Navigation');
    assert.ok(afterOwnerNav !== -1, 'Owner nav section header must exist in CSS');
    const ownerCssSection = css.substring(afterOwnerNav);
    assert.ok(ownerCssSection.includes('#x-branch-selector') &&
              ownerCssSection.includes('display: flex'),
      'Owner mobile section must override #x-branch-selector to display:flex');
  });

  // --------------------------------------------------------------------------
  // JS functions
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-18: JS defines initOwnerBottomNav function', () => {
    assert.ok(js.includes('function initOwnerBottomNav()'),
      'initOwnerBottomNav must be defined in dashboard.js');
  });

  await t.test('OWNER-MOB-19: JS defines syncOwnerBottomNavActive function', () => {
    assert.ok(js.includes('function syncOwnerBottomNavActive('),
      'syncOwnerBottomNavActive must be defined in dashboard.js');
  });

  await t.test('OWNER-MOB-20: syncOwnerBottomNavActive is called from applyRoute', () => {
    assert.ok(js.includes('syncOwnerBottomNavActive(route)'),
      'syncOwnerBottomNavActive must be called inside applyRoute');
  });

  await t.test('OWNER-MOB-21: initOwnerBottomNav is called during initialization', () => {
    assert.ok(js.includes('initOwnerBottomNav()'),
      'initOwnerBottomNav must be called during app initialization');
  });

  await t.test('OWNER-MOB-22: CLIENT_ROUTE_META includes business and more routes', () => {
    assert.ok(js.includes("'business'") && js.includes("'more'"),
      'CLIENT_ROUTE_META must have business and more route entries');
  });

  await t.test('OWNER-MOB-23: _ownerNavModuleMap covers all 5 modules', () => {
    const modules = ['beranda', 'bisnis', 'pesanan', 'keuangan', 'lainnya'];
    for (const mod of modules) {
      assert.ok(js.includes(`'${mod}'`),
        `_ownerNavModuleMap must include module key '${mod}'`);
    }
  });

  await t.test('OWNER-MOB-24: Bottom nav does NOT drive authorization — no RBAC check in syncOwnerBottomNavActive', () => {
    const fnStart = js.indexOf('function syncOwnerBottomNavActive(');
    const fnEnd = js.indexOf('\n  }', fnStart) + 4;
    const fnBody = js.substring(fnStart, fnEnd);
    assert.ok(!fnBody.includes('isOwner') && !fnBody.includes('isBranchManager') &&
              !fnBody.includes('role'),
      'syncOwnerBottomNavActive must not check roles — Focus is not auth, nav is constant');
  });

});
