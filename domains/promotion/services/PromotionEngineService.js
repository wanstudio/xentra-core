/**
 * Xentra Promotion Domain — Promotion Engine Service
 * Authoritative orchestrator for:
 * 1. Discovery
 * 2. Eligibility Evaluation
 * 3. Benefit Calculation
 * 4. Conflict Resolution (Stacking Policies)
 * 5. Final Transaction Pricing Integration
 */
const PromotionRepository = require('../../../core/data/repositories/PromotionRepository');
const Promotion = require('../domain/Promotion');
const ConflictResolver = require('../domain/ConflictResolver');
const InstallIncentiveStrategy = require('../strategies/InstallIncentiveStrategy');

const promotionRepository = new PromotionRepository();

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

  static discoverActivePromotions(brandId) {
    if (!brandId) return [];

    const promoRows = promotionRepository.findActivePromotions(brandId);
    return promoRows.map(p => new Promotion({
      ...p,
      rules: promotionRepository.findRules(p.id),
      rewards: promotionRepository.findRewards(p.id)
    }));
  }

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

    const customerOrdersCount = customer_phone
      ? promotionRepository.countCustomerOrders({ customerPhone: customer_phone, brandId: brand_id })
      : 0;

    const context = {
      is_pwa_installed: Boolean(is_pwa_installed),
      customer_phone,
      customer_orders_count: customerOrdersCount,
      cart_items,
      cart_subtotal
    };

    const eligibleCandidates = [];
    const discoveryList = [];

    for (const promo of activePromos) {
      const customerRedemptionsCount = customer_phone
        ? promotionRepository.countCustomerRedemptions({
            promotionId: promo.id,
            customerPhone: customer_phone
          })
        : 0;

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

        if (evalResult.should_grant_reward && evalResult.reward && evalResult.reward.product_id) {
          try {
            const catalogProduct = promotionRepository.findRewardCatalogProduct({
              productId: String(evalResult.reward.product_id),
              brandId: brand_id
            });
            if (catalogProduct) {
              item.reward.product_name = catalogProduct.name;
              item.reward.regular_price = Number(catalogProduct.regular_price || catalogProduct.price || 0);
              item.reward.image_url = catalogProduct.image_url || '';
            }
          } catch (_) { /* enrichment must never break eligibility */ }
        }

        discoveryList.push(item);
        if (evalResult.should_grant_reward) eligibleCandidates.push(item);
      }
    }

    const resolution = ConflictResolver.resolve(eligibleCandidates);
    return {
      applied: resolution.applied,
      rejected: resolution.rejected,
      discovery: discoveryList
    };
  }

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

      promotionRepository.recordRedemption({
        redemptionId,
        promotionId: promoId,
        orderId: order_id,
        brandId: brand_id,
        branchId: branch_id,
        customerPhone: customer_phone,
        benefitAmount: amount
      });
    }
  }

  static voidRedemptions({ order_id, reason = 'Order cancelled or expired' }) {
    if (!order_id) return;
    promotionRepository.voidRedemptions({ orderId: order_id, reason });
  }
}

module.exports = PromotionEngineService;
