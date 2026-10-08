'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../server/database/db');
const { InventoryRepository } = require('../../core/data/repositories');
const { CostResolutionService } = require('../../domains/inventory');

const repository = new InventoryRepository();

const ORG = 'org_cost_resolution_v1';
const BRAND = 'brand_cost_resolution_v1';
const BRANCH = 'branch_cost_resolution_v1';
const PRODUCT = 'prod_cost_resolution_v1';
const LOCATION_A = 'loc_cost_resolution_a';
const LOCATION_B = 'loc_cost_resolution_b';

test.before(async () => {
  await db.readyPromise;

  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)").run(
    ORG, 'Cost Resolution Test Org', 'cost-resolution-test-org'
  );
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)").run(
    BRAND, ORG, 'Cost Resolution Test Brand', 'cost-resolution-test-brand'
  );
  db.prepare(
    "INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    BRANCH, BRAND, 'Cost Resolution Test Branch', 'cost-resolution-test-branch',
    '628111111111', 'Test', -5.4, 105.2
  );
  db.prepare(
    "INSERT OR IGNORE INTO products (id, brand_id, name, slug, price, is_active) VALUES (?, ?, ?, ?, ?, 1)"
  ).run(PRODUCT, BRAND, 'Test Cost Product', 'cost-resolution-test-product', 10000);

  db.prepare(
    "INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, 'BRANCH', 1)"
  ).run(LOCATION_A, ORG, BRANCH, 'COST-A', 'Cost A');

  db.prepare(
    "INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, 'BRANCH', 1)"
  ).run(LOCATION_B, ORG, BRANCH, 'COST-B', 'Cost B');
});

test.after(() => {
  db.prepare('DELETE FROM product_stock_movements WHERE stock_location_id IN (?, ?)').run(LOCATION_A, LOCATION_B);
  db.prepare('DELETE FROM product_stock_balances WHERE stock_location_id IN (?, ?)').run(LOCATION_A, LOCATION_B);
  db.prepare('DELETE FROM stock_locations WHERE id IN (?, ?)').run(LOCATION_A, LOCATION_B);
  db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT);
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});

function postInbound({
  locationId = LOCATION_A,
  quantity,
  unitCost,
  totalCost,
  basis = 'PURCHASE_RECEIPT',
  sourceReference,
  mutationId,
  postingTimestamp,
  currencyCode = 'IDR'
}) {
  const resolved = CostResolutionService.resolveInboundValuation({
    stockLocationId: locationId,
    stockIdentityType: 'PRODUCT',
    stockIdentityId: PRODUCT,
    quantityBase: quantity,
    costBasisType: basis,
    incomingUnitCost: unitCost,
    incomingTotalCost: totalCost,
    sourceType: 'GOODS_RECEIPT',
    sourceReference,
    postingMutationId: mutationId,
    postingTimestamp,
    currencyCode
  });

  const existing = repository.findProductValuationBalance({
    stockLocationId: locationId,
    productId: PRODUCT
  });

  const transition = CostResolutionService.applyInboundTransition({
    balance: existing,
    quantityBase: resolved.quantity_base,
    totalCost: resolved.total_cost,
    nextStatus: resolved.status
  });

  repository.beginTransaction();
  try {
    if (existing) {
      repository.db.execute(
        "UPDATE product_stock_balances SET quantity = ?, carrying_value = ?, moving_average_unit_cost = ?, cost_availability_status = ?, valuation_version = ?, updated_at = ? WHERE stock_location_id = ? AND product_id = ?",
        [
          transition.quantity,
          transition.carrying_value,
          transition.moving_average_unit_cost,
          transition.cost_availability_status,
          transition.valuation_version,
          postingTimestamp,
          locationId,
          PRODUCT
        ]
      );
    } else {
      repository.db.execute(
        "INSERT INTO product_stock_balances (stock_location_id, product_id, quantity, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          locationId,
          PRODUCT,
          transition.quantity,
          transition.carrying_value,
          transition.moving_average_unit_cost,
          transition.cost_availability_status,
          transition.valuation_version,
          postingTimestamp,
          postingTimestamp
        ]
      );
    }

    const movementType = basis === 'PURCHASE_RECEIPT' ? 'PURCHASE_RECEIPT' : 'ADJUSTMENT_IN';
    repository.db.execute(
      "INSERT INTO product_stock_movements (id, stock_location_id, product_id, movement_type, quantity, previous_quantity, current_quantity, unit_cost, total_cost, currency_code, valuation_method, cost_basis_type, source_type, source_reference, posting_mutation_id, valuation_version, posting_timestamp, resolver_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MOVING_AVERAGE', ?, ?, ?, ?, ?, ?, 'v1')",
      [
        'cstm_' + mutationId,
        locationId,
        PRODUCT,
        movementType,
        resolved.quantity_base,
        existing ? Number(existing.quantity) : 0,
        transition.quantity,
        resolved.unit_cost,
        resolved.total_cost,
        currencyCode,
        basis,
        'GOODS_RECEIPT',
        sourceReference,
        mutationId,
        transition.valuation_version,
        postingTimestamp
      ]
    );

    repository.commitTransaction();
  } catch (error) {
    try { repository.rollbackTransaction(); } catch (_) {}
    throw error;
  }

  return resolved;
}

