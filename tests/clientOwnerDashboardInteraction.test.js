'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');
const CSS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/css/dashboard.css');

test('CLIENT OWNER DASHBOARD — Interaction, Navigation & Mobile Shell', async (t) => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const js = fs.readFileSync(JS_PATH, 'utf8');
  const css = fs.readFileSync(CSS_PATH, 'utf8');

  function createDashboardDOM(initialHash = '', viewportWidth = 1024) {
    const dom = new JSDOM(html, {
      url: 'https://app.mybangjo.com/dashboard/' + (initialHash ? '#' + initialHash : ''),
      runScripts: 'dangerously'
    });
    const win = dom.window;

    // Viewport width
    win.innerWidth = viewportWidth;

    // Mock authenticated merchant session
    win.localStorage.setItem('xentra_merchant_token', 'test-token-12345');
    win.localStorage.setItem('xentra_merchant_user', JSON.stringify({
      id: 'owner-test-id',
      username: 'owner',
      full_name: 'Pemilik Toko',
      role: 'owner'
    }));

    // Mock backend responses
    win.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          brand: { name: 'Bangjo Resto', primary_color: '#b6ff00' },
          categories: [],
          products: [],
          branches: [{ id: 'branch-1', name: 'Cabang Utama' }],
          users: [],
          orders: [],
          customers: []
        }
      }),
      text: async () => '{}'
    });

    return { dom, win };
  }

  await t.test('1. Production stylesheet link is correctly scoped and cache-busted without customer-pwa conflict', () => {
    assert.doesNotMatch(html, /href=["']\/assets\/css\/dashboard\.css/, 'index.html must not link to customer-pwa /assets/css/dashboard.css');
    assert.match(html, /\/dashboard\/assets\/css\/dashboard\.css\?v=/, 'index.html must link to /dashboard/assets/css/dashboard.css with version cache buster');
    assert.match(html, /\/dashboard\/assets\/js\/dashboard\.js\?v=/, 'index.html must link to /dashboard/assets/js/dashboard.js with version cache buster');
  });

  await t.test('2. CSS contains required navigation and mobile sidebar drawer rules', () => {
    assert.match(css, /\.x-nav-sub\s*\{[^}]*display:\s*none/, '.x-nav-sub must default to display: none');
    assert.match(css, /\.x-nav-sub\.open\s*\{[^}]*display:\s*flex/, '.x-nav-sub.open must have display: flex');
    assert.match(css, /\.x-nav-sub-item\s*\{/, '.x-nav-sub-item must have dedicated styling');
    assert.match(css, /\.x-sidebar-overlay\s*\{[^}]*display:\s*none/, '.x-sidebar-overlay must default to display: none');
  });

  await t.test('3. Desktop navigation clicks route correctly to all views', async () => {
    const { win } = createDashboardDOM('', 1024);
    win.eval(js);
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await new Promise(res => setTimeout(res, 50));

    const routes = [
      { sel: '[data-route="overview"]', expectedTab: 'tab-overview' },
      { sel: '[data-route="orders"]', expectedTab: 'tab-orders' },
      { sel: '#nav-catalog-parent', expectedTab: 'tab-catalog-products' },
      { sel: '[data-route="catalog/products"]', expectedTab: 'tab-catalog-products' },
      { sel: '[data-route="catalog/categories"]', expectedTab: 'tab-catalog-categories' },
      { sel: '[data-route="catalog/menus"]', expectedTab: 'tab-catalog-menus' },
      { sel: '[data-route="branches"]', expectedTab: 'tab-branches' },
      { sel: '[data-route="customers"]', expectedTab: 'tab-customers' },
      { sel: '[data-route="reports"]', expectedTab: 'tab-reports' },
      { sel: '[data-route="marketing"]', expectedTab: 'tab-marketing' },
      { sel: '[data-route="finance"]', expectedTab: 'tab-finance' },
      { sel: '[data-route="team"]', expectedTab: 'tab-tim' },
      { sel: '[data-route="settings"]', expectedTab: 'tab-settings' }
    ];

    for (const r of routes) {
      const btn = win.document.querySelector(r.sel);
      assert.ok(btn, `Button for ${r.sel} must exist`);
      btn.click();
      const activeTab = win.document.querySelector('.x-tab-content.active');
      assert.ok(activeTab, `An active tab must exist after clicking ${r.sel}`);
      assert.strictEqual(activeTab.id, r.expectedTab, `Clicking ${r.sel} must activate ${r.expectedTab}`);
    }
  });

  await t.test('4. Catalog parent expandable navigation opens and toggles sub-nav', async () => {
    const { win } = createDashboardDOM('overview', 1024);
    win.eval(js);
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await new Promise(res => setTimeout(res, 50));

    const catalogParent = win.document.getElementById('nav-catalog-parent');
    const catalogSub = win.document.getElementById('nav-catalog-sub');
    assert.ok(catalogParent && catalogSub, 'Catalog elements must exist');

    // Initially closed on overview
    assert.strictEqual(catalogSub.classList.contains('open'), false, 'Sub-nav should be closed on overview');

    // First click: navigates to catalog (catalog/products) and opens sub-nav
    catalogParent.click();
    await new Promise(res => setTimeout(res, 20));
    assert.strictEqual(catalogSub.classList.contains('open'), true, 'Sub-nav should open on catalog navigation');
    assert.strictEqual(catalogParent.getAttribute('aria-expanded'), 'true');

    // Second click: toggles closed without navigating away
    catalogParent.click();
    await new Promise(res => setTimeout(res, 20));
    assert.strictEqual(catalogSub.classList.contains('open'), false, 'Sub-nav should close on toggle');
    assert.strictEqual(catalogParent.getAttribute('aria-expanded'), 'false');
  });

  await t.test('5. Mobile sidebar drawer opens via hamburger and closes on navigation or overlay click', async () => {
    const { win } = createDashboardDOM('overview', 375);
    win.eval(js);
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await new Promise(res => setTimeout(res, 50));

    const hamburger = win.document.getElementById('btn-hamburger');
    const sidebar = win.document.getElementById('x-dash-sidebar');
    const overlay = win.document.getElementById('x-sidebar-overlay');
    assert.ok(hamburger && sidebar && overlay, 'Mobile controls must exist');

    // Initially closed
    assert.strictEqual(sidebar.classList.contains('open'), false);
    assert.strictEqual(overlay.classList.contains('open'), false);

    // Open via hamburger
    hamburger.click();
    assert.strictEqual(sidebar.classList.contains('open'), true);
    assert.strictEqual(overlay.classList.contains('open'), true);

    // Close via overlay click
    overlay.click();
    assert.strictEqual(sidebar.classList.contains('open'), false);
    assert.strictEqual(overlay.classList.contains('open'), false);

    // Open again, then click a nav item to navigate
    hamburger.click();
    assert.strictEqual(sidebar.classList.contains('open'), true);

    const ordersBtn = win.document.querySelector('[data-route="orders"]');
    ordersBtn.click();
    assert.strictEqual(sidebar.classList.contains('open'), false, 'Navigating on mobile should close the sidebar');
    const activeTab = win.document.querySelector('.x-tab-content.active');
    assert.strictEqual(activeTab.id, 'tab-orders');

    // Test tablet width (e.g. 768px - 1023px) drawer behavior
    const { win: winTablet } = createDashboardDOM('overview', 900);
    winTablet.eval(js);
    winTablet.document.dispatchEvent(new winTablet.Event('DOMContentLoaded'));
    await new Promise(res => setTimeout(res, 50));

    const hamburgerTablet = winTablet.document.getElementById('btn-hamburger');
    const sidebarTablet = winTablet.document.getElementById('x-dash-sidebar');
    hamburgerTablet.click();
    assert.strictEqual(sidebarTablet.classList.contains('open'), true, 'Sidebar opens on tablet via hamburger');
    const catalogBtnTablet = winTablet.document.querySelector('[data-route="branches"]');
    catalogBtnTablet.click();
  });

  await t.test('5.1 POS and Kiosk are hidden from Client Owner UI navigation and Settings sidebar', () => {
    // POS/Kiosk buttons in Settings category navigation must be hidden (display: none)
    const posNavBtn = html.includes('data-settings-section="channels/pos"') && html.includes('style="display:none;');
    const kioskNavBtn = html.includes('data-settings-section="channels/kiosk"') && html.includes('style="display:none;');
    assert.ok(posNavBtn, 'Point of Sale (POS) button in settings navigation must be hidden');
    assert.ok(kioskNavBtn, 'Kiosk Terminal button in settings navigation must be hidden');
    // Main navigation sidebar must not contain POS / Kiosk links
    const navBlock = html.match(/<nav class="x-dash-nav"[\s\S]*?<\/nav>/)?.[0] || '';
    assert.doesNotMatch(navBlock, /Point of Sale/i, 'Main sidebar navigation must not have Point of Sale item');
    assert.doesNotMatch(navBlock, /Kiosk/i, 'Main sidebar navigation must not have Kiosk item');
  });

  await t.test('6. Direct deep-link URL and page refresh resolve to the correct view', async () => {
    const directChecks = [
      { hash: 'overview', expectedTab: 'tab-overview' },
      { hash: 'orders', expectedTab: 'tab-orders' },
      { hash: 'catalog/products', expectedTab: 'tab-catalog-products' },
      { hash: 'catalog/categories', expectedTab: 'tab-catalog-categories' },
      { hash: 'catalog/menus', expectedTab: 'tab-catalog-menus' },
      { hash: 'branches', expectedTab: 'tab-branches' },
      { hash: 'customers', expectedTab: 'tab-customers' },
      { hash: 'reports', expectedTab: 'tab-reports' },
      { hash: 'finance', expectedTab: 'tab-finance' },
      { hash: 'finance/transactions', expectedTab: 'tab-finance' },
      { hash: 'marketing', expectedTab: 'tab-marketing' },
      { hash: 'marketing/promotions', expectedTab: 'tab-marketing' },
      { hash: 'team', expectedTab: 'tab-tim' },
      { hash: 'settings', expectedTab: 'tab-settings' }
    ];

    for (const check of directChecks) {
      const { win } = createDashboardDOM(check.hash, 1024);
      win.eval(js);
      win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
      await new Promise(res => setTimeout(res, 50));

      const activeTab = win.document.querySelector('.x-tab-content.active');
      assert.ok(activeTab, `Active tab must exist for #${check.hash}`);
      assert.strictEqual(activeTab.id, check.expectedTab, `Direct route #${check.hash} must activate ${check.expectedTab}`);
    }
  });

  await t.test('7. Backward compatibility: buttons with data-tab still navigate', async () => {
    const { win } = createDashboardDOM('', 1024);

    // Simulate button that only has data-tab="orders" attached to DOM before init
    const mockBtn = win.document.createElement('button');
    mockBtn.className = 'x-nav-item';
    mockBtn.dataset.tab = 'orders';
    win.document.body.appendChild(mockBtn);

    win.eval(js);
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await new Promise(res => setTimeout(res, 50));

    mockBtn.click();

    const activeTab = win.document.querySelector('.x-tab-content.active');
    assert.strictEqual(activeTab.id, 'tab-orders');
  });
});
