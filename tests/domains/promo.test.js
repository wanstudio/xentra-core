/**
 * Xentra Promo Domain Tests
 * Validates domain registration, promotion model validation, and install incentive strategy evaluation.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { domain } = require('../../core');
const {
  PromotionModel,
  InstallIncentiveStrategy,
  PromotionEngineService
} = require('../../domains/promo');

test('Promo 1 — Self-Registration: successfully registered in core DomainRegistry', () => {
  const registered = domain.DomainRegistry.getDomain('promo');
  assert.ok(registered);
  assert.strictEqual(registered.identity.name, 'promo');
  assert.strictEqual(registered.identity.version, '1.0.0');
  assert.strictEqual(domain.DomainRegistry.isDomainActive('promo'), true);
});

test('Promo 2 — Model Validation: enforces mandatory fields and valid pricing', () => {
  const invalidResult = PromotionModel.validate({ name: '' });
  assert.strictEqual(invalidResult.isValid, false);
  assert.ok(invalidResult.errors.length >= 2);

  const validResult = PromotionModel.validate({
    brand_id: 'brand_bangjo',
    name: 'Promo Tebus Murah Es Jeruk Rp500',
    promo_type: 'install_incentive',
    reward_price: 500,
    min_spend: 10000
  });
  assert.strictEqual(validResult.isValid, true);
});

test('Promo 3 — Strategy Evaluation: Web Guest vs Installed PWA User', () => {
  const strategy = new InstallIncentiveStrategy();
  const mockPromo = {
    id: 'promo_test_01',
    brand_id: 'brand_bangjo',
    is_active: 1,
    promo_type: 'install_incentive',
    banner_title: 'Install sekarang & dapatkan gratis es teh',
    reward_title: 'Selamat! Es Teh Gratis untuk pesanan pertamamu!',
    reward_badge_text: '✓ Bonus PWA Aktif (Rp0)',
    reward_price: 0,
    target_product_id: 'prod_es_teh'
  };

  // Case A: Web Guest (PWA not installed) -> Evaluates to showing install banner
  const webGuestResult = strategy.evaluate(mockPromo, { is_pwa_installed: false });
  assert.strictEqual(webGuestResult.isApplicable, true);
  assert.strictEqual(webGuestResult.should_show_banner, true);
  assert.strictEqual(webGuestResult.should_grant_reward, false);
  assert.strictEqual(webGuestResult.display.banner_title, 'Install sekarang & dapatkan gratis es teh');

  // Case B: Installed PWA New User -> Evaluates to granting welcome reward
  const installedNewUserResult = strategy.evaluate(mockPromo, { is_pwa_installed: true, prior_orders_count: 0 });
  assert.strictEqual(installedNewUserResult.isApplicable, true);
  assert.strictEqual(installedNewUserResult.should_show_banner, false);
  assert.strictEqual(installedNewUserResult.should_grant_reward, true);
  assert.strictEqual(installedNewUserResult.reward.reward_price, 0);
  assert.strictEqual(installedNewUserResult.display.reward_title, 'Selamat! Es Teh Gratis untuk pesanan pertamamu!');

  // Case C: Existing Member (has prior orders) -> Not eligible
  const existingMemberResult = strategy.evaluate(mockPromo, {
    is_pwa_installed: true,
    customer_phone: '08123456789',
    prior_orders_count: 3
  });
  assert.strictEqual(existingMemberResult.isApplicable, false);
});
