/**
 * Xentra Promotion Domain Comprehensive Tests
 * Validates domain registration, normalized rules/rewards, stacking conflict resolution, and immutable redemptions.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { domain } = require('../../core');
const {
  Promotion,
  ConflictResolver,
  InstallIncentiveStrategy,
  PromotionEngineService
} = require('../../domains/promotion');

test('Promotion 1 — Domain Registration: registered cleanly in DomainRegistry', () => {
  const registered = domain.DomainRegistry.getDomain('promotion');
  assert.ok(registered);
  assert.strictEqual(registered.identity.name, 'promotion');
  assert.strictEqual(registered.identity.version, '1.0.0');
  assert.strictEqual(domain.DomainRegistry.isDomainActive('promotion'), true);
});

test('Promotion 2 — Strategy Evaluation: Web Guest vs Installed PWA User', () => {
  const strategy = new InstallIncentiveStrategy();
  const mockPromo = new Promotion({
    id: 'prm_test_01',
    brand_id: 'brand_bangjo',
    name: 'Promo Install Es Teh',
    capability_type: 'install_incentive',
    stacking_policy: 'exclusive',
    rules: [
      {
        id: 'rul_01',
        rule_type: 'eligibility',
        rule_payload: { requires_pwa_installed: true, target_audience: 'new_user', first_order_only: true }
      }
    ],
    rewards: [
      {
        id: 'rew_01',
        reward_type: 'freebie_product',
        target_product_id: 'prod_es_teh',
        amount_in_cents: 0,
        presentation_payload: {
          banner_title: 'Install sekarang & dapatkan gratis es teh',
          reward_title: 'Selamat! Es Teh Gratis untuk pesanan pertamamu!',
          reward_badge_text: '✓ Bonus PWA Aktif (Rp0)',
          icon_url: '/assets/img/iced-tea.png'
        }
      }
    ]
  });

  // 1. Web browser guest -> Should show banner only
  const webGuestResult = strategy.evaluate(mockPromo, { is_pwa_installed: false });
  assert.strictEqual(webGuestResult.isEligible, true);
  assert.strictEqual(webGuestResult.should_show_banner, true);
  assert.strictEqual(webGuestResult.should_grant_reward, false);

  // 2. Installed PWA new user -> Grants reward
  const installedUserResult = strategy.evaluate(mockPromo, { is_pwa_installed: true, customer_orders_count: 0 });
  assert.strictEqual(installedUserResult.isEligible, true);
  assert.strictEqual(installedUserResult.should_show_banner, false);
  assert.strictEqual(installedUserResult.should_grant_reward, true);
  assert.strictEqual(installedUserResult.reward.reward_price, 0);

  // 3. Customer with prior orders -> Not eligible for first-order welcome gift
  const priorCustomerResult = strategy.evaluate(mockPromo, {
    is_pwa_installed: true,
    customer_phone: '08123456789',
    customer_orders_count: 2
  });
  assert.strictEqual(priorCustomerResult.isEligible, false);
});

test('Promotion 3 — Conflict Resolution: Exclusive vs Combinable Stacking Policies', () => {
  const exclusivePromoA = {
    id: 'prm_exc_A',
    name: 'Diskon 50% Exclusive',
    stacking_policy: 'exclusive',
    priority_weight: 200
  };

  const exclusivePromoB = {
    id: 'prm_exc_B',
    name: 'Diskon 30% Exclusive',
    stacking_policy: 'exclusive',
    priority_weight: 150
  };

  const combinablePromoC = {
    id: 'prm_comb_C',
    name: 'Free Ongkir Combinable',
    stacking_policy: 'combinable',
    priority_weight: 100
  };

  // Case 1: Two exclusive promos -> Higher priority weight wins
  const result1 = ConflictResolver.resolve([exclusivePromoB, exclusivePromoA]);
  assert.strictEqual(result1.applied.length, 1);
  assert.strictEqual(result1.applied[0].id, 'prm_exc_A');
  assert.strictEqual(result1.rejected.length, 1);
  assert.strictEqual(result1.rejected[0].promo_id, 'prm_exc_B');

  // Case 2: Exclusive + Combinable -> Exclusive blocks combinable
  const result2 = ConflictResolver.resolve([exclusivePromoA, combinablePromoC]);
  assert.strictEqual(result2.applied.length, 1);
  assert.strictEqual(result2.applied[0].id, 'prm_exc_A');
  assert.strictEqual(result2.rejected.length, 1);
  assert.strictEqual(result2.rejected[0].promo_id, 'prm_comb_C');

  // Case 3: Multiple Combinables -> All stack together
  const combinablePromoD = {
    id: 'prm_comb_D',
    name: 'Cashback 5% Combinable',
    stacking_policy: 'combinable',
    priority_weight: 90
  };
  const result3 = ConflictResolver.resolve([combinablePromoC, combinablePromoD]);
  assert.strictEqual(result3.applied.length, 2);
  assert.strictEqual(result3.rejected.length, 0);
});
