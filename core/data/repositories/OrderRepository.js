'use strict';

/**
 * Order persistence adapter.
 *
 * Exposes semantic order persistence operations while keeping SQL/storage
 * details behind the data boundary. Business validation, pricing, fulfillment
 * and state-machine decisions remain in Core services.
 */
const DataAccess = require('../DataAccess');

class OrderRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  beginTransaction() {
    return this.db.exec('BEGIN IMMEDIATE;');
  }

  commitTransaction() {
    return this.db.exec('COMMIT;');
  }

  rollbackTransaction() {
    return this.db.exec('ROLLBACK;');
  }

  findActiveReservation({ branchId, customerPhone, reservationDate }) {
    return this.db.queryOne(`
      SELECT id
      FROM orders
      WHERE order_type = 'reservation'
        AND status NOT IN ('cancelled', 'completed')
        AND branch_id = ?
        AND customer_phone = ?
        AND (scheduled_slot_start = ? OR order_note LIKE ?)
      LIMIT 1
    `, [branchId, customerPhone, reservationDate, `%Tgl: ${reservationDate}%`]);
  }

  countActiveReservations({ branchId, reservationDate }) {
    const row = this.db.queryOne(`
      SELECT COUNT(*) as count
      FROM orders
      WHERE order_type = 'reservation'
        AND status NOT IN ('cancelled', 'completed')
        AND branch_id = ?
        AND (scheduled_slot_start = ? OR order_note LIKE ?)
    `, [branchId, reservationDate, `%Tgl: ${reservationDate}%`]);
    return Number(row?.count || 0);
  }

  findOverduePending({ timeoutSeconds }) {
    return this.db.queryMany(`
      SELECT id, status, branch_id, created_at
      FROM orders
      WHERE status = 'pending'
        AND created_at <= datetime('now', ?)
      ORDER BY created_at ASC
    `, [`-${timeoutSeconds} seconds`]);
  }

  findByBranchTransactionId(branchId, clientTransactionId) {
    return this.db.queryOne(`
      SELECT *
      FROM orders
      WHERE branch_id = ? AND client_transaction_id = ?
      LIMIT 1
    `, [branchId, clientTransactionId]);
  }

  findById(orderId) {
    return this.db.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  }

  findItems(orderId) {
    return this.db.queryMany('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
  }

  findPaymentSettlement(orderId) {
    return this.db.queryOne(`
      SELECT id, payment_status, amount, provider
      FROM order_payments
      WHERE order_id = ? AND payment_status = 'settlement'
    `, [orderId]);
  }

  updateStatusIfCurrent({ orderId, targetStatus, currentStatus }) {
    return this.db.execute(`
      UPDATE orders
      SET status = ?, updated_at = datetime('now')
      WHERE id = ? AND status = ?
    `, [targetStatus, orderId, currentStatus]);
  }

  insertStatusLog({ logId, orderId, previousStatus, newStatus, actorType, actorId, note }) {
    return this.db.execute(`
      INSERT INTO order_status_logs (id, order_id, previous_status, new_status, actor_type, actor_id, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [logId, orderId, previousStatus, newStatus, actorType, actorId, note]);
  }

  convertReservationToDineIn({ orderId, tableNumber, updatedAt }) {
    return this.db.execute(`
      UPDATE orders
      SET order_type = 'dine_in', status = 'active_table', table_number = ?, updated_at = ?
      WHERE id = ?
    `, [String(tableNumber), updatedAt, orderId]);
  }

  cancelReservationNoShow({ orderId, reason, updatedAt }) {
    return this.db.execute(`
      UPDATE orders
      SET status = 'cancelled', order_note = COALESCE(order_note || ' | ', '') || ?, updated_at = ?
      WHERE id = ?
    `, [reason, updatedAt, orderId]);
  }

  findHeldById(heldOrderId) {
    return this.db.queryOne(
      'SELECT * FROM pos_held_orders WHERE id = ?',
      [heldOrderId]
    );
  }

  findActiveHeldByTable({ branchId, tableNumber }) {
    return this.db.queryOne(`
      SELECT *
      FROM pos_held_orders
      WHERE branch_id = ? AND table_number = ? AND status = 'held'
      ORDER BY created_at DESC
      LIMIT 1
    `, [branchId, String(tableNumber)]);
  }
}

module.exports = OrderRepository;
