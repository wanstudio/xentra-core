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

  static discoverActivePromotions(brandId, branchId = null) {
    if (!brandId) return [];

    const promoRows = promotionRepository.findActivePromotions(brandId, branchId);
    return promoRows.map(p => new Promotion({
      ...p,
      rules: promotionRepository.findRules(p.id),
      rewards: promotionRepository.findRewards(p.id)
    }));
  }

  static evaluate({
    brand_id,
    branch_id = null,
    is_pwa_installed = false,
    customer_phone = '',
    cart_items = [],
    cart_subtotal = 0
  }) {
    const activePromos = this.discoverActivePromotions(brand_id, branch_id);
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

  static recordOrderRedemptions(order) {
    if (!order || !order.customer_phone) return;
    const { PaymentRepository } = require('../../../core/data/repositories');
    const paymentRepository = new PaymentRepository();
    const items = paymentRepository.findOrderItemsWithPromoMarker(order.id);
    const promotions = [];
    for (const it of items || []) {
      let promoId = null;
      const marker = '[PROMO:';
      const start = typeof it.note === 'string' ? it.note.indexOf(marker) : -1;
      if (start >= 0) {
        const idStart = start + marker.length;
        const idEnd = it.note.indexOf(']', idStart);
        if (idEnd > idStart) promoId = it.note.slice(idStart, idEnd);
      } else if (String(it.product_id || '').startsWith('prm_')) promoId = it.product_id;
      if (!promoId) continue;
      const promoRow = promotionRepository.findPromotion(promoId);
      if (!promoRow) continue;
      const used = promotionRepository.countCustomerRedemptions({ promotionId: promoId, customerPhone: order.customer_phone });
      const maxLimit = Number(promoRow.max_redemptions_per_customer || 1);
      if (used >= maxLimit) throw new Error(`[PROMO_LIMIT_EXCEEDED_RACE] Batas klaim promo "${promoId}" (${maxLimit}x) telah digunakan oleh pesanan lain milik pelanggan.`);
      let benefitAmount = Number(it.unit_price || 0);
      if (benefitAmount === 0) { const reward = promotionRepository.findRewardProductPrice(it.product_id); benefitAmount = reward ? Number(reward.v || 0) : 0; }
      promotions.push({ promo_id: promoId, benefit_amount: benefitAmount });
    }
    if (promotions.length) {
      this.recordRedemptions({ order_id: order.id, brand_id: order.brand_id, branch_id: order.branch_id, customer_phone: order.customer_phone, promotions });
    }
  }
}

module.exports = PromotionEngineService;
