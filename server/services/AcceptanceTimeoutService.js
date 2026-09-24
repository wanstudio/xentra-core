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
      if (order.order_type === 'dine_in') {
        try {
          const { DiningTableService } = require('../../domains/dining');
          DiningTableService.releaseHold({
            branch_id: order.branch_id,
            hold_reference_id: order.id,
            reason: 'timeout'
          });
        } catch (_) {}
      }
      timedOut += 1;
    } catch (txErr) {
      skipped += 1;
    }
  }

  return { processed: overdue.length, timed_out: timedOut, skipped };
}

function computeAcceptanceDeadlineAt(order) {
  if (!order || order.status !== 'pending' || !order.created_at) {
    return null;
  }
  try {
    const createdMs = new Date(order.created_at).getTime();
    if (!isNaN(createdMs)) {
      return new Date(createdMs + ACCEPTANCE_TIMEOUT_SECONDS * 1000).toISOString();
    }
  } catch (_) {}
  return null;
}

module.exports = {
  ACCEPTANCE_TIMEOUT_SECONDS,
  findOverduePendingOrders,
  checkAndApplyTimeouts,
  computeAcceptanceDeadlineAt
};

