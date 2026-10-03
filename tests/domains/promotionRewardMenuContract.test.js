'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const PromotionRepository = require('../../core/data/repositories/PromotionRepository');
const PromotionRewardResolver = require('../../domains/promotion/services/PromotionRewardResolver');
const PromotionRewardMigrationService = require('../../domains/promotion/services/PromotionRewardMigrationService');
const ComposedMenuService = require('../../domains/catalog/services/ComposedMenuService');
const ComposedMenuResolver = require('../../domains/catalog/services/ComposedMenuResolver');
const { ensureComposedMenuSchema } = require('../../domains/catalog/schema/ComposedMenuSchema');

const ORG = 'prmv1_test_org';
const BRAND = 'prmv1_test_brand';
const BRANCH = 'prmv1_test_branch';
const CATEGORY = 'prmv1_test_category';
const BRANCH_CATEGORY = 'prmv1_test_branch_category';

const PRODUCT_SINGLE = 'prmv1_product_single';
const PRODUCT_PACKAGE_A = 'prmv1_product_package_a';
const PRODUCT_PACKAGE_B = 'prmv1_product_package_b';
const PRODUCT_UNIQUE = 'prmv1_product_unique';
const PRODUCT_AMBIGUOUS = 'prmv1_product_ambiguous';
const PRODUCT_MISSING = 'prmv1_product_missing';

const SUB_SINGLE = 'prmv1_sub_single';
const SUB_AMBIG_A = 'prmv1_sub_amb_a';
const SUB_AMBIG_B = 'prmv1_sub_amb_b';
const RASA_ORIGINAL = 'prmv1_rasa_original';
const RASA_A = 'prmv1_rasa_a';
const RASA_B = 'prmv1_rasa_b';

const MENU_SINGLE = 'prmv1_menu_single';
const MENU_PACKAGE = 'prmv1_menu_package';
const MENU_UNIQUE = 'prmv1_menu_unique';
const MENU_AMBIG_A = 'prmv1_menu_amb_a';
const MENU_AMBIG_B = 'prmv1_menu_amb_b';

const PROMO = 'prmv1_promotion';
const REWARD = 'prmv1_reward';
const REPO_PROMO = 'prmv1_repo_promotion';

