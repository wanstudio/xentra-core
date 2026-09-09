/**
 * Xentra Acceptance Timeout Service (R6)
 *
 * Platform-controlled acceptance timeout policy.
 */
'use strict';

const { OrderRepository } = require('../../core/data/repositories');
const OrderStateMachine = require('./OrderStateMachine');

const orderRepository = new OrderRepository();
const ACCEPTANCE_TIMEOUT_SECONDS = 180;

function findOverduePendingOrders() {
  return orderRepository.findOverduePending({ timeoutSeconds: ACCEPTANCE_TIMEOUT_SECONDS });
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
