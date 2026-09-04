/**
 * Xentra Promotion Reward → Checkout Item Bridge (single shared implementation).
 *
 * Loaded by the customer PWA as a plain <script> (window.Xentra.PromotionRewardCart)
 * and required directly by Node tests (module.exports). Pure, deterministic logic:
 * a claimed reward is ONE normal checkout item carrying promotion metadata — it
 * never creates a second promo cart.
 *
 * Authority boundary: this module only composes cart lines. Eligibility,
 * entitlement and pricing authority stay on the server; this code must never
 * decide that a reward is valid on its own.
 */
(function (global) {
  'use strict';

  function promoIdOf(promoIdOrPromo) {
    if (!promoIdOrPromo) return '';
    return String(promoIdOrPromo.promo_id || promoIdOrPromo.id || promoIdOrPromo);
  }

  /** A cart line belongs to a promo when it carries the promotion_id metadata
   *  or the legacy synthetic cart id `reward_<promoId>`. */
  function isRewardItem(item, promoId) {
    if (!item) return false;
    var pid = promoIdOf(promoId);
    if (!pid) return Boolean(item.is_promo_reward);
    return String(item.promotion_id || '') === pid ||
      String(item.id || '') === 'reward_' + pid;
  }

  function hasReward(items, promoId) {
    return (Array.isArray(items) ? items : []).some(function (item) {
      return isRewardItem(item, promoId);
    });
  }

  /** Builds the canonical checkout line for an entitled reward.
   *  Economics (price/regular_price) come from the authoritative server reward
   *  payload (reward_price, regular_price); the client never invents prices. */
  function buildRewardItem(reward) {
    if (!reward) return null;
    var promoId = promoIdOf(reward.promo_id || reward.promotion_id);
    if (!promoId || !reward.product_id) return null;
    var rewardPrice = reward.reward_price !== undefined && reward.reward_price !== null
      ? Number(reward.reward_price)
      : (reward.price !== undefined && reward.price !== null ? Number(reward.price) : 0);
    return {
      id: 'reward_' + promoId,
      product_id: String(reward.product_id),
      name: reward.name || 'Hadiah Promo',
      price: rewardPrice,
      regular_price: reward.regular_price !== undefined && reward.regular_price !== null
        ? Number(reward.regular_price)
        : rewardPrice,
      image_url: reward.image_url || '',
      description: reward.description || '',
      quantity: 1,
      is_promo_reward: true,
      promotion_id: promoId,
      reward_type: reward.reward_type || 'freebie_product'
    };
  }

  /** Idempotent claim: inserts the reward at the front of the single items
   *  array only when it is not already present. Returns { claimed, items, reason }. */
  function claim(items, reward) {
    var current = Array.isArray(items) ? items.slice() : [];
    var item = buildRewardItem(reward);
    if (!item) {
      return { claimed: false, items: current, reason: 'Invalid reward definition.' };
    }
    if (hasReward(current, item.promotion_id)) {
      return { claimed: false, items: current, reason: 'Reward already exists in checkout items.' };
    }
    current.unshift(item);
    return { claimed: true, items: current, reason: null };
  }

  /** Removes only this promo's reward line; normal products are untouched. */
  function remove(items, promoId) {
    var pid = promoIdOf(promoId);
    return (Array.isArray(items) ? items : []).filter(function (item) {
      return !isRewardItem(item, pid);
    });
  }

  var api = {
    isRewardItem: isRewardItem,
    hasReward: hasReward,
    buildRewardItem: buildRewardItem,
    claim: claim,
    remove: remove
  };

  global.Xentra = global.Xentra || {};
  global.Xentra.PromotionRewardCart = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
