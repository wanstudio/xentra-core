'use strict';

/**
 * Phase 7 — Branch Acceptance Waiting Test Suite
 *
 * Covers:
 * P7.1 Awaiting acceptance screen (renders waiting screen, does not claim acceptance)
 * P7.2 Server-authoritative status (client cannot manufacture ACCEPTED/REJECTED/TIMEOUT)
 * P7.3 3-minute UX timer (purely display, zero does not mutate, server asked at zero)
 * P7.4 Refresh / re-entry recovery (reconstructs state from server, no state loss)
 * P7.5 Accepted state (renders confirmed/accepted state when server reports confirmed)
 * P7.6 Rejected state (renders rejected state with reason, separate from payment)
 * P7.7 Timeout state (renders timeout state only when server reports timeout)
 * Polling & Lifecycle (stops on terminal state, cleans up on unmount, no duplicate loops)
 * Branch Identity & Isolation (cannot switch branch, remains bound to fulfillment branch)
 * Regressions (P4 cart, P5 checkout, P6 payment, Branch Acceptance contract)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-p7-branch-waiting';

const app = require('../../server/app');
const db = require('../../server/database/db');
const OrderStateMachine = require('../../server/services/OrderStateMachine');
const AcceptanceTimeoutService = require('../../server/services/AcceptanceTimeoutService');
const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');

let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const BRANCH_ID = 'branch_bangjo_barat';

function makeOrderId() { return 'p7_ord_' + crypto.randomBytes(5).toString('hex'); }
function makeOrderNum() { return 'P7-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }

function seedOrder({
  orderId,
  status = 'pending',
  branchId = BRANCH_ID,
  phone = '081200000077',
  orderType = 'delivery',
  grandTotal = 75000,
  paymentMethod = 'midtrans',
  paymentStatus = 'settlement',
  snapToken = 'snap_token_p7_test',
  createdAt = new Date().toISOString()
} = {}) {
  orderId = orderId || makeOrderId();
  const num = makeOrderNum();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO orders (
      id, order_number, brand_id, branch_id, customer_name, customer_phone,
      order_type, status, subtotal, delivery_fee, discount_amount, grand_total,
      payment_method, payment_status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'P7 Customer', ?, ?, ?, 70000, 5000, 0, ?, ?, ?, ?, ?)
  `).run(
    orderId, num, BRAND_ID, branchId, phone,
    orderType, status, grandTotal,
    paymentMethod, paymentStatus, createdAt, now
  );

  const payId = 'pay_' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_method, payment_status, amount, snap_token, created_at)
    VALUES (?, ?, 'midtrans', ?, ?, ?, ?, ?)
  `).run(payId, orderId, paymentMethod, paymentStatus, grandTotal, snapToken, now);

  return { orderId, num, phone, branchId, grandTotal, snapToken };
}

function seedCustomerSession(phone, brandId = BRAND_ID) {
  const token = 'p7cust_' + crypto.randomBytes(8).toString('hex');
  const store = global.TokenSessionStore;
  if (store && store.sessions) {
    store.sessions.set(token, {
      type: 'customer',
      role: 'customer',
      phone: phone.trim(),
      customerPhone: phone.trim(),
      brandId,
      brand_id: brandId,
      email_verified: true,
      expiresAt: Date.now() + 86400 * 1000
    });
  }
  return token;
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body != null ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'app.mybangjo.com',
        ...headers
      }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function setupPwaDOM() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="x-order-content"></div></body></html>`, {
    url: 'https://app.mybangjo.com/order-received',
    runScripts: 'dangerously'
  });
  const win = dom.window;

  win.Xentra = {
    UI: {
      escape: (str) => String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      money: (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID'),
      toast: () => {}
    },
    Store: {
      clearCart: () => {}
    },
    Router: {
      getOrderIdFromUrl: () => null,
      navigate: () => {}
    },
    API: {
      get: async () => ({ success: false }),
      post: async () => ({ success: false })
    }
  };

  const scriptPath = path.join(__dirname, '../../apps/customer-pwa/assets/js/pages/order-received.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  new win.Function('window', 'document', code)(win, win.document);

  return { win, dom, container: win.document.getElementById('x-order-content') };
}

describe('Phase 7 — Branch Acceptance Waiting Matrix', () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    db.prepare("DELETE FROM order_payments WHERE order_id LIKE 'p7_ord_%'").run();
    db.prepare("DELETE FROM order_status_logs WHERE order_id LIKE 'p7_ord_%'").run();
    db.prepare("DELETE FROM orders WHERE id LIKE 'p7_ord_%'").run();
  });

  // ─── Awaiting Acceptance (P7.1) ──────────────────────────────────────────

  it('1. Paid order with awaiting acceptance renders waiting screen', async () => {
    const { win, container } = setupPwaDOM();
    const mockData = {
      success: true,
      order: {
        id: 'ord_p7_awaiting',
        order_number: 'P7-WAIT-01',
        status: 'pending',
        grand_total: 85000,
        payment_method: 'midtrans',
        branch_name: 'Cabang Bangjo Barat',
        acceptance_deadline_at: new Date(Date.now() + 180000).toISOString()
      },
      payment: {
        payment_method: 'midtrans',
        payment_status: 'settlement',
        amount: 85000
      }
    };

    win.Xentra.API.get = async () => mockData;
    win.Xentra.OrderReceived.mount(container, 'ord_p7_awaiting');
    await new Promise(r => setTimeout(r, 25));

    const html = container.innerHTML;
    assert.ok(html.includes('id="x-waiting-screen"'), 'Renders waiting screen');
    assert.ok(html.includes('Menunggu Konfirmasi Cabang'), 'Displays waiting for branch title');
    assert.ok(html.includes('id="x-badge-pay-confirmed"'), 'Displays payment confirmed badge');
    assert.ok(html.includes('Cabang Bangjo Barat'), 'Mentions authoritative branch');
    win.Xentra.OrderReceived.unmount();
  });

  it('2. Waiting screen does not claim acceptance', async () => {
    const { win, container } = setupPwaDOM();
    const mockData = {
      success: true,
      order: {
        id: 'ord_p7_no_claim',
        order_number: 'P7-WAIT-02',
        status: 'pending',
        grand_total: 50000,
        payment_method: 'midtrans',
        branch_name: 'Cabang Barat'
      },
      payment: { payment_method: 'midtrans', payment_status: 'settlement' }
    };

    win.Xentra.API.get = async () => mockData;
    win.Xentra.OrderReceived.mount(container, 'ord_p7_no_claim');
    await new Promise(r => setTimeout(r, 25));

    const html = container.innerHTML;
    assert.ok(!html.includes('Pesanan Diterima Cabang!'), 'Must not claim branch accepted');
    assert.ok(!html.includes('Sedang Disiapkan di Dapur'), 'Must not claim kitchen preparing');
    assert.ok(!html.includes('Status Alur Pesanan'), 'Must not render accepted fulfillment stepper');
    win.Xentra.OrderReceived.unmount();
  });

  it('3. Payment success alone cannot produce accepted state', async () => {
    const seed = seedOrder({
      paymentMethod: 'midtrans',
      paymentStatus: 'settlement',
      status: 'pending'
    });

    const token = seedCustomerSession(seed.phone);
    const res = await request('GET', `/api/v1/orders/${seed.orderId}`, null, {
      'Authorization': `Bearer ${token}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.order.status, 'pending', 'Server order status remains pending');
    assert.strictEqual(res.data.payment.payment_status, 'settlement', 'Payment is settlement');

    // UI mount test
    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res.data;
    win.Xentra.OrderReceived.mount(container, seed.orderId);
    await new Promise(r => setTimeout(r, 25));

    assert.ok(container.innerHTML.includes('Menunggu Konfirmasi Cabang'));
    assert.ok(!container.innerHTML.includes('Pesanan Diterima Cabang!'));
    win.Xentra.OrderReceived.unmount();
  });

  // ─── Server Authority (P7.2) ─────────────────────────────────────────────

  it('4. Client cannot manufacture ACCEPTED (PUT/PATCH rejected by server)', async () => {
    const seed = seedOrder({ status: 'pending' });
    const token = seedCustomerSession(seed.phone);

    // Attempt client status mutation via PUT /orders/:id
    const resPut = await request('PUT', `/api/v1/orders/${seed.orderId}`, { status: 'confirmed' }, {
      'Authorization': `Bearer ${token}`
    });
    // Core routes do not allow arbitrary customer status updates
    assert.ok(resPut.status === 404 || resPut.status === 405 || resPut.status === 403);

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(seed.orderId);
    assert.strictEqual(check.status, 'pending', 'Order status must not be modified by customer');
  });

  it('5. Client cannot manufacture REJECTED or mutate order state directly', async () => {
    const seed = seedOrder({ status: 'pending' });
    const token = seedCustomerSession(seed.phone);

    const resPost = await request('POST', `/api/v1/orders/${seed.orderId}/reject`, { reason: 'fake' }, {
      'Authorization': `Bearer ${token}`
    });
    assert.ok(resPost.status === 404 || resPost.status === 403 || resPost.status === 401);

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(seed.orderId);
    assert.strictEqual(check.status, 'pending');
  });

  it('6. Client cannot manufacture TIMEOUT', async () => {
    const seed = seedOrder({ status: 'pending' });
    const token = seedCustomerSession(seed.phone);

    const res = await request('POST', `/api/v1/orders/${seed.orderId}/timeout`, {}, {
      'Authorization': `Bearer ${token}`
    });
    assert.ok(res.status === 404 || res.status === 403 || res.status === 401);

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(seed.orderId);
    assert.strictEqual(check.status, 'pending');
  });

  it('7. Server status overrides stale client presentation', async () => {
    const { win, container } = setupPwaDOM();
    let currentServerStatus = 'pending';

    win.Xentra.API.get = async () => ({
      success: true,
      order: {
        id: 'ord_p7_stale_test',
        order_number: 'P7-STALE-01',
        status: currentServerStatus,
        grand_total: 45000,
        branch_name: 'Cabang Barat'
      },
      payment: { payment_method: 'cash', payment_status: 'pending' }
    });

    win.Xentra.OrderReceived.mount(container, 'ord_p7_stale_test');
    await new Promise(r => setTimeout(r, 25));
    assert.ok(container.innerHTML.includes('Menunggu Konfirmasi Cabang'));

    // Server transitions to confirmed
    currentServerStatus = 'confirmed';
    // Trigger fresh load
    win.Xentra.OrderReceived.mount(container, 'ord_p7_stale_test');
    await new Promise(r => setTimeout(r, 25));

    assert.ok(container.innerHTML.includes('Pesanan Diterima Cabang!'), 'Server status overrides stale presentation');
    win.Xentra.OrderReceived.unmount();
  });

  // ─── 3-Minute Timer (P7.3) ───────────────────────────────────────────────

  it('8. 3-minute countdown is displayed correctly and formatted from server deadline', async () => {
    const { win, container } = setupPwaDOM();
    const now = Date.now();
    const deadlineAt = new Date(now + 150000).toISOString(); // 2m 30s remaining

    win.Xentra.API.get = async () => ({
      success: true,
      order: {
        id: 'ord_p7_timer',
        order_number: 'P7-TIM-01',
        status: 'pending',
        grand_total: 50000,
        branch_name: 'Cabang Barat',
        acceptance_deadline_at: deadlineAt
      },
      payment: { payment_method: 'cash', payment_status: 'pending' }
    });

    win.Xentra.OrderReceived.mount(container, 'ord_p7_timer');
    await new Promise(r => setTimeout(r, 25));

    const countdownEl = win.document.getElementById('x-acceptance-countdown');
    assert.ok(countdownEl !== null, 'Countdown element exists');
    assert.ok(countdownEl.textContent.match(/02:30|02:29/), 'Calculates mm:ss from acceptance_deadline_at');
    assert.ok(container.innerHTML.includes('Timer ini hanya tampilan. Status pesanan selalu dari server.'));
    win.Xentra.OrderReceived.unmount();
  });

  it('9. Countdown reaching zero does not itself mutate order state or fabricate timeout', async () => {
    const { win, container } = setupPwaDOM();
    let queryCount = 0;

    win.Xentra.API.get = async () => {
      queryCount++;
      return {
        success: true,
        order: {
          id: 'ord_p7_zero_test',
          order_number: 'P7-ZERO-01',
          status: 'pending', // Server STILL says pending!
          grand_total: 50000,
          branch_name: 'Cabang Barat',
          acceptance_deadline_at: new Date(Date.now() - 1000).toISOString() // already passed
        },
        payment: { payment_method: 'cash', payment_status: 'pending' }
      };
    };

    win.Xentra.OrderReceived.mount(container, 'ord_p7_zero_test');
    await new Promise(r => setTimeout(r, 60));

    // Must NOT fabricate timeout screen if server reports pending
    assert.ok(!container.innerHTML.includes('Waktu Konfirmasi Habis'), 'Must never assume timeout when server says pending');
    assert.ok(container.innerHTML.includes('Menunggu Konfirmasi Cabang'), 'Maintains server awaiting state');
    win.Xentra.OrderReceived.unmount();
  });

  it('10. Server status is queried at countdown completion', async () => {
    const { win, container } = setupPwaDOM();
    let apiCalls = 0;

    win.Xentra.API.get = async () => {
      apiCalls++;
      return {
        success: true,
        order: {
          id: 'ord_p7_query_zero',
          order_number: 'P7-QZ-01',
          status: 'pending',
          grand_total: 50000,
          branch_name: 'Cabang Barat',
          acceptance_deadline_at: new Date(Date.now() + 1000).toISOString() // 1 sec left
        },
        payment: { payment_method: 'cash', payment_status: 'pending' }
      };
    };

    win.Xentra.OrderReceived.mount(container, 'ord_p7_query_zero');
    await new Promise(r => setTimeout(r, 25));
    const initialCalls = apiCalls;

    // Advance 1.5 seconds so timer hits 0
    await new Promise(r => setTimeout(r, 1500));
    assert.ok(apiCalls > initialCalls, 'Server API called to re-fetch authoritative state at countdown expiry');
    win.Xentra.OrderReceived.unmount();
  });

  it('11. Server-reported awaiting state remains awaiting even if client timer elapsed', async () => {
    const { win, container } = setupPwaDOM();

    win.Xentra.API.get = async () => ({
      success: true,
      order: {
        id: 'ord_p7_elapsed',
        order_number: 'P7-ELAPSED-01',
        status: 'pending',
        grand_total: 50000,
        branch_name: 'Cabang Barat',
        acceptance_deadline_at: new Date(Date.now() - 50000).toISOString() // elapsed 50s ago
      },
      payment: { payment_method: 'cash', payment_status: 'pending' }
    });

    win.Xentra.OrderReceived.mount(container, 'ord_p7_elapsed');
    await new Promise(r => setTimeout(r, 25));

    assert.ok(container.innerHTML.includes('Menunggu Konfirmasi Cabang'), 'Remains in waiting screen');
    assert.ok(!container.innerHTML.includes('id="x-timeout-screen"'));
    win.Xentra.OrderReceived.unmount();
  });

  // ─── Acceptance States (P7.5, P7.6, P7.7) ─────────────────────────────────

  it('12. Server ACCEPTED renders accepted state and fulfillment tracking', async () => {
    const { win, container } = setupPwaDOM();

    win.Xentra.API.get = async () => ({
      success: true,
      order: {
        id: 'ord_p7_accepted',
        order_number: 'P7-ACC-01',
        status: 'confirmed',
        order_type: 'delivery',
        grand_total: 65000,
        branch_name: 'Cabang Bangjo Barat'
      },
      items: [{ id: 'it_1', product_name: 'Ayam Geprek', quantity: 1, item_subtotal: 25000 }],
      payment: { payment_method: 'midtrans', payment_status: 'settlement' }
    });

    win.Xentra.OrderReceived.mount(container, 'ord_p7_accepted');
    await new Promise(r => setTimeout(r, 25));

    const html = container.innerHTML;
    assert.ok(html.includes('Pesanan Diterima Cabang!'), 'Shows accepted title');
    assert.ok(html.includes('Status Alur Pesanan'), 'Renders fulfillment stepper');
    assert.ok(html.includes('Cabang Bangjo Barat'), 'Renders fulfillment branch');
    assert.ok(!html.includes('id="x-waiting-screen"'), 'Does not show waiting screen');
    win.Xentra.OrderReceived.unmount();
  });

  it('13. Server REJECTED renders rejected state with reason, preserving order identity', async () => {
    const { win, container } = setupPwaDOM();

    win.Xentra.API.get = async () => ({
      success: true,
      order: {
        id: 'ord_p7_rejected',
        order_number: 'P7-REJ-01',
        status: 'rejected',
        grand_total: 70000,
        branch_name: 'Cabang Bangjo Barat'
      },
      payment: { payment_method: 'cash', payment_status: 'pending' },
      logs: [
        { previous_status: 'pending', new_status: 'rejected', note: '[REJECT by branch_mgr] Dapur sedang overload dan antrean penuh.' }
      ]
    });

    win.Xentra.OrderReceived.mount(container, 'ord_p7_rejected');
    await new Promise(r => setTimeout(r, 25));

    const html = container.innerHTML;
    assert.ok(html.includes('id="x-rejected-screen"'), 'Renders rejected screen');
    assert.ok(html.includes('Pesanan Ditolak'), 'Shows rejection title');
    assert.ok(html.includes('Dapur sedang overload dan antrean penuh.'), 'Shows audit log rejection reason');
    assert.ok(html.includes('P7-REJ-01'), 'Preserves order identity');
    assert.ok(html.includes('id="x-btn-order-again"'), 'Provides order again CTA');
    win.Xentra.OrderReceived.unmount();
  });

  it('14. Server TIMEOUT renders timeout state only when server reports timeout', async () => {
    const { win, container } = setupPwaDOM();

    win.Xentra.API.get = async () => ({
      success: true,
      order: {
        id: 'ord_p7_timeout',
        order_number: 'P7-TO-01',
        status: 'timeout',
        grand_total: 45000,
        branch_name: 'Cabang Bangjo Barat'
      },
      payment: { payment_method: 'cash', payment_status: 'pending' }
    });

    win.Xentra.OrderReceived.mount(container, 'ord_p7_timeout');
    await new Promise(r => setTimeout(r, 25));

    const html = container.innerHTML;
    assert.ok(html.includes('id="x-timeout-screen"'), 'Renders timeout screen');
    assert.ok(html.includes('Waktu Konfirmasi Habis'), 'Shows timeout title');
    assert.ok(html.includes('P7-TO-01'), 'Preserves order identity');
    assert.ok(html.includes('id="x-btn-try-again"'), 'Provides try again CTA');
    win.Xentra.OrderReceived.unmount();
  });

  // ─── Recovery (P7.4) ─────────────────────────────────────────────────────

  it('15. Refresh while awaiting reconstructs state from server', async () => {
    const seed = seedOrder({
      paymentMethod: 'midtrans',
      paymentStatus: 'settlement',
      status: 'pending'
    });

    const token = seedCustomerSession(seed.phone);
    // 1st request (initial load)
    const res1 = await request('GET', `/api/v1/orders/${seed.orderId}`, null, {
      'Authorization': `Bearer ${token}`
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.data.order.status, 'pending');

    // 2nd request (simulated browser refresh)
    const res2 = await request('GET', `/api/v1/orders/${seed.orderId}`, null, {
      'Authorization': `Bearer ${token}`
    });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.data.order.status, 'pending');
    assert.strictEqual(res2.data.order.branch_id, seed.branchId);
    assert.ok(res2.data.order.acceptance_deadline_at, 'Server re-computes deadline for display');
  });

  it('16. Re-entry reconstructs state from server without loss of order identity', async () => {
    const seed = seedOrder({
      paymentMethod: 'midtrans',
      paymentStatus: 'settlement',
      status: 'pending'
    });

    const token = seedCustomerSession(seed.phone);
    const res = await request('GET', `/api/v1/orders/${seed.orderId}`, null, {
      'Authorization': `Bearer ${token}`
    });

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res.data;
    win.Xentra.OrderReceived.mount(container, seed.orderId);
    await new Promise(r => setTimeout(r, 25));

    assert.ok(container.innerHTML.includes(seed.num), 'Shows correct order number on re-entry');
    assert.ok(container.innerHTML.includes('Menunggu Konfirmasi Cabang'), 'Re-establishes waiting screen');
    win.Xentra.OrderReceived.unmount();
  });

  it('17. Terminal state remains terminal after refresh', async () => {
    const seed = seedOrder({ status: 'pending', paymentStatus: 'pending', paymentMethod: 'cash' });

    // Transition to rejected via state machine
    OrderStateMachine.transition({
      order_id: seed.orderId,
      target_status: 'rejected',
      actor_type: 'branch_actor',
      actor_id: 'mgr_01',
      note: '[REJECT by branch_mgr] Stok habis'
    });

    const token = seedCustomerSession(seed.phone);
    const res = await request('GET', `/api/v1/orders/${seed.orderId}`, null, {
      'Authorization': `Bearer ${token}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.order.status, 'rejected');
    assert.strictEqual(res.data.order.acceptance_deadline_at, null, 'No deadline on terminal order');

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res.data;
    win.Xentra.OrderReceived.mount(container, seed.orderId);
    await new Promise(r => setTimeout(r, 25));

    assert.ok(container.innerHTML.includes('Pesanan Ditolak'), 'Shows rejected state');
    win.Xentra.OrderReceived.unmount();
  });

  // ─── Polling & Lifecycle (18, 19, 20) ─────────────────────────────────────

  it('18. No duplicate polling loops after multiple mount/unmount calls', async () => {
    const { win, container } = setupPwaDOM();
    let pollCount = 0;

    win.Xentra.API.get = async () => {
      pollCount++;
      return {
        success: true,
        order: {
          id: 'ord_p7_poll_dedupe',
          order_number: 'P7-POLL-01',
          status: 'pending',
          grand_total: 50000,
          branch_name: 'Cabang Barat'
        },
        payment: { payment_method: 'cash', payment_status: 'pending' }
      };
    };

    // Mount 3 times rapidly
    win.Xentra.OrderReceived.mount(container, 'ord_p7_poll_dedupe');
    win.Xentra.OrderReceived.mount(container, 'ord_p7_poll_dedupe');
    win.Xentra.OrderReceived.mount(container, 'ord_p7_poll_dedupe');
    await new Promise(r => setTimeout(r, 25));

    const countAfterMounts = pollCount;
    // Advance 4.2s to trigger at most one single polling tick
    await new Promise(r => setTimeout(r, 4200));

    // Exactly 1 new poll should occur, not 3
    assert.strictEqual(pollCount - countAfterMounts, 1, 'Only one poller runs concurrently');
    win.Xentra.OrderReceived.unmount();
  });

  it('19. Polling stops after terminal state (rejected/timeout/completed)', async () => {
    const { win, container } = setupPwaDOM();
    let pollCount = 0;

    win.Xentra.API.get = async () => {
      pollCount++;
      return {
        success: true,
        order: {
          id: 'ord_p7_terminal_stop',
          order_number: 'P7-STOP-01',
          status: 'rejected',
          grand_total: 50000,
          branch_name: 'Cabang Barat'
        },
        payment: { payment_method: 'cash', payment_status: 'pending' }
      };
    };

    win.Xentra.OrderReceived.mount(container, 'ord_p7_terminal_stop');
    await new Promise(r => setTimeout(r, 25));
    const countAtMount = pollCount;

    // Advance 4.2s
    await new Promise(r => setTimeout(r, 4200));
    assert.strictEqual(pollCount, countAtMount, 'Polling must not fire for terminal state');
    win.Xentra.OrderReceived.unmount();
  });

  it('20. Polling cleanup works when leaving the view (unmount stops timers)', async () => {
    const { win, container } = setupPwaDOM();
    let pollCount = 0;

    win.Xentra.API.get = async () => {
      pollCount++;
      return {
        success: true,
        order: {
          id: 'ord_p7_unmount_stop',
          order_number: 'P7-UNMOUNT-01',
          status: 'pending',
          grand_total: 50000,
          branch_name: 'Cabang Barat'
        },
        payment: { payment_method: 'cash', payment_status: 'pending' }
      };
    };

    win.Xentra.OrderReceived.mount(container, 'ord_p7_unmount_stop');
    await new Promise(r => setTimeout(r, 25));
    const countAtMount = pollCount;

    // Unmount view
    win.Xentra.OrderReceived.unmount();

    // Advance 4.2s
    await new Promise(r => setTimeout(r, 4200));
    assert.strictEqual(pollCount, countAtMount, 'Unmount clears polling timer completely');
  });

  // ─── Branch Isolation (21, 22) ───────────────────────────────────────────

  it('21. Customer cannot switch fulfillment Branch during acceptance', async () => {
    const seed = seedOrder({ status: 'pending', branchId: BRANCH_ID });
    const token = seedCustomerSession(seed.phone);

    // Attempt to tamper branch_id via customer request
    const res = await request('PUT', `/api/v1/orders/${seed.orderId}`, { branch_id: 'branch_other' }, {
      'Authorization': `Bearer ${token}`
    });
    assert.ok(res.status === 404 || res.status === 405 || res.status === 403);

    const check = db.prepare('SELECT branch_id FROM orders WHERE id = ?').get(seed.orderId);
    assert.strictEqual(check.branch_id, BRANCH_ID, 'Fulfillment branch remains bound to original branch');
  });

  it('22. Acceptance status remains bound to the orders authoritative fulfillment Branch', async () => {
    const seed = seedOrder({ status: 'pending', branchId: BRANCH_ID });
    const token = seedCustomerSession(seed.phone);

    const res = await request('GET', `/api/v1/orders/${seed.orderId}`, null, {
      'Authorization': `Bearer ${token}`
    });

    assert.strictEqual(res.data.order.branch_id, BRANCH_ID);
    assert.ok(res.data.order.branch_name !== null, 'Provides authoritative branch name');
  });

  // ─── Regression Guards (23, 24, 25, 26) ──────────────────────────────────

  it('23. Regression: Existing P4 multi-branch cart separation remains intact', () => {
    const crossBranch = PrePaymentVerificationGate.assertSingleBranchCheckout(BRANCH_ID, [
      { product_id: 'prod_1', branch_id: BRANCH_ID },
      { product_id: 'prod_2', branch_id: 'branch_other' }
    ]);
    assert.ok(crossBranch !== null, 'Disallows cross-branch items in checkout');
  });

  it('24. Regression: Existing P5 single-branch checkout verification remains intact', () => {
    const singleBranch = PrePaymentVerificationGate.assertSingleBranchCheckout(BRANCH_ID, [
      { product_id: 'prod_1', branch_id: BRANCH_ID },
      { product_id: 'prod_2', branch_id: BRANCH_ID }
    ]);
    assert.strictEqual(singleBranch, null, 'Allows single-branch items in checkout');
  });

  it('25. Regression: Existing P6 payment failure handling remains intact', async () => {
    const { win, container } = setupPwaDOM();

    win.Xentra.API.get = async () => ({
      success: true,
      order: {
        id: 'ord_p6_reg_test',
        order_number: 'P6-REG-01',
        status: 'cancelled',
        grand_total: 50000,
        payment_method: 'midtrans',
        branch_name: 'Cabang Barat'
      },
      payment: { payment_method: 'midtrans', payment_status: 'expire' }
    });

    win.Xentra.OrderReceived.mount(container, 'ord_p6_reg_test');
    await new Promise(r => setTimeout(r, 25));

    assert.ok(container.innerHTML.includes('id="x-payment-failed-screen"'));
    assert.ok(container.innerHTML.includes('Waktu Pembayaran Habis'));
    win.Xentra.OrderReceived.unmount();
  });

  it('26. Regression: Branch Manager Acceptance contract remains intact on Core', async () => {
    const seed = seedOrder({ status: 'pending' });

    // Transition to confirmed
    const resConfirm = OrderStateMachine.transition({
      order_id: seed.orderId,
      target_status: 'confirmed',
      actor_type: 'branch_actor',
      actor_id: 'mgr_01'
    });

    assert.strictEqual(resConfirm.success, true);
    assert.strictEqual(resConfirm.new_status, 'confirmed');

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(seed.orderId);
    assert.strictEqual(check.status, 'confirmed');
  });
});
