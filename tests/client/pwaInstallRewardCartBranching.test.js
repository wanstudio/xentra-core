/**
 * Comprehensive Unit & Integration Tests: PWA Install Reward Cart Branching & CTA State
 *
 * Verifies the LOCKED ARCHITECTURAL RULES:
 * 1. A claimed PWA reward is cart intent only.
 * 2. Reward MUST NOT receive a concrete branch_id at claim time (branch_id: null).
 * 3. branch_id = null on a promo reward means "fulfillment branch not yet resolved", NOT "another branch".
 * 4. Final checkout resolves exactly ONE fulfillment branch.
 *
 * Test Matrix:
 * - TEST 1: Cart with normal item from Branch A + PWA reward (branch_id: null)
 *           -> Concrete checkout branches = 1
 *           -> CTA displays State A (single branch, direct checkout to Branch A)
 *           -> NOT "2 Pesanan dari 2 cabang"
 * - TEST 2: Cart with Branch A item + Branch B item + PWA reward (branch_id: null)
 *           -> Concrete checkout branches = 2
 *           -> CTA displays State B ("2 Pesanan dari 2 cabang")
 *           -> Branch switcher lists ONLY Branch A and Branch B (reward does not become a 3rd selectable branch)
 * - TEST 3: Cart with ONLY PWA reward (branch_id: null)
 *           -> Concrete checkout branches = 0 (no fabricated branch)
 * - TEST 4: Single branch direct checkout routing
 *           -> Checking out Branch A includes both Branch A item and the unassigned reward in getCheckoutItems()
 * - TEST 5: Switching branch in multi-branch cart
 *           -> Selecting Branch B routes to Branch B checkout and includes Branch B items + unassigned reward
 * - TEST 6: Server verification compatibility
 *           -> PrePaymentVerificationGate.assertSingleBranchCheckout succeeds for selected branch + reward
 *           -> PrePaymentVerificationGate.verify succeeds with reward
 * - TEST 7: Store persistence
 *           -> Claimed reward maintains branch_id === null in cart store throughout transitions
 * - TEST 8: Genuine multi-branch cart without rewards
 *           -> Behaves as standard multi-branch (State B with true branch count)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js');
const CHECKOUT_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js');
const PrePaymentVerificationGate = require(path.resolve(__dirname, '../../domains/commerce/services/PrePaymentVerificationGate.js'));
const db = require(path.resolve(__dirname, '../../server/database/db.js'));

function freshStore() {
  const storage = {};
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };
  delete require.cache[STORE_PATH];
  require(STORE_PATH);
  return globalThis.window.Xentra.Store;
}

function deriveCtaState(Store) {
  const count = Store.getCartCount();
  const total = Store.getCartSubtotal();
  const concreteGroups = Store.getConcreteCheckoutBranchGroups();
  const multi = concreteGroups.length > 1;

  return {
    visible: count > 0,
    isMultiBranch: multi,
    branchCount: concreteGroups.length,
    primaryText: multi ? concreteGroups.length + ' Pesanan' : count + ' Item',
    secondaryText: multi ? 'dari ' + concreteGroups.length + ' cabang' : 'Lihat pesanan kamu',
    totalText: total,
    groups: concreteGroups
  };
}

test('TEST 1: Normal item from Branch A + PWA reward (branch_id: null) -> 1 branch, single checkout CTA', () => {
  const Store = freshStore();

  // Add regular food item from Branch A
  Store.addItem({ id: 'prod_chicken', name: 'Nasi Ayam', price: 25000 }, 1, {
    branch_id: 'branch_a',
    branch_name: 'Cabang A'
  });

  // Add claimed PWA install reward (branch_id: null, is_promo_reward: true)
  Store.addItem({
    id: 'reward_promo_pwa_001',
    name: 'Es Teh Gratis',
    price: 0,
    is_promo_reward: true,
    promo_id: 'promo_pwa_001',
    promotion_id: 'promo_pwa_001'
  }, 1, {
    branch_id: null,
    branch_name: null
  });

  // 1. Check raw branch groups vs concrete checkout branch groups
  const rawGroups = Store.getCartBranchGroups();
  assert.strictEqual(rawGroups.length, 2, 'Raw provenance retains unassigned group for tracking');

  const concreteGroups = Store.getConcreteCheckoutBranchGroups();
  assert.strictEqual(concreteGroups.length, 1, 'Concrete checkout branch groups MUST be exactly 1');
  assert.strictEqual(concreteGroups[0].branch_id, 'branch_a');

  // 2. CTA state derivation
  const cta = deriveCtaState(Store);
  assert.strictEqual(cta.visible, true);
  assert.strictEqual(cta.isMultiBranch, false, 'CTA must NOT trigger multi-branch switcher');
  assert.strictEqual(cta.branchCount, 1);
  assert.strictEqual(cta.primaryText, '2 Item');
  assert.strictEqual(cta.secondaryText, 'Lihat pesanan kamu');
});

test('TEST 2: Branch A + Branch B + PWA reward (branch_id: null) -> 2 branches in CTA and switcher', () => {
  const Store = freshStore();

  Store.addItem({ id: 'prod_chicken', name: 'Nasi Ayam', price: 25000 }, 1, {
    branch_id: 'branch_a',
    branch_name: 'Cabang A'
  });
  Store.addItem({ id: 'prod_tea', name: 'Kopi Susu', price: 18000 }, 1, {
    branch_id: 'branch_b',
    branch_name: 'Cabang B'
  });
  Store.addItem({
    id: 'reward_promo_pwa_001',
    name: 'Es Teh Gratis',
    price: 0,
    is_promo_reward: true,
    promo_id: 'promo_pwa_001'
  }, 1, {
    branch_id: null,
    branch_name: null
  });

  const concreteGroups = Store.getConcreteCheckoutBranchGroups();
  assert.strictEqual(concreteGroups.length, 2, 'Must have exactly 2 concrete branch groups (Branch A and Branch B)');
  assert.deepStrictEqual(
    concreteGroups.map(g => g.branch_id),
    ['branch_a', 'branch_b']
  );

  const cta = deriveCtaState(Store);
  assert.strictEqual(cta.isMultiBranch, true);
  assert.strictEqual(cta.branchCount, 2);
  assert.strictEqual(cta.primaryText, '2 Pesanan');
  assert.strictEqual(cta.secondaryText, 'dari 2 cabang');
});

test('TEST 3: Cart with ONLY PWA reward (branch_id: null) -> 0 concrete branch groups', () => {
  const Store = freshStore();

  Store.addItem({
    id: 'reward_promo_pwa_001',
    name: 'Es Teh Gratis',
    price: 0,
    is_promo_reward: true,
    promo_id: 'promo_pwa_001'
  }, 1, {
    branch_id: null,
    branch_name: null
  });

  const concreteGroups = Store.getConcreteCheckoutBranchGroups();
  assert.strictEqual(concreteGroups.length, 0, 'Unassigned promo reward only cart must yield 0 concrete branches');

  const cta = deriveCtaState(Store);
  assert.strictEqual(cta.isMultiBranch, false);
  assert.strictEqual(cta.branchCount, 0);
  assert.strictEqual(cta.primaryText, '1 Item');
});

test('TEST 4: Branch A checkout includes both Branch A item and unassigned reward in checkout items', () => {
  const Store = freshStore();

  Store.addItem({ id: 'prod_chicken', name: 'Nasi Ayam', price: 25000 }, 1, {
    branch_id: 'branch_a',
    branch_name: 'Cabang A'
  });
  Store.addItem({
    id: 'reward_promo_pwa_001',
    name: 'Es Teh Gratis',
    price: 0,
    is_promo_reward: true,
    promo_id: 'promo_pwa_001'
  }, 1, {
    branch_id: null,
    branch_name: null
  });

  // Emulate checkout.js getCheckoutItems() logic for currentBranchId = 'branch_a'
  const branchLines = Store.getCartItemsForBranch('branch_a');
  assert.strictEqual(branchLines.length, 1);

  const unassignedRewards = (Store.getState().cart.items || []).filter(function (it) {
    return Store.isPromoRewardItem(it) && (!it.branch_id || it.branch_id === '__unassigned__');
  });
  assert.strictEqual(unassignedRewards.length, 1);

  const checkoutItems = branchLines.concat(unassignedRewards);
  assert.strictEqual(checkoutItems.length, 2);
  assert.strictEqual(checkoutItems.some(i => i.id === 'prod_chicken' && i.branch_id === 'branch_a'), true);
  assert.strictEqual(checkoutItems.some(i => i.id === 'reward_promo_pwa_001' && i.branch_id === null), true);
});

test('TEST 5: Branch B checkout in multi-branch cart includes Branch B item and unassigned reward', () => {
  const Store = freshStore();

  Store.addItem({ id: 'prod_chicken', name: 'Nasi Ayam', price: 25000 }, 1, {
    branch_id: 'branch_a',
    branch_name: 'Cabang A'
  });
  Store.addItem({ id: 'prod_kopi', name: 'Kopi Susu', price: 18000 }, 2, {
    branch_id: 'branch_b',
    branch_name: 'Cabang B'
  });
  Store.addItem({
    id: 'reward_promo_pwa_001',
    name: 'Es Teh Gratis',
    price: 0,
    is_promo_reward: true,
    promo_id: 'promo_pwa_001'
  }, 1, {
    branch_id: null,
    branch_name: null
  });

  // Customer selects Branch B from switcher
  const branchBLines = Store.getCartItemsForBranch('branch_b');
  assert.strictEqual(branchBLines.length, 1);
  assert.strictEqual(branchBLines[0].id, 'prod_kopi');

  const unassignedRewards = (Store.getState().cart.items || []).filter(function (it) {
    return Store.isPromoRewardItem(it) && (!it.branch_id || it.branch_id === '__unassigned__');
  });
  const checkoutItems = branchBLines.concat(unassignedRewards);

  assert.strictEqual(checkoutItems.length, 2);
  assert.strictEqual(checkoutItems.find(i => i.id === 'prod_kopi').branch_id, 'branch_b');
  assert.strictEqual(checkoutItems.find(i => i.id === 'reward_promo_pwa_001').branch_id, null);
});

test('TEST 6: PrePaymentVerificationGate.assertSingleBranchCheckout & verify succeed with unassigned reward', () => {
  const brandId = 'brand_test_reward_verify';
  const branchA = 'branch_test_reward_A';
  const foodProductId = 'prod_test_rf_food';
  const rewardProductId = 'prod_test_rf_reward';
  const promoId = 'promo_test_rf_pwa';

  const checkoutItems = [
    { product_id: foodProductId, branch_id: branchA, quantity: 1, expected_price: 25000 },
    { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, branch_id: null, quantity: 1, expected_price: 0 }
  ];

  // 1. assertSingleBranchCheckout: unassigned reward must not trigger single branch error
  const scopeError = PrePaymentVerificationGate.assertSingleBranchCheckout(branchA, checkoutItems);
  assert.strictEqual(scopeError, null, 'Unassigned reward must not trigger CHECKOUT_SINGLE_BRANCH_REQUIRED');

  // 2. Setup DB fixtures for full PrePaymentVerificationGate.verify
  try {
    db.prepare("DELETE FROM promotion_redemptions WHERE brand_id = ?").run(brandId);
    db.prepare("DELETE FROM promotion_branch_scope WHERE brand_id = ?").run(brandId);
    db.prepare("DELETE FROM promotion_rewards WHERE promotion_id = ?").run(promoId);
    db.prepare("DELETE FROM promotion_rules WHERE promotion_id = ?").run(promoId);
    db.prepare("DELETE FROM promotions WHERE brand_id = ?").run(brandId);
    db.prepare("DELETE FROM branch_products WHERE branch_id = ?").run(branchA);
    db.prepare("DELETE FROM products WHERE brand_id = ?").run(brandId);
    db.prepare("DELETE FROM branches WHERE id = ?").run(branchA);
    db.prepare("DELETE FROM brands WHERE id = ?").run(brandId);
  } catch (_) {}

  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run('org_test_rf', 'RF Org', 'rf-org');
  db.prepare('INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(brandId, 'org_test_rf', 'RF Brand', 'rf-brand');
  db.prepare('INSERT INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -5.35, 105.25)').run(branchA, brandId, 'Branch A', 'branch-a', 'Jl. Test A');

  db.prepare('INSERT INTO products (id, brand_id, name, slug, price, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(foodProductId, brandId, 'Nasi Goreng', 'nasi-goreng-rf', 25000);
  db.prepare('INSERT INTO products (id, brand_id, name, slug, price, regular_price, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)').run(rewardProductId, brandId, 'Es Teh Manis', 'es-teh-rf', 5000, 5000);

  db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)').run(branchA, foodProductId, 25000, 50);
  db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)').run(branchA, rewardProductId, 5000, 50);

  db.prepare(`
    INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy, priority_weight, is_active)
    VALUES (?, ?, 'Promo PWA Test', 'install_incentive', 'exclusive', 100, 1)
  `).run(promoId, brandId);

  db.prepare(`
    INSERT INTO promotion_rules (id, promotion_id, rule_type, rule_payload)
    VALUES ('rul_rf_01', ?, 'eligibility', '{"requires_pwa_installed":true}')
  `).run(promoId);

  db.prepare(`
    INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents, presentation_payload)
    VALUES ('rew_rf_01', ?, 'freebie_product', ?, 0, '{"reward_title":"Es Teh Gratis"}')
  `).run(promoId, rewardProductId);

  db.prepare('INSERT INTO promotion_branch_scope (id, promotion_id, brand_id, branch_id, is_active) VALUES (?, ?, ?, ?, 1)')
    .run('pbs_rf_01', promoId, brandId, branchA);

  const verification = PrePaymentVerificationGate.verify({
    branch_id: branchA,
    brand_id: brandId,
    items: [
      { product_id: foodProductId, quantity: 1, expected_price: 25000 },
      { product_id: 'reward_' + promoId, is_promo_reward: true, promo_id: promoId, quantity: 1, expected_price: 0 }
    ],
    customer: { phone: '081299993003' },
    pwa_runtime: { display_mode: 'standalone' }
  });

  assert.strictEqual(verification.status, PrePaymentVerificationGate.STATUS.VERIFIED);
  assert.strictEqual(verification.is_valid, true);
  assert.strictEqual(verification.verified_items.length, 2);
  const verifiedReward = verification.verified_items.find(it => it.is_promo_reward);
  assert.ok(verifiedReward);
  assert.strictEqual(verifiedReward.product_id, rewardProductId);
  assert.strictEqual(verifiedReward.unit_price, 0);

  // Cleanup
  try {
    db.prepare("DELETE FROM promotion_branch_scope WHERE brand_id = ?").run(brandId);
    db.prepare("DELETE FROM promotion_rewards WHERE promotion_id = ?").run(promoId);
    db.prepare("DELETE FROM promotion_rules WHERE promotion_id = ?").run(promoId);
    db.prepare("DELETE FROM promotions WHERE brand_id = ?").run(brandId);
    db.prepare("DELETE FROM branch_products WHERE branch_id = ?").run(branchA);
    db.prepare("DELETE FROM products WHERE brand_id = ?").run(brandId);
    db.prepare("DELETE FROM branches WHERE id = ?").run(branchA);
    db.prepare("DELETE FROM brands WHERE id = ?").run(brandId);
  } catch (_) {}
});

test('TEST 7: Reward maintains branch_id === null in cart store throughout state changes', () => {
  const Store = freshStore();

  // Add reward
  Store.addItem({
    id: 'reward_promo_pwa_001',
    name: 'Es Teh Gratis',
    price: 0,
    is_promo_reward: true,
    promo_id: 'promo_pwa_001'
  }, 1, {
    branch_id: null,
    branch_name: null
  });

  const cartItemsBefore = Store.getState().cart.items;
  assert.strictEqual(cartItemsBefore[0].branch_id, null);

  // Add normal product
  Store.addItem({ id: 'p1', name: 'Nasi Ayam', price: 25000 }, 1, {
    branch_id: 'branch_a',
    branch_name: 'Cabang A'
  });

  const cartItemsAfter = Store.getState().cart.items;
  const rewardItem = cartItemsAfter.find(i => i.id === 'reward_promo_pwa_001');
  assert.strictEqual(rewardItem.branch_id, null, 'branch_id must remain null in cart store');

  // Verify persistence
  const savedCart = JSON.parse(globalThis.localStorage.getItem('xentra_v2_cart'));
  const savedReward = savedCart.items.find(i => i.id === 'reward_promo_pwa_001');
  assert.strictEqual(savedReward.branch_id, null, 'persisted cart must preserve branch_id: null');
});

test('TEST 8: Genuine multi-branch cart without rewards remains unchanged (State B with true branch count)', () => {
  const Store = freshStore();

  Store.addItem({ id: 'p1', name: 'Item Branch A', price: 10000 }, 2, {
    branch_id: 'branch_a',
    branch_name: 'Cabang A'
  });
  Store.addItem({ id: 'p2', name: 'Item Branch B', price: 15000 }, 1, {
    branch_id: 'branch_b',
    branch_name: 'Cabang B'
  });

  const concreteGroups = Store.getConcreteCheckoutBranchGroups();
  assert.strictEqual(concreteGroups.length, 2);

  const cta = deriveCtaState(Store);
  assert.strictEqual(cta.isMultiBranch, true);
  assert.strictEqual(cta.branchCount, 2);
  assert.strictEqual(cta.primaryText, '2 Pesanan');
  assert.strictEqual(cta.secondaryText, 'dari 2 cabang');
  assert.strictEqual(cta.totalText, 35000);
});
