'use strict';
/**
 * Task C4 — Branch Matching.
 *
 * Proves the matching contract on top of the C3 canonical eligibility engine:
 *
 *   Canonical EligibilityService → eligible full-cart branches → road routing
 *   / delivery cost → deterministic ranking → EXACTLY ONE fulfillment branch.
 *
 * Coverage:
 *   - server-authoritative location validation (fail-safe, no fabricated point)
 *   - deterministic winner incl. stable id tie-break (never DB row order)
 *   - road distance ranks over straight-line (Haversine) distance
 *   - full-cart matching only; partial-cart branches excluded; fail-closed
 *   - cross-brand / closed / inactive / delivery-disabled exclusion
 *   - routing hard failure never becomes success; estimate fallback is surfaced
 *   - delivery-calculation failure is explicit, not a silent success
 *   - matching is read-only (no order / inventory mutation)
 */
const test = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const BranchMatcher = require('../../server/services/BranchMatcher');
const RouteService = require('../../server/services/RouteService');

const BRAND = 'brand_bangjo';
const BARAT = 'branch_bangjo_barat';
const CUSTOMER = { lat: -7.2912, lng: 112.7154 }; // next to seeded BARAT

// --- fixture helpers --------------------------------------------------------

function closeAllBrandBranches() {
  db.prepare('UPDATE branches SET is_open_override = 0 WHERE brand_id = ?').run(BRAND);
}

function openBranch(id) {
  db.prepare('UPDATE branches SET is_open_override = 1 WHERE id = ?').run(id);
}

function mkBranch(id, { lat, lng, is_active = 1, is_open_override = 1, delivery = 1 } = {}) {
  db.prepare(`INSERT OR REPLACE INTO branches
    (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
    VALUES (?, 'brand_bangjo', ?, ?, 'Jl. C4', ?, ?, '081200000010', ?, ?)`)
    .run(id, 'Cabang ' + id, id, lat, lng, is_active, is_open_override);
  db.prepare(`INSERT OR REPLACE INTO branch_delivery_settings
    (id, branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount)
    VALUES (?, ?, ?, 1, 25, 5, 3000, 0)`)
    .run('bds_' + id, id, delivery);
}

function assignProduct(branchId, productId, stock = 10) {
  db.prepare(`INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES (?, ?, 20000, ?, 1)`).run(branchId, productId, stock);
}

