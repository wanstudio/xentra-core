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

test('Promotion 4 — Consumption Boundary: recordRedemptions writes active ledger and enforces idempotency', () => {
  const db = require('../../server/database/db');
  const brand = db.prepare('SELECT id FROM brands LIMIT 1').get() || { id: 'brand_bangjo' };
  const branch = db.prepare('SELECT id FROM branches WHERE brand_id = ? LIMIT 1').get(brand.id) || { id: 'branch_pedurungan' };
  const orderId = 'ord_test_prm_' + Date.now();
  const phone = '081299990001';
  const promoId = 'prm_test_prm_' + Date.now();

  // Create valid parent records
  db.prepare(`
    INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy)
    VALUES (?, ?, 'Test Promo Ledger', 'install_incentive', 'exclusive')
  `).run(promoId, brand.id);

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, subtotal, grand_total)
    VALUES (?, ?, ?, ?, 'Customer Test', ?, 'delivery', 20000, 20000)
  `).run(orderId, 'ORD-' + Date.now(), brand.id, branch.id, phone);

  // 1. Record redemption
  PromotionEngineService.recordRedemptions({
    order_id: orderId,
    brand_id: brand.id,
    branch_id: branch.id,
    customer_phone: phone,
    promotions: [{ promo_id: promoId, benefit_amount: 5000 }]
  });

  const row = db.prepare('SELECT * FROM promotion_redemptions WHERE order_id = ? AND promotion_id = ?').get(orderId, promoId);
  assert.ok(row);
  assert.strictEqual(row.status, 'active');
  assert.strictEqual(row.customer_phone, phone);
  assert.strictEqual(row.benefit_amount, 5000);

  // 2. Duplicate recording on same (order_id, promotion_id) -> Idempotent, no error
  PromotionEngineService.recordRedemptions({
    order_id: orderId,
    brand_id: brand.id,
    branch_id: branch.id,
    customer_phone: phone,
    promotions: [{ promo_id: promoId, benefit_amount: 5000 }]
  });

  const countRows = db.prepare('SELECT COUNT(*) as cnt FROM promotion_redemptions WHERE order_id = ? AND promotion_id = ?').get(orderId, promoId);
  assert.strictEqual(countRows.cnt, 1);
});

test('Promotion 5 — Non-Destructive Cancellation: voidRedemptions marks status voided and preserves audit trail', () => {
  const db = require('../../server/database/db');
  const brand = db.prepare('SELECT id FROM brands LIMIT 1').get() || { id: 'brand_bangjo' };
  const branch = db.prepare('SELECT id FROM branches WHERE brand_id = ? LIMIT 1').get(brand.id) || { id: 'branch_pedurungan' };
  const orderId = 'ord_test_void_' + Date.now();
  const phone = '081299990002';
  const promoId = 'prm_test_void_' + Date.now();

  db.prepare(`
    INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy)
    VALUES (?, ?, 'Test Void Promo', 'install_incentive', 'exclusive')
  `).run(promoId, brand.id);

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, subtotal, grand_total)
    VALUES (?, ?, ?, ?, 'Customer Void Test', ?, 'delivery', 20000, 20000)
  `).run(orderId, 'ORD-V-' + Date.now(), brand.id, branch.id, phone);

  PromotionEngineService.recordRedemptions({
    order_id: orderId,
    brand_id: brand.id,
    branch_id: branch.id,
    customer_phone: phone,
    promotions: [{ promo_id: promoId, benefit_amount: 10000 }]
  });

  // Verify active before void
  const beforeVoid = db.prepare('SELECT * FROM promotion_redemptions WHERE order_id = ?').get(orderId);
  assert.ok(beforeVoid);
  assert.strictEqual(beforeVoid.status, 'active');

  // Void redemption on cancellation
  PromotionEngineService.voidRedemptions({ order_id: orderId, reason: 'Customer cancelled order' });

  const afterVoid = db.prepare('SELECT * FROM promotion_redemptions WHERE order_id = ?').get(orderId);
  assert.ok(afterVoid);
  assert.strictEqual(afterVoid.status, 'voided');
  assert.ok(afterVoid.voided_at);
  assert.strictEqual(afterVoid.void_reason, 'Customer cancelled order');
});

test('Promotion 6 — Authoritative Zero-Trust Reward Resolution: PrePaymentVerificationGate rejects fake rewards', () => {
  const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');
  const db = require('../../server/database/db');
  const brand = db.prepare('SELECT id FROM brands LIMIT 1').get() || { id: 'brand_pos' };
  const branch = db.prepare('SELECT id FROM branches WHERE brand_id = ? LIMIT 1').get(brand.id) || { id: 'branch_pos' };

  // Attacker attempts to spoof arbitrary free item
  const spoofResult = PrePaymentVerificationGate.verify({
    branch_id: branch.id,
    brand_id: brand.id,
    items: [
      { product_id: 'reward_fake_hacked_promo', name: 'Fake Free Food', quantity: 1, expected_price: 0, is_promo_reward: true }
    ],
    customer: { phone: '081299990003' }
  });

  assert.strictEqual(spoofResult.is_valid, false);
  assert.strictEqual(spoofResult.verified_items.length, 0);
  assert.ok(spoofResult.errors.length > 0);
});

test('Promotion 7 — Scoped POS Offline Idempotency: Reconcile drops concurrent duplicate sync without duplicate orders', async () => {
  const OfflineReconciliationService = require('../../domains/pos/services/OfflineReconciliationService');
  const db = require('../../server/database/db');
  const brand = db.prepare('SELECT id FROM brands LIMIT 1').get() || { id: 'brand_pos' };
  const branch = db.prepare('SELECT id FROM branches WHERE brand_id = ? LIMIT 1').get(brand.id) || { id: 'branch_pos' };
  const product = db.prepare('SELECT p.id, p.price FROM products p JOIN branch_products bp ON bp.product_id = p.id WHERE bp.branch_id = ? LIMIT 1').get(branch.id) || { id: 'prod_pos_1', price: 20000 };

  const clientTxId = 'pos_tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  const payload = {
    client_transaction_id: clientTxId,
    brand_id: brand.id,
    branch_id: branch.id,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: product.id, quantity: 1, expected_price: product.price || 20000 }],
    customer: { name: 'Pelanggan Offline Test' }
  };

  // First sync
  const res1 = await OfflineReconciliationService.reconcileOfflineTransaction(payload);
  assert.strictEqual(res1.status, 'PROCESSED');
  assert.ok(res1.order);

  // Second sync (concurrent retry)
  const res2 = await OfflineReconciliationService.reconcileOfflineTransaction(payload);
  assert.strictEqual(res2.status, 'DUPLICATE_IGNORED');
  assert.ok(res2.order);

  // Assert exactly 1 order in DB
  const ordersInDb = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE branch_id = ? AND client_transaction_id = ?').get(branch.id, clientTxId);
  assert.strictEqual(ordersInDb.cnt, 1);
});
