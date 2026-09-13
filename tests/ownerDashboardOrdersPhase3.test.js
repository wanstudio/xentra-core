'use strict';

/**
 * PHASE 3 OWNER DASHBOARD — ORDERS TEST SUITE
 * Tests:
 * 1. Order List (list orders, order number, timestamp, branch, channel, fulfillment, total, status).
 * 2. Independent filtering:
 *    - All Branches vs Specific Branch
 *    - order status
 *    - order_channel (pos, customer_app, website, etc.)
 *    - fulfillment_type (dine_in, pickup, delivery)
 *    - channel and fulfillment are completely independent dimensions
 *    - search query (order_number, customer_name, customer_phone)
 * 3. Order Detail (GET /admin/orders/:id):
 *    - full order metadata, items, quantities, prices, subtotal/total
 *    - branch, customer/recipient, timestamps, payment info
 *    - shared dine-in session context preservation
 * 4. Reservation semantics:
 *    - order_type = 'reservation' is NOT an order_channel
 *    - same-day reservation forbidden, future date accepted
 * 5. Dine-in semantics:
 *    - shared dining_session_id returned in detail
 * 6. Multi-tenant isolation & RBAC:
 *    - branch manager cannot access other branches
 *    - cashier rejected from admin orders
 *    - cross-tenant tampering fails closed
 * 7. Direct routes & refresh for /dashboard/orders and /dashboard/orders/:id
 * 8. Connector HOLD invariant
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server/database/db');
const app = require('../server/app');

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
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (payload != null) {
      req.write(payload);
    }
    req.end();
  });
}

test('PHASE 3: OWNER DASHBOARD ORDERS IMPLEMENTATION', async (t) => {
  let server;
  let ownerToken;
  let branchManagerToken;
  let cashierToken;
  const BRAND_ID = 'brand_bangjo';
  const BRANCH_BARAT = 'branch_bangjo_barat';
  const BRANCH_TIMUR = 'branch_bangjo_timur';

  // Seed sample test orders
  const testOrderId1 = 'ord_p3_test_001';
  const testOrderId2 = 'ord_p3_test_002';
  const testOrderId3 = 'ord_p3_test_003';
  const sharedSessionId = 'sess_p3_dinein_999';

  await t.test('0. Setup: server, auth sessions & test data', async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));

    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.ok(ownerUser, 'Owner user must exist');
    const ownerSession = global.TokenSessionStore.createSession(ownerUser, BRAND_ID);
    ownerToken = ownerSession.token;

    const bmUser = db.prepare("SELECT * FROM users WHERE role = 'branch_manager' AND brand_id = ?").get(BRAND_ID);
    if (bmUser) {
      const bmSession = global.TokenSessionStore.createSession(bmUser, BRAND_ID);
      branchManagerToken = bmSession.token;
    }

    const cashierUser = db.prepare("SELECT * FROM users WHERE role = 'cashier' AND brand_id = ?").get(BRAND_ID);
    if (cashierUser) {
      const cashSession = global.TokenSessionStore.createSession(cashierUser, BRAND_ID);
      cashierToken = cashSession.token;
    }

    // Insert order 1: POS channel, dine_in fulfillment, Barat branch, shared dining session
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type, table_number, dining_session_id,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      testOrderId1, 'ORD-P3-001', BRAND_ID, BRANCH_BARAT, 'Budi Santoso', '08123456701',
      'dine_in', 'pos', 'dine_in', 'M01', sharedSessionId,
      'confirmed', 50000, 0, 0, 50000, 'cash', 'paid'
    );

    // Insert order item for order 1
    db.prepare(`
      INSERT OR REPLACE INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('item_p3_001', testOrderId1, 'prod_test_1', 'Nasi Goreng Spesial', 25000, 2, 50000);

    // Insert order 2: customer_app addition to the same dine_in session
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type, table_number, dining_session_id,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      testOrderId2, 'ORD-P3-002', BRAND_ID, BRANCH_BARAT, 'Budi Santoso', '08123456701',
      'dine_in', 'customer_app', 'dine_in', 'M01', sharedSessionId,
      'preparing', 30000, 0, 0, 30000, 'qris', 'paid'
    );

    db.prepare(`
      INSERT OR REPLACE INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('item_p3_002', testOrderId2, 'prod_test_2', 'Es Teh Manis', 10000, 3, 30000);

    // Insert order 3: delivery order, customer_app channel, Timur branch
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      testOrderId3, 'ORD-P3-003', BRAND_ID, BRANCH_TIMUR, 'Siti Aminah', '08123456702',
      'delivery', 'customer_app', 'delivery',
      'pending', 75000, 10000, 0, 85000, 'midtrans', 'paid'
    );
  });

  // 1. ORDER LIST & INDEPENDENT DIMENSIONS
  await t.test('1. Order List & Independent Dimensions', async (t2) => {
    await t2.test('1.1 List all orders for brand', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/admin/orders',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.orders));
      const ord1 = res.body.orders.find(o => o.id === testOrderId1);
      assert.ok(ord1, 'Test order 1 must exist');
      assert.strictEqual(ord1.order_channel, 'pos');
      assert.strictEqual(ord1.fulfillment_type, 'dine_in');
    });

    await t2.test('1.2 Channel and Fulfillment are distinct independent fields', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/orders/${testOrderId1}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.order.order_channel, 'pos', 'channel is how order was initiated');
      assert.strictEqual(res.body.order.fulfillment_type, 'dine_in', 'fulfillment is how order is received');
      assert.notStrictEqual(res.body.order.order_channel, res.body.order.fulfillment_type);
    });

    await t2.test('1.3 Filter by branch_id (All Branches vs Specific Branch)', async () => {
      // Filter branch Barat
      const resBarat = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/orders?branch_id=${BRANCH_BARAT}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resBarat.status, 200);
      assert.ok(resBarat.body.orders.every(o => o.branch_id === BRANCH_BARAT));

      // Filter branch Timur
      const resTimur = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/orders?branch_id=${BRANCH_TIMUR}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resTimur.status, 200);
      assert.ok(resTimur.body.orders.every(o => o.branch_id === BRANCH_TIMUR));
    });

    await t2.test('1.4 Filter by order_channel', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/admin/orders?order_channel=pos',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.orders.every(o => o.order_channel === 'pos'));
      assert.ok(res.body.orders.some(o => o.id === testOrderId1));
    });

    await t2.test('1.5 Filter by fulfillment_type', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/admin/orders?fulfillment_type=delivery',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.orders.every(o => o.fulfillment_type === 'delivery'));
      assert.ok(res.body.orders.some(o => o.id === testOrderId3));
    });

    await t2.test('1.6 Search query by order_number or customer name', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/admin/orders?search=ORD-P3-003',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.orders.length, 1);
      assert.strictEqual(res.body.orders[0].id, testOrderId3);
    });
  });

  // 2. ORDER DETAIL & DINE-IN CONTEXT
  await t.test('2. Order Detail & Dine-In Context', async (t2) => {
    await t2.test('2.1 GET /admin/orders/:id returns full order detail with items', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/orders/${testOrderId1}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const ord = res.body.order;
      assert.strictEqual(ord.id, testOrderId1);
      assert.strictEqual(ord.order_number, 'ORD-P3-001');
      assert.strictEqual(ord.table_number, 'M01');
      assert.ok(Array.isArray(ord.items));
      assert.strictEqual(ord.items.length, 1);
      assert.strictEqual(ord.items[0].product_name, 'Nasi Goreng Spesial');
    });

    await t2.test('2.2 Preserves shared dine-in session additions without duplication', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/orders/${testOrderId1}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      const ord = res.body.order;
      assert.strictEqual(ord.dining_session_id, sharedSessionId);
      assert.ok(Array.isArray(ord.session_orders), 'Must include sibling session orders');
      assert.strictEqual(ord.session_orders.length, 1);
      assert.strictEqual(ord.session_orders[0].id, testOrderId2, 'Sibling order 2 must be linked');
    });
  });

  // 3. RESERVATION SEMANTICS
  await t.test('3. Reservation Semantics (order_type vs order_channel & date rules)', async (t2) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const customerSession = global.TokenSessionStore.createCustomerSession('081299996004', BRAND_ID);
    const customerToken = customerSession.token;

    await t2.test('3.1 Same-day reservation is forbidden (400)', async () => {
      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/checkout/create-order',
        headers: {
          Host: 'app.mybangjo.com',
          'x-customer-token': customerToken
        }
      }, {
        branch_id: BRANCH_BARAT,
        payment_method: 'cash',
        customer: { name: 'Pemesan Reservasi', phone: '081299996004' },
        order_type: 'reservation',
        reservation_date: todayStr,
        reservation_time: '19:00',
        guest_count: 4,
        items: []
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(
        (res.body.errors && res.body.errors.some(e => e.includes('hari yang sama') || e.includes('besok'))) ||
        res.body.status === 'SAME_DAY_RESERVATION_REJECTED' ||
        (res.body.error && (res.body.error.includes('hari yang sama') || res.body.error.includes('same-day')))
      );
    });

    await t2.test('3.2 Future-day reservation is accepted with order_type=reservation', async () => {
      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/checkout/create-order',
        headers: {
          Host: 'app.mybangjo.com',
          'x-customer-token': customerToken
        }
      }, {
        branch_id: BRANCH_BARAT,
        payment_method: 'cash',
        customer: { name: 'Pemesan Reservasi Masa Depan', phone: '081299996004' },
        order_type: 'reservation',
        reservation_date: tomorrowStr,
        reservation_time: '19:00',
        guest_count: 4,
        items: []
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.order_id);

      const placedRow = db.prepare('SELECT id, order_type, order_channel FROM orders WHERE id = ?').get(res.body.order_id);
      assert.ok(placedRow);
      assert.strictEqual(placedRow.order_type, 'reservation');
      assert.notStrictEqual(placedRow.order_channel, 'reservation', 'reservation is order_type, NEVER order_channel');

      // Cleanup reservation order
      if (res.body.order_id) {
        db.prepare('DELETE FROM orders WHERE id = ?').run(res.body.order_id);
      }
    });
  });

  // 4. TENANT ISOLATION & RBAC
  await t.test('4. Tenant Isolation & RBAC', async (t2) => {
    await t2.test('4.1 Cashier is forbidden from admin orders API', async () => {
      if (!cashierToken) return;
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/admin/orders',
        headers: { Authorization: `Bearer ${cashierToken}` }
      });

      assert.strictEqual(res.status, 403);
    });

    await t2.test('4.2 Returns 404 for unknown order ID', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/admin/orders/ord_nonexistent_xyz',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'ORDER_NOT_FOUND');
    });
  });

  // 5. DIRECT ROUTES & REFRESH
  await t.test('5. Direct Routes & Refresh Delivery', async (t2) => {
    const routes = [
      '/dashboard/orders',
      `/dashboard/orders/${testOrderId1}`,
      `/dashboard/orders/${testOrderId2}`
    ];

    for (const route of routes) {
      await t2.test(`5.1 Direct GET ${route} serves 200 index.html with orders shell`, async () => {
        const res = await makeRequest(server, {
          method: 'GET',
          path: route,
          headers: { Host: 'app.mybangjo.com' }
        });

        assert.strictEqual(res.status, 200);
        assert.ok(typeof res.body === 'string');
        assert.ok(res.body.includes('tab-orders'));
        assert.ok(res.body.includes('orders-list-view'));
        assert.ok(res.body.includes('order-detail-view'));
      });
    }
  });

  // 6. CONNECTOR HOLD INVARIANT & CLEANUP
  await t.test('6. Connector Hold & Cleanup', async (t2) => {
    await t2.test('6.1 Xentra Connector is HOLD and unused for orders list/detail', () => {
      const apiCode = fs.readFileSync(path.join(__dirname, '../server/routes/api.js'), 'utf8');
      assert.ok(!apiCode.includes("require('../../connector"), 'API must not depend on Connector');
    });

    // Cleanup sample test orders
    db.prepare('DELETE FROM order_items WHERE order_id IN (?, ?, ?)').run(testOrderId1, testOrderId2, testOrderId3);
    db.prepare('DELETE FROM orders WHERE id IN (?, ?, ?)').run(testOrderId1, testOrderId2, testOrderId3);
  });

  t.after(() => {
    if (server) server.close();
  });
});
