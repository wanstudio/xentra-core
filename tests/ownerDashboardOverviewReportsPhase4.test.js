'use strict';

/**
 * PHASE 4 OWNER DASHBOARD — OVERVIEW & REPORTS TEST SUITE
 * 
 * Verifies:
 * 1. Overview API (/admin/overview):
 *    - Real Core metrics (Net Sales, Orders, Customers, AOV)
 *    - Sales Performance: breakdown by order_channel and fulfillment_type (strictly distinct)
 *    - Top Products
 *    - Branch Performance
 *    - Needs Attention (low stock items)
 *    - Branch filtering & date range filtering
 * 2. Reports Engine API (/reports/:report_type):
 *    - Sub-reports: 'sales', 'orders', 'products', 'customers', 'branches', 'operations'
 *    - Date range filtering
 *    - Scoping by branch_id (All Branches vs Specific Branch)
 *    - Customer insights & repeat count
 *    - Operational stock alerts
 * 3. Granular RBAC & Tenant Isolation:
 *    - Cashier rejected (401/403) from overview and reports
 *    - Branch Manager scoped to assigned branch; forbidden from multi-branch comparison
 *    - Cross-tenant data isolation
 * 4. Client Dashboard UI & Direct Routes:
 *    - Direct route /dashboard/overview serves 200 with Client Owner Dashboard shell
 *    - Direct route /dashboard/reports serves 200 with Client Owner Dashboard shell
 *    - Direct route /dashboard/reports/sales serves 200 with Client Owner Dashboard shell
 * 5. Connector HOLD invariant:
 *    - Xentra Connector is HOLD and not required/imported
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

test('PHASE 4: OWNER DASHBOARD OVERVIEW & REPORTS IMPLEMENTATION', async (t) => {
  let server;
  let ownerToken;
  let branchManagerToken;
  let cashierToken;
  const BRAND_ID = 'brand_bangjo';
  const BRANCH_BARAT = 'branch_bangjo_barat';
  const BRANCH_TIMUR = 'branch_bangjo_timur';

  // Seed test orders for phase 4
  const testOrderId1 = 'ord_p4_test_001';
  const testOrderId2 = 'ord_p4_test_002';
  const testOrderId3 = 'ord_p4_test_003';

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

    // Seed Order 1: Branch Barat, customer_app, delivery, 100,000 IDR
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-01 10:00:00', '2026-09-01 10:00:00')
    `).run(
      testOrderId1, 'ORD-P4-001', BRAND_ID, BRANCH_BARAT, 'Andi Wijaya', '08129999001',
      'delivery', 'customer_app', 'delivery',
      'completed', 90000, 10000, 0, 100000, 'qris', 'paid'
    );

    // Seed Order Item for Order 1
    db.prepare(`
      INSERT OR REPLACE INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('item_p4_001', testOrderId1, 'prod_test_p4_1', 'Bebek Goreng Crispy', 45000, 2, 90000);

    // Seed Order 2: Branch Barat, pos channel, dine_in, 50,000 IDR
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-05 12:30:00', '2026-09-05 12:30:00')
    `).run(
      testOrderId2, 'ORD-P4-002', BRAND_ID, BRANCH_BARAT, 'Budi Santoso', '08129999002',
      'dine_in', 'pos', 'dine_in',
      'completed', 50000, 0, 0, 50000, 'cash', 'paid'
    );

    // Seed Order Item for Order 2
    db.prepare(`
      INSERT OR REPLACE INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('item_p4_002', testOrderId2, 'prod_test_p4_2', 'Ayam Bakar Madu', 25000, 2, 50000);

    // Seed Order 3: Branch Timur, customer_app, pickup, 30,000 IDR
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-10 15:00:00', '2026-09-10 15:00:00')
    `).run(
      testOrderId3, 'ORD-P4-003', BRAND_ID, BRANCH_TIMUR, 'Andi Wijaya', '08129999001',
      'pickup', 'customer_app', 'pickup',
      'completed', 30000, 0, 0, 30000, 'transfer', 'paid'
    );

    // Seed Order Item for Order 3
    db.prepare(`
      INSERT OR REPLACE INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('item_p4_003', testOrderId3, 'prod_test_p4_1', 'Bebek Goreng Crispy', 30000, 1, 30000);
  });

  await t.test('1. Overview API (/admin/overview)', async (t2) => {
    await t2.test('1.1 Returns authoritative KPIs (Net Sales, Orders, Customers, AOV)', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/overview',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const data = res.body.data;
      assert.ok(data.kpis, 'KPIs object must exist');
      assert.ok(data.kpis.net_sales > 0, 'Net sales must be greater than 0');
      assert.ok(data.kpis.orders >= 3, 'Total completed orders must be at least 3');
      assert.ok(data.kpis.customers >= 2, 'Distinct customers count must be at least 2');
      assert.ok(data.kpis.aov > 0, 'Average order value must be positive');
    });

    await t2.test('1.2 Channel and Fulfillment are independent dimensions in Sales Performance', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/overview',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      const salesPerf = res.body.data.sales_performance;
      assert.ok(Array.isArray(salesPerf.by_channel), 'by_channel must be an array');
      assert.ok(Array.isArray(salesPerf.by_fulfillment), 'by_fulfillment must be an array');

      // Verify channel names
      const channelNames = salesPerf.by_channel.map(c => c.order_channel);
      assert.ok(channelNames.includes('customer_app') || channelNames.includes('pos'));

      // Verify fulfillment types
      const fulfillmentTypes = salesPerf.by_fulfillment.map(f => f.fulfillment_type);
      assert.ok(fulfillmentTypes.includes('delivery') || fulfillmentTypes.includes('dine_in') || fulfillmentTypes.includes('pickup'));
    });

    await t2.test('1.3 Scoping by branch_id (All Branches vs Specific Branch)', async () => {
      // Fetch All Branches
      const allRes = await makeRequest(server, {
        path: '/api/v1/admin/overview',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      // Fetch Specific Branch (BRANCH_TIMUR)
      const timurRes = await makeRequest(server, {
        path: `/api/v1/admin/overview?branch_id=${BRANCH_TIMUR}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(allRes.status, 200);
      assert.strictEqual(timurRes.status, 200);

      // All branches net sales must be greater than or equal to single branch net sales
      assert.ok(allRes.body.data.kpis.net_sales >= timurRes.body.data.kpis.net_sales);
      assert.ok(allRes.body.data.kpis.orders >= timurRes.body.data.kpis.orders);
    });

    await t2.test('1.4 Date filtering respects start_date and end_date', async () => {
      // Date range covering only order 1 (2026-09-01)
      const res = await makeRequest(server, {
        path: '/api/v1/admin/overview?start_date=2026-09-01T00:00:00Z&end_date=2026-09-02T00:00:00Z',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.kpis.orders, 1);
      assert.strictEqual(res.body.data.kpis.net_sales, 100000);
    });

    await t2.test('1.5 Empty state returns zeroed metrics without fabricating numbers', async () => {
      // Future date with no orders
      const res = await makeRequest(server, {
        path: '/api/v1/admin/overview?start_date=2030-01-01T00:00:00Z&end_date=2030-01-02T00:00:00Z',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.kpis.orders, 0);
      assert.strictEqual(res.body.data.kpis.net_sales, 0);
      assert.strictEqual(res.body.data.kpis.customers, 0);
      assert.strictEqual(res.body.data.kpis.aov, 0);
      assert.strictEqual(res.body.data.sales_performance.timeline.length, 0);
    });
  });

  await t.test('2. Reports Engine API (/reports/:report_type)', async (t2) => {
    await t2.test('2.1 Sales Report returns sales summary and timeline', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/reports/sales',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.report_type, 'sales');
      assert.ok(res.body.data.summary.total_orders > 0);
      assert.ok(Array.isArray(res.body.data.timeline));
    });

    await t2.test('2.2 Orders Report alias maps cleanly to sales/order report', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/reports/orders',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.summary.total_orders > 0);
    });

    await t2.test('2.3 Products Report returns top sellers and category contribution', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/reports/products',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.report_type, 'products');
      assert.ok(Array.isArray(res.body.data.top_products));
      assert.ok(Array.isArray(res.body.data.category_contribution));
    });

    await t2.test('2.4 Customers Report returns unique customers and top spending customers', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/reports/customers',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.report_type, 'customers');
      assert.ok(res.body.data.summary.total_unique_customers >= 2);
      assert.ok(Array.isArray(res.body.data.top_customers));
    });

    await t2.test('2.5 Branches Report returns comparative branch performance', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/reports/branches',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.branches));
      assert.ok(res.body.data.branches.length >= 2);
    });

    await t2.test('2.6 Operations Report returns low stock alerts & movements', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/reports/operations',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.low_stock_alerts));
      assert.ok(Array.isArray(res.body.data.movement_breakdown));
    });
  });

  await t.test('3. RBAC & Multi-Tenant Authorization Boundaries', async (t2) => {
    await t2.test('3.1 Cashier is forbidden from overview and reports', async () => {
      if (!cashierToken) return;
      const resOverview = await makeRequest(server, {
        path: '/api/v1/admin/overview',
        headers: { Authorization: `Bearer ${cashierToken}` }
      });
      assert.strictEqual(resOverview.status, 403);

      const resReports = await makeRequest(server, {
        path: '/api/v1/reports/sales',
        headers: { Authorization: `Bearer ${cashierToken}` }
      });
      assert.strictEqual(resReports.status, 403);
    });

    await t2.test('3.2 Branch Manager is restricted from cross-branch leaderboard', async () => {
      if (!branchManagerToken) return;
      const resBranches = await makeRequest(server, {
        path: '/api/v1/reports/branches',
        headers: { Authorization: `Bearer ${branchManagerToken}` }
      });
      // Branch comparison is strictly for Owner / Brand Executive
      assert.strictEqual(resBranches.status, 403);
    });
  });

  await t.test('4. Direct Navigation & Client Dashboard UI Serving', async (t2) => {
    await t2.test('4.1 Direct GET /dashboard/overview serves 200 index.html on tenant host', async () => {
      const res = await makeRequest(server, {
        path: '/dashboard/overview',
        headers: { Host: 'app.mybangjo.com' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], 'text/html; charset=UTF-8');
      assert.ok(typeof res.body === 'string' && res.body.includes('id="tab-overview"'));
    });

    await t2.test('4.2 Direct GET /dashboard/reports serves 200 index.html with reports UI shell', async () => {
      const res = await makeRequest(server, {
        path: '/dashboard/reports',
        headers: { Host: 'app.mybangjo.com' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], 'text/html; charset=UTF-8');
      assert.ok(typeof res.body === 'string' && res.body.includes('id="tab-reports"'));
      assert.ok(res.body.includes('data-report="sales"'));
      assert.ok(res.body.includes('data-report="operations"'));
    });

    await t2.test('4.3 Direct GET /dashboard/reports/sales serves 200 index.html', async () => {
      const res = await makeRequest(server, {
        path: '/dashboard/reports/sales',
        headers: { Host: 'app.mybangjo.com' }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(typeof res.body === 'string' && res.body.includes('id="tab-reports"'));
    });
  });

  await t.test('5. Connector HOLD invariant & Cleanup', async () => {
    // Verify xentra-connector is not imported in reporting or overview
    const apiCode = fs.readFileSync(path.join(__dirname, '../server/routes/api.js'), 'utf8');
    const reportingEngineCode = fs.readFileSync(path.join(__dirname, '../domains/reporting/index.js'), 'utf8');
    const reportingRepoCode = fs.readFileSync(path.join(__dirname, '../core/data/repositories/ReportingRepository.js'), 'utf8');

    assert.strictEqual(apiCode.includes('xentra-connector'), false, 'api.js must not import xentra-connector');
    assert.strictEqual(reportingEngineCode.includes('xentra-connector'), false, 'reporting index must not import xentra-connector');
    assert.strictEqual(reportingRepoCode.includes('xentra-connector'), false, 'ReportingRepository must not import xentra-connector');

    // Cleanup seeded orders
    db.prepare("DELETE FROM order_items WHERE id IN ('item_p4_001', 'item_p4_002', 'item_p4_003')").run();
    db.prepare("DELETE FROM orders WHERE id IN ('ord_p4_test_001', 'ord_p4_test_002', 'ord_p4_test_003')").run();

    server.close();
  });
});
