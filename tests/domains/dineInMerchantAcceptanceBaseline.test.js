'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const app = require('../../server/app');
const db = require('../../server/database/db');
const { DiningTableService } = require('../../domains/dining');
const { DiningTableRepository } = require('../../core/data/repositories');
const { OrderPlacementService } = require('../../domains/commerce');
const OrderStateMachine = require('../../server/services/OrderStateMachine');
const AcceptanceTimeoutService = require('../../server/services/AcceptanceTimeoutService');

const diningRepo = new DiningTableRepository();

const BRAND_ID = 'brand_accept_test';
const BRANCH_ID = 'branch_accept_test';
const HOST_DOMAIN = 'accept.test';

const TABLE_T1 = `tbl_bline_t1_${Date.now()}`;
const TABLE_T2 = `tbl_bline_t2_${Date.now()}`;
const TABLE_T3 = `tbl_bline_t3_${Date.now()}`;
const TABLE_T4 = `tbl_bline_t4_${Date.now()}`;
const TABLE_T5 = `tbl_bline_t5_${Date.now()}`;

const CUST_PHONE = '081299112233';

let server;
let baseUrl;
let bmToken;

function makeItems() {
  return [{
    product_id: 'prod_bline_1',
    quantity: 1,
    unit_price: 35000,
    product_name: 'Nasi Goreng Spesial',
    subtotal: 35000
  }];
}

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_ID, brandId = BRAND_ID, userId = 'bm_accept_user' } = {}) {
  const token = 'accept_token_' + crypto.randomBytes(8).toString('hex');
  const store = global.TokenSessionStore;
  const sess = {
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
        'Host': HOST_DOMAIN,
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

test.before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_accept_test', 'Org Accept', 'org-accept')`).run();
  db.prepare(`INSERT OR REPLACE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, 'org_accept_test', 'Brand Accept', 'brand-accept', ?)`).run(BRAND_ID, HOST_DOMAIN);
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Cabang Accept', 'cab-accept', 'Jl. Accept', -6.2, 106.8)`).run(BRANCH_ID, BRAND_ID);

  // Seed test tables
  const tables = [
    { id: TABLE_T1, num: 'T1' },
    { id: TABLE_T2, num: 'T2' },
    { id: TABLE_T3, num: 'T3' },
    { id: TABLE_T4, num: 'T4' },
    { id: TABLE_T5, num: 'T5' }
  ];

  for (const t of tables) {
    db.prepare(`
      INSERT OR REPLACE INTO branch_tables (id, branch_id, table_number, label, capacity, is_active, qr_token)
      VALUES (?, ?, ?, ?, 4, 1, ?)
    `).run(t.id, BRANCH_ID, t.num, `Meja ${t.num}`, `qr_token_${t.id}`);

    db.prepare(`
      INSERT OR REPLACE INTO branch_table_states (table_id, operational_state, current_session_id, notes, updated_at)
      VALUES (?, 'available', NULL, 'Available for test', ?)
    `).run(t.id, new Date().toISOString());
  }

  // Seed product
  db.prepare(`
    INSERT OR REPLACE INTO products (id, brand_id, name, slug, price, is_active)
    VALUES ('prod_bline_1', ?, 'Nasi Goreng Spesial', 'nasgor-spesial-bline', 35000, 1)
  `).run(BRAND_ID);

  db.prepare(`
    INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES (?, 'prod_bline_1', 35000, 100, 1)
  `).run(BRANCH_ID);

  // Seed staff user in DB for authoritative account check in requireAuth
  db.prepare(`
    INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, full_name, role, status, created_at, updated_at)
    VALUES ('bm_accept_user', ?, 'org_accept_test', ?, 'bm_accept_user', 'bm@accept.test', 'BM Accept User', 'branch_manager', 'active', ?, ?)
  `).run(BRAND_ID, BRANCH_ID, new Date().toISOString(), new Date().toISOString());

  bmToken = seedStaffSession();
});

test.after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Baseline 1: Customer dine-in multi-table selection is strictly rejected', async () => {
  const result = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_ID,
    customer: { name: 'Multi Tester', phone: '081299990001' },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_ids: [TABLE_T1, TABLE_T2]
  });

  assert.equal(result.success, false);
  assert.equal(result.status, 'SINGLE_TABLE_REQUIRED');
  assert.ok(result.errors[0].includes('1 meja'));
});

