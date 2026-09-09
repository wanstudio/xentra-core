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
}

module.exports = PaymentRepository;
