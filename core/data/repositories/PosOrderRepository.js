'use strict';

/**
 * POS order persistence adapter.
 *
 * Exposes only persistence primitives required by POS workflows. Business
 * validation, pricing, state transitions, split/merge policy and fulfillment
 * rules remain in POS/Commerce services.
 */
const DataAccess = require('../DataAccess');

class PosOrderRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findHeldById(heldOrderId) {
    return this.db.queryOne('SELECT * FROM pos_held_orders WHERE id = ?', [heldOrderId]);
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

  insertHeldOrder({
    id,
    branchId,
    tableNumber,
    customerName,
    itemsPayload,
    status = 'held',
    createdAt,
    updatedAt
  }) {
    return this.db.execute(`
      INSERT INTO pos_held_orders (
        id, branch_id, table_number, customer_name, items_payload, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      branchId,
      String(tableNumber ?? ''),
      customerName,
      itemsPayload,
      status,
      createdAt,
      updatedAt
    ]);
  }

  updateHeldItems({ heldOrderId, itemsPayload, updatedAt }) {
    return this.db.execute(`
      UPDATE pos_held_orders
      SET items_payload = ?, updated_at = ?
      WHERE id = ?
    `, [itemsPayload, updatedAt, heldOrderId]);
  }

  cancelHeldOrder({ heldOrderId, updatedAt, status = 'cancelled' }) {
    return this.db.execute(`
      UPDATE pos_held_orders
      SET status = ?, updated_at = ?
      WHERE id = ?
    `, [status, updatedAt, heldOrderId]);
  }
}

module.exports = PosOrderRepository;
