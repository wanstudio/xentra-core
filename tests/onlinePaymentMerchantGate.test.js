'use strict';

/**
 * GoFood/GrabFood Online Payment Merchant Gate Test Suite
 *
 * Verifies that online payments (Midtrans, DOKU, QRIS) align with
 * GoFood / GrabFood operational requirements:
 * 1. Unpaid online orders NEVER appear in the Merchant App's active queue.
 * 2. Unpaid online orders NEVER ring chimes, never alert staff, and never trigger notifications at checkout.
 * 3. Unpaid online orders DO NOT time out under branch acceptance policy (no branch countdown).
 * 4. Once settled via webhook/payment confirmation:
 *    - Order appears in Merchant App under "Pesanan Baru" with ✓ Lunas.
 *    - Notification ("Ada Pesanan Baru Masuk (Lunas)!") is delivered to branch staff.
 *    - Acceptance countdown starts from settled_at.
 * 5. Cash / COD and Reservations enter the queue immediately upon placement.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-online-payment-gate';

const app = require('../server/app');
const db = require('../server/database/db');
const AcceptanceTimeoutService = require('../server/services/AcceptanceTimeoutService');
const { OrderRepository, PaymentRepository } = require('../core/data/repositories');
const PaymentGatewayService = require('../domains/payment/services/PaymentGatewayService');

let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const BRANCH_ID = 'branch_bangjo_barat';

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_ID, brandId = BRAND_ID, userId = 'bm_gate_test_mgr' } = {}) {
  const token = 'gate_staff_' + crypto.randomBytes(8).toString('hex');
  const store = global.TokenSessionStore;
  if (store && store.sessions) {
    store.sessions.set(token, {
      type: 'staff',
      role,
      brandId,
      brand_id: brandId,
      branchId,
      branch_id: branchId,
      userId,
      username: userId,
      email_verified: true,
      expiresAt: Date.now() + 86400 * 1000
    });
  }
  return token;
}

function request(method, reqPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const apiPath = reqPath.startsWith('/api') ? reqPath : ('/api/v1' + reqPath);
    const url = new URL(apiPath, baseUrl);
    const payload = body != null ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
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

function seedOrder({
  id = 'ord_gate_' + crypto.randomBytes(4).toString('hex'),
  orderNumber = 'XTR-GATE-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
  orderType = 'delivery',
  status = 'pending',
  paymentMethod = 'midtrans',
  paymentStatus = 'pending',
  settledAt = null,
  grandTotal = 45000,
  ageSeconds = 0
} = {}) {
  const createdAt = new Date(Date.now() - ageSeconds * 1000).toISOString();
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total, payment_method, payment_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Budi Gateway', '081234567890', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, orderNumber, BRAND_ID, BRANCH_ID, orderType, status, grandTotal, grandTotal, paymentMethod, paymentStatus, createdAt, createdAt);

  const payId = 'pay_' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, merchant_id, payment_method, payment_status, amount, settled_at, created_at, updated_at)
    VALUES (?, ?, ?, 'midtrans_default', ?, ?, ?, ?, ?, ?)
  `).run(payId, id, paymentMethod === 'cash' ? 'cash' : paymentMethod, paymentMethod, paymentStatus, grandTotal, settledAt, createdAt, createdAt);

  return { id, orderNumber, createdAt, grandTotal };
}

describe('GoFood/GrabFood Online Payment Merchant Gate', () => {
  let bmToken;
  const orderRepo = new OrderRepository();

  before(async () => {
    db.seedDemoData(db);
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    bmToken = seedStaffSession();
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    db.prepare("DELETE FROM notifications WHERE related_entity_id LIKE 'ord_gate_%'").run();
    db.prepare("DELETE FROM order_payments WHERE order_id LIKE 'ord_gate_%'").run();
    db.prepare("DELETE FROM orders WHERE id LIKE 'ord_gate_%'").run();
  });

  it('1. Unpaid online order is NOT visible in GET /admin/branches/:id/orders queue', async () => {
    const unpaidOnline = seedOrder({
      paymentMethod: 'midtrans',
      paymentStatus: 'pending'
    });

    // Query standard branch queue
    const res = await request('GET', `/admin/branches/${BRANCH_ID}/orders`, null, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    const found = res.data.orders.find(o => o.id === unpaidOnline.id);
    assert.equal(found, undefined, 'Unpaid online order must NOT be visible in standard branch queue');

    // Query pending filter
    const resPending = await request('GET', `/admin/branches/${BRANCH_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(resPending.status, 200);
    const foundPending = resPending.data.orders.find(o => o.id === unpaidOnline.id);
    assert.equal(foundPending, undefined, 'Unpaid online order must NOT be visible in pending branch queue');

    // Visible when explicitly requested via include_unpaid_online=1
    const resInclude = await request('GET', `/admin/branches/${BRANCH_ID}/orders?include_unpaid_online=1`, null, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(resInclude.status, 200);
    const foundExplicit = resInclude.data.orders.find(o => o.id === unpaidOnline.id);
    assert.ok(foundExplicit, 'Unpaid online order should be visible only when include_unpaid_online=1 is passed');
  });

  it('2. Cash order and Reservation ARE visible immediately in branch queue', async () => {
    const cashOrder = seedOrder({
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      orderType: 'delivery'
    });

    const res = await request('GET', `/admin/branches/${BRANCH_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(res.status, 200);
    const foundCash = res.data.orders.find(o => o.id === cashOrder.id);
    assert.ok(foundCash, 'Cash order must be visible immediately upon creation');

    const reservationOrder = seedOrder({
      paymentMethod: 'midtrans', // even if reservation has online/downpayment, reservation schedule is operational
      orderType: 'reservation',
      status: 'pending'
    });

    const resResv = await request('GET', `/admin/branches/${BRANCH_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(resResv.status, 200);
    const foundResv = resResv.data.orders.find(o => o.id === reservationOrder.id);
    assert.ok(foundResv, 'Reservation order must be visible immediately upon creation');
  });

  it('3. Acceptance timeout policy excludes unpaid online orders', () => {
    // Seed an old unpaid online order (created 300 seconds ago, past 180s)
    const oldUnpaid = seedOrder({
      paymentMethod: 'midtrans',
      paymentStatus: 'pending',
      ageSeconds: 300
    });

    const overdue = orderRepo.findOverduePending({ timeoutSeconds: 180 });
    const foundOverdue = overdue.find(o => o.id === oldUnpaid.id);
    assert.equal(foundOverdue, undefined, 'Old unpaid online order must NOT be swept by acceptance timeout worker');

    // Deadline is null for unpaid online order
    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(oldUnpaid.id);
    const deadline = AcceptanceTimeoutService.computeAcceptanceDeadlineAt(orderRow);
    assert.equal(deadline, null, 'Acceptance deadline must be null while online payment is pending');
  });

  it('4. Settling online payment makes order visible in queue and starts 180s countdown from settled_at', async () => {
    const onlineOrder = seedOrder({
      paymentMethod: 'midtrans',
      paymentStatus: 'pending',
      ageSeconds: 120
    });

    // Before settlement: not visible
    const resBefore = await request('GET', `/admin/branches/${BRANCH_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(resBefore.data.orders.some(o => o.id === onlineOrder.id), false);

    // Simulate payment settlement webhook
    const settledTime = new Date().toISOString();
    db.prepare("UPDATE orders SET payment_status = 'settlement', updated_at = ? WHERE id = ?").run(settledTime, onlineOrder.id);
    db.prepare("UPDATE order_payments SET payment_status = 'settlement', settled_at = ?, updated_at = ? WHERE order_id = ?").run(settledTime, settledTime, onlineOrder.id);

    // After settlement: VISIBLE in queue!
    const resAfter = await request('GET', `/admin/branches/${BRANCH_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmToken}`
    });
    const foundAfter = resAfter.data.orders.find(o => o.id === onlineOrder.id);
    assert.ok(foundAfter, 'Settled online order must now be visible in branch queue');
    assert.ok(foundAfter.acceptance_deadline_at, 'acceptance_deadline_at must be populated after settlement');

    // Deadline is 180s from settledTime
    const expectedDeadlineMs = new Date(settledTime).getTime() + 180 * 1000;
    const actualDeadlineMs = new Date(foundAfter.acceptance_deadline_at).getTime();
    assert.ok(Math.abs(actualDeadlineMs - expectedDeadlineMs) < 1000, 'Acceptance deadline must be calculated from settled_at');
  });

  it('5. PaymentGatewayService.handleWebhook generates branch staff notification on settlement', () => {
    const testOrder = seedOrder({
      id: 'ord_gate_hook_' + crypto.randomBytes(3).toString('hex'),
      paymentMethod: 'midtrans',
      paymentStatus: 'pending',
      grandTotal: 75000
    });

    // Call handleWebhook with settlement payload
    const webhookPayload = {
      order_id: testOrder.id,
      transaction_status: 'settlement',
      fraud_status: 'accept',
      gross_amount: '75000.00'
    };

    const result = PaymentGatewayService.handleWebhook(webhookPayload, {
      skipSignatureCheck: true,
      provider: 'midtrans'
    });

    assert.equal(result.success, true);
    assert.equal(result.payment_status, 'settlement');

    // Verify notification was created for branch
    const notif = db.prepare(`
      SELECT * FROM notifications
      WHERE related_entity_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(testOrder.id);

    assert.ok(notif, 'Branch notification must be created on settlement');
    assert.equal(notif.branch_id, BRANCH_ID);
    assert.ok(notif.title.includes('Pesanan Baru Masuk (Lunas)!'), 'Title must indicate settled new order');
    assert.ok(notif.body.includes('75.000'), 'Body must mention grand total');
  });

  it('6. Merchant client helper isBMOrderAwaitingPayment correctly identifies unpaid online orders', () => {
    const ordersJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-app/assets/js/orders.js'), 'utf8');
    assert.ok(ordersJs.includes('function isBMOrderAwaitingPayment(ord)'), 'isBMOrderAwaitingPayment helper must exist in orders.js');

    // Test helper logic directly
    function isBMOrderAwaitingPayment(ord) {
      if (!ord) return false;
      if (ord.order_type === 'reservation') return false;
      var method = String(ord.payment_method || '').toLowerCase();
      if (!method || method === 'cash') return false;
      var payStatus = String(ord.payment_status || (ord.payment && ord.payment.payment_status) || '').toLowerCase();
      return payStatus !== 'settlement' && payStatus !== 'paid';
    }

    assert.equal(isBMOrderAwaitingPayment({ payment_method: 'midtrans', payment_status: 'pending' }), true);
    assert.equal(isBMOrderAwaitingPayment({ payment_method: 'midtrans', payment_status: 'settlement' }), false);
    assert.equal(isBMOrderAwaitingPayment({ payment_method: 'cash', payment_status: 'pending' }), false);
    assert.equal(isBMOrderAwaitingPayment({ payment_method: 'midtrans', order_type: 'reservation', payment_status: 'pending' }), false);
  });

  it('7. Merchant client helper isBMCustomerAppOrder correctly isolates Customer PWA from POS & Aggregators', () => {
    const ordersJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-app/assets/js/orders.js'), 'utf8');
    assert.ok(ordersJs.includes('function isBMCustomerAppOrder(ord)'), 'isBMCustomerAppOrder helper must exist in orders.js');

    function isBMCustomerAppOrder(ord) {
      if (!ord) return false;
      var ch = String(ord.order_channel || 'customer_app').toLowerCase();
      return ch === 'customer_app';
    }

    // Customer PWA
    assert.equal(isBMCustomerAppOrder({ order_channel: 'customer_app' }), true);
    assert.equal(isBMCustomerAppOrder({ order_channel: 'CUSTOMER_APP' }), true);
    assert.equal(isBMCustomerAppOrder({}), true, 'Default schema channel should be customer_app');

    // Non-customer channels must NOT match
    assert.equal(isBMCustomerAppOrder({ order_channel: 'pos_cashier' }), false);
    assert.equal(isBMCustomerAppOrder({ order_channel: 'gofood' }), false);
    assert.equal(isBMCustomerAppOrder({ order_channel: 'grabfood' }), false);
    assert.equal(isBMCustomerAppOrder({ order_channel: 'shopeefood' }), false);
  });

  it('8. checkAndNotifyNewPendingOrders only triggers chime/notification for Customer PWA orders', () => {
    const ordersJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-app/assets/js/orders.js'), 'utf8');
    assert.ok(ordersJs.includes('isBMCustomerAppOrder(o)'), 'checkAndNotifyNewPendingOrders must filter by isBMCustomerAppOrder');

    // Simulate checkAndNotifyNewPendingOrders behavior
    let chimePlayed = false;
    let notifsShown = [];

    const mockPlayChime = () => { chimePlayed = true; };
    const mockShowNotif = (ord) => { notifsShown.push(ord.id); };

    function simulateCheckAndNotify(orders, seenIds) {
      function isBMOrderAwaitingPayment(ord) {
        if (!ord) return false;
        if (ord.order_type === 'reservation') return false;
        var method = String(ord.payment_method || '').toLowerCase();
        if (!method || method === 'cash') return false;
        var payStatus = String(ord.payment_status || (ord.payment && ord.payment.payment_status) || '').toLowerCase();
        return payStatus !== 'settlement' && payStatus !== 'paid';
      }
      function isBMCustomerAppOrder(ord) {
        if (!ord) return false;
        var ch = String(ord.order_channel || 'customer_app').toLowerCase();
        return ch === 'customer_app';
      }

      var currentPendingOrders = orders.filter(function (o) {
        if (o.status !== 'pending') return false;
        if (isBMOrderAwaitingPayment(o)) return false;
        if (!isBMCustomerAppOrder(o)) return false;
        return true;
      });

      var newlyAppeared = [];
      currentPendingOrders.forEach(function (o) {
        if (!seenIds[o.id]) newlyAppeared.push(o.id);
      });

      if (newlyAppeared.length > 0) {
        newlyAppeared.forEach(function (id) {
          var matched = currentPendingOrders.find(function (o) { return o.id === id; });
          if (matched) mockShowNotif(matched);
        });
        mockPlayChime();
      }
    }

    // Scenario A: Order from POS arrives — must NOT chime or notify
    const posOrders = [
      { id: 'ord_pos_1', status: 'pending', payment_method: 'cash', order_channel: 'pos_cashier' },
      { id: 'ord_gf_1', status: 'pending', payment_method: 'cash', order_channel: 'gofood' }
    ];
    simulateCheckAndNotify(posOrders, {});
    assert.equal(chimePlayed, false, 'POS & aggregator orders must NOT trigger merchant chime');
    assert.equal(notifsShown.length, 0, 'POS & aggregator orders must NOT show merchant notifications');

    // Scenario B: Order from Customer PWA arrives — MUST chime and notify
    const custOrders = [
      { id: 'ord_cust_1', status: 'pending', payment_method: 'cash', order_channel: 'customer_app' }
    ];
    simulateCheckAndNotify(custOrders, {});
    assert.equal(chimePlayed, true, 'Customer PWA order MUST trigger merchant chime');
    assert.equal(notifsShown.length, 1);
    assert.equal(notifsShown[0], 'ord_cust_1');
  });

  it('9. Driver assignment notification targets only driver; merchant assignment flow has no merchant chime', async () => {
    // Verify merchant orders.js does NOT call XentraAudio on driver assign
    const ordersJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-app/assets/js/orders.js'), 'utf8');
    const submitAssignDriverMatch = ordersJs.match(/function submitBMAssignDriver\([\s\S]*?^  \}/m);
    assert.ok(submitAssignDriverMatch, 'submitBMAssignDriver function found');
    const funcBody = submitAssignDriverMatch[0];
    assert.ok(!funcBody.includes('XentraAudio'), 'submitBMAssignDriver must not call XentraAudio');
    assert.ok(!funcBody.includes('playNewOrderAudibleChime'), 'submitBMAssignDriver must not call playNewOrderAudibleChime');

    // Seed active delivery order
    const deliveryOrder = seedOrder({
      id: 'ord_dlv_assign_' + crypto.randomBytes(3).toString('hex'),
      orderType: 'delivery',
      status: 'confirmed',
      paymentMethod: 'cash',
      paymentStatus: 'pending'
    });

    // Seed driver user in DB
    const driverId = 'drv_test_' + crypto.randomBytes(3).toString('hex');
    db.prepare(`
      INSERT OR REPLACE INTO users (id, brand_id, branch_id, username, full_name, phone, role, status)
      VALUES (?, ?, ?, ?, ?, ?, 'driver', 'active')
    `).run(driverId, BRAND_ID, BRANCH_ID, 'driver_test', 'Driver Test', '08123456789');

    const bmToken = seedStaffSession({ role: 'branch_manager' });

    // Merchant assigns driver
    const assignRes = await request('POST', `/admin/orders/${deliveryOrder.id}/assign-driver`, {
      driver_id: driverId
    }, {
      'Authorization': 'Bearer ' + bmToken
    });

    assert.equal(assignRes.status, 200);
    assert.equal(assignRes.data.success, true);

    // Verify notification was created specifically for the driver
    const notif = db.prepare(`
      SELECT * FROM notifications
      WHERE related_entity_id = ? AND source_type = 'delivery'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(deliveryOrder.id);

    assert.ok(notif, 'Notification for driver assignment must exist');
    assert.equal(notif.target_role, 'driver', 'Target role must be driver');
    assert.equal(notif.target_user_id, driverId, 'Target user ID must match assigned driver');
    assert.ok(notif.action_url.startsWith('/driver/'), 'Action URL must route to driver portal');
  });

  it('10. Driver App polls /driver/tasks and triggers audible alert only on Driver App', () => {
    const driverJs = fs.readFileSync(path.join(__dirname, '../apps/driver-app/assets/js/driver-app.js'), 'utf8');
    assert.ok(driverJs.includes('triggerIncomingTaskAlert'), 'Driver App must have triggerIncomingTaskAlert');
    assert.ok(driverJs.includes('/driver/assets/audio/tugas-baru.mp3'), 'Driver App plays custom driver task MP3');
    assert.ok(driverJs.includes('XentraAudio.deliveryAssigned'), 'Driver App calls XentraAudio.deliveryAssigned fallback');
  });
});
