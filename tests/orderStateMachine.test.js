const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const db = require('../server/database/db');
const OrderStateMachine = require('../server/services/OrderStateMachine');

test('OrderStateMachine: enforces strict transition rules', () => {
  assert.strictEqual(OrderStateMachine.canTransition('pending', 'confirmed'), true);
  assert.strictEqual(OrderStateMachine.canTransition('pending', 'preparing'), false); // Cannot jump pending -> preparing directly
  assert.strictEqual(OrderStateMachine.canTransition('confirmed', 'preparing'), true);
  assert.strictEqual(OrderStateMachine.canTransition('preparing', 'ready'), true);
  assert.strictEqual(OrderStateMachine.canTransition('ready', 'out_for_delivery'), true);
  assert.strictEqual(OrderStateMachine.canTransition('out_for_delivery', 'completed'), true);
  assert.strictEqual(OrderStateMachine.canTransition('completed', 'pending'), false); // Cannot revert completed to pending
  // P1 SEPARATION OF CONCERNS: Operational state machine strictly excludes financial 'refunded'
  assert.strictEqual(OrderStateMachine.canTransition('confirmed', 'refunded'), false);
  assert.strictEqual(OrderStateMachine.canTransition('completed', 'refunded'), false);
});

test('OrderStateMachine: transitions order and inserts audit log', () => {
  const orderId = 'test_ord_' + crypto.randomBytes(4).toString('hex');
  const orderNum = 'TEST-' + crypto.randomBytes(4).toString('hex');
  
  // Insert test order
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_barat', 'Pelanggan Test', '081234567890', 'delivery', 'pending', 50000, 50000)
  `).run(orderId, orderNum);

  // Transition to confirmed
  const res1 = OrderStateMachine.transition({
    order_id: orderId,
    target_status: 'confirmed',
    actor_type: 'system',
    note: 'Payment captured'
  });

  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.new_status, 'confirmed');

  // Verify in DB
  const updatedOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(updatedOrder.status, 'confirmed');

  // Verify Audit Log
  const logs = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ?').all(orderId);
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].previous_status, 'pending');
  assert.strictEqual(logs[0].new_status, 'confirmed');
  assert.strictEqual(logs[0].note, 'Payment captured');
});

test('OrderStateMachine: strictly rejects operational cancellation on order with settled payment (NEW-01)', () => {
  const orderId = 'test_ord_paid_' + crypto.randomBytes(4).toString('hex');
  const orderNum = 'TEST-PAID-' + crypto.randomBytes(4).toString('hex');
  
  // Insert confirmed order with settled payment
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_barat', 'Pelanggan Lunas', '081234567890', 'delivery', 'confirmed', 75000, 75000)
  `).run(orderId, orderNum);

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_status, amount)
    VALUES (?, ?, 'midtrans', 'settlement', 75000)
  `).run('pay_' + crypto.randomBytes(4).toString('hex'), orderId);

  // Attempt operational cancellation -> STRICTLY REJECTED by Financial Guard
  assert.throws(() => {
    OrderStateMachine.transition({
      order_id: orderId,
      target_status: 'cancelled',
      actor_type: 'staff',
      actor_id: 'mgr_andi',
      note: 'Bahan mendadak habis'
    });
  }, /ORDER_ALREADY_PAID/);

  // Verify status remains confirmed
  const orderAfter = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(orderAfter.status, 'confirmed');
});

// ============================================================================
// R5 BRANCH ACCEPTANCE — state machine contract
// pending (AWAITING_BRANCH_ACCEPTANCE) → confirmed (ACCEPTED) | rejected
// (REJECTED). 'rejected' is terminal and DISTINCT from customer 'cancelled'.
// ============================================================================

test('R5 OrderStateMachine: pending → rejected is valid; rejected is terminal; confirmed → rejected is invalid', () => {
  assert.strictEqual(OrderStateMachine.canTransition('pending', 'confirmed'), true, 'ACCEPT from AWAITING');
  assert.strictEqual(OrderStateMachine.canTransition('pending', 'rejected'), true, 'REJECT from AWAITING');
  assert.strictEqual(OrderStateMachine.canTransition('confirmed', 'rejected'), false, 'an ACCEPTED order cannot be REJECTED');
  assert.strictEqual(OrderStateMachine.canTransition('rejected', 'confirmed'), false, 'REJECTED cannot become ACCEPTED');
  assert.strictEqual(OrderStateMachine.canTransition('rejected', 'preparing'), false, 'REJECTED never enters fulfillment');
  assert.strictEqual(OrderStateMachine.canTransition('rejected', 'cancelled'), false, 'REJECTED stays REJECTED (never rewritten as customer cancellation)');
  assert.strictEqual(OrderStateMachine.canTransition('pending', 'cancelled'), true, 'customer cancellation remains a separate path');
});

test('R5 OrderStateMachine: pending → rejected is atomic and audited with the branch actor', () => {
  const orderId = 'r5_ord_reject_' + crypto.randomBytes(4).toString('hex');
  const orderNum = 'R5-REJ-' + crypto.randomBytes(4).toString('hex');

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_barat', 'Pelanggan R5', '081200000040', 'delivery', 'pending', 40000, 40000)
  `).run(orderId, orderNum);

  const res = OrderStateMachine.transition({
    order_id: orderId,
    target_status: 'rejected',
    actor_type: 'branch_actor',
    actor_id: 'usr_bm_r5',
    note: '[REJECT by branch_manager:usr_bm_r5] Stok bahan habis di cabang'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.previous_status, 'pending');
  assert.strictEqual(res.new_status, 'rejected');

  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(order.status, 'rejected');

  const logs = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ?').all(orderId);
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].previous_status, 'pending');
  assert.strictEqual(logs[0].new_status, 'rejected');
  assert.strictEqual(logs[0].actor_type, 'branch_actor');
  assert.strictEqual(logs[0].actor_id, 'usr_bm_r5');
  assert.ok(logs[0].note.includes('[REJECT by branch_manager'), 'audit carries actor + decision');
  assert.ok(logs[0].note.includes('Stok bahan habis'), 'audit carries the rejection reason');
  assert.ok(logs[0].created_at, 'audit is timestamped');

  // Terminal: any later transition is rejected.
  assert.throws(() => {
    OrderStateMachine.transition({ order_id: orderId, target_status: 'confirmed', actor_type: 'branch_actor', actor_id: 'usr_bm_r5' });
  }, /tidak valid/);
});

