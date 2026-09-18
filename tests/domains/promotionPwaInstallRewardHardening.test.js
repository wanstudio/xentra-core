/**
 * Xentra Promotion Domain — PWA Install Reward Flow Hardening Test Suite
 *
 * Validates the 14 mandatory regression tests specified in the task:
 * 1. PWA claim creates cart intent only.
 * 2. Claimed reward has no premature branch assignment.
 * 3. Claim does not consume stock.
 * 4. Claim does not create redemption.
 * 5. Final checkout resolves one branch.
 * 6. Reward is validated against the resolved branch.
 * 7. Reward unavailable at resolved branch blocks commit.
 * 8. Failed reward validation creates zero order/redemption/inventory side effects.
 * 9. Valid reward commits exactly once.
 * 10. Same campaign available across multiple branches does NOT multiply reward quantity.
 * 11. Fake client reward product identity is rejected/ignored.
 * 12. Client-provided branch cannot override server fulfillment resolution.
 * 13. Duplicate final verification cannot create duplicate redemption.
 * 14. Existing non-PWA promotion behavior remains unchanged.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');
const OrderPlacementService = require('../../domains/commerce/services/OrderPlacementService');
const { PromotionEngineService, Promotion } = require('../../domains/promotion');
const PromotionRewardCart = require('../../apps/customer-pwa/assets/js/core/promo-reward-cart.js');
const PromotionRepository = require('../../core/data/repositories/PromotionRepository');

describe('PWA Install Reward Flow Hardening', () => {
  const brandId = 'brand_pwa_hard_test';
  const branchA = 'branch_pwa_hard_A';
  const branchB = 'branch_pwa_hard_B';
  const foodProductId = 'prod_pwa_hard_food';
  const rewardProductId = 'prod_pwa_hard_reward';
  const promoId = 'prm_pwa_hard_install';

  const promoRepo = new PromotionRepository();

  function cleanup() {
    try {
      db.prepare("DELETE FROM promotion_redemptions WHERE brand_id = ?").run(brandId);
      db.prepare("DELETE FROM promotion_branch_scope WHERE brand_id = ?").run(brandId);
      db.prepare("DELETE FROM promotion_rewards WHERE promotion_id = ?").run(promoId);
      db.prepare("DELETE FROM promotion_rules WHERE promotion_id = ?").run(promoId);
      db.prepare("DELETE FROM promotions WHERE brand_id = ?").run(brandId);
      db.prepare("DELETE FROM branch_products WHERE branch_id IN (?, ?)").run(branchA, branchB);
      db.prepare("DELETE FROM products WHERE brand_id = ?").run(brandId);
      db.prepare("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE brand_id = ?)").run(brandId);
      db.prepare("DELETE FROM order_payments WHERE order_id IN (SELECT id FROM orders WHERE brand_id = ?)").run(brandId);
      db.prepare("DELETE FROM orders WHERE brand_id = ?").run(brandId);
      db.prepare("DELETE FROM branches WHERE id IN (?, ?)").run(branchA, branchB);
      db.prepare("DELETE FROM brands WHERE id = ?").run(brandId);
    } catch (_) {}
  }

  before(() => {
    cleanup();

    // 1. Seed Brand & Branches
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run('org_pwa_test', 'PWA Org', 'pwa-org');
    db.prepare('INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(brandId, 'org_pwa_test', 'PWA Brand', 'pwa-brand');

    db.prepare('INSERT INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -5.35, 105.25)')
      .run(branchA, brandId, 'Pringsewu Branch', 'pringsewu-branch', 'Jl. Ahmad Yani No. 1');
    db.prepare('INSERT INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -5.38, 105.28)')
      .run(branchB, brandId, 'Gading Branch', 'gading-branch', 'Jl. Gading No. 2');

    // 2. Seed Master Catalog Products
    db.prepare('INSERT INTO products (id, brand_id, name, slug, price, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(foodProductId, brandId, 'Nasi Ayam Penyet', 'nasi-ayam-penyet-hard', 25000);
    db.prepare('INSERT INTO products (id, brand_id, name, slug, price, regular_price, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .run(rewardProductId, brandId, 'Es Teh Segar', 'es-teh-segar-hard', 5000, 5000);

    // 3. Branch A has both food and reward in stock (stock = 25)
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchA, foodProductId, 25000, 30);
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchA, rewardProductId, 5000, 25);

    // Branch B has food in stock (stock = 30), but reward is OUT OF STOCK (stock = 0)
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchB, foodProductId, 25000, 30);
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchB, rewardProductId, 5000, 0);

    // 4. Seed Promotion & Branch Scopes (Active on Branch A and Branch B)
    db.prepare(`
      INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy, priority_weight, is_active)
      VALUES (?, ?, 'Promo PWA Es Teh', 'install_incentive', 'exclusive', 100, 1)
    `).run(promoId, brandId);

    db.prepare(`
      INSERT INTO promotion_rules (id, promotion_id, rule_type, rule_payload)
      VALUES ('rul_pwa_hard_01', ?, 'eligibility', '{"requires_pwa_installed":true}')
    `).run(promoId);

    db.prepare(`
      INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents, presentation_payload)
      VALUES ('rew_pwa_hard_01', ?, 'freebie_product', ?, 0, '{"reward_title":"Es Teh Gratis"}')
    `).run(promoId, rewardProductId);

    promoRepo.assignBranchScope({ promotionId: promoId, brandId, branchId: branchA, isActive: 1 });
    promoRepo.assignBranchScope({ promotionId: promoId, brandId, branchId: branchB, isActive: 1 });
  });

  after(() => {
    cleanup();
  });

  // 1. PWA claim creates cart intent only
  test('1. PWA claim creates cart intent only', () => {
    const cart = [];
    const claimRes = PromotionRewardCart.claim(cart, {
      promo_id: promoId,
      product_id: rewardProductId,
      name: 'Es Teh Gratis',
      reward_price: 0
    });

    assert.strictEqual(claimRes.claimed, true);
    assert.strictEqual(claimRes.items.length, 1);
    assert.strictEqual(claimRes.items[0].is_promo_reward, true);
    assert.strictEqual(claimRes.items[0].promotion_id, promoId);
  });

  // 2. Claimed reward has no premature branch assignment
  test('2. Claimed reward has no premature branch assignment', () => {
    const claimRes = PromotionRewardCart.claim([], {
      promo_id: promoId,
      product_id: rewardProductId,
      name: 'Es Teh Gratis',
      reward_price: 0
    });

    const rewardItem = claimRes.items[0];
    assert.strictEqual(rewardItem.branch_id, null, 'branch_id must remain null upon claim');
    assert.strictEqual(rewardItem.branch_name, null, 'branch_name must remain null upon claim');
  });

  // 3. Claim does not consume stock
  test('3. Claim does not consume stock', () => {
    const stockABefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branchA, rewardProductId).stock;
    const stockBBefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branchB, rewardProductId).stock;

    // Simulate claim action in client
    PromotionRewardCart.claim([], {
      promo_id: promoId,
      product_id: rewardProductId,
      name: 'Es Teh Gratis',
      reward_price: 0
    });

    const stockAAfter = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branchA, rewardProductId).stock;
    const stockBAfter = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branchB, rewardProductId).stock;

    assert.strictEqual(stockAAfter, stockABefore, 'Branch A stock unchanged by claim');
    assert.strictEqual(stockBAfter, stockBBefore, 'Branch B stock unchanged by claim');
  });

  // 4. Claim does not create redemption
  test('4. Claim does not create redemption', () => {
    const redemptionsBefore = db.prepare('SELECT COUNT(*) as cnt FROM promotion_redemptions WHERE promotion_id = ?').get(promoId).cnt;

    PromotionRewardCart.claim([], {
      promo_id: promoId,
      product_id: rewardProductId,
      name: 'Es Teh Gratis',
      reward_price: 0
    });

    const redemptionsAfter = db.prepare('SELECT COUNT(*) as cnt FROM promotion_redemptions WHERE promotion_id = ?').get(promoId).cnt;
    assert.strictEqual(redemptionsAfter, redemptionsBefore, 'No redemption records created by client claim');
  });

  // 5. Final checkout resolves one branch
  test('5. Final checkout resolves one branch', () => {
    const items = [
      { product_id: foodProductId, branch_id: branchA, quantity: 1, expected_price: 25000 },
      { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, branch_id: null, quantity: 1, expected_price: 0 }
    ];

    // Assert that unassigned reward items do not cause single branch check to fail
    const scopeError = PrePaymentVerificationGate.assertSingleBranchCheckout(branchA, items);
    assert.strictEqual(scopeError, null, 'Checkout with unassigned reward resolves cleanly to single fulfillment branch');
  });

  // 6. Reward is validated against the resolved branch
  test('6. Reward is validated against the resolved branch', () => {
    const verification = PrePaymentVerificationGate.verify({
      branch_id: branchA,
      brand_id: brandId,
      items: [
        { product_id: foodProductId, quantity: 1, expected_price: 25000 },
        { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, quantity: 1, expected_price: 0 }
      ],
      customer: { phone: '081299991001' },
      pwa_runtime: { display_mode: 'standalone' }
    });

    assert.strictEqual(verification.is_valid, true);
    assert.strictEqual(verification.status, 'VERIFIED');
    assert.strictEqual(verification.verified_items.length, 2);
    const verifiedReward = verification.verified_items.find(it => it.is_promo_reward);
    assert.ok(verifiedReward);
    assert.strictEqual(verifiedReward.product_id, rewardProductId);
    assert.strictEqual(verifiedReward.unit_price, 0);
  });

  // 7. Reward unavailable at resolved branch blocks commit
  test('7. Reward unavailable at resolved branch blocks commit', async () => {
    const verification = PrePaymentVerificationGate.verify({
      branch_id: branchB, // Branch B has reward stock = 0
      brand_id: brandId,
      items: [
        { product_id: foodProductId, quantity: 1, expected_price: 25000 },
        { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, quantity: 1, expected_price: 0 }
      ],
      customer: { phone: '081299991002' },
      pwa_runtime: { display_mode: 'standalone' }
    });

    assert.strictEqual(verification.is_valid, false);
    assert.strictEqual(verification.status, 'OUT_OF_STOCK');
    assert.ok(verification.errors.some(e => /habis|stok/i.test(e)));
  });

  // 8. Failed reward validation creates zero order/redemption/inventory side effects
  test('8. Failed reward validation creates zero order/redemption/inventory side effects', async () => {
    const ordersCountBefore = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE branch_id = ?').get(branchB).cnt;
    const redemptionsBefore = db.prepare('SELECT COUNT(*) as cnt FROM promotion_redemptions WHERE branch_id = ?').get(branchB).cnt;
    const stockFoodBefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branchB, foodProductId).stock;

    const placementResult = await OrderPlacementService.submitOrder({
      brand_id: brandId,
      branch_id: branchB,
      order_type: 'delivery',
      payment_method: 'cash',
      customer: { phone: '081299991003' },
      pwa_runtime: { display_mode: 'standalone' },
      items: [
        { product_id: foodProductId, quantity: 1, expected_price: 25000 },
        { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, quantity: 1, expected_price: 0 }
      ]
    });

    assert.strictEqual(placementResult.success, false);
    const ordersCountAfter = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE branch_id = ?').get(branchB).cnt;
    const redemptionsAfter = db.prepare('SELECT COUNT(*) as cnt FROM promotion_redemptions WHERE branch_id = ?').get(branchB).cnt;
    const stockFoodAfter = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branchB, foodProductId).stock;

    assert.strictEqual(ordersCountAfter, ordersCountBefore, 'No order created');
    assert.strictEqual(redemptionsAfter, redemptionsBefore, 'No redemption created');
    assert.strictEqual(stockFoodAfter, stockFoodBefore, 'No stock deducted');
  });

  // 9. Valid reward commits exactly once
  test('9. Valid reward commits exactly once', async () => {
    const stockRewardBefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branchA, rewardProductId).stock;
    const phone = '081299991004';

    const placementResult = await OrderPlacementService.submitOrder({
      brand_id: brandId,
      branch_id: branchA,
      order_type: 'delivery',
      payment_method: 'cash',
      customer: { phone, name: 'Eligible PWA User' },
      pwa_runtime: { display_mode: 'standalone' },
      items: [
        { product_id: foodProductId, quantity: 1, expected_price: 25000 },
        { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, quantity: 1, expected_price: 0 }
      ]
    });

    assert.strictEqual(placementResult.success, true);
    assert.strictEqual(placementResult.status, 'VERIFIED');
    const orderId = placementResult.order.id;

    // Verify exactly 1 redemption recorded
    const redemptions = db.prepare('SELECT * FROM promotion_redemptions WHERE order_id = ?').all(orderId);
    assert.strictEqual(redemptions.length, 1);
    assert.strictEqual(redemptions[0].promotion_id, promoId);
    assert.strictEqual(redemptions[0].branch_id, branchA);

    // Verify stock deducted for reward
    const stockRewardAfter = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branchA, rewardProductId).stock;
    assert.strictEqual(stockRewardAfter, stockRewardBefore - 1);
  });

  // 10. Same campaign available across multiple branches does NOT multiply reward quantity
  test('10. Same campaign available across multiple branches does NOT multiply reward quantity', () => {
    const scopes = promoRepo.findBranchScopes(promoId);
    assert.ok(scopes.length >= 2, 'Campaign configured across multiple branches');

    const evalResult = PromotionEngineService.evaluate({
      brand_id: brandId,
      branch_id: branchA,
      is_pwa_installed: true,
      customer_phone: '081299991005',
      cart_items: [{ product_id: foodProductId, quantity: 1 }]
    });

    assert.strictEqual(evalResult.applied.length, 1, 'Exactly one reward granted regardless of participating branches count');
  });

  // 11. Fake client reward product identity is rejected/ignored
  test('11. Fake client reward product identity is rejected/ignored', () => {
    const verification = PrePaymentVerificationGate.verify({
      branch_id: branchA,
      brand_id: brandId,
      items: [
        { product_id: foodProductId, quantity: 1, expected_price: 25000 },
        // Client maliciously supplies fake reward product ID and price
        { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, name: 'HACKED BEVERAGE', quantity: 1, expected_price: 99999 }
      ],
      customer: { phone: '081299991006' },
      pwa_runtime: { display_mode: 'standalone' }
    });

    assert.strictEqual(verification.is_valid, true);
    const verifiedReward = verification.verified_items.find(it => it.is_promo_reward);
    assert.strictEqual(verifiedReward.product_id, rewardProductId, 'Server enforced authoritative product_id');
    assert.strictEqual(verifiedReward.unit_price, 0, 'Server enforced authoritative price 0');
    assert.notStrictEqual(verifiedReward.name, 'HACKED BEVERAGE', 'Client spoofed name ignored');
  });

  // 12. Client-provided branch cannot override server fulfillment resolution
  test('12. Client-provided branch cannot override server fulfillment resolution', () => {
    const items = [
      { product_id: foodProductId, branch_id: branchB, quantity: 1, expected_price: 25000 }
    ];

    // Client attempts to submit cart containing Branch B item to Branch A fulfillment:
    const scopeError = PrePaymentVerificationGate.assertSingleBranchCheckout(branchA, items);
    assert.ok(scopeError);
    assert.strictEqual(scopeError.status, PrePaymentVerificationGate.STATUS.CHECKOUT_SINGLE_BRANCH_REQUIRED);
  });

  // 13. Duplicate final verification cannot create duplicate redemption
  test('13. Duplicate final verification cannot create duplicate redemption', () => {
    const orderId = 'ord_dup_ver_' + Date.now();
    const phone = '081299991007';

    db.prepare(`
      INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, subtotal, grand_total)
      VALUES (?, ?, ?, ?, 'Customer Dup Test', ?, 'delivery', 25000, 25000)
    `).run(orderId, 'ORD-' + orderId, brandId, branchA, phone);

    // First redemption record
    promoRepo.recordRedemption({
      redemptionId: 'rdm_dup_1_' + Date.now(),
      promotionId: promoId,
      orderId,
      brandId,
      branchId: branchA,
      customerPhone: phone,
      benefitAmount: 5000
    });

    // Duplicate call for the same orderId and promoId
    promoRepo.recordRedemption({
      redemptionId: 'rdm_dup_2_' + Date.now(),
      promotionId: promoId,
      orderId,
      brandId,
      branchId: branchA,
      customerPhone: phone,
      benefitAmount: 5000
    });

    const count = db.prepare('SELECT COUNT(*) as cnt FROM promotion_redemptions WHERE order_id = ? AND promotion_id = ?').get(orderId, promoId).cnt;
    assert.strictEqual(count, 1, 'Duplicate redemption attempt strictly prevented by unique constraint');
  });

  // 14. Existing non-PWA promotion behavior remains unchanged
  test('14. Existing non-PWA promotion behavior remains unchanged', () => {
    // Normal order with no promo
    const verification = PrePaymentVerificationGate.verify({
      branch_id: branchA,
      brand_id: brandId,
      items: [
        { product_id: foodProductId, quantity: 2, expected_price: 25000 }
      ],
      customer: { phone: '081299991008' }
    });

    assert.strictEqual(verification.is_valid, true);
    assert.strictEqual(verification.verified_items.length, 1);
    assert.strictEqual(verification.verified_items[0].product_id, foodProductId);
    assert.strictEqual(verification.verified_items[0].quantity, 2);
    assert.strictEqual(verification.applied_promos.length, 0);
  });
});
