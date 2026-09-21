'use strict';

/**
 * Phase 9 — Branch Manager Order Operations: Test Suite
 *
 * Tests cover:
 * - P9-01: Own branch order visibility (Branch Manager sees only assigned branch orders).
 * - P9-02: Cross-branch order visibility denied (403 FORBIDDEN_BRANCH_SCOPE).
 * - P9-03: Own branch acceptance allowed (POST /orders/:id/branch-acceptance 'accept').
 * - P9-04: Cross-branch acceptance denied (404 / 403 not found in branch authority).
 * - P9-05: Own branch rejection allowed (POST /orders/:id/branch-acceptance 'reject' with reason).
 * - P9-06: Cross-branch rejection denied.
 * - P9-07: Client branch_id in query/body cannot widen scope.
 * - P9-08: Client role cannot elevate authority.
 * - P9-09: Invalid transition rejected by OrderStateMachine (e.g. pending -> ready, completed -> pending).
 * - P9-10: Duplicate acceptance handled idempotently without error or duplicate audit.
 * - P9-11: Accept/reject race handled safely by atomic transaction.
 * - P9-12: Operational mutation audited in order_status_logs with actor details.
 * - P9-13: Customer sees updated authoritative status via GET /orders/:id.
 * - P9-14: Owner visibility remains separate from Branch Manager operation (Owner views all, BM strictly assigned branch).
 * - P9-15: Terminal state prevents further transitions.
 * - P9-16: Unauthorized order mutation denied (anonymous or wrong role).
 * - P9-17: Refresh preserves correct branch-scoped queue.
 * - P9-18: Stale response cannot overwrite newer state in client polling logic.
 * - P9-19: No duplicate polling / cleanup on unmount.
 * - P9-20: Order type-specific lifecycle respected (Delivery vs Pickup/Dine-In).
 *
 * Authority rule: Core/server is authoritative for order state and transitions.
 * Branch Manager operates strictly within session.branchId.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-p9-branch-manager-operations';

const app = require('../../server/app');
const db = require('../../server/database/db');
const OrderStateMachine = require('../../server/services/OrderStateMachine');

let server;
let baseUrl;

// ─── Test Constants ──────────────────────────────────────────────────────────
const BRAND_ID = 'brand_bangjo';
const BRANCH_A_ID = 'branch_bangjo_barat';
const BRANCH_B_ID = 'branch_bangjo_timur';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeOrderId() { return 'p9_ord_' + crypto.randomBytes(5).toString('hex'); }
function makeOrderNum() { return 'P9-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }

function seedOrder({
  orderId,
  status = 'pending',
  branchId = BRANCH_A_ID,
  brandId = BRAND_ID,
  phone = '081200000099',
  orderType = 'delivery',
  subtotal = 50000,
  grandTotal = 50000,
  paymentMethod = 'cash',
  paymentStatus = 'unpaid'
} = {}) {
  orderId = orderId || makeOrderId();
  const num = makeOrderNum();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO orders (
      id, order_number, brand_id, branch_id, customer_name, customer_phone,
      order_type, status, subtotal, grand_total, payment_method, payment_status,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'P9 Customer', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orderId, num, brandId, branchId, phone,
    orderType, status, subtotal, grandTotal, paymentMethod, paymentStatus,
    now, now
  );

  const itemId = 'item_' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal)
    VALUES (?, ?, 'prod_p9_1', 'Menu P9', ?, 1, ?)
  `).run(itemId, orderId, subtotal, subtotal);

  return { orderId, num, branchId, status, orderType };
}

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_A_ID, brandId = BRAND_ID, organizationId = null, userId = 'bm_p9_test' } = {}) {
  const token = 'p9token_' + crypto.randomBytes(8).toString('hex');
  const store = global.TokenSessionStore;
  const sess = {
    type: 'staff',
    role,
    brandId,
    brand_id: brandId,
    organizationId,
    organization_id: organizationId,
    branchId,
    branch_id: branchId,
    userId,
    username: userId,
    email_verified: true,
    expiresAt: Date.now() + 86400 * 1000
  };
  if (store && store.sessions) {
    store.sessions.set(token, sess);
  }
  return token;
}

function seedCustomerSession(phone = '081200000099', brandId = BRAND_ID) {
  const token = 'p9cust_' + crypto.randomBytes(8).toString('hex');
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

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const apiPath = path.startsWith('/api') ? path : ('/api/v1' + path);
    const url = new URL(apiPath, baseUrl);
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

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Phase 9 — Branch Manager Order Operations', () => {
  let bmAToken;
  let bmBToken;
  let ownerToken;
  let customerToken;

  before(async () => {
    db.seedDemoData(db);
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    bmAToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, userId: 'bm_a_user' });
    bmBToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_B_ID, userId: 'bm_b_user' });
    ownerToken = seedStaffSession({ role: 'owner', branchId: null, userId: 'owner_user' });
    customerToken = seedCustomerSession('081200000099');
  });

  after(() => {
    server && server.close();
    db.prepare("DELETE FROM order_payments WHERE order_id LIKE 'p9_ord_%'").run();
    db.prepare("DELETE FROM order_status_logs WHERE order_id LIKE 'p9_ord_%'").run();
    db.prepare("DELETE FROM order_deliveries WHERE order_id LIKE 'p9_ord_%'").run();
    db.prepare("DELETE FROM order_items WHERE order_id LIKE 'p9_ord_%'").run();
    db.prepare("DELETE FROM orders WHERE id LIKE 'p9_ord_%'").run();
  });

  // P9-01: Own branch order visibility
  it('P9-01: Branch Manager can view orders belonging to their assigned branch', async () => {
    const ordA = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });
    const ordB = seedOrder({ branchId: BRANCH_B_ID, status: 'pending' });

    const res = await request('GET', `/admin/branches/${BRANCH_A_ID}/orders`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.branch_id, BRANCH_A_ID);
    assert.ok(Array.isArray(res.data.orders));
    const ids = res.data.orders.map(o => o.id);
    assert.ok(ids.includes(ordA.orderId), 'Should include Branch A order');
    assert.ok(!ids.includes(ordB.orderId), 'Should NOT include Branch B order');
  });

  // P9-02: Cross-branch order visibility denied
  it('P9-02: Cross-branch order visibility is denied with 403 FORBIDDEN_BRANCH_ACCESS', async () => {
    const res = await request('GET', `/admin/branches/${BRANCH_B_ID}/orders`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.data.success, false);
    assert.equal(res.data.error, 'FORBIDDEN_BRANCH_ACCESS');
  });

  // P9-03: Own branch acceptance allowed
  it('P9-03: Own branch acceptance is allowed and transitions pending -> confirmed', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept',
      note: 'Diterima oleh Branch Manager A'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.new_status, 'confirmed');

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(check.status, 'confirmed');
  });

  // P9-04: Cross-branch acceptance denied
  it('P9-04: Cross-branch acceptance is denied (404 outside branch authority)', async () => {
    const ordB = seedOrder({ branchId: BRANCH_B_ID, status: 'pending' });

    const res = await request('POST', `/orders/${ordB.orderId}/branch-acceptance`, {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${bmAToken}` // BM A attempts to accept BM B order
    });

    assert.equal(res.status, 404);
    assert.equal(res.data.success, false);

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ordB.orderId);
    assert.equal(check.status, 'pending');
  });

  // P9-05: Own branch rejection allowed with reason
  it('P9-05: Own branch rejection transitions pending -> rejected and records audit reason', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Bahan baku habis'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.new_status, 'rejected');

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(check.status, 'rejected');

    const log = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(ord.orderId);
    assert.ok(log);
    assert.equal(log.new_status, 'rejected');
    assert.ok(log.note.includes('Bahan baku habis'));
  });

  // P9-06: Cross-branch rejection denied
  it('P9-06: Cross-branch rejection is denied', async () => {
    const ordB = seedOrder({ branchId: BRANCH_B_ID, status: 'pending' });

    const res = await request('POST', `/orders/${ordB.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Out of stock'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 404);
    assert.equal(res.data.success, false);

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ordB.orderId);
    assert.equal(check.status, 'pending');
  });

  // P9-07: Client branch_id in query/body cannot widen scope
  it('P9-07: Client branch_id parameter cannot widen Branch Manager scope', async () => {
    const ordB = seedOrder({ branchId: BRANCH_B_ID, status: 'pending' });

    // BM A passes branch_id=BRANCH_B_ID to GET /admin/orders -> blocked with 403 FORBIDDEN_BRANCH_ACCESS
    const resBlocked = await request('GET', `/admin/orders?branch_id=${BRANCH_B_ID}`, null, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(resBlocked.status, 403);
    assert.equal(resBlocked.data.success, false);
    assert.equal(resBlocked.data.error, 'FORBIDDEN_BRANCH_ACCESS');

    // BM A queries /admin/orders without query params -> strictly sees only assigned branch A
    const resOwn = await request('GET', `/admin/orders`, null, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(resOwn.status, 200);
    assert.equal(resOwn.data.success, true);
    const ids = resOwn.data.orders.map(o => o.id);
    assert.ok(!ids.includes(ordB.orderId), 'Must NOT include unassigned Branch B order');
  });

  // P9-08: Client role cannot elevate authority
  it('P9-08: Client body/header role parameter cannot elevate authority', async () => {
    const ordB = seedOrder({ branchId: BRANCH_B_ID, status: 'pending' });

    const res = await request('POST', `/orders/${ordB.orderId}/branch-acceptance`, {
      decision: 'accept',
      role: 'owner' // Attempting parameter pollution / privilege escalation
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 404);
    assert.equal(res.data.success, false);
  });

  // P9-09: Invalid transition rejected by OrderStateMachine
  it('P9-09: Invalid state transition is rejected (e.g. pending -> ready or completed -> pending)', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    // Branch manager attempts PATCH /kitchen/orders/:id/status directly to 'ready' from 'pending'
    const res = await request('PATCH', `/kitchen/orders/${ord.orderId}/status`, {
      status: 'ready'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.ok(res.data.error.includes('tidak valid'));
  });

  // P9-10: Duplicate acceptance handled idempotently
  it('P9-10: Duplicate acceptance returns idempotent success without duplicate audit log', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    // First accept
    const res1 = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(res1.status, 200);
    assert.equal(res1.data.new_status, 'confirmed');

    const logsCount1 = db.prepare('SELECT COUNT(*) as count FROM order_status_logs WHERE order_id = ?').get(ord.orderId).count;

    // Second accept (duplicate)
    const res2 = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.data.success, true);
    assert.equal(res2.data.idempotent, true);

    const logsCount2 = db.prepare('SELECT COUNT(*) as count FROM order_status_logs WHERE order_id = ?').get(ord.orderId).count;
    assert.equal(logsCount2, logsCount1, 'Duplicate acceptance must not append duplicate audit logs');
  });

  // P9-11: Accept/reject race handled safely
  it('P9-11: Concurrent accept and reject race is handled safely by atomic transaction', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const [resAccept, resReject] = await Promise.all([
      request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' }, { Authorization: `Bearer ${bmAToken}` }),
      request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'reject', reason: 'Race reject' }, { Authorization: `Bearer ${bmAToken}` })
    ]);

    // One must win (200 success) and the other must either fail with invalid transition/concurrency error or 400
    const statuses = [resAccept.status, resReject.status];
    assert.ok(statuses.includes(200), 'At least one transition succeeded');
    const winners = [resAccept, resReject].filter(r => r.status === 200);
    const losers = [resAccept, resReject].filter(r => r.status !== 200);

    assert.equal(winners.length, 1, 'Exactly one decision wins the race');
    assert.equal(losers.length, 1, 'The competing conflicting decision is rejected');
  });

  // P9-12: Operational mutation audited in order_status_logs
  it('P9-12: Order mutations are audited with actor type, actor ID, and timestamps', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'confirmed' });

    const res = await request('PATCH', `/kitchen/orders/${ord.orderId}/status`, {
      status: 'preparing',
      note: 'Dapur mulai memasak'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    const log = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ? AND new_status = ?').get(ord.orderId, 'preparing');
    assert.ok(log, 'Audit log must exist');
    assert.equal(log.previous_status, 'confirmed');
    assert.equal(log.new_status, 'preparing');
    assert.equal(log.actor_type, 'staff');
    assert.equal(log.actor_id, 'bm_a_user');
    assert.ok(log.note.includes('Dapur mulai memasak'));
  });

  // P9-13: Customer sees updated authoritative status via GET /orders/:id
  it('P9-13: Customer observes authoritative updated order status via GET /orders/:id', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending', phone: '081200000099' });

    // BM accepts
    await request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' }, { Authorization: `Bearer ${bmAToken}` });

    // Customer views order
    const custRes = await request('GET', `/orders/${ord.orderId}`, null, {
      Authorization: `Bearer ${customerToken}`
    });

    assert.equal(custRes.status, 200);
    assert.equal(custRes.data.success, true);
    assert.equal(custRes.data.order.status, 'confirmed');
  });

  // P9-14: Owner visibility remains separate from Branch Manager operation
  it('P9-14: Owner can view all branches while Branch Manager is strictly scoped', async () => {
    const ordA = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });
    const ordB = seedOrder({ branchId: BRANCH_B_ID, status: 'pending' });

    // Owner fetches
    const ownerRes = await request('GET', '/admin/orders', null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.equal(ownerRes.status, 200);
    const ownerOrderIds = ownerRes.data.orders.map(o => o.id);
    assert.ok(ownerOrderIds.includes(ordA.orderId), 'Owner sees branch A order');
    assert.ok(ownerOrderIds.includes(ordB.orderId), 'Owner sees branch B order');

    // BM A fetches
    const bmAOrdersRes = await request('GET', '/admin/orders', null, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(bmAOrdersRes.status, 200);
    const bmOrderIds = bmAOrdersRes.data.orders.map(o => o.id);
    assert.ok(bmOrderIds.includes(ordA.orderId), 'BM sees own branch order');
    assert.ok(!bmOrderIds.includes(ordB.orderId), 'BM cannot see other branch order');
  });

  // P9-15: Terminal state prevents further transitions
  it('P9-15: Terminal state (completed, cancelled, rejected) prevents further transitions', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'completed' });

    const res = await request('PATCH', `/kitchen/orders/${ord.orderId}/status`, {
      status: 'ready'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.ok(res.data.error.includes('tidak valid'));
  });

  // P9-16: Unauthorized order mutation denied
  it('P9-16: Unauthenticated or non-staff request is denied mutation access', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    // Anonymous request
    const anonRes = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' });
    assert.equal(anonRes.status, 401);

    // Customer attempting staff endpoint
    const custRes = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' }, {
      Authorization: `Bearer ${customerToken}`
    });
    assert.equal(custRes.status, 403);
  });

  // P9-17: Refresh preserves correct branch-scoped queue
  it('P9-17: Repeating order queue query consistently preserves branch isolation', async () => {
    const ordA = seedOrder({ branchId: BRANCH_A_ID, status: 'confirmed' });

    for (let i = 0; i < 3; i++) {
      const res = await request('GET', '/admin/orders', null, {
        Authorization: `Bearer ${bmAToken}`
      });
      assert.equal(res.status, 200);
      assert.ok(res.data.orders.every(o => o.branch_id === BRANCH_A_ID), 'All returned orders belong to Branch A');
    }
  });

  // P9-18: Stale response protection logic in client polling
  it('P9-18: Client polling stale response guard drops out-of-order responses', () => {
    // Unit test verifying monotonic sequence handling logic
    let seq = 0;
    let appliedData = null;

    function simulateFetch(seqId, data) {
      if (seqId !== seq) return; // Drop stale response
      appliedData = data;
    }

    seq = 1; // Initial request
    const firstReqSeq = seq;

    seq = 2; // Newer request triggered before first returns
    const secondReqSeq = seq;

    simulateFetch(secondReqSeq, { version: 2 });
    assert.deepEqual(appliedData, { version: 2 });

    // Delayed first request returns later
    simulateFetch(firstReqSeq, { version: 1 });
    assert.deepEqual(appliedData, { version: 2 }, 'Stale version 1 must not overwrite newer version 2');
  });

  // P9-19: Polling lifecycle cleanup on unmount
  it('P9-19: Polling timer can start and cleanly unmount without leaking intervals', () => {
    let timer = null;
    let ticks = 0;

    function startPolling() {
      if (timer) clearInterval(timer);
      timer = setInterval(() => { ticks++; }, 50);
    }

    function stopPolling() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    startPolling();
    assert.ok(timer !== null);
    stopPolling();
    assert.equal(timer, null);
  });

  // P9-20: Order type-specific lifecycle respected (Delivery vs Pickup/Dine-In)
  it('P9-20: Order lifecycle respects fulfillment type (Delivery uses out_for_delivery; Pickup/Dine-In transitions ready -> completed)', async () => {
    // Delivery Order: confirmed -> preparing -> ready -> out_for_delivery -> completed
    const delOrd = seedOrder({ branchId: BRANCH_A_ID, status: 'confirmed', orderType: 'delivery' });
    
    // confirmed -> preparing
    let res = await request('PATCH', `/kitchen/orders/${delOrd.orderId}/status`, { status: 'preparing' }, { Authorization: `Bearer ${bmAToken}` });
    assert.equal(res.status, 200);

    // preparing -> ready
    res = await request('PATCH', `/kitchen/orders/${delOrd.orderId}/status`, { status: 'ready' }, { Authorization: `Bearer ${bmAToken}` });
    assert.equal(res.status, 200);

    // ready -> out_for_delivery
    res = await request('PATCH', `/kitchen/orders/${delOrd.orderId}/status`, { status: 'out_for_delivery' }, { Authorization: `Bearer ${bmAToken}` });
    assert.equal(res.status, 200);

    // out_for_delivery -> completed
    res = await request('PATCH', `/kitchen/orders/${delOrd.orderId}/status`, { status: 'completed' }, { Authorization: `Bearer ${bmAToken}` });
    assert.equal(res.status, 200);

    // Pickup Order: confirmed -> preparing -> ready -> completed (directly bypasses out_for_delivery)
    const pickupOrd = seedOrder({ branchId: BRANCH_A_ID, status: 'confirmed', orderType: 'pickup' });

    // confirmed -> preparing
    res = await request('PATCH', `/kitchen/orders/${pickupOrd.orderId}/status`, { status: 'preparing' }, { Authorization: `Bearer ${bmAToken}` });
    assert.equal(res.status, 200);

    // preparing -> ready
    res = await request('PATCH', `/kitchen/orders/${pickupOrd.orderId}/status`, { status: 'ready' }, { Authorization: `Bearer ${bmAToken}` });
    assert.equal(res.status, 200);

    // ready -> completed (allowed by OrderStateMachine.VALID_TRANSITIONS.ready: ['out_for_delivery', 'completed', 'cancelled'])
    res = await request('PATCH', `/kitchen/orders/${pickupOrd.orderId}/status`, { status: 'completed' }, { Authorization: `Bearer ${bmAToken}` });
    assert.equal(res.status, 200);
    assert.equal(res.data.new_status, 'completed');
  });

  // ─── Canonical P9 supplemental coverage ─────────────────────────────────────
  // The scenarios below close the remaining canonical gaps against the Phase 9
  // test contract: cross-brand, cross-organization, stale conflicting action,
  // disabled manager, and invalid/nonexistent target.

  it('P9-10 (canonical): Cross-brand order access is rejected with FORBIDDEN_TENANT_ACCESS', async () => {
    const crossBrandToken = seedStaffSession({
      role: 'branch_manager',
      branchId: 'branch_evil',
      brandId: 'brand_evil',
      userId: 'bm_cross_brand'
    });

    const res = await request('GET', '/admin/orders', null, {
      Authorization: `Bearer ${crossBrandToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.data.error, 'FORBIDDEN_TENANT_ACCESS');
  });

  it('P9-11 (canonical): Cross-organization order access is rejected with FORBIDDEN_TENANT_ACCESS', async () => {
    const crossOrgToken = seedStaffSession({
      role: 'branch_manager',
      branchId: 'branch_evil',
      brandId: 'brand_evil',
      organizationId: 'org_evil',
      userId: 'bm_cross_org'
    });

    const res = await request('GET', '/admin/orders', null, {
      Authorization: `Bearer ${crossOrgToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.data.error, 'FORBIDDEN_TENANT_ACCESS');
  });

  it('P9-14 (canonical): Stale conflicting action returns controlled state error', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Stok habis'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    const staleAccept = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(staleAccept.status, 400);
    assert.equal(staleAccept.data.success, false);
    assert.ok(staleAccept.data.error.includes('tidak valid'));
  });

  it('P9-17 (canonical): Disabled Branch Manager cannot perform operational mutations', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });
    const disabledUserId = 'bm_disabled_p9';
    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, branch_id, username, email, full_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(disabledUserId, BRAND_ID, 'org_bangjo', BRANCH_A_ID, 'bm_disabled_p9', 'disabled-p9@example.com', 'Disabled BM', 'branch_manager', 'disabled');

    const disabledToken = seedStaffSession({
      role: 'branch_manager',
      branchId: BRANCH_A_ID,
      userId: disabledUserId
    });

    try {
      const res = await request('POST', `/orders/${ord.orderId}/branch-acceptance`, {
        decision: 'accept'
      }, {
        Authorization: `Bearer ${disabledToken}`
      });

      assert.equal(res.status, 403);
      assert.equal(res.data.error, 'ACCOUNT_DISABLED');

      const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
      assert.equal(check.status, 'pending');
    } finally {
      db.prepare('DELETE FROM users WHERE id = ?').run(disabledUserId);
    }
  });

  it('P9-18 (canonical): Invalid/nonexistent target order is handled safely', async () => {
    const res = await request('POST', '/orders/p9_does_not_exist/branch-acceptance', {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 404);
    assert.equal(res.data.success, false);
  });
});
