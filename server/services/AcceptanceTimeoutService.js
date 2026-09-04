/**
 * Xentra Acceptance Timeout Service (R6)
 *
 * Platform-controlled acceptance timeout policy:
 *
 *     AWAITING_BRANCH_ACCEPTANCE (orders.status = 'pending')
 *         + 3 minutes
 *         → BRANCH_TIMEOUT (orders.status = 'timeout')
 *
 * The 3-minute window is XENTRA PLATFORM POLICY — it is deliberately a code
 * constant, NOT Owner-configurable and NOT Branch-Manager-configurable. Only
 * this server-side worker may apply the timeout; browser timers never
 * determine Order state.
 *
 * Properties:
 * - Server/Core authoritative (worker runs inside the Core process).
 * - Atomic + idempotent: each order is transitioned through
 *   OrderStateMachine (BEGIN IMMEDIATE + compare-and-swap + audit log).
 * - ACCEPT vs TIMEOUT races are deterministic: only the first valid
 *   transition to commit wins; the loser receives an explicit invalid-
 *   transition error (AcceptanceTimeoutService skips it, the accept endpoint
 *   returns 400).
 * - A timed-out Order stays on its ORIGINAL transaction/branch — the worker
 *   never transfers, rematches, or re-routes it (no branch mutation exists).
 * - Orders with a settled payment are never auto-timed-out (financial
 *   integrity guard — refund/recovery flows are a later task).
 */
'use strict';

const db = require('../database/db');
const OrderStateMachine = require('./OrderStateMachine');

// R6 platform policy — NOT configurable via any Owner/Branch API.
const ACCEPTANCE_TIMEOUT_SECONDS = 180;

/**
 * Finds orders still awaiting branch acceptance whose acceptance window has
 * fully elapsed (created_at <= now - ACCEPTANCE_TIMEOUT_SECONDS).
 *
 * @returns {Array<{id: string}>}
 */
function findOverduePendingOrders() {
  return db.prepare(`
    SELECT id, status, branch_id, created_at
    FROM orders
    WHERE status = 'pending'
      AND created_at <= datetime('now', ?)
    ORDER BY created_at ASC
  `).all(`-${ACCEPTANCE_TIMEOUT_SECONDS} seconds`);
}

/**
 * Applies the acceptance timeout to every overdue order. Safe to run on any
 * cadence and to invoke repeatedly (idempotent): orders already transitioned,
 * accepted, rejected, cancelled, or paid are skipped without error.
 *
 * @returns {{ processed: number, timed_out: number, skipped: number }}
 */
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
      // Deterministic loser behavior: the order was already transitioned
      // (accepted / rejected / cancelled / timed out by another sweep) or is
      // financially protected (settled payment). Never an error condition.
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
