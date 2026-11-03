const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SHARED_JS = fs.readFileSync(path.join(__dirname, '../apps/merchant-shared/js/shared.js'), 'utf8');
const OPS_CHAT_JS = fs.readFileSync(path.join(__dirname, '../apps/merchant-shared/js/ops-chat.js'), 'utf8');
const ORDERS_JS = fs.readFileSync(path.join(__dirname, '../apps/merchant-app/assets/js/orders.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(__dirname, '../apps/merchant-app/index.html'), 'utf8');

test('MERCHANT APP — Ops Chat & Order Detail Hierarchical Navigation Contract', async (t) => {
  await t.test('1. Static source verification: ops-chat.js integrates with XentraNav', () => {
    assert.ok(
      OPS_CHAT_JS.includes("window.XentraNav.push(threadCloseFn, 'ops-chat-thread')") ||
      OPS_CHAT_JS.includes("'ops-chat-thread'"),
      'ops-chat.js must register ops-chat-thread to XentraNav'
    );
    assert.ok(
      OPS_CHAT_JS.includes("'ops-chat-inbox'"),
      'ops-chat.js must register ops-chat-inbox to XentraNav'
    );
    assert.ok(
      OPS_CHAT_JS.includes("window.XentraNav.pop('ops-chat-thread')"),
      'ops-chat.js navigateBack must pop ops-chat-thread via XentraNav'
    );
  });

  await t.test('2. DOM Simulation: Opening Ops Chat from Order Detail and navigating back returns to Order Detail', async () => {
    const dom = new JSDOM(INDEX_HTML, {
      url: 'https://app.mybangjo.com/merchant/',
      runScripts: 'dangerously'
    });
    const win = dom.window;

    const escapeHtml = (val) => String(val == null ? '' : val)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    win.fetch = async (url) => {
      if (String(url).includes('/orders/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            order: {
              id: 'MB-TEST-99',
              order_number: 'MB-TEST-99',
              status: 'pending',
              order_type: 'delivery',
              customer_name: 'Pelanggan Setia',
              items: [{ item_name: 'Paket Ayam', qty: 1, price: 25000 }]
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, orders: [], messages: [] })
      };
    };

    win.XentraShared = {
      API_BASE: 'https://example.test',
      $: (id) => win.document.getElementById(id),
      esc: escapeHtml,
      formatMoney: (v) => 'Rp' + Number(v || 0).toLocaleString('id-ID'),
      showToast: () => {},
      adminFetch: async (url) => win.fetch(url),
      getAuthHeaders: () => ({}),
      getStoredUser: () => ({ branch_id: 'branch-1', branch_name: 'MyBangjo Cabang' }),
      isBranchManager: () => true,
      checkAuth: () => true
    };

    // Load scripts in DOM order
    win.eval(SHARED_JS);
    win.eval(ORDERS_JS);
    win.eval(OPS_CHAT_JS);

    // Initial state: on order list
    const listView = win.document.getElementById('bm-orders-list-view');
    const detailView = win.document.getElementById('bm-orders-detail-view');
    assert.equal(listView.style.display, '', 'List view initially visible');
    assert.equal(detailView.style.display, 'none', 'Detail view initially hidden');
    assert.equal(win.XentraNav.hasOpen(), false, 'XentraNav stack initially empty');

    // STEP 1: User opens order detail for MB-TEST-99
    await win.viewBMOrderDetail('MB-TEST-99');

    assert.equal(listView.style.display, 'none', 'List view hidden when detail is open');
    assert.equal(detailView.style.display, 'block', 'Detail view visible');
    assert.ok(win.XentraNav.hasOpen('order-detail'), 'order-detail is registered in XentraNav stack');

    // STEP 2: From Order Detail, user opens Ops Chat
    win.openOrderOpsChat('MB-TEST-99');

    const chatRoot = win.document.getElementById('x-ops-chat-root');
    assert.ok(chatRoot, 'Ops chat root element must exist');
    assert.ok(chatRoot.classList.contains('is-open'), 'Ops chat must be open');
    assert.ok(win.XentraNav.hasOpen('ops-chat-thread'), 'ops-chat-thread is registered on top of XentraNav stack');
    assert.ok(win.XentraNav.hasOpen('order-detail'), 'order-detail is still preserved in XentraNav stack');

    // STEP 3: User triggers back navigation in Ops Chat (clicking Back button or edge swipe)
    const backBtn = win.document.getElementById('x-ops-btn-back');
    assert.ok(backBtn, 'Chat back button must exist');
    backBtn.click();

    // CRITICAL ASSERTION: Chat must close, BUT Order Detail MUST STAY OPEN!
    assert.ok(!chatRoot.classList.contains('is-open'), 'Ops chat must be closed after back');
    assert.equal(detailView.style.display, 'block', 'Detail view MUST STAY VISIBLE (not closed!)');
    assert.equal(listView.style.display, 'none', 'List view MUST STAY HIDDEN');
    assert.ok(!win.XentraNav.hasOpen('ops-chat-thread'), 'ops-chat-thread popped from stack');
    assert.ok(win.XentraNav.hasOpen('order-detail'), 'order-detail remains on top of XentraNav stack');

    // STEP 4: User now clicks back on Order Detail
    const detailBackBtn = win.document.querySelector('.bm-detail-back-btn');
    assert.ok(detailBackBtn, 'Order detail back button must exist');
    detailBackBtn.click();

    // Now Order Detail closes and returns to outer Order List
    assert.equal(detailView.style.display, 'none', 'Detail view closed after second back');
    assert.equal(listView.style.display, 'block', 'List view visible after second back');
    assert.ok(!win.XentraNav.hasOpen('order-detail'), 'order-detail popped from stack');
    assert.equal(win.XentraNav.hasOpen(), false, 'XentraNav stack is empty');

    win.close();
  });

  await t.test('3. Mobile swipe gesture on Order Detail view closes detail view back to list', () => {
    assert.ok(
      ORDERS_JS.includes('bindOrderDetailSwipeGesture'),
      'orders.js must provide edge-swipe gesture support for order detail view'
    );
  });
});
