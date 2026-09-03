const { test, describe } = require('node:test');
const assert = require('node:assert');

// The claim execution path runs in the browser (customer PWA). The shared
// implementation lives in apps/customer-pwa/assets/js/core/promo-reward-cart.js
// (window.Xentra.PromotionRewardCart) and is UMD-loadable from Node so tests
// exercise the exact module the UI calls — not a server-side twin.
const PromotionRewardCart = require('../../apps/customer-pwa/assets/js/core/promo-reward-cart.js');

const reward = {
  promo_id: 'prm_bangjo_pwa_install',
  product_id: '401',
  name: 'Es Teh Gratis',
  reward_type: 'freebie_product',
  regular_price: 5000
};

describe('Promotion reward checkout lifecycle', () => {
  test('claim inserts reward into the single checkout items array', () => {
    const items = [{ id: '123', product_id: '123', name: 'Nasi Goreng', price: 18000, quantity: 1 }];
    const result = PromotionRewardCart.claim(items, reward);
    assert.strictEqual(result.claimed, true);
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items[0].id, 'reward_prm_bangjo_pwa_install');
    assert.strictEqual(result.items[0].product_id, '401');
    assert.strictEqual(result.items[0].price, 0);
    assert.strictEqual(result.items[0].is_promo_reward, true);
    assert.strictEqual(result.items[0].promotion_id, reward.promo_id);
    assert.strictEqual(result.items[1].id, '123');
  });

  test('removing reward makes it claimable again without creating a second cart', () => {
    const claimed = PromotionRewardCart.claim([], reward);
    const removed = PromotionRewardCart.remove(claimed.items, reward.promo_id);
    assert.strictEqual(removed.length, 0);
    const reclaimed = PromotionRewardCart.claim(removed, reward);
    assert.strictEqual(reclaimed.claimed, true);
    assert.strictEqual(reclaimed.items.length, 1);
  });

  test('claim is idempotent and cannot duplicate the reward item', () => {
    const once = PromotionRewardCart.claim([], reward);
    const twice = PromotionRewardCart.claim(once.items, reward);
    assert.strictEqual(twice.claimed, false);
    assert.strictEqual(twice.items.length, 1);
  });

  test('normal products remain untouched when reward is removed', () => {
    const items = [
      { id: 'reward_prm_bangjo_pwa_install', promotion_id: reward.promo_id, price: 0 },
      { id: '123', product_id: '123', price: 18000 }
    ];
    const remaining = PromotionRewardCart.remove(items, reward.promo_id);
    assert.deepStrictEqual(remaining.map(i => i.id), ['123']);
  });

  test('rewards missing product_id cannot be claimed (no authoritative product)', () => {
    const result = PromotionRewardCart.claim([], { promo_id: 'prm_bangjo_pwa_install', name: 'fake' });
    assert.strictEqual(result.claimed, false);
    assert.strictEqual(result.items.length, 0);
  });
});