test('R5 OrderStateMachine: branch REJECTION of an order with a settled payment is blocked (refund flow first)', () => {
  const orderId = 'r5_ord_paid_' + crypto.randomBytes(4).toString('hex');
  const orderNum = 'R5-PAID-' + crypto.randomBytes(4).toString('hex');

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_barat', 'Pelanggan Lunas R5', '081200000041', 'delivery', 'pending', 60000, 60000)
  `).run(orderId, orderNum);
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_status, amount)
    VALUES (?, ?, 'midtrans', 'settlement', 60000)
  `).run('pay_' + crypto.randomBytes(4).toString('hex'), orderId);

  assert.throws(() => {
    OrderStateMachine.transition({
      order_id: orderId,
      target_status: 'rejected',
      actor_type: 'branch_actor',
      actor_id: 'usr_bm_r5',
      note: '[REJECT by branch_manager:usr_bm_r5] Cabang tidak sanggup melayani'
    });
  }, /ORDER_ALREADY_PAID/);

  const orderAfter = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(orderAfter.status, 'pending', 'state unchanged after blocked rejection');
  const logs = db.prepare('SELECT COUNT(*) AS c FROM order_status_logs WHERE order_id = ?').get(orderId);
  assert.strictEqual(logs.c, 0, 'no audit entry for a blocked rejection');
});

// ============================================================================
// R6 ACCEPTANCE TIMEOUT — state machine contract
// pending (AWAITING_BRANCH_ACCEPTANCE) → 'timeout' (BRANCH_TIMEOUT) applied
// by the server-authoritative AcceptanceTimeoutService; 'timeout' is terminal
// and distinct from 'rejected'/'cancelled'. ACCEPT vs TIMEOUT is resolved by
// the atomic transition (only one valid transition may win).
// ============================================================================

test('R6 OrderStateMachine: pending → timeout is valid; timeout is terminal and never rewritten', () => {
  assert.strictEqual(OrderStateMachine.canTransition('pending', 'timeout'), true, 'TIMEOUT from AWAITING');
  assert.strictEqual(OrderStateMachine.canTransition('timeout', 'confirmed'), false, 'timed-out order can never become ACCEPTED');
  assert.strictEqual(OrderStateMachine.canTransition('timeout', 'rejected'), false, 'timed-out order is never rewritten as branch reject');
  assert.strictEqual(OrderStateMachine.canTransition('timeout', 'cancelled'), false, 'timed-out order is never rewritten as customer cancellation');
  assert.strictEqual(OrderStateMachine.canTransition('confirmed', 'timeout'), false, 'an ACCEPTED order cannot time out');
});

