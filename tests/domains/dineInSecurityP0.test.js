'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../../server/database/db');
const { DiningTableService } = require('../../domains/dining');
const OrderPlacementService = require('../../domains/commerce/services/OrderPlacementService');

const ORG_ID = 'org_dine_sec';
const BRAND_ID = 'brand_dine_sec';
const BRANCH_A = 'branch_dine_sec_a';
const BRANCH_B = 'branch_dine_sec_b';

const TABLE_A1 = 'tbl_sec_a1';
const TABLE_A2 = 'tbl_sec_a2';
const TABLE_B1 = 'tbl_sec_b1';

const CUST_A_PHONE = '08111111111';
const CUST_B_PHONE = '08222222222';

test.before(() => {
  try {
    db.prepare(`INSERT OR REPLACE INTO organizations (id, name, slug) VALUES (?, 'Org DineSec', 'org-dinesec')`).run(ORG_ID);
    db.prepare(`INSERT OR REPLACE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Brand DineSec', 'brand-dinesec')`).run(BRAND_ID, ORG_ID);
    db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Cabang A', 'cabang-a', 'Jl. A', -7.25, 112.75)`).run(BRANCH_A, BRAND_ID);
    db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Cabang B', 'cabang-b', 'Jl. B', -7.26, 112.76)`).run(BRANCH_B, BRAND_ID);

    // Seed test product for OrderPlacementService
    db.prepare(`INSERT OR REPLACE INTO products (id, brand_id, name, slug, price, is_active) VALUES ('prod_sec_1', ?, 'Menu DineSec 1', 'menu-dinesec-1', 25000, 1)`).run(BRAND_ID);
    db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, 'prod_sec_1', 25000, 100, 1)`).run(BRANCH_A);
    db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, 'prod_sec_1', 25000, 100, 1)`).run(BRANCH_B);

    // Seed tables
    db.prepare(`INSERT OR REPLACE INTO branch_tables (id, branch_id, table_number, label, capacity, is_active) VALUES (?, ?, '1', 'Meja 1', 4, 1)`).run(TABLE_A1, BRANCH_A);
    db.prepare(`INSERT OR REPLACE INTO branch_tables (id, branch_id, table_number, label, capacity, is_active) VALUES (?, ?, '2', 'Meja 2', 4, 1)`).run(TABLE_A2, BRANCH_A);
    db.prepare(`INSERT OR REPLACE INTO branch_tables (id, branch_id, table_number, label, capacity, is_active) VALUES (?, ?, '1', 'Meja 1 Cabang B', 4, 1)`).run(TABLE_B1, BRANCH_B);

    db.prepare(`INSERT OR REPLACE INTO branch_table_states (table_id, operational_state, current_session_id) VALUES (?, 'available', NULL)`).run(TABLE_A1);
    db.prepare(`INSERT OR REPLACE INTO branch_table_states (table_id, operational_state, current_session_id) VALUES (?, 'available', NULL)`).run(TABLE_A2);
    db.prepare(`INSERT OR REPLACE INTO branch_table_states (table_id, operational_state, current_session_id) VALUES (?, 'available', NULL)`).run(TABLE_B1);
  } catch (err) {
    console.error('Test before error:', err.message);
  }
});

// Helper to create simple items array
function makeItems() {
  return [{ product_id: 'prod_sec_1', name: 'Menu DineSec 1', unit_price: 25000, quantity: 1, subtotal: 25000 }];
}

// ── Invariant 1: Customer A → session Customer B = reject ──
test('P0-SEC-01: Customer A cannot attach or join Dining Session owned by Customer B', async () => {
  // Create active session for Customer B on Table A1
  const sessB = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_A,
    table_ids: [TABLE_A1],
    customer_name: 'Customer B',
    customer_phone: CUST_B_PHONE,
    channel: 'customer_app'
  });
  assert.ok(sessB.session_id);

  // Attempt 1 via Service: Customer A attempts to attach using Customer B's session_id
  assert.throws(() => {
    DiningTableService.createOrAttachDiningSession({
      branch_id: BRANCH_A,
      table_ids: [TABLE_A1],
      customer_name: 'Attacker A',
      customer_phone: CUST_A_PHONE,
      session_id: sessB.session_id,
      channel: 'customer_app'
    });
  }, /UNAUTHORIZED_SESSION_ACCESS/);

  // Attempt 2 via OrderPlacementService: Customer A submits order with Customer B's session_id
  const orderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'Attacker A', phone: CUST_A_PHONE },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    dining_session_id: sessB.session_id,
    table_ids: [TABLE_A1]
  });

  assert.equal(orderRes.success, false);
  assert.equal(orderRes.status, 'UNAUTHORIZED_SESSION_ACCESS');

  // Cleanup session B
  DiningTableService.completeDiningSession(sessB.session_id);
});

