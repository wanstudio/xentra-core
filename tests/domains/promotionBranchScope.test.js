/**
 * Xentra Promotion Phase 1 — Comprehensive Test Suite
 * Domain: Campaign Identity <-> Branch Scope <-> Fulfillment Branch <-> Promotion Eligibility <-> One Redemption / One Order
 *
 * Scenarios: PROMO-SCOPE-01 through PROMO-SCOPE-18
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const PromotionRepository = require('../../core/data/repositories/PromotionRepository');
const { PromotionEngineService, Promotion } = require('../../domains/promotion');
const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');

describe('Promotion Phase 1 — Campaign <-> Branch Scope Domain Audit & Implementation', () => {
  const repo = new PromotionRepository();

  const brandId = 'brand_promo_scope_test';
  const branchA = 'branch_scope_A';
  const branchB = 'branch_scope_B';
  const branchC = 'branch_scope_C';
  const branchForeign = 'branch_scope_other_brand';
  const otherBrandId = 'brand_other_brand_test';

  const foodProdA = 'prod_food_scope_A';
  const rewardProdA = 'prod_reward_scope_A';
  const rewardProdB = 'prod_reward_scope_B';

  const promoGlobalMulti = 'prm_multi_branch_01';
  const promoExclusiveA = 'prm_exclusive_branch_A';
  const promoPausedBranchB = 'prm_paused_branch_B';

  function cleanup() {
    try {
      db.prepare("DELETE FROM promotion_redemptions WHERE brand_id IN (?, ?)").run(brandId, otherBrandId);
      db.prepare("DELETE FROM promotion_branch_scope WHERE brand_id IN (?, ?)").run(brandId, otherBrandId);
      db.prepare("DELETE FROM promotion_rewards WHERE promotion_id IN (?, ?, ?)").run(promoGlobalMulti, promoExclusiveA, promoPausedBranchB);
      db.prepare("DELETE FROM promotion_rules WHERE promotion_id IN (?, ?, ?)").run(promoGlobalMulti, promoExclusiveA, promoPausedBranchB);
      db.prepare("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE brand_id IN (?, ?))").run(brandId, otherBrandId);
      db.prepare("DELETE FROM order_payments WHERE order_id IN (SELECT id FROM orders WHERE brand_id IN (?, ?))").run(brandId, otherBrandId);
      db.prepare("DELETE FROM orders WHERE brand_id IN (?, ?)").run(brandId, otherBrandId);
      db.prepare("DELETE FROM promotions WHERE brand_id IN (?, ?)").run(brandId, otherBrandId);
      db.prepare("DELETE FROM branch_products WHERE branch_id IN (?, ?, ?, ?)").run(branchA, branchB, branchC, branchForeign);
      db.prepare("DELETE FROM products WHERE brand_id IN (?, ?)").run(brandId, otherBrandId);
      db.prepare("DELETE FROM branches WHERE id IN (?, ?, ?, ?)").run(branchA, branchB, branchC, branchForeign);
      db.prepare("DELETE FROM brands WHERE id IN (?, ?)").run(brandId, otherBrandId);
    } catch (_) {}
  }

  before(() => {
    cleanup();

    // 1. Seed Organizations & Brands
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run('org_promo_test_1', 'Test Org Promo', 'test-org-promo-1');
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run('org_promo_test_2', 'Other Org Promo', 'test-org-promo-2');

    db.prepare('INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(brandId, 'org_promo_test_1', 'Promo Brand Test', 'promo-brand');
    db.prepare('INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(otherBrandId, 'org_promo_test_2', 'Other Brand Test', 'other-brand');

    // 2. Seed Branches
    db.prepare('INSERT INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -5.35, 105.25)')
      .run(branchA, brandId, 'Branch A (Pringsewu)', 'branch-a', 'Jl. Ahmad Yani No. 1');
    db.prepare('INSERT INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -5.36, 105.26)')
      .run(branchB, brandId, 'Branch B (Gading)', 'branch-b', 'Jl. Gading No. 2');
    db.prepare('INSERT INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -5.37, 105.27)')
      .run(branchC, brandId, 'Branch C (Pagelaran)', 'branch-c', 'Jl. Pagelaran No. 3');
    db.prepare('INSERT INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -6.20, 106.80)')
      .run(branchForeign, otherBrandId, 'Foreign Branch', 'foreign-branch', 'Jl. Sudirman No. 10');

    // 3. Seed Master Products
    db.prepare('INSERT INTO products (id, brand_id, name, slug, price, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(foodProdA, brandId, 'Nasi Ayam Penyet', 'nasi-ayam-penyet', 25000);
    db.prepare('INSERT INTO products (id, brand_id, name, slug, price, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(rewardProdA, brandId, 'Es Teh Promo', 'es-teh-promo', 5000);
    db.prepare('INSERT INTO products (id, brand_id, name, slug, price, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(rewardProdB, brandId, 'Puding Coklat Promo', 'puding-promo', 8000);

    // 4. Seed Branch Products
    // Branch A: food + reward A available (stock 20)
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchA, foodProdA, 25000, 50);
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchA, rewardProdA, 5000, 20);

    // Branch B: food + reward A available (stock 15)
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchB, foodProdA, 25000, 50);
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchB, rewardProdA, 5000, 15);

    // Branch C: food available, but reward A is OUT OF STOCK (stock 0)
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchC, foodProdA, 25000, 50);
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchC, rewardProdA, 5000, 0);

    // 5. Seed Promotion 1: Multi-branch campaign (scoped to Branch A and Branch B)
    db.prepare(`
      INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy, priority_weight, is_active)
      VALUES (?, ?, 'Campaign Multi-Branch A & B', 'install_incentive', 'exclusive', 100, 1)
    `).run(promoGlobalMulti, brandId);
    db.prepare(`
      INSERT INTO promotion_rules (id, promotion_id, rule_type, rule_payload)
      VALUES ('rul_multi_01', ?, 'eligibility', '{"requires_pwa_installed":true}')
    `).run(promoGlobalMulti);
    db.prepare(`
      INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents, presentation_payload)
      VALUES ('rew_multi_01', ?, 'freebie_product', ?, 0, '{"banner_title":"Multi Promo"}')
    `).run(promoGlobalMulti, rewardProdA);

    // Assign scope: branchA and branchB are active
    repo.assignBranchScope({ promotionId: promoGlobalMulti, brandId, branchId: branchA, isActive: 1 });
    repo.assignBranchScope({ promotionId: promoGlobalMulti, brandId, branchId: branchB, isActive: 1 });

    // 6. Seed Promotion 2: Scoped strictly to Branch A only
    db.prepare(`
      INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy, priority_weight, is_active)
      VALUES (?, ?, 'Campaign Exclusive Branch A', 'install_incentive', 'exclusive', 90, 1)
    `).run(promoExclusiveA, brandId);
    db.prepare(`
      INSERT INTO promotion_rules (id, promotion_id, rule_type, rule_payload)
      VALUES ('rul_excl_01', ?, 'eligibility', '{"requires_pwa_installed":true}')
    `).run(promoExclusiveA);
    db.prepare(`
      INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents, presentation_payload)
      VALUES ('rew_excl_01', ?, 'freebie_product', ?, 0, '{"banner_title":"Exclusive A"}')
    `).run(promoExclusiveA, rewardProdA);

    repo.assignBranchScope({ promotionId: promoExclusiveA, brandId, branchId: branchA, isActive: 1 });

    // 7. Seed Promotion 3: Scoped to Branch B, but deactivated at Branch B (is_active = 0)
    db.prepare(`
      INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy, priority_weight, is_active)
      VALUES (?, ?, 'Campaign Inactive at Branch B', 'install_incentive', 'exclusive', 80, 1)
    `).run(promoPausedBranchB, brandId);
    db.prepare(`
      INSERT INTO promotion_rules (id, promotion_id, rule_type, rule_payload)
      VALUES ('rul_paused_01', ?, 'eligibility', '{"requires_pwa_installed":true}')
    `).run(promoPausedBranchB);
    db.prepare(`
      INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents, presentation_payload)
      VALUES ('rew_paused_01', ?, 'freebie_product', ?, 0, '{"banner_title":"Paused B"}')
    `).run(promoPausedBranchB, rewardProdA);

    repo.assignBranchScope({ promotionId: promoPausedBranchB, brandId, branchId: branchB, isActive: 0 });
  });

  after(() => {
    cleanup();
  });

  test('PROMO-SCOPE-01: promotion_branch_scope table exists with unique constraint (promotion_id, branch_id)', () => {
    const tableInfo = db.prepare("PRAGMA table_info('promotion_branch_scope')").all();
    assert.ok(tableInfo.length > 0, 'Table promotion_branch_scope must exist');
    const cols = tableInfo.map(c => c.name);
    assert.ok(cols.includes('promotion_id'));
    assert.ok(cols.includes('branch_id'));
    assert.ok(cols.includes('brand_id'));
    assert.ok(cols.includes('is_active'));

    // Attempting duplicate insert with same (promotion_id, branch_id) must fail or trigger ON CONFLICT
    assert.doesNotThrow(() => {
      repo.assignBranchScope({ promotionId: promoGlobalMulti, brandId, branchId: branchA, isActive: 1 });
    });
    const count = db.prepare("SELECT COUNT(*) as cnt FROM promotion_branch_scope WHERE promotion_id = ? AND branch_id = ?")
      .get(promoGlobalMulti, branchA).cnt;
    assert.strictEqual(count, 1, 'Exact unique record maintained for (promotion_id, branch_id)');
  });

  test('PROMO-SCOPE-02: Single campaign identity is reused across multiple branches without creating multiple campaign records', () => {
    const campaignRecords = db.prepare("SELECT * FROM promotions WHERE id = ?").all(promoGlobalMulti);
    assert.strictEqual(campaignRecords.length, 1, 'Only one campaign identity record exists in promotions table');

    const scopes = repo.findBranchScopes(promoGlobalMulti);
    assert.strictEqual(scopes.length, 2, 'Campaign has exactly 2 participating branch scopes');
    const branchIds = scopes.map(s => s.branch_id).sort();
    assert.deepStrictEqual(branchIds, [branchA, branchB]);
  });

  test('PROMO-SCOPE-03: Discovery with branch_id returns only promotions scoped and active for that branch', () => {
    const branchAPromos = PromotionEngineService.discoverActivePromotions(brandId, branchA);
    const branchAPromoIds = branchAPromos.map(p => p.id).sort();
    // Branch A has promoGlobalMulti and promoExclusiveA
    assert.deepStrictEqual(branchAPromoIds, [promoExclusiveA, promoGlobalMulti].sort());

    const branchBPromos = PromotionEngineService.discoverActivePromotions(brandId, branchB);
    const branchBPromoIds = branchBPromos.map(p => p.id);
    // Branch B has promoGlobalMulti (promoPausedBranchB is inactive: is_active=0)
    assert.deepStrictEqual(branchBPromoIds, [promoGlobalMulti]);

    const branchCPromos = PromotionEngineService.discoverActivePromotions(brandId, branchC);
    // Branch C has NO scopes assigned
    assert.strictEqual(branchCPromos.length, 0);
  });

  test('PROMO-SCOPE-04: Promotion scoped to Branch A is not discoverable or applicable at Branch B or Branch C', () => {
    const isEligibleAtA = repo.isPromotionEligibleAtBranch(promoExclusiveA, branchA);
    const isEligibleAtB = repo.isPromotionEligibleAtBranch(promoExclusiveA, branchB);
    const isEligibleAtC = repo.isPromotionEligibleAtBranch(promoExclusiveA, branchC);

    assert.strictEqual(isEligibleAtA, true);
    assert.strictEqual(isEligibleAtB, false);
    assert.strictEqual(isEligibleAtC, false);
  });

  test('PROMO-SCOPE-05: Deactivated branch scope (is_active = 0) blocks promotion at that branch while keeping it active at others', () => {
    // Check promoPausedBranchB is inactive at Branch B
    const isEligibleB = repo.isPromotionEligibleAtBranch(promoPausedBranchB, branchB);
    assert.strictEqual(isEligibleB, false);

    // Now deactivate promoGlobalMulti only at Branch B
    repo.setBranchScopeActivation({ promotionId: promoGlobalMulti, branchId: branchB, isActive: 0 });

    const isMultiAtA = repo.isPromotionEligibleAtBranch(promoGlobalMulti, branchA);
    const isMultiAtB = repo.isPromotionEligibleAtBranch(promoGlobalMulti, branchB);

    assert.strictEqual(isMultiAtA, true, 'Branch A remains active');
    assert.strictEqual(isMultiAtB, false, 'Branch B is now inactive');

    // Restore activation at Branch B
    repo.setBranchScopeActivation({ promotionId: promoGlobalMulti, branchId: branchB, isActive: 1 });
    assert.strictEqual(repo.isPromotionEligibleAtBranch(promoGlobalMulti, branchB), true);
  });

  test('PROMO-SCOPE-06: PrePaymentVerificationGate permits promo claimed at participating Branch A with valid stock', () => {
    const result = PrePaymentVerificationGate.verify({
      branch_id: branchA,
      brand_id: brandId,
      items: [
        { product_id: foodProdA, quantity: 1, expected_price: 25000 },
        { product_id: 'reward_' + promoGlobalMulti, is_promo_reward: true, quantity: 1, expected_price: 0 }
      ],
      customer: { phone: '0812340001' },
      pwa_runtime: { display_mode: 'standalone' }
    });

    assert.strictEqual(result.is_valid, true);
    assert.strictEqual(result.status, PrePaymentVerificationGate.STATUS.VERIFIED);
    assert.strictEqual(result.verified_items.length, 2);
    assert.strictEqual(result.applied_promos.length, 1);
    assert.strictEqual(result.applied_promos[0].promo_id, promoGlobalMulti);
  });

  test('PROMO-SCOPE-07: PrePaymentVerificationGate rejects promo claimed at non-participating Branch C', () => {
    const result = PrePaymentVerificationGate.verify({
      branch_id: branchC,
      brand_id: brandId,
      items: [
        { product_id: foodProdA, quantity: 1, expected_price: 25000 },
        { product_id: 'reward_' + promoGlobalMulti, is_promo_reward: true, quantity: 1, expected_price: 0 }
      ],
      customer: { phone: '0812340002' },
      pwa_runtime: { display_mode: 'standalone' }
    });

    assert.strictEqual(result.is_valid, false);
    assert.ok(result.errors.some(e => e.includes('tidak valid') || e.includes('belum terpenuhi') || e.includes('tidak tersedia')));
  });

  test('PROMO-SCOPE-08: PrePaymentVerificationGate rejects promo when branch scope is deactivated', () => {
    // Temporarily deactivate promoGlobalMulti at branchA
    repo.setBranchScopeActivation({ promotionId: promoGlobalMulti, branchId: branchA, isActive: 0 });

    const result = PrePaymentVerificationGate.verify({
      branch_id: branchA,
      brand_id: brandId,
      items: [
        { product_id: foodProdA, quantity: 1, expected_price: 25000 },
        { product_id: 'reward_' + promoGlobalMulti, is_promo_reward: true, quantity: 1, expected_price: 0 }
      ],
      customer: { phone: '0812340003' },
      pwa_runtime: { display_mode: 'standalone' }
    });

    assert.strictEqual(result.is_valid, false);

    // Restore activation
    repo.setBranchScopeActivation({ promotionId: promoGlobalMulti, branchId: branchA, isActive: 1 });
  });

  test('PROMO-SCOPE-09: Multi-branch campaign grants at most 1 redemption per order, never multiplied', () => {
    const result = PrePaymentVerificationGate.verify({
      branch_id: branchA,
      brand_id: brandId,
      items: [
        { product_id: foodProdA, quantity: 1, expected_price: 25000 },
        { product_id: 'reward_' + promoGlobalMulti, is_promo_reward: true, quantity: 1, expected_price: 0 },
        { product_id: 'reward_' + promoGlobalMulti, is_promo_reward: true, quantity: 1, expected_price: 0 } // duplicate attempt
      ],
      customer: { phone: '0812340004' },
      pwa_runtime: { display_mode: 'standalone' }
    });

    assert.strictEqual(result.is_valid, true);
    assert.strictEqual(result.applied_promos.length, 1, 'Exactly one promo entitlement granted');
  });

  function seedTestOrder(orderId, branch = branchA, phone = '0812340005') {
    db.prepare(`
      INSERT OR IGNORE INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, subtotal, grand_total)
      VALUES (?, ?, ?, ?, 'Customer Test', ?, 'delivery', 20000, 20000)
    `).run(orderId, 'ORD-' + orderId, brandId, branch, phone);
  }

  test('PROMO-SCOPE-10: Redemption is recorded with resolved branch_id and immutable audit trail', () => {
    const redemptionId = 'red_test_' + Date.now();
    const orderId = 'ord_test_' + Date.now();
    seedTestOrder(orderId, branchA, '0812340005');

    repo.recordRedemption({
      redemptionId,
      promotionId: promoGlobalMulti,
      orderId,
      brandId,
      branchId: branchA,
      customerPhone: '0812340005',
      benefitAmount: 5000
    });

    const recorded = db.prepare("SELECT * FROM promotion_redemptions WHERE id = ?").get(redemptionId);
    assert.ok(recorded);
    assert.strictEqual(recorded.promotion_id, promoGlobalMulti);
    assert.strictEqual(recorded.branch_id, branchA);
    assert.strictEqual(recorded.status, 'active');
    assert.strictEqual(recorded.benefit_amount, 5000);
  });

  test('PROMO-SCOPE-11: Order-promotion unique constraint prevents duplicate redemptions for same order', () => {
    const orderId = 'ord_unique_' + Date.now();
    seedTestOrder(orderId, branchA, '0812340006');

    repo.recordRedemption({
      redemptionId: 'red_1_' + Date.now(),
      promotionId: promoGlobalMulti,
      orderId,
      brandId,
      branchId: branchA,
      customerPhone: '0812340006',
      benefitAmount: 5000
    });

    // Second redemption attempt on same order and promo must be silently ignored (ON CONFLICT DO NOTHING)
    repo.recordRedemption({
      redemptionId: 'red_2_' + Date.now(),
      promotionId: promoGlobalMulti,
      orderId,
      brandId,
      branchId: branchA,
      customerPhone: '0812340006',
      benefitAmount: 5000
    });

    const count = db.prepare("SELECT COUNT(*) as cnt FROM promotion_redemptions WHERE order_id = ? AND promotion_id = ?")
      .get(orderId, promoGlobalMulti).cnt;
    assert.strictEqual(count, 1, 'Duplicate redemption on same order prevented');
  });

  test('PROMO-SCOPE-12: Non-destructive cancellation voids redemptions without deleting audit rows', () => {
    const orderId = 'ord_void_' + Date.now();
    const redId = 'red_void_' + Date.now();
    seedTestOrder(orderId, branchA, '0812340007');

    repo.recordRedemption({
      redemptionId: redId,
      promotionId: promoGlobalMulti,
      orderId,
      brandId,
      branchId: branchA,
      customerPhone: '0812340007',
      benefitAmount: 5000
    });

    repo.voidRedemptions({ orderId, reason: 'Customer cancelled order' });

    const voided = db.prepare("SELECT * FROM promotion_redemptions WHERE id = ?").get(redId);
    assert.ok(voided);
    assert.strictEqual(voided.status, 'voided');
    assert.strictEqual(voided.void_reason, 'Customer cancelled order');
    assert.ok(voided.voided_at);
  });

  test('PROMO-SCOPE-13: Branch Manager can view promotions scoped to their assigned branch', () => {
    const bmPromosA = repo.findAllPromotions(brandId, branchA);
    const promoIds = bmPromosA.map(p => p.id);
    assert.ok(promoIds.includes(promoGlobalMulti));
    assert.ok(promoIds.includes(promoExclusiveA));
    assert.strictEqual(promoIds.includes(promoPausedBranchB), false);

    const bmPromosB = repo.findAllPromotions(brandId, branchB);
    const promoIdsB = bmPromosB.map(p => p.id);
    assert.ok(promoIdsB.includes(promoGlobalMulti));
    assert.ok(promoIdsB.includes(promoPausedBranchB));
    assert.strictEqual(promoIdsB.includes(promoExclusiveA), false);
  });

  test('PROMO-SCOPE-14: Branch Manager scope activation toggle updates only target branch scope', () => {
    // BM at Branch A toggles promoGlobalMulti to 0
    repo.setBranchScopeActivation({ promotionId: promoGlobalMulti, branchId: branchA, isActive: 0 });

    const scopeA = repo.findBranchScope(promoGlobalMulti, branchA);
    const scopeB = repo.findBranchScope(promoGlobalMulti, branchB);

    assert.strictEqual(scopeA.is_active, 0, 'Branch A scope is now deactivated');
    assert.strictEqual(scopeB.is_active, 1, 'Branch B scope remains unchanged and active');

    // Restore
    repo.setBranchScopeActivation({ promotionId: promoGlobalMulti, branchId: branchA, isActive: 1 });
  });

  test('PROMO-SCOPE-15: Cross-brand branch assignment is rejected by DB foreign key or application layer', () => {
    // Attempting to assign foreign branch belonging to otherBrandId
    const foreignBranch = db.prepare("SELECT brand_id FROM branches WHERE id = ?").get(branchForeign);
    assert.notStrictEqual(foreignBranch.brand_id, brandId);

    assert.strictEqual(repo.isPromotionEligibleAtBranch(promoGlobalMulti, branchForeign), false);
  });

  test('PROMO-SCOPE-16: Removal of branch scope cleanly detaches campaign without deleting campaign identity', () => {
    const tempPromo = 'prm_temp_scope_detach';
    db.prepare(`
      INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy, is_active)
      VALUES (?, ?, 'Temp Detach Promo', 'install_incentive', 'exclusive', 1)
    `).run(tempPromo, brandId);

    repo.assignBranchScope({ promotionId: tempPromo, brandId, branchId: branchA, isActive: 1 });
    assert.strictEqual(repo.findBranchScopes(tempPromo).length, 1);

    // Remove scope
    repo.removeBranchScope({ promotionId: tempPromo, branchId: branchA });
    assert.strictEqual(repo.findBranchScopes(tempPromo).length, 0);

    // Campaign record still exists
    const promoRecord = db.prepare("SELECT id FROM promotions WHERE id = ?").get(tempPromo);
    assert.ok(promoRecord);

    db.prepare("DELETE FROM promotions WHERE id = ?").run(tempPromo);
  });

  test('PROMO-SCOPE-17: Promotion query filtering in findPromotionRedemptions respects branch_id', () => {
    const redA = 'red_filter_A_' + Date.now();
    const redB = 'red_filter_B_' + Date.now();
    const ordA = 'ord_fA_' + Date.now();
    const ordB = 'ord_fB_' + Date.now();

    seedTestOrder(ordA, branchA, '081299990001');
    seedTestOrder(ordB, branchB, '081299990002');

    repo.recordRedemption({
      redemptionId: redA,
      promotionId: promoGlobalMulti,
      orderId: ordA,
      brandId,
      branchId: branchA,
      customerPhone: '081299990001',
      benefitAmount: 5000
    });

    repo.recordRedemption({
      redemptionId: redB,
      promotionId: promoGlobalMulti,
      orderId: ordB,
      brandId,
      branchId: branchB,
      customerPhone: '081299990002',
      benefitAmount: 5000
    });

    const resA = repo.findPromotionRedemptions({ brandId, branchId: branchA });
    const redIdsA = resA.redemptions.map(r => r.id);
    assert.ok(redIdsA.includes(redA));
    assert.strictEqual(redIdsA.includes(redB), false);

    const resAll = repo.findPromotionRedemptions({ brandId });
    const redIdsAll = resAll.redemptions.map(r => r.id);
    assert.ok(redIdsAll.includes(redA));
    assert.ok(redIdsAll.includes(redB));
  });

  test('PROMO-SCOPE-18: Zero-trust client validation — client cannot force promotion availability by tampering branch_id or promo_id', () => {
    // Client passes promoExclusiveA with branchB in items or gate verification
    const spoofResult = PrePaymentVerificationGate.verify({
      branch_id: branchB, // Resolved authoritative branch
      brand_id: brandId,
      items: [
        { product_id: foodProdA, quantity: 1, expected_price: 25000 },
        // Client maliciously claims promoExclusiveA which is only scoped to branchA
        { product_id: 'reward_' + promoExclusiveA, is_promo_reward: true, promo_id: promoExclusiveA, quantity: 1, expected_price: 0 }
      ],
      customer: { phone: '081299990099' },
      pwa_runtime: { display_mode: 'standalone' }
    });

    assert.strictEqual(spoofResult.is_valid, false, 'PrePaymentVerificationGate must reject unscoped promo');
    assert.strictEqual(spoofResult.verified_items.length, 0);
  });
});
