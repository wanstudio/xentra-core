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

  findAllPromotions(brandId) {
    const promos = this.db.queryMany(`
      SELECT * FROM promotions
      WHERE brand_id = ?
      ORDER BY is_active DESC, priority_weight DESC, created_at DESC
    `, [brandId]);

    return promos.map(p => {
      const rules = this.findRules(p.id);
      const rewards = this.findRewards(p.id);
      const redemptionsCount = this.db.queryOne(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(benefit_amount), 0) as total_benefit FROM promotion_redemptions WHERE promotion_id = ? AND status = 'active'",
        [p.id]
      );
      return {
        ...p,
        rules,
        rewards,
        redemptions_count: redemptionsCount ? Number(redemptionsCount.cnt || 0) : 0,
        total_benefit_amount: redemptionsCount ? Number(redemptionsCount.total_benefit || 0) : 0
      };
    });
  }

  findPromotionRedemptions({ brandId, branchId = null, promotionId = null, limit = 50, offset = 0 } = {}) {
    const whereClauses = ['pr.brand_id = ?'];
    const params = [brandId];

    if (branchId) {
      whereClauses.push('pr.branch_id = ?');
      params.push(branchId);
    }
    if (promotionId) {
      whereClauses.push('pr.promotion_id = ?');
      params.push(promotionId);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

    const countRow = this.db.queryOne(`
      SELECT COUNT(*) as total
      FROM promotion_redemptions pr
      ${whereSql}
    `, params);

    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const safeOffset = Math.max(0, Number(offset) || 0);

    const rows = this.db.queryMany(`
      SELECT
        pr.id,
        pr.promotion_id,
        p.name as promotion_name,
        pr.order_id,
        pr.branch_id,
        b.name as branch_name,
        pr.customer_phone,
        pr.benefit_amount,
        pr.status,
        pr.redeemed_at
      FROM promotion_redemptions pr
      JOIN promotions p ON pr.promotion_id = p.id
      LEFT JOIN branches b ON pr.branch_id = b.id
      ${whereSql}
      ORDER BY pr.redeemed_at DESC
      LIMIT ? OFFSET ?
    `, [...params, safeLimit, safeOffset]);

    return {
      redemptions: rows,
      total: countRow ? Number(countRow.total || 0) : 0,
      limit: safeLimit,
      offset: safeOffset
    };
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