// ── Invariant 2: Customer A → Table milik session B = reject ──
test('P0-SEC-02: Customer A cannot order on a Table occupied by Customer B active session', async () => {
  const sessB = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_A,
    table_ids: [TABLE_A1],
    customer_name: 'Customer B',
    customer_phone: CUST_B_PHONE,
    channel: 'customer_app'
  });

  const orderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'Customer A', phone: CUST_A_PHONE },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_ids: [TABLE_A1]
  });

  assert.equal(orderRes.success, false);
  assert.equal(orderRes.status, 'TABLE_ALREADY_OCCUPIED');

  DiningTableService.completeDiningSession(sessB.session_id);
});

// ── Invariant 3: Branch mismatch = reject ──
test('P0-SEC-03: Branch mismatch between order, session, or table is rejected', async () => {
  // Session created at Branch B
  const sessB = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_B,
    table_ids: [TABLE_B1],
    customer_name: 'Customer A',
    customer_phone: CUST_A_PHONE,
    channel: 'customer_app'
  });

  // Order placed at Branch A referencing session from Branch B
  const sessMismatchRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'Customer A', phone: CUST_A_PHONE },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    dining_session_id: sessB.session_id,
    table_ids: [TABLE_A1]
  });
  assert.equal(sessMismatchRes.success, false);
  assert.equal(sessMismatchRes.status, 'BRANCH_SESSION_MISMATCH');

  // Order placed at Branch A referencing table from Branch B
  const tableMismatchRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'Customer A', phone: CUST_A_PHONE },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_ids: [TABLE_B1]
  });
  assert.equal(tableMismatchRes.success, false);
  assert.equal(tableMismatchRes.status, 'BRANCH_TABLE_MISMATCH');

  DiningTableService.completeDiningSession(sessB.session_id);
});

// ── Invariant 4: Table/session mismatch = reject ──
test('P0-SEC-04: Specifying a table that does not belong to the active session is rejected', async () => {
  // Session for Customer A is opened on Table A1
  const sessA = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_A,
    table_ids: [TABLE_A1],
    customer_name: 'Customer A',
    customer_phone: CUST_A_PHONE,
    channel: 'customer_app'
  });

  // Order specifies session A but table A2 (which belongs to branch but not session A)
  const mismatchRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'Customer A', phone: CUST_A_PHONE },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    dining_session_id: sessA.session_id,
    table_ids: [TABLE_A2]
  });

  assert.equal(mismatchRes.success, false);
  assert.equal(mismatchRes.status, 'TABLE_SESSION_MISMATCH');

  DiningTableService.completeDiningSession(sessA.session_id);
});

// ── Invariant 5: Completed session reuse = reject ──
test('P0-SEC-05: Completed or closed session cannot be reused for new orders', async () => {
  const sess = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_A,
    table_ids: [TABLE_A1],
    customer_name: 'Customer A',
    customer_phone: CUST_A_PHONE,
    channel: 'customer_app'
  });

  // Complete session
  DiningTableService.completeDiningSession(sess.session_id);

  // Try to place order with completed session
  const reuseRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'Customer A', phone: CUST_A_PHONE },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    dining_session_id: sess.session_id,
    table_ids: [TABLE_A1]
  });

  assert.equal(reuseRes.success, false);
  assert.equal(reuseRes.status, 'COMPLETED_SESSION_REUSE_REJECTED');
});

// ── Invariant 6: Self-transfer = reject ──
test('P0-SEC-06: Customer cannot self-transfer to another table while holding active session', async () => {
  // Customer A is dining at Table A1
  const sessA = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_A,
    table_ids: [TABLE_A1],
    customer_name: 'Customer A',
    customer_phone: CUST_A_PHONE,
    channel: 'customer_app'
  });

  // Customer A attempts to place new order at Table A2 without providing session_id
  const transferRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'Customer A', phone: CUST_A_PHONE },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_ids: [TABLE_A2]
  });

  assert.equal(transferRes.success, false);
  assert.equal(transferRes.status, 'CUSTOMER_TABLE_TRANSFER_FORBIDDEN');

  DiningTableService.completeDiningSession(sessA.session_id);
});

