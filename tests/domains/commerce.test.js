'use strict';
const test = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const {
  PricingPolicyModel,
  LowStockThresholdModel,
  CatalogService,
  PrePaymentVerificationGate,
  OrderPlacementService,
  identity,
  capabilities
} = require('../../domains/commerce');
const { domain, events } = require('../../core');

// Seed test database context
test.before(() => {
  try {
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_test', 'Holding Org', 'org-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_test', 'org_test', 'Brand Test', 'brand-test')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_test', 'brand_test', 'Branch Test', 'branch-test', '6281111111', 'Jl. Test', -7.25, 112.75)`).run();
    db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES ('cat_test', 'brand_test', 'Makanan', 'makanan')`).run();
    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, min_price, max_price, is_active)
      VALUES 
        ('prod_lock', 'brand_test', 'cat_test', 'Ayam Goreng Lock', 'ayam-lock', 25000, 'lock', NULL, NULL, 1),
        ('prod_range', 'brand_test', 'cat_test', 'Bebek Bakar Range', 'bebek-range', 30000, 'range', 28000, 35000, 1),
        ('prod_limited', 'brand_test', 'cat_test', 'Menu Terbatas', 'menu-terbatas', 50000, 'lock', NULL, NULL, 1),
        ('prod_unassigned', 'brand_test', 'cat_test', 'Menu Belum Masuk Cabang', 'menu-unassigned', 20000, 'lock', NULL, NULL, 1)
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold)
      VALUES 
        ('branch_test', 'prod_lock', 99999, 100, 1, 10),
        ('branch_test', 'prod_range', 32000, 50, 1, 5),
        ('branch_test', 'prod_limited', NULL, 4, 1, 8) -- Manager configured low-stock threshold = 8
    `).run();
  } catch (e) {
    console.error('Seed setup error:', e.message);
  }
});

// ==============================================================================
// Commerce 1 — Self-Registration Test
// ==============================================================================
test('Commerce 1 — Self-Registration: successfully registered in core DomainRegistry', () => {
  assert.strictEqual(identity.name, 'commerce');
  assert.strictEqual(capabilities.events_produced.includes('commerce.order.placed'), true);
  assert.strictEqual(domain.DomainRegistry.isDomainActive('commerce'), true);
});

// ==============================================================================
// Commerce 2 — Pure Pricing Policy (Lock Mode)
// ==============================================================================
test('Commerce 2 — Pricing Policy: Mode LOCK strictly returns owner base price', () => {
  const masterProduct = { price: 25000, pricing_mode: 'lock' };
  const resolved = PricingPolicyModel.resolvePrice(masterProduct, 99999);
  assert.strictEqual(resolved.effective_price, 25000);
  assert.strictEqual(resolved.mode, 'lock');
  assert.strictEqual(resolved.is_overridden, false);
});

// ==============================================================================
// Commerce 3 — Pure Pricing Policy (Range Mode)
// ==============================================================================
test('Commerce 3 — Pricing Policy: Mode RANGE validates branch price within allowed range', () => {
  const masterProduct = { price: 30000, pricing_mode: 'range', min_price: 28000, max_price: 35000 };

  const valid = PricingPolicyModel.resolvePrice(masterProduct, 32000);
  assert.strictEqual(valid.effective_price, 32000);
  assert.strictEqual(valid.is_overridden, true);

  assert.throws(() => PricingPolicyModel.resolvePrice(masterProduct, 20000), /out of allowed range/);
  assert.throws(() => PricingPolicyModel.resolvePrice(masterProduct, 40000), /out of allowed range/);
});

// ==============================================================================
// Commerce 4 — Pure Catalog Display Presentation
// ==============================================================================
test('Commerce 4 — Catalog Service: formats active menu for UX display', () => {
  const menu = CatalogService.getMenu({ brand_id: 'brand_test', branch_id: 'branch_test' });
  assert.ok(menu.products.length >= 3);
  const prodLock = menu.products.find(p => p.id === 'prod_lock');
  assert.strictEqual(prodLock.price, 25000); // Lock mode respected
  const prodRange = menu.products.find(p => p.id === 'prod_range');
  assert.strictEqual(prodRange.price, 32000); // Range override respected
});

// ==============================================================================
// Commerce 5 — Pre-Payment Final Verification Gate (No 999 fake stock & Price Check)
// ==============================================================================
test('Commerce 5 — Pre-Payment Gate: verifies stock, rejects unassigned branch products, and detects price change', () => {
  // 1. Valid items pass verification
  const validVerification = PrePaymentVerificationGate.verify({
    brand_id: 'brand_test',
    branch_id: 'branch_test',
    items: [
      { product_id: 'prod_lock', quantity: 2, expected_price: 25000 },
      { product_id: 'prod_range', quantity: 1, expected_price: 32000 }
    ]
  });
  assert.strictEqual(validVerification.is_valid, true);
  assert.strictEqual(validVerification.status, 'VERIFIED');
  assert.strictEqual(validVerification.verified_items.length, 2);

  // 2. Unassigned product rejection (No 999 fake fallback!)
  const unassignedVerification = PrePaymentVerificationGate.verify({
    brand_id: 'brand_test',
    branch_id: 'branch_test',
    items: [
      { product_id: 'prod_unassigned', quantity: 1, expected_price: 20000 }
    ]
  });
  assert.strictEqual(unassignedVerification.is_valid, false);
  assert.strictEqual(unassignedVerification.status, 'PRODUCT_UNAVAILABLE');
  assert.ok(unassignedVerification.errors[0].includes('belum dialokasikan'));

  // 3. Price change detection (e.g. customer cart had stale 30000 instead of 32000)
  const stalePriceVerification = PrePaymentVerificationGate.verify({
    brand_id: 'brand_test',
    branch_id: 'branch_test',
    items: [
      { product_id: 'prod_range', quantity: 1, expected_price: 30000 }
    ]
  });
  assert.strictEqual(stalePriceVerification.is_valid, false);
  assert.strictEqual(stalePriceVerification.status, 'PRICE_CHANGED');
  assert.strictEqual(stalePriceVerification.price_diffs.length, 1);
  assert.strictEqual(stalePriceVerification.price_diffs[0].difference, 2000);

  // 4. Out of stock detection (requested 10 when stock is 4)
  const outOfStockVerification = PrePaymentVerificationGate.verify({
    brand_id: 'brand_test',
    branch_id: 'branch_test',
    items: [
      { product_id: 'prod_limited', quantity: 10, expected_price: 50000 }
    ]
  });
  assert.strictEqual(outOfStockVerification.is_valid, false);
  assert.strictEqual(outOfStockVerification.status, 'OUT_OF_STOCK');
});

// ==============================================================================
// Commerce 6 — Order Placement: Guarded Stock Deduction, Rollback & Dynamic Threshold
// ==============================================================================
test('Commerce 6 — Order Placement: ACID guarded stock deduction, oversell prevention, and dynamic warning', async () => {
  let lowStockEventReceived = null;
  let orderPlacedEventReceived = null;

  events.EventBus.subscribe('inventory.low_stock_warning', (e) => {
    lowStockEventReceived = e;
  });

  events.EventBus.subscribe('commerce.order.placed', (e) => {
    orderPlacedEventReceived = e;
  });

  // Initial stock for prod_limited is 4, threshold is 8
  const initialBranchRow = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_test', 'prod_limited');
  assert.strictEqual(initialBranchRow.stock, 4);

  // Customer A places order of 2 items
  const orderResult = await OrderPlacementService.submitOrder({
    brand_id: 'brand_test',
    branch_id: 'branch_test',
    customer: { name: 'Ikhwan Customer', phone: '62899999999', address: 'Jl. Rungkut Surabaya' },
    items: [
      { product_id: 'prod_limited', quantity: 2, expected_price: 50000 }
    ],
    delivery_fee: 10000,
    payment_method: 'cash',
    trace_context: { correlation_id: 'corr_test_order_flow' }
  });

  assert.strictEqual(orderResult.success, true);
  assert.strictEqual(orderResult.order.grand_total, 110000);

  // 1. Verify Stock actually decremented in database to 2 for confirmed cash order
  const updatedBranchRow = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_test', 'prod_limited');
  assert.strictEqual(updatedBranchRow.stock, 2, 'Live stock must be decremented from 4 to 2');

  // Verify Cross-Domain Ledger Entry (Commerce -> Inventory)
  const ledgerMovement = db.prepare('SELECT * FROM inventory_movements WHERE reference_id = ?').get(orderResult.order.order_number);
  assert.ok(ledgerMovement, 'Inventory ledger must have an immutable entry for sale_deduction');
  assert.strictEqual(ledgerMovement.movement_type, 'sale_deduction');
  assert.strictEqual(ledgerMovement.quantity, -2);
  assert.strictEqual(ledgerMovement.previous_stock, 4);
  assert.strictEqual(ledgerMovement.current_stock, 2);

  // 2. Concurrency Guard verification: Simulating race condition where stock is depleted
  // If another concurrent request tries to deduct 3 when only 2 remain, transaction fails and rolls back
  const raceResult = await OrderPlacementService.submitOrder({
    brand_id: 'brand_test',
    branch_id: 'branch_test',
    customer: { name: 'Customer Race', phone: '6288888888' },
    payment_method: 'cash',
    items: [{ product_id: 'prod_limited', quantity: 3, expected_price: 50000 }]
  });
  assert.strictEqual(raceResult.success, false);
  assert.strictEqual(raceResult.status, 'OUT_OF_STOCK');

  // Stock remains untampered at 2 after failed attempt
  const finalStockRow = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_test', 'prod_limited');
  assert.strictEqual(finalStockRow.stock, 2);

  // 3. Verify Branch Manager Configured Threshold (8) was used for warning
  assert.ok(lowStockEventReceived);
  assert.strictEqual(orderPlacedEventReceived.payload.order_id, orderResult.order.id);
  assert.strictEqual(lowStockEventReceived.payload.threshold, 8, 'Must use branch manager threshold (8)');
});

// ==============================================================================
// Commerce 7 — Reservation Operational Risk: Same-Day Reservation Rejection
// ==============================================================================
test('Commerce 7 — Reservation: rejects same-day reservation and accepts future dates', async () => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  // 1. Same-Day reservation request -> STRICTLY REJECTED
  const sameDayResult = await OrderPlacementService.submitOrder({
    brand_id: 'brand_test',
    branch_id: 'branch_test',
    order_type: 'reservation',
    reservation_date: todayStr,
    guest_count: 5,
    customer: { name: 'Rombongan Dadakan', phone: '0812345678' },
    items: [
      { product_id: 'prod_lock', quantity: 1, expected_price: 25000 }
    ]
  });

  assert.strictEqual(sameDayResult.success, false);
  assert.strictEqual(sameDayResult.status, 'SAME_DAY_RESERVATION_REJECTED');
  assert.ok(sameDayResult.errors[0].includes('tidak diperbolehkan'));

  // 2. Missing/Invalid guest_count -> STRICTLY REJECTED
  const missingGuestResult = await OrderPlacementService.submitOrder({
    brand_id: 'brand_test',
    branch_id: 'branch_test',
    order_type: 'reservation',
    reservation_date: tomorrowStr,
    guest_count: 0,
    customer: { name: 'Rombongan Tanpa Jumlah Tamu', phone: '0812345678' }
  });
  assert.strictEqual(missingGuestResult.success, false);
  assert.strictEqual(missingGuestResult.status, 'VALIDATION_ERROR');
  assert.ok(missingGuestResult.errors[0].includes('guest_count'));

  // 3. Future-Day reservation request (Tomorrow) with valid guest_count -> ACCEPTED as pure table booking (subtotal 0, items [])
  const futureResult = await OrderPlacementService.submitOrder({
    brand_id: 'brand_test',
    branch_id: 'branch_test',
    order_type: 'reservation',
    reservation_date: tomorrowStr,
    guest_count: 5,
    customer: { name: 'Rombongan Besok', phone: '0812345678' }
  });

  assert.strictEqual(futureResult.success, true);
  assert.strictEqual(futureResult.order.order_type, 'reservation');
  assert.strictEqual(futureResult.order.guest_count, 5);
  assert.strictEqual(futureResult.order.subtotal, 0);
  assert.strictEqual(futureResult.order.grand_total, 0);
  assert.strictEqual(futureResult.order.items.length, 0);
});

// ==============================================================================
// Commerce 8 — PWA Runtime Context: Test A (Browser Biasa) & Test B (Standalone App)
// ==============================================================================
test('Commerce 8 — PWA Runtime Context: Test A (Browser rejected) & Test B (Standalone accepted)', () => {
  const brand = db.prepare('SELECT id FROM brands LIMIT 1').get() || { id: 'brand_test' };
  const branch = db.prepare('SELECT id FROM branches WHERE brand_id = ? LIMIT 1').get(brand.id) || { id: 'branch_test' };
  const cat = db.prepare('SELECT id FROM categories WHERE brand_id = ? LIMIT 1').get(brand.id) || { id: 'cat_test' };

  const promoId = 'prm_ctx_test_' + Date.now();
  const rewardProductId = 'prod_ctx_reward_' + Date.now();

  db.prepare(`
    INSERT INTO products (id, brand_id, category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 'Es Teh PWA Context', ?, 5000, 1)
  `).run(rewardProductId, brand.id, cat.id, 'es-teh-ctx-' + Date.now());

  db.prepare(`
    INSERT INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES (?, ?, 5000, 50, 1)
  `).run(branch.id, rewardProductId);

  db.prepare(`
    INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy, is_active)
    VALUES (?, ?, 'Promo PWA Context Evaluation', 'install_incentive', 'exclusive', 1)
  `).run(promoId, brand.id);

  db.prepare(`
    INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents)
    VALUES (?, ?, 'free_product', ?, 0)
  `).run('rwd_ctx_' + Date.now(), promoId, rewardProductId);

  // Test A — Browser biasa (display_mode = 'browser') -> reward rejected
  const resBrowser = PrePaymentVerificationGate.verify({
    branch_id: branch.id,
    brand_id: brand.id,
    customer: { phone: '081299991101' },
    pwa_runtime: { display_mode: 'browser' },
    items: [
      { product_id: 'reward_' + promoId, quantity: 1, expected_price: 0, is_promo_reward: true }
    ]
  });
  assert.strictEqual(resBrowser.is_valid, false, 'Browser user must be rejected for PWA install reward');
  assert.strictEqual(resBrowser.verified_items.length, 0);

  // Test B — Installed PWA (display_mode = 'standalone') -> reward accepted
  const resStandalone = PrePaymentVerificationGate.verify({
    branch_id: branch.id,
    brand_id: brand.id,
    customer: { phone: '081299991101' },
    pwa_runtime: { display_mode: 'standalone' },
    items: [
      { product_id: 'reward_' + promoId, quantity: 1, expected_price: 0, is_promo_reward: true }
    ]
  });
  assert.strictEqual(resStandalone.is_valid, true, 'Installed standalone PWA user must be granted reward');
  assert.strictEqual(resStandalone.verified_items.length, 1);
  assert.strictEqual(resStandalone.verified_items[0].product_id, rewardProductId);
  assert.strictEqual(resStandalone.verified_items[0].unit_price, 0);
  assert.strictEqual(resStandalone.verified_items[0].name, 'Es Teh PWA Context');
});

// ==============================================================================
// Commerce 9 — PWA Runtime Context: Test C (Legacy Flag Bypass) & Test D (End-to-End Placement)
// ==============================================================================
test('Commerce 9 — PWA Runtime Context: Test C (Legacy flag rejected) & Test D (End-to-End Placement)', async () => {
  const brand = db.prepare('SELECT id FROM brands LIMIT 1').get() || { id: 'brand_test' };
  const branch = db.prepare('SELECT id FROM branches WHERE brand_id = ? LIMIT 1').get(brand.id) || { id: 'branch_test' };
  const cat = db.prepare('SELECT id FROM categories WHERE brand_id = ? LIMIT 1').get(brand.id) || { id: 'cat_test' };

  const promoId = 'prm_e2e_pwa_' + Date.now();
  const rewardProductId = 'prod_e2e_reward_' + Date.now();
  const mainProductId = 'prod_e2e_main_' + Date.now();

  db.prepare(`
    INSERT INTO products (id, brand_id, category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 'Menu Utama E2E PWA', ?, 30000, 1)
  `).run(mainProductId, brand.id, cat.id, 'menu-e2e-pwa-' + Date.now());

  db.prepare(`
    INSERT INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES (?, ?, 30000, 50, 1)
  `).run(branch.id, mainProductId);

  db.prepare(`
    INSERT INTO products (id, brand_id, category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 'Es Teh Bonus PWA E2E', ?, 5000, 1)
  `).run(rewardProductId, brand.id, cat.id, 'es-teh-e2e-pwa-' + Date.now());

  db.prepare(`
    INSERT INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES (?, ?, 5000, 50, 1)
  `).run(branch.id, rewardProductId);

  db.prepare(`
    INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy, is_active)
    VALUES (?, ?, 'Promo PWA Welcome E2E', 'install_incentive', 'exclusive', 1)
  `).run(promoId, brand.id);

  db.prepare(`
    INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents)
    VALUES (?, ?, 'free_product', ?, 0)
  `).run('rwd_e2e_pwa_' + Date.now(), promoId, rewardProductId);

  // Test C — Client mencoba manipulasi field lama (is_pwa_installed: true tapi pwa_runtime: browser) -> REJECTED
  const resLegacySpoof = await OrderPlacementService.submitOrder({
    brand_id: brand.id,
    branch_id: branch.id,
    order_type: 'dine_in',
    payment_method: 'cash',
    customer: { name: 'Customer Spoof', phone: '081299992202' },
    is_pwa_installed: true, // Legacy client flag MUST have zero authority
    pwa_runtime: { display_mode: 'browser' },
    items: [
      { product_id: mainProductId, quantity: 1, expected_price: 30000 },
      { product_id: 'reward_' + promoId, quantity: 1, expected_price: 0, is_promo_reward: true }
    ]
  });
  assert.strictEqual(resLegacySpoof.success, false, 'Legacy client flag is_pwa_installed must not bypass browser display_mode check');

  // Test D — PWA runtime diteruskan sampai order placement (End-to-End standalone) -> ACCEPTED
  const resE2E = await OrderPlacementService.submitOrder({
    brand_id: brand.id,
    branch_id: branch.id,
    order_type: 'dine_in',
    payment_method: 'cash',
    customer: { name: 'Customer Legit PWA', phone: '081299992202' },
    pwa_runtime: { display_mode: 'standalone' },
    items: [
      { product_id: mainProductId, quantity: 1, expected_price: 30000 },
      { product_id: 'reward_' + promoId, quantity: 1, expected_price: 0, is_promo_reward: true }
    ]
  });

  assert.strictEqual(resE2E.success, true, 'Standalone PWA user order must succeed end-to-end');
  assert.strictEqual(resE2E.order.items.length, 2);
  const placedRewardItem = resE2E.order.items.find(it => it.product_id === rewardProductId);
  assert.ok(placedRewardItem, 'Reward item must be converted to authoritative target_product_id');
  assert.strictEqual(placedRewardItem.unit_price, 0);
  assert.strictEqual(placedRewardItem.name, 'Es Teh Bonus PWA E2E');
  assert.ok((placedRewardItem.note || placedRewardItem.notes || '').includes(`[PROMO:${promoId}]`));
});
