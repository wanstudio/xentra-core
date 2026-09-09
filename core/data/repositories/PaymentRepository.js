'use strict';

/**
 * Payment persistence adapter.
 *
 * Persistence-only boundary for payment/order-payment records. Provider
 * selection, credential resolution, signature validation and payment business
 * rules remain owned by the Payment Core services.
 */
const DataAccess = require('../DataAccess');

class PaymentRepository {
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

  findBranchPaymentConfig(branchId, brandId = null) {
    if (brandId) {
      return this.db.queryOne(
        'SELECT payment_config_override FROM branches WHERE id = ? AND brand_id = ?',
        [branchId, brandId]
      );
    }
    return this.db.queryOne(
      'SELECT payment_config_override FROM branches WHERE id = ?',
      [branchId]
    );
  }

  findBrandPaymentConfig(brandId) {
    return this.db.queryOne(
      'SELECT default_payment_config FROM brands WHERE id = ?',
      [brandId]
    );
  }

  findOrder(orderId) {
    return this.db.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  }

  findPaymentByOrderId(orderId) {
    return this.db.queryOne(
      'SELECT * FROM order_payments WHERE order_id = ? LIMIT 1',
      [orderId]
    );
  }

  ensurePendingPayment({ paymentId, orderId, amount, createdAt, updatedAt }) {
    return this.db.execute(`
      INSERT INTO order_payments (
        id, order_id, provider, payment_method, merchant_id, snap_token,
        payment_status, amount, created_at, updated_at
      ) VALUES (?, ?, 'midtrans', 'midtrans', 'midtrans', NULL, 'pending', ?, ?, ?)
      ON CONFLICT(order_id) DO NOTHING
    `, [paymentId, orderId, amount, createdAt, updatedAt]);
  }

  updatePaymentWebhook({ orderId, paymentStatus, webhookResponse, settledAt, updatedAt }) {
    return this.db.execute(`
      UPDATE order_payments
      SET payment_status = ?,
          payment_method = 'midtrans',
          raw_webhook_response = ?,
          settled_at = CASE WHEN ? = 'settlement' THEN ? ELSE settled_at END,
          updated_at = ?
      WHERE order_id = ?
    `, [paymentStatus, webhookResponse, paymentStatus, settledAt, updatedAt, orderId]);
  }

  updatePaymentStatus({ orderId, paymentStatus, updatedAt }) {
    return this.db.execute(`
      UPDATE order_payments
      SET payment_status = ?, updated_at = ?
      WHERE order_id = ?
    `, [paymentStatus, updatedAt, orderId]);
  }

  settleCashPayment({ paymentId, orderId, amount, settledAt, rawPayment, createdAt, updatedAt }) {
    return this.db.execute(`
      INSERT INTO order_payments (
        id, order_id, provider, payment_method, amount, payment_status, settled_at,
        raw_webhook_response, created_at, updated_at
      ) VALUES (?, ?, 'cash', 'cash', ?, 'settlement', ?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        payment_status = 'settlement',
        payment_method = 'cash',
        amount = excluded.amount,
        settled_at = excluded.settled_at,
        raw_webhook_response = excluded.raw_webhook_response,
        updated_at = excluded.updated_at
    `, [paymentId, orderId, amount, settledAt, rawPayment, createdAt, updatedAt]);
  }

  markOrderPaidByCash({ orderId, updatedAt }) {
    return this.db.execute(`
      UPDATE orders
      SET payment_method = 'cash', updated_at = ?
      WHERE id = ?
    `, [updatedAt, orderId]);
  }

  findOrderStatus(orderId) {
    return this.db.queryOne('SELECT status FROM orders WHERE id = ?', [orderId]);
  }

  markFulfillmentException({ orderId, note, updatedAt }) {
    return this.db.execute(`
      UPDATE orders
      SET status = 'fulfillment_exception',
          payment_method = 'midtrans',
          order_note = COALESCE(order_note || ' | ', '') || ?,
          updated_at = ?
      WHERE id = ?
    `, [note, updatedAt, orderId]);
  }

  cancelPendingOrder({ orderId, updatedAt }) {
    return this.db.execute(`
      UPDATE orders
      SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND status = 'pending'
    `, [updatedAt, orderId]);
  }

  findOrderItemsWithPromoMarker(orderId) {
    return this.db.queryMany(`
      SELECT *
      FROM order_items
      WHERE order_id = ?
        AND (note LIKE '%[PROMO:%' OR product_id LIKE 'prm_%')
    `, [orderId]);
  }

  findPromotion(promotionId) {
    return this.db.queryOne(
      'SELECT id, max_redemptions_per_customer FROM promotions WHERE id = ?',
      [promotionId]
    );
  }

  findRewardProductPrice(productId) {
    return this.db.queryOne(
      'SELECT COALESCE(regular_price, price, 0) AS v FROM products WHERE id = ?',
      [productId]
    );
  }

  findActiveDiningHolds(holdReferenceId) {
    return this.db.queryMany(
      "SELECT hold_reference_id, table_id FROM branch_table_holds WHERE hold_reference_id = ? AND status = 'active'",
      [holdReferenceId]
    );
  }

  findBranchTableByNumberOrLabel(branchId, tableValue) {
    return this.db.queryOne(
      'SELECT id FROM branch_tables WHERE branch_id = ? AND (table_number = ? OR label = ?)',
      [branchId, tableValue, tableValue]
    );
  }

  findPendingReconciliationPayments() {
    return this.db.queryMany(`
      SELECT order_id
      FROM order_payments
      WHERE payment_status = 'reconciliation_pending'
      ORDER BY created_at ASC
    `);
  }
}

module.exports = PaymentRepository;
