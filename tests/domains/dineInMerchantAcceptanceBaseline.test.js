'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../../server/database/db');
const { DiningTableService } = require('../../domains/pos');
const { DiningTableRepository } = require('../../core/data/repositories');
const { OrderPlacementService } = require('../../domains/commerce');
const OrderStateMachine = require('../../server/services/OrderStateMachine');
const AcceptanceTimeoutService = require('../../server/services/AcceptanceTimeoutService');

const diningRepo = new DiningTableRepository();

const BRAND_ID = 'brand_accept_test';
const BRANCH_ID = 'branch_accept_test';

const TABLE_T1 = `tbl_bline_t1_${Date.now()}`;
const TABLE_T2 = `tbl_bline_t2_${Date.now()}`;
const TABLE_T3 = `tbl_bline_t3_${Date.now()}`;
const TABLE_T4 = `tbl_bline_t4_${Date.now()}`;

const CUST_PHONE = '081299112233';

function makeItems() {
  return [{
    product_id: 'prod_bline_1',
    quantity: 1,
    unit_price: 35000,
    product_name: 'Nasi Goreng Spesial',
    subtotal: 35000
  }];
}

test.before(() => {
  db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_accept_test', 'Org Accept', 'org-accept')`).run();
  db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, 'org_accept_test', 'Brand Accept', 'brand-accept')`).run(BRAND_ID);
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Cabang Accept', 'cab-accept', 'Jl. Accept', -6.2, 106.8)`).run(BRANCH_ID, BRAND_ID);

  // Seed test tables
  const tables = [
    { id: TABLE_T1, num: 'T1' },
    { id: TABLE_T2, num: 'T2' },
    { id: TABLE_T3, num: 'T3' },
    { id: TABLE_T4, num: 'T4' }
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

test('Baseline 2: Customer Dine-in Flow: Order -> Hold/Pending -> Merchant Accept -> Active Session', async () => {
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

  // Step 2: Customer cannot hold another table while holding T1 (Scenario 9/13)
  assert.throws(() => {
    DiningTableService.holdTablesForPayment({
      branch_id: BRANCH_ID,
      table_id: TABLE_T2,
      customer_phone: CUST_PHONE,
      hold_reference_id: 'diff_order_999',
      channel: 'customer_app'
    });
  }, /CUSTOMER_PENDING_HOLD_EXISTS/);

  // Step 3: Merchant Accepts Order (POST /orders/:id/branch-acceptance decision: accept)
  const transitionRes = OrderStateMachine.transition({
    order_id: order.id,
    target_status: 'confirmed',
    actor_type: 'branch_actor',
    actor_id: 'mgr_test',
    note: '[ACCEPT by branch_manager:mgr_test]'
  });
  assert.equal(transitionRes.success, true);

  // On accept: createOrAttachDiningSession activates the session and marks table occupied
  const sessionResult = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_ID,
    table_id: TABLE_T1,
    order_id: order.id,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    guest_count: 1,
    hold_reference_id: order.id,
    channel: 'customer_app'
  });

  assert.ok(sessionResult.session_id);
  assert.equal(sessionResult.status, 'active');

  // Verify Table T1 is now OCCUPIED by active session
  const t1AfterAccept = diningRepo.findTableState(TABLE_T1);
  assert.equal(t1AfterAccept.operational_state, 'occupied', 'Table must be occupied after merchant acceptance');
  assert.equal(t1AfterAccept.current_session_id, sessionResult.session_id);

  // Step 4: Add-on order (Scenario 5) attaches to existing active session
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
  assert.equal(addonRes.order.dining_session_id, sessionResult.session_id, 'Addon order must attach to active session');

  // Cleanup session
  DiningTableService.completeDiningSession(sessionResult.session_id);
  const t1Clean = diningRepo.findTableState(TABLE_T1);
  assert.equal(t1Clean.operational_state, 'available');
});

test('Baseline 3: Merchant Reject releases table hold back to available', async () => {
  const custPhone = '081299990003';
  const orderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_ID,
    customer: { name: 'Customer T2', phone: custPhone },
    items: makeItems(),
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_id: TABLE_T2
  });

  assert.equal(orderRes.success, true);
  const order = orderRes.order;

  DiningTableService.holdTablesForPayment({
    branch_id: BRANCH_ID,
    table_id: TABLE_T2,
    customer_phone: custPhone,
    hold_reference_id: order.id,
    channel: 'customer_app'
  });

  assert.equal(diningRepo.findTableState(TABLE_T2).operational_state, 'held');

  // Merchant Rejects Order
  OrderStateMachine.transition({
    order_id: order.id,
    target_status: 'rejected',
    actor_type: 'branch_actor',
    actor_id: 'mgr_test',
    note: '[REJECT by branch_manager:mgr_test] Customer did not arrive'
  });

  // Release hold
  DiningTableService.releaseHold({
    branch_id: BRANCH_ID,
    hold_reference_id: order.id,
    reason: 'rejected'
  });

  const t2State = diningRepo.findTableState(TABLE_T2);
  assert.equal(t2State.operational_state, 'available', 'Table must return to available after rejection');
  assert.equal(t2State.current_session_id, null);
});

test('Baseline 4: Customer Cancel releases table hold back to available', async () => {
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

test('Baseline 5: Acceptance Timeout releases table hold back to available', async () => {
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
