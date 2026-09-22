'use strict';

/**
 * Phase 7 — Branch Acceptance Waiting: Server-side tests
 *
 * Tests cover:
 * - P7-01 to P7-18: server authority, state lifecycle, security boundary
 *
 * Authority rule: Core/server is authoritative for all order state.
 * Customer PWA only displays, polls, and navigates.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-p7-branch-acceptance';

const app = require('../../server/app');
const db = require('../../server/database/db');

// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('../helpers/demoFixtures.js')();
let server;
let baseUrl;

// ─── Test data ────────────────────────────────────────────────────────────────
const BRAND_ID = 'brand_bangjo';
const BRANCH_ID = 'branch_bangjo_barat';
const BRANCH2_ID = 'branch_bangjo_timur';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOrderId() { return 'p7_ord_' + crypto.randomBytes(5).toString('hex'); }
function makeOrderNum() { return 'P7-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }

/** Create a minimal test order in the DB, status defaults to 'pending' */
function seedOrder({ orderId, status = 'pending', branchId = BRANCH_ID, phone = '081200000071', createdAt } = {}) {
  orderId = orderId || makeOrderId();
  const num = makeOrderNum();
  const now = createdAt || new Date().toISOString();
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total, payment_method, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'P7 Tester', ?, 'delivery', ?, 50000, 50000, 'cash', ?, ?)
  `).run(orderId, num, BRAND_ID, branchId, phone, status, now, now);
  return { orderId, num, phone, branchId };
}

/** Create a customer session token in the store for the given phone */
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

/** Create a branch manager session */
function seedBMSession(branchId, brandId = BRAND_ID) {
  const token = 'p7bm_' + crypto.randomBytes(8).toString('hex');
  const store = global.TokenSessionStore;
  const sess = {
    type: 'staff',
    role: 'branch_manager',
    brandId,
    brand_id: brandId,
    branchId,
    branch_id: branchId,
    userId: 'bm_p7_test',
    username: 'bm_p7',
    email_verified: true,
    expiresAt: Date.now() + 86400 * 1000
  };
  if (store && store.sessions) {
    store.sessions.set(token, sess);
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

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Phase 7 — Branch Acceptance Waiting', () => {
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
    db.prepare("DELETE FROM order_payments WHERE order_id LIKE 'p7_ord_%'").run();
    db.prepare("DELETE FROM order_status_logs WHERE order_id LIKE 'p7_ord_%'").run();
    db.prepare("DELETE FROM order_deliveries WHERE order_id LIKE 'p7_ord_%'").run();
    db.prepare("DELETE FROM order_items WHERE order_id LIKE 'p7_ord_%'").run();
    db.prepare("DELETE FROM orders WHERE id LIKE 'p7_ord_%'").run();
  });

  // ── P7-01: AWAITING_BRANCH_ACCEPTANCE — server returns pending ──────────────
  it('P7-01: Order in pending status → server returns pending with branch_name and acceptance_deadline_at', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const token = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });

    assert.equal(res.status, 200, 'GET /orders/:id must return 200');
    assert.equal(res.data.success, true);
    assert.equal(res.data.order.status, 'pending', 'Status must be pending (AWAITING_BRANCH_ACCEPTANCE)');
    assert.ok(res.data.order.branch_name, 'branch_name must be present for waiting surface');
    assert.ok(res.data.order.acceptance_deadline_at, 'acceptance_deadline_at must be server-provided');

    // Deadline must be ~3 min from now
    const deadline = new Date(res.data.order.acceptance_deadline_at).getTime();
    const now = Date.now();
    assert.ok(deadline > now, 'deadline must be in the future for a fresh order');
    assert.ok(deadline - now <= 180 * 1000 + 2000, 'deadline must be within 3 min + buffer');
  });

  // ── P7-02: Server ACCEPTED → confirmed ─────────────────────────────────────
  it('P7-02: Branch accepts order → status becomes confirmed (ACCEPTED)', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const customerToken = seedCustomerSession(phone);
    const bmToken = seedBMSession(BRANCH_ID);

    // Branch manager accepts
    const acceptRes = await request('POST', `/api/v1/orders/${orderId}/branch-acceptance`,
      { decision: 'accept' },
      { Authorization: `Bearer ${bmToken}` });
    assert.equal(acceptRes.status, 200, 'branch-acceptance accept must return 200');
    assert.equal(acceptRes.data.success, true);

    // Customer polls → gets confirmed
    const pollRes = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(pollRes.status, 200);
    assert.equal(pollRes.data.order.status, 'confirmed', 'After acceptance: server must return confirmed');
    assert.equal(pollRes.data.order.acceptance_deadline_at, null, 'deadline is null when no longer pending');
  });

  // ── P7-03: Server REJECTED ─────────────────────────────────────────────────
  it('P7-03: Branch rejects order → status becomes rejected (REJECTED)', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const customerToken = seedCustomerSession(phone);
    const bmToken = seedBMSession(BRANCH_ID);

    const rejectRes = await request('POST', `/api/v1/orders/${orderId}/branch-acceptance`,
      { decision: 'reject', reason: 'Stok bahan utama habis.' },
      { Authorization: `Bearer ${bmToken}` });
    assert.equal(rejectRes.status, 200);

    const pollRes = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(pollRes.status, 200);
    assert.equal(pollRes.data.order.status, 'rejected');
    assert.equal(pollRes.data.order.acceptance_deadline_at, null);
    // Rejection reason is in audit logs
    const log = (pollRes.data.logs || []).find(l => l.new_status === 'rejected');
    assert.ok(log, 'Rejection must be logged');
    assert.ok(log.note && log.note.includes('Stok'), 'Rejection reason must appear in log note');
  });

  // ── P7-04: Server TIMEOUT ──────────────────────────────────────────────────
  it('P7-04: Order in timeout state → server returns timeout (TIMEOUT)', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const customerToken = seedCustomerSession(phone);

    // Simulate server setting timeout (timeout-worker action via OrderStateMachine)
    const OrderStateMachine = require('../../server/services/OrderStateMachine');
    OrderStateMachine.transition({
      order_id: orderId,
      target_status: 'timeout',
      actor_type: 'system',
      actor_id: 'timeout_worker',
      note: '[BRANCH_TIMEOUT] No response within 3 minutes'
    });

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(res.status, 200);
    assert.equal(res.data.order.status, 'timeout');
    assert.equal(res.data.order.acceptance_deadline_at, null);
  });

  // ── P7-05: Client timer ≠ state mutation ──────────────────────────────────
  it('P7-05: acceptance_deadline_at is a display timestamp only — server status unchanged when deadline passes without action', async () => {
    // Create order with a deadline ALREADY in the past (old created_at)
    const pastCreatedAt = new Date(Date.now() - 200 * 1000).toISOString(); // 200s ago
    const { orderId, phone } = seedOrder({ status: 'pending', createdAt: pastCreatedAt });
    const customerToken = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(res.status, 200);
    // Server may show past deadline in acceptance_deadline_at but order status is still
    // whatever the server set it to — the client countdown hitting zero has NO effect
    assert.equal(res.data.order.status, 'pending',
      'Server status is still pending — client countdown reaching zero never mutates state');
    // Deadline will be in the past, but that is fine — client fetches server state at zero
    const deadline = new Date(res.data.order.acceptance_deadline_at).getTime();
    assert.ok(deadline < Date.now(), 'Deadline is in the past for old order (server-computed, display only)');
  });

  // ── P7-06: Refresh while awaiting → recovery from server ──────────────────
  it('P7-06: Refresh while awaiting → GET /orders/:id returns authoritative pending state', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const token = seedCustomerSession(phone);

    // Simulate "refresh": call GET /orders/:id cold (no local state)
    const res1 = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res1.status, 200);
    assert.equal(res1.data.order.status, 'pending');

    // Second call (simulates another refresh) still returns same authoritative state
    const res2 = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res2.status, 200);
    assert.equal(res2.data.order.status, 'pending');
    assert.ok(res2.data.order.acceptance_deadline_at);
  });

  // ── P7-07: Re-entry after browser close → recovery ────────────────────────
  it('P7-07: Re-entry after close → GET /orders/:id still returns authoritative state', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const token = seedCustomerSession(phone);
    // Simulate new session (re-entry): same token, fresh GET call
    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.order.status, 'pending');
    assert.ok(res.data.order.branch_name, 'branch context available for waiting screen re-render');
  });

  // ── P7-08: Refresh after ACCEPTED ─────────────────────────────────────────
  it('P7-08: Refresh after accepted → status remains confirmed', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const customerToken = seedCustomerSession(phone);
    const bmToken = seedBMSession(BRANCH_ID);

    await request('POST', `/api/v1/orders/${orderId}/branch-acceptance`,
      { decision: 'accept' }, { Authorization: `Bearer ${bmToken}` });

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(res.status, 200);
    assert.equal(res.data.order.status, 'confirmed');

    // Refresh again
    const res2 = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(res2.data.order.status, 'confirmed', 'ACCEPTED is stable — refresh does not regress');
  });

  // ── P7-09: Refresh after REJECTED ─────────────────────────────────────────
  it('P7-09: Refresh after rejected → status remains rejected', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const customerToken = seedCustomerSession(phone);
    const bmToken = seedBMSession(BRANCH_ID);

    await request('POST', `/api/v1/orders/${orderId}/branch-acceptance`,
      { decision: 'reject', reason: 'Tutup mendadak.' }, { Authorization: `Bearer ${bmToken}` });

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(res.data.order.status, 'rejected');

    const res2 = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(res2.data.order.status, 'rejected', 'REJECTED is terminal — refresh does not change it');
  });

  // ── P7-10: Refresh after TIMEOUT ──────────────────────────────────────────
  it('P7-10: Refresh after timeout → status remains timeout', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const customerToken = seedCustomerSession(phone);
    const OrderStateMachine = require('../../server/services/OrderStateMachine');

    OrderStateMachine.transition({
      order_id: orderId, target_status: 'timeout',
      actor_type: 'system', actor_id: 'timeout_worker', note: '[BRANCH_TIMEOUT]'
    });

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(res.data.order.status, 'timeout');

    const res2 = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(res2.data.order.status, 'timeout', 'TIMEOUT is terminal — stable across refreshes');
  });

  // ── P7-11: Payment success ≠ acceptance ────────────────────────────────────
  it('P7-11: Payment success does not auto-accept order — branch acceptance is required', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const customerToken = seedCustomerSession(phone);

    // Simulate payment settlement (update payment record)
    db.prepare(`INSERT OR IGNORE INTO order_payments (id, order_id, provider, payment_status, amount)
                VALUES (?, ?, 'midtrans', 'settlement', 50000)`)
      .run('pay_p7_' + crypto.randomBytes(4).toString('hex'), orderId);

    // Order must still be pending — payment success alone does NOT accept
    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(res.status, 200);
    assert.equal(res.data.order.status, 'pending',
      'P7-11: Payment settlement alone does not transition order to accepted');
  });

  // ── P7-12: Customer cannot determine acceptance via request body ───────────
  it('P7-12: Customer cannot force acceptance by sending decision=accept to branch-acceptance endpoint', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const customerToken = seedCustomerSession(phone);

    // Customer tries to call branch-acceptance endpoint
    const res = await request('POST', `/api/v1/orders/${orderId}/branch-acceptance`,
      { decision: 'accept' },
      { Authorization: `Bearer ${customerToken}` });

    // Must be rejected — customer is not in the allowed roles
    assert.ok(res.status === 401 || res.status === 403,
      `P7-12: Customer must not be able to call branch-acceptance. Got ${res.status}`);

    // Order must still be pending
    const check = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(check.data.order.status, 'pending', 'Order must remain pending after unauthorized attempt');
  });

  // ── P7-13: Stale polling response — server is authoritative ───────────────
  it('P7-13: Two sequential fetches return consistent authoritative state (server wins)', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const token = seedCustomerSession(phone);

    const [res1, res2] = await Promise.all([
      request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` }),
      request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${token}` })
    ]);

    // Both must return the same authoritative status
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.equal(res1.data.order.status, res2.data.order.status,
      'P7-13: Concurrent fetches must return consistent server state');
  });

  // ── P7-14: Polling stops on terminal state ─────────────────────────────────
  // This is a client-side behavior enforced in order-received.js; tested here
  // by verifying that terminal states are indeed final (no further transitions
  // possible via branch-acceptance).
  it('P7-14: Confirmed order cannot be re-accepted or re-rejected via branch-acceptance (terminal guard)', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending' });
    const bmToken = seedBMSession(BRANCH_ID);

    await request('POST', `/api/v1/orders/${orderId}/branch-acceptance`,
      { decision: 'accept' }, { Authorization: `Bearer ${bmToken}` });

    // Try to reject a confirmed order — must fail
    const rejectRes = await request('POST', `/api/v1/orders/${orderId}/branch-acceptance`,
      { decision: 'reject', reason: 'Attempting to re-reject.' },
      { Authorization: `Bearer ${bmToken}` });
    assert.ok(rejectRes.status === 400 || rejectRes.data.success === false,
      'P7-14: Cannot reject an already confirmed order');
  });

  // ── P7-15: No automatic cross-branch rematch after rejection ───────────────
  it('P7-15: Rejection does not auto-rematch to another branch', async () => {
    const { orderId, phone } = seedOrder({ status: 'pending', branchId: BRANCH_ID });
    const customerToken = seedCustomerSession(phone);
    const bmToken = seedBMSession(BRANCH_ID);

    await request('POST', `/api/v1/orders/${orderId}/branch-acceptance`,
      { decision: 'reject', reason: 'Bahan habis.' }, { Authorization: `Bearer ${bmToken}` });

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(res.data.order.status, 'rejected', 'After rejection: no automatic rematch');
    assert.equal(res.data.order.branch_id, BRANCH_ID, 'branch_id must remain original — no auto-reassignment');
  });

  // ── P7-16: Invalid/missing order fails safely ──────────────────────────────
  it('P7-16: Fetching non-existent order returns 403 or 404 (not 500)', async () => {
    const token = seedCustomerSession('081299999999');
    const res = await request('GET', '/api/v1/orders/nonexistent_p7_order_xyz', null, {
      Authorization: `Bearer ${token}`
    });
    assert.ok(res.status === 403 || res.status === 404,
      `P7-16: Non-existent order must return 403/404, got ${res.status}`);
    assert.equal(res.data.success, false);
  });

  // ── P7-17: Unauthorized customer cannot access another customer's order ────
  it('P7-17: Customer cannot access another customer\'s order (IDOR guard)', async () => {
    const { orderId } = seedOrder({ phone: '081200000081' });
    // Different phone / customer token
    const otherToken = seedCustomerSession('081200000082');

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, {
      Authorization: `Bearer ${otherToken}`
    });
    assert.ok(res.status === 403 || res.status === 404,
      `P7-17: Order must not be visible to a different customer. Got ${res.status}`);
  });

  // ── P7-18: Server deadline/status authoritative over client timer ──────────
  it('P7-18: Even if client deadline has passed, server status (not client clock) is authoritative', async () => {
    // Create order with created_at far in the past — deadline would be expired
    const ancientCreatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const { orderId, phone } = seedOrder({ status: 'pending', createdAt: ancientCreatedAt });
    const customerToken = seedCustomerSession(phone);

    const res = await request('GET', `/api/v1/orders/${orderId}`, null, { Authorization: `Bearer ${customerToken}` });
    assert.equal(res.status, 200);
    // Server status is still 'pending' because no timeout-worker ran — server is authoritative
    assert.equal(res.data.order.status, 'pending',
      'P7-18: Server status is pending regardless of client-side deadline expiry. Only server/worker can set timeout.');
    // deadline is in the past — that is correct and expected
    const dl = new Date(res.data.order.acceptance_deadline_at).getTime();
    assert.ok(dl < Date.now(), 'Deadline is in the past — client observes this and fetches server state');
  });
});
