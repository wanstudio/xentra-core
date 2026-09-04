const db = require('../database/db');
const crypto = require('crypto');

class OrderStateMachine {
  // P1 SEPARATION OF CONCERNS: Operational transitions strictly exclude financial 'refunded'
  // R5/R6/R7 ORDER BOUNDARY mapping (locked decisions):
  //   pending  = CREATED / AWAITING_BRANCH_ACCEPTANCE
  //   confirmed = ACCEPTED (branch accept — locked operational acceptance state)
  //   rejected  = REJECTED (branch reject, terminal; distinct from 'cancelled')
  //   timeout   = BRANCH_TIMEOUT (R6: platform 3-minute acceptance timeout,
  //               applied by the server-authoritative AcceptanceTimeoutService;
  //               terminal; distinct from rejected/cancelled)
  //   cancelled = customer cancellation (CUSTOMER_CANCEL, R7 — only valid from
  //               pending, enforced server-side) OR system/manager cancellation.
  // Actor semantics are NEVER collapsed: the audit log records actor_type
  // (customer / branch_actor / system / staff) + actor_id + a [CLASS] note so
  // CUSTOMER_CANCEL, BRANCH_REJECT, BRANCH_TIMEOUT, SYSTEM_CANCEL and
  // PAYMENT_FAILURE remain distinguishable.
  static VALID_TRANSITIONS = {
    pending: ['confirmed', 'cancelled', 'rejected', 'timeout'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['out_for_delivery', 'completed', 'cancelled'],
    out_for_delivery: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
    refunded: [],
    rejected: [],
    timeout: []
  };

  /**
   * Checks if a transition from currentStatus to targetStatus is valid.
   */
  static canTransition(currentStatus, targetStatus) {
    const allowed = this.VALID_TRANSITIONS[currentStatus] || [];
    return allowed.includes(targetStatus);
  }

  /**
   * Transitions an order to a new status with audit logging.
   * 
   * @param {Object} params
   * @param {string} params.order_id
   * @param {string} params.target_status
   * @param {string} [params.actor_type='system'] - 'customer', 'kitchen', 'courier', 'admin', 'system'
   * @param {string} [params.actor_id=null]
   * @param {string} [params.note='']
   * @param {string} [params.expected_current_status=null] - When set, the
   *   transition is only allowed if the order is STILL in this status inside
   *   the transaction. Guards actor-sensitive operations (e.g. R7 customer
   *   cancellation from 'pending') against TOCTOU races: if ACCEPT committed
   *   between the caller's pre-check and this transaction, the transition
   *   fails with [STATE_CHANGED] instead of silently acting on the new state.
   * @returns {Object} Updated order record
   */
  static transition(params) {
    const { order_id, target_status, actor_type = 'system', actor_id = null, note = '', expected_current_status = null } = params;

    // P1 CONCURRENCY & ATOMICITY: Execute read, optimistic compare-and-swap, and audit logging in a single exclusive transaction
    db.exec('BEGIN IMMEDIATE;');
    let currentStatus = null;
    try {
      // 1. Fetch current authoritative state inside transaction lock
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
      if (!order) {
        throw new Error(`Pesanan dengan ID "${order_id}" tidak ditemukan.`);
      }

      currentStatus = order.status;

      // R11 TOCTOU GUARD: when the caller requires a specific current status
      // (e.g. customer cancellation only from 'pending'), re-validate INSIDE
      // the lock — a concurrent ACCEPT/TIMEOUT/REJECT may have committed
      // between the caller's pre-check and this transaction. Without this, an
      // actor-sensitive operation could run against a state it was never
      // authorized for (e.g. customer cancel landing on an ACCEPTED order).
      if (expected_current_status != null && String(order.status) !== String(expected_current_status)) {
        throw new Error(
          `[STATE_CHANGED]: Status pesanan "${order_id}" sudah berubah dari "${expected_current_status}" menjadi "${order.status}". Operasi dibatalkan.`
        );
      }

      if (!this.canTransition(currentStatus, target_status)) {
        throw new Error(
          `Perubahan status pesanan tidak valid: dari "${currentStatus}" ke "${target_status}".`
        );
      }

      // P1 FINANCIAL INTEGRITY INVARIANT (NEW-01), extended to R5 branch
      // rejection and R6 automatic timeout: an order with an active settled
      // payment CANNOT be cancelled, branch-rejected, OR auto-timed-out via
      // operational transition. All three require an explicit refund workflow
      // (later task) so financial and inventory ledger remain strictly
      // reconcilable. Rejection/timeout are never a bypass around payment.
      if (target_status === 'cancelled' || target_status === 'rejected' || target_status === 'timeout') {
        const settledPayment = db.prepare(`
          SELECT id, payment_status, amount, provider 
          FROM order_payments 
          WHERE order_id = ? AND payment_status = 'settlement'
        `).get(order_id);

        if (settledPayment) {
          const action = target_status === 'rejected'
            ? 'Penolakan oleh cabang'
            : (target_status === 'timeout'
                ? 'Timeout penerimaan otomatis'
                : 'Pembatalan operasional');
          throw new Error(
            `[ORDER_ALREADY_PAID]: Pesanan "${order_id}" sudah dibayar lunas (Rp ${settledPayment.amount} via ${settledPayment.provider}). ${action} ditolak untuk mencegah anomali finansial. Silakan gunakan alur Refund resmi.`
          );
        }
      }

      // 2. Optimistic Compare-and-Swap: Update only if status hasn't changed concurrently
      const updateResult = db.prepare(`
        UPDATE orders 
        SET status = ?, updated_at = datetime('now')
        WHERE id = ? AND status = ?
      `).run(target_status, order_id, currentStatus);

      if (!updateResult || updateResult.changes === 0) {
        throw new Error(`Konflik konkurensi: Status pesanan "${order_id}" telah diubah oleh proses lain.`);
      }

      // 3. Insert audit log
      const logId = 'log_' + crypto.randomBytes(8).toString('hex');
      db.prepare(`
        INSERT INTO order_status_logs (id, order_id, previous_status, new_status, actor_type, actor_id, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(logId, order_id, currentStatus, target_status, actor_type, actor_id, note);

      // 4. Void active promotion redemptions on terminal non-fulfillment states
      // (customer cancellation, R5 branch rejection, R6 timeout) so a benefit
      // tied to an order that will never be fulfilled is released for the
      // customer.
      if (target_status === 'cancelled' || target_status === 'rejected' || target_status === 'timeout') {
        const PromotionEngineService = require('../../domains/promotion/services/PromotionEngineService');
        PromotionEngineService.voidRedemptions({ order_id, reason: note || `Order ${target_status} by ${actor_type}` });
      }

      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    return {
      success: true,
      order_id,
      previous_status: currentStatus,
      new_status: target_status
    };
  }
}

module.exports = OrderStateMachine;
