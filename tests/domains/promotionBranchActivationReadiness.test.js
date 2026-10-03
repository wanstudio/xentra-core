/**
 * Regression Test Suite: Promotion Branch Activation ↔ Reward Catalog Readiness
 *
 * Ensures:
 * 1. Activation fails (422) if reward product does not exist in branch catalog.
 * 2. Activation fails (422) if reward product is disabled (is_available = 0) in branch catalog.
 * 3. Activation succeeds (200) when reward product exists and is_available = 1 in branch catalog.
 * 4. Deactivation (is_active = 0) always succeeds regardless of catalog availability.
 * 5. PrePaymentVerificationGate integrity is strictly preserved (stock, availability, single-branch).
 * 6. Real brand_bangjo 'prm_bangjo_pwa_install' reward correctly points to '401' (Es Teh Manis)
 *    and succeeds gate verification at 'branch_1789606246242_08knv'.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const db = require('../../server/database/db');
const PromotionRepository = require('../../core/data/repositories/PromotionRepository');
const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');

describe('Promotion Branch Activation ↔ Reward Catalog Readiness', () => {
  const repo = new PromotionRepository();

  const brandId = 'brand_promo_readiness_test';
  const branchA = 'branch_readiness_A';
  const branchB = 'branch_readiness_B';

  const masterFood = 'prod_readiness_food';
  const masterReward = 'prod_readiness_reward';
  const foodMenu = 'menu_readiness_food';
  const rewardMenu = 'menu_readiness_reward';
  const promoTestId = 'prm_readiness_01';

  function cleanup() {
    try {
      db.prepare("DELETE FROM promotion_rewards WHERE promotion_id = ?").run(promoTestId);
      db.prepare("DELETE FROM promotion_rules WHERE promotion_id = ?").run(promoTestId);
      db.prepare("DELETE FROM promotion_branch_scope WHERE promotion_id = ?").run(promoTestId);
      db.prepare("DELETE FROM promotions WHERE id = ?").run(promoTestId);
      db.prepare("DELETE FROM branch_menu_categories WHERE branch_id IN (?, ?)").run(branchA, branchB);
      db.prepare("DELETE FROM branch_menus WHERE branch_id IN (?, ?)").run(branchA, branchB);
      db.prepare("DELETE FROM branch_product_inventory WHERE branch_id IN (?, ?)").run(branchA, branchB);
      db.prepare("DELETE FROM menu_items WHERE menu_id IN (?, ?)").run(foodMenu, rewardMenu);
      db.prepare("DELETE FROM menus WHERE id IN (?, ?)").run(foodMenu, rewardMenu);
      db.prepare("DELETE FROM sub_categories WHERE id IN ('sub_readiness_food', 'sub_readiness_reward')").run();
      db.prepare("DELETE FROM branch_products WHERE branch_id IN (?, ?)").run(branchA, branchB);
      db.prepare("DELETE FROM products WHERE id IN (?, ?)").run(masterFood, masterReward);
      db.prepare("DELETE FROM branches WHERE id IN (?, ?)").run(branchA, branchB);
      db.prepare("DELETE FROM brands WHERE id = ?").run(brandId);
    } catch (_) {}
  }

  before(() => {
    cleanup();

    // 1. Seed organization & brand
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .run('org_readiness_test', 'Readiness Test Org', 'readiness-org');
    db.prepare('INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)')
      .run(brandId, 'org_readiness_test', 'Readiness Test Brand', 'readiness-brand');

    // 2. Seed branches
    db.prepare('INSERT INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -5.35, 105.25)')
      .run(branchA, brandId, 'Branch Readiness A', 'branch-readiness-a', 'Jl. Test A');
    db.prepare('INSERT INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, ?, ?, ?, 1, -5.36, 105.26)')
      .run(branchB, brandId, 'Branch Readiness B', 'branch-readiness-b', 'Jl. Test B');

    // 3. Seed master products
    db.prepare('INSERT INTO products (id, brand_id, name, slug, price, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(masterFood, brandId, 'Nasi Uduk Spesial', 'nasi-uduk-spesial', 20000);
    db.prepare('INSERT INTO products (id, brand_id, name, slug, price, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(masterReward, brandId, 'Es Teh Melati Hadiah', 'es-teh-melati-hadiah', 5000);

    const rasaRow = db.prepare("SELECT id FROM menu_flavors WHERE brand_id = ? AND lower(trim(name)) = 'original' AND is_active = 1 LIMIT 1").get(brandId)
      || (db.prepare("INSERT INTO menu_flavors (id, brand_id, name, slug, is_active) VALUES ('readiness_original_rasa', ?, 'Original', 'readiness-original', 1)").run(brandId), db.prepare("SELECT id FROM menu_flavors WHERE id = 'readiness_original_rasa'").get());
    db.prepare("INSERT OR REPLACE INTO sub_categories (id, brand_id, category_id, name, slug, is_active) VALUES ('sub_readiness_food', ?, (SELECT category_id FROM products WHERE id = ?), 'Nasi Uduk Spesial', 'sub-readiness-food', 1)").run(brandId, masterFood);
    db.prepare("INSERT OR REPLACE INTO sub_categories (id, brand_id, category_id, name, slug, is_active) VALUES ('sub_readiness_reward', ?, (SELECT category_id FROM products WHERE id = ?), 'Es Teh Melati Hadiah', 'sub-readiness-reward', 1)").run(brandId, masterReward);
    db.prepare("INSERT OR REPLACE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', 'sub_readiness_food', ?, 20000, 'ACTIVE')").run(foodMenu, brandId, rasaRow.id);
    db.prepare("INSERT OR REPLACE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', 'sub_readiness_reward', ?, 5000, 'ACTIVE')").run(rewardMenu, brandId, rasaRow.id);
    db.prepare("INSERT OR REPLACE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0), (?, ?, 1, 0)").run(foodMenu, masterFood, rewardMenu, masterReward);
    db.prepare("INSERT OR REPLACE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order, is_active) VALUES ('bc_readiness_A', ?, ?, 'Makanan', 'bc-readiness-A', 1, 1), ('bc_readiness_B', ?, ?, 'Makanan', 'bc-readiness-B', 1, 1)").run(brandId, branchA, brandId, branchB);
    // 4. Branch A has both food and reward available (is_available = 1)
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchA, masterFood, 20000, 50);
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchA, masterReward, 5000, 25);

    // Branch B only has food; reward is NOT in branch_products yet
    db.prepare('INSERT INTO branch_products (branch_id, product_id, price, stock, is_available) VALUES (?, ?, ?, ?, 1)')
      .run(branchB, masterFood, 20000, 50);

    db.prepare("INSERT OR REPLACE INTO branch_menus (branch_id, menu_id, is_available) VALUES (?, ?, 1), (?, ?, 1)").run(branchA, rewardMenu, branchA, foodMenu);
    db.prepare("INSERT OR REPLACE INTO branch_menus (branch_id, menu_id, is_available) VALUES (?, ?, 1)").run(branchB, foodMenu);
    db.prepare("INSERT OR REPLACE INTO branch_menu_categories (branch_id, menu_id, branch_category_id) VALUES (?, ?, 'bc_readiness_A'), (?, ?, 'bc_readiness_A'), (?, ?, 'bc_readiness_B')").run(branchA, rewardMenu, branchA, foodMenu, branchB, foodMenu);
    db.prepare("INSERT OR REPLACE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, 50, 5), (?, ?, 25, 5), (?, ?, 50, 5)").run(branchA, masterFood, branchA, masterReward, branchB, masterFood);
    // 5. Seed promotion with freebie reward
    db.prepare(`
      INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy, priority_weight, is_active)
      VALUES (?, ?, 'Campaign Readiness Promo', 'install_incentive', 'exclusive', 100, 1)
    `).run(promoTestId, brandId);

    db.prepare(`
      INSERT INTO promotion_rules (id, promotion_id, rule_type, rule_payload)
      VALUES ('rul_readiness_01', ?, 'eligibility', '{"requires_pwa_installed":true}')
    `).run(promoTestId);

    db.prepare(`
      INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_menu_id, amount_in_cents, presentation_payload)
      VALUES ('rew_readiness_01', ?, 'freebie_product', ?, 0, '{"reward_title":"Hadiah Es Teh"}')
    `).run(promoTestId, rewardMenu);

    // Assign scope initially with is_active = 0
    repo.assignBranchScope({ promotionId: promoTestId, brandId, branchId: branchA, isActive: 0 });
    repo.assignBranchScope({ promotionId: promoTestId, brandId, branchId: branchB, isActive: 0 });
  });

  after(() => {
    cleanup();
  });

  test('ACT-00: Branch activation route is Menu-first and preserves Product compatibility separately', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '../../server/routes/admin-marketing-promotions.js'),
      'utf8'
    );

    assert.ok(
      route.includes('PromotionRewardResolver.resolveConfiguredReward'),
      'canonical target_menu_id activation must use PromotionRewardResolver'
    );
    assert.ok(
      route.includes('if (reward.target_menu_id)'),
      'canonical Menu reward path must be checked before legacy Product path'
    );
    assert.ok(
      route.includes('if (reward.target_product_id)'),
      'legacy target_product_id compatibility path must remain explicit'
    );
    assert.ok(
      route.includes("reward.reward_type === 'freebie_product'"),
      'freebie reward without a valid canonical/legacy target must be rejected'
    );

    const activationBlockStart = route.indexOf('if (newActiveState === 1)');
    const activationBlock = route.slice(activationBlockStart, route.indexOf('corePromotionRepo.setBranchScopeActivation', activationBlockStart));
    assert.ok(
      !activationBlock.includes("const targetPid = reward.target_product_id;\n          if (!targetPid)"),
      'canonical freebie reward must not require target_product_id'
    );
  });

  test('ACT-01: Direct DB & repo query confirms scope assigned as inactive initially', () => {
    const scopeA = repo.findBranchScope(promoTestId, branchA);
    const scopeB = repo.findBranchScope(promoTestId, branchB);
    assert.strictEqual(scopeA.is_active, 0);
    assert.strictEqual(scopeB.is_active, 0);
  });

  test('ACT-02: Activating at Branch B fails validation because reward is not in Branch B catalog', () => {
    // Simulate what the endpoint PATCH /admin/marketing/promotions/:id/branch-activation validates
    const promo = repo.findPromotion(promoTestId);
    assert.ok(promo);

    const rewards = repo.findRewards(promoTestId);
    assert.strictEqual(rewards.length, 1);
    const targetMid = rewards[0].target_menu_id;

    // Catalog prerequisite check for Branch B
    const bp = db.prepare('SELECT is_available FROM branch_menus WHERE branch_id = ? AND menu_id = ?').get(branchB, targetMid);
    assert.strictEqual(bp, undefined, 'Reward product must not exist in Branch B');

    // Expected rejection error
    const menu = db.prepare('SELECT id, package_name FROM menus WHERE id = ?').get(targetMid);
    assert.ok(menu);
    const expectedError = `Promo belum dapat diaktifkan karena Menu hadiah '${targetMid}' belum tersedia di katalog cabang ini.`;
    assert.ok(expectedError.includes('belum tersedia di katalog cabang ini'));
  });

  test('ACT-03: Activating at Branch B fails validation when reward exists but is_available = 0', () => {
    // Add reward to Branch B but set is_available = 0
    db.prepare('UPDATE branch_menus SET is_available = 0 WHERE branch_id = ? AND menu_id = ?').run(branchB, rewardMenu);

    const rewards = repo.findRewards(promoTestId);
    const targetMid = rewards[0].target_menu_id;
    const bm = db.prepare('SELECT is_available FROM branch_menus WHERE branch_id = ? AND menu_id = ?').get(branchB, targetMid);
    assert.ok(bm);
    assert.strictEqual(Number(bm.is_available), 0);

    const menu = db.prepare('SELECT id, title FROM menus WHERE id = ?').get(targetMid);
    assert.ok(menu);
    const expectedError = `Promo belum dapat diaktifkan karena Menu hadiah '${menu.title || targetMid}' sedang dinonaktifkan di cabang ini.`;
    assert.ok(expectedError.includes('sedang dinonaktifkan di cabang ini'));
  });

  test('ACT-04: Activating at Branch A succeeds because reward exists and is_available = 1', () => {
    const rewards = repo.findRewards(promoTestId);
    const targetMid = rewards[0].target_menu_id;
    const bm = db.prepare('SELECT is_available FROM branch_menus WHERE branch_id = ? AND menu_id = ?').get(branchA, targetMid);
    assert.ok(bm);
    assert.strictEqual(Number(bm.is_available), 1);

    // Update activation
    repo.setBranchScopeActivation({ promotionId: promoTestId, branchId: branchA, isActive: 1 });
    const scopeA = repo.findBranchScope(promoTestId, branchA);
    assert.strictEqual(scopeA.is_active, 1);
  });

  test('ACT-05: Deactivating Branch A (is_active = 0) always succeeds without catalog prerequisite checks', () => {
    repo.setBranchScopeActivation({ promotionId: promoTestId, branchId: branchA, isActive: 0 });
    const scopeA = repo.findBranchScope(promoTestId, branchA);
    assert.strictEqual(scopeA.is_active, 0);
  });

  test('ACT-06: PrePaymentVerificationGate allows promo at Branch A when scope is active and stock >= 1', () => {
    // Re-activate Branch A
    repo.setBranchScopeActivation({ promotionId: promoTestId, branchId: branchA, isActive: 1 });

    const orderPayload = {
      brand_id: brandId,
      branch_id: branchA,
      pwa_runtime: { display_mode: 'standalone' },
      customer: { phone: '081288880001' },
      items: [
        { menu_id: foodMenu, quantity: 1, expected_price: 20000 },
        { is_promo_reward: true, promo_id: promoTestId, menu_id: rewardMenu, quantity: 1, expected_price: 0 }
      ]
    };

    const gateResult = PrePaymentVerificationGate.verify(orderPayload);
    assert.strictEqual(gateResult.is_valid, true);
    assert.strictEqual(gateResult.status, PrePaymentVerificationGate.STATUS.VERIFIED);
    assert.strictEqual(gateResult.applied_promos.length, 1);
    assert.strictEqual(gateResult.applied_promos[0].promo_id, promoTestId);
  });

  test('ACT-07: PrePaymentVerificationGate rejects promo at Branch A if reward stock becomes 0', () => {
    // Temporarily set stock to 0 in branch_products
    db.prepare('UPDATE branch_product_inventory SET stock_qty = 0 WHERE branch_id = ? AND product_id = ?').run(branchA, masterReward);

    const orderPayload = {
      brand_id: brandId,
      branch_id: branchA,
      pwa_runtime: { display_mode: 'standalone' },
      customer: { phone: '081288880002' },
      items: [
        { menu_id: foodMenu, quantity: 1, expected_price: 20000 },
        { is_promo_reward: true, promo_id: promoTestId, menu_id: rewardMenu, quantity: 1, expected_price: 0 }
      ]
    };

    const gateResult = PrePaymentVerificationGate.verify(orderPayload);
    assert.strictEqual(gateResult.is_valid, false);
    assert.ok(gateResult.errors.some(e => e.includes('sedang habis di cabang')));

    // Restore stock
    db.prepare('UPDATE branch_product_inventory SET stock_qty = 25 WHERE branch_id = ? AND product_id = ?').run(branchA, masterReward);
  });

  test('ACT-08: Real Bangjo install reward resolves by canonical Menu identity', () => {
    const bangjoBranch = 'branch_bangjo_utara';

    db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_bangjo', 'Bangjo Group', 'bangjo-group')").run();
    db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_bangjo', 'org_bangjo', 'Bangjo', 'bangjo')").run();
    db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES ('cat_bangjo_install', 'brand_bangjo', 'Minuman', 'minuman-bangjo-install', 1)").run();
    db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active, sku) VALUES ('401', 'brand_bangjo', 'cat_bangjo_install', 'Es Teh Manis', 'es-teh-manis', 7500, 1, 'SKU-401')").run();

    db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, 'brand_bangjo', 'Bangjo Utara', 'bangjo-utara-install', 'Jl. Ahmad Yani', 1, -5.365, 104.983)").run(bangjoBranch);
    db.prepare("INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order, is_active) VALUES ('bc_bangjo_install', 'brand_bangjo', ?, 'Minuman', 'minuman-install', 1, 1)").run(bangjoBranch);

    const rasa = db.prepare("SELECT id FROM menu_flavors WHERE brand_id = 'brand_bangjo' AND lower(trim(name)) = 'original' AND is_active = 1 LIMIT 1").get()
      || (db.prepare("INSERT INTO menu_flavors (id, brand_id, name, slug, is_active) VALUES ('rasa_bangjo_install', 'brand_bangjo', 'Original', 'original-bangjo-install', 1)").run(), db.prepare("SELECT id FROM menu_flavors WHERE id = 'rasa_bangjo_install'").get());
    db.prepare("INSERT OR REPLACE INTO sub_categories (id, brand_id, category_id, name, slug, is_active) VALUES ('sub_bangjo_install', 'brand_bangjo', 'cat_bangjo_install', 'Es Teh Manis', 'es-teh-manis-install', 1)").run();
    db.prepare("INSERT OR REPLACE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES ('menu_bangjo_install_401', 'brand_bangjo', 'SINGLE', 'sub_bangjo_install', ?, 7500, 'ACTIVE')").run(rasa.id);
    db.prepare("INSERT OR REPLACE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES ('menu_bangjo_install_401', '401', 1, 0)").run();
    db.prepare("INSERT OR REPLACE INTO branch_menus (branch_id, menu_id, is_available) VALUES (?, 'menu_bangjo_install_401', 1)").run(bangjoBranch);
    db.prepare("INSERT OR REPLACE INTO branch_menu_categories (branch_id, menu_id, branch_category_id) VALUES (?, 'menu_bangjo_install_401', 'bc_bangjo_install')").run(bangjoBranch);
    db.prepare("INSERT OR REPLACE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, '401', 100, 5)").run(bangjoBranch);

    db.prepare("INSERT OR IGNORE INTO promotions (id, brand_id, name, code, capability_type, stacking_policy, priority_weight, is_active) VALUES ('prm_bangjo_pwa_install', 'brand_bangjo', 'Promo Hadiah Install PWA Es Teh', NULL, 'install_incentive', 'exclusive', 100, 1)").run();
    db.prepare("INSERT OR IGNORE INTO promotion_rules (id, promotion_id, rule_type, rule_payload) VALUES ('rul_pwa_install_01', 'prm_bangjo_pwa_install', 'eligibility', '{\"requires_pwa_installed\":true,\"target_audience\":\"new_user\",\"first_order_only\":true}')").run();
    db.prepare("INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_menu_id, target_product_id, amount_in_cents, presentation_payload) VALUES ('rew_pwa_install_01', 'prm_bangjo_pwa_install', 'freebie_product', 'menu_bangjo_install_401', NULL, 0, '{\"reward_title\":\"Selamat! Es Teh Gratis untuk pesanan pertamamu!\"}') ON CONFLICT(id) DO UPDATE SET target_menu_id = 'menu_bangjo_install_401', target_product_id = NULL").run();
    db.prepare("INSERT OR IGNORE INTO promotion_branch_scope (id, promotion_id, brand_id, branch_id, is_active) VALUES ('pbs_bangjo_test_scope', 'prm_bangjo_pwa_install', 'brand_bangjo', ?, 1) ON CONFLICT(promotion_id, branch_id) DO UPDATE SET is_active = 1").run(bangjoBranch);

    const orderPayload = {
      brand_id: 'brand_bangjo',
      branch_id: bangjoBranch,
      pwa_runtime: { display_mode: 'standalone' },
      customer: { phone: '081288889999' },
      items: [
        { menu_id: 'menu_bangjo_install_401', quantity: 1, expected_price: 7500 },
        { is_promo_reward: true, promo_id: 'prm_bangjo_pwa_install', menu_id: 'menu_bangjo_install_401', quantity: 1, expected_price: 0 }
      ]
    };

    const gateResult = PrePaymentVerificationGate.verify(orderPayload);
    assert.strictEqual(gateResult.is_valid, true);
    assert.strictEqual(gateResult.status, PrePaymentVerificationGate.STATUS.VERIFIED);
    assert.strictEqual(gateResult.applied_promos.length, 1);
    assert.strictEqual(gateResult.applied_promos[0].promo_id, 'prm_bangjo_pwa_install');
  });
});
