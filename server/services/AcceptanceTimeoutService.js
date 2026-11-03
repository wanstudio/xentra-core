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
  const isReservation = order.order_type === 'reservation';
  const method = String(order.payment_method || 'cash').toLowerCase();
  const isOnline = method !== 'cash' && !isReservation;

  let baseTime = null;
  if (isOnline) {
    const payStatus = String(order.payment_status || (order.payment && order.payment.payment_status) || '').toLowerCase();
    if (payStatus !== 'settlement') {
      return null;
    }
    baseTime = order.settled_at || (order.payment && order.payment.settled_at) || order.updated_at || order.created_at;
  } else {
    baseTime = order.created_at;
  }

  if (!baseTime) return null;
  try {
    const baseMs = new Date(baseTime).getTime();
    if (!isNaN(baseMs)) {
      return new Date(baseMs + ACCEPTANCE_TIMEOUT_SECONDS * 1000).toISOString();
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