test.before(async () => {
  await db.ready;
  ensureComposedMenuSchema(db);

  db.prepare(
    "INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'Promotion Reward Menu Test Org', 'prmv1-test-org')"
  ).run(ORG);

  db.prepare(
    "INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Promotion Reward Menu Test Brand', 'prmv1-test-brand')"
  ).run(BRAND, ORG);

  db.prepare(
    "INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'PRMV1 Category', 'prmv1-category', 1)"
  ).run(CATEGORY, BRAND);

  db.prepare(
    "INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, is_active, latitude, longitude) VALUES (?, ?, 'PRMV1 Branch', 'prmv1-branch', 'Test', 1, 0, 0)"
  ).run(BRANCH, BRAND);

  db.prepare(
    "INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'PRMV1 Branch Category', 'prmv1-branch-category', 1, 1)"
  ).run(BRANCH_CATEGORY, BRAND, BRANCH);

  for (const [id, name, sku] of [
    [PRODUCT_SINGLE, 'PRMV1 Single Product', 'PRMV1-SINGLE-001'],
    [PRODUCT_PACKAGE_A, 'PRMV1 Package A', 'PRMV1-PACK-A-001'],
    [PRODUCT_PACKAGE_B, 'PRMV1 Package B', 'PRMV1-PACK-B-001'],
    [PRODUCT_UNIQUE, 'PRMV1 Unique Product', 'PRMV1-UNIQUE-001'],
    [PRODUCT_AMBIGUOUS, 'PRMV1 Ambiguous Product', 'PRMV1-AMB-001'],
    [PRODUCT_MISSING, 'PRMV1 Missing Product', 'PRMV1-MISS-001']
  ]) {
    db.prepare(
      "INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, regular_price, sku, is_active) VALUES (?, ?, ?, ?, ?, 5000, 5000, ?, 1)"
    ).run(id, BRAND, CATEGORY, name, id.toLowerCase(), sku);
  }

  db.prepare(
    "INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'PRMV1 Single', 'prmv1-single', 1, 1)"
  ).run(SUB_SINGLE, BRAND, CATEGORY);
  db.prepare(
    "INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'PRMV1 Amb A', 'prmv1-amb-a', 2, 1)"
  ).run(SUB_AMBIG_A, BRAND, CATEGORY);
  db.prepare(
    "INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'PRMV1 Amb B', 'prmv1-amb-b', 3, 1)"
  ).run(SUB_AMBIG_B, BRAND, CATEGORY);

  for (const [id, name, slug] of [
    [RASA_ORIGINAL, 'Original', 'original-prmv1'],
    [RASA_A, 'PRMV1 Rasa A', 'prmv1-rasa-a'],
    [RASA_B, 'PRMV1 Rasa B', 'prmv1-rasa-b']
  ]) {
    db.prepare(
      "INSERT OR IGNORE INTO menu_flavors (id, brand_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, ?, 1, 1)"
    ).run(id, BRAND, name, slug);
  }

  db.prepare(
    "INSERT OR IGNORE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', ?, ?, 9000, 'ACTIVE')"
  ).run(MENU_SINGLE, BRAND, SUB_SINGLE, RASA_ORIGINAL);

  db.prepare(
    "INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)"
  ).run(MENU_SINGLE, PRODUCT_SINGLE);

  db.prepare(
    "INSERT OR IGNORE INTO menus (id, brand_id, menu_type, package_name, selling_price, status) VALUES (?, ?, 'PACKAGE', 'PRMV1 Paket', 15000, 'ACTIVE')"
  ).run(MENU_PACKAGE, BRAND);

  db.prepare(
    "INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)"
  ).run(MENU_PACKAGE, PRODUCT_PACKAGE_A);
  db.prepare(
    "INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 2, 1)"
  ).run(MENU_PACKAGE, PRODUCT_PACKAGE_B);

  db.prepare(
    "INSERT OR IGNORE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', ?, ?, 7000, 'ACTIVE')"
  ).run(MENU_UNIQUE, BRAND, SUB_SINGLE, RASA_A);
  db.prepare("INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)")
    .run(MENU_UNIQUE, PRODUCT_UNIQUE);

  db.prepare(
    "INSERT OR IGNORE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', ?, ?, 8000, 'ACTIVE')"
  ).run(MENU_AMBIG_A, BRAND, SUB_AMBIG_A, RASA_A);
  db.prepare(
    "INSERT OR IGNORE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', ?, ?, 8500, 'ACTIVE')"
  ).run(MENU_AMBIG_B, BRAND, SUB_AMBIG_B, RASA_B);
  db.prepare("INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)")
    .run(MENU_AMBIG_A, PRODUCT_AMBIGUOUS);
  db.prepare("INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)")
    .run(MENU_AMBIG_B, PRODUCT_AMBIGUOUS);

  for (const [productId, stock] of [
    [PRODUCT_SINGLE, 10],
    [PRODUCT_PACKAGE_A, 10],
    [PRODUCT_PACKAGE_B, 10]
  ]) {
    db.prepare(
      "INSERT OR REPLACE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, ?, 1)"
    ).run(BRANCH, productId, stock);
  }

  db.prepare(
    "INSERT OR REPLACE INTO branch_menus (branch_id, menu_id, is_available, price_override) VALUES (?, ?, 1, NULL)"
  ).run(BRANCH, MENU_SINGLE);
  db.prepare(
    "INSERT OR REPLACE INTO branch_menus (branch_id, menu_id, is_available, price_override) VALUES (?, ?, 1, NULL)"
  ).run(BRANCH, MENU_PACKAGE);

  db.prepare(
    "INSERT OR IGNORE INTO promotions (id, brand_id, name, code, capability_type, stacking_policy, priority_weight, max_redemptions_per_customer, is_active) VALUES (?, ?, 'PRMV1 Promo', NULL, 'install_incentive', 'exclusive', 100, 1, 1)"
  ).run(PROMO);

  db.prepare(
    "INSERT OR IGNORE INTO promotion_rewards (id, promotion_id, reward_type, target_menu_id, target_product_id, amount_in_cents) VALUES (?, ?, 'freebie_product', ?, NULL, 0)"
  ).run(REWARD, PROMO, MENU_SINGLE);
});

