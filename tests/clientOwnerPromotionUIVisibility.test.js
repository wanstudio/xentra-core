'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');
const SHARED_JS_PATH = path.join(__dirname, '../apps/merchant-shared/js/shared.js');

test('CLIENT OWNER DASHBOARD — Marketing / Promotion Workspace Visibility & Lifecycle', async (t) => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const js = fs.readFileSync(JS_PATH, 'utf8');
  const sharedJs = fs.readFileSync(SHARED_JS_PATH, 'utf8');

  // index.html loads merchant-shared/js/shared.js before dashboard.js; mirror that.
  function evalApp(win) {
    win.eval(sharedJs);
    win.eval(js);
  }

  const createdWins = [];
  function createDashboardDOM(initialHash = '', userRole = 'owner') {
    const dom = new JSDOM(html, {
      url: 'https://app.mybangjo.com/dashboard/' + (initialHash ? '#' + initialHash : ''),
      runScripts: 'dangerously'
    });
    const win = dom.window;
    createdWins.push(win);

    win.innerWidth = 1024;

    win.localStorage.setItem('xentra_merchant_token', 'test-token-12345');
    win.localStorage.setItem('xentra_merchant_user', JSON.stringify({
      id: userRole === 'owner' ? 'owner-test-id' : 'bm-test-id',
      username: userRole,
      full_name: userRole === 'owner' ? 'Pemilik Toko' : 'Manajer Cabang',
      role: userRole,
      brand_id: 'brand_bangjo',
      branch_id: userRole === 'branch_manager' ? 'branch_sec_A1' : null
    }));

    win.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/admin/marketing/promotions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            promotions: [
              {
                id: 'promo_test_01',
                name: 'Hadiah PWA Bangjo',
                code: 'PWABANGJO',
                capability_type: 'install_incentive',
                stacking_policy: 'exclusive',
                is_active: 1,
                rewards: [{ reward_type: 'freebie_product', target_product_name: 'Es Teh Manis' }],
                scopes: [{ branch_id: 'branch-1', is_active: 1 }],
                redemptions_count: 5
              }
            ]
          }),
          text: async () => '{}'
        };
      }
      if (u.includes('/admin/catalog/products')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            products: [
              { id: 'prod-1', name: 'Ayam Goreng', price: 25000 },
              { id: 'prod-2', name: 'Es Teh Manis', price: 5000 }
            ]
          }),
          text: async () => '{}'
        };
      }
      if (u.includes('/admin/branches')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            branches: [
              { id: 'branch-1', name: 'Cabang Barat', brand_id: 'brand_bangjo' }
            ]
          }),
          text: async () => '{}'
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            brand: { name: 'Bangjo Resto', primary_color: '#b6ff00' },
            branches: [{ id: 'branch-1', name: 'Cabang Barat' }]
          }
        }),
        text: async () => '{}'
      };
    };

    return { dom, win };
  }

  t.after(() => {
    createdWins.forEach(w => {
      try { if (typeof w.stopOrdersPolling === 'function') w.stopOrdersPolling(); } catch (_) {}
      try { w.close(); } catch (_) {}
    });
  });

  await t.test('1. Owner flow: click Marketing -> workspace visible -> Program Promosi Brand visible -> + Buat Promo Baru visible -> modal opens', async () => {
    const { win } = createDashboardDOM('', 'owner');
    evalApp(win);
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await new Promise(res => setTimeout(res, 50));

    // 1. Marketing sidebar navigation item exists and is visible
    const mktNavBtn = win.document.querySelector('.x-nav-item[data-route="marketing"]');
    assert.ok(mktNavBtn, 'Marketing navigation button must exist in sidebar');
    assert.notStrictEqual(mktNavBtn.style.display, 'none', 'Marketing navigation button must be visible for Owner');

    // 2. Click Marketing
    mktNavBtn.click();
    await new Promise(res => setTimeout(res, 50));

    // 3. Marketing workspace tab is activated
    const activeTab = win.document.querySelector('.x-tab-content.active');
    assert.ok(activeTab, 'Active tab must exist');
    assert.strictEqual(activeTab.id, 'tab-marketing', 'Clicking Marketing must activate tab-marketing');

    // 4. Promotions workspace subview is visible (not hidden with display:none)
    const promoWorkspace = win.document.getElementById('marketing-view-promotions');
    assert.ok(promoWorkspace, 'marketing-view-promotions must exist');
    assert.notStrictEqual(promoWorkspace.style.display, 'none', 'marketing-view-promotions must be visible');

    // 5. Program Promosi Brand section header is visible
    assert.match(promoWorkspace.textContent, /Program Promosi Brand/, 'Program Promosi Brand title must be visible in workspace');

    // 6. Create Promotion button exists and is visible
    const createBtn = win.document.getElementById('btn-mkt-create-promo');
    assert.ok(createBtn, 'btn-mkt-create-promo button must exist');
    assert.notStrictEqual(createBtn.style.display, 'none', 'btn-mkt-create-promo button must be visible for Owner');

    // 7. Modal starts closed
    const modal = win.document.getElementById('modal-mkt-promotion');
    assert.ok(modal, 'modal-mkt-promotion must exist in DOM');
    assert.strictEqual(modal.style.display, 'none', 'Modal must initially be closed');

    // 8. Click create button -> modal opens
    createBtn.click();
    await new Promise(res => setTimeout(res, 50));

    assert.strictEqual(modal.style.display, 'flex', 'Modal must open with display: flex');
    const modalTitle = win.document.getElementById('modal-mkt-promo-title');
    assert.strictEqual(modalTitle.textContent, 'Buat Program Promosi Baru');

    // 9. Check required inputs inside modal
    assert.ok(win.document.getElementById('mkt-promo-name'), 'Campaign name input must exist');
    assert.ok(win.document.getElementById('mkt-promo-code'), 'Promo code input must exist');
    assert.ok(win.document.getElementById('mkt-promo-capability'), 'Capability select must exist');
    assert.ok(win.document.getElementById('mkt-promo-stacking'), 'Stacking policy select must exist');
    assert.ok(win.document.getElementById('mkt-promo-limit-per-user'), 'Limit per user input must exist');
    assert.ok(win.document.getElementById('mkt-promo-limit-total'), 'Limit total input must exist');
    assert.ok(win.document.getElementById('mkt-promo-status'), 'Status select must exist');
    assert.ok(win.document.getElementById('mkt-promo-start-at'), 'Start date input must exist');
    assert.ok(win.document.getElementById('mkt-promo-end-at'), 'End date input must exist');
    assert.ok(win.document.getElementById('mkt-promo-target-product'), 'Target product select must exist');
    assert.ok(win.document.getElementById('mkt-promo-branches-list'), 'Branches list container must exist');
    assert.ok(win.document.getElementById('btn-mkt-submit-promo'), 'Submit button must exist');
  });

  await t.test('2. BM isolation: Owner campaign builder not exposed to Branch Manager & operational promo UI preserved', async () => {
    const { win } = createDashboardDOM('', 'branch_manager');
    evalApp(win);
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await new Promise(res => setTimeout(res, 50));

    // 1. Sidebar is rendered with BM items (no marketing item)
    const mktNavBtn = win.document.querySelector('.x-nav-item[data-route="marketing"]');
    assert.strictEqual(mktNavBtn, null, 'BM navigation must not include Marketing route in sidebar');

    // 2. BM has operational Promo button in sidebar
    const bmPromoBtn = win.document.querySelector('.x-nav-item[data-route="promo"]');
    assert.ok(bmPromoBtn, 'BM navigation must include operational Promo button');

    // 3. Create promo button is hidden for BM
    const createBtn = win.document.getElementById('btn-mkt-create-promo');
    assert.ok(createBtn, 'btn-mkt-create-promo element exists in DOM');
    assert.strictEqual(createBtn.style.display, 'none', 'btn-mkt-create-promo must be hidden for non-owner');

    // 4. BM navigating to marketing route is redirected to promo
    win.navigateTo('marketing');
    await new Promise(res => setTimeout(res, 50));

    const activeTab = win.document.querySelector('.x-tab-content.active');
    assert.ok(activeTab, 'Active tab must exist');
    assert.strictEqual(activeTab.id, 'tab-bm-promo', 'BM navigating to marketing must safely redirect to tab-bm-promo');

    // 5. BM invocation of openCreatePromotionModal() is blocked
    const modal = win.document.getElementById('modal-mkt-promotion');
    await win.openCreatePromotionModal();
    assert.strictEqual(modal.style.display, 'none', 'BM must be blocked from opening creation modal');
  });

  await t.test('3. Direct deep-link routing to #marketing and #marketing/promotions activates workspace', async () => {
    const routesToTest = ['marketing', 'marketing/promotions'];

    for (const r of routesToTest) {
      const { win } = createDashboardDOM(r, 'owner');
      evalApp(win);
      win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
      await new Promise(res => setTimeout(res, 50));

      const activeTab = win.document.querySelector('.x-tab-content.active');
      assert.ok(activeTab, `Active tab must exist for #${r}`);
      assert.strictEqual(activeTab.id, 'tab-marketing', `Route #${r} must activate tab-marketing`);

      const promoWorkspace = win.document.getElementById('marketing-view-promotions');
      assert.ok(promoWorkspace, 'marketing-view-promotions must exist');
      assert.notStrictEqual(promoWorkspace.style.display, 'none', `Route #${r} must expose marketing-view-promotions`);
    }
  });

  await t.test('4. Marketing subnav switching works: Overview and Promotions toggling', async () => {
    const { win } = createDashboardDOM('marketing/overview', 'owner');
    evalApp(win);
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await new Promise(res => setTimeout(res, 50));

    // Initially in overview
    const overviewView = win.document.getElementById('marketing-view-overview');
    const promoView = win.document.getElementById('marketing-view-promotions');
    assert.notStrictEqual(overviewView.style.display, 'none', 'Overview view must be visible when on marketing/overview');
    assert.strictEqual(promoView.style.display, 'none', 'Promotions view must be hidden when on marketing/overview');

    // Switch to promotions
    win.switchMarketingSection('promotions');
    await new Promise(res => setTimeout(res, 50));

    assert.strictEqual(overviewView.style.display, 'none', 'Overview view must be hidden after switching to promotions');
    assert.notStrictEqual(promoView.style.display, 'none', 'Promotions view must be visible after switching to promotions');
  });
});
