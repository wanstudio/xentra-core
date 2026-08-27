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
});

test('OrderStateMachine: transitions order and inserts audit log', () => {
  const orderId = 'test_ord_' + crypto.randomBytes(4).toString('hex');
  const orderNum = 'TEST-' + crypto.randomBytes(4).toString('hex');
  
  // Insert test order
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_phone, order_type, status, subtotal, grand_total)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_barat', '081234567890', 'delivery', 'pending', 50000, 50000)
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