// ── Invariant 7: Customer B concurrent claim table Customer A = reject ──
test('P0-SEC-07: Customer B cannot claim or hold table already occupied by Customer A', async () => {
  const sessA = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_A,
    table_ids: [TABLE_A1],
    customer_name: 'Customer A',
    customer_phone: CUST_A_PHONE,
    channel: 'customer_app'
  });

  // Customer B tries to hold Table A1 for online payment
  assert.throws(() => {
    DiningTableService.holdTablesForPayment({
      branch_id: BRANCH_A,
      table_ids: [TABLE_A1],
      customer_phone: CUST_B_PHONE,
      hold_reference_id: 'hold_b_attempt'
    });
  }, /CONCURRENCY_HOLD_CONFLICT/);

  // Customer B tries to create session on Table A1
  assert.throws(() => {
    DiningTableService.createOrAttachDiningSession({
      branch_id: BRANCH_A,
      table_ids: [TABLE_A1],
      customer_name: 'Customer B',
      customer_phone: CUST_B_PHONE,
      channel: 'customer_app'
    });
  }, /TABLE_ALREADY_OCCUPIED/);

  DiningTableService.completeDiningSession(sessA.session_id);
});

// ── Invariant 8: Duplicate / Concurrent session creation attaches to existing session ──
test('P0-SEC-08: Same customer placing another order on same table attaches to existing session', async () => {
  const sess1 = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_A,
    table_ids: [TABLE_A1],
    customer_name: 'Customer A',
    customer_phone: CUST_A_PHONE,
    channel: 'customer_app'
  });

  const sess2 = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_A,
    table_ids: [TABLE_A1],
    customer_name: 'Customer A',
    customer_phone: CUST_A_PHONE,
    channel: 'customer_app'
  });

  assert.equal(sess1.session_id, sess2.session_id, 'Must attach to existing active session, not duplicate');

  // Verify only 1 active session in database for Customer A at Branch A
  const activeCount = db.prepare("SELECT COUNT(*) as cnt FROM dining_sessions WHERE branch_id = ? AND customer_phone = ? AND status = 'active'")
    .get(BRANCH_A, CUST_A_PHONE).cnt;
  assert.equal(activeCount, 1);

  DiningTableService.completeDiningSession(sess1.session_id);
});

// ── Invariant 9: Unauthorized reassignment = reject ──
test('P0-SEC-09: Unauthorized actor cannot reassign session tables', async () => {
  const sess = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_A,
    table_ids: [TABLE_A1],
    customer_name: 'Customer A',
    customer_phone: CUST_A_PHONE,
    channel: 'customer_app'
  });

  // Call with no actor
  assert.throws(() => {
    DiningTableService.reassignSessionTables({
      session_id: sess.session_id,
      new_table_ids: [TABLE_A2]
    });
  }, /UNAUTHORIZED_REASSIGNMENT/);

  // Call with customer actor
  assert.throws(() => {
    DiningTableService.reassignSessionTables({
      session_id: sess.session_id,
      new_table_ids: [TABLE_A2],
      actor: { role: 'customer', id: 'cust_1' }
    });
  }, /UNAUTHORIZED_REASSIGNMENT/);

  // Call with cashier from wrong branch
  assert.throws(() => {
    DiningTableService.reassignSessionTables({
      session_id: sess.session_id,
      new_table_ids: [TABLE_A2],
      actor: { role: 'cashier', branch_id: BRANCH_B }
    });
  }, /FORBIDDEN_BRANCH_SCOPE/);

  // Authorized staff at same branch succeeds
  const successRes = DiningTableService.reassignSessionTables({
    session_id: sess.session_id,
    new_table_ids: [TABLE_A2],
    actor: { role: 'cashier', branch_id: BRANCH_A }
  });
  assert.equal(successRes.success, true);
  assert.deepEqual(successRes.table_ids, [TABLE_A2]);

  DiningTableService.completeDiningSession(sess.session_id);
});

// ── Invariant 10: Valid existing customer session → additional order = allowed ──
test('P0-SEC-10: Customer with active session can place additional orders on the same table', async () => {
  // First order creates session
  const firstOrderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'Customer A', phone: CUST_A_PHONE },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_ids: [TABLE_A1]
  });

  assert.equal(firstOrderRes.success, true);

  // Create active session in DB attached to first order
  const sess = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_A,
    table_ids: [TABLE_A1],
    order_id: firstOrderRes.order.id,
    customer_name: 'Customer A',
    customer_phone: CUST_A_PHONE,
    channel: 'customer_app'
  });

  // Additional order from Customer A on Table A1
  const addOrderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'Customer A', phone: CUST_A_PHONE },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_ids: [TABLE_A1]
  });

  assert.equal(addOrderRes.success, true);
  assert.equal(addOrderRes.order.dining_session_id, sess.session_id, 'Additional order must attach to active session');

  DiningTableService.completeDiningSession(sess.session_id, 'staff', { force: true });
});