test('Baseline 2: Cash Pending does NOT deduct stock; Table is held; Merchant Accept via HTTP activates Dining Session, marks Table occupied, and deducts stock', async () => {
  const initialStock = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_ID, 'prod_bline_1').stock;
  assert.equal(initialStock, 100);

  // Step 1: Customer creates cash order for Table T1
  const orderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_ID,
    customer: { name: 'Customer T1', phone: CUST_PHONE },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_id: TABLE_T1
  });

  assert.equal(orderRes.success, true);
  const order = orderRes.order;
  assert.equal(order.status, 'pending', 'Order must be pending awaiting merchant acceptance');

  // Verify: Stock is NOT deducted for pending cash order (P0 fix verification)
  const stockWhilePending = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_ID, 'prod_bline_1').stock;
  assert.equal(stockWhilePending, 100, 'Pending cash order must NOT deduct stock before merchant acceptance');

  // Table hold created for payment/acceptance stage
  DiningTableService.holdTablesForPayment({
    branch_id: BRANCH_ID,
    table_id: TABLE_T1,
    customer_phone: CUST_PHONE,
    hold_reference_id: order.id,
    channel: 'customer_app'
  });

  // Verify Table T1 is HELD, NOT OCCUPIED
  const t1State = diningRepo.findTableState(TABLE_T1);
  assert.equal(t1State.operational_state, 'held', 'Table state must be held, not occupied');
  assert.equal(t1State.current_session_id, null, 'No session attached yet');

  // Verify no active dining session exists
  const activeSess = diningRepo.findActiveSessionByCustomer(BRANCH_ID, CUST_PHONE);
  assert.ok(!activeSess, 'Dining session must NOT be active before merchant acceptance');

  // Step 2: Customer cannot hold another table while holding T1
  assert.throws(() => {
    DiningTableService.holdTablesForPayment({
      branch_id: BRANCH_ID,
      table_id: TABLE_T2,
      customer_phone: CUST_PHONE,
      hold_reference_id: 'diff_order_999',
      channel: 'customer_app'
    });
  }, /CUSTOMER_PENDING_HOLD_EXISTS/);

  // Step 3: Merchant Accepts Order via actual HTTP Endpoint (POST /api/v1/orders/:id/branch-acceptance)
  const httpRes = await request('POST', `/orders/${order.id}/branch-acceptance`, {
    decision: 'accept',
    note: 'Diterima oleh Kasir Resto'
  }, {
    Authorization: `Bearer ${bmToken}`
  });

  assert.equal(httpRes.status, 200);
  assert.equal(httpRes.data.success, true);
  assert.equal(httpRes.data.new_status, 'confirmed');
  assert.ok(httpRes.data.dining_session_id, 'Accept response must return active dining_session_id');

  const sessionId = httpRes.data.dining_session_id;

  // Verify Table T1 is now OCCUPIED by active session
  const t1AfterAccept = diningRepo.findTableState(TABLE_T1);
  assert.equal(t1AfterAccept.operational_state, 'occupied', 'Table must be occupied after merchant acceptance');
  assert.equal(t1AfterAccept.current_session_id, sessionId);

  // Verify Dining Session is ACTIVE
  const sessionRow = diningRepo.findDiningSessionById(sessionId);
  assert.equal(sessionRow.status, 'active');

  // Verify stock is now deducted upon merchant acceptance (100 -> 99)
  const stockAfterAccept = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_ID, 'prod_bline_1').stock;
  assert.equal(stockAfterAccept, 99, 'Stock must be deducted upon merchant acceptance');

  // Verify inventory movement record exists
  const movement = db.prepare('SELECT * FROM inventory_movements WHERE reference_id = ?').get(order.order_number);
  assert.ok(movement, 'Inventory movement must be recorded for accepted order');
  assert.equal(Math.abs(movement.quantity), 1);

  // Step 4: Add-on order attaches to existing active session
  const addonRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_ID,
    customer: { name: 'Customer T1', phone: CUST_PHONE },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_id: TABLE_T1
  });

  assert.equal(addonRes.success, true);
  assert.equal(addonRes.order.dining_session_id, sessionId, 'Addon order must attach to active session');

  // Cleanup session
  DiningTableService.completeDiningSession(sessionId);
  const t1Clean = diningRepo.findTableState(TABLE_T1);
  assert.equal(t1Clean.operational_state, 'available');
});

