/**
 * Xentra Acceptance Timeout Service (R6)
 *
 * Platform-controlled acceptance timeout policy.
 */
'use strict';

const db = require('../../core/data/DataAccess');
const OrderStateMachine = require('./OrderStateMachine');

const ACCEPTANCE_TIMEOUT_SECONDS = 180;

function findOverduePendingOrders() {
  return db.prepare(`
    SELECT id, status, branch_id, created_at
    FROM orders
    WHERE status = 'pending'
      AND created_at <= datetime('now', ?)
    ORDER BY created_at ASC
  `).all(`-${ACCEPTANCE_TIMEOUT_SECONDS} seconds`);
}

function checkAndApplyTimeouts() {
  const overdue = findOverduePendingOrders();
  let timedOut = 0;
  let skipped = 0;

  for (const order of overdue) {
    try {
      OrderStateMachine.transition({
        order_id: order.id,
        target_status: 'timeout',
        actor_type: 'system',
        actor_id: 'acceptance_timeout_worker',
        note: `[BRANCH_TIMEOUT] Tidak ada penerimaan cabang dalam ${ACCEPTANCE_TIMEOUT_SECONDS / 60} menit (kebijakan platform Xentra).`
      });
      timedOut += 1;
    } catch (txErr) {
      skipped += 1;
    }
  }

  return { processed: overdue.length, timed_out: timedOut, skipped };
}

module.exports = {
  ACCEPTANCE_TIMEOUT_SECONDS,
  findOverduePendingOrders,
  checkAndApplyTimeouts
};
