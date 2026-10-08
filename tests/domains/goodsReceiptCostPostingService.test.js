'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../server/database/db');
const { InventoryRepository } = require('../../core/data/repositories');
const { GoodsReceiptCostPostingService } = require('../../domains/inventory');

const repository = new InventoryRepository();

const ORG = 'org_goods_receipt_cost_v1';
const BRAND = 'brand_goods_receipt_cost_v1';
const BRANCH = 'branch_goods_receipt_cost_v1';
const LOCATION = 'loc_goods_receipt_cost_v1';
const MATERIAL_A = 'mat_goods_receipt_a';
const MATERIAL_B = 'mat_goods_receipt_b';

test.before(async () => {
  await db.readyPromise;

  db.prepare(
    "CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, base_uom_id TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE')"
  ).run();

  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(
    ORG, 'Goods Receipt Cost Test Org', 'goods-receipt-cost-test-org'
  );
  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(
    BRAND, ORG, 'Goods Receipt Cost Test Brand', 'goods-receipt-cost-test-brand'
  );
  db.prepare(
    'INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    BRANCH, BRAND, 'Goods Receipt Cost Branch', 'goods-receipt-cost-branch',
    '628111111112', 'Test', -5.4, 105.2
  );

  db.prepare(
    'INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).run(LOCATION, ORG, BRANCH, 'GR-COST', 'Goods Receipt Cost Location', 'BRANCH');

  db.prepare(
    "INSERT OR IGNORE INTO materials (id, organization_id, material_code, name, base_uom_id, status) VALUES (?, ?, ?, ?, ?, 'ACTIVE'), (?, ?, ?, ?, ?, 'ACTIVE')"
  ).run(
    MATERIAL_A, ORG, 'MAT-RICE', 'Rice Premium', 'uom_kg',
    MATERIAL_B, ORG, 'MAT-OIL', 'Cooking Oil', 'uom_l'
  );
});

test.after(() => {
  db.prepare('DELETE FROM material_stock_movements WHERE stock_location_id = ?').run(LOCATION);
  db.prepare('DELETE FROM material_stock_balances WHERE stock_location_id = ?').run(LOCATION);
  db.prepare('DELETE FROM stock_locations WHERE id = ?').run(LOCATION);
  db.prepare('DELETE FROM materials WHERE id IN (?, ?)').run(MATERIAL_A, MATERIAL_B);
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});

test('Goods Receipt cost posting creates Material Stock at explicit purchase valuation cost', () => {
  const result = GoodsReceiptCostPostingService.postGoodsReceipt({
    goodsReceiptId: 'gr-cost-001',
    goodsReceiptPostingId: 'grp-cost-001',
    stockLocationId: LOCATION,
    postingTimestamp: '2026-10-08T10:00:00.000Z',
    actorId: 'receiver-1',
    lines: [{
      material_id: MATERIAL_A,
      accepted_quantity_base: 10,
      incoming_unit_cost: 10000,
      incoming_total_cost: 100000,
      currency_code: 'IDR',
      posting_mutation_id: 'grp-cost-001-line-1'
    }]
  });

  assert.equal(result.success, true);
  assert.equal(result.idempotent, false);
  assert.equal(result.movements.length, 1);
  assert.equal(result.movements[0].total_cost, 100000);

  const balance = repository.findMaterialValuationBalance({
    stockLocationId: LOCATION,
    materialId: MATERIAL_A
  });
  assert.equal(Number(balance.quantity_base), 10);
  assert.equal(Number(balance.carrying_value), 100000);
  assert.equal(Number(balance.moving_average_unit_cost), 10000);
  assert.equal(balance.cost_availability_status, 'AVAILABLE');

  const movement = repository.findMaterialValuationMovementByPostingMutationId('grp-cost-001-line-1');
  assert.equal(movement.movement_type, 'PURCHASE_RECEIPT');
  assert.equal(movement.cost_basis_type, 'PURCHASE_RECEIPT');
  assert.equal(movement.source_type, 'GOODS_RECEIPT');
  assert.equal(movement.source_reference, 'gr-cost-001');
  assert.equal(movement.currency_code, 'IDR');
});

test('Goods Receipt cost posting supports partial receipts as independent valuation events and re-averages', () => {
  const first = GoodsReceiptCostPostingService.postGoodsReceipt({
    goodsReceiptId: 'gr-cost-002a',
    goodsReceiptPostingId: 'grp-cost-002a',
    stockLocationId: LOCATION,
    postingTimestamp: '2026-10-08T11:00:00.000Z',
    lines: [{
      material_id: MATERIAL_B,
      accepted_quantity_base: 40,
      incoming_unit_cost: 10000,
      incoming_total_cost: 400000,
      currency_code: 'IDR',
      posting_mutation_id: 'grp-cost-002a-line-1'
    }]
  });
  const second = GoodsReceiptCostPostingService.postGoodsReceipt({
    goodsReceiptId: 'gr-cost-002b',
    goodsReceiptPostingId: 'grp-cost-002b',
    stockLocationId: LOCATION,
    postingTimestamp: '2026-10-08T12:00:00.000Z',
    lines: [{
      material_id: MATERIAL_B,
      accepted_quantity_base: 20,
      incoming_unit_cost: 12000,
      incoming_total_cost: 240000,
      currency_code: 'IDR',
      posting_mutation_id: 'grp-cost-002b-line-1'
    }]
  });

  assert.equal(first.movements[0].valuation_version, 1);
  assert.equal(second.movements[0].valuation_version, 2);

  const balance = repository.findMaterialValuationBalance({
    stockLocationId: LOCATION,
    materialId: MATERIAL_B
  });
  assert.equal(Number(balance.quantity_base), 60);
  assert.equal(Number(balance.carrying_value), 640000);
  assert.ok(Math.abs(Number(balance.moving_average_unit_cost) - (640000 / 60)) < 1e-9);
});

test('Goods Receipt cost posting is idempotent and never duplicates an already-posted receipt', () => {
  const replay = GoodsReceiptCostPostingService.postGoodsReceipt({
    goodsReceiptId: 'gr-cost-001',
    goodsReceiptPostingId: 'grp-cost-001',
    stockLocationId: LOCATION,
    postingTimestamp: '2026-10-08T13:00:00.000Z',
    lines: [{
      material_id: MATERIAL_A,
      accepted_quantity_base: 999,
      incoming_unit_cost: 999999,
      incoming_total_cost: 998999001,
      currency_code: 'IDR',
      posting_mutation_id: 'grp-cost-001-line-1'
    }]
  });

  assert.equal(replay.idempotent, true);
  assert.equal(replay.movements[0].accepted_quantity_base, 10);
  assert.equal(replay.movements[0].unit_cost, 10000);

  const movementCount = db.prepare(
    'SELECT COUNT(*) AS count FROM material_stock_movements WHERE source_reference = ?'
  ).get('gr-cost-001').count;
  assert.equal(Number(movementCount), 1);
});

test('Goods Receipt cost posting is atomic: a failing line rolls back every accepted line in the receipt', () => {
  assert.throws(() => GoodsReceiptCostPostingService.postGoodsReceipt({
    goodsReceiptId: 'gr-cost-atomic-001',
    goodsReceiptPostingId: 'grp-cost-atomic-001',
    stockLocationId: LOCATION,
    postingTimestamp: '2026-10-08T14:00:00.000Z',
    lines: [
      {
        material_id: MATERIAL_A,
        accepted_quantity_base: 5,
        incoming_unit_cost: 11000,
        incoming_total_cost: 55000,
        currency_code: 'IDR',
        posting_mutation_id: 'grp-cost-atomic-001-line-1'
      },
      {
        material_id: MATERIAL_B,
        accepted_quantity_base: 5,
        incoming_unit_cost: 12000,
        incoming_total_cost: 1,
        currency_code: 'IDR',
        posting_mutation_id: 'grp-cost-atomic-001-line-2'
      }
    ]
  }), error => error && error.code === 'INBOUND_COST_UNRESOLVED');

  assert.equal(repository.findMaterialValuationMovementByPostingMutationId('grp-cost-atomic-001-line-1'), undefined);
  assert.equal(repository.findMaterialValuationMovementByPostingMutationId('grp-cost-atomic-001-line-2'), undefined);

  const a = repository.findMaterialValuationBalance({ stockLocationId: LOCATION, materialId: MATERIAL_A });
  assert.equal(Number(a.quantity_base), 10);

  const b = repository.findMaterialValuationBalance({ stockLocationId: LOCATION, materialId: MATERIAL_B });
  assert.equal(Number(b.quantity_base), 60);
});

test('Goods Receipt cost posting refuses a second posting for the same Goods Receipt reference', () => {
  assert.throws(() => GoodsReceiptCostPostingService.postGoodsReceipt({
    goodsReceiptId: 'gr-cost-001',
    goodsReceiptPostingId: 'grp-cost-001-different',
    stockLocationId: LOCATION,
    postingTimestamp: '2026-10-08T15:00:00.000Z',
    lines: [{
      material_id: MATERIAL_A,
      accepted_quantity_base: 1,
      incoming_unit_cost: 10000,
      incoming_total_cost: 10000,
      currency_code: 'IDR',
      posting_mutation_id: 'grp-cost-001-different-line-1'
    }]
  }), error => error && error.code === 'GOODS_RECEIPT_ALREADY_POSTED');
});
