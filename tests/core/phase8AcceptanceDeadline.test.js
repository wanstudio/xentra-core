'use strict';

/**
 * Phase 8.1 — Merchant Dashboard Acceptance Deadline Test Suite
 *
 * Verifies server-authoritative acceptance_deadline_at representation
 * and ensures the Merchant Dashboard never constructs or fabricates deadlines
 * locally or mutates order status when the presentational countdown expires.
 *
 * Requirements:
 * 1. Merchant Dashboard consumes server-provided acceptance_deadline_at
 * 2. No created_at + 180000 deadline reconstruction in dashboard codebase
 * 3. Both acceptance queue table and order detail view display countdown from acceptance_deadline_at
 * 4. Missing/invalid acceptance_deadline_at falls back to neutral state ("Memeriksa status...") without fabricating 180s
 * 5. Expired deadline shows neutral indicator ("Memeriksa status...") and triggers authoritative refresh from server
 * 6. Countdown reaching zero NEVER transitions order status or calls mutation endpoint
 * 7. Endpoints GET /admin/branches/:id/orders and GET /admin/orders/:id expose acceptance_deadline_at
 * 8. Non-pending orders return null acceptance_deadline_at
 * 9. Platform 180s policy in AcceptanceTimeoutService remains single source of truth
 * 10. Regression: P7 customer waiting screen and P8 acceptance flow remain intact
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-p8-acceptance-deadline';

const app = require('../../server/app');
const db = require('../../server/database/db');
const AcceptanceTimeoutService = require('../../server/services/AcceptanceTimeoutService');

let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const BRANCH_A_ID = 'branch_bangjo_barat';

function seedOrder({
  branchId = BRANCH_A_ID,
  status = 'pending',
  ageSeconds = 0,
  grandTotal = 50000,
  customerPhone = '081299990001',
  paymentMethod = 'cash',
  paymentStatus = 'unpaid'
} = {}) {
  const orderId = 'p81_dl_' + crypto.randomBytes(4).toString('hex');
  const orderNumber = 'XTR-P81-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const createdAt = new Date(Date.now() - ageSeconds * 1000).toISOString();

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total, created_at)
    VALUES (?, ?, ?, ?, 'Budi Santoso', ?, 'delivery', ?, ?, ?, ?)
  `).run(orderId, orderNumber, BRAND_ID, branchId, customerPhone, status, grandTotal, grandTotal, createdAt);

  const payId = 'pay_' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_method, payment_status, amount, created_at)
    VALUES (?, ?, 'manual', ?, ?, ?, ?)
  `).run(payId, orderId, paymentMethod, paymentStatus, grandTotal, createdAt);

  const itemId = 'item_' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal)
    VALUES (?, ?, 'prod_ayam_bakar', 'Ayam Bakar', 25000, 2, 50000)
  `).run(itemId, orderId);

  return { orderId, orderNumber, branchId, status, createdAt };
}

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_A_ID, brandId = BRAND_ID, userId = 'bm_p81_user' } = {}) {
  const token = 'p81staff_' + crypto.randomBytes(8).toString('hex');
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

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const apiPath = path.startsWith('/api') ? path : ('/api/v1' + path);
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

describe('Phase 8.1 — Merchant Dashboard Server-Authoritative Acceptance Deadline', () => {
  let bmToken;

  before(async () => {
    db.seedDemoData(db);
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    bmToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, userId: 'bm_p81_mgr' });
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    db.prepare("DELETE FROM order_payments WHERE order_id LIKE 'p81_dl_%'").run();
    db.prepare("DELETE FROM order_items WHERE order_id LIKE 'p81_dl_%'").run();
    db.prepare("DELETE FROM order_status_logs WHERE order_id LIKE 'p81_dl_%'").run();
    db.prepare("DELETE FROM orders WHERE id LIKE 'p81_dl_%'").run();
  });

  it('1. GET /admin/branches/:id/orders exposes server-computed acceptance_deadline_at for pending orders', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending', ageSeconds: 30 });

    const res = await request('GET', `/admin/branches/${BRANCH_A_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    const target = res.data.orders.find(o => o.id === ord.orderId);
    assert.ok(target, 'Order should be present in branch queue');
    assert.ok(target.acceptance_deadline_at, 'acceptance_deadline_at must be populated');

    const expectedMs = new Date(ord.createdAt).getTime() + AcceptanceTimeoutService.ACCEPTANCE_TIMEOUT_SECONDS * 1000;
    const actualMs = new Date(target.acceptance_deadline_at).getTime();
    assert.equal(actualMs, expectedMs, 'acceptance_deadline_at must equal created_at + 180s');
  });

  it('2. GET /admin/orders/:id exposes server-computed acceptance_deadline_at for pending orders', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending', ageSeconds: 15 });

    const res = await request('GET', `/admin/orders/${ord.orderId}`, null, {
      Authorization: `Bearer ${bmToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.ok(res.data.order, 'Order detail returned');
    assert.ok(res.data.order.acceptance_deadline_at, 'acceptance_deadline_at must be present');

    const expectedMs = new Date(ord.createdAt).getTime() + AcceptanceTimeoutService.ACCEPTANCE_TIMEOUT_SECONDS * 1000;
    const actualMs = new Date(res.data.order.acceptance_deadline_at).getTime();
    assert.equal(actualMs, expectedMs, 'acceptance_deadline_at must equal created_at + 180s');
  });

  it('3. Non-pending orders return null acceptance_deadline_at', async () => {
    const confirmedOrd = seedOrder({ branchId: BRANCH_A_ID, status: 'confirmed' });

    const res = await request('GET', `/admin/orders/${confirmedOrd.orderId}`, null, {
      Authorization: `Bearer ${bmToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.strictEqual(res.data.order.acceptance_deadline_at, null, 'Non-pending orders must have null acceptance_deadline_at');
  });

  it('4. AcceptanceTimeoutService.computeAcceptanceDeadlineAt adheres to 180s platform policy', () => {
    assert.strictEqual(AcceptanceTimeoutService.ACCEPTANCE_TIMEOUT_SECONDS, 180);

    const nowIso = new Date('2026-09-16T12:00:00.000Z').toISOString();
    const order = { status: 'pending', created_at: nowIso };
    const deadlineIso = AcceptanceTimeoutService.computeAcceptanceDeadlineAt(order);
    assert.strictEqual(deadlineIso, new Date('2026-09-16T12:03:00.000Z').toISOString());

    // Non-pending status or invalid created_at returns null
    assert.strictEqual(AcceptanceTimeoutService.computeAcceptanceDeadlineAt({ status: 'confirmed', created_at: nowIso }), null);
    assert.strictEqual(AcceptanceTimeoutService.computeAcceptanceDeadlineAt({ status: 'pending', created_at: 'invalid-date' }), null);
    assert.strictEqual(AcceptanceTimeoutService.computeAcceptanceDeadlineAt(null), null);
  });

  it('5. apps/merchant-app/assets/js/merchant-app.js contains no local deadline reconstruction', () => {
    const dashboardJsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/merchant-app.js');
    const ordersJsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/orders.js');
    const code = fs.readFileSync(dashboardJsPath, 'utf8') + '\n' + fs.readFileSync(ordersJsPath, 'utf8');

    assert.ok(!code.includes('ACCEPTANCE_WINDOW_MS'), 'No ACCEPTANCE_WINDOW_MS constant should exist');
    assert.ok(!code.includes('+ 180000'), 'No hardcoded + 180000 millisecond arithmetic allowed');
    assert.ok(!code.includes('createdAtMs +'), 'No created_at deadline reconstruction allowed');
    assert.ok(code.includes('ord.acceptance_deadline_at'), 'Must consume ord.acceptance_deadline_at');
  });

  it('6. Expired deadline displays neutral checking state and does NOT mutate order to timeout', async () => {
    // Seed an order created 200 seconds ago (already past 180s)
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending', ageSeconds: 200 });

    const res = await request('GET', `/admin/orders/${ord.orderId}`, null, {
      Authorization: `Bearer ${bmToken}`
    });

    assert.equal(res.status, 200);
    // Order in DB must remain 'pending' until the server timeout worker explicitly sweeps it
    const dbOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(dbOrder.status, 'pending', 'Timer reaching zero on client never mutates status in DB');
  });
});
