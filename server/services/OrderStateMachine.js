const db = require('../database/db');
const crypto = require('crypto');

class OrderStateMachine {
  static VALID_TRANSITIONS = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled', 'refunded'],
    preparing: ['ready', 'cancelled', 'refunded'],
    ready: ['out_for_delivery', 'completed', 'cancelled', 'refunded'],
    out_for_delivery: ['completed', 'cancelled', 'refunded'],
    completed: ['refunded'],
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

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
    if (!order) {
      throw new Error(`Pesanan dengan ID "${order_id}" tidak ditemukan.`);
    }

    const currentStatus = order.status;

    if (!this.canTransition(currentStatus, target_status)) {
      throw new Error(
        `Perubahan status pesanan tidak valid: dari "${currentStatus}" ke "${target_status}".`
      );
    }

    // P1 ATOMIC DATA-INTEGRITY: Execute status mutation and audit logging in a single ACID transaction
    db.exec('BEGIN IMMEDIATE;');
    try {
      // 1. Update order status
      db.prepare(`
        UPDATE orders 
        SET status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(target_status, order_id);

      // 2. Insert audit log
      const logId = 'log_' + crypto.randomBytes(8).toString('hex');
      db.prepare(`
        INSERT INTO order_status_logs (id, order_id, previous_status, new_status, actor_type, actor_id, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(logId, order_id, currentStatus, target_status, actor_type, actor_id, note);

      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw new Error(`Gagal memperbarui status pesanan secara atomik: ${txErr.message}`);
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
