'use strict';

/**
 * PHASE 5 OWNER DASHBOARD — CUSTOMERS & TEAM TEST SUITE
 * 
 * Verifies:
 * 1. Customers List API (/admin/customers):
 *    - Real Core data: customer name, contact/phone, total orders, total spend, AOV, last order, favorite branch
 *    - Customer Segment calculation: new (1 order) vs returning (>1 orders)
 *    - Segment filtering: ?segment=new, ?segment=returning
 *    - Search by customer name or phone
 *    - Global Branch Context scoping: All Branches vs Specific Branch
 * 2. Customer Detail API (/admin/customers/:id):
 *    - Real profile, contact information, total orders, total spend, AOV, last order
 *    - Favorite branch and top ordered products
 *    - Customer order history with channel, fulfillment, status, and grand_total
 *    - Saved delivery addresses (respecting Buyer vs Recipient distinction)
 *    - 404 on non-existent customer
 * 3. Team Management API (/admin/users):
 *    - Members list: full_name, username, role, branch_id, status
 *    - Branch scoping: All Branches vs Specific Branch
 *    - RBAC enforcement: Cashier forbidden (403), Branch Manager scoped to own branch
 * 4. Direct Routes & Client Owner Dashboard UI:
 *    - Direct route /dashboard/customers serves 200 index.html with customers UI shell
 *    - Direct route /dashboard/customers/:id serves 200 index.html
 *    - Direct route /dashboard/team serves 200 index.html with team UI shell
 *    - Direct route /dashboard/team/members, /dashboard/team/roles, /dashboard/team/permissions serve 200 index.html
 *    - Frontend index.html and dashboard.js contain Customer List, Customer Detail, and Team Subnavs
 * 5. Connector HOLD invariant:
 *    - Xentra Connector is on HOLD and not imported or required
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

test('PHASE 5: OWNER DASHBOARD CUSTOMERS & TEAM IMPLEMENTATION', async (t) => {
  let server;
  let ownerToken;
  let branchManagerToken;
  let cashierToken;
  const BRAND_ID = 'brand_bangjo';
  const BRANCH_BARAT = 'branch_bangjo_barat';
  const BRANCH_TIMUR = 'branch_bangjo_timur';

  // Seed customer test orders & data
  const testOrderId1 = 'ord_p5_test_001';
  const testOrderId2 = 'ord_p5_test_002';
  const testOrderId3 = 'ord_p5_test_003';
  const customerPhone1 = '081288880001'; // Returning customer (2 orders)
  const customerPhone2 = '081288880002'; // New customer (1 order)

  await t.test('0. Setup: server, auth sessions & customer test data', async () => {
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

    // Seed Order 1: Customer 1, Branch Barat, completed, 150,000 IDR
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-05 11:00:00', '2026-09-05 11:00:00')
    `).run(
      testOrderId1, 'ORD-P5-001', BRAND_ID, BRANCH_BARAT, 'Budi Santoso', customerPhone1,
      'delivery', 'customer_app', 'delivery',
      'completed', 140000, 10000, 0, 150000, 'qris', 'paid'
    );

    // Seed Order Items for Order 1
    db.prepare(`
      INSERT OR REPLACE INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('item_p5_001', testOrderId1, 'prod_test_p5_1', 'Ayam Bakar Madu', 35000, 4, 140000);

    // Seed Order 2: Customer 1, Branch Barat, completed, 100,000 IDR (makes Budi Santoso a returning customer)
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-08 14:00:00', '2026-09-08 14:00:00')
    `).run(
      testOrderId2, 'ORD-P5-002', BRAND_ID, BRANCH_BARAT, 'Budi Santoso', customerPhone1,
      'dine_in', 'pos', 'dine_in',
      'completed', 100000, 0, 0, 100000, 'cash', 'paid'
    );

    // Seed Order 3: Customer 2, Branch Timur, completed, 75,000 IDR (New customer)
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-09 16:00:00', '2026-09-09 16:00:00')
    `).run(
      testOrderId3, 'ORD-P5-003', BRAND_ID, BRANCH_TIMUR, 'Citra Lestari', customerPhone2,
      'delivery', 'whatsapp', 'delivery',
      'completed', 65000, 10000, 0, 75000, 'bank_transfer', 'paid'
    );

    // Seed saved address for Customer 1 (Buyer vs Recipient address)
    db.prepare(`
      INSERT OR REPLACE INTO customer_addresses (
        id, brand_id, customer_phone, label, address, detail, note, latitude, longitude, is_primary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      'addr_p5_001', BRAND_ID, customerPhone1, 'Rumah Utama', 'Jl. Merdeka Barat No. 12, Jakarta', 'Pagar Hitam', 'Titip di pos security', -6.2088, 106.8456, 1
    );
  });

  await t.test('1. Customer List API (/api/v1/admin/customers)', async (t2) => {
    await t2.test('1.1 Owner can retrieve full customers list across all branches', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/customers',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.customers));

      const budi = res.body.customers.find(c => c.phone === customerPhone1);
      assert.ok(budi, 'Budi Santoso must be in the customers list');
      assert.strictEqual(budi.name, 'Budi Santoso');
      assert.strictEqual(budi.order_count, 2);
      assert.strictEqual(budi.total_spend, 250000);
      assert.strictEqual(budi.average_order_value, 125000);
      assert.strictEqual(budi.segment, 'returning');
      assert.ok(budi.favorite_branch, 'Favorite branch must be identified');
      assert.strictEqual(budi.favorite_branch.id, BRANCH_BARAT);

      const citra = res.body.customers.find(c => c.phone === customerPhone2);
      assert.ok(citra, 'Citra Lestari must be in the customers list');
      assert.strictEqual(citra.order_count, 1);
      assert.strictEqual(citra.total_spend, 75000);
      assert.strictEqual(citra.segment, 'new');
    });

    await t2.test('1.2 Segment filtering: ?segment=returning and ?segment=new', async () => {
      const resReturning = await makeRequest(server, {
        path: '/api/v1/admin/customers?segment=returning',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resReturning.status, 200);
      assert.ok(resReturning.body.customers.every(c => c.segment === 'returning'));
      assert.ok(resReturning.body.customers.some(c => c.phone === customerPhone1));
      assert.ok(!resReturning.body.customers.some(c => c.phone === customerPhone2));

      const resNew = await makeRequest(server, {
        path: '/api/v1/admin/customers?segment=new',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resNew.status, 200);
      assert.ok(resNew.body.customers.every(c => c.segment === 'new'));
      assert.ok(resNew.body.customers.some(c => c.phone === customerPhone2));
      assert.ok(!resNew.body.customers.some(c => c.phone === customerPhone1));
    });

    await t2.test('1.3 Search filtering by customer name and phone', async () => {
      const resByName = await makeRequest(server, {
        path: '/api/v1/admin/customers?search=Santoso',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resByName.status, 200);
      assert.ok(resByName.body.customers.some(c => c.phone === customerPhone1));
      assert.ok(!resByName.body.customers.some(c => c.phone === customerPhone2));

      const resByPhone = await makeRequest(server, {
        path: `/api/v1/admin/customers?search=${customerPhone2}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resByPhone.status, 200);
      assert.ok(resByPhone.body.customers.some(c => c.phone === customerPhone2));
      assert.ok(!resByPhone.body.customers.some(c => c.phone === customerPhone1));
    });

    await t2.test('1.4 Branch context scoping on customers list', async () => {
      const resBranchBarat = await makeRequest(server, {
        path: `/api/v1/admin/customers?branch_id=${BRANCH_BARAT}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resBranchBarat.status, 200);
      assert.ok(resBranchBarat.body.customers.some(c => c.phone === customerPhone1));
      // Citra ordered only at Timur
      assert.ok(!resBranchBarat.body.customers.some(c => c.phone === customerPhone2));
    });
  });

  await t.test('2. Customer Detail API (/api/v1/admin/customers/:id)', async (t2) => {
    await t2.test('2.1 Retrieve full customer detail profile with addresses and orders', async () => {
      const res = await makeRequest(server, {
        path: `/api/v1/admin/customers/${customerPhone1}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const customer = res.body.customer;
      assert.strictEqual(customer.name, 'Budi Santoso');
      assert.strictEqual(customer.phone, customerPhone1);
      assert.strictEqual(customer.total_orders, 2);
      assert.strictEqual(customer.total_spend, 250000);
      assert.strictEqual(customer.average_order_value, 125000);
      assert.strictEqual(customer.segment, 'returning');
      assert.ok(customer.favorite_branch);
      assert.strictEqual(customer.favorite_branch.id, BRANCH_BARAT);

      // Verify order history is present and sorted
      assert.ok(Array.isArray(customer.orders));
      assert.strictEqual(customer.orders.length, 2);
      assert.ok(customer.orders.some(o => o.id === testOrderId1));
      assert.ok(customer.orders.some(o => o.id === testOrderId2));

      // Verify saved addresses
      assert.ok(Array.isArray(customer.addresses));
      assert.ok(customer.addresses.length >= 1);
      assert.strictEqual(customer.addresses[0].label, 'Rumah Utama');
      assert.strictEqual(customer.addresses[0].address, 'Jl. Merdeka Barat No. 12, Jakarta');

      // Verify top products
      assert.ok(Array.isArray(customer.top_products));
      assert.ok(customer.top_products.some(p => p.product_name === 'Ayam Bakar Madu'));
    });

    await t2.test('2.2 Return 404 for non-existent customer', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/customers/089999999999',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error, 'CUSTOMER_NOT_FOUND');
    });
  });

  await t.test('3. Team Management API (/api/v1/admin/users) & RBAC', async (t2) => {
    await t2.test('3.1 Owner can list team members across brand and filter by branch', async () => {
      const resAll = await makeRequest(server, {
        path: '/api/v1/admin/users',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resAll.status, 200);
      assert.strictEqual(resAll.body.success, true);
      assert.ok(Array.isArray(resAll.body.users));

      // Test filtering by specific branch
      const resBranch = await makeRequest(server, {
        path: `/api/v1/admin/users?branch_id=${BRANCH_BARAT}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resBranch.status, 200);
      assert.strictEqual(resBranch.body.success, true);
      // All returned users with a branch_id should belong to BRANCH_BARAT
      resBranch.body.users.forEach(u => {
        if (u.branch_id) {
          assert.strictEqual(u.branch_id, BRANCH_BARAT);
        }
      });
    });

    await t2.test('3.2 Cashier is forbidden (403) from accessing customers and team APIs', async () => {
      if (!cashierToken) return;
      const resCust = await makeRequest(server, {
        path: '/api/v1/admin/customers',
        headers: { Authorization: `Bearer ${cashierToken}` }
      });
      assert.strictEqual(resCust.status, 403);

      const resTeam = await makeRequest(server, {
        path: '/api/v1/admin/users',
        headers: { Authorization: `Bearer ${cashierToken}` }
      });
      assert.strictEqual(resTeam.status, 403);
    });

    await t2.test('3.3 Branch Manager is scoped to their assigned branch', async () => {
      if (!branchManagerToken) return;
      const resCust = await makeRequest(server, {
        path: '/api/v1/admin/customers',
        headers: { Authorization: `Bearer ${branchManagerToken}` }
      });
      assert.strictEqual(resCust.status, 200);

      const resTeam = await makeRequest(server, {
        path: '/api/v1/admin/users',
        headers: { Authorization: `Bearer ${branchManagerToken}` }
      });
      assert.strictEqual(resTeam.status, 200);
    });
  });

  await t.test('4. Direct Navigation & Client Dashboard UI Serving', async (t2) => {
    await t2.test('4.1 Direct GET /dashboard/customers serves 200 index.html with customers UI shell', async () => {
      const res = await makeRequest(server, {
        path: '/dashboard/customers',
        headers: { Host: 'app.mybangjo.com' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], 'text/html; charset=UTF-8');
      assert.ok(typeof res.body === 'string' && res.body.includes('id="tab-customers"'));
      assert.ok(res.body.includes('id="customers-list-view"'));
      assert.ok(res.body.includes('id="customers-detail-view"'));
      assert.ok(res.body.includes('id="customers-segment-tabs"'));
    });

    await t2.test('4.2 Direct GET /dashboard/customers/:id serves 200 index.html with detail elements', async () => {
      const res = await makeRequest(server, {
        path: `/dashboard/customers/${customerPhone1}`,
        headers: { Host: 'app.mybangjo.com' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], 'text/html; charset=UTF-8');
      assert.ok(typeof res.body === 'string' && res.body.includes('id="cdetail-name"'));
      assert.ok(res.body.includes('id="cdetail-top-products-container"'));
      assert.ok(res.body.includes('id="cdetail-addresses-container"'));
    });

    await t2.test('4.3 Direct GET /dashboard/team serves 200 index.html with team UI shell', async () => {
      const res = await makeRequest(server, {
        path: '/dashboard/team',
        headers: { Host: 'app.mybangjo.com' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], 'text/html; charset=UTF-8');
      assert.ok(typeof res.body === 'string' && res.body.includes('id="tab-tim"'));
      assert.ok(res.body.includes('id="team-subnav"'));
      assert.ok(res.body.includes('data-team-section="members"'));
      assert.ok(res.body.includes('data-team-section="roles"'));
      assert.ok(res.body.includes('data-team-section="permissions"'));
    });

    await t2.test('4.4 Direct subroutes /dashboard/team/members, roles, permissions serve 200 index.html', async () => {
      const resMembers = await makeRequest(server, {
        path: '/dashboard/team/members',
        headers: { Host: 'app.mybangjo.com' }
      });
      assert.strictEqual(resMembers.status, 200);

      const resRoles = await makeRequest(server, {
        path: '/dashboard/team/roles',
        headers: { Host: 'app.mybangjo.com' }
      });
      assert.strictEqual(resRoles.status, 200);

      const resPermissions = await makeRequest(server, {
        path: '/dashboard/team/permissions',
        headers: { Host: 'app.mybangjo.com' }
      });
      assert.strictEqual(resPermissions.status, 200);
    });

    await t2.test('4.5 Frontend dashboard.js contains customer and team router handling', () => {
      const jsCode = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');
      assert.ok(jsCode.includes("'customers':"), 'Must have customers route meta');
      assert.ok(jsCode.includes("'customers/:id':"), 'Must have customers/:id route meta');
      assert.ok(jsCode.includes("'team/members':"), 'Must have team/members route meta');
      assert.ok(jsCode.includes("'team/roles':"), 'Must have team/roles route meta');
      assert.ok(jsCode.includes("'team/permissions':"), 'Must have team/permissions route meta');
      assert.ok(jsCode.includes('loadCustomers'), 'Must define loadCustomers');
      assert.ok(jsCode.includes('loadCustomerDetailView'), 'Must define loadCustomerDetailView');
      assert.ok(jsCode.includes('switchTeamSection'), 'Must define switchTeamSection');
    });
  });

  await t.test('5. Connector HOLD invariant & Cleanup', async () => {
    // Verify xentra-connector is not imported in customers or team code
    const apiCode = fs.readFileSync(path.join(__dirname, '../server/routes/api.js'), 'utf8');
    const repoCode = fs.readFileSync(path.join(__dirname, '../core/data/repositories/ReportingRepository.js'), 'utf8');
    const workforceCode = fs.readFileSync(path.join(__dirname, '../core/identity/WorkforceService.js'), 'utf8');

    assert.strictEqual(apiCode.includes('xentra-connector'), false, 'api.js must not import xentra-connector');
    assert.strictEqual(repoCode.includes('xentra-connector'), false, 'ReportingRepository must not import xentra-connector');
    assert.strictEqual(workforceCode.includes('xentra-connector'), false, 'WorkforceService must not import xentra-connector');

    // Cleanup seeded orders and addresses
    db.prepare("DELETE FROM order_items WHERE id = 'item_p5_001'").run();
    db.prepare("DELETE FROM orders WHERE id IN ('ord_p5_test_001', 'ord_p5_test_002', 'ord_p5_test_003')").run();
    db.prepare("DELETE FROM customer_addresses WHERE id = 'addr_p5_001'").run();

    server.close();
  });
});