test('R6 OrderStateMachine: pending → timeout is atomic and audited as system BRANCH_TIMEOUT', () => {
  const orderId = 'r6_ord_to_' + crypto.randomBytes(4).toString('hex');
  const orderNum = 'R6-TO-' + crypto.randomBytes(4).toString('hex');

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, created_at, subtotal, grand_total)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_barat', 'Pelanggan R6', '081200000060', 'delivery', 'pending', datetime('now','-200 seconds'), 45000, 45000)
  `).run(orderId, orderNum);

  const res = OrderStateMachine.transition({
    order_id: orderId,
    target_status: 'timeout',
    actor_type: 'system',
    actor_id: 'acceptance_timeout_worker',
    note: '[BRANCH_TIMEOUT] Tidak ada penerimaan cabang dalam 3 menit (kebijakan platform Xentra).'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.previous_status, 'pending');
  assert.strictEqual(res.new_status, 'timeout');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'timeout');

  const log = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ?').get(orderId);
  assert.strictEqual(log.previous_status, 'pending');
  assert.strictEqual(log.new_status, 'timeout');
  assert.strictEqual(log.actor_type, 'system');
  assert.strictEqual(log.actor_id, 'acceptance_timeout_worker');
  assert.ok(log.note.includes('[BRANCH_TIMEOUT]'), 'audit keeps BRANCH_TIMEOUT distinct');

  // Duplicate timeout execution must not corrupt state (second attempt throws).
  assert.throws(() => {
    OrderStateMachine.transition({ order_id: orderId, target_status: 'timeout', actor_type: 'system', actor_id: 'acceptance_timeout_worker' });
  }, /tidak valid/);
});

test('R6 OrderStateMachine: ACCEPT vs TIMEOUT race — the first valid transition wins, the loser fails cleanly', () => {
  const orderId = 'r6_ord_race_' + crypto.randomBytes(4).toString('hex');
  const orderNum = 'R6-RACE-' + crypto.randomBytes(4).toString('hex');

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, created_at, subtotal, grand_total)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_barat', 'Pelanggan Race', '081200000061', 'delivery', 'pending', datetime('now','-200 seconds'), 45000, 45000)
  `).run(orderId, orderNum);

  // Simulate ACCEPT committing first.
  OrderStateMachine.transition({ order_id: orderId, target_status: 'confirmed', actor_type: 'branch_actor', actor_id: 'usr_bm_r6' });

  // TIMEOUT afterwards must be rejected — no silent double transition.
  assert.throws(() => {
    OrderStateMachine.transition({ order_id: orderId, target_status: 'timeout', actor_type: 'system', actor_id: 'acceptance_timeout_worker' });
  }, /tidak valid/);

  const order = db.prepare('SELECT status, branch_id FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(order.status, 'confirmed', 'ACCEPT won the race');
  assert.strictEqual(order.branch_id, 'branch_bangjo_barat', 'order stays on its original branch');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM order_status_logs WHERE order_id = ?').get(orderId).c, 1, 'exactly one audit entry');
});

test('R6 OrderStateMachine: auto-timeout of an order with a settled payment is blocked (refund flow first)', () => {
  const orderId = 'r6_ord_paid_' + crypto.randomBytes(4).toString('hex');
  const orderNum = 'R6-PAID-' + crypto.randomBytes(4).toString('hex');

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_barat', 'Pelanggan Lunas R6', '081200000062', 'delivery', 'pending', 50000, 50000)
  `).run(orderId, orderNum);
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_status, amount)
    VALUES (?, ?, 'midtrans', 'settlement', 50000)
  `).run('pay_' + crypto.randomBytes(4).toString('hex'), orderId);

  assert.throws(() => {
    OrderStateMachine.transition({
      order_id: orderId,
      target_status: 'timeout',
      actor_type: 'system',
      actor_id: 'acceptance_timeout_worker'
    });
  }, /ORDER_ALREADY_PAID/);

  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'pending');
});

// ============================================================================
// R11 RACE GUARD — expected_current_status (TOCTOU protection)
// ============================================================================

test('R11 race guard: customer cancel with expected_current_status=pending fails [STATE_CHANGED] when ACCEPT already committed', () => {
  const orderId = 'r11_ord_race_' + crypto.randomBytes(4).toString('hex');
  const orderNum = 'R11-RACE-' + crypto.randomBytes(4).toString('hex');

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_barat', 'Pelanggan R11', '081200000090', 'delivery', 'confirmed', 40000, 40000)
  `).run(orderId, orderNum);

  // Customer cancel races ACCEPT; ACCEPT won and the order is now 'confirmed'.
  // The cancel's expected_current_status ('pending') no longer matches — it
  // must FAIL instead of cancelling an ACCEPTED order (machine allows
  // confirmed→cancelled for managers, so this guard is what protects R7).
  assert.throws(() => {
    OrderStateMachine.transition({
      order_id: orderId,
      target_status: 'cancelled',
      actor_type: 'customer',
      actor_id: '081200000090',
      note: '[CUSTOMER_CANCEL] batal',
      expected_current_status: 'pending'
    });
  }, /STATE_CHANGED/);

  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(order.status, 'confirmed', 'ACCEPTED order survives the racing customer cancel');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM order_status_logs WHERE order_id = ?').get(orderId).c, 0, 'no audit row for the blocked cancel');
});

test('R11 race guard: expected_current_status matching the actual state still allows the transition', () => {
  const orderId = 'r11_ord_ok_' + crypto.randomBytes(4).toString('hex');
  const orderNum = 'R11-OK-' + crypto.randomBytes(4).toString('hex');

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_barat', 'Pelanggan R11 Ok', '081200000091', 'delivery', 'pending', 40000, 40000)
  `).run(orderId, orderNum);

  const res = OrderStateMachine.transition({
    order_id: orderId,
    target_status: 'cancelled',
    actor_type: 'customer',
    actor_id: '081200000091',
    note: '[CUSTOMER_CANCEL] batal',
    expected_current_status: 'pending'
  });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.new_status, 'cancelled');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'cancelled');
});
