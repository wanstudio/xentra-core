/**
 * Xentra Promotion Domain — Install Incentive Strategy
 * Evaluates PWA installation incentives, welcome gifts, and new customer onboarding rewards.
 */
const BasePromotionStrategy = require('./BasePromotionStrategy');

class InstallIncentiveStrategy extends BasePromotionStrategy {
  constructor() {
    super('install_incentive');
  }

  evaluate(promotion, context = {}) {
    if (!promotion || promotion.is_active !== 1) {
      return { isEligible: false, reason: 'Promotion is currently inactive.' };
    }

    // 1. Extract Eligibility Rules
    const eligibilityRule = promotion.rules.find(r => r.rule_type === 'eligibility');
    let requiresPwa = true;
    let targetAudience = 'new_user';
    let firstOrderOnly = true;

    if (eligibilityRule && eligibilityRule.rule_payload) {
      const payload = typeof eligibilityRule.rule_payload === 'string'
        ? JSON.parse(eligibilityRule.rule_payload)
        : eligibilityRule.rule_payload;
      if (payload.requires_pwa_installed !== undefined) requiresPwa = Boolean(payload.requires_pwa_installed);
      if (payload.target_audience) targetAudience = payload.target_audience;
      if (payload.first_order_only !== undefined) firstOrderOnly = Boolean(payload.first_order_only);
    }

    // 2. Check Customer Prior Redemptions / Orders
    const priorRedemptionsCount = Number(context.customer_redemptions_count || 0);
    const maxPerCustomer = Number(promotion.max_redemptions_per_customer || 1);

    if (priorRedemptionsCount >= maxPerCustomer) {
      return {
        isEligible: false,
        reason: 'Customer has already reached the maximum redemption limit for this promotion.'
      };
    }

    const priorOrdersCount = Number(context.customer_orders_count || 0);
    if (firstOrderOnly && context.customer_phone && priorOrdersCount > 0) {
      return {
        isEligible: false,
        reason: 'Promotion is strictly valid for first-time orders only.'
      };
    }

    // 3. Extract Reward & Presentation
    const primaryReward = promotion.rewards[0] || {};
    let presentation = {};
    if (primaryReward.presentation_payload) {
      presentation = typeof primaryReward.presentation_payload === 'string'
        ? JSON.parse(primaryReward.presentation_payload)
        : primaryReward.presentation_payload;
    }

    const amountInCents = Number(primaryReward.amount_in_cents || 0);
    const targetProductId = primaryReward.target_product_id || 'prod_welcome_reward';
    const isPwaInstalled = Boolean(context.is_pwa_installed);

    // Case A: Opened in web browser (PWA not yet installed) -> Prompt to install
    if (requiresPwa && !isPwaInstalled) {
      return {
        isEligible: true,
        should_show_banner: true,
        should_grant_reward: false,
        display: {
          banner_title: presentation.banner_title || 'Install sekarang & dapatkan promo spesial',
          banner_subtitle: presentation.banner_subtitle || 'syarat & ketentuan berlaku',
          icon_url: presentation.icon_url || '/assets/pwa/icon-192.png'
        }
      };
    }

    // Case B: Opened from installed PWA -> Grant welcome gift!
    return {
      isEligible: true,
      should_show_banner: false,
      should_grant_reward: true,
      display: {
        reward_title: presentation.reward_title || 'Selamat! Hadiah spesial untuk pesanan pertamamu!',
        reward_badge_text: presentation.reward_badge_text || (amountInCents === 0 ? '✓ Bonus PWA Aktif (Rp0)' : `✓ Tebus Murah (Rp${amountInCents.toLocaleString('id-ID')})`),
        icon_url: presentation.icon_url || '/assets/pwa/icon-192.png'
      },
      reward: {
        promo_id: promotion.id,
        reward_type: primaryReward.reward_type || 'freebie_product',
        product_id: targetProductId,
        reward_price: amountInCents, // Integer Rupiah
        description: presentation.reward_title || 'Promo PWA Spesial'
      }
    };
  }
}

module.exports = InstallIncentiveStrategy;
