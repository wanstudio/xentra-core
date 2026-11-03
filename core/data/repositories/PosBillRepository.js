'use strict';

/**
 * Persistence boundary for POS check splitting.
 *
 * Checks are a POS billing view over ONE canonical Commerce Order.
 * They never create a second order or dining session.
 */
const DataAccess = require('../DataAccess');

class PosBillRepository {
  constructor(dataAccess = DataAccess) { this.db = dataAccess; }
  beginTransaction() { return this.db.exec('BEGIN IMMEDIATE;'); }
  commit() { return this.db.exec('COMMIT;'); }
  rollback() { return this.db.exec('ROLLBACK;'); }

  findOrder(orderId) {
    return this.db.queryOne("SELECT id, brand_id, branch_id, order_channel, order_type, status, grand_total FROM orders WHERE id = ?", [orderId]);
  }

  findOrderItems(orderId) {
    return this.db.queryMany(`SELECT id, product_id, product_name, quantity, unit_price, item_subtotal, subtotal, addition_batch_id, note, modifiers_snapshot, created_at FROM order_items WHERE order_id = ? ORDER BY created_at ASC, id ASC`, [orderId]);
  }

  findChecks(orderId) {
    return this.db.queryMany(`SELECT id, order_id, check_number, status, allocated_amount, created_at, updated_at FROM pos_order_checks WHERE order_id = ? ORDER BY check_number ASC`, [orderId]);
  }

  findTotalCheckAllocation(orderId) {
    const row = this.db.queryOne('SELECT COALESCE(SUM(allocated_amount), 0) AS amount FROM pos_order_checks WHERE order_id = ?', [orderId]);
    return Number(row && row.amount) || 0;
  }

  hasSeededOrderPayment(orderId, paymentId) {
    return Boolean(this.db.queryOne("SELECT id FROM pos_check_payments WHERE order_id = ? AND raw_payment LIKE ? LIMIT 1", [orderId, `%\"payment_id\":\"${String(paymentId).replace(/[%_]/g, '')}\"%`]));
  }

  findCheck(checkId) {
    return this.db.queryOne('SELECT id, order_id, check_number, status, allocated_amount, created_at, updated_at FROM pos_order_checks WHERE id = ?', [checkId]);
  }

  findCheckItems(checkId) {
    return this.db.queryMany(`SELECT ci.id, ci.check_id, ci.order_item_id, ci.quantity, oi.product_id, oi.product_name, oi.unit_price, oi.item_subtotal, oi.subtotal, oi.note, oi.modifiers_snapshot FROM pos_order_check_items ci JOIN order_items oi ON oi.id = ci.order_item_id WHERE ci.check_id = ? ORDER BY oi.created_at ASC, oi.id ASC`, [checkId]);
  }

  findAllAllocatedQuantity(orderItemId) {
    const row = this.db.queryOne('SELECT COALESCE(SUM(quantity), 0) AS quantity FROM pos_order_check_items WHERE order_item_id = ?', [orderItemId]);
    return Number(row && row.quantity) || 0;
  }

  findCheckItem(checkId, orderItemId) {
    return this.db.queryOne('SELECT id, check_id, order_item_id, quantity FROM pos_order_check_items WHERE check_id = ? AND order_item_id = ?', [checkId, orderItemId]);
  }

  createCheck({ id, orderId, checkNumber, allocatedAmount = 0, now }) {
    this.db.execute(`INSERT INTO pos_order_checks (id, order_id, check_number, status, allocated_amount, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?)`, [id, orderId, checkNumber, allocatedAmount, now, now]);
    return this.findCheck(id);
  }

  upsertCheckItem({ id, checkId, orderItemId, quantity, now }) {
    this.db.execute(`INSERT INTO pos_order_check_items (id, check_id, order_item_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(check_id, order_item_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`, [id, checkId, orderItemId, quantity, now, now]);
  }

