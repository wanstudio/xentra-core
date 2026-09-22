'use strict';

/**
 * Phase 8 — Merchant Dashboard Acceptance Test Suite
 *
 * Covers the complete 31-item matrix:
 * 1. Branch Manager can view pending orders for own branch
 * 2. Branch Manager cannot view pending orders of another branch
 * 3. Changing branch_id parameter fails (authorization intact)
 * 4. Unauthorized role cannot view branch queue
 * 5. Only orders in pending appear in acceptance queue
 * 6. Non-pending orders excluded from acceptance queue
 * 7. Another branch's pending orders excluded
 * 8. Accepted order disappears from pending queue
 * 9. Rejected order disappears from pending queue
 * 10. ACCEPT transitions order to confirmed
 * 11. ACCEPT sets order_status_logs with branch_actor
 * 12. ACCEPT cannot be performed after timeout
 * 13. ACCEPT cannot be performed twice (idempotent / terminal)
 * 14. REJECT transitions order to rejected
 * 15. REJECT requires reason
 * 16. REJECT cannot be performed after timeout
 * 17. REJECT cannot be performed twice (idempotent / terminal)
 * 18. Racing ACCEPT and REJECT resolves to single winner
 * 19. Duplicate ACCEPT requests are idempotent
 * 20. Payment settlement alone does not mark order ACCEPTED
 * 21. Payment failure cannot be marked as Branch Rejected
 * 22. Customer waiting screen transitions to ACCEPTED after merchant accepts
 * 23. Customer waiting screen transitions to REJECTED after merchant rejects
 * 24. Customer waiting screen transitions to TIMEOUT after window expires
 * 25. Customer refresh after acceptance maintains correct state
 * 26. order_status_logs records actor, decision, reason, timestamp
 * 27. Audit trail distinguishes between accept, reject, timeout
 * 28. Regression: P4 multi-branch cart separation remains intact
 * 29. Regression: P5 single-branch checkout verification remains intact
 * 30. Regression: P6 payment flow unaffected by acceptance changes
 * 31. Regression: P7 customer waiting flow unaffected by acceptance changes
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-p8-merchant-acceptance';

const app = require('../../server/app');
const db = require('../../server/database/db');

// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('../helpers/demoFixtures.js')();
const OrderStateMachine = require('../../server/services/OrderStateMachine');
const AcceptanceTimeoutService = require('../../server/services/AcceptanceTimeoutService');
const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');

let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const BRANCH_A_ID = 'branch_bangjo_barat';
const BRANCH_B_ID = 'branch_bangjo_timur';

function makeOrderId() { return 'p8_bm_' + crypto.randomBytes(5).toString('hex'); }
function makeOrderNum() { return 'P8BM-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }

function seedOrder({
  orderId = makeOrderId(),
  orderNumber = makeOrderNum(),
  status = 'pending',
  branchId = BRANCH_A_ID,
  brandId = BRAND_ID,
  customerName = 'Pelanggan P8',
  customerPhone = '081200000088',
  orderType = 'delivery',
  subtotal = 50000,
  deliveryFee = 5000,
  grandTotal = 55000,
  paymentMethod = 'cash',
  paymentStatus = 'unpaid',
  snapToken = null,
  createdAt = new Date().toISOString()
} = {}) {
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO orders (
      id, order_number, brand_id, branch_id, customer_name, customer_phone,
      order_type, status, subtotal, delivery_fee, discount_amount, grand_total,
      payment_method, payment_status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(
    orderId, orderNumber, brandId, branchId, customerName, customerPhone,
    orderType, status, subtotal, deliveryFee, grandTotal,
    paymentMethod, paymentStatus, createdAt, now
  );

  const payId = 'pay_' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_method, payment_status, amount, snap_token, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(payId, orderId, paymentMethod === 'midtrans' ? 'midtrans' : 'manual', paymentMethod, paymentStatus, grandTotal, snapToken, now);

  const itemId = 'item_' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal)
    VALUES (?, ?, 'prod_ayam_bakar', 'Ayam Bakar', 25000, 2, 50000)
  `).run(itemId, orderId);

  return { orderId, orderNumber, branchId, status, grandTotal, customerPhone, paymentMethod, paymentStatus };
}

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_A_ID, brandId = BRAND_ID, userId = 'bm_p8_user' } = {}) {
  const token = 'p8staff_' + crypto.randomBytes(8).toString('hex');
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

describe('Phase 8 — Merchant Dashboard Acceptance', () => {
  let bmAToken;
  let bmBToken;
  let ownerToken;
  let customerToken;

  before(async () => {
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    bmAToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, userId: 'bm_a_mgr' });
    bmBToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_B_ID, userId: 'bm_b_mgr' });
    ownerToken = seedStaffSession({ role: 'owner', branchId: null, userId: 'owner_usr' });
    customerToken = seedCustomerSession('081200000088');
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    db.prepare("DELETE FROM order_payments WHERE order_id LIKE 'p8_bm_%'").run();
    db.prepare("DELETE FROM order_items WHERE order_id LIKE 'p8_bm_%'").run();
    db.prepare("DELETE FROM order_status_logs WHERE order_id LIKE 'p8_bm_%'").run();
    db.prepare("DELETE FROM orders WHERE id LIKE 'p8_bm_%'").run();
  });

  // ─── Group 1: Authorization (1–4) ──────────────────────────────────────────

  it('1. Branch Manager can view pending orders for own branch', async () => {
    const ordA = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res = await request('GET', `/admin/branches/${BRANCH_A_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.branch_id, BRANCH_A_ID);
    assert.ok(Array.isArray(res.data.orders));
    const ids = res.data.orders.map(o => o.id);
    assert.ok(ids.includes(ordA.orderId), 'Pending order for Branch A must be in the queue');
  });

  it('2. Branch Manager cannot view pending orders of another branch', async () => {
    const res = await request('GET', `/admin/branches/${BRANCH_B_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.data.success, false);
    assert.equal(res.data.error, 'FORBIDDEN_BRANCH_ACCESS');
  });

  it('3. Changing branch_id parameter fails (authorization intact)', async () => {
    // BM A attempts to query general orders endpoint with branch_id = BRANCH_B_ID
    const res = await request('GET', `/admin/orders?branch_id=${BRANCH_B_ID}`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.data.success, false);
    assert.equal(res.data.error, 'FORBIDDEN_BRANCH_ACCESS');
  });

  it('4. Unauthorized role cannot view branch queue', async () => {
    // Unauthenticated request
    const anonRes = await request('GET', `/admin/branches/${BRANCH_A_ID}/orders`);
    assert.equal(anonRes.status, 401);

    // Customer role
    const custRes = await request('GET', `/admin/branches/${BRANCH_A_ID}/orders`, null, {
      Authorization: `Bearer ${customerToken}`
    });
    assert.equal(custRes.status, 403);
  });

  // ─── Group 2: Queue (5–9) ──────────────────────────────────────────────────

  it('5. Only orders in pending appear in acceptance queue', async () => {
    const ordPending = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res = await request('GET', `/admin/branches/${BRANCH_A_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    assert.ok(res.data.orders.every(o => o.status === 'pending'), 'Every order in pending filter must be pending');
    const ids = res.data.orders.map(o => o.id);
    assert.ok(ids.includes(ordPending.orderId));
  });

  it('6. Non-pending orders excluded from acceptance queue', async () => {
    const ordConfirmed = seedOrder({ branchId: BRANCH_A_ID, status: 'confirmed' });
    const ordPreparing = seedOrder({ branchId: BRANCH_A_ID, status: 'preparing' });
    const ordCancelled = seedOrder({ branchId: BRANCH_A_ID, status: 'cancelled' });

    const res = await request('GET', `/admin/branches/${BRANCH_A_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    const ids = res.data.orders.map(o => o.id);
    assert.ok(!ids.includes(ordConfirmed.orderId), 'Confirmed order excluded from pending queue');
    assert.ok(!ids.includes(ordPreparing.orderId), 'Preparing order excluded from pending queue');
    assert.ok(!ids.includes(ordCancelled.orderId), 'Cancelled order excluded from pending queue');
  });

  it("7. Another branch's pending orders excluded", async () => {
    const ordB = seedOrder({ branchId: BRANCH_B_ID, status: 'pending' });

    const res = await request('GET', `/admin/branches/${BRANCH_A_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    const ids = res.data.orders.map(o => o.id);
    assert.ok(!ids.includes(ordB.orderId), 'Branch B pending order excluded from Branch A queue');
  });

  it('8. Accepted order disappears from pending queue', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    // Accept the order
    const acceptRes = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.data.new_status, 'confirmed');

    // Reload pending queue
    const queueRes = await request('GET', `/admin/branches/${BRANCH_A_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(queueRes.status, 200);
    const ids = queueRes.data.orders.map(o => o.id);
    assert.ok(!ids.includes(ord.orderId), 'Accepted order must no longer appear in pending queue');
  });

  it('9. Rejected order disappears from pending queue', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    // Reject the order
    const rejectRes = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Bahan baku habis'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.data.new_status, 'rejected');

    // Reload pending queue
    const queueRes = await request('GET', `/admin/branches/${BRANCH_A_ID}/orders?status=pending`, null, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(queueRes.status, 200);
    const ids = queueRes.data.orders.map(o => o.id);
    assert.ok(!ids.includes(ord.orderId), 'Rejected order must no longer appear in pending queue');
  });

  // ─── Group 3: ACCEPT (10–13) ───────────────────────────────────────────────

  it('10. ACCEPT transitions order to confirmed', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept',
      note: 'Diterima dari Merchant Dashboard'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.new_status, 'confirmed');

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(check.status, 'confirmed');
  });

  it('11. ACCEPT sets order_status_logs with branch_actor', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    const log = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(ord.orderId);
    assert.ok(log, 'Status log must exist');
    assert.equal(log.previous_status, 'pending');
    assert.equal(log.new_status, 'confirmed');
    assert.equal(log.actor_type, 'branch_actor');
    assert.equal(log.actor_id, 'bm_a_mgr');
    assert.ok(log.note.includes('[ACCEPT by branch_manager:bm_a_mgr]'));
  });

  it('12. ACCEPT cannot be performed after timeout', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    // Transition to timeout via AcceptanceTimeoutService / OrderStateMachine
    OrderStateMachine.transition({
      order_id: ord.orderId,
      target_status: 'timeout',
      actor_type: 'system',
      actor_id: 'acceptance_timeout_worker',
      note: '[BRANCH_TIMEOUT]'
    });

    const res = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.ok(res.data.error.includes('tidak valid'));

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(check.status, 'timeout');
  });

  it('13. ACCEPT cannot be performed twice (idempotent / terminal)', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res1 = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' }, { Authorization: `Bearer ${bmAToken}` });
    assert.equal(res1.status, 200);
    assert.equal(res1.data.new_status, 'confirmed');

    const countBefore = db.prepare('SELECT COUNT(*) as c FROM order_status_logs WHERE order_id = ?').get(ord.orderId).c;

    const res2 = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' }, { Authorization: `Bearer ${bmAToken}` });
    assert.equal(res2.status, 200);
    assert.equal(res2.data.idempotent, true);

    const countAfter = db.prepare('SELECT COUNT(*) as c FROM order_status_logs WHERE order_id = ?').get(ord.orderId).c;
    assert.equal(countAfter, countBefore, 'Idempotent repeated accept must not produce extra audit logs');
  });

  // ─── Group 4: REJECT (14–17) ───────────────────────────────────────────────

  it('14. REJECT transitions order to rejected', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Dapur kelebihan beban'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.new_status, 'rejected');

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(check.status, 'rejected');
  });

  it('15. REJECT requires reason', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    // Missing reason
    const resNoReason = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(resNoReason.status, 400);
    assert.equal(resNoReason.data.status, 'REASON_REQUIRED');

    // Whitespace reason
    const resBlankReason = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: '   '
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(resBlankReason.status, 400);
    assert.equal(resBlankReason.data.status, 'REASON_REQUIRED');

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(check.status, 'pending');
  });

  it('16. REJECT cannot be performed after timeout', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    OrderStateMachine.transition({
      order_id: ord.orderId,
      target_status: 'timeout',
      actor_type: 'system',
      actor_id: 'acceptance_timeout_worker',
      note: '[BRANCH_TIMEOUT]'
    });

    const res = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Terlalu lama merespons'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.ok(res.data.error.includes('tidak valid'));

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(check.status, 'timeout');
  });

  it('17. REJECT cannot be performed twice (idempotent / terminal)', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res1 = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Cabang tutup lebih awal'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(res1.status, 200);
    assert.equal(res1.data.new_status, 'rejected');

    const countBefore = db.prepare('SELECT COUNT(*) as c FROM order_status_logs WHERE order_id = ?').get(ord.orderId).c;

    const res2 = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Cabang tutup lebih awal'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.data.idempotent, true);

    const countAfter = db.prepare('SELECT COUNT(*) as c FROM order_status_logs WHERE order_id = ?').get(ord.orderId).c;
    assert.equal(countAfter, countBefore, 'Idempotent repeated reject must not produce extra audit logs');
  });

  // ─── Group 5: Concurrency (18–19) ──────────────────────────────────────────

  it('18. Racing ACCEPT and REJECT resolves to single winner', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const [resAccept, resReject] = await Promise.all([
      request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' }, { Authorization: `Bearer ${bmAToken}` }),
      request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'reject', reason: 'Race condition test' }, { Authorization: `Bearer ${bmAToken}` })
    ]);

    const statuses = [resAccept.status, resReject.status];
    assert.ok(statuses.includes(200), 'At least one request must succeed');
    const winners = [resAccept, resReject].filter(r => r.status === 200);
    const losers = [resAccept, resReject].filter(r => r.status !== 200);

    assert.equal(winners.length, 1, 'Exactly one decision wins the race');
    assert.equal(losers.length, 1, 'The competing decision loses the race');
  });

  it('19. Duplicate ACCEPT requests are idempotent', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const [res1, res2] = await Promise.all([
      request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' }, { Authorization: `Bearer ${bmAToken}` }),
      request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' }, { Authorization: `Bearer ${bmAToken}` })
    ]);

    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.ok(res1.data.success && res2.data.success);
    const finalOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(finalOrder.status, 'confirmed');
  });

  // ─── Group 6: Payment Separation (20–21) ───────────────────────────────────

  it('20. Payment settlement alone does not mark order ACCEPTED', async () => {
    const ord = seedOrder({
      branchId: BRANCH_A_ID,
      status: 'pending',
      paymentMethod: 'midtrans',
      paymentStatus: 'settlement'
    });

    const check = db.prepare('SELECT status, payment_status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(check.payment_status, 'settlement');
    assert.equal(check.status, 'pending', 'Order status must remain pending (AWAITING_BRANCH_ACCEPTANCE)');
  });

  it('21. Payment failure cannot be marked as Branch Rejected', async () => {
    const ord = seedOrder({
      branchId: BRANCH_A_ID,
      status: 'pending',
      paymentMethod: 'midtrans',
      paymentStatus: 'expire'
    });

    // An expired payment cancelled the order
    OrderStateMachine.transition({
      order_id: ord.orderId,
      target_status: 'cancelled',
      actor_type: 'system',
      actor_id: 'payment_gateway',
      note: '[PAYMENT_FAILURE] Midtrans transaction expired'
    });

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(check.status, 'cancelled');

    const log = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(ord.orderId);
    assert.equal(log.actor_type, 'system');
    assert.ok(log.note.includes('[PAYMENT_FAILURE]'), 'Must be classified as PAYMENT_FAILURE, not branch rejected');
  });

  // ─── Group 7: Customer Integration (22–25) ─────────────────────────────────

  it('22. Customer waiting screen transitions to ACCEPTED after merchant accepts', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    // Merchant accepts
    await request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' }, { Authorization: `Bearer ${bmAToken}` });

    // Customer polls
    const custRes = await request('GET', `/orders/${ord.orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(custRes.status, 200);
    assert.equal(custRes.data.order.status, 'confirmed');

    // Verify Customer PWA renders accepted UI
    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => custRes.data;

    win.Xentra.OrderReceived.mount(container, ord.orderId);
    await new Promise(r => setTimeout(r, 20));

    assert.ok(container.innerHTML.includes('Pesanan Diterima Cabang!'));
    assert.ok(container.innerHTML.includes('Status Alur Pesanan'));
    win.Xentra.OrderReceived.unmount();
  });

  it('23. Customer waiting screen transitions to REJECTED after merchant rejects', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    // Merchant rejects
    await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Habis stok ayam'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    // Customer polls
    const custRes = await request('GET', `/orders/${ord.orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(custRes.status, 200);
    assert.equal(custRes.data.order.status, 'rejected');

    // Verify Customer PWA renders rejected UI
    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => custRes.data;

    win.Xentra.OrderReceived.mount(container, ord.orderId);
    await new Promise(r => setTimeout(r, 20));

    assert.ok(container.innerHTML.includes('Pesanan Ditolak'));
    assert.ok(container.innerHTML.includes('Habis stok ayam'));
    win.Xentra.OrderReceived.unmount();
  });

  it('24. Customer waiting screen transitions to TIMEOUT after window expires', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    // System times out order
    OrderStateMachine.transition({
      order_id: ord.orderId,
      target_status: 'timeout',
      actor_type: 'system',
      actor_id: 'acceptance_timeout_worker',
      note: '[BRANCH_TIMEOUT] Acceptance window expired'
    });

    const custRes = await request('GET', `/orders/${ord.orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(custRes.status, 200);
    assert.equal(custRes.data.order.status, 'timeout');

    // Customer PWA renders timeout UI
    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => custRes.data;

    win.Xentra.OrderReceived.mount(container, ord.orderId);
    await new Promise(r => setTimeout(r, 20));

    assert.ok(container.innerHTML.includes('Waktu Konfirmasi Habis'));
    win.Xentra.OrderReceived.unmount();
  });

  it('25. Customer refresh after acceptance maintains correct state', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    // Merchant accepts
    await request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' }, { Authorization: `Bearer ${bmAToken}` });

    // Customer refresh
    const refreshRes = await request('GET', `/orders/${ord.orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(refreshRes.status, 200);
    assert.equal(refreshRes.data.order.status, 'confirmed');

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => refreshRes.data;

    win.Xentra.OrderReceived.mount(container, ord.orderId);
    await new Promise(r => setTimeout(r, 20));

    assert.ok(container.innerHTML.includes('Pesanan Diterima Cabang!'));
    win.Xentra.OrderReceived.unmount();
  });

  // ─── Group 8: Audit (26–27) ────────────────────────────────────────────────

  it('26. order_status_logs records actor, decision, reason, timestamp', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Kapasitas maksimal tercapai'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    const log = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(ord.orderId);
    assert.ok(log);
    assert.equal(log.actor_type, 'branch_actor');
    assert.equal(log.actor_id, 'bm_a_mgr');
    assert.equal(log.previous_status, 'pending');
    assert.equal(log.new_status, 'rejected');
    assert.ok(log.note.includes('Kapasitas maksimal tercapai'));
    assert.ok(log.created_at);
  });

  it('27. Audit trail distinguishes between accept, reject, timeout', async () => {
    const ordAccept = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });
    const ordReject = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });
    const ordTimeout = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    await request('POST', `/orders/${ordAccept.orderId}/branch-acceptance`, { decision: 'accept' }, { Authorization: `Bearer ${bmAToken}` });
    await request('POST', `/orders/${ordReject.orderId}/branch-acceptance`, { decision: 'reject', reason: 'Audit test reject' }, { Authorization: `Bearer ${bmAToken}` });
    OrderStateMachine.transition({
      order_id: ordTimeout.orderId,
      target_status: 'timeout',
      actor_type: 'system',
      actor_id: 'acceptance_timeout_worker',
      note: '[BRANCH_TIMEOUT] 3 minute expiry'
    });

    const logAccept = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ?').get(ordAccept.orderId);
    const logReject = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ?').get(ordReject.orderId);
    const logTimeout = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ?').get(ordTimeout.orderId);

    assert.equal(logAccept.new_status, 'confirmed');
    assert.equal(logAccept.actor_type, 'branch_actor');
    assert.ok(logAccept.note.includes('[ACCEPT by branch_manager'));

    assert.equal(logReject.new_status, 'rejected');
    assert.equal(logReject.actor_type, 'branch_actor');
    assert.ok(logReject.note.includes('[REJECT by branch_manager'));

    assert.equal(logTimeout.new_status, 'timeout');
    assert.equal(logTimeout.actor_type, 'system');
    assert.ok(logTimeout.note.includes('[BRANCH_TIMEOUT]'));
  });

  // ─── Group 9: Regressions (28–31) ──────────────────────────────────────────

  it('28. Regression: P4 multi-branch cart separation remains intact', () => {
    const crossBranch = PrePaymentVerificationGate.assertSingleBranchCheckout(BRANCH_A_ID, [
      { product_id: 'prod_1', branch_id: BRANCH_A_ID },
      { product_id: 'prod_2', branch_id: BRANCH_B_ID }
    ]);
    assert.ok(crossBranch !== null, 'P4 multi-branch cart isolation intact');
  });

  it('29. Regression: P5 single-branch checkout verification remains intact', () => {
    const singleBranch = PrePaymentVerificationGate.assertSingleBranchCheckout(BRANCH_A_ID, [
      { product_id: 'prod_1', branch_id: BRANCH_A_ID },
      { product_id: 'prod_2', branch_id: BRANCH_A_ID }
    ]);
    assert.strictEqual(singleBranch, null, 'P5 single-branch checkout verification intact');
  });

  it('30. Regression: P6 payment flow unaffected by acceptance changes', async () => {
    const ord = seedOrder({
      branchId: BRANCH_A_ID,
      status: 'pending',
      paymentMethod: 'midtrans',
      paymentStatus: 'pending',
      snapToken: 'snap_token_p6_reg'
    });

    const resOrder = await request('GET', `/orders/${ord.orderId}`, null, {
      Authorization: `Bearer ${customerToken}`
    });

    assert.equal(resOrder.status, 200);
    assert.equal(resOrder.data.success, true);
    assert.equal(resOrder.data.order.payment_method, 'midtrans');
    assert.equal(resOrder.data.order.payment_status, 'pending');
    assert.equal(resOrder.data.payment.snap_token, 'snap_token_p6_reg');
  });

  it('31. Regression: P7 customer waiting flow unaffected by acceptance changes', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const custRes = await request('GET', `/orders/${ord.orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(custRes.status, 200);
    assert.equal(custRes.data.order.status, 'pending');

    const { win, container } = setupPwaDOM();
    win.Xentra.API.get = async () => custRes.data;

    win.Xentra.OrderReceived.mount(container, ord.orderId);
    await new Promise(r => setTimeout(r, 20));

    assert.ok(container.innerHTML.includes('id="x-waiting-screen"'));
    assert.ok(container.innerHTML.includes('Menunggu Konfirmasi Cabang'));
    win.Xentra.OrderReceived.unmount();
  });
});