test('Baseline 3: Merchant Accept via HTTP is atomic: fails if table is already occupied by another customer; order remains pending and stock untouched', async () => {
  const custBPhone = '081299990002';
  const stockBefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_ID, 'prod_bline_1').stock;

  // Step 1: Customer B places order for Table T2 (Order pending, hold created)
  const orderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_ID,
    customer: { name: 'Customer B', phone: custBPhone },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_id: TABLE_T2
  });

  assert.equal(orderRes.success, true);
  const orderB = orderRes.order;
  assert.equal(orderB.status, 'pending');

  DiningTableService.holdTablesForPayment({
    branch_id: BRANCH_ID,
    table_id: TABLE_T2,
    customer_phone: custBPhone,
    hold_reference_id: orderB.id,
    channel: 'customer_app'
  });

  // Step 2: In between, Customer B's hold expires and Table T2 is occupied by another customer's active session
  DiningTableService.releaseHold({
    branch_id: BRANCH_ID,
    hold_reference_id: orderB.id,
    reason: 'expired'
  });

  const otherSession = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_ID,
    table_id: TABLE_T2,
    customer_name: 'Walk-in Guest',
    customer_phone: '081299998888',
    guest_count: 2,
    channel: 'pos_cashier'
  });
  assert.equal(diningRepo.findTableState(TABLE_T2).operational_state, 'occupied');

  // Step 3: Merchant tries to accept Customer B's order via HTTP endpoint
  const httpRes = await request('POST', `/orders/${orderB.id}/branch-acceptance`, {
    decision: 'accept',
    note: 'Attempting to accept'
  }, {
    Authorization: `Bearer ${bmToken}`
  });

  // HTTP response must be 400 Bad Request
  assert.equal(httpRes.status, 400);
  assert.equal(httpRes.data.success, false);
  assert.ok(httpRes.data.error.includes('TABLE_ALREADY_OCCUPIED') || httpRes.data.error.includes('sedang digunakan'));

  // Invariant check: Order status must REMAIN pending! (Atomic rejection on table collision)
  const orderAfterFailedAccept = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderB.id);
  assert.equal(orderAfterFailedAccept.status, 'pending', 'Order must NOT be confirmed if Dining Session creation fails');

  // Invariant check: Stock must NOT be deducted!
  const stockAfterFailedAccept = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_ID, 'prod_bline_1').stock;
  assert.equal(stockAfterFailedAccept, stockBefore, 'Stock must NOT be deducted if accept fails');

  // Cleanup the other session
  DiningTableService.completeDiningSession(otherSession.session_id);
  assert.equal(diningRepo.findTableState(TABLE_T2).operational_state, 'available');
});

test('Baseline 4: Merchant Reject via HTTP releases table hold back to available; order rejected; stock untouched', async () => {
  const custPhone = '081299990003';
  const stockBefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_ID, 'prod_bline_1').stock;

  const orderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_ID,
    customer: { name: 'Customer T3', phone: custPhone },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_id: TABLE_T3
  });

  assert.equal(orderRes.success, true);
  const order = orderRes.order;

  DiningTableService.holdTablesForPayment({
    branch_id: BRANCH_ID,
    table_id: TABLE_T3,
    customer_phone: custPhone,
    hold_reference_id: order.id,
    channel: 'customer_app'
  });

  assert.equal(diningRepo.findTableState(TABLE_T3).operational_state, 'held');

  // Merchant Rejects Order via actual HTTP Endpoint
  const httpRes = await request('POST', `/orders/${order.id}/branch-acceptance`, {
    decision: 'reject',
    reason: 'Customer did not arrive'
  }, {
    Authorization: `Bearer ${bmToken}`
  });

  assert.equal(httpRes.status, 200);
  assert.equal(httpRes.data.success, true);
  assert.equal(httpRes.data.new_status, 'rejected');

  // Verify Table state in DB: must be 'available' (hold released!)
  const t3State = diningRepo.findTableState(TABLE_T3);
  assert.equal(t3State.operational_state, 'available', 'Table must return to available after rejection');
  assert.equal(t3State.current_session_id, null);

  // Verify stock was NOT deducted
  const stockAfter = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_ID, 'prod_bline_1').stock;
  assert.equal(stockAfter, stockBefore);
});

test('Baseline 5: Customer Cancel releases table hold back to available', async () => {
  const custPhone = '081299990004';
  const orderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_ID,
    customer: { name: 'Customer T3', phone: custPhone },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_id: TABLE_T3
  });

  assert.equal(orderRes.success, true);
  const order = orderRes.order;

  DiningTableService.holdTablesForPayment({
    branch_id: BRANCH_ID,
    table_id: TABLE_T3,
    customer_phone: custPhone,
    hold_reference_id: order.id,
    channel: 'customer_app'
  });

  assert.equal(diningRepo.findTableState(TABLE_T3).operational_state, 'held');

  // Customer cancels
  OrderStateMachine.transition({
    order_id: order.id,
    target_status: 'cancelled',
    actor_type: 'customer',
    actor_id: custPhone,
    note: '[CUSTOMER_CANCEL] Change mind'
  });

  DiningTableService.releaseHold({
    branch_id: BRANCH_ID,
    hold_reference_id: order.id,
    reason: 'cancelled'
  });

  const t3State = diningRepo.findTableState(TABLE_T3);
  assert.equal(t3State.operational_state, 'available', 'Table must return to available after customer cancel');
});