function ensureProduct(productId, name) {
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, regular_price, is_active)
    VALUES (?, 'brand_bangjo', ?, ?, 20000, 22000, 1)`).run(productId, name, productId);
}

function stubFixed(meters, durationSeconds, provider) {
  return async () => ({ distance_meters: meters, duration_seconds: durationSeconds, provider: provider || 'osrm' });
}

async function match(params) {
  return BranchMatcher.matchNearestBranch({ brand_id: BRAND, ...params });
}

// --- tests ------------------------------------------------------------------

test('C4 Location: invalid/missing/out-of-range customer coordinates fail safely (no fabricated point)', async () => {
  closeAllBrandBranches();
  openBranch(BARAT);
  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = stubFixed(1500, 480);
  try {
    for (const bad of [{ lat: 999, lng: 112 }, { lat: -7.29, lng: 999 }, { lat: 'abc', lng: 112 }, { lat: null, lng: 112 }, { lat: -7.29, lng: '' }, { lat: NaN, lng: 112 }]) {
      const res = await match({ customer_lat: bad.lat, customer_lng: bad.lng, subtotal: 0 });
      assert.strictEqual(res.eligible, false, JSON.stringify(bad) + ' must fail');
      assert.strictEqual(res.branch, null);
      assert.ok(/tidak valid/i.test(res.reason || ''), 'explicit reason for ' + JSON.stringify(bad));
    }
    // A valid 0,0 coordinate is NOT "missing" — it must proceed (regression guard).
    const zero = await match({ customer_lat: 0, customer_lng: 0, subtotal: 0 });
    assert.ok('eligible' in zero, 'valid (0,0) location must be processed, not rejected as missing');
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('C4 Winner determinism: equal ranking inputs break ties by branch id, never DB order', async () => {
  closeAllBrandBranches();
  // Symmetric around the customer -> identical straight distance AND identical
  // stubbed road distance -> pure tie.
  mkBranch('branch_c4_tie_a', { lat: -7.28, lng: 112.7 });
  mkBranch('branch_c4_tie_b', { lat: -7.28, lng: 112.73 });
  openBranch('branch_c4_tie_a');
  openBranch('branch_c4_tie_b');

  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = stubFixed(1500, 480);
  try {
    const first = await match({ customer_lat: -7.28, customer_lng: 112.715, subtotal: 0 });
    assert.strictEqual(first.eligible, true);
    assert.strictEqual(first.branch.id, 'branch_c4_tie_a', 'lexicographically smallest id wins the tie');
    const second = await match({ customer_lat: -7.28, customer_lng: 112.715, subtotal: 0 });
    assert.strictEqual(second.branch.id, 'branch_c4_tie_a', 'repeated call stays deterministic');
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('C4 Ranking: winner is decided by ROAD distance, not straight-line proximity', async () => {
  closeAllBrandBranches();
  // c4_nearStraight sits on the customer (Haversine ~0) but has terrible road;
  // c4_betterRoad is farther straight-line yet short by road.
  mkBranch('branch_c4_near_straight', { lat: CUSTOMER.lat, lng: CUSTOMER.lng });
  mkBranch('branch_c4_better_road', { lat: -7.2912, lng: 112.73 });
  openBranch('branch_c4_near_straight');
  openBranch('branch_c4_better_road');

  const original = RouteService.getRoadDistance;
  // Road distance depends on the ORIGIN branch longitude (lng >= 112.72 => short road).
  RouteService.getRoadDistance = async (oLat, oLng) => {
    const isShortRoad = Number(oLng) >= 112.72;
    return {
      distance_meters: isShortRoad ? 1500 : 20000,
      duration_seconds: isShortRoad ? 480 : 3600,
      provider: 'osrm'
    };
  };
  try {
    const res = await match({ customer_lat: CUSTOMER.lat, customer_lng: CUSTOMER.lng, subtotal: 0 });
    assert.strictEqual(res.eligible, true);
    assert.strictEqual(res.branch.id, 'branch_c4_better_road', 'road-short branch must win over straight-close branch');
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('C4 Full-cart matching: partial-cart branch excluded, full-cart branch selected — exactly one winner', async () => {
  closeAllBrandBranches();
  ensureProduct('prod_c4_x', 'Produk C4 X');
  ensureProduct('prod_c4_y', 'Produk C4 Y');
  // c4_partial is CLOSER to the customer but carries only Y; c4_full carries X and Y.
  mkBranch('branch_c4_partial', { lat: CUSTOMER.lat, lng: CUSTOMER.lng });
  mkBranch('branch_c4_full', { lat: -7.2912, lng: 112.73 });
  assignProduct('branch_c4_partial', 'prod_c4_y', 10);
  assignProduct('branch_c4_full', 'prod_c4_x', 10);
  assignProduct('branch_c4_full', 'prod_c4_y', 10);
  openBranch('branch_c4_partial');
  openBranch('branch_c4_full');

  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = stubFixed(1500, 480);
  try {
    const res = await match({
      customer_lat: CUSTOMER.lat,
      customer_lng: CUSTOMER.lng,
      subtotal: 40000,
      items: [{ id: 'prod_c4_x', quantity: 1 }, { id: 'prod_c4_y', quantity: 1 }]
    });
    assert.strictEqual(res.eligible, true);
    assert.strictEqual(res.branch.id, 'branch_c4_full', 'only the full-cart branch may be selected');
    // Exactly ONE fulfillment branch in the result.
    assert.ok(res.branch.id && typeof res.branch.id === 'string');
    assert.strictEqual(typeof res.branch.name, 'string');
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('C4 No full-cart branch: match fails closed — no nearest fallback, no split', async () => {
  closeAllBrandBranches();
  openBranch(BARAT);
  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = stubFixed(1500, 480);
  try {
    const res = await match({
      customer_lat: CUSTOMER.lat,
      customer_lng: CUSTOMER.lng,
      subtotal: 10000,
      items: [{ id: 'prod_c4_never', quantity: 1 }]
    });
    assert.strictEqual(res.eligible, false);
    assert.strictEqual(res.branch, null);
    assert.ok(/memenuhi seluruh/i.test(res.reason || ''), 'explicit no-full-cart reason');
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('C4 Candidate isolation: closed / inactive / delivery-disabled / cross-brand branches never become candidates', async () => {
  // Fresh universe: brand_bangjo has no open delivery branch at all.
  closeAllBrandBranches();
  db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_c4_other', 'Org C4 Lain', 'org-c4-other')`).run();
  db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_c4_other', 'org_c4_other', 'Brand C4 Lain', 'brand-c4-other')`).run();
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, is_open_override)
    VALUES ('branch_c4_other', 'brand_c4_other', 'Cabang Brand Lain', 'cabang-lain', 'Jl. Lain', -7.2912, 112.7154, '081200000011', 1, 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO branch_delivery_settings (id, branch_id, is_delivery_active, is_pickup_active, max_radius_km)
    VALUES ('bds_c4_other', 'branch_c4_other', 1, 1, 25)`).run();

  // A cross-brand branch sitting exactly on the customer must NOT be matched.
  const crossBrand = await match({ customer_lat: CUSTOMER.lat, customer_lng: CUSTOMER.lng, subtotal: 0 });
  assert.strictEqual(crossBrand.eligible, false, 'other-brand branch must not satisfy brand_bangjo matching');
  assert.ok(/belum ada cabang/i.test(crossBrand.reason || ''));

  // Closed / inactive / delivery-disabled brand branches are also not candidates.
  mkBranch('branch_c4_closed', { lat: CUSTOMER.lat, lng: CUSTOMER.lng, is_open_override: 0 });
  const closed = await match({ customer_lat: CUSTOMER.lat, customer_lng: CUSTOMER.lng, subtotal: 0 });
  assert.strictEqual(closed.eligible, false);
  assert.ok(/belum ada cabang/i.test(closed.reason || ''));

  mkBranch('branch_c4_inactive', { lat: CUSTOMER.lat, lng: CUSTOMER.lng, is_active: 0 });
  const inactive = await match({ customer_lat: CUSTOMER.lat, customer_lng: CUSTOMER.lng, subtotal: 0 });
  assert.strictEqual(inactive.eligible, false);

  mkBranch('branch_c4_no_delivery', { lat: CUSTOMER.lat, lng: CUSTOMER.lng, delivery: 0 });
  const noDelivery = await match({ customer_lat: CUSTOMER.lat, customer_lng: CUSTOMER.lng, subtotal: 0 });
  assert.strictEqual(noDelivery.eligible, false);

  // Positive control: once a real brand branch opens, it wins over the closer
  // other-brand branch (isolation holds in both directions).
  openBranch(BARAT);
  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = stubFixed(1500, 480);
  try {
    const withBarat = await match({ customer_lat: CUSTOMER.lat, customer_lng: CUSTOMER.lng, subtotal: 0 });
    assert.strictEqual(withBarat.eligible, true);
    assert.strictEqual(withBarat.branch.id, BARAT);
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('C4 Routing: hard provider failure must never become a success', async () => {
  closeAllBrandBranches();
  openBranch(BARAT);
  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = async () => { throw new Error('osrm down'); };
  try {
    await assert.rejects(
      () => match({ customer_lat: CUSTOMER.lat, customer_lng: CUSTOMER.lng, subtotal: 0 }),
      /osrm down/,
      'a routing failure must propagate as an explicit failure, not a fake match'
    );
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('C4 Routing: estimate fallback is disclosed on the result (never silent fabrication)', async () => {
  closeAllBrandBranches();
  openBranch(BARAT);
  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = stubFixed(2000, 300, 'haversine_fallback');
  try {
    const res = await match({ customer_lat: CUSTOMER.lat, customer_lng: CUSTOMER.lng, subtotal: 0 });
    assert.strictEqual(res.eligible, true);
    assert.strictEqual(res.delivery.routing_provider, 'haversine_fallback');
    assert.strictEqual(res.delivery.routing_estimated, true);
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('C4 Delivery calculation: out-of-radius road distance fails explicitly (no success)', async () => {
  closeAllBrandBranches();
  openBranch(BARAT); // max_radius_km 12 (seed)
  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = stubFixed(60000, 5400); // 60 km road
  try {
    const res = await match({ customer_lat: CUSTOMER.lat, customer_lng: CUSTOMER.lng, subtotal: 0 });
    assert.strictEqual(res.eligible, false);
    assert.ok(/jangkauan|di luar/i.test(res.reason || ''), 'explicit radius reason, got: ' + res.reason);
  } finally {
    RouteService.getRoadDistance = original;
  }
});

test('C4 Geographic boundary: branch beyond the straight-line pre-filter is not routed at all', async () => {
  closeAllBrandBranches();
  mkBranch('branch_c4_far', { lat: -7.2912, lng: 113.2 }); // ~48 km straight, > 12km*1.5
  openBranch('branch_c4_far');
  const res = await match({ customer_lat: CUSTOMER.lat, customer_lng: CUSTOMER.lng, subtotal: 0 });
  assert.strictEqual(res.eligible, false);
  assert.ok(/di luar jangkauan/i.test(res.reason || ''));
  assert.strictEqual(res.branch, null);
});

test('C4 Read-only: matching never mutates orders, inventory, or stock', async () => {
  closeAllBrandBranches();
  openBranch(BARAT);
  const original = RouteService.getRoadDistance;
  RouteService.getRoadDistance = stubFixed(1500, 480);
  try {
    const count = (table) => db.prepare('SELECT COUNT(*) AS c FROM ' + table).get().c;
    const ordersBefore = count('orders');
    const movementsBefore = count('inventory_movements');
    const stockBefore = db.prepare("SELECT stock FROM branch_products WHERE branch_id = 'branch_bangjo_barat' AND product_id = '272'").get().stock;

    const res = await match({
      customer_lat: CUSTOMER.lat,
      customer_lng: CUSTOMER.lng,
      subtotal: 35000,
      items: [{ id: '272', quantity: 1 }]
    });
    assert.strictEqual(res.eligible, true);

    assert.strictEqual(count('orders'), ordersBefore, 'matching must not create orders');
    assert.strictEqual(count('inventory_movements'), movementsBefore, 'matching must not write the inventory ledger');
    const stockAfter = db.prepare("SELECT stock FROM branch_products WHERE branch_id = 'branch_bangjo_barat' AND product_id = '272'").get().stock;
    assert.strictEqual(stockAfter, stockBefore, 'matching must not consume stock');
  } finally {
    RouteService.getRoadDistance = original;
  }
});
