/**
 * Xentra Promotion Domain — Promotion Engine Service
 * Authoritative orchestrator for:
 * 1. Discovery
 * 2. Eligibility Evaluation
 * 3. Benefit Calculation
 * 4. Conflict Resolution (Stacking Policies)
 * 5. Final Transaction Pricing Integration
 */
const db = require('../../../server/database/db');
const Promotion = require('../domain/Promotion');
const ConflictResolver = require('../domain/ConflictResolver');
const InstallIncentiveStrategy = require('../strategies/InstallIncentiveStrategy');

class PromotionEngineService {
  static _strategies = new Map();

  static {
    this.registerStrategy(new InstallIncentiveStrategy());
  }

  static registerStrategy(strategy) {
    if (strategy && strategy.capabilityType) {
      this._strategies.set(strategy.capabilityType, strategy);
    }
  }

  /**
   * Discovers active promotion models for a brand populated with rules and rewards.
   * @param {string} brandId
   * @returns {Array<Promotion>}
   */
  static discoverActivePromotions(brandId) {
    if (!brandId) return [];

    const promoRows = db.prepare(`
      SELECT * FROM promotions 
      WHERE brand_id = ? AND is_active = 1 
      ORDER BY priority_weight DESC, created_at DESC
    `).all(brandId);

    const promotions = [];
    for (const p of promoRows) {
      const rules = db.prepare('SELECT * FROM promotion_rules WHERE promotion_id = ?').all(p.id);
      const rewards = db.prepare('SELECT * FROM promotion_rewards WHERE promotion_id = ?').all(p.id);

      promotions.push(new Promotion({
        ...p,
        rules,
        rewards
      }));
    }

    return promotions;
  }

  /**
   * Evaluates active promotions against a checkout context and resolves stacking conflicts.
   * @param {Object} params
   * @param {string} params.brand_id
   * @param {boolean} [params.is_pwa_installed]
   * @param {string} [params.customer_phone]
   * @param {Array<Object>} [params.cart_items]
   * @param {number} [params.cart_subtotal]
   * @returns {{ applied: Array<Object>, rejected: Array<Object>, discovery: Array<Object> }}
   */
  static evaluate({
    brand_id,
    is_pwa_installed = false,
    customer_phone = '',
    cart_items = [],
    cart_subtotal = 0
  }) {
    const activePromos = this.discoverActivePromotions(brand_id);
    if (!activePromos.length) {
      return { applied: [], rejected: [], discovery: [] };
    }

    // 1. Calculate customer transaction metrics (Immutable Source of Truth)
    let customerOrdersCount = 0;
    if (customer_phone) {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM orders 
        WHERE customer_phone = ? AND brand_id = ? AND status != 'cancelled'
      `).get(customer_phone, brand_id);
      if (row) customerOrdersCount = Number(row.count || 0);
    }

    const context = {
      is_pwa_installed: Boolean(is_pwa_installed),
      customer_phone,
      customer_orders_count: customerOrdersCount,
      cart_items,
      cart_subtotal
    };

    const eligibleCandidates = [];
    const discoveryList = [];

    // 2. Evaluate Eligibility & Calculate Benefit per Promo
    for (const promo of activePromos) {
      // Check customer prior redemptions for this promo
      let customerRedemptionsCount = 0;
      if (customer_phone) {
        const rdmRow = db.prepare(`
          SELECT COUNT(*) as count FROM promotion_redemptions 
          WHERE promotion_id = ? AND customer_phone = ? AND status = 'active'
        `).get(promo.id, customer_phone);
        if (rdmRow) customerRedemptionsCount = Number(rdmRow.count || 0);
      }

      const evalContext = {
        ...context,
        customer_redemptions_count: customerRedemptionsCount
      };

      const strategy = this._strategies.get(promo.capability_type);
      if (!strategy) continue;

      const evalResult = strategy.evaluate(promo, evalContext);

      if (evalResult.isEligible) {
        const item = {
          promo_id: promo.id,
          capability_type: promo.capability_type,
          name: promo.name,
          stacking_policy: promo.stacking_policy,
          priority_weight: promo.priority_weight,
          ...evalResult
        };

        // Authoritative catalog enrichment for granted rewards: the client cart
        // line must be built from server facts (product identity, name, prices),
        // never from client hardcodes. Falls back silently when the reward
        // product is not in this brand's catalog (kept configurable/dynamic).
        if (evalResult.should_grant_reward && evalResult.reward && evalResult.reward.product_id) {
          try {
            const catalogProduct = db.prepare(`
              SELECT name, price, regular_price, image_url
              FROM products
              WHERE id = ? AND brand_id = ?
            `).get(String(evalResult.reward.product_id), brand_id);
            if (catalogProduct) {
              item.reward.product_name = catalogProduct.name;
              item.reward.regular_price = Number(catalogProduct.regular_price || catalogProduct.price || 0);
              item.reward.image_url = catalogProduct.image_url || '';
            }
          } catch (_) { /* enrichment must never break eligibility */ }
        }

        discoveryList.push(item);

        if (evalResult.should_grant_reward) {
          eligibleCandidates.push(item);
        }
      }
    }

    // 3. Resolve Stacking Conflicts
    const resolution = ConflictResolver.resolve(eligibleCandidates);

    return {
      applied: resolution.applied,
      rejected: resolution.rejected,
      discovery: discoveryList
    };
  }

  /**
   * Records immutable redemption ledger for applied promotions upon order completion.
   * Enforces idempotency via UNIQUE(order_id, promotion_id).
   * 
   * @param {Object} params
   * @param {string} params.order_id
   * @param {string} params.brand_id
   * @param {string} params.branch_id
   * @param {string} params.customer_phone
   * @param {Array<{ promo_id: string, benefit_amount?: number }>} params.promotions
   */
  static recordRedemptions({
    order_id,
    brand_id,
    branch_id,
    customer_phone,
    promotions = []
  }) {
    if (!order_id || !Array.isArray(promotions) || promotions.length === 0) return;

    for (const p of promotions) {
      const promoId = p.promo_id || p.id;
      if (!promoId) continue;
      const redemptionId = `rdm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const amount = Number(p.benefit_amount || p.amount || 0);

      db.prepare(`
        INSERT INTO promotion_redemptions (
          id, promotion_id, order_id, brand_id, branch_id, customer_phone, benefit_amount, status, redeemed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
        ON CONFLICT(order_id, promotion_id) DO NOTHING
      `).run(
        redemptionId,
        promoId,
        order_id,
        brand_id,
        branch_id,
        customer_phone || '',
        amount
      );
    }
  }

  /**
   * Voids promotion redemptions upon order cancellation or refund without destroying audit trail.
   * 
   * @param {Object} params
   * @param {string} params.order_id
   * @param {string} [params.reason]
   */
  static voidRedemptions({ order_id, reason = 'Order cancelled or expired' }) {
    if (!order_id) return;
    db.prepare(`
      UPDATE promotion_redemptions
      SET status = 'voided', voided_at = datetime('now'), void_reason = ?
      WHERE order_id = ? AND status = 'active'
    `).run(reason, order_id);
  }
}

module.exports = PromotionEngineService;
