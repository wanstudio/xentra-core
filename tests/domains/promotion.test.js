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

test('Promotion 6 — Authoritative Zero-Trust Reward Resolution: PrePaymentVerificationGate rejects fake rewards and enforces server metadata', () => {
  const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');
  const db = require('../../server/database/db');
  const brand = db.prepare('SELECT id FROM brands LIMIT 1').get() || { id: 'brand_pos' };
  const branch = db.prepare('SELECT id FROM branches WHERE brand_id = ? LIMIT 1').get(brand.id) || { id: 'branch_pos' };

  // 1. Attacker attempts to spoof arbitrary free item
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

  // 2. Authoritative metadata enforcement for legitimate reward: Server dictates product_id, name, and unit_price
  const promoId = 'prm_auth_test_' + Date.now();
  const rewardProductId = 'prod_reward_' + Date.now();
  const cat = db.prepare('SELECT id FROM categories WHERE brand_id = ? LIMIT 1').get(brand.id) || { id: 'cat_pos' };

  db.prepare(`
    INSERT INTO products (id, brand_id, category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 'Es Teh Legit Asli Server', ?, 5000, 1)
  `).run(rewardProductId, brand.id, cat.id, 'es-teh-server-' + Date.now());

  db.prepare(`
    INSERT INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES (?, ?, 5000, 50, 1)
  `).run(branch.id, rewardProductId);

  db.prepare(`
    INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy, is_active)
    VALUES (?, ?, 'Promo Welcome Server', 'install_incentive', 'exclusive', 1)
  `).run(promoId, brand.id);

  db.prepare(`
    INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents)
    VALUES (?, ?, 'free_product', ?, 0)
  `).run('rwd_' + Date.now(), promoId, rewardProductId);

  const authResult = PrePaymentVerificationGate.verify({
    branch_id: branch.id,
    brand_id: brand.id,
    items: [
      { product_id: 'reward_' + promoId, name: 'HACKED CLIENT NAME', quantity: 1, expected_price: 99999, is_promo_reward: true }
    ],
    customer: { phone: '081299990004' },
    pwa_runtime: { display_mode: 'standalone' }
  });

  assert.strictEqual(authResult.is_valid, true);
  assert.strictEqual(authResult.verified_items.length, 1);
  const rewardItem = authResult.verified_items[0];
  assert.strictEqual(rewardItem.product_id, rewardProductId);
  assert.strictEqual(rewardItem.unit_price, 0); // Server-enforced price, ignored 99999
  assert.strictEqual(rewardItem.name, 'Es Teh Legit Asli Server'); // Server-enforced name, ignored HACKED CLIENT NAME
});

test('Promotion 7 — Scoped POS Offline Idempotency: True parallel sync requests against same (branch_id, client_transaction_id) yield exactly one order and one stock deduction', async () => {
  const OfflineReconciliationService = require('../../domains/pos/services/OfflineReconciliationService');
  const db = require('../../server/database/db');
  const brand = db.prepare('SELECT id FROM brands LIMIT 1').get() || { id: 'brand_pos' };
  const branch = db.prepare('SELECT id FROM branches WHERE brand_id = ? LIMIT 1').get(brand.id) || { id: 'branch_pos' };
  
  // Set deterministic initial stock
  const product = db.prepare('SELECT p.id, p.price FROM products p JOIN branch_products bp ON bp.product_id = p.id WHERE bp.branch_id = ? LIMIT 1').get(branch.id) || { id: 'prod_pos_1', price: 20000 };
  db.prepare('UPDATE branch_products SET stock = 50 WHERE branch_id = ? AND product_id = ?').run(branch.id, product.id);

  const clientTxId = 'pos_tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  const payload = {
    client_transaction_id: clientTxId,
    brand_id: brand.id,
    branch_id: branch.id,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: product.id, quantity: 2, expected_price: product.price || 20000 }],
    customer: { name: 'Pelanggan Offline Test' }
  };

  // True parallel execution: Fire 2 simultaneous sync requests
  const [res1, res2] = await Promise.all([
    OfflineReconciliationService.reconcileOfflineTransaction(payload),
    OfflineReconciliationService.reconcileOfflineTransaction(payload)
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepStrictEqual(statuses, ['DUPLICATE_IGNORED', 'PROCESSED'], 'One request must process and the parallel duplicate must be ignored');

  // Verify both responses provide valid order reference
  assert.ok(res1.order && res2.order);

  // Assert exactly 1 order in DB
  const ordersInDb = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE branch_id = ? AND client_transaction_id = ?').get(branch.id, clientTxId);
  assert.strictEqual(ordersInDb.cnt, 1);

  // Assert exactly one stock mutation (50 - 2 = 48)
  const finalStock = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branch.id, product.id).stock;
  assert.strictEqual(finalStock, 48, 'Stock must be deducted exactly once (quantity = 2)');
});
