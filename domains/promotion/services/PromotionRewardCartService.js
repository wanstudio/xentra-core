/**
 * Promotion reward -> checkout item bridge.
 * Pure, deterministic business logic: a claimed reward is one normal checkout
 * item, with promotion metadata. It never creates a second promo cart.
 */
class PromotionRewardCartService {
  static isRewardItem(item, promoId) {
    if (!item) return false;
    return String(item.promotion_id || '') === String(promoId) ||
      String(item.id || '') === 'reward_' + String(promoId);
  }

  static hasReward(items, promoId) {
    return (Array.isArray(items) ? items : []).some(item => this.isRewardItem(item, promoId));
  }

  static claim(items, reward) {
    const current = Array.isArray(items) ? items.slice() : [];
    if (!reward || !reward.promo_id || !reward.product_id) {
      return { claimed: false, items: current, reason: 'Invalid reward definition.' };
    }
    if (this.hasReward(current, reward.promo_id)) {
      return { claimed: false, items: current, reason: 'Reward already exists in checkout items.' };
    }

    current.unshift({
      id: 'reward_' + reward.promo_id,
      product_id: String(reward.product_id),
      name: reward.name || 'Hadiah Promo',
      price: 0,
      regular_price: Number(reward.regular_price || 0),
      quantity: 1,
      is_promo_reward: true,
      promotion_id: reward.promo_id,
      reward_type: reward.reward_type || 'freebie_product'
    });

    return { claimed: true, items: current, reason: null };
  }

  static remove(items, promoId) {
    return (Array.isArray(items) ? items : []).filter(item => !this.isRewardItem(item, promoId));
  }
}

module.exports = PromotionRewardCartService;