  deleteCheckItem(checkId, orderItemId) { this.db.execute('DELETE FROM pos_order_check_items WHERE check_id = ? AND order_item_id = ?', [checkId, orderItemId]); }
  deleteAllCheckItems(checkId) { this.db.execute('DELETE FROM pos_order_check_items WHERE check_id = ?', [checkId]); }
  updateCheckItemQuantity(checkId, orderItemId, quantity, now) {
    if (quantity <= 0) return this.deleteCheckItem(checkId, orderItemId);
    this.db.execute('UPDATE pos_order_check_items SET quantity = ?, updated_at = ? WHERE check_id = ? AND order_item_id = ?', [quantity, now, checkId, orderItemId]);
  }
  updateCheckAmount(checkId, allocatedAmount, now) { this.db.execute('UPDATE pos_order_checks SET allocated_amount = ?, updated_at = ? WHERE id = ?', [allocatedAmount, now, checkId]); }
  setCheckStatus(checkId, status, now) { this.db.execute('UPDATE pos_order_checks SET status = ?, updated_at = ? WHERE id = ?', [status, now, checkId]); }
  findCheckPayments(checkId) { return this.db.queryMany('SELECT * FROM pos_check_payments WHERE check_id = ? ORDER BY created_at ASC, id ASC', [checkId]); }
  findCheckPaymentIntents(checkId) { return this.db.queryMany('SELECT * FROM pos_check_payment_intents WHERE check_id = ? ORDER BY created_at ASC, id ASC', [checkId]); }
  findCheckPaymentIntentByGatewayOrderId(gatewayOrderId) { return this.db.queryOne('SELECT * FROM pos_check_payment_intents WHERE gateway_order_id = ? LIMIT 1', [gatewayOrderId]); }
  findPendingCheckIntentAmount(checkId) { const r = this.db.queryOne("SELECT COALESCE(SUM(amount),0) AS amount FROM pos_check_payment_intents WHERE check_id = ? AND payment_status IN ('pending','challenge','reconciliation_pending')", [checkId]); return Number(r && r.amount) || 0; }
  createCheckPaymentIntent({ id, gatewayOrderId, orderId, checkId, provider, amount, now }) { this.db.execute(`INSERT INTO pos_check_payment_intents (id, gateway_order_id, order_id, check_id, provider, amount, payment_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, [id, gatewayOrderId, orderId, checkId, provider, amount, now, now]); return this.findCheckPaymentIntentByGatewayOrderId(gatewayOrderId); }
  updateCheckPaymentIntentGateway({ gatewayOrderId, snapToken, redirectUrl, merchantId, transactionId, rawResponse, updatedAt }) { return this.db.execute(`UPDATE pos_check_payment_intents SET snap_token = ?, redirect_url = ?, merchant_id = ?, transaction_id = ?, raw_gateway_response = ?, updated_at = ? WHERE gateway_order_id = ? AND payment_status = 'pending'`, [snapToken || null, redirectUrl || null, merchantId || null, transactionId || null, rawResponse || null, updatedAt, gatewayOrderId]); }
  updateCheckPaymentIntentWebhook({ gatewayOrderId, paymentStatus, rawResponse, settledAt, updatedAt }) { return this.db.execute(`UPDATE pos_check_payment_intents SET payment_status = ?, raw_webhook_response = ?, settled_at = CASE WHEN ? = 'settlement' THEN ? ELSE settled_at END, updated_at = ? WHERE gateway_order_id = ?`, [paymentStatus, rawResponse, paymentStatus, settledAt, updatedAt, gatewayOrderId]); }
  updateCheckPaymentIntentStatus({ gatewayOrderId, paymentStatus, updatedAt }) { return this.db.execute('UPDATE pos_check_payment_intents SET payment_status = ?, updated_at = ? WHERE gateway_order_id = ? AND payment_status = \'pending\'', [paymentStatus, updatedAt, gatewayOrderId]); }
  findOrderPaidAmount(orderId) { const r = this.db.queryOne("SELECT COALESCE(SUM(amount),0) AS amount FROM pos_check_payments WHERE order_id = ? AND payment_status = 'settlement'", [orderId]); return Number(r && r.amount) || 0; }
  findOrderPendingCheckIntentAmount(orderId) { const r = this.db.queryOne("SELECT COALESCE(SUM(amount),0) AS amount FROM pos_check_payment_intents WHERE order_id = ? AND payment_status IN ('pending','challenge','reconciliation_pending')", [orderId]); return Number(r && r.amount) || 0; }
  findCheckPaymentIntentsForReconciliation() { return this.db.queryMany("SELECT * FROM pos_check_payment_intents WHERE payment_status IN ('pending','challenge','reconciliation_pending') AND datetime(updated_at) <= datetime('now', '-2 minutes') ORDER BY created_at ASC LIMIT 100"); }
  findCheckIntent(orderId, checkId) { return this.db.queryMany("SELECT id, gateway_order_id, amount, provider, payment_status FROM pos_check_payment_intents WHERE order_id = ? AND check_id = ? AND payment_status IN ('pending','challenge','reconciliation_pending')", [orderId, checkId]); }
  findCheckPaidAmount(checkId) { const r = this.db.queryOne("SELECT COALESCE(SUM(amount),0) AS amount FROM pos_check_payments WHERE check_id = ? AND payment_status = 'settlement'", [checkId]); return Number(r && r.amount) || 0; }
  createCheckPayment({ id, checkId, orderId, paymentMethod, provider, amount, paymentStatus = 'settlement', payerName = null, actorId = null, rawPayment = null, settledAt, now }) { this.db.execute(`INSERT INTO pos_check_payments (id, check_id, order_id, payment_method, provider, amount, payment_status, payer_name, actor_id, raw_payment, settled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, checkId, orderId, paymentMethod, provider, amount, paymentStatus, payerName, actorId, rawPayment, settledAt, now, now]); return this.db.queryOne('SELECT * FROM pos_check_payments WHERE id = ?', [id]); }
  deleteCheck(checkId) { this.db.execute('DELETE FROM pos_order_checks WHERE id = ?', [checkId]); }
}

module.exports = PosBillRepository;
