'use strict';

/**
 * Promotion persistence adapter.
 *
 * Exposes semantic promotion/ledger operations while keeping SQL/storage
 * details behind the data boundary. Business eligibility and stacking rules
 * remain in the promotion domain/service layer.
 */
const DataAccess = require('../DataAccess');
const { CONSUMING_ORDER_STATUSES } = require('../../domain/OrderStatusContract');

class PromotionRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findActivePromotions(brandId, branchId = null) {
    if (branchId) {
      return this.db.queryMany(`
        SELECT p.* FROM promotions p
        WHERE p.brand_id = ? AND p.is_active = 1
          AND (
            EXISTS (
              SELECT 1 FROM promotion_branch_scope pbs
              WHERE pbs.promotion_id = p.id AND pbs.branch_id = ? AND pbs.is_active = 1
            )
            OR NOT EXISTS (
              SELECT 1 FROM promotion_branch_scope pbs_all
              WHERE pbs_all.promotion_id = p.id
            )
          )
        ORDER BY p.priority_weight DESC, p.created_at DESC
      `, [brandId, branchId]);
    }

    return this.db.queryMany(`
      SELECT * FROM promotions
      WHERE brand_id = ? AND is_active = 1
      ORDER BY priority_weight DESC, created_at DESC
    `, [brandId]);
  }

  findAllPromotions(brandId, branchId = null) {
    let promos;
    if (branchId) {
      promos = this.db.queryMany(`
        SELECT p.*,
          COALESCE(pbs.is_active, p.is_active) as branch_is_active
        FROM promotions p
        LEFT JOIN promotion_branch_scope pbs ON pbs.promotion_id = p.id AND pbs.branch_id = ?
        WHERE p.brand_id = ?
          AND (
            pbs.branch_id IS NOT NULL
            OR NOT EXISTS (SELECT 1 FROM promotion_branch_scope pbs_all WHERE pbs_all.promotion_id = p.id)
          )
        ORDER BY p.is_active DESC, p.priority_weight DESC, p.created_at DESC
      `, [branchId, brandId]);
    } else {
      promos = this.db.queryMany(`
        SELECT * FROM promotions
        WHERE brand_id = ?
        ORDER BY is_active DESC, priority_weight DESC, created_at DESC
      `, [brandId]);
    }

    return promos.map(p => {
      const rules = this.findRules(p.id);
      const rewards = this.findRewards(p.id);
      const scopes = this.findBranchScopes(p.id);
      const redemptionsCount = this.db.queryOne(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(benefit_amount), 0) as total_benefit FROM promotion_redemptions WHERE promotion_id = ? AND status = 'active'",
        [p.id]
      );
      return {
        ...p,
        promo_code: p.code || p.promo_code,
        rules,
        rewards,
        scopes,
        redemptions_count: redemptionsCount ? Number(redemptionsCount.cnt || 0) : 0,
        total_benefit_amount: redemptionsCount ? Number(redemptionsCount.total_benefit || 0) : 0
      };
    });
  }

  findBranchScopes(promotionId) {
    return this.db.queryMany(`
      SELECT pbs.*, b.name as branch_name
      FROM promotion_branch_scope pbs
      JOIN branches b ON pbs.branch_id = b.id
      WHERE pbs.promotion_id = ?
      ORDER BY b.name ASC
    `, [promotionId]);
  }

  findBranchScope(promotionId, branchId) {
    return this.db.queryOne(`
      SELECT * FROM promotion_branch_scope
      WHERE promotion_id = ? AND branch_id = ?
    `, [promotionId, branchId]);
  }

  assignBranchScope({ id = null, promotionId, brandId, branchId, isActive = 1 }) {
    const scopeId = id || `pbs_${promotionId}_${branchId}`;
    return this.db.execute(`
      INSERT INTO promotion_branch_scope (
        id, promotion_id, brand_id, branch_id, is_active, assigned_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(promotion_id, branch_id) DO UPDATE SET
        is_active = excluded.is_active,
        updated_at = datetime('now')
    `, [scopeId, promotionId, brandId, branchId, isActive ? 1 : 0]);
  }

  setBranchScopeActivation({ promotionId, branchId, isActive }) {
    return this.db.execute(`
      UPDATE promotion_branch_scope
      SET is_active = ?, updated_at = datetime('now')
      WHERE promotion_id = ? AND branch_id = ?
    `, [isActive ? 1 : 0, promotionId, branchId]);
  }

  removeBranchScope({ promotionId, branchId }) {
    return this.db.execute(`
      DELETE FROM promotion_branch_scope
      WHERE promotion_id = ? AND branch_id = ?
    `, [promotionId, branchId]);
  }

  isPromotionEligibleAtBranch(promotionId, branchId) {
    const row = this.db.queryOne(`
      SELECT p.id
      FROM promotions p
      JOIN promotion_branch_scope pbs ON pbs.promotion_id = p.id
      WHERE p.id = ? AND pbs.branch_id = ? AND p.is_active = 1 AND pbs.is_active = 1
    `, [promotionId, branchId]);
    return Boolean(row && row.id);
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
        p.code as promo_code,
        pr.order_id,
        pr.branch_id,
        b.name as branch_name,
        pr.customer_phone,
        pr.benefit_amount,
        pr.benefit_amount as discount_amount,
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
    // First-order privilege is consumed ONLY by orders that actually went
    // through — i.e. the branch ACCEPTED the order (confirmed → completed).
    // Every other state (pending awaiting acceptance, cancelled, rejected,
    // timeout, refunded, expired, fulfillment_exception, reconciliation_pending,
    // ...) must NOT burn it, otherwise a customer could never reclaim a reward
    // after a failed order.
    //
    // Uses the canonical consuming-status contract (core/domain/OrderStatusContract)
    // as a WHITELIST — the previous blacklist silently missed states that bypass
    // the operational state machine (e.g. fulfillment_exception). Pairs with
    // OrderStateMachine / PaymentGatewayService releasing the redemption.
    const placeholders = CONSUMING_ORDER_STATUSES.map(() => '?').join(', ');
    const row = this.db.queryOne(`
      SELECT COUNT(*) as count
      FROM orders
      WHERE customer_phone = ? AND brand_id = ? AND status IN (${placeholders})
    `, [customerPhone, brandId, ...CONSUMING_ORDER_STATUSES]);
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
    return this.findPromotionById(promotionId);
  }

  findPromotionById(promotionId) {
    const promo = this.db.queryOne(
      'SELECT * FROM promotions WHERE id = ?',
      [promotionId]
    );
    if (!promo) return null;

    const rules = this.findRules(promo.id);
    const rewards = this.findRewards(promo.id);
    const scopes = this.findBranchScopes(promo.id);
    const redemptionsCount = this.db.queryOne(
      "SELECT COUNT(*) as cnt, COALESCE(SUM(benefit_amount), 0) as total_benefit FROM promotion_redemptions WHERE promotion_id = ? AND status = 'active'",
      [promo.id]
    );

    return {
      ...promo,
      promo_code: promo.code || promo.promo_code,
      rules,
      rewards,
      scopes,
      redemptions_count: redemptionsCount ? Number(redemptionsCount.cnt || 0) : 0,
      total_benefit_amount: redemptionsCount ? Number(redemptionsCount.total_benefit || 0) : 0
    };
  }

  createPromotion({
    id,
    brandId,
    name,
    code = null,
    capabilityType = 'install_incentive',
    stackingPolicy = 'exclusive',
    priorityWeight = 100,
    maxRedemptionsTotal = null,
    maxRedemptionsPerCustomer = 1,
    startAt = null,
    endAt = null,
    isActive = 1,
    rules = [],
    rewards = [],
    branchIds = []
  }) {
    const promoId = id || `prm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    
    this.db.execute(`
      INSERT INTO promotions (
        id, brand_id, name, code, capability_type, stacking_policy, priority_weight,
        max_redemptions_total, max_redemptions_per_customer, start_at, end_at, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [
      promoId, brandId, name, code || null, capabilityType, stackingPolicy, priorityWeight,
      maxRedemptionsTotal || null, maxRedemptionsPerCustomer || null, startAt || null, endAt || null, isActive ? 1 : 0
    ]);

    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const ruleId = r.id || `rul_${promoId}_${i + 1}`;
      const payloadStr = typeof r.rule_payload === 'object' ? JSON.stringify(r.rule_payload) : (r.rule_payload || '{}');
      this.db.execute(`
        INSERT INTO promotion_rules (id, promotion_id, rule_type, rule_payload, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `, [ruleId, promoId, r.rule_type || 'eligibility', payloadStr]);
    }

    for (let i = 0; i < rewards.length; i++) {
      const rw = rewards[i];
      const rewId = rw.id || `rew_${promoId}_${i + 1}`;
      const presStr = typeof rw.presentation_payload === 'object' ? JSON.stringify(rw.presentation_payload) : (rw.presentation_payload || null);
      this.db.execute(`
        INSERT INTO promotion_rewards (
          id, promotion_id, reward_type, target_product_id, amount_in_cents, max_discount_in_cents, presentation_payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `, [
        rewId, promoId, rw.reward_type || 'freebie_product', rw.target_product_id || null,
        Number(rw.amount_in_cents || 0), rw.max_discount_in_cents || null, presStr
      ]);
    }

    if (Array.isArray(branchIds)) {
      for (const bId of branchIds) {
        this.assignBranchScope({
          promotionId: promoId,
          brandId,
          branchId: bId,
          isActive: 1
        });
      }
    }

    return this.findPromotionById(promoId);
  }

  updatePromotion(promotionId, brandId, {
    name,
    code = null,
    stackingPolicy,
    priorityWeight,
    maxRedemptionsTotal,
    maxRedemptionsPerCustomer,
    startAt,
    endAt,
    isActive,
    branchIds,
    rules,
    rewards
  }) {
    const existing = this.findPromotionById(promotionId);
    if (!existing || existing.brand_id !== brandId) return null;

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (code !== undefined) { updates.push('code = ?'); params.push(code || null); }
    if (stackingPolicy !== undefined) { updates.push('stacking_policy = ?'); params.push(stackingPolicy); }
    if (priorityWeight !== undefined) { updates.push('priority_weight = ?'); params.push(Number(priorityWeight)); }
    if (maxRedemptionsTotal !== undefined) { updates.push('max_redemptions_total = ?'); params.push(maxRedemptionsTotal || null); }
    if (maxRedemptionsPerCustomer !== undefined) { updates.push('max_redemptions_per_customer = ?'); params.push(maxRedemptionsPerCustomer || null); }
    if (startAt !== undefined) { updates.push('start_at = ?'); params.push(startAt || null); }
    if (endAt !== undefined) { updates.push('end_at = ?'); params.push(endAt || null); }
    if (isActive !== undefined) { updates.push('is_active = ?'); params.push(isActive ? 1 : 0); }

    updates.push("updated_at = datetime('now')");

    if (updates.length > 0) {
      params.push(promotionId, brandId);
      this.db.execute(`
        UPDATE promotions
        SET ${updates.join(', ')}
        WHERE id = ? AND brand_id = ?
      `, params);
    }

    if (Array.isArray(rules)) {
      this.db.execute('DELETE FROM promotion_rules WHERE promotion_id = ?', [promotionId]);
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        const ruleId = r.id || `rul_${promotionId}_${i + 1}`;
        const payloadStr = typeof r.rule_payload === 'object' ? JSON.stringify(r.rule_payload) : (r.rule_payload || '{}');
        this.db.execute(`
          INSERT INTO promotion_rules (id, promotion_id, rule_type, rule_payload, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `, [ruleId, promotionId, r.rule_type || 'eligibility', payloadStr]);
      }
    }

    if (Array.isArray(rewards)) {
      this.db.execute('DELETE FROM promotion_rewards WHERE promotion_id = ?', [promotionId]);
      for (let i = 0; i < rewards.length; i++) {
        const rw = rewards[i];
        const rewId = rw.id || `rew_${promotionId}_${i + 1}`;
        let presStr = null;
        if (rw.presentation_payload !== undefined) {
          presStr = typeof rw.presentation_payload === 'object' ? JSON.stringify(rw.presentation_payload) : (rw.presentation_payload || null);
        } else {
          // Preserve existing presentation_payload for this reward if it existed
          const existingRw = (existing.rewards || []).find(r => r.id === rewId || r.target_product_id === rw.target_product_id);
          if (existingRw && existingRw.presentation_payload) {
            presStr = typeof existingRw.presentation_payload === 'object'
              ? JSON.stringify(existingRw.presentation_payload)
              : existingRw.presentation_payload;
          }
        }
        this.db.execute(`
          INSERT INTO promotion_rewards (
            id, promotion_id, reward_type, target_product_id, amount_in_cents, max_discount_in_cents, presentation_payload, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [
          rewId, promotionId, rw.reward_type || 'freebie_product', rw.target_product_id || null,
          Number(rw.amount_in_cents || 0), rw.max_discount_in_cents || null, presStr
        ]);
      }
    }

    if (Array.isArray(branchIds)) {
      const currentScopes = this.findBranchScopes(promotionId);
      const currentBranchIds = currentScopes.map(s => s.branch_id);
      
      // Remove scopes not in branchIds
      for (const cBId of currentBranchIds) {
        if (!branchIds.includes(cBId)) {
          this.removeBranchScope({ promotionId, branchId: cBId });
        }
      }
      // Add or preserve scopes in branchIds
      for (const bId of branchIds) {
        this.assignBranchScope({
          promotionId,
          brandId,
          branchId: bId,
          isActive: 1
        });
      }
    }

    return this.findPromotionById(promotionId);
  }

  updatePresentationPayload(promotionId, brandId, presentationUpdates = {}) {
    const promo = this.findPromotionById(promotionId);
    if (!promo || promo.brand_id !== brandId) return null;

    const rewards = this.findRewards(promotionId);
    if (!rewards.length) return null;

    const primaryReward = rewards[0];
    let currentPresentation = {};
    if (primaryReward.presentation_payload) {
      try {
        currentPresentation = typeof primaryReward.presentation_payload === 'string'
          ? JSON.parse(primaryReward.presentation_payload)
          : primaryReward.presentation_payload;
      } catch (_) {}
    }

    const mergedPresentation = {
      ...currentPresentation,
      ...presentationUpdates
    };

    this.db.execute(`
      UPDATE promotion_rewards
      SET presentation_payload = ?
      WHERE id = ?
    `, [JSON.stringify(mergedPresentation), primaryReward.id]);

    this.db.execute(`
      UPDATE promotions
      SET updated_at = datetime('now')
      WHERE id = ? AND brand_id = ?
    `, [promotionId, brandId]);

    return this.findPromotionById(promotionId);
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

  deletePromotion(promotionId, brandId) {
    const promo = this.findPromotionById(promotionId);
    if (!promo || promo.brand_id !== brandId) return false;

    this.db.execute('DELETE FROM promotion_rewards WHERE promotion_id = ?', [promotionId]);
    this.db.execute('DELETE FROM promotion_rules WHERE promotion_id = ?', [promotionId]);
    this.db.execute('DELETE FROM promotion_branch_scope WHERE promotion_id = ?', [promotionId]);
    this.db.execute('DELETE FROM promotions WHERE id = ? AND brand_id = ?', [promotionId, brandId]);
    return true;
  }
}

module.exports = PromotionRepository;
