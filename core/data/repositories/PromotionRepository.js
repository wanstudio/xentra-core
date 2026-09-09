'use strict';

/**
 * Promotion persistence adapter.
 *
 * Exposes semantic promotion/ledger operations while keeping SQL/storage
 * details behind the data boundary. Business eligibility and stacking rules
 * remain in the promotion domain/service layer.
 */
const DataAccess = require('../DataAccess');

class PromotionRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findActivePromotions(brandId) {
    return this.db.queryMany(`
      SELECT * FROM promotions
      WHERE brand_id = ? AND is_active = 1
      ORDER BY priority_weight DESC, created_at DESC
    `, [brandId]);
  }

  findRules(promotionId) {
    return this.db.queryMany(
      'SELECT * FROM promotion_rules WHERE promotion_id = ?',
      [promotionId]
    );
  }

  findRewards(promotionId) {
    return this.db.queryMany(
      'SELECT * FROM promotion_rewards WHERE promotion_id = ?',
      [promotionId]
    );
  }

  countCustomerOrders({ customerPhone, brandId }) {
    const row = this.db.queryOne(`
      SELECT COUNT(*) as count
      FROM orders
      WHERE customer_phone = ? AND brand_id = ? AND status != 'cancelled'
    `, [customerPhone, brandId]);
    return Number(row?.count || 0);
  }

  countCustomerRedemptions({ promotionId, customerPhone }) {
    const row = this.db.queryOne(`
      SELECT COUNT(*) as count
      FROM promotion_redemptions
      WHERE promotion_id = ? AND customer_phone = ? AND status = 'active'
    `, [promotionId, customerPhone]);
    return Number(row?.count || 0);
  }

  findRewardCatalogProduct({ productId, brandId }) {
    return this.db.queryOne(`
      SELECT name, price, regular_price, image_url
      FROM products
      WHERE id = ? AND brand_id = ?
    `, [productId, brandId]);
  }

  recordRedemption({
    redemptionId,
    promotionId,
    orderId,
    brandId,
    branchId,
    customerPhone,
    benefitAmount
  }) {
    return this.db.execute(`
      INSERT INTO promotion_redemptions (
        id, promotion_id, order_id, brand_id, branch_id, customer_phone,
        benefit_amount, status, redeemed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
      ON CONFLICT(order_id, promotion_id) DO NOTHING
    `, [
      redemptionId,
      promotionId,
      orderId,
      brandId,
      branchId,
      customerPhone || '',
      benefitAmount
    ]);
  }

  voidRedemptions({ orderId, reason }) {
    return this.db.execute(`
      UPDATE promotion_redemptions
      SET status = 'voided', voided_at = datetime('now'), void_reason = ?
      WHERE order_id = ? AND status = 'active'
    `, [reason, orderId]);
  }
}

module.exports = PromotionRepository;
