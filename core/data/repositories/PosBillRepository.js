'use strict';

/**
 * Persistence boundary for POS check splitting.
 *
 * Checks are a POS billing view over ONE canonical Commerce Order.
 * They never create a second order or dining session.
 */
const DataAccess = require('../DataAccess');

class PosBillRepository {
  constructor(dataAccess = new DataAccess()) { this.db = dataAccess; }
  beginTransaction() { return this.db.exec('BEGIN IMMEDIATE;'); }
  commit() { return this.db.exec('COMMIT;'); }
  rollback() { return this.db.exec('ROLLBACK;'); }

  findOrder(orderId) {
    return this.db.queryOne("SELECT id, brand_id, branch_id, order_channel, order_type, status, grand_total FROM orders WHERE id = ?", [orderId]);
  }

  findChecks(orderId) {
    return this.db.queryMany(`SELECT id, order_id, check_number, status, created_at, updated_at FROM pos_order_checks WHERE order_id = ? ORDER BY check_number ASC`, [orderId]);
  }

  findCheck(checkId) {
    return this.db.queryOne('SELECT id, order_id, check_number, status, created_at, updated_at FROM pos_order_checks WHERE id = ?', [checkId]);
  }

  findCheckItems(checkId) {
    return this.db.queryMany(`SELECT ci.id, ci.check_id, ci.order_item_id, ci.quantity, oi.product_id, oi.product_name, oi.unit_price, oi.note, oi.modifiers_snapshot FROM pos_order_check_items ci JOIN order_items oi ON oi.id = ci.order_item_id WHERE ci.check_id = ? ORDER BY oi.created_at ASC, oi.id ASC`, [checkId]);
  }

  findAllAllocatedQuantity(orderItemId) {
    const row = this.db.queryOne('SELECT COALESCE(SUM(quantity), 0) AS quantity FROM pos_order_check_items WHERE order_item_id = ?', [orderItemId]);
    return Number(row && row.quantity) || 0;
  }

  findCheckItem(checkId, orderItemId) {
    return this.db.queryOne('SELECT id, check_id, order_item_id, quantity FROM pos_order_check_items WHERE check_id = ? AND order_item_id = ?', [checkId, orderItemId]);
  }

  createCheck({ id, orderId, checkNumber, now }) {
    this.db.execute(`INSERT INTO pos_order_checks (id, order_id, check_number, status, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)`, [id, orderId, checkNumber, now, now]);
    return this.findCheck(id);
  }

  upsertCheckItem({ id, checkId, orderItemId, quantity, now }) {
    this.db.execute(`INSERT INTO pos_order_check_items (id, check_id, order_item_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(check_id, order_item_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`, [id, checkId, orderItemId, quantity, now, now]);
  }

  deleteCheckItem(checkId, orderItemId) { this.db.execute('DELETE FROM pos_order_check_items WHERE check_id = ? AND order_item_id = ?', [checkId, orderItemId]); }
  updateCheckItemQuantity(checkId, orderItemId, quantity, now) {
    if (quantity <= 0) return this.deleteCheckItem(checkId, orderItemId);
    this.db.execute('UPDATE pos_order_check_items SET quantity = ?, updated_at = ? WHERE check_id = ? AND order_item_id = ?', [quantity, now, checkId, orderItemId]);
  }
  deleteCheck(checkId) { this.db.execute('DELETE FROM pos_order_checks WHERE id = ?', [checkId]); }
}

module.exports = PosBillRepository;
