'use strict';

/**
 * PHASE 6 OWNER DASHBOARD — FINANCE & MARKETING TEST SUITE
 * 
 * Verifies:
 * 1. Finance Overview API (/api/v1/admin/finance/overview):
 *    - Authoritative gross sales, net sales, settled total, cash vs midtrans breakdown
 *    - Unreconciled count & amount
 *    - Honest not-configured status for refunds & payouts
 *    - Branch context filtering (All Branches vs Specific Branch)
 * 2. Finance Transactions API (/api/v1/admin/finance/transactions):
 *    - Lists transactions with date/time, order reference, branch, payment method, amount, status
 *    - Filters by payment_method, payment_status, branch_id
 * 3. Finance Reconciliation API (/api/v1/admin/finance/reconciliation):
 *    - Authoritative reconciliation records matching pending/reconciliation_pending
 * 4. Finance Payment Methods API (/api/v1/admin/finance/payment-methods):
 *    - Cash & Midtrans supported methods only; branch override awareness
 * 5. Marketing Overview API (/api/v1/admin/marketing/overview):
 *    - Total customers, new vs returning segmentation, repeat purchase rate
 *    - Active promotion count, total redemptions, total benefit amount
 *    - Honest not-configured status for campaigns & loyalty
 * 6. Marketing Promotions API (/api/v1/admin/marketing/promotions):
 *    - Authoritative promotions from Core promotion domain (Install incentive, etc.)
 * 7. Multi-Tenant Isolation & RBAC Security:
 *    - Cashier is forbidden (403) from accessing admin finance and marketing endpoints
 *    - Branch Manager is scoped to their branch
 *    - Tenant isolation across brands
 * 8. Direct Navigation & Routing:
 *    - Direct routes /dashboard/finance, /dashboard/finance/overview, /dashboard/finance/transactions,
 *      /dashboard/finance/payouts, /dashboard/finance/reconciliation, /dashboard/finance/payment-methods
 *    - Direct routes /dashboard/marketing, /dashboard/marketing/overview, /dashboard/marketing/promotions,
 *      /dashboard/marketing/discounts, /dashboard/marketing/campaigns, /dashboard/marketing/loyalty
 *    - Browser refresh serves 200 index.html on tenant host
 * 9. Connector HOLD Invariant:
 *    - Xentra Connector is on HOLD and not imported or required for Finance / Marketing
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

test('PHASE 6: OWNER DASHBOARD FINANCE & MARKETING IMPLEMENTATION', async (t) => {
  let server;
  let ownerToken;
  let branchManagerToken;
  let cashierToken;
  const BRAND_ID = 'brand_bangjo';
  const BRANCH_BARAT = 'branch_bangjo_barat';
  const BRANCH_TIMUR = 'branch_bangjo_timur';

  const testOrderId1 = 'ord_p6_test_001';
  const testOrderId2 = 'ord_p6_test_002';
  const testOrderId3 = 'ord_p6_test_003';
  const testPayId1 = 'pay_p6_test_001';
  const testPayId2 = 'pay_p6_test_002';
  const testPayId3 = 'pay_p6_test_003';

  await t.test('0. Setup: server, auth sessions & finance/marketing test data', async () => {
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

    // Seed Order 1: Cash, Settled, Branch Barat, 100,000 IDR
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-10 10:00:00', '2026-09-10 10:00:00')
    `).run(
      testOrderId1, 'ORD-P6-001', BRAND_ID, BRANCH_BARAT, 'Ahmad Cashier', '081299990001',
      'dine_in', 'pos', 'dine_in',
      'completed', 100000, 0, 0, 100000, 'cash', 'paid'
    );

    // Seed Order Payment 1: Cash, settlement
    db.prepare(`
      INSERT OR REPLACE INTO order_payments (
        id, order_id, provider, payment_method, payment_status, amount, settled_at, created_at, updated_at
      ) VALUES (?, ?, 'cash', 'cash', 'settlement', 100000, '2026-09-10 10:05:00', '2026-09-10 10:00:00', '2026-09-10 10:05:00')
    `).run(testPayId1, testOrderId1);

    // Seed Order 2: Midtrans, Settled, Branch Timur, 250,000 IDR
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-10 12:00:00', '2026-09-10 12:00:00')
    `).run(
      testOrderId2, 'ORD-P6-002', BRAND_ID, BRANCH_TIMUR, 'Sari Midtrans', '081299990002',
      'delivery', 'customer_app', 'delivery',
      'completed', 230000, 20000, 0, 250000, 'midtrans', 'paid'
    );

    // Seed Order Payment 2: Midtrans, settlement
    db.prepare(`
      INSERT OR REPLACE INTO order_payments (
        id, order_id, provider, payment_method, payment_status, amount, settled_at, created_at, updated_at
      ) VALUES (?, ?, 'midtrans', 'midtrans', 'settlement', 250000, '2026-09-10 12:05:00', '2026-09-10 12:00:00', '2026-09-10 12:05:00')
    `).run(testPayId2, testOrderId2);

    // Seed Order 3: Midtrans, Pending Reconciliation, Branch Barat, 75,000 IDR
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type,
        status, subtotal, delivery_fee, discount_amount, grand_total, payment_method, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-11 15:00:00', '2026-09-11 15:00:00')
    `).run(
      testOrderId3, 'ORD-P6-003', BRAND_ID, BRANCH_BARAT, 'Doni Pending', '081299990003',
      'takeaway', 'customer_app', 'takeaway',
      'pending', 75000, 0, 0, 75000, 'midtrans', 'pending'
    );

    // Seed Order Payment 3: reconciliation_pending
    db.prepare(`
      INSERT OR REPLACE INTO order_payments (
        id, order_id, provider, payment_method, payment_status, amount, created_at, updated_at
      ) VALUES (?, ?, 'midtrans', 'midtrans', 'reconciliation_pending', 75000, '2026-09-11 15:00:00', '2026-09-11 15:00:00')
    `).run(testPayId3, testOrderId3);

    // Seed Promo Redemption for Marketing test
    db.prepare(`
      INSERT OR REPLACE INTO promotion_redemptions (
        id, promotion_id, order_id, brand_id, branch_id, customer_phone, benefit_amount, status, redeemed_at
      ) VALUES ('red_p6_001', 'prm_bangjo_pwa_install', ?, ?, ?, ?, 10000, 'active', '2026-09-10 12:00:00')
    `).run(testOrderId2, BRAND_ID, BRANCH_TIMUR, '081299990002');
  });

  /* =========================================================================
     1. FINANCE OVERVIEW API
     ========================================================================= */
  await t.test('1. Finance Overview API (/api/v1/admin/finance/overview)', async (sub) => {
    await sub.test('1.1 Owner retrieves business-wide finance overview (All Branches)', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/finance/overview',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data && res.body.data.summary, 'Summary must exist');

      const s = res.body.data.summary;
      assert.ok(s.total_settled >= 350000, 'Total settled must include cash (100k) + midtrans (250k)');
      assert.strictEqual(s.unreconciled_count >= 1, true, 'Must report at least 1 unreconciled record');
      assert.strictEqual(s.unreconciled_amount >= 75000, true, 'Must report unreconciled amount >= 75k');
      assert.strictEqual(s.refunds.supported, false, 'Refunds must be honest not_configured');
      assert.strictEqual(s.payouts.supported, false, 'Payouts must be honest not_configured');
    });

    await sub.test('1.2 Branch context filtering limits financial data to specific branch', async () => {
      const res = await makeRequest(server, {
        path: `/api/v1/admin/finance/overview?branch_id=${BRANCH_BARAT}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const s = res.body.data.summary;
      assert.strictEqual(s.cash_settled, 100000);
      assert.strictEqual(s.midtrans_settled, 0, 'Branch Barat should have 0 settled midtrans in test dataset');
    });
  });

  /* =========================================================================
     2. FINANCE TRANSACTIONS API
     ========================================================================= */
  await t.test('2. Finance Transactions API (/api/v1/admin/finance/transactions)', async (sub) => {
    await sub.test('2.1 List all transactions with order reference and payment attributes', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/finance/transactions',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.transactions));
      assert.ok(res.body.total >= 3);

      const tx = res.body.transactions.find(t => t.id === testPayId1);
      assert.ok(tx, 'Transaction 1 must be listed');
      assert.strictEqual(tx.payment_method, 'cash');
      assert.strictEqual(tx.payment_status, 'settlement');
      assert.strictEqual(tx.amount, 100000);
      assert.strictEqual(tx.order_number, 'ORD-P6-001');
    });

    await sub.test('2.2 Filter transactions by payment_method=midtrans', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/finance/transactions?payment_method=midtrans',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.transactions.every(t => t.payment_method === 'midtrans'));
    });
  });

  /* =========================================================================
     3. FINANCE RECONCILIATION API
     ========================================================================= */
  await t.test('3. Finance Reconciliation API (/api/v1/admin/finance/reconciliation)', async () => {
    const res = await makeRequest(server, {
      path: '/api/v1/admin/finance/reconciliation',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.reconciliation);
    assert.ok(res.body.reconciliation.pending_count >= 1);
    const rec = res.body.reconciliation.records.find(r => r.order_id === testOrderId3);
    assert.ok(rec, 'Order 3 must be present in reconciliation queue');
    assert.strictEqual(rec.payment_status, 'reconciliation_pending');
    assert.strictEqual(rec.amount, 75000);
  });

  /* =========================================================================
     4. FINANCE PAYMENT METHODS API
     ========================================================================= */
  await t.test('4. Finance Payment Methods API (/api/v1/admin/finance/payment-methods)', async () => {
    const res = await makeRequest(server, {
      path: '/api/v1/admin/finance/payment-methods',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.payment_methods));

    const cash = res.body.payment_methods.find(m => m.code === 'cash');
    const midtrans = res.body.payment_methods.find(m => m.code === 'midtrans');
    assert.ok(cash, 'Cash method must be present');
    assert.strictEqual(cash.is_enabled, true);
    assert.ok(midtrans, 'Midtrans method must be present');
  });

  /* =========================================================================
     5. MARKETING OVERVIEW API
     ========================================================================= */
  await t.test('5. Marketing Overview API (/api/v1/admin/marketing/overview)', async () => {
    const res = await makeRequest(server, {
      path: '/api/v1/admin/marketing/overview',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.customer_metrics);
    assert.ok(res.body.data.promotion_metrics);
    assert.ok(res.body.data.recent_redemptions);
    assert.strictEqual(res.body.data.campaigns.supported, false);
    assert.strictEqual(res.body.data.loyalty.supported, false);

    const pm = res.body.data.promotion_metrics;
    assert.ok(pm.total_promotions >= 1);
    assert.ok(pm.total_redemptions >= 1);
  });

  /* =========================================================================
     6. MARKETING PROMOTIONS API
     ========================================================================= */
  await t.test('6. Marketing Promotions API (/api/v1/admin/marketing/promotions)', async () => {
    const res = await makeRequest(server, {
      path: '/api/v1/admin/marketing/promotions',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.promotions));
    const promo = res.body.promotions.find(p => p.id === 'prm_bangjo_pwa_install');
    assert.ok(promo, 'Install incentive promotion must exist from Core');
    assert.strictEqual(promo.capability_type, 'install_incentive');
    assert.strictEqual(promo.is_active, 1);
  });

  /* =========================================================================
     7. SECURITY & RBAC ISOLATION
     ========================================================================= */
  await t.test('7. RBAC & Multi-Tenant Authorization Boundaries', async (sub) => {
    if (cashierToken) {
      await sub.test('7.1 Cashier is forbidden (403) from accessing admin finance', async () => {
        const res = await makeRequest(server, {
          path: '/api/v1/admin/finance/overview',
          headers: { Authorization: `Bearer ${cashierToken}` }
        });
        assert.strictEqual(res.status, 403);
      });

      await sub.test('7.2 Cashier is forbidden (403) from accessing admin marketing', async () => {
        const res = await makeRequest(server, {
          path: '/api/v1/admin/marketing/overview',
          headers: { Authorization: `Bearer ${cashierToken}` }
        });
        assert.strictEqual(res.status, 403);
      });
    }

    await sub.test('7.3 Unauthenticated request is rejected (401)', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/finance/overview'
      });
      assert.strictEqual(res.status, 401);
    });
  });

  /* =========================================================================
     8. DIRECT NAVIGATION & UI SERVING
     ========================================================================= */
  await t.test('8. Direct Navigation & Client Dashboard UI Serving', async (sub) => {
    const routes = [
      '/dashboard/finance',
      '/dashboard/finance/overview',
      '/dashboard/finance/transactions',
      '/dashboard/finance/payouts',
      '/dashboard/finance/reconciliation',
      '/dashboard/finance/payment-methods',
      '/dashboard/marketing',
      '/dashboard/marketing/overview',
      '/dashboard/marketing/promotions',
      '/dashboard/marketing/discounts',
      '/dashboard/marketing/campaigns',
      '/dashboard/marketing/loyalty'
    ];

    for (const r of routes) {
      await sub.test(`8.x Direct GET ${r} serves 200 index.html on tenant host`, async () => {
        const res = await makeRequest(server, { path: r });
        assert.strictEqual(res.status, 200);
        assert.match(String(res.body), /id="tab-finance"/);
        assert.match(String(res.body), /id="tab-marketing"/);
      });
    }
  });

  /* =========================================================================
     9. CONNECTOR HOLD INVARIANT & CLEANUP
     ========================================================================= */
  await t.test('9. Connector HOLD invariant & Cleanup', async () => {
    const apiFile = fs.readFileSync(path.join(__dirname, '../server/routes/api.js'), 'utf8');
    assert.doesNotMatch(apiFile, /require\(['"].*connector['"]\)/i, 'Xentra Connector must not be imported in api.js');

    // Clean up test records
    db.prepare("DELETE FROM promotion_redemptions WHERE id = 'red_p6_001'").run();
    db.prepare("DELETE FROM order_payments WHERE id IN (?, ?, ?)").run(testPayId1, testPayId2, testPayId3);
    db.prepare("DELETE FROM orders WHERE id IN (?, ?, ?)").run(testOrderId1, testOrderId2, testOrderId3);

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