test('Baseline 6: Acceptance Timeout releases table hold back to available', async () => {
  const custPhone = '081299990005';
  const orderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_ID,
    customer: { name: 'Customer T4', phone: custPhone },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_id: TABLE_T4
  });

  assert.equal(orderRes.success, true);
  const order = orderRes.order;

  DiningTableService.holdTablesForPayment({
    branch_id: BRANCH_ID,
    table_id: TABLE_T4,
    customer_phone: custPhone,
    hold_reference_id: order.id,
    channel: 'customer_app'
  });

  assert.equal(diningRepo.findTableState(TABLE_T4).operational_state, 'held');

  // Acceptance timeout applies
  OrderStateMachine.transition({
    order_id: order.id,
    target_status: 'timeout',
    actor_type: 'system',
    actor_id: 'acceptance_timeout_worker',
    note: '[BRANCH_TIMEOUT]'
  });

  DiningTableService.releaseHold({
    branch_id: BRANCH_ID,
    hold_reference_id: order.id,
    reason: 'timeout'
  });

  const t4State = diningRepo.findTableState(TABLE_T4);
  assert.equal(t4State.operational_state, 'available', 'Table must return to available after timeout');
});

test('Baseline 7: Concurrent double-click Accept requests execute atomically without destroying active session', async () => {
  const custPhone = '081299990007';
  const stockBefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_ID, 'prod_bline_1').stock;

  // Step 1: Customer creates cash order for Table T5
  const orderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_ID,
    customer: { name: 'Customer T5', phone: custPhone },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_id: TABLE_T5
  });

  assert.equal(orderRes.success, true);
  const order = orderRes.order;
  assert.equal(order.status, 'pending');

  DiningTableService.holdTablesForPayment({
    branch_id: BRANCH_ID,
    table_id: TABLE_T5,
    customer_phone: custPhone,
    hold_reference_id: order.id,
    channel: 'customer_app'
  });

  assert.equal(diningRepo.findTableState(TABLE_T5).operational_state, 'held');

  // Step 2: Simulate concurrent double-click / simultaneous accept calls
  const [res1, res2] = await Promise.all([
    request('POST', `/orders/${order.id}/branch-acceptance`, {
      decision: 'accept',
      note: 'Accept request 1'
    }, {
      Authorization: `Bearer ${bmToken}`
    }),
    request('POST', `/orders/${order.id}/branch-acceptance`, {
      decision: 'accept',
      note: 'Accept request 2'
    }, {
      Authorization: `Bearer ${bmToken}`
    })
  ]);

  // Both requests must return 200 OK
  assert.equal(res1.status, 200, 'Request 1 should succeed');
  assert.equal(res2.status, 200, 'Request 2 should succeed (idempotent duplicate)');

  // Verify order status in DB is confirmed
  const orderInDb = db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id);
  assert.equal(orderInDb.status, 'confirmed');

  // Verify Table T5 is OCCUPIED (CRITICAL: Active session must NOT be closed/completed by the duplicate request!)
  const t5State = diningRepo.findTableState(TABLE_T5);
  assert.equal(t5State.operational_state, 'occupied', 'Table must remain occupied');
  assert.ok(t5State.current_session_id, 'Table must have active session attached');

  // Verify Dining Session is ACTIVE
  const activeSession = diningRepo.findDiningSessionById(t5State.current_session_id);
  assert.ok(activeSession, 'Active session must exist in DB');
  assert.equal(activeSession.status, 'active', 'Active session must NOT be completed by duplicate accept');

  // Verify stock was deducted EXACTLY ONCE (stockBefore - 1)
  const stockAfter = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_ID, 'prod_bline_1').stock;
  assert.equal(stockAfter, stockBefore - 1, 'Stock must be deducted exactly once despite concurrent accept requests');

  // Cleanup session
  DiningTableService.completeDiningSession(activeSession.id);
  assert.equal(diningRepo.findTableState(TABLE_T5).operational_state, 'available');
});

