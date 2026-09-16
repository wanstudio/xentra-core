'use strict';

/**
 * BM-2 — Branch Manager Dashboard: Pesanan + Meja / Dine-In Test Suite
 *
 * Requirements Matrix (BM2-01 through BM2-20):
 * - BM2-01: Branch Manager can view orders belonging to their assigned branch.
 * - BM2-02: Cross-branch order read is denied (403 FORBIDDEN_BRANCH_ACCESS).
 * - BM2-03: Query parameter branch_id cannot widen order visibility scope.
 * - BM2-04: Role tampering in headers or query cannot elevate branch authority.
 * - BM2-05: Unauthenticated request cannot access orders or table operational mutations (401).
 * - BM2-06: Non-manager / non-staff role without authority is rejected (403).
 * - BM2-07: Branch Manager can accept pending orders for their assigned branch.
 * - BM2-08: Branch Manager can reject pending orders with reason for their assigned branch.
 * - BM2-09: Cross-branch order acceptance/rejection is rejected (404 / 403).
 * - BM2-10: Duplicate accept is handled idempotently without duplicate side-effects.
 * - BM2-11: Rejecting an already confirmed order is blocked by OrderStateMachine.
 * - BM2-12: Invalid state transitions (e.g. pending -> ready) are rejected.
 * - BM2-13: Concurrent accept and reject race is safely handled by atomic transition.
 * - BM2-14: Terminal states (completed, rejected, cancelled) reject further mutation.
 * - BM2-15: Branch Manager can inspect table layout for their assigned branch.
 * - BM2-16: Cross-branch table layout access is denied with 403 FORBIDDEN_BRANCH_ACCESS.
 * - BM2-17: Cross-branch table block/unblock mutation is rejected with 403 FORBIDDEN_BRANCH_SCOPE.
 * - BM2-18: Branch Manager can block and unblock tables in their assigned branch.
 * - BM2-19: Branch Manager can complete an active dining session to release occupied tables.
 * - BM2-20: Floor layout geometry update (PUT /dine-in/layout/:branch_id) is blocked for Branch Manager (governance boundary).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-bm2-orders-and-tables';

const app = require('../../server/app');
const db = require('../../server/database/db');
const { DiningTableService } = require('../../domains/pos');

let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const ORG_ID = 'org_xentra_holding';
const BRANCH_A_ID = 'branch_bangjo_barat';
const BRANCH_B_ID = 'branch_bangjo_timur';

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_A_ID, brandId = BRAND_ID, organizationId = ORG_ID, userId = 'bm2_user_test' } = {}) {
  const token = 'bm2_tok_' + crypto.randomBytes(8).toString('hex');
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
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function makeOrderId() { return 'bm2_ord_' + crypto.randomBytes(5).toString('hex'); }
function makeOrderNum() { return 'BM2-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }

function seedOrder({
  orderId = makeOrderId(),
  orderNumber = makeOrderNum(),
  status = 'pending',
  branchId = BRANCH_A_ID,
  brandId = BRAND_ID,
  orderType = 'delivery',
  customerName = 'Test Customer',
  customerPhone = '081234567890',
  subtotal = 50000,
  grandTotal = 50000
} = {}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO orders (
      id, order_number, brand_id, branch_id, customer_name, customer_phone,
      order_type, status, subtotal, grand_total, payment_method, payment_status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cash', 'unpaid', ?, ?)
  `).run(orderId, orderNumber, brandId, branchId, customerName, customerPhone, orderType, status, subtotal, grandTotal, now, now);

  db.prepare(`
    INSERT OR REPLACE INTO order_items (
      id, order_id, product_id, product_name, unit_price, quantity, item_subtotal
    ) VALUES (?, ?, 'prod_bm2_test', 'BM2 Test Item', ?, 1, ?)
  `).run('item_' + orderId, orderId, subtotal, subtotal);

  return { orderId, orderNumber, status, branchId };
}

describe('BM-2 — Branch Manager Dashboard: Pesanan + Meja / Dine-In', () => {
  let bmAToken;
  let bmBToken;
  let ownerToken;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .run(ORG_ID, 'Xentra Holding', 'xentra-holding');
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)')
      .run(BRAND_ID, ORG_ID, 'MyBangjo', 'mybangjo');
    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, is_open_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, -7.25, 112.75, 1, 1, ?, ?)')
      .run(BRANCH_A_ID, BRAND_ID, 'Cabang BM2 Barat', 'surabaya-barat-bm2', 'Jl. Barat BM2 No 1', now, now);
    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, is_open_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, -7.26, 112.76, 1, 1, ?, ?)')
      .run(BRANCH_B_ID, BRAND_ID, 'Cabang BM2 Timur', 'surabaya-timur-bm2', 'Jl. Timur BM2 No 2', now, now);

    bmAToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, userId: 'bm2_mgr_a' });
    bmBToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_B_ID, userId: 'bm2_mgr_b' });
    ownerToken = seedStaffSession({ role: 'owner', branchId: null, userId: 'bm2_owner' });

    // Initialize layout for branch A and B
    DiningTableService.initializeBranchLayout(BRANCH_A_ID, 'template_01');
    DiningTableService.initializeBranchLayout(BRANCH_B_ID, 'template_01');
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    db.prepare("DELETE FROM order_items WHERE order_id LIKE 'bm2_ord_%'").run();
    db.prepare("DELETE FROM order_status_logs WHERE order_id LIKE 'bm2_ord_%'").run();
    db.prepare("DELETE FROM orders WHERE id LIKE 'bm2_ord_%'").run();
  });

  // BM2-01: Own branch order visibility
  it('BM2-01: Branch Manager can view orders belonging to their assigned branch', async () => {
    const ordA = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });
    const ordB = seedOrder({ branchId: BRANCH_B_ID, status: 'pending' });

    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/orders`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.orders));
    const ids = res.body.orders.map(o => o.id);
    assert.ok(ids.includes(ordA.orderId), 'Assigned branch order must be visible');
    assert.ok(!ids.includes(ordB.orderId), 'Unassigned branch order must NOT be visible');
  });

  // BM2-02: Cross-branch order read denied
  it('BM2-02: Cross-branch order read is denied with 403 FORBIDDEN_BRANCH_ACCESS', async () => {
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_B_ID}/orders`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_ACCESS');
  });

  // BM2-03: Query parameter branch_id cannot widen scope
  it('BM2-03: Query parameter branch_id cannot widen order visibility scope', async () => {
    const ordB = seedOrder({ branchId: BRANCH_B_ID, status: 'pending' });

    const res = await request('GET', `/api/v1/admin/orders?branch_id=${BRANCH_B_ID}`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_ACCESS');
  });

  // BM2-04: Role tampering cannot elevate authority
  it('BM2-04: Role tampering in body/headers cannot elevate branch authority', async () => {
    const ordB = seedOrder({ branchId: BRANCH_B_ID, status: 'pending' });

    const res = await request('POST', `/api/v1/orders/${ordB.orderId}/branch-acceptance`, {
      decision: 'accept',
      role: 'owner'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  // BM2-05: Unauthenticated access rejected
  it('BM2-05: Unauthenticated request cannot access orders or operational mutations (401)', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const resOrders = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/orders`);
    assert.equal(resOrders.status, 401);

    const resAccept = await request('POST', `/api/v1/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' });
    assert.equal(resAccept.status, 401);
  });

  // BM2-06: Non-manager / non-staff role without authority is rejected
  it('BM2-06: Operator with insufficient role is rejected from management endpoints', async () => {
    const kitchenToken = seedStaffSession({ role: 'kitchen', branchId: BRANCH_A_ID });

    // Kitchen cannot call branch acceptance endpoint
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });
    const res = await request('POST', `/api/v1/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${kitchenToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'INSUFFICIENT_PERMISSIONS');
  });

  // BM2-07: Own branch accept allowed
  it('BM2-07: Branch Manager can accept pending orders for their assigned branch', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res = await request('POST', `/api/v1/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept',
      note: 'Diterima oleh BM Cabang Barat'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.new_status, 'confirmed');

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(check.status, 'confirmed');
  });

  // BM2-08: Own branch reject allowed with reason
  it('BM2-08: Branch Manager can reject pending orders with reason for their assigned branch', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res = await request('POST', `/api/v1/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Kapasitas dapur penuh saat jam sibuk'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.new_status, 'rejected');

    const check = db.prepare('SELECT status FROM orders WHERE id = ?').get(ord.orderId);
    assert.equal(check.status, 'rejected');

    const log = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ? AND new_status = ?').get(ord.orderId, 'rejected');
    assert.ok(log);
    assert.ok(log.note.includes('Kapasitas dapur penuh'));
  });

  // BM2-09: Cross-branch acceptance and rejection rejected
  it('BM2-09: Cross-branch order acceptance and rejection is denied', async () => {
    const ordB = seedOrder({ branchId: BRANCH_B_ID, status: 'pending' });

    // BM A attempts accept on BM B's order
    const resAccept = await request('POST', `/api/v1/orders/${ordB.orderId}/branch-acceptance`, {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(resAccept.status, 404);

    // BM A attempts reject on BM B's order
    const resReject = await request('POST', `/api/v1/orders/${ordB.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Test cross reject'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(resReject.status, 404);
  });

  // BM2-10: Duplicate accept idempotency
  it('BM2-10: Duplicate accept is handled idempotently without duplicate side-effects', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res1 = await request('POST', `/api/v1/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(res1.status, 200);

    const logCount1 = db.prepare('SELECT COUNT(*) as c FROM order_status_logs WHERE order_id = ?').get(ord.orderId).c;

    const res2 = await request('POST', `/api/v1/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'accept'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.idempotent, true);

    const logCount2 = db.prepare('SELECT COUNT(*) as c FROM order_status_logs WHERE order_id = ?').get(ord.orderId).c;
    assert.equal(logCount2, logCount1);
  });

  // BM2-11: Rejecting an already confirmed order is blocked
  it('BM2-11: Rejecting an already confirmed order is blocked by OrderStateMachine', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'confirmed' });

    const res = await request('POST', `/api/v1/orders/${ord.orderId}/branch-acceptance`, {
      decision: 'reject',
      reason: 'Late cancellation attempt'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  // BM2-12: Invalid state transitions rejected
  it('BM2-12: Invalid state transitions (e.g. pending -> ready) are rejected', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const res = await request('PATCH', `/api/v1/kitchen/orders/${ord.orderId}/status`, {
      status: 'ready'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('tidak valid'));
  });

  // BM2-13: Concurrent accept/reject race condition handling
  it('BM2-13: Concurrent accept and reject race is safely resolved by atomic transaction', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'pending' });

    const [resAccept, resReject] = await Promise.all([
      request('POST', `/api/v1/orders/${ord.orderId}/branch-acceptance`, { decision: 'accept' }, { Authorization: `Bearer ${bmAToken}` }),
      request('POST', `/api/v1/orders/${ord.orderId}/branch-acceptance`, { decision: 'reject', reason: 'Race' }, { Authorization: `Bearer ${bmAToken}` })
    ]);

    const winners = [resAccept, resReject].filter(r => r.status === 200);
    const losers = [resAccept, resReject].filter(r => r.status !== 200);

    assert.equal(winners.length, 1, 'Exactly one operation wins');
    assert.equal(losers.length, 1, 'Conflicting operation fails');
  });

  // BM2-14: Terminal order protection
  it('BM2-14: Terminal states (completed, rejected, cancelled) reject further mutation', async () => {
    const ord = seedOrder({ branchId: BRANCH_A_ID, status: 'completed' });

    const res = await request('PATCH', `/api/v1/kitchen/orders/${ord.orderId}/status`, {
      status: 'preparing'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  // BM2-15: Branch Manager can inspect table layout for assigned branch
  it('BM2-15: Branch Manager can inspect table layout for their assigned branch', async () => {
    const res = await request('GET', `/api/v1/dine-in/layout?branch_id=${BRANCH_A_ID}`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.layout);
    assert.equal(res.body.layout.branch_id, BRANCH_A_ID);
    assert.ok(Array.isArray(res.body.layout.tables));
  });

  // BM2-16: Cross-branch table layout access denied
  it('BM2-16: Cross-branch table layout access is denied with 403 FORBIDDEN_BRANCH_ACCESS', async () => {
    const res = await request('GET', `/api/v1/dine-in/layout?branch_id=${BRANCH_B_ID}`, null, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_ACCESS');
  });

  // BM2-17: Cross-branch table block/unblock mutation denied
  it('BM2-17: Cross-branch table block/unblock mutation is rejected with 403 FORBIDDEN_BRANCH_SCOPE', async () => {
    const layoutB = DiningTableService.getBranchLayout(BRANCH_B_ID);
    const tableB = layoutB.tables[0];

    // BM A attempts to block table in Branch B
    const res = await request('POST', `/api/v1/dine-in/tables/${tableB.id}/block`, {
      is_blocked: true,
      reason: 'Cross branch sabotage attempt'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_SCOPE');
  });

  // BM2-18: Block and unblock tables in assigned branch
  it('BM2-18: Branch Manager can block and unblock tables in their assigned branch', async () => {
    const layoutA = DiningTableService.getBranchLayout(BRANCH_A_ID);
    const targetTable = layoutA.tables.find(t => t.table_number === '2');

    // Block table
    const resBlock = await request('POST', `/api/v1/dine-in/tables/${targetTable.id}/block`, {
      is_blocked: true,
      reason: 'Reservasi VIP Offline'
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(resBlock.status, 200);
    assert.equal(resBlock.body.success, true);
    assert.equal(resBlock.body.operational_state, 'blocked');

    const stateBlocked = DiningTableService.getBranchLayout(BRANCH_A_ID);
    const tAfterBlock = stateBlocked.tables.find(t => t.id === targetTable.id);
    assert.equal(tAfterBlock.operational_state, 'blocked');

    // Unblock table
    const resUnblock = await request('POST', `/api/v1/dine-in/tables/${targetTable.id}/block`, {
      is_blocked: false
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(resUnblock.status, 200);
    assert.equal(resUnblock.body.success, true);
    assert.equal(resUnblock.body.operational_state, 'available');

    const stateUnblocked = DiningTableService.getBranchLayout(BRANCH_A_ID);
    const tAfterUnblock = stateUnblocked.tables.find(t => t.id === targetTable.id);
    assert.equal(tAfterUnblock.operational_state, 'available');
  });

  // BM2-19: Complete dining session releases occupied tables
  it('BM2-19: Branch Manager can complete an active dining session to release occupied tables', async () => {
    const layoutA = DiningTableService.getBranchLayout(BRANCH_A_ID);
    const tableTarget = layoutA.tables.find(t => t.table_number === '5');

    const sessionRes = DiningTableService.createOrAttachDiningSession({
      branch_id: BRANCH_A_ID,
      table_ids: [tableTarget.id],
      order_id: makeOrderId(),
      guest_count: 2,
      customer_name: 'Dine-In Customer'
    });

    const stateOccupied = DiningTableService.getBranchLayout(BRANCH_A_ID);
    const tOcc = stateOccupied.tables.find(t => t.id === tableTarget.id);
    assert.equal(tOcc.operational_state, 'occupied');

    // BM completes session
    const res = await request('POST', `/api/v1/dine-in/sessions/${sessionRes.session_id}/complete`, {}, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    const stateFree = DiningTableService.getBranchLayout(BRANCH_A_ID);
    const tFree = stateFree.tables.find(t => t.id === tableTarget.id);
    assert.equal(tFree.operational_state, 'available');
    assert.equal(tFree.current_session_id, null);
  });

  // BM2-20: Floor layout geometry update blocked for Branch Manager (governance boundary)
  it('BM2-20: Floor layout geometry update (PUT /dine-in/layout/:branch_id) is blocked for Branch Manager (governance boundary)', async () => {
    // Record current layout state before mutation attempt
    const layoutBefore = DiningTableService.getBranchLayout(BRANCH_A_ID);
    const initialTableCount = layoutBefore.tables.length;

    // 1. Branch Manager request is denied with 403 INSUFFICIENT_PERMISSIONS
    const res = await request('PUT', `/api/v1/dine-in/layout/${BRANCH_A_ID}`, {
      canvas: { width: 1200, height: 900 },
      sections: [{ id: 'sec_new', name: 'VIP Area' }],
      tables: [{ table_number: '99', capacity: 10 }]
    }, {
      Authorization: `Bearer ${bmAToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'INSUFFICIENT_PERMISSIONS');

    // 2. Physical layout in database remains unchanged after denied request
    const layoutAfter = DiningTableService.getBranchLayout(BRANCH_A_ID);
    assert.equal(layoutAfter.tables.length, initialTableCount, 'Table count must not change after denied BM request');
    assert.equal(layoutAfter.tables.find(t => t.table_number === '99'), undefined, 'Unauthorized table must not exist');

    // 3. Authorized Owner can successfully update floor plan geometry
    const brandManagerToken = seedStaffSession({ role: 'brand_manager', branchId: null, userId: 'bm2_brand_mgr' });
    const resBrandMgr = await request('PUT', `/api/v1/dine-in/layout/${BRANCH_A_ID}`, {
      canvas: { width: 500, height: 700 },
      sections: [],
      tables: layoutBefore.tables.slice(0, 5).map(t => ({
        id: t.id,
        table_number: t.table_number,
        capacity: t.capacity
      }))
    }, {
      Authorization: `Bearer ${brandManagerToken}`
    });
    assert.equal(resBrandMgr.status, 200);
    assert.equal(resBrandMgr.body.success, true);

    // 4. Branch Manager attempting to mutate another branch layout is also denied with 403
    const resCross = await request('PUT', `/api/v1/dine-in/layout/${BRANCH_B_ID}`, {
      canvas: { width: 600, height: 600 },
      sections: [],
      tables: []
    }, {
      Authorization: `Bearer ${bmAToken}`
    });
    assert.equal(resCross.status, 403);
    assert.equal(resCross.body.success, false);
  });
});
