const db = require('../database/db');
const crypto = require('crypto');

class OrderStateMachine {
  // P1 SEPARATION OF CONCERNS: Operational transitions strictly exclude financial 'refunded'
  static VALID_TRANSITIONS = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['out_for_delivery', 'completed', 'cancelled'],
    out_for_delivery: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
    refunded: []
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
   * @returns {Object} Updated order record
   */
  static transition(params) {
    const { order_id, target_status, actor_type = 'system', actor_id = null, note = '' } = params;

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

      if (!this.canTransition(currentStatus, target_status)) {
        throw new Error(
          `Perubahan status pesanan tidak valid: dari "${currentStatus}" ke "${target_status}".`
        );
      }

      // P1 FINANCIAL INTEGRITY INVARIANT (NEW-01):
      // An order with an active settled payment CANNOT be casually cancelled via operational transition.
      // It requires an explicit refund workflow so financial and inventory ledger remain strictly reconcilable.
      if (target_status === 'cancelled') {
        const settledPayment = db.prepare(`
          SELECT id, payment_status, amount, provider 
          FROM order_payments 
          WHERE order_id = ? AND payment_status = 'settlement'
        `).get(order_id);

        if (settledPayment) {
          throw new Error(
            `[ORDER_ALREADY_PAID]: Pesanan "${order_id}" sudah dibayar lunas (Rp ${settledPayment.amount} via ${settledPayment.provider}). Pembatalan operasional ditolak untuk mencegah anomali finansial. Silakan gunakan alur Refund resmi.`
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

      // 4. Void active promotion redemptions if cancelled
      if (target_status === 'cancelled') {
        const PromotionEngineService = require('../../domains/promotion/services/PromotionEngineService');
        PromotionEngineService.voidRedemptions({ order_id, reason: note || `Order cancelled by ${actor_type}` });
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
