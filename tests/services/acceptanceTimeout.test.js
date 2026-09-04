/**
 * R6 ACCEPTANCE TIMEOUT — AcceptanceTimeoutService contract
 *
 * Platform policy (NOT Owner/Branch configurable): pending orders older than
 * ACCEPTANCE_TIMEOUT_SECONDS (3 minutes) are transitioned to 'timeout'
 * (BRANCH_TIMEOUT) by the server worker only. Atomic + idempotent; ACCEPT vs
 * TIMEOUT races resolve deterministically; a timed-out order stays on its
 * original branch; orders with a settled payment are never auto-timed-out.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const db = require('../../server/database/db');
const AcceptanceTimeoutService = require('../../server/services/AcceptanceTimeoutService');

function seedOrder(id, { status = 'pending', ageSeconds = -200, settled = false } = {}) {
  const orderNum = 'TO-' + id + '-' + crypto.randomBytes(3).toString('hex');
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, created_at, subtotal, grand_total)
    VALUES (?, ?, 'brand_bangjo', 'branch_bangjo_barat', 'Customer TO', '081200000060', 'delivery', ?, datetime('now', ?), 45000, 45000)
  `).run(id, orderNum, status, `${ageSeconds} seconds`);

  // create-order normally writes a pending order_payments row.
  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_status, amount)
    VALUES (?, ?, 'midtrans', ?, 45000)
  `).run('pay_' + id, id, settled ? 'settlement' : 'pending');
}

test('R6 policy constant: acceptance timeout is a fixed 3-minute platform policy', () => {
  assert.strictEqual(AcceptanceTimeoutService.ACCEPTANCE_TIMEOUT_SECONDS, 180);
});

test('R6 sweep: only overdue pending orders time out — atomic, idempotent, paid orders protected, branch untouched', () => {
  seedOrder('r6s_overdue'); // pending, -200s → eligible
  seedOrder('r6s_fresh', { ageSeconds: -60 }); // pending, within window → kept
  seedOrder('r6s_paid', { settled: true }); // overdue + settled → protected
  seedOrder('r6s_accepted', { status: 'confirmed', ageSeconds: -200 }); // not pending

  const first = AcceptanceTimeoutService.checkAndApplyTimeouts();
  assert.strictEqual(first.timed_out, 1, 'exactly one eligible overdue order timed out');
  assert.strictEqual(first.processed, 2, 'sweep scanned the two pending overdue orders (one skipped: paid)');
  assert.strictEqual(first.skipped, 1, 'the settled-payment order was skipped, not timed out');

  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get('r6s_overdue').status, 'timeout');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get('r6s_fresh').status, 'pending', 'fresh order stays AWAITING');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get('r6s_paid').status, 'pending', 'settled order never auto-times-out');
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = ?').get('r6s_accepted').status, 'confirmed');

  const overdue = db.prepare('SELECT status, branch_id FROM orders WHERE id = ?').get('r6s_overdue');
  assert.strictEqual(overdue.branch_id, 'branch_bangjo_barat', 'timed-out order stays on its ORIGINAL branch');

  const log = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ?').get('r6s_overdue');
  assert.strictEqual(log.previous_status, 'pending');
  assert.strictEqual(log.new_status, 'timeout');
  assert.strictEqual(log.actor_type, 'system');
  assert.strictEqual(log.actor_id, 'acceptance_timeout_worker');
  assert.ok(log.note.includes('[BRANCH_TIMEOUT]'), 'audit keeps BRANCH_TIMEOUT distinct from REJECT/CANCEL');

  // Idempotency: a second sweep transitions nothing new.
  const second = AcceptanceTimeoutService.checkAndApplyTimeouts();
  assert.strictEqual(second.timed_out, 0, 'duplicate timeout execution is a no-op');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM order_status_logs WHERE order_id = ?').get('r6s_overdue').c, 1);
});

test('R6 sweep: ACCEPT racing ahead of the timeout sweep wins deterministically', () => {
  seedOrder('r6s_race', { ageSeconds: -200 });
  const OrderStateMachine = require('../../server/services/OrderStateMachine');

  // Branch ACCEPT commits first (as if the actor acted just before the sweep).
  OrderStateMachine.transition({
    order_id: 'r6s_race',
    target_status: 'confirmed',
    actor_type: 'branch_actor',
    actor_id: 'usr_bm_r6'
  });

  const sweep = AcceptanceTimeoutService.checkAndApplyTimeouts();
  assert.strictEqual(sweep.timed_out, 0, 'timed-out count excludes the accepted order');
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get('r6s_race');
  assert.strictEqual(order.status, 'confirmed', 'ACCEPT won; no silent timeout afterwards');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM order_status_logs WHERE order_id = ?').get('r6s_race').c, 1);
});
