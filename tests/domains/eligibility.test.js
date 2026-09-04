'use strict';
/**
 * Task C3 — Branch/Product Eligibility Boundary.
 *
 * Proves the canonical EligibilityService decision contract and that the
 * runtime BranchMatcher consumes it (no duplicate eligibility engine).
 *
 * Coverage:
 *   - product eligibility matrix (assigned/active/available/stock/branch state)
 *   - cross-brand & cross-organization fail-closed (no existence leak)
 *   - branch operational state & delivery/pickup capability
 *   - full-cart completeness (no partial success), no split fulfillment
 *   - quantity validation (server-side, no client authority)
 *   - BranchMatcher wiring: narrowing to full-cart-eligible branch and
 *     fail-closed when no branch can satisfy the complete cart
 */
const test = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const EligibilityService = require('../../domains/commerce/services/EligibilityService');
const BranchMatcher = require('../../server/services/BranchMatcher');
const RouteService = require('../../server/services/RouteService');

const BRAND = 'brand_bangjo';
const BARAT = 'branch_bangjo_barat';

// Fixture products/branches (fresh in-memory DB per test-file process; seed
// data from server/database/db.js already allocates 272/285/345/286/287/288/401
// to BARAT with stock 100, is_available 1).
test.before(() => {
  // Other-brand branch/org (cross-tenant isolation).
  db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_c3_other', 'Org Lain', 'org-c3-other')`).run();
  db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_c3_other', 'org_c3_other', 'Brand Lain', 'brand-c3-other')`).run();
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active)
              VALUES ('branch_c3_other', 'brand_c3_other', 'Cabang Brand Lain', 'cabang-lain', 'Jl. Lain No. 1', -7.1, 112.6, '081200000099', 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, regular_price, is_active)
              VALUES ('prod_c3_other', 'brand_c3_other', 'Produk Brand Lain', 'produk-brand-lain', 99999, 99999, 1)`).run();

  // Same-brand fixture products.
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, regular_price, is_active)
              VALUES ('prod_c3_base', 'brand_bangjo', 'Produk C3 Dasar', 'produk-c3-dasar', 20000, 22000, 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, regular_price, is_active)
              VALUES ('prod_c3_inactive', 'brand_bangjo', 'Produk C3 Nonaktif', 'produk-c3-nonaktif', 20000, 22000, 0)`).run();
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, regular_price, is_active)
              VALUES ('prod_c3_unassigned', 'brand_bangjo', 'Produk C3 Belum Dialokasi', 'produk-c3-belum', 20000, 22000, 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, regular_price, is_active)
              VALUES ('prod_c3_nullstock', 'brand_bangjo', 'Produk C3 Tanpa Stok', 'produk-c3-null', 20000, 22000, 1)`).run();

  // BARAT: prod_c3_base assigned (stock 50); prod_c3_inactive assigned but master off;
  // prod_c3_nullstock assigned with NO recorded stock (NULL).
  db.prepare(`INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock, is_available)
              VALUES ('branch_bangjo_barat', 'prod_c3_base', 20000, 50, 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock, is_available)
              VALUES ('branch_bangjo_barat', 'prod_c3_inactive', 20000, 50, 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock, is_available)
              VALUES ('branch_bangjo_barat', 'prod_c3_nullstock', 20000, NULL, 1)`).run();

  // Branch operational-state fixtures (all assigned prod_c3_base with stock so
  // the blocking reason isolates the branch fact under test).
  const mkBranch = (id, { is_active = 1, is_open_override = 1, delivery = 1, pickup = 1, lat = -7.29, lng = 112.71 } = {}) => {
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
                VALUES (?, 'brand_bangjo', ?, ?, 'Jl. Fixture', ?, ?, '081200000001', ?, ?)`)
      .run(id, 'Cabang ' + id, id, lat, lng, is_active, is_open_override);
    db.prepare(`INSERT OR IGNORE INTO branch_delivery_settings (id, branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount)
                VALUES (?, ?, ?, ?, 25, 5, 3000, 0)`)
      .run('bds_' + id, id, delivery, pickup);
    db.prepare(`INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock, is_available)
                VALUES (?, 'prod_c3_base', 20000, 50, 1)`).run(id);
  };

  mkBranch('branch_c3_closed', { is_open_override: 0 });
  mkBranch('branch_c3_inactive', { is_active: 0 });
  mkBranch('branch_c3_no_delivery', { delivery: 0, pickup: 1 });
  mkBranch('branch_c3_no_pickup', { delivery: 1, pickup: 0 });

  // A second delivery branch for BranchMatcher wiring, holding a product BARAT
  // does NOT carry. Customer is placed near BARAT, so the match can only select
  // branch_c3_timur if eligibility (assignment) is actually enforced.
  mkBranch('branch_c3_timur', { lat: -7.35, lng: 112.8 });
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, regular_price, is_active)
              VALUES ('prod_c3_timur_only', 'brand_bangjo', 'Produk Khusus Timur', 'produk-timur', 25000, 26000, 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock, is_available)
              VALUES ('branch_c3_timur', 'prod_c3_timur_only', 25000, 10, 1)`).run();
});

function productResult(branchId, productId, quantity, orderType) {
  return EligibilityService.evaluateProduct({
    brand_id: BRAND,
    branch_id: branchId,
    product_id: productId,
    quantity,
    order_type: orderType
  });
}

// ============================================================================
// Single-product eligibility
// ============================================================================

test('C3 Product eligibility: assigned + master active + branch available + stock >= qty is eligible', () => {
  const ok = productResult(BARAT, '272', 1, 'delivery');
  assert.strictEqual(ok.eligible, true);
  assert.deepStrictEqual(ok.reasons, []);

  // Exactly-at-stock quantity is eligible; above-stock is not.
  const atStock = productResult(BARAT, '272', 50, 'delivery');
  assert.strictEqual(atStock.eligible, true);
  const overStock = productResult(BARAT, '272', 51, 'delivery');
  assert.strictEqual(overStock.eligible, false);
  assert.deepStrictEqual(overStock.reasons, [EligibilityService.REASONS.INSUFFICIENT_STOCK]);
});

test('C3 Product eligibility: unassigned product is ineligible (assignment boundary)', () => {
  const res = productResult(BARAT, 'prod_c3_unassigned', 1, 'delivery');
  assert.strictEqual(res.eligible, false);
  assert.deepStrictEqual(res.reasons, [EligibilityService.REASONS.PRODUCT_NOT_ASSIGNED]);
});

test('C3 Product eligibility: inactive master product is ineligible', () => {
  const res = productResult(BARAT, 'prod_c3_inactive', 1, 'delivery');
  assert.strictEqual(res.eligible, false);
  assert.deepStrictEqual(res.reasons, [EligibilityService.REASONS.PRODUCT_INACTIVE]);
});

test('C3 Product eligibility: branch availability flag off is ineligible, stock untouched', () => {
  // Deterministic: availability is a branch operational fact; flipping it must
  // not mutate inventory and must make the product ineligible.
  db.prepare(`UPDATE branch_products SET is_available = 0 WHERE branch_id = ? AND product_id = 'prod_c3_base'`).run(BARAT);
  try {
    const res = productResult(BARAT, 'prod_c3_base', 1, 'delivery');
    assert.strictEqual(res.eligible, false);
    assert.deepStrictEqual(res.reasons, [EligibilityService.REASONS.PRODUCT_UNAVAILABLE]);
  } finally {
    db.prepare(`UPDATE branch_products SET is_available = 1 WHERE branch_id = ? AND product_id = 'prod_c3_base'`).run(BARAT);
  }
  const restored = productResult(BARAT, 'prod_c3_base', 1, 'delivery');
  assert.strictEqual(restored.eligible, true);
});

test('C3 Inventory fact: NULL stock (no recorded inventory) resolves to 0 — ineligible for qty >= 1', () => {
  // NULL != silently unlimited and != an availability-flag mutation: same
  // canonical NULL -> 0 semantics CatalogService, InventoryStockService and
  // PrePaymentVerificationGate already enforce.
  const res = productResult(BARAT, 'prod_c3_nullstock', 1, 'delivery');
  assert.strictEqual(res.eligible, false);
  assert.deepStrictEqual(res.reasons, [EligibilityService.REASONS.INSUFFICIENT_STOCK]);
});

test('C3 Quantity validation: non-positive / non-integer / non-numeric quantities are rejected deterministically', () => {
  for (const bad of [0, -1, 1.5, 'abc', null, NaN]) {
    const res = productResult(BARAT, 'prod_c3_base', bad, 'delivery');
    assert.strictEqual(res.eligible, false, 'quantity=' + String(bad) + ' must be ineligible');
    assert.deepStrictEqual(res.reasons, [EligibilityService.REASONS.INVALID_QUANTITY]);
  }
});

// ============================================================================
// Branch operational state & fulfillment capability
// ============================================================================

test('C3 Branch state: closed branch is ineligible (BRANCH_CLOSED)', () => {
  const res = productResult('branch_c3_closed', 'prod_c3_base', 1, 'delivery');
  assert.strictEqual(res.eligible, false);
  assert.deepStrictEqual(res.reasons, [EligibilityService.REASONS.BRANCH_CLOSED]);
});

test('C3 Branch state: inactive branch is ineligible (BRANCH_NOT_ACTIVE)', () => {
  const res = productResult('branch_c3_inactive', 'prod_c3_base', 1, 'delivery');
  assert.strictEqual(res.eligible, false);
  assert.deepStrictEqual(res.reasons, [EligibilityService.REASONS.BRANCH_NOT_ACTIVE]);
});

test('C3 Fulfillment capability: delivery/pickup flags are branch-scoped and never interchangeable', () => {
  // Delivery disabled -> delivery ineligible, pickup still eligible.
  const noDeliveryDelivery = productResult('branch_c3_no_delivery', 'prod_c3_base', 1, 'delivery');
  assert.strictEqual(noDeliveryDelivery.eligible, false);
  assert.deepStrictEqual(noDeliveryDelivery.reasons, [EligibilityService.REASONS.FULFILLMENT_NOT_SUPPORTED]);
  const noDeliveryPickup = productResult('branch_c3_no_delivery', 'prod_c3_base', 1, 'pickup');
  assert.strictEqual(noDeliveryPickup.eligible, true);

  // Pickup disabled -> pickup ineligible, delivery still eligible.
  const noPickupPickup = productResult('branch_c3_no_pickup', 'prod_c3_base', 1, 'pickup');
  assert.strictEqual(noPickupPickup.eligible, false);
  assert.deepStrictEqual(noPickupPickup.reasons, [EligibilityService.REASONS.FULFILLMENT_NOT_SUPPORTED]);
  const noPickupDelivery = productResult('branch_c3_no_pickup', 'prod_c3_base', 1, 'delivery');
  assert.strictEqual(noPickupDelivery.eligible, true);
});

test('C3 Capability gap documented: dine_in/reservation have no capability flag, so eligibility does not invent one', () => {
  // No schema representation exists for dine_in/reservation capability (GAP).
  // The service must neither fabricate a flag nor substitute delivery/pickup —
  // therefore it does not block on capability for these known order types.
  const dineIn = productResult(BARAT, 'prod_c3_base', 1, 'dine_in');
  assert.strictEqual(dineIn.eligible, true);
  const reservation = productResult(BARAT, 'prod_c3_base', 1, 'reservation');
  assert.strictEqual(reservation.eligible, true);

  // An unknown order type cannot be certified -> not supported (deterministic).
  const unknown = productResult(BARAT, 'prod_c3_base', 1, 'drone');
  assert.strictEqual(unknown.eligible, false);
  assert.deepStrictEqual(unknown.reasons, [EligibilityService.REASONS.FULFILLMENT_NOT_SUPPORTED]);
});

// ============================================================================
// Tenant / scope integrity
// ============================================================================

test('C3 Cross-tenant fail-closed: another brand branch is BRANCH_NOT_FOUND (no existence leak)', () => {
  const res = productResult('branch_c3_other', 'prod_c3_base', 1, 'delivery');
  assert.strictEqual(res.eligible, false);
  assert.deepStrictEqual(res.reasons, [EligibilityService.REASONS.BRANCH_NOT_FOUND]);
});

test('C3 Cross-tenant fail-closed: another brand product is PRODUCT_NOT_FOUND in this brand scope', () => {
  const res = productResult(BARAT, 'prod_c3_other', 1, 'delivery');
  assert.strictEqual(res.eligible, false);
  assert.deepStrictEqual(res.reasons, [EligibilityService.REASONS.PRODUCT_NOT_FOUND]);
});

test('C3 Branch isolation: assignment at Branch A never makes the product eligible at Branch B', () => {
  const inBarat = productResult(BARAT, 'prod_c3_timur_only', 1, 'delivery');
  assert.strictEqual(inBarat.eligible, false);
  assert.deepStrictEqual(inBarat.reasons, [EligibilityService.REASONS.PRODUCT_NOT_ASSIGNED]);

  const inTimur = productResult('branch_c3_timur', 'prod_c3_timur_only', 1, 'delivery');
  assert.strictEqual(inTimur.eligible, true);
});

// ============================================================================
// Cart (full-cart) eligibility — no split fulfillment
// ============================================================================

test('C3 Cart eligibility: a branch is eligible only when it can satisfy the COMPLETE cart', () => {
  // Complete cart satisfiable at BARAT (272 stock 100, 345 stock 100).
  const complete = EligibilityService.evaluateCart({
    brand_id: BRAND,
    branch_id: BARAT,
    order_type: 'delivery',
    items: [{ product_id: '272', quantity: 2 }, { id: '345', qty: 1 }]
  });
  assert.strictEqual(complete.eligible, true);
  assert.ok(complete.items.every((it) => it.eligible));

  // One item exceeds stock -> whole cart ineligible, per-item diagnostics.
  const partial = EligibilityService.evaluateCart({
    brand_id: BRAND,
    branch_id: BARAT,
    order_type: 'delivery',
    items: [{ product_id: '272', quantity: 1 }, { product_id: '345', quantity: 9999 }]
  });
  assert.strictEqual(partial.eligible, false, 'partial success must not become cart eligibility');
  const item272 = partial.items.find((i) => i.product_id === '272');
  const item345 = partial.items.find((i) => i.product_id === '345');
  assert.strictEqual(item272.eligible, true);
  assert.strictEqual(item345.eligible, false);
  assert.deepStrictEqual(item345.reasons, [EligibilityService.REASONS.INSUFFICIENT_STOCK]);
});

test('C3 No split fulfillment: complementary availability across branches yields NO eligible branch for the combined cart', () => {
  // prod_c3_timur_only exists only at branch_c3_timur; 272 only at BARAT.
  const atBarat = EligibilityService.evaluateCart({
    brand_id: BRAND,
    branch_id: BARAT,
    order_type: 'delivery',
    items: [{ product_id: '272', quantity: 1 }, { product_id: 'prod_c3_timur_only', quantity: 1 }]
  });
  assert.strictEqual(atBarat.eligible, false);
  assert.strictEqual(atBarat.items.find((i) => i.product_id === 'prod_c3_timur_only').eligible, false);

  const atTimur = EligibilityService.evaluateCart({
    brand_id: BRAND,
    branch_id: 'branch_c3_timur',
    order_type: 'delivery',
    items: [{ product_id: '272', quantity: 1 }, { product_id: 'prod_c3_timur_only', quantity: 1 }]
  });
  assert.strictEqual(atTimur.eligible, false);
  assert.strictEqual(atTimur.items.find((i) => i.product_id === '272').eligible, false);

  // Eligibility answers each branch separately; it never selects one.
  assert.strictEqual(atBarat.eligible, false);
  assert.strictEqual(atTimur.eligible, false);
});

test('C3 Cart reasons contract: eligible cart has reasons [], single failed item surfaces its reason at cart level', () => {
  const complete = EligibilityService.evaluateCart({
    brand_id: BRAND,
    branch_id: BARAT,
    order_type: 'delivery',
    items: [{ product_id: '272', quantity: 1 }, { product_id: '345', quantity: 1 }]
  });
  assert.strictEqual(complete.eligible, true);
  assert.deepStrictEqual(complete.reasons, [], 'eligible cart must carry no reasons');

  const oneFail = EligibilityService.evaluateCart({
    brand_id: BRAND,
    branch_id: BARAT,
    order_type: 'delivery',
    items: [{ product_id: '272', quantity: 1 }, { product_id: '345', quantity: 9999 }]
  });
  assert.strictEqual(oneFail.eligible, false);
  assert.deepStrictEqual(oneFail.reasons, [EligibilityService.REASONS.INSUFFICIENT_STOCK], 'cart-level reason must reflect the failed item');
  // Item-level detail stays intact.
  const failedLine = oneFail.items.find((i) => i.product_id === '345');
  assert.strictEqual(failedLine.eligible, false);
  assert.deepStrictEqual(failedLine.reasons, [EligibilityService.REASONS.INSUFFICIENT_STOCK]);
});

test('C3 Cart reasons contract: multiple failed items produce deduplicated deterministic codes in first-seen item order', () => {
  // Item 1 exceeds stock (INSUFFICIENT_STOCK); items 2 and 3 are the same
  // unassigned product (PRODUCT_NOT_ASSIGNED twice -> must dedupe to one).
  const cart = EligibilityService.evaluateCart({
    brand_id: BRAND,
    branch_id: BARAT,
    order_type: 'delivery',
    items: [
      { product_id: '345', quantity: 9999 },
      { product_id: 'prod_c3_unassigned', quantity: 1 },
      { product_id: 'prod_c3_unassigned', quantity: 2 }
    ]
  });
  assert.strictEqual(cart.eligible, false);
  assert.deepStrictEqual(cart.reasons, [
    EligibilityService.REASONS.INSUFFICIENT_STOCK,
    EligibilityService.REASONS.PRODUCT_NOT_ASSIGNED
  ], 'first-seen order, deduplicated');

  // Reversing item order reverses the deterministic reason order (ordering is
  // a function of the cart, never of internal state).
  const reversed = EligibilityService.evaluateCart({
    brand_id: BRAND,
    branch_id: BARAT,
    order_type: 'delivery',
    items: [
      { product_id: 'prod_c3_unassigned', quantity: 1 },
      { product_id: '345', quantity: 9999 }
    ]
  });
  assert.deepStrictEqual(reversed.reasons, [
    EligibilityService.REASONS.PRODUCT_NOT_ASSIGNED,
    EligibilityService.REASONS.INSUFFICIENT_STOCK
  ]);
});

test('C3 Canonical consistency: matcher SQL candidates are exactly the branch-gate-passing delivery branches; item failures never turn into branch reasons', () => {
  // Mirror the exact candidate-discovery query BranchMatcher runs (same
  // predicates: brand scope, active, open, delivery capability).
  const candidates = db.prepare(`
    SELECT b.id FROM branches b
    LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
    WHERE b.brand_id = ? AND b.is_active = 1 AND b.is_open_override = 1 AND s.is_delivery_active = 1
    ORDER BY b.id
  `).all(BRAND).map((r) => r.id);

  // Closed / inactive / delivery-disabled / other-brand branches must never be
  // SQL candidates (they are exactly what _resolveBranch would reject).
  assert.deepStrictEqual(candidates.sort(), ['branch_bangjo_barat', 'branch_bangjo_timur', 'branch_c3_no_pickup', 'branch_c3_timur'].sort());
  for (const excluded of ['branch_c3_closed', 'branch_c3_inactive', 'branch_c3_no_delivery', 'branch_c3_other']) {
    assert.ok(!candidates.includes(excluded), excluded + ' must not be a candidate');
  }

  // For every SQL candidate the canonical engine never disagrees on branch
  // facts: with a guaranteed item-level failure, the cart reason is exactly the
  // item code (PRODUCT_NOT_ASSIGNED) — never a branch-level code.
  const branchReasonCodes = [
    EligibilityService.REASONS.BRANCH_NOT_FOUND,
    EligibilityService.REASONS.BRANCH_NOT_ACTIVE,
    EligibilityService.REASONS.BRANCH_CLOSED,
    EligibilityService.REASONS.FULFILLMENT_NOT_SUPPORTED
  ];
  for (const branchId of candidates) {
    const res = EligibilityService.evaluateCart({
      brand_id: BRAND,
      branch_id: branchId,
      order_type: 'delivery',
      items: [{ product_id: 'prod_c3_unassigned', quantity: 1 }]
    });
    assert.strictEqual(res.eligible, false, branchId + ' fails on the item, not on branch facts');
    assert.deepStrictEqual(res.reasons, [EligibilityService.REASONS.PRODUCT_NOT_ASSIGNED]);
    assert.ok(res.reasons.every((r) => !branchReasonCodes.includes(r)), branchId + ' must never surface a branch-level reason');
  }
});

test('C3 evaluateBranch: canonical branch-only operational decision (used to validate a CUSTOMER_SELECTED branch)', () => {
  // Open + active + capability OK.
  const ok = EligibilityService.evaluateBranch({ brand_id: BRAND, branch_id: BARAT, order_type: 'delivery' });
  assert.strictEqual(ok.eligible, true);
  assert.deepStrictEqual(ok.reasons, []);
  assert.ok(ok.branch && ok.branch.id === BARAT);

  assert.deepStrictEqual(
    EligibilityService.evaluateBranch({ brand_id: BRAND, branch_id: 'branch_c3_closed', order_type: 'delivery' }).reasons,
    [EligibilityService.REASONS.BRANCH_CLOSED]
  );
  assert.deepStrictEqual(
    EligibilityService.evaluateBranch({ brand_id: BRAND, branch_id: 'branch_c3_inactive', order_type: 'delivery' }).reasons,
    [EligibilityService.REASONS.BRANCH_NOT_ACTIVE]
  );
  assert.deepStrictEqual(
    EligibilityService.evaluateBranch({ brand_id: BRAND, branch_id: 'branch_c3_no_delivery', order_type: 'delivery' }).reasons,
    [EligibilityService.REASONS.FULFILLMENT_NOT_SUPPORTED]
  );
  assert.deepStrictEqual(
    EligibilityService.evaluateBranch({ brand_id: BRAND, branch_id: 'branch_c3_no_pickup', order_type: 'pickup' }).reasons,
    [EligibilityService.REASONS.FULFILLMENT_NOT_SUPPORTED]
  );
  assert.deepStrictEqual(
    EligibilityService.evaluateBranch({ brand_id: BRAND, branch_id: 'branch_c3_other', order_type: 'delivery' }).reasons,
    [EligibilityService.REASONS.BRANCH_NOT_FOUND]
  );
});

test('C3 Cart input validation: empty/non-array carts are INVALID_CART; branch failure propagates deterministically', () => {
  const empty = EligibilityService.evaluateCart({ brand_id: BRAND, branch_id: BARAT, items: [] });
  assert.strictEqual(empty.eligible, false);
  assert.deepStrictEqual(empty.reasons, [EligibilityService.REASONS.INVALID_CART]);

  const notArray = EligibilityService.evaluateCart({ brand_id: BRAND, branch_id: BARAT, items: 'nope' });
  assert.strictEqual(notArray.eligible, false);
  assert.deepStrictEqual(notArray.reasons, [EligibilityService.REASONS.INVALID_CART]);

  // Branch-level failure applies to every line (deterministic, no per-item re-query).
  const closed = EligibilityService.evaluateCart({
    brand_id: BRAND,
    branch_id: 'branch_c3_closed',
    order_type: 'delivery',
    items: [{ product_id: '272', quantity: 1 }]
  });
  assert.strictEqual(closed.eligible, false);
  assert.deepStrictEqual(closed.reasons, [EligibilityService.REASONS.BRANCH_CLOSED]);
  assert.strictEqual(closed.items.length, 1);
  assert.strictEqual(closed.items[0].eligible, false);
  assert.deepStrictEqual(closed.items[0].reasons, [EligibilityService.REASONS.BRANCH_CLOSED]);
});

// ============================================================================
// Runtime wiring — BranchMatcher consumes the canonical EligibilityService
// ============================================================================

test('C3 Runtime wiring: BranchMatcher narrows delivery candidates to the full-cart-eligible branch', async () => {
  // Customer is near BARAT, but the cart item is assigned ONLY at
  // branch_c3_timur (farther). If the matcher enforces eligibility it must
  // return branch_c3_timur; if it only matched nearest it would return BARAT.
  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = async () => ({ distance_meters: 1500, duration_seconds: 480, provider: 'test-stub' });
  try {
    const match = await BranchMatcher.matchNearestBranch({
      brand_id: BRAND,
      customer_lat: -7.2912,
      customer_lng: 112.7154,
      subtotal: 25000,
      items: [{ id: 'prod_c3_timur_only', quantity: 1 }]
    });
    assert.strictEqual(match.eligible, true);
    assert.ok(match.branch, 'a full-cart-eligible branch must be returned');
    assert.strictEqual(match.branch.id, 'branch_c3_timur', 'nearest-but-ineligible branch must not be selected');
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('C3 Runtime wiring: when no branch can satisfy the complete cart the match fails closed (no split, no silent nearest)', async () => {
  const match = await BranchMatcher.matchNearestBranch({
    brand_id: BRAND,
    customer_lat: -7.2912,
    customer_lng: 112.7154,
    subtotal: 10000,
    items: [{ id: 'prod_c3_never_assigned', quantity: 1 }]
  });
  assert.strictEqual(match.eligible, false);
  assert.strictEqual(match.branch, null);
  assert.ok(/memenuhi seluruh/i.test(match.reason || ''), 'reason must state the cart cannot be fully satisfied');
});