test('PromotionRepository persists target_menu_id as the canonical reward identity', () => {
  const repo = new PromotionRepository();
  const created = repo.createPromotion({
    id: REPO_PROMO,
    brandId: BRAND,
    name: 'PRMV1 Repository Promo',
    isActive: 0,
    rewards: [{
      id: 'prmv1_repo_reward',
      reward_type: 'freebie_product',
      target_menu_id: MENU_SINGLE,
      amount_in_cents: 0
    }]
  });

  assert.equal(created.id, REPO_PROMO);
  assert.equal(created.rewards.length, 1);
  assert.equal(created.rewards[0].target_menu_id, MENU_SINGLE);
  assert.equal(created.rewards[0].target_product_id, null);
});

test('canonical reward persists and resolves by Menu, not Product', () => {
  const repo = new PromotionRepository();
  const row = db.prepare("SELECT target_menu_id, target_product_id FROM promotion_rewards WHERE id = ?").get(REWARD);
  assert.equal(row.target_menu_id, MENU_SINGLE);
  assert.equal(row.target_product_id, null);

  const resolved = PromotionRewardResolver.resolveConfiguredReward({
    brandId: BRAND,
    branchId: BRANCH,
    reward: {
      target_menu_id: MENU_SINGLE,
      reward_type: 'freebie_product'
    }
  });

  assert.equal(resolved.source, 'menu');
  assert.equal(resolved.menu_id, MENU_SINGLE);
  assert.equal(resolved.menu_type, 'SINGLE');
  assert.equal(resolved.product_id, PRODUCT_SINGLE);
  assert.equal(resolved.component_snapshot.length, 1);
  assert.equal(resolved.component_snapshot[0].product_id, PRODUCT_SINGLE);
  assert.equal(resolved.component_snapshot[0].quantity, 1);
  assert.equal(resolved.menu_snapshot.menu_id, MENU_SINGLE);
  assert.equal(resolved.menu_snapshot.title, 'PRMV1 Single');

  const reward = repo.findPromotion(PROMO).rewards.find(item => item.id === REWARD);
  assert.equal(reward.target_menu_id, MENU_SINGLE);
});

test('canonical Package reward carries Menu identity and component snapshot without Product commercial identity', () => {
  const resolved = PromotionRewardResolver.resolveConfiguredReward({
    brandId: BRAND,
    branchId: BRANCH,
    reward: {
      target_menu_id: MENU_PACKAGE,
      reward_type: 'freebie_product'
    }
  });

  assert.equal(resolved.menu_id, MENU_PACKAGE);
  assert.equal(resolved.menu_type, 'PACKAGE');
  assert.equal(resolved.product_id, null);
  assert.equal(resolved.component_snapshot.length, 2);
  assert.deepEqual(
    resolved.component_snapshot.map(item => [item.product_id, item.quantity]),
    [[PRODUCT_PACKAGE_A, 1], [PRODUCT_PACKAGE_B, 2]]
  );
  assert.equal(resolved.menu_snapshot.title, 'PRMV1 Paket');
});

test('PromotionEngine applies canonical Menu reward and does not require Product-only identity', () => {
  const result = require('../../domains/promotion/services/PromotionEngineService').evaluate({
    brand_id: BRAND,
    branch_id: BRANCH,
    is_pwa_installed: true,
    customer_phone: '',
    cart_items: []
  });

  const applied = result.applied.find(item => item.promo_id === PROMO);
  assert.ok(applied, 'Canonical promotion is applied');
  assert.equal(applied.reward.target_menu_id, MENU_SINGLE);
  assert.equal(applied.reward.menu_id, MENU_SINGLE);
  assert.equal(applied.reward.menu_type, 'SINGLE');
  assert.equal(applied.reward.product_id, PRODUCT_SINGLE);
  assert.equal(applied.reward.component_snapshot[0].product_id, PRODUCT_SINGLE);
  assert.equal(applied.reward.resolution_source, 'menu');
});

test('database rejects ambiguous reward target configuration', () => {
  assert.throws(
    () => db.prepare(
      "INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_menu_id, target_product_id, amount_in_cents) VALUES (?, ?, 'freebie_product', ?, ?, 0)"
    ).run('prmv1_ambiguous_target', PROMO, MENU_SINGLE, PRODUCT_SINGLE),
    /PROMOTION_REWARD_TARGET_AMBIGUOUS/
  );
});

