/**
 * Xentra Promo Domain — Install Incentive Promo Strategy
 * Handles PWA welcome rewards, guest installation acquisition, and first-order gifts.
 */
const BasePromoStrategy = require('./BasePromoStrategy');

class InstallIncentiveStrategy extends BasePromoStrategy {
  constructor() {
    super('install_incentive');
  }

  /**
   * Evaluates install incentive promotion eligibility.
   * 
   * @param {Object} promo - Promotion record
   * @param {Object} context
   * @param {boolean} context.is_pwa_installed - Whether client is running in standalone PWA
   * @param {string} [context.customer_phone] - Customer identifier if logged in / entered
   * @param {number} [context.prior_orders_count] - Number of previous completed orders for customer
   * @param {Array<Object>} [context.cart_items] - Current cart items
   * @param {number} [context.cart_subtotal] - Current cart subtotal
   * @returns {{ isApplicable: boolean, should_show_banner: boolean, should_grant_reward: boolean, reason?: string, reward?: Object }}
   */
  evaluate(promo, context = {}) {
    if (!promo || promo.is_active !== 1) {
      return { isApplicable: false, should_show_banner: false, should_grant_reward: false, reason: 'Promo is inactive.' };
    }

    const isPwaInstalled = Boolean(context.is_pwa_installed);
    const customerPhone = context.customer_phone || '';
    const priorOrdersCount = Number(context.prior_orders_count || 0);

    // If customer already has prior orders, they are not eligible for new user welcome promo
    const isExistingCustomer = Boolean(customerPhone && priorOrdersCount > 0);

    if (isExistingCustomer) {
      return {
        isApplicable: false,
        should_show_banner: false,
        should_grant_reward: false,
        reason: 'Customer has already placed prior orders.'
      };
    }

    // Condition 1: Web browser guest (PWA not installed) -> Show installation invitation banner
    if (!isPwaInstalled) {
      return {
        isApplicable: true,
        should_show_banner: true,
        should_grant_reward: false,
        display: {
          banner_title: promo.banner_title || 'Install sekarang & dapatkan promo spesial',
          banner_subtitle: promo.banner_subtitle || 'syarat & ketentuan berlaku',
          icon_url: promo.icon_url || '/assets/pwa/icon-192.png'
        }
      };
    }

    // Condition 2: PWA installed on device & new user -> Grant welcome reward!
    const rewardPrice = Number(promo.reward_price ?? 0);
    const targetProductId = promo.target_product_id || 'prod_welcome_reward';

    return {
      isApplicable: true,
      should_show_banner: false,
      should_grant_reward: true,
      display: {
        reward_title: promo.reward_title || 'Selamat! Hadiah spesial untuk pesanan pertamamu!',
        reward_badge_text: promo.reward_badge_text || (rewardPrice === 0 ? '✓ Bonus PWA Aktif (Rp0)' : `✓ Tebus Murah (Rp${rewardPrice.toLocaleString('id-ID')})`),
        icon_url: promo.icon_url || '/assets/pwa/icon-192.png'
      },
      reward: {
        promo_id: promo.id,
        reward_type: promo.reward_type || 'freebie_product',
        product_id: targetProductId,
        reward_price: rewardPrice,
        description: promo.reward_title || 'Promo PWA Spesial'
      }
    };
  }
}

module.exports = InstallIncentiveStrategy;
