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
        ('prod_limited', 'brand_test', 'cat_test', 'Menu Terbatas', 'menu-terbatas', 50000, 'lock', NULL, NULL, 1)
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
// Commerce 5 — Pre-Payment Final Verification Gate (Atomic Stock & Price Check)
// ==============================================================================
test('Commerce 5 — Pre-Payment Gate: verifies stock, active status, and detects price change', () => {
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

  // 2. Price change detection (e.g. customer cart had stale 30000 instead of 32000)
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

  // 3. Out of stock detection (requested 10 when stock is 4)
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
// Commerce 6 — Order Placement: Atomic Stock Deduction & Branch Dynamic Threshold Warning
// ==============================================================================
test('Commerce 6 — Order Placement: deducts live stock and uses branch manager threshold for warnings', async () => {
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

  // Customer places order of 2 items
  const orderResult = await OrderPlacementService.submitOrder({
    brand_id: 'brand_test',
    branch_id: 'branch_test',
    customer: { name: 'Ikhwan Customer', phone: '62899999999', address: 'Jl. Rungkut Surabaya' },
    items: [
      { product_id: 'prod_limited', quantity: 2, expected_price: 50000 }
    ],
    delivery_fee: 10000,
    payment_method: 'qris',
    trace_context: { correlation_id: 'corr_test_order_flow' }
  });

  assert.strictEqual(orderResult.success, true);
  assert.strictEqual(orderResult.order.grand_total, 110000);

  // 1. Verify Stock actually decremented in database
  const updatedBranchRow = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_test', 'prod_limited');
  assert.strictEqual(updatedBranchRow.stock, 2, 'Live stock must be decremented from 4 to 2');

  // 2. Verify subsequent order exceeding remaining stock fails (Overselling prevention)
  const subsequentOrder = PrePaymentVerificationGate.verify({
    brand_id: 'brand_test',
    branch_id: 'branch_test',
    items: [{ product_id: 'prod_limited', quantity: 3, expected_price: 50000 }] // requested 3 when only 2 remain
  });
  assert.strictEqual(subsequentOrder.is_valid, false);
  assert.strictEqual(subsequentOrder.status, 'OUT_OF_STOCK');

  // 3. Verify Branch Manager Configured Threshold (8) was used for warning
  assert.ok(lowStockEventReceived);
  assert.strictEqual(lowStockEventReceived.payload.remaining_stock, 2);
  assert.strictEqual(lowStockEventReceived.payload.threshold, 8, 'Must use branch manager threshold (8), not hardcoded 5');
});
