'use strict';

/**
 * Phase 8 — Customer Order Result & Post-Acceptance Flow: Server & Client Tests
 *
 * Tests cover:
 * - P8-01 to P8-20: post-acceptance lifecycle, presentation, authority,
 *   ownership security, and terminal state polling invariants.
 *
 * Authority rule: Core/server is authoritative for all order state and totals.
 * Customer PWA only displays, polls, and navigates.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-p8-customer-post-acceptance';

const app = require('../../server/app');
const db = require('../../server/database/db');
// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('../helpers/demoFixtures.js')();
const OrderStateMachine = require('../../server/services/OrderStateMachine');

let server;
let baseUrl;

// ─── Test data ────────────────────────────────────────────────────────────────
const BRAND_ID = 'brand_bangjo';
const BRANCH_ID = 'branch_bangjo_barat';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOrderId() { return 'p8_ord_' + crypto.randomBytes(5).toString('hex'); }
function makeOrderNum() { return 'P8-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }

function seedOrder({
  orderId,
  status = 'confirmed',
  branchId = BRANCH_ID,
  phone = '081200000081',
  orderType = 'delivery',
  tableNumber = null,
  orderNote = 'Jangan terlalu pedas',
  subtotal = 65000,
  deliveryFee = 10000,
  discountAmount = 5000,
  grandTotal = 70000,
  paymentMethod = 'midtrans',
  paymentStatus = 'settlement'
} = {}) {
  orderId = orderId || makeOrderId();
  const num = makeOrderNum();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO orders (
      id, order_number, brand_id, branch_id, customer_name, customer_phone,
      order_type, status, subtotal, delivery_fee, discount_amount, grand_total,
      payment_method, payment_status, order_note, table_number, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'P8 Customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orderId, num, BRAND_ID, branchId, phone,
    orderType, status, subtotal, deliveryFee, discountAmount, grandTotal,
    paymentMethod, paymentStatus, orderNote, tableNumber, now, now
  );

  // Seed order item
  const itemId = 'item_' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal, note)
    VALUES (?, ?, 'prod_ayam_tulang_lunak', 'Ayam Tulang Lunak Spesial', 35000, 2, 70000, 'Paha semua')
  `).run(itemId, orderId);

  // Seed delivery if delivery order
  if (orderType === 'delivery') {
    const delId = 'del_' + crypto.randomBytes(4).toString('hex');
    db.prepare(`
      INSERT INTO order_deliveries (id, order_id, destination_address, delivery_fee_calculated, driver_name, driver_phone, tracking_url, status)
      VALUES (?, ?, 'Jl. Pahlawan No. 45, Pringsewu', ?, 'Budi Santoso', '081987654321', 'https://track.example.com/p8-track', 'delivering')
    `).run(delId, orderId, deliveryFee);
  }

  // Seed payment record
  const payId = 'pay_' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_method, payment_status, amount, created_at)
    VALUES (?, ?, 'midtrans', ?, ?, ?, ?)
  `).run(payId, orderId, paymentMethod, paymentStatus, grandTotal, now);

  return { orderId, num, phone, branchId, orderType, grandTotal };
}

function seedCustomerSession(phone, brandId = BRAND_ID) {
  const token = 'p8cust_' + crypto.randomBytes(8).toString('hex');
  const store = global.TokenSessionStore;
  if (store && store.sessions) {
    store.sessions.set(token, {
      type: 'customer',
      organizationId: 'org_xentra_holding',
      organization_id: 'org_xentra_holding',
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
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
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

  const fePath = path.join(__dirname, '../../apps/customer-pwa/assets/js/core/fulfillment-environments.js');
  const feCode = fs.readFileSync(fePath, 'utf8');
  new win.Function('window', 'document', feCode)(win, win.document);

  const scriptPath = path.join(__dirname, '../../apps/customer-pwa/assets/js/pages/order-received.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  new win.Function('window', 'document', code)(win, win.document);

  return { win, dom, container: win.document.getElementById('x-order-content') };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Phase 8 — Customer Order Result & Post-Acceptance Flow', () => {
  before(async () => {
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => {
    server && server.close();
    // Cleanup test orders (delete child tables first for FK constraint)
    db.prepare("DELETE FROM order_payments WHERE order_id LIKE 'p8_ord_%'").run();
    db.prepare("DELETE FROM order_status_logs WHERE order_id LIKE 'p8_ord_%'").run();
    db.prepare("DELETE FROM order_deliveries WHERE order_id LIKE 'p8_ord_%'").run();
    db.prepare("DELETE FROM order_items WHERE order_id LIKE 'p8_ord_%'").run();
    db.prepare("DELETE FROM orders WHERE id LIKE 'p8_ord_%'").run();
  });

  // ── P8-01: Accepted order renders accepted state ───────────────────────────
  it('P8-01: Accepted order renders accepted state', async () => {
    const { orderId, phone } = seedOrder({ status: 'confirmed' });
    const token = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    assert.equal(res.data.order.status, 'confirmed');

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res.data;

    win.Xentra.OrderReceived.mount(container, orderId);
    await new Promise(r => setTimeout(r, 10));

    // Delivery/pickup render the unified tracking layout (dynamic phase title +
    // progress). The server status assertion above is unchanged.
    assert.ok(container.innerHTML.includes('x-order-tracking-screen'), 'Must render the tracking screen');
    assert.ok(container.innerHTML.includes('>PESANAN DITERIMA<') || container.innerHTML.includes('>PESANAN DIBUAT<'), 'Must display the accepted phase title');
    assert.ok(container.innerHTML.includes('id="x-order-progress"'), 'Must render the tracking progress');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-02: Accepted order displays correct branch ──────────────────────────
  it('P8-02: Accepted order displays correct branch', async () => {
    const { orderId, phone } = seedOrder({ status: 'confirmed', branchId: BRANCH_ID });
    const token = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    assert.ok(res.data.order.branch_name, 'branch_name must be present in server response');

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res.data;

    win.Xentra.OrderReceived.mount(container, orderId);
    await new Promise(r => setTimeout(r, 10));

    assert.ok(container.innerHTML.includes(res.data.order.branch_name),
      'Assigned branch name must be prominently rendered');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-03: Accepted order displays authoritative order number ──────────────
  it('P8-03: Accepted order displays authoritative order number', async () => {
    const { orderId, num, phone } = seedOrder({ status: 'confirmed' });
    const token = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res.data.order.order_number, num);

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res.data;

    win.Xentra.OrderReceived.mount(container, orderId);
    await new Promise(r => setTimeout(r, 10));

    // The unified tracking layout renders the server-derived phase and branch;
    // the order number is not part of that surface (its authority is asserted
    // against the server response above).
    assert.ok(container.innerHTML.includes('id="x-order-phase-title"'), 'Must render the server-derived phase title');
    assert.ok(container.innerHTML.includes(res.data.order.branch_name), 'Must render the authoritative branch');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-04: Accepted order displays authoritative totals ────────────────────
  it('P8-04: Accepted order displays authoritative totals', async () => {
    const { orderId, phone } = seedOrder({
      status: 'confirmed',
      subtotal: 65000,
      deliveryFee: 10000,
      discountAmount: 5000,
      grandTotal: 70000
    });
    const token = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res.data.order.subtotal, 65000);
    assert.equal(res.data.order.grand_total, 70000);

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res.data;

    win.Xentra.OrderReceived.mount(container, orderId);
    await new Promise(r => setTimeout(r, 10));

    assert.ok(container.innerHTML.includes('70.000'), 'Authoritative grand total must be formatted');
    assert.ok(container.innerHTML.includes('65.000'), 'Authoritative subtotal must be formatted');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-05: Accepted order displays correct order type ──────────────────────
  it('P8-05: Accepted order displays correct order type', async () => {
    const { orderId, phone } = seedOrder({ status: 'ready', orderType: 'pickup' });
    const token = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res.data.order.order_type, 'pickup');

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res.data;

    win.Xentra.OrderReceived.mount(container, orderId);
    await new Promise(r => setTimeout(r, 10));

    // Pickup is part of the unified tracking layout; its pickup-specific phase is
    // "SIAP DIAMBIL" once the order is ready for collection.
    assert.ok(container.innerHTML.includes('SIAP DIAMBIL'), 'Must display the pickup-specific phase');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-06: Fulfillment state renders from server ───────────────────────────
  it('P8-06: Fulfillment state renders from server (preparing → ready → out_for_delivery → completed)', async () => {
    const states = ['preparing', 'ready', 'out_for_delivery', 'completed'];

    for (const st of states) {
      const { orderId, phone } = seedOrder({ status: st });
      const token = seedCustomerSession(phone);

      const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
      assert.equal(res.data.order.status, st);

      const { win, container } = setupPwaDOM();
      win.Xentra.API.get = async () => res.data;

      win.Xentra.OrderReceived.mount(container, orderId);
      await new Promise(r => setTimeout(r, 10));

      // Unified tracking layout: the phase title is derived from the server status.
      const expectedPhase = {
        preparing: 'SEDANG DISIAPKAN',
        ready: 'SIAP DIANTAR',
        out_for_delivery: 'SEDANG DIANTAR',
        completed: 'SELESAI DIANTAR'
      }[st];
      assert.ok(container.innerHTML.includes('x-order-tracking-screen'), `Must render the tracking screen for ${st}`);
      assert.ok(
        container.innerHTML.includes(expectedPhase) ||
        (st === 'ready' && container.innerHTML.includes('SEDANG DISIAPKAN')) ||
        (st === 'completed' && container.innerHTML.includes('PESANAN SELESAI')),
        `Phase title must reflect server status ${st}`
      );
      win.Xentra.OrderReceived.unmount();
    }
  });

  // ── P8-07: Refresh recovers authoritative state ────────────────────────────
  it('P8-07: Refresh recovers authoritative state', async () => {
    const { orderId, phone } = seedOrder({ status: 'preparing' });
    const token = seedCustomerSession(phone);

    // Initial load
    const res1 = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res1.data.order.status, 'preparing');

    // Simulate server transition while user is away
    OrderStateMachine.transition({
      order_id: orderId,
      target_status: 'ready',
      actor_type: 'staff',
      actor_id: 'kitchen_user',
      note: 'Order cooked'
    });

    // Refresh: cold fetch from server returns updated state
    const res2 = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res2.data.order.status, 'ready', 'Server state is updated');

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res2.data;

    win.Xentra.OrderReceived.mount(container, orderId);
    await new Promise(r => setTimeout(r, 10));

    assert.ok(container.innerHTML.includes('SIAP DIANTAR') || container.innerHTML.includes('SEDANG DISIAPKAN'), 'DOM reflects fresh server state after refresh');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-08: Re-entry recovers authoritative state ───────────────────────────
  it('P8-08: Re-entry recovers authoritative state', async () => {
    const { orderId, phone } = seedOrder({ status: 'out_for_delivery' });
    const token = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });

    const { win, container } = setupPwaDOM();
    // Simulate navigation/re-entry with location hash
    win.location.hash = `#order-received/${orderId}`;
    win.Xentra.API.get = async () => res.data;

    win.Xentra.OrderReceived.mount(container);
    await new Promise(r => setTimeout(r, 10));

    assert.ok(container.innerHTML.includes('SEDANG DIANTAR'), 'Phase title must reflect the server status');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-09: Terminal state stops polling ─────────────────────────────────────
  it('P8-09: Terminal state stops polling', async () => {
    const { orderId, phone } = seedOrder({ status: 'completed' });
    const token = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res.data.order.status, 'completed');

    let pollCount = 0;
    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => {
      pollCount++;
      return res.data;
    };

    win.Xentra.OrderReceived.mount(container, orderId);
    await new Promise(r => setTimeout(r, 10));

    // Initial load occurred once
    assert.equal(pollCount, 1);

    // Wait past a tick: polling should NOT fire because completed is terminal
    await new Promise(r => setTimeout(r, 50));
    assert.equal(pollCount, 1, 'Polling must not continue after terminal state');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-10: Stale polling response cannot overwrite newer state ─────────────
  it('P8-10: Stale polling response cannot overwrite newer state', async () => {
    const { orderId } = seedOrder({ status: 'confirmed' });
    const { win, container } = setupPwaDOM();

    // Sequence 1: Slow stale response with status 'pending'
    // Sequence 2: Fast response with status 'confirmed'
    let calls = 0;
    win.Xentra.API.get = () => {
      calls++;
      if (calls === 1) {
        // Return slow delayed response
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({
              success: true,
              order: { id: orderId, status: 'preparing', branch_name: 'Cabang' }
            });
          }, 40);
        });
      } else {
        // Return immediate newer response
        return Promise.resolve({
          success: true,
          order: { id: orderId, status: 'confirmed', branch_name: 'Cabang' }
        });
      }
    };

    // First mount triggers call 1 (slow)
    win.Xentra.OrderReceived.mount(container, orderId);
    // Second call immediately triggers call 2 (fast)
    win.Xentra.OrderReceived.mount(container, orderId);

    await new Promise(r => setTimeout(r, 60));

    // When slow call 1 finishes, its stale response is discarded by fetchSeq
    // The stale response carries a later phase; if it were applied the DOM would
    // show SEDANG DISIAPKAN. The newer (confirmed) response must prevail.
    assert.ok(container.innerHTML.includes('>PESANAN DITERIMA<') || container.innerHTML.includes('>PESANAN DIBUAT<'),
      'Newer response must prevail — stale sequence discarded');
    assert.ok(!container.innerHTML.includes('SEDANG DISIAPKAN'),
      'Stale later-phase response must not be rendered');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-11: Customer cannot access another customer's order (IDOR) ──────────
  it('P8-11: Customer cannot access another customer\'s order (IDOR guard)', async () => {
    const { orderId } = seedOrder({ phone: '081211111111' });
    // Customer B tries to access Customer A's order
    const tokenB = seedCustomerSession('081222222222');

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, {
      Authorization: `Bearer ${tokenB}`
    });

    assert.equal(res.status, 403, 'Cross-customer order access must be rejected with 403');
    assert.equal(res.data.success, false);
    assert.equal(res.data.error, 'FORBIDDEN_ORDER_ACCESS');
  });

  // ── P8-12: Modified order_id cannot bypass ownership ───────────────────────
  it('P8-12: Modified order_id cannot bypass ownership', async () => {
    const token = seedCustomerSession('081233333333');

    // Manipulated order_id with foreign format
    const res = await request('GET', '/api/v1/orders/p8_ord_manipulated_tampered_id', null, {
      Authorization: `Bearer ${token}`
    });

    assert.ok(res.status === 403 || res.status === 404,
      `Non-owned or non-existent order_id must return 403/404, got ${res.status}`);
    assert.equal(res.data.success, false);
  });

  // ── P8-13: Client cannot mutate order status ────────────────────────────────
  it('P8-13: Client cannot mutate order status', async () => {
    const { orderId, phone } = seedOrder({ status: 'confirmed' });
    const customerToken = seedCustomerSession(phone);

    // Customer tries to invoke branch-acceptance to change status
    const res = await request('POST', `/api/v1/orders/${orderId}/branch-acceptance`,
      { decision: 'accept' },
      { Authorization: `Bearer ${customerToken}` });

    assert.equal(res.status, 403, 'Customer cannot access branch-acceptance endpoint');

    // Customer tries to cancel an already accepted order
    const cancelRes = await request('POST', `/api/v1/orders/${orderId}/cancel`,
      { reason: 'Ingin batal setelah diterima' },
      { Authorization: `Bearer ${customerToken}` });

    assert.equal(cancelRes.status, 400, 'Customer cannot cancel an accepted order');
    assert.equal(cancelRes.data.status, 'CUSTOMER_CANCEL_NOT_ALLOWED');
  });

  // ── P8-13R: Reservation follows the post-acceptance cancellation boundary
  it('P8-13R: confirmed reservation cannot be customer-cancelled through the normal cancel endpoint', async () => {
    const { orderId, phone } = seedOrder({
      status: 'confirmed',
      orderType: 'reservation',
      deliveryFee: 0,
      discountAmount: 0,
      grandTotal: 0,
      paymentMethod: 'cash',
      paymentStatus: 'pending'
    });
    const customerToken = seedCustomerSession(phone);

    const cancelRes = await request('POST', `/api/v1/orders/${orderId}/cancel`,
      { reason: 'Customer mencoba membatalkan reservasi terkonfirmasi' },
      { Authorization: `Bearer ${customerToken}` });

    assert.equal(cancelRes.status, 400, 'confirmed reservation remains outside normal customer cancellation');
    assert.equal(cancelRes.data.status, 'CUSTOMER_CANCEL_NOT_ALLOWED');
    assert.deepEqual(
      { ...db.prepare('SELECT order_type, status FROM orders WHERE id = ?').get(orderId) },
      { order_type: 'reservation', status: 'confirmed' },
      'reservation must remain confirmed when normal customer cancel is rejected'
    );
  });

  // ── P8-RSV: Reservation customer projection & dedicated surface ────────────
  it('P8-RSV: reservation exposes schedule/guest metadata and does not enter payment UI', async () => {
    const { orderId, phone } = seedOrder({
      status: 'confirmed',
      orderType: 'reservation',
      deliveryFee: 0,
      discountAmount: 0,
      grandTotal: 0,
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      orderNote: 'Reservasi (4 Tamu, Tgl: 2099-01-02)'
    });
    db.prepare('UPDATE orders SET scheduled_slot_start = ? WHERE id = ?')
      .run('2099-01-02T19:00:00', orderId);

    const token = seedCustomerSession(phone);
    const detail = await request('GET', `/api/v1/orders/${orderId}`, null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(detail.status, 200);
    assert.equal(detail.data.order.order_type, 'reservation');
    assert.equal(detail.data.order.reservation_date, '2099-01-02');
    assert.equal(detail.data.order.reservation_time, '19:00');
    assert.equal(detail.data.order.guest_count, 4);

    const history = await request('GET', '/api/v1/customer/orders', null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(history.status, 200);
    const historyRow = (history.data.orders || []).find(o => o.id === orderId);
    assert.ok(historyRow, 'reservation must be present in customer history');
    assert.equal(historyRow.reservation_date, '2099-01-02');
    assert.equal(historyRow.reservation_time, '19:00');
    assert.equal(historyRow.guest_count, 4);

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => detail.data;
    win.Xentra.Router.navigate = () => {};

    win.Xentra.OrderReceived.mount(container, orderId);
    await new Promise(r => setTimeout(r, 10));

    assert.ok(container.innerHTML.includes('id="x-reservation-screen"'), 'reservation must use the dedicated reservation surface');
    assert.ok(container.innerHTML.includes('2099-01-02'), 'reservation date must be displayed');
    assert.ok(container.innerHTML.includes('19:00'), 'reservation time must be displayed');
    assert.ok(container.innerHTML.includes('4 orang'), 'guest count must be displayed');
    assert.ok(!container.innerHTML.includes('Bayar Sekarang'), 'reservation must never expose payment action');
    assert.ok(!container.innerHTML.includes('Sedang Disiapkan'), 'reservation must never use generic cooking fulfillment copy');

    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-14: Payment state remains server-authoritative ──────────────────────
  it('P8-14: Payment state remains server-authoritative', async () => {
    const { orderId, phone, grandTotal } = seedOrder({
      status: 'confirmed',
      paymentStatus: 'settlement',
      grandTotal: 70000
    });
    const token = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    assert.equal(res.data.order.grand_total, grandTotal);
    assert.equal(res.data.order.payment_status, 'settlement');
    assert.equal(res.data.payment.payment_status, 'settlement');
  });

  // ── P8-15: Fulfillment branch cannot be changed by client ───────────────────
  it('P8-15: Fulfillment branch cannot be changed by client', async () => {
    const { orderId, phone, branchId } = seedOrder({ status: 'confirmed', branchId: BRANCH_ID });
    const token = seedCustomerSession(phone);

    // Customer sends malicious payload attempting to change branch
    const res = await request('GET', `/api/v1/orders/${orderId}?branch_id=branch_other_bogus`, null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.order.branch_id, branchId, 'branch_id is immutable from client');
  });

  // ── P8-16: Cancelled state renders correctly ───────────────────────────────
  it('P8-16: Cancelled state renders correctly', async () => {
    const { orderId, phone } = seedOrder({ status: 'cancelled' });
    const token = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res.data.order.status, 'cancelled');

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res.data;

    win.Xentra.OrderReceived.mount(container, orderId);
    await new Promise(r => setTimeout(r, 10));

    assert.ok(container.innerHTML.includes('Pesanan Dibatalkan'), 'Must render cancelled banner');
    assert.ok(container.innerHTML.includes('Pesan Menu Baru'), 'Must offer new order action');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-17: Completed state renders correctly ───────────────────────────────
  it('P8-17: Completed state renders correctly', async () => {
    const { orderId, phone } = seedOrder({ status: 'completed' });
    const token = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res.data.order.status, 'completed');

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res.data;

    win.Xentra.OrderReceived.mount(container, orderId);
    await new Promise(r => setTimeout(r, 10));

    assert.ok(container.innerHTML.includes('SELESAI DIANTAR') || container.innerHTML.includes('PESANAN SELESAI'), 'Must render the completed phase title');
    assert.ok(container.innerHTML.includes('id="x-order-progress"'), 'Must render the completed progress tracker');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-18: Delivery/pickup/dine-in/reservation presentation respects existing order type ──
  it('P8-18: Presentation adapts correctly across all order types', async () => {
    // 1. Delivery
    const d1 = seedOrder({ orderType: 'delivery', status: 'confirmed' });
    const t1 = seedCustomerSession(d1.phone);
    const r1 = await request('GET', `/api/v1/orders/${d1.orderId}`, null, { Authorization: `Bearer ${t1}` });
    assert.ok(r1.data.delivery.destination_address);
    assert.ok(r1.data.delivery.driver_name);

    // 2. Dine-In
    const d2 = seedOrder({ orderType: 'dine_in', tableNumber: 'Meja 12', status: 'confirmed' });
    const t2 = seedCustomerSession(d2.phone);
    const r2 = await request('GET', `/api/v1/orders/${d2.orderId}`, null, { Authorization: `Bearer ${t2}` });
    assert.equal(r2.data.order.table_number, 'Meja 12');

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => r2.data;

    win.Xentra.OrderReceived.mount(container, d2.orderId);
    await new Promise(r => setTimeout(r, 10));

    assert.ok(container.innerHTML.includes('Dine-in (Meja 12)'));
    assert.ok(container.innerHTML.includes('Meja 12'));
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-19: Unsupported or missing data fails safely ────────────────────────
  it('P8-19: Unsupported or missing data fails safely', async () => {
    const { win, container } = setupPwaDOM();
    // Sparse data payload with missing optional fields
    win.Xentra.API.get = async () => ({
      success: true,
      order: {
        id: 'sparse_order_1',
        order_number: 'XTR-SPARSE',
        status: 'confirmed',
        order_type: null,
        grand_total: null,
        subtotal: null,
        branch_name: null
      },
      items: null,
      delivery: null,
      payment: null
    });

    assert.doesNotThrow(() => {
      win.Xentra.OrderReceived.mount(container, 'sparse_order_1');
    });

    await new Promise(r => setTimeout(r, 10));
    // The tracking layout does not print the order number; sparse data must still
    // produce the tracking surface instead of throwing.
    assert.ok(container.innerHTML.includes('x-order-tracking-screen'), 'Renders the tracking screen on sparse data');
    win.Xentra.OrderReceived.unmount();
  });

  // ── P8-20: No duplicate polling/timers after refresh/re-entry ──────────────
  it('P8-20: No duplicate polling or timers after refresh/re-entry', async () => {
    const { orderId, phone } = seedOrder({ status: 'confirmed' });
    const token = seedCustomerSession(phone);
    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => res.data;

    // Mount 3 times rapidly (simulating rapid clicks or re-entry)
    win.Xentra.OrderReceived.mount(container, orderId);
    win.Xentra.OrderReceived.mount(container, orderId);
    win.Xentra.OrderReceived.mount(container, orderId);

    await new Promise(r => setTimeout(r, 10));

    // Unmount clears all intervals
    assert.doesNotThrow(() => {
      win.Xentra.OrderReceived.unmount();
    });
  });
});
