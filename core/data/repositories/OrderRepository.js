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
}

module.exports = OrderRepository;