test('Cost Resolution — first inbound resolves explicit purchase cost', () => {
  const result = postInbound({
    quantity: 10,
    unitCost: 100,
    totalCost: 1000,
    sourceReference: 'GR-COST-001',
    mutationId: 'cost-mut-001',
    postingTimestamp: '2026-10-08T10:00:00.000Z'
  });

  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.valuation_method, 'MOVING_AVERAGE');
  assert.equal(result.quantity_base, 10);
  assert.equal(result.unit_cost, 100);
  assert.equal(result.total_cost, 1000);
  assert.equal(result.currency_code, 'IDR');
  assert.equal(result.valuation_state_reference.valuation_version, 1);
});

test('Cost Resolution — second inbound produces the weighted Moving Average state', () => {
  const result = postInbound({
    quantity: 20,
    unitCost: 120,
    totalCost: 2400,
    sourceReference: 'GR-COST-002',
    mutationId: 'cost-mut-002',
    postingTimestamp: '2026-10-08T11:00:00.000Z'
  });

  const balance = repository.findProductValuationBalance({
    stockLocationId: LOCATION_A,
    productId: PRODUCT
  });

  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.valuation_state_reference.valuation_version, 2);
  assert.equal(Number(balance.quantity), 30);
  assert.equal(Number(balance.carrying_value), 3400);
  assert.ok(Math.abs(Number(balance.moving_average_unit_cost) - (3400 / 30)) < 1e-9);
});

test('Cost Resolution — outbound uses current average and refuses insufficient stock', () => {
  const result = CostResolutionService.resolveOutboundCost({
    stockLocationId: LOCATION_A,
    stockIdentityType: 'PRODUCT',
    stockIdentityId: PRODUCT,
    quantityBase: 15,
    postingReference: 'SALE-COST-001',
    postingMutationId: 'cost-mut-out-001',
    postingTimestamp: '2026-10-08T12:00:00.000Z',
    currencyCode: 'IDR',
    sourceType: 'SALE'
  });

  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.cost_basis_type, 'CURRENT_MOVING_AVERAGE');
  assert.ok(Math.abs(result.unit_cost - (3400 / 30)) < 1e-9);
  assert.ok(Math.abs(result.total_cost - (15 * (3400 / 30))) < 1e-9);

  assert.throws(() => CostResolutionService.resolveOutboundCost({
    stockLocationId: LOCATION_A,
    stockIdentityType: 'PRODUCT',
    stockIdentityId: PRODUCT,
    quantityBase: 31,
    postingReference: 'SALE-COST-002',
    postingMutationId: 'cost-mut-out-002',
    postingTimestamp: '2026-10-08T12:01:00.000Z',
    currencyCode: 'IDR'
  }), error => error && error.code === 'INSUFFICIENT_STOCK');
});

