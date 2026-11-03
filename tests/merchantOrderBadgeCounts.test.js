const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'apps/merchant-app/index.html');
const CSS_PATH = path.join(ROOT, 'apps/merchant-app/assets/css/home.css');
const JS_ORDERS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/orders.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8');
const CSS = fs.readFileSync(CSS_PATH, 'utf8');
const JS = fs.readFileSync(JS_ORDERS_PATH, 'utf8');

test('MERCHANT ORDER BADGES & STAGE COUNTS — Contract & Logic Suite', async (t) => {
  await t.test('1. Main status tabs have visible badge elements for all 4 operational states', () => {
    assert.ok(HTML.includes('id="badge-count-in-process"'), '#badge-count-in-process must exist in index.html');
    assert.ok(HTML.includes('id="badge-count-scheduled"'), '#badge-count-scheduled must exist in index.html');
    assert.ok(HTML.includes('id="badge-count-completed"'), '#badge-count-completed must exist in index.html');
    assert.ok(HTML.includes('id="badge-count-cancelled"'), '#badge-count-cancelled must exist in index.html');

    // Badges must not be permanently hidden with style="display:none;" in HTML template
    assert.ok(!HTML.includes('id="badge-count-in-process" style="display:none;"'), 'in-process badge must not be hardcoded to display:none');
    assert.ok(!HTML.includes('id="badge-count-scheduled" style="display:none;"'), 'scheduled badge must not be hardcoded to display:none');
    assert.ok(!HTML.includes('id="badge-count-completed" style="display:none;"'), 'completed badge must not be hardcoded to display:none');
    assert.ok(!HTML.includes('id="badge-count-cancelled" style="display:none;"'), 'cancelled badge must not be hardcoded to display:none');
  });

  await t.test('2. Kitchen stage sub-filters have count containers for Semua, Masuk, Dimasak, and Siap', () => {
    assert.ok(HTML.includes('id="subfilter-count-all"'), '#subfilter-count-all must exist in index.html');
    assert.ok(HTML.includes('id="subfilter-count-incoming"'), '#subfilter-count-incoming must exist in index.html');
    assert.ok(HTML.includes('id="subfilter-count-cooking"'), '#subfilter-count-cooking must exist in index.html');
    assert.ok(HTML.includes('id="subfilter-count-ready"'), '#subfilter-count-ready must exist in index.html');

    // Check each is nestled inside its respective data-stage-filter button
    assert.ok(
      /data-stage-filter="all"[^>]*>[\s\S]*?id="subfilter-count-all"/i.test(HTML),
      'subfilter-count-all must be inside data-stage-filter="all"'
    );
    assert.ok(
      /data-stage-filter="incoming"[^>]*>[\s\S]*?id="subfilter-count-incoming"/i.test(HTML),
      'subfilter-count-incoming must be inside data-stage-filter="incoming"'
    );
    assert.ok(
      /data-stage-filter="cooking"[^>]*>[\s\S]*?id="subfilter-count-cooking"/i.test(HTML),
      'subfilter-count-cooking must be inside data-stage-filter="cooking"'
    );
    assert.ok(
      /data-stage-filter="ready"[^>]*>[\s\S]*?id="subfilter-count-ready"/i.test(HTML),
      'subfilter-count-ready must be inside data-stage-filter="ready"'
    );
  });

  await t.test('3. home.css defines stage subfilter count styling and active contrast state', () => {
    assert.ok(/\.stage-subfilter-count\s*\{/i.test(CSS), '.stage-subfilter-count class must be defined in home.css');
    assert.ok(
      /\.stage-subfilter-btn\.active\s+\.stage-subfilter-count/i.test(CSS),
      'active stage button must style .stage-subfilter-count with contrast'
    );
  });

  await t.test('4. orders.js calculates stage subfilter counts and updates badge elements', () => {
    assert.ok(JS.includes('subfilter-count-all'), 'orders.js must reference subfilter-count-all');
    assert.ok(JS.includes('subfilter-count-incoming'), 'orders.js must reference subfilter-count-incoming');
    assert.ok(JS.includes('subfilter-count-cooking'), 'orders.js must reference subfilter-count-cooking');
    assert.ok(JS.includes('subfilter-count-ready'), 'orders.js must reference subfilter-count-ready');

    // Must calculate incomingCount, cookingCount, readyCount
    assert.ok(JS.includes('incomingCount'), 'orders.js must calculate incomingCount');
    assert.ok(JS.includes('cookingCount'), 'orders.js must calculate cookingCount');
    assert.ok(JS.includes('readyCount'), 'orders.js must calculate readyCount');

    // In-process orders must not be dropped by startOfTodayWibMs
    assert.ok(
      !/inProcessOrders[\s\S]*?cMs\s*<\s*startOfTodayWibMs\s*\)\s*return\s*false/i.test(JS),
      'inProcessOrders must not drop active orders older than today'
    );
  });

  await t.test('5. Simulation of mathematical counts and categorization logic', () => {
    const mockOrders = [
      { id: '1', status: 'pending', order_type: 'delivery' },
      { id: '2', status: 'pending', order_type: 'dine_in' },
      { id: '3', status: 'confirmed', order_type: 'takeaway' },
      { id: '4', status: 'preparing', order_type: 'delivery' },
      { id: '5', status: 'ready', order_type: 'dine_in' },
      { id: '6', status: 'confirmed', order_type: 'reservation', scheduled_slot_start: '2099-01-01T10:00:00Z' },
      { id: '7', status: 'completed', order_type: 'delivery' },
      { id: '8', status: 'cancelled', order_type: 'dine_in' }
    ];

    const inProcess = mockOrders.filter(ord => {
      const st = ord.status;
      if (['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(st)) {
        if (ord.order_type === 'reservation' && st === 'confirmed' && new Date(ord.scheduled_slot_start) > Date.now()) {
          return false;
        }
        return true;
      }
      return false;
    });

    assert.equal(inProcess.length, 5, '5 orders should be in process (2 pending, 1 confirmed, 1 preparing, 1 ready)');

    let incoming = 0;
    let cooking = 0;
    let ready = 0;
    inProcess.forEach(ord => {
      if (ord.status === 'pending') incoming++;
      else if (ord.status === 'confirmed' || ord.status === 'preparing') cooking++;
      else if (ord.status === 'ready' || ord.status === 'out_for_delivery') ready++;
    });

    assert.equal(incoming, 2, 'incomingCount must be 2');
    assert.equal(cooking, 2, 'cookingCount must be 2');
    assert.equal(ready, 1, 'readyCount must be 1');
    assert.equal(incoming + cooking + ready, inProcess.length, 'Sum of stage filters must equal in-process total');
  });

  await t.test('6. Bottom navbar icon margin-top and non-overlapping red order badge', () => {
    // Icon margin-top ensures breathing room from top indicator
    assert.ok(
      /\.x-merchant-mobile-nav-item\s+svg[\s\S]*?margin-top:\s*6px/i.test(CSS),
      'home.css must define margin-top: 6px for bottom nav icons'
    );

    // Indicator bar is sleek (height: 4px at top: 0)
    assert.ok(
      /\.x-merchant-mobile-nav-item\.active::before[\s\S]*?height:\s*4px/i.test(CSS),
      'active indicator must be sleek 4px'
    );

    // Badge top clearance: top: 8px leaves 4px clearance below indicator (0 to 4px)
    assert.ok(
      /\.x-merchant-mobile-nav-item\s+\.x-mobile-nav-badge[\s\S]*?top:\s*8px/i.test(CSS),
      'mobile orders badge must have top: 8px clearance away from indicator'
    );

    // Badge z-index is higher than indicator (indicator z-index: 10, badge z-index: 20)
    assert.ok(
      /\.x-merchant-mobile-nav-item\s+\.x-mobile-nav-badge[\s\S]*?z-index:\s*20/i.test(CSS),
      'badge z-index must be 20 to never be occluded'
    );
  });

  await t.test('7. Stage subfilter (Semua, Masuk, Dimasak, Siap) filters order cards correctly in DOM', async () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(HTML, {
      url: 'https://app.mybangjo.com/merchant/',
      runScripts: 'dangerously'
    });
    const win = dom.window;

    // Verify index.html defines id="bm-pesanan-nav-tabs"
    const navTabsEl = win.document.getElementById('bm-pesanan-nav-tabs');
    assert.ok(navTabsEl, 'index.html must have element with id="bm-pesanan-nav-tabs"');

    const escapeHtml = (val) => String(val == null ? '' : val)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    win.XentraShared = {
      API_BASE: 'https://example.test',
      $: (id) => win.document.getElementById(id),
      esc: escapeHtml,
      formatMoney: (v) => 'Rp' + Number(v || 0).toLocaleString('id-ID'),
      showToast: () => {},
      adminFetch: async () => ({
        ok: true,
        json: async () => ({ success: true, orders: [] })
      }),
      getAuthHeaders: () => ({}),
      getStoredUser: () => ({ branch_id: 'branch-1' }),
      isBranchManager: () => true,
      checkAuth: () => true
    };

    win.eval(JS);

    // Mock orders across all stages
    win._bmOrdersState.orders = [
      { id: 'ord-in-1', order_number: 'IN-1', status: 'pending', order_type: 'delivery', created_at: new Date().toISOString() },
      { id: 'ord-in-2', order_number: 'IN-2', status: 'pending', order_type: 'dine_in', created_at: new Date().toISOString() },
      { id: 'ord-ck-1', order_number: 'CK-1', status: 'confirmed', order_type: 'takeaway', created_at: new Date().toISOString() },
      { id: 'ord-ck-2', order_number: 'CK-2', status: 'preparing', order_type: 'delivery', created_at: new Date().toISOString() },
      { id: 'ord-rd-1', order_number: 'RD-1', status: 'ready', order_type: 'dine_in', created_at: new Date().toISOString() },
      { id: 'ord-sc-1', order_number: 'SC-1', status: 'confirmed', order_type: 'reservation', scheduled_slot_start: '2099-01-01T10:00:00Z', created_at: new Date().toISOString() },
      { id: 'ord-dn-1', order_number: 'DN-1', status: 'completed', order_type: 'delivery', created_at: new Date().toISOString() },
      { id: 'ord-cx-1', order_number: 'CX-1', status: 'cancelled', order_type: 'dine_in', created_at: new Date().toISOString() }
    ];

    // Ensure shop is open
    const openSwitch = win.document.getElementById('pesanan-open-switch');
    if (openSwitch) openSwitch.classList.add('is-on');

    // 1. Initial render on "Dalam proses" + "Semua" stage
    win.setBMPesananTab('in_process');
    win.setBMStageSubfilter('all');

    let cards = win.document.querySelectorAll('#bm-orders-cards-container [data-order-id]');
    assert.equal(cards.length, 5, 'Semua stage must show 5 in-process orders');

    // Verify subfilter counts in badges
    assert.equal(win.document.getElementById('subfilter-count-all').textContent, '5');
    assert.equal(win.document.getElementById('subfilter-count-incoming').textContent, '2');
    assert.equal(win.document.getElementById('subfilter-count-cooking').textContent, '2');
    assert.equal(win.document.getElementById('subfilter-count-ready').textContent, '1');

    // 2. Filter: "Masuk" (incoming -> pending only)
    win.setBMStageSubfilter('incoming');
    cards = win.document.querySelectorAll('#bm-orders-cards-container [data-order-id]');
    assert.equal(cards.length, 2, 'Masuk filter must show exactly 2 pending orders');
    const incomingIds = Array.from(cards).map(c => c.getAttribute('data-order-id'));
    assert.deepEqual(incomingIds.sort(), ['ord-in-1', 'ord-in-2'].sort());
    assert.ok(
      win.document.querySelector('.stage-subfilter-btn[data-stage-filter="incoming"]').classList.contains('active'),
      'Masuk stage button must have active class'
    );

    // 3. Filter: "Dimasak" (cooking -> confirmed + preparing)
    win.setBMStageSubfilter('cooking');
    cards = win.document.querySelectorAll('#bm-orders-cards-container [data-order-id]');
    assert.equal(cards.length, 2, 'Dimasak filter must show exactly 2 cooking orders');
    const cookingIds = Array.from(cards).map(c => c.getAttribute('data-order-id'));
    assert.deepEqual(cookingIds.sort(), ['ord-ck-1', 'ord-ck-2'].sort());
    assert.ok(
      win.document.querySelector('.stage-subfilter-btn[data-stage-filter="cooking"]').classList.contains('active'),
      'Dimasak stage button must have active class'
    );

    // 4. Filter: "Siap" (ready -> ready + out_for_delivery)
    win.setBMStageSubfilter('ready');
    cards = win.document.querySelectorAll('#bm-orders-cards-container [data-order-id]');
    assert.equal(cards.length, 1, 'Siap filter must show exactly 1 ready order');
    assert.equal(cards[0].getAttribute('data-order-id'), 'ord-rd-1');
    assert.ok(
      win.document.querySelector('.stage-subfilter-btn[data-stage-filter="ready"]').classList.contains('active'),
      'Siap stage button must have active class'
    );

    // 5. Filter: back to "Semua"
    win.setBMStageSubfilter('all');
    cards = win.document.querySelectorAll('#bm-orders-cards-container [data-order-id]');
    assert.equal(cards.length, 5, 'Back to Semua must show all 5 in-process orders');

    // 6. Switching to "Terjadwal" tab hides stage subfilter bar and shows scheduled orders
    win.setBMPesananTab('scheduled');
    cards = win.document.querySelectorAll('#bm-orders-cards-container [data-order-id]');
    assert.equal(cards.length, 1, 'Terjadwal tab must show 1 scheduled order');
    assert.equal(cards[0].getAttribute('data-order-id'), 'ord-sc-1');
    assert.equal(win.document.getElementById('bm-stage-subfilter-bar').style.display, 'none');

    // 7. Switching to "Selesai" tab shows completed orders
    win.setBMPesananTab('completed');
    cards = win.document.querySelectorAll('#bm-orders-cards-container [data-order-id]');
    assert.equal(cards.length, 1, 'Selesai tab must show 1 completed order');
    assert.equal(cards[0].getAttribute('data-order-id'), 'ord-dn-1');

    // 8. Switching to "Batal" tab shows cancelled orders
    win.setBMPesananTab('cancelled');
    cards = win.document.querySelectorAll('#bm-orders-cards-container [data-order-id]');
    assert.equal(cards.length, 1, 'Batal tab must show 1 cancelled order');
    assert.equal(cards[0].getAttribute('data-order-id'), 'ord-cx-1');

    win.close();
  });
});
