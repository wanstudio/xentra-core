/**
 * Reconciliation Test Suite: Promotion / Reward Cart Lifecycle
 *
 * Validates the locked architectural decision:
 * docs/decisions/final-checkout-verification-single-fulfillment-boundary-v1.md
 *
 * 1. Claiming reward does not freeze a final fulfillment Branch (branch_id is null / unassigned).
 * 2. Reward remains available in cart intent after returning Home and adding food.
 * 3. Opening checkout does not create multiple fulfillment Branches.
 * 4. Multiple Branch candidates do not produce multiple order branches.
 * 5. Final verification resolves exactly ONE fulfillment Branch.
 * 6. Promotion is evaluated only in the resolved Branch context.
 * 7. Multi-branch participating campaign grants at most 1 order entitlement.
 * 8. Reward becomes cleanly invalid if out of stock / disabled in resolved branch.
 * 9. Invalid final verification creates no order/payment commit.
 * 10. Non-promo flows unaffected.
 * 11. PWA install reward flow remains idempotent.
 * 12. Client-provided branch cannot override server authority.
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');
const OrderPlacementService = require('../../domains/commerce/services/OrderPlacementService');
const { PromotionEngineService, Promotion } = require('../../domains/promotion');
const PromotionRewardCart = require('../../apps/customer-pwa/assets/js/core/promo-reward-cart.js');

// Helper to set up mock Store environment for PWA cart tests
function createMockStore() {
  const state = {
    cart: { items: [] },
    notes: {},
    matchedBranch: null
  };

  function cartGroupKey(item) {
    return (item && item.branch_id) ? String(item.branch_id) : '__unassigned__';
  }

  return {
    getState: () => state,
    addItem: (product, qty = 1, branchCtx = null) => {
      const rawBranchId = (branchCtx && (branchCtx.branch_id || branchCtx.branchId)) ||
        (product && (product.branch_id || product.branchId)) || null;
      const branchId = rawBranchId != null ? String(rawBranchId) : null;
      const branchName = (branchCtx && branchCtx.branch_name) || (product && product.branch_name) || null;
      const branchKey = branchId || '';

      const isPromo = Boolean(
        product.is_promo_reward ||
        product.promotion_id ||
        product.promo_id ||
        String(product.id).indexOf('reward_') === 0
      );

      const existing = state.cart.items.find(
        i => String(i.id) === String(product.id) && String(i.branch_id || '') === branchKey
      );

      if (existing) {
        existing.quantity += qty;
      } else {
        const newItem = {
          id: product.id,
          product_id: product.product_id || product.id,
          name: product.name,
          price: Number(product.price),
          regular_price: product.regular_price ? Number(product.regular_price) : null,
          quantity: qty,
          is_promo_reward: isPromo,
          promotion_id: product.promotion_id || product.promo_id || null,
          reward_type: product.reward_type || null,
          branch_id: branchId,
          branch_name: branchName
        };
        if (isPromo) {
          state.cart.items.unshift(newItem);
        } else {
          state.cart.items.push(newItem);
        }
      }
    },
    getCartBranchGroups: () => {
      const groups = [];
      const byKey = {};
      state.cart.items.forEach(item => {
        const key = cartGroupKey(item);
        if (!byKey[key]) {
          byKey[key] = {
            branch_id: item.branch_id || null,
            branch_name: item.branch_name || null,
            items: []
          };
          groups.push(byKey[key]);
        }
        byKey[key].items.push(item);
      });
      return groups;
    },
    getCartItemsForBranch: (branchId) => {
      const key = (branchId == null || String(branchId) === '') ? '__unassigned__' : String(branchId);
      return state.cart.items.filter(item => cartGroupKey(item) === key);
    },
    removeBranchItems: (branchId) => {
      const key = (branchId == null || String(branchId) === '') ? '__unassigned__' : String(branchId);
      state.cart.items = state.cart.items.filter(item => cartGroupKey(item) !== key);
    },
    removeCartItem: (productId, branchId) => {
      const key = (branchId == null || String(branchId) === '') ? '__unassigned__' : String(branchId);
      state.cart.items = state.cart.items.filter(item => !(String(item.id) === String(productId) && cartGroupKey(item) === key));
    },
    clearCart: () => {
      state.cart.items = [];
    }
  };
}

describe('Promotion / Reward Cart Reconciliation & Invariants', () => {
  const brandId = 'brand_reconcile_test';
  const branchAId = 'branch_rec_A';
  const branchBId = 'branch_rec_B';
  const rewardProductId = 'prod_rec_reward_teh';
  const foodProductId = 'prod_rec_food_ayam';
  const promoId = 'prm_rec_welcome_install';

  function cleanup() {
    try {
      const orderIds = db.prepare('SELECT id FROM orders WHERE branch_id IN (?, ?)').all(branchAId, branchBId).map(r => r.id);
      for (const oid of orderIds) {
        for (const t of ['order_items', 'order_status_logs', 'order_deliveries', 'order_payments', 'promotion_redemptions']) {
          try { db.prepare(`DELETE FROM ${t} WHERE order_id = ?`).run(oid); } catch (_) {}
        }
        db.prepare('DELETE FROM orders WHERE id = ?').run(oid);
      }
      db.prepare('DELETE FROM promotion_redemptions WHERE promotion_id = ?').run(promoId);
      db.prepare('DELETE FROM promotion_rewards WHERE promotion_id = ?').run(promoId);
      db.prepare('DELETE FROM promotion_rules WHERE promotion_id = ?').run(promoId);
      db.prepare('DELETE FROM promotions WHERE id = ?').run(promoId);
      db.prepare('DELETE FROM branch_products WHERE branch_id IN (?, ?)').run(branchAId, branchBId);
      db.prepare('DELETE FROM products WHERE id IN (?, ?)').run(rewardProductId, foodProductId);
      db.prepare('DELETE FROM categories WHERE id = ?').run('cat_rec');
      db.prepare('DELETE FROM branches WHERE id IN (?, ?)').run(branchAId, branchBId);
      db.prepare('DELETE FROM brands WHERE id = ?').run(brandId);
    } catch (_) {}
  }

  before(() => {
    cleanup();
    // Seed test brand, branches, products, and promotion in SQLite
    db.prepare('INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(brandId, 'org_xentra_holding', 'Brand Reconcile Test', 'brand-reconcile');
    db.prepare('INSERT INTO categories (id, brand_id, name, slug) VALUES (?, ?, ?, ?)').run('cat_rec', brandId, 'Makanan & Minuman', 'makanan-minuman');
    
    // Seed Branch A & Branch B (both participate in brand)
    db.prepare('INSERT INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -5.35, 105.25)').run(branchAId, brandId, 'Bangjo Pringsewu', 'bangjo-pringsewu', 'Jl. Ahmad Yani No. 1, Pringsewu');
    db.prepare('INSERT INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -5.38, 105.28)').run(branchBId, brandId, 'Bangjo Gading', 'bangjo-gading', 'Jl. Gading No. 2, Pringsewu');

    // Seed master catalog products
    db.prepare('INSERT INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .run(rewardProductId, brandId, 'cat_rec', 'Es Teh Manis', 'es-teh-manis-rec', 5000);
    db.prepare('INSERT INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .run(foodProductId, brandId, 'cat_rec', 'Ayam Penyet Special', 'ayam-penyet-rec', 25000);

    // Branch A has both food and reward in stock
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchAId, foodProductId, 25000, 20);
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchAId, rewardProductId, 5000, 15);

    // Branch B has food, but reward product is OUT OF STOCK (stock: 0)
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchBId, foodProductId, 25000, 30);
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchBId, rewardProductId, 5000, 0);

    // Seed promotion campaign
    db.prepare('INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(promoId, brandId, 'Bonus Install PWA Es Teh', 'install_incentive', 'exclusive');
    db.prepare('INSERT INTO promotion_rules (id, promotion_id, rule_type, rule_payload) VALUES (?, ?, ?, ?)')
      .run('rul_rec_01', promoId, 'eligibility', JSON.stringify({ requires_pwa_installed: true }));
    db.prepare('INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents, presentation_payload) VALUES (?, ?, ?, ?, ?, ?)')
      .run('rew_rec_01', promoId, 'freebie_product', rewardProductId, 0, JSON.stringify({
        banner_title: 'Install PWA dan dapatkan Es Teh Gratis',
        reward_title: 'Bonus Es Teh Gratis'
      }));
  });

  after(() => {
    cleanup();
  });

  test('Invariant 1: Claiming reward does not commit or freeze a fulfillment Branch (branch_id is null/unassigned)', () => {
    const store = createMockStore();
    const claimRes = PromotionRewardCart.claim([], {
      promo_id: promoId,
      product_id: rewardProductId,
      name: 'Es Teh Gratis',
      reward_price: 0,
      regular_price: 5000
    });
    assert.strictEqual(claimRes.claimed, true);

    // Reward added without branchCtx (null branchCtx)
    store.addItem(claimRes.items[0], 1, null);

    const items = store.getState().cart.items;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].is_promo_reward, true);
    assert.strictEqual(items[0].branch_id, null, 'Claimed reward must have null branch_id');
    assert.strictEqual(items[0].branch_name, null, 'Claimed reward must have null branch_name');
  });

  test('Invariant 2: Reward remains available in cart intent after returning Home and adding food', () => {
    const store = createMockStore();
    // 1. Claim reward into cart
    const claimRes = PromotionRewardCart.claim([], {
      promo_id: promoId,
      product_id: rewardProductId,
      name: 'Es Teh Gratis',
      reward_price: 0
    });
    store.addItem(claimRes.items[0], 1, null);

    // 2. Customer navigates Home and adds food from catalog
    store.addItem({
      id: foodProductId,
      product_id: foodProductId,
      name: 'Ayam Penyet Special',
      price: 25000
    }, 1, { branch_id: branchAId, branch_name: 'Bangjo Pringsewu' });

    const items = store.getState().cart.items;
    assert.strictEqual(items.length, 2, 'Cart must hold both reward intent and food item');
    assert.strictEqual(items[0].is_promo_reward, true, 'Reward remains in cart intent');
    assert.strictEqual(items[0].branch_id, null, 'Reward retains unassigned provenance');
    assert.strictEqual(items[1].id, foodProductId);
    assert.strictEqual(items[1].branch_id, branchAId);
  });

  test('Invariant 3 & 4: Opening checkout with unassigned reward does not create multiple fulfillment branches or split order', () => {
    const store = createMockStore();
    // Claim reward
    const claimRes = PromotionRewardCart.claim([], {
      promo_id: promoId,
      product_id: rewardProductId,
      name: 'Es Teh Gratis',
      reward_price: 0
    });
    store.addItem(claimRes.items[0], 1, null);

    // Add food from Branch A
    store.addItem({
      id: foodProductId,
      product_id: foodProductId,
      name: 'Ayam Penyet Special',
      price: 25000
    }, 1, { branch_id: branchAId, branch_name: 'Bangjo Pringsewu' });

    // In checkout, assertSingleBranchCheckout checks branch_id vs items
    const checkoutItems = [
      { product_id: 'reward_' + promoId, is_promo_reward: true, branch_id: null, quantity: 1, expected_price: 0 },
      { product_id: foodProductId, is_promo_reward: false, branch_id: branchAId, quantity: 1, expected_price: 25000 }
    ];

    const scopeError = PrePaymentVerificationGate.assertSingleBranchCheckout(branchAId, checkoutItems);
    assert.strictEqual(scopeError, null, 'Unassigned promo reward must not be treated as a conflicting branch scope');
  });

  test('Invariant 5 & 6: Final verification resolves exactly ONE fulfillment Branch and evaluates promo in that context', () => {
    const customer = { phone: '08123456789', name: 'Budi Test' };
    const pwa_runtime = { display_mode: 'standalone', install_requirement_satisfied: true };

    const verification = PrePaymentVerificationGate.verify({
      branch_id: branchAId,
      brand_id: brandId,
      items: [
        { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, quantity: 1, expected_price: 0 },
        { product_id: foodProductId, is_promo_reward: false, quantity: 1, expected_price: 25000 }
      ],
      customer,
      pwa_runtime
    });

    assert.strictEqual(verification.is_valid, true, 'Verification must succeed for Branch A');
    assert.strictEqual(verification.verified_items.length, 2);

    const verifiedReward = verification.verified_items.find(i => i.is_promo_reward);
    assert.ok(verifiedReward, 'Reward is verified');
    assert.strictEqual(verifiedReward.product_id, rewardProductId);
    assert.strictEqual(verifiedReward.unit_price, 0);
    assert.strictEqual(verification.applied_promos.length, 1);
    assert.strictEqual(verification.applied_promos[0].promo_id, promoId);
  });

  test('Invariant 7: Multi-branch participating campaign grants at most 1 order entitlement across 5 branches', () => {
    const customer = { phone: '08123456789', name: 'Budi Test' };
    const pwa_runtime = { display_mode: 'standalone', install_requirement_satisfied: true };

    // Seed 3 additional branches (C, D, E) to make 5 participating branches in total
    const branchIds = ['branch_rec_C', 'branch_rec_D', 'branch_rec_E'];
    for (let i = 0; i < branchIds.length; i++) {
      const bId = branchIds[i];
      db.prepare('INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -5.39, 105.29)')
        .run(bId, brandId, `Bangjo Cabang ${String.fromCharCode(67 + i)}`, `bangjo-${bId}`, 'Jl. Test No. ' + (i + 3));
      db.prepare('INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
        .run(bId, foodProductId, 25000, 20);
      db.prepare('INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
        .run(bId, rewardProductId, 5000, 15);
    }

    try {
      // 1. Engine evaluation yields exactly 1 applied promo entitlement, not 5
      const evalResult = PromotionEngineService.evaluate({
        brand_id: brandId,
        is_pwa_installed: true,
        customer_phone: customer.phone,
        cart_items: [{ product_id: foodProductId, quantity: 1 }]
      });

      assert.strictEqual(evalResult.applied.length, 1, 'Campaign applies at most once per order, never multiplied by branch count');
      assert.strictEqual(evalResult.applied[0].reward.product_id, rewardProductId);

      // 2. Client sending multiple reward items for the same promoId is capped to 1 verified reward
      const verification = PrePaymentVerificationGate.verify({
        branch_id: branchAId,
        brand_id: brandId,
        items: [
          { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, quantity: 1, expected_price: 0 },
          { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, quantity: 1, expected_price: 0 },
          { product_id: foodProductId, is_promo_reward: false, quantity: 1, expected_price: 25000 }
        ],
        customer,
        pwa_runtime
      });

      // Verification succeeds for valid items, but applied_promos must have exactly 1 entitlement
      assert.strictEqual(verification.applied_promos.length, 1, 'Applied promos contains exactly 1 campaign entitlement');
    } finally {
      // Cleanup branches C, D, E
      for (const bId of branchIds) {
        try {
          db.prepare('DELETE FROM branch_products WHERE branch_id = ?').run(bId);
          db.prepare('DELETE FROM branches WHERE id = ?').run(bId);
        } catch (_) {}
      }
    }
  });

  test('Invariant 8 & 9: Reward becomes cleanly invalid if out of stock in resolved branch; creates NO order or payment commit', async () => {
    const customer = { phone: '08123456789', name: 'Budi Test' };
    const pwa_runtime = { display_mode: 'standalone', install_requirement_satisfied: true };

    // When checkout resolves to Branch B (where reward is out of stock / stock = 0):
    const verification = PrePaymentVerificationGate.verify({
      branch_id: branchBId,
      brand_id: brandId,
      items: [
        { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, quantity: 1, expected_price: 0 },
        { product_id: foodProductId, is_promo_reward: false, quantity: 1, expected_price: 25000 }
      ],
      customer,
      pwa_runtime
    });

    assert.strictEqual(verification.is_valid, false, 'Verification must fail when reward item is out of stock in resolved branch');
    assert.strictEqual(verification.status, 'OUT_OF_STOCK');
    assert.ok(verification.errors.some(e => e.includes('habis')), 'Error message indicates reward product is out of stock');

    // Attempting order placement must fail atomically without inserting order or deducting stock
    const ordersCountBefore = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE branch_id = ?').get(branchBId).cnt;
    const placementResult = await OrderPlacementService.submitOrder({
      brand_id: brandId,
      branch_id: branchBId,
      order_type: 'delivery',
      payment_method: 'cash',
      customer,
      pwa_runtime,
      items: [
        { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, quantity: 1, expected_price: 0 },
        { product_id: foodProductId, is_promo_reward: false, quantity: 1, expected_price: 25000 }
      ]
    });

    assert.strictEqual(placementResult.success, false);
    const ordersCountAfter = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE branch_id = ?').get(branchBId).cnt;
    assert.strictEqual(ordersCountAfter, ordersCountBefore, 'No order must be committed on failed verification');
  });

  test('Invariant 10: Non-promo flows unaffected', async () => {
    const customer = { phone: '08123456780', name: 'Regular Customer' };
    const clientTxId = 'tx_regular_' + Date.now();

    const placementResult = await OrderPlacementService.submitOrder({
      client_transaction_id: clientTxId,
      brand_id: brandId,
      branch_id: branchAId,
      order_type: 'delivery',
      payment_method: 'cash',
      customer,
      items: [
        { product_id: foodProductId, quantity: 1, expected_price: 25000 }
      ]
    });

    assert.strictEqual(placementResult.success, true);
    assert.strictEqual(placementResult.status, 'VERIFIED');
    assert.ok(placementResult.order.id);
  });

  test('Invariant 11: PWA install reward flow remains idempotent across multiple claims', () => {
    const baseItems = [{ id: foodProductId, product_id: foodProductId, name: 'Ayam Penyet', price: 25000, quantity: 1 }];
    const claim1 = PromotionRewardCart.claim(baseItems, {
      promo_id: promoId,
      product_id: rewardProductId,
      name: 'Es Teh Gratis',
      reward_price: 0
    });
    assert.strictEqual(claim1.claimed, true);
    assert.strictEqual(claim1.items.length, 2);

    // Second claim call with same promo_id must be ignored
    const claim2 = PromotionRewardCart.claim(claim1.items, {
      promo_id: promoId,
      product_id: rewardProductId,
      name: 'Es Teh Gratis',
      reward_price: 0
    });
    assert.strictEqual(claim2.claimed, false);
    assert.strictEqual(claim2.items.length, 2, 'Must not duplicate reward item');
  });

  test('Invariant 12: Client-provided branch cannot override server authority', () => {
    // If client asserts product belongs to Branch B, but checkout is submitted to Branch A with conflicting branch provenance:
    const mixedItems = [
      { product_id: foodProductId, branch_id: branchBId, quantity: 1, expected_price: 25000 }
    ];

    const scopeError = PrePaymentVerificationGate.assertSingleBranchCheckout(branchAId, mixedItems);
    assert.ok(scopeError);
    assert.strictEqual(scopeError.status, PrePaymentVerificationGate.STATUS.CHECKOUT_SINGLE_BRANCH_REQUIRED);
  });
});