test('Cost Resolution — opening estimate stays ESTIMATED and blocks canonical outbound cost', () => {
  const result = postInbound({
    locationId: LOCATION_B,
    quantity: 10,
    unitCost: 100,
    totalCost: 1000,
    basis: 'OPENING_ESTIMATE',
    sourceReference: 'OPENING-COST-001',
    mutationId: 'cost-mut-est-001',
    postingTimestamp: '2026-10-08T09:00:00.000Z'
  });

  assert.equal(result.status, 'ESTIMATED');

  assert.throws(() => CostResolutionService.resolveOutboundCost({
    stockLocationId: LOCATION_B,
    stockIdentityType: 'PRODUCT',
    stockIdentityId: PRODUCT,
    quantityBase: 1,
    postingReference: 'SALE-EST-001',
    postingMutationId: 'cost-mut-est-out-001',
    postingTimestamp: '2026-10-08T12:00:00.000Z',
    currencyCode: 'IDR'
  }), error => error && error.code === 'COST_UNAVAILABLE');
});

test('Cost Resolution — idempotent replay preserves the originally posted cost evidence', () => {
  const result = CostResolutionService.resolveInboundValuation({
    stockLocationId: LOCATION_A,
    stockIdentityType: 'PRODUCT',
    stockIdentityId: PRODUCT,
    quantityBase: 999,
    costBasisType: 'PURCHASE_RECEIPT',
    incomingUnitCost: 9999,
    incomingTotalCost: 9989001,
    sourceType: 'GOODS_RECEIPT',
    sourceReference: 'SHOULD-NOT-REPLACE',
    postingMutationId: 'cost-mut-002',
    postingTimestamp: '2026-10-08T11:01:00.000Z',
    currencyCode: 'IDR'
  });

  assert.equal(result.idempotent, true);
  assert.equal(result.quantity_base, 20);
  assert.equal(result.unit_cost, 120);
  assert.equal(result.total_cost, 2400);
  assert.equal(result.source_reference, 'GR-COST-002');
});

test('Cost Resolution — backdating and currency changes fail closed', () => {
  assert.throws(() => CostResolutionService.resolveInboundValuation({
    stockLocationId: LOCATION_A,
    stockIdentityType: 'PRODUCT',
    stockIdentityId: PRODUCT,
    quantityBase: 1,
    costBasisType: 'PURCHASE_RECEIPT',
    incomingUnitCost: 50,
    incomingTotalCost: 50,
    sourceType: 'GOODS_RECEIPT',
    sourceReference: 'GR-COST-BACKDATE',
    postingMutationId: 'cost-mut-backdate',
    postingTimestamp: '2026-10-08T10:59:00.000Z',
    currencyCode: 'IDR'
  }), error => error && error.code === 'BACKDATED_VALUATION_REJECTED');

  assert.throws(() => CostResolutionService.resolveInboundValuation({
    stockLocationId: LOCATION_A,
    stockIdentityType: 'PRODUCT',
    stockIdentityId: PRODUCT,
    quantityBase: 1,
    costBasisType: 'PURCHASE_RECEIPT',
    incomingUnitCost: 50,
    incomingTotalCost: 50,
    sourceType: 'GOODS_RECEIPT',
    sourceReference: 'GR-COST-USD',
    postingMutationId: 'cost-mut-usd',
    postingTimestamp: '2026-10-08T13:00:00.000Z',
    currencyCode: 'USD'
  }), error => error && error.code === 'CURRENCY_BASIS_UNRESOLVED');
});

test('Cost Resolution — valuation is isolated by Stock Location', () => {
  const result = postInbound({
    locationId: LOCATION_B,
    quantity: 10,
    unitCost: 140,
    totalCost: 1400,
    basis: 'OPENING_ACTUAL',
    sourceReference: 'OPENING-COST-002',
    mutationId: 'cost-mut-loc-b-actual',
    postingTimestamp: '2026-10-08T10:00:00.000Z'
  });

  assert.equal(result.status, 'ESTIMATED');

  const a = repository.findProductValuationBalance({ stockLocationId: LOCATION_A, productId: PRODUCT });
  const b = repository.findProductValuationBalance({ stockLocationId: LOCATION_B, productId: PRODUCT });

  assert.equal(Number(a.quantity), 30);
  assert.ok(Math.abs(Number(a.moving_average_unit_cost) - (3400 / 30)) < 1e-9);
  assert.equal(Number(b.quantity), 20);
  assert.equal(Number(b.carrying_value), 2400);
  assert.equal(Number(b.moving_average_unit_cost), 120);
  assert.equal(b.cost_availability_status, 'ESTIMATED');
});
