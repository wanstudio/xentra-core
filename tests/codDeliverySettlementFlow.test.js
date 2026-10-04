'use strict';

/**
 * COD Delivery Lifecycle, Cash Custody Handover, and POS Cash Settlement Suite.
 *
 * Validates locked business and UX contracts:
 * - docs/XENTRA_DRIVER_COD_FLOW_CONTRACT_V1.md (v1.1)
 * - docs/decisions/pos-app-surface-implementation-v1.md (v1.1)
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const db = require('../server/database/db');
require('./helpers/demoFixtures.js')();
const app = require('../server/app');

const { DeliveryDispatchService } = require('../domains/delivery');
const DeliveryModel = require('../domains/delivery/models/DeliveryModel');
const { CashSettlementService } = require('../domains/payment');
const OrderStateMachine = require('../server/services/OrderStateMachine');
const { OrderRepository } = require('../core/data/repositories');
const orderRepository = new OrderRepository();

const BRAND_ID = 'brand_bangjo';
const BRANCH_ID = 'branch_bangjo_pusat';
const OTHER_BRANCH_ID = 'branch_bangjo_timur';

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body != null ? JSON.stringify(body) : null;

    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Host: options.headers && options.headers.Host ? options.headers.Host : 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

test('COD DELIVERY & CASH SETTLEMENT CONTRACT V1.1 SUITE', async (t) => {
  let server;
  let cashierToken;
  let cashierId = 'usr_cashier_cod_test';
  let shiftId = 'shift_cod_test_01';

  await t.test('Setup test server, cashier user, and open shift', async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));

    // Ensure cashier user exists
    db.prepare(`
      INSERT OR REPLACE INTO users (id, brand_id, branch_id, username, email, password_hash, full_name, role)
      VALUES (?, ?, ?, 'cashier_cod_user', 'cashier_cod@test.com', 'hash', 'Kasir COD Test', 'cashier')
    `).run(cashierId, BRAND_ID, BRANCH_ID);

    // Open active shift for cashier
    db.prepare(`
      INSERT OR REPLACE INTO pos_shifts (id, branch_id, cashier_id, starting_float, total_cash_sales, status, opened_at)
      VALUES (?, ?, ?, 100000, 0, 'open', datetime('now'))
    `).run(shiftId, BRANCH_ID, cashierId);

    // Create session token for cashier
    const cashierUser = {
      id: cashierId,
      userId: cashierId,
      brand_id: BRAND_ID,
      branch_id: BRANCH_ID,
      role: 'cashier'
    };
    const session = global.TokenSessionStore.createSession(cashierUser, BRAND_ID);
    cashierToken = session.token;
  });

  t.after(() => {
    if (server && server.close) server.close();
  });

  // ── 1. Independent Lifecycles & Critical Invariant ───────────────────────
  await t.test('1. Delivery delivered transitions Order to completed, but Payment remains pending (Custody = driver)', async () => {
    const orderId = `ord_cod_test_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, delivery_fee, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Budi Pembeli', '08123456789', 'delivery', 'customer_app', 45000, 5000, 50000, 'cash', 'confirmed')
    `).run(orderId, `ORD-${orderId}`, BRAND_ID, BRANCH_ID);

    // Initial pending payment record
    db.prepare(`
      INSERT INTO order_payments (id, order_id, provider, payment_method, payment_status, amount)
      VALUES (?, ?, 'cash', 'cash', 'pending', 50000)
    `).run(`pay_${orderId}`, orderId);

    // Advance kitchen to ready
    OrderStateMachine.transition({
      order_id: orderId,
      target_status: 'preparing',
      actor_type: 'kitchen',
      note: 'Dapur menyiapkan'
    });
    OrderStateMachine.transition({
      order_id: orderId,
      target_status: 'ready',
      actor_type: 'kitchen',
      note: 'Pesanan siap diantar'
    });

    // Branch Manager assigns driver
    const assignRes = DeliveryDispatchService.assign({
      order_id: orderId,
      provider_type: DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
      driver_name: 'Anto Kurir',
      driver_phone: '08198765432',
      assigned_by: 'manager_1'
    });
    assert.strictEqual(assignRes.success, true);
    assert.strictEqual(assignRes.status, 'assigned');

    // Driver picks up
    DeliveryDispatchService.updateStatus({
      order_id: orderId,
      status: DeliveryModel.STATUS.PICKED_UP,
      actor_id: 'driver_anto'
    });

    // Driver starts delivery: Order becomes out_for_delivery, delivery becomes on_delivery
    DeliveryDispatchService.updateStatus({
      order_id: orderId,
      status: DeliveryModel.STATUS.ON_DELIVERY,
      actor_id: 'driver_anto'
    });

    const onDelOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
    assert.strictEqual(onDelOrder.status, 'out_for_delivery');

    // Driver delivers to customer: customer pays cash to driver
    DeliveryDispatchService.updateStatus({
      order_id: orderId,
      status: DeliveryModel.STATUS.DELIVERED,
      actor_id: 'driver_anto'
    });

    // Verification of independent lifecycles:
    // Order: completed
    const deliveredOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
    assert.strictEqual(deliveredOrder.status, 'completed', 'Order status harus completed');

    // Delivery: delivered
    const deliveryRecord = DeliveryDispatchService.getDelivery(orderId);
    assert.strictEqual(deliveryRecord.status, 'delivered', 'Delivery status harus delivered');

    // Cash Custody: driver holds the cash (collected)
    assert.strictEqual(deliveryRecord.cod_collection_status, 'collected', 'cod_collection_status harus collected');
    assert.strictEqual(deliveryRecord.cod_cash_custody, 'driver', 'cod_cash_custody harus driver');
    assert.strictEqual(Number(deliveryRecord.cod_collected_amount), 50000, 'cod_collected_amount harus 50000');

    // Payment: MUST STILL BE PENDING!
    const paymentRecord = db.prepare('SELECT payment_status FROM order_payments WHERE order_id = ?').get(orderId);
    assert.strictEqual(paymentRecord.payment_status, 'pending', 'Payment status HARUS tetap pending saat delivery delivered');
  });

  // ── 2. Completed Order Exception for Cash Settlement ─────────────────────
  await t.test('2. Completed Order Exception: Cashier settles COD order after completion, custody moves to cashier', async () => {
    const orderId = `ord_cod_settle_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, delivery_fee, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Sari Pelanggan', '081211112222', 'delivery', 'customer_app', 30000, 5000, 35000, 'cash', 'completed')
    `).run(orderId, `ORD-${orderId}`, BRAND_ID, BRANCH_ID);

    db.prepare(`
      INSERT INTO order_payments (id, order_id, provider, payment_method, payment_status, amount)
      VALUES (?, ?, 'cash', 'cash', 'pending', 35000)
    `).run(`pay_${orderId}`, orderId);

    db.prepare(`
      INSERT INTO order_deliveries (id, order_id, driver_name, driver_phone, status, cod_collection_status, cod_cash_custody, cod_collected_amount)
      VALUES (?, ?, 'Doni Kurir', '081233334444', 'delivered', 'collected', 'driver', 35000)
    `).run(`del_${orderId}`, orderId);

    // Initial shift sales
    const shiftBefore = db.prepare('SELECT total_cash_sales FROM pos_shifts WHERE id = ?').get(shiftId);

    // Cashier settles payment with exact amount tendered
    const settlementResult = CashSettlementService.settleCashPayment({
      order_id: orderId,
      amount: 35000,
      amount_tendered: 40000,
      cashier_id: cashierId,
      shift_id: shiftId
    });

    assert.strictEqual(settlementResult.success, true);
    assert.strictEqual(settlementResult.payment_status, 'settlement');
    assert.strictEqual(settlementResult.change, 5000);

    // Verify order_payments state is now settlement
    const paymentAfter = db.prepare('SELECT payment_status FROM order_payments WHERE order_id = ?').get(orderId);
    assert.strictEqual(paymentAfter.payment_status, 'settlement', 'Payment harus settlement');

    // Verify order status remains completed (untouched)
    const orderAfter = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
    assert.strictEqual(orderAfter.status, 'completed', 'Order status tetap completed');

    // Verify COD cash custody transferred to cashier
    const deliveryAfter = orderRepository.findDeliveryByOrderId(orderId);
    assert.strictEqual(deliveryAfter.cod_collection_status, 'handed_over');
    assert.strictEqual(deliveryAfter.cod_cash_custody, 'cashier');
    assert.strictEqual(deliveryAfter.cod_handed_over_to, cashierId);
    assert.ok(deliveryAfter.cod_handed_over_at);

    // Verify shift cash was incremented by net amount due (35000)
    const shiftAfter = db.prepare('SELECT total_cash_sales FROM pos_shifts WHERE id = ?').get(shiftId);
    assert.strictEqual(Number(shiftAfter.total_cash_sales), Number(shiftBefore.total_cash_sales) + 35000);
  });

  // ── 3. Guards & Rejections ───────────────────────────────────────────────
  await t.test('3. Blanket terminal guard rejects cancelled/rejected orders, but permits completed cash', () => {
    const cancelledOrderId = `ord_cancelled_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Batal Cust', '08123', 'delivery', 'customer_app', 20000, 20000, 'cash', 'cancelled')
    `).run(cancelledOrderId, `ORD-${cancelledOrderId}`, BRAND_ID, BRANCH_ID);

    assert.throws(
      () => CashSettlementService.settleCashPayment({
        order_id: cancelledOrderId,
        amount: 20000,
        amount_tendered: 20000,
        cashier_id: cashierId,
        shift_id: shiftId
      }),
      /status terminal "cancelled"/
    );
  });

  await t.test('4. Non-cash payment on completed order is rejected', () => {
    const onlineOrderId = `ord_online_comp_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Online Cust', '08123', 'delivery', 'customer_app', 25000, 25000, 'midtrans', 'completed')
    `).run(onlineOrderId, `ORD-${onlineOrderId}`, BRAND_ID, BRANCH_ID);

    assert.throws(
      () => CashSettlementService.settleCashPayment({
        order_id: onlineOrderId,
        amount: 25000,
        amount_tendered: 25000,
        cashier_id: cashierId,
        shift_id: shiftId
      }),
      /bukan pembayaran tunai\/COD/
    );
  });

  await t.test('5. Cash settlement on unaccepted pending order is rejected', () => {
    const pendingOrderId = `ord_pending_unacc_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Pending Cust', '08123', 'delivery', 'customer_app', 20000, 20000, 'cash', 'pending')
    `).run(pendingOrderId, `ORD-${pendingOrderId}`, BRAND_ID, BRANCH_ID);

    assert.throws(
      () => CashSettlementService.settleCashPayment({
        order_id: pendingOrderId,
        amount: 20000,
        amount_tendered: 20000,
        cashier_id: cashierId,
        shift_id: shiftId
      }),
      /ORDER_NOT_ACCEPTED/
    );
  });

  // ── 4. POS Endpoints Integration ─────────────────────────────────────────
  await t.test('6. GET /pos/sales includes branch COD delivery orders with custody and delivery fields', async () => {
    const codOrderId = `ord_pos_view_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'COD App View', '081288889999', 'delivery', 'customer_app', 40000, 40000, 'cash', 'completed')
    `).run(codOrderId, `ORD-${codOrderId}`, BRAND_ID, BRANCH_ID);

    db.prepare(`
      INSERT INTO order_payments (id, order_id, provider, payment_method, payment_status, amount)
      VALUES (?, ?, 'cash', 'cash', 'pending', 40000)
    `).run(`pay_${codOrderId}`, codOrderId);

    db.prepare(`
      INSERT INTO order_deliveries (id, order_id, driver_name, driver_phone, status, cod_collection_status, cod_cash_custody, cod_collected_amount)
      VALUES (?, ?, 'Joko Driver', '081277778888', 'delivered', 'collected', 'driver', 40000)
    `).run(`del_${codOrderId}`, codOrderId);

    const res = await makeRequest(server, {
      path: '/api/v1/pos/sales',
      method: 'GET',
      headers: {
        'x-auth-token': cashierToken
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const found = res.body.sales.find((s) => s.id === codOrderId);
    assert.ok(found, 'Order COD delivery harus muncul di GET /pos/sales');
    assert.strictEqual(found.delivery_status, 'delivered');
    assert.strictEqual(found.driver_name, 'Joko Driver');
    assert.strictEqual(found.cod_collection_status, 'collected');
    assert.strictEqual(found.cod_cash_custody, 'driver');
    assert.strictEqual(found.payment_status, 'pending');
  });

  await t.test('7. GET /pos/orders/:id returns order, items, payment, and delivery details', async () => {
    const codOrderId = `ord_pos_detail_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Detail Cust', '0812345', 'delivery', 'customer_app', 15000, 15000, 'cash', 'completed')
    `).run(codOrderId, `ORD-${codOrderId}`, BRAND_ID, BRANCH_ID);

    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal)
      VALUES (?, ?, '287', 'Kopi Susu', 1, 15000, 15000)
    `).run(`item_${codOrderId}`, codOrderId);

    db.prepare(`
      INSERT INTO order_deliveries (id, order_id, driver_name, status, cod_collection_status, cod_cash_custody, cod_collected_amount)
      VALUES (?, ?, 'Pak Kurir', 'delivered', 'collected', 'driver', 15000)
    `).run(`del_${codOrderId}`, codOrderId);

    const res = await makeRequest(server, {
      path: `/api/v1/pos/orders/${codOrderId}`,
      method: 'GET',
      headers: {
        'x-auth-token': cashierToken
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.order.id, codOrderId);
    assert.strictEqual(res.body.items.length, 1);
    assert.strictEqual(res.body.delivery.driver_name, 'Pak Kurir');
    assert.strictEqual(res.body.delivery.cod_cash_custody, 'driver');
  });

  await t.test('8. POST /pos/orders/:id/settle-cash settles completed COD delivery order and moves custody to cashier', async () => {
    const codOrderId = `ord_pos_settle_api_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Api Settle Cust', '0812345', 'delivery', 'customer_app', 25000, 25000, 'cash', 'completed')
    `).run(codOrderId, `ORD-${codOrderId}`, BRAND_ID, BRANCH_ID);

    db.prepare(`
      INSERT INTO order_payments (id, order_id, provider, payment_method, payment_status, amount)
      VALUES (?, ?, 'cash', 'cash', 'pending', 25000)
    `).run(`pay_${codOrderId}`, codOrderId);

    db.prepare(`
      INSERT INTO order_deliveries (id, order_id, driver_name, status, cod_collection_status, cod_cash_custody, cod_collected_amount)
      VALUES (?, ?, 'Kurir API', 'delivered', 'collected', 'driver', 25000)
    `).run(`del_${codOrderId}`, codOrderId);

    const res = await makeRequest(server, {
      path: `/api/v1/pos/orders/${codOrderId}/settle-cash`,
      method: 'POST',
      headers: {
        'x-auth-token': cashierToken
      }
    }, {
      amount_tendered: 30000
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.payment.payment_status, 'settlement');
    assert.strictEqual(res.body.payment.change, 5000);

    // Verify database
    const payRow = db.prepare('SELECT payment_status FROM order_payments WHERE order_id = ?').get(codOrderId);
    assert.strictEqual(payRow.payment_status, 'settlement');

    const delRow = db.prepare('SELECT cod_collection_status, cod_cash_custody FROM order_deliveries WHERE order_id = ?').get(codOrderId);
    assert.strictEqual(delRow.cod_collection_status, 'handed_over');
    assert.strictEqual(delRow.cod_cash_custody, 'cashier');
  });

  await t.test('9. Cross-branch cashier settlement is rejected with 404', async () => {
    const otherBranchOrderId = `ord_other_branch_${Date.now()}`;
    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
      VALUES (?, ?, ?, ?, 'Other Branch Cust', '0812345', 'delivery', 'customer_app', 20000, 20000, 'cash', 'completed')
    `).run(otherBranchOrderId, `ORD-${otherBranchOrderId}`, BRAND_ID, OTHER_BRANCH_ID);

    const res = await makeRequest(server, {
      path: `/api/v1/pos/orders/${otherBranchOrderId}/settle-cash`,
      method: 'POST',
      headers: {
        'x-auth-token': cashierToken
      }
    }, {
      amount_tendered: 20000
    });

    assert.strictEqual(res.status, 404);
    assert.match(res.body.error, /di luar kewenangan cabang/);
  });
});