test('legacy Product reward migration auto-maps only an unambiguous active Menu Satuan', () => {
  const legacyUniqueReward = 'prmv1_reward_unique';
  const legacyMissingReward = 'prmv1_reward_missing';
  const legacyAmbiguousReward = 'prmv1_reward_ambiguous';

  db.prepare(
    "INSERT OR IGNORE INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents) VALUES (?, ?, 'freebie_product', ?, 0)"
  ).run(legacyUniqueReward, PROMO, PRODUCT_UNIQUE);
  db.prepare(
    "INSERT OR IGNORE INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents) VALUES (?, ?, 'freebie_product', ?, 0)"
  ).run(legacyMissingReward, PROMO, PRODUCT_MISSING);
  db.prepare(
    "INSERT OR IGNORE INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents) VALUES (?, ?, 'freebie_product', ?, 0)"
  ).run(legacyAmbiguousReward, PROMO, PRODUCT_AMBIGUOUS);

  const plan = PromotionRewardMigrationService.plan({
    brandId: BRAND,
    promotionId: PROMO
  });

  const unique = plan.find(item => item.reward_id === legacyUniqueReward);
  const missing = plan.find(item => item.reward_id === legacyMissingReward);
  const ambiguous = plan.find(item => item.reward_id === legacyAmbiguousReward);

  assert.equal(unique.status, 'SAFE_TO_MIGRATE');
  assert.equal(unique.target_menu_id, MENU_UNIQUE);
  assert.equal(missing.status, 'NEEDS_REVIEW');
  assert.equal(missing.target_menu_id, null);
  assert.equal(ambiguous.status, 'NEEDS_REVIEW');
  assert.equal(ambiguous.target_menu_id, null);

  const appliedResult = PromotionRewardMigrationService.apply({
    brandId: BRAND,
    promotionId: PROMO
  });

  assert.equal(appliedResult.applied.length, 1);
  assert.equal(appliedResult.applied[0].reward_id, legacyUniqueReward);
  const migratedRow = db.prepare(
    'SELECT target_menu_id, target_product_id FROM promotion_rewards WHERE id = ?'
  ).get(legacyUniqueReward);
  assert.equal(migratedRow.target_menu_id, MENU_UNIQUE);
  assert.equal(migratedRow.target_product_id, null);
});

test.after(() => {
  db.prepare('DELETE FROM promotion_rewards WHERE promotion_id IN (?, ?)').run(PROMO, REPO_PROMO);
  db.prepare('DELETE FROM promotion_rules WHERE promotion_id IN (?, ?)').run(PROMO, REPO_PROMO);
  db.prepare('DELETE FROM promotion_branch_scope WHERE promotion_id IN (?, ?)').run(PROMO, REPO_PROMO);
  db.prepare('DELETE FROM promotions WHERE id IN (?, ?)').run(PROMO, REPO_PROMO);
  db.prepare('DELETE FROM branch_menus WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM branch_product_inventory WHERE branch_id = ?').run(BRANCH);
  db.prepare('DELETE FROM menu_items WHERE menu_id IN (?, ?, ?, ?, ?)').run(
    MENU_SINGLE, MENU_PACKAGE, MENU_UNIQUE, MENU_AMBIG_A, MENU_AMBIG_B
  );
  db.prepare('DELETE FROM menus WHERE id IN (?, ?, ?, ?, ?)').run(
    MENU_SINGLE, MENU_PACKAGE, MENU_UNIQUE, MENU_AMBIG_A, MENU_AMBIG_B
  );
  db.prepare('DELETE FROM menu_flavors WHERE id IN (?, ?, ?)').run(RASA_ORIGINAL, RASA_A, RASA_B);
  db.prepare('DELETE FROM sub_categories WHERE id IN (?, ?, ?)').run(SUB_SINGLE, SUB_AMBIG_A, SUB_AMBIG_B);
  db.prepare('DELETE FROM products WHERE id IN (?, ?, ?, ?, ?, ?)').run(
    PRODUCT_SINGLE, PRODUCT_PACKAGE_A, PRODUCT_PACKAGE_B, PRODUCT_UNIQUE, PRODUCT_AMBIGUOUS, PRODUCT_MISSING
  );
  db.prepare('DELETE FROM branch_categories WHERE id = ?').run(BRANCH_CATEGORY);
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
  db.prepare('DELETE FROM categories WHERE id = ?').run(CATEGORY);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});
