'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const { ProcurementService } = require('../../domains/procurement');

const ORG = 'org_procurement_v1_test';
const BRAND = 'brand_procurement_v1_test';
const BRANCH = 'branch_procurement_v1_test';
const LOCATION = 'loc_procurement_v1_test';
let MATERIAL = null;

let supplierId;
let supplierMaterialId;
let purchaseOrderId;
let packId;

test.before(async () => {
  await db.readyPromise;

  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(
    ORG, 'Procurement Test Org', 'procurement-v1-test-org'
  );
  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(
    BRAND, ORG, 'Procurement Test Brand', 'procurement-v1-test-brand'
  );
  db.prepare(
    'INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    BRANCH, BRAND, 'Procurement Test Branch', 'procurement-v1-test-branch',
    '628111111113', 'Test', -5.4, 105.2
  );
  db.prepare(
    'INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).run(LOCATION, ORG, BRANCH, 'PROC-V1', 'Procurement Stock', 'BRANCH');

  const material = require('../../domains/material/services/MaterialService').createMaterial({
    organizationId: ORG,
    materialCode: 'RICE-PROC-001',
    name: 'Rice Premium',
    baseUomId: 'uom_kg',
    status: 'ACTIVE'
  });
  assert.equal(material.status, 'ACTIVE');
  MATERIAL = material.id;

  const supplier = ProcurementService.createSupplier({
    organizationId: ORG,
    supplierCode: 'SUP-001',
    name: 'Supplier Procurement Test',
    status: 'ACTIVE'
  });
  supplierId = supplier.id;

  const supplierMaterial = ProcurementService.createSupplierMaterial({
    supplierId,
    materialId: MATERIAL,
    supplierItemCode: 'RICE-25KG'
  });
  supplierMaterialId = supplierMaterial.id;

  const pack = ProcurementService.createSupplierMaterialPack({
    supplierMaterialId,
    name: 'Sack 25 kg',
    contentQuantityBase: 25,
    contentUomId: 'uom_kg',
    unitPrice: 300000,
    currencyCode: 'IDR'
  });
  packId = pack.id;
  assert.equal(Number(pack.content_quantity), 25);
  assert.equal(pack.content_uom_id, 'uom_kg');

  const po = ProcurementService.createPurchaseOrder({
    organizationId: ORG,
    supplierId,
    destinationStockLocationId: LOCATION,
    lines: [{
      supplier_material_id: supplierMaterialId,
      ordered_purchase_quantity: 4,
      supplier_pack_id: packId
    }],
    createdBy: 'buyer-1'
  });
  purchaseOrderId = po.id;
  assert.equal(po.status, 'DRAFT');

  ProcurementService.approvePurchaseOrder({ purchaseOrderId });
  ProcurementService.orderPurchaseOrder({ purchaseOrderId });
});

test.after(() => {
  db.prepare('DELETE FROM material_stock_movements WHERE stock_location_id = ?').run(LOCATION);
  db.prepare('DELETE FROM material_stock_balances WHERE stock_location_id = ?').run(LOCATION);
  db.prepare('DELETE FROM goods_receipt_lines WHERE goods_receipt_id IN (SELECT id FROM goods_receipts WHERE purchase_order_id = ?)').run(purchaseOrderId);
  db.prepare('DELETE FROM goods_receipts WHERE purchase_order_id = ?').run(purchaseOrderId);
  db.prepare('DELETE FROM purchase_order_lines WHERE purchase_order_id = ?').run(purchaseOrderId);
  db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(purchaseOrderId);
  db.prepare('DELETE FROM supplier_material_packs WHERE id = ?').run(packId);
  db.prepare('DELETE FROM supplier_materials WHERE id = ?').run(supplierMaterialId);
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(supplierId);
  db.prepare('DELETE FROM materials WHERE id = ?').run(MATERIAL);
  db.prepare('DELETE FROM stock_locations WHERE id = ?').run(LOCATION);
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});

test('canonical Purchase Order snapshots supplier pack economics without mutating stock', () => {
  const line = db.prepare('SELECT * FROM purchase_order_lines WHERE purchase_order_id = ?').get(purchaseOrderId);

  assert.equal(Number(line.ordered_purchase_quantity), 4);
  assert.equal(Number(line.resolved_base_quantity), 100);
  assert.equal(Number(line.base_quantity_per_purchase_unit), 25);
  assert.equal(line.supplier_pack_id, packId);

  const stockRows = db.prepare('SELECT COUNT(*) AS count FROM material_stock_movements WHERE stock_location_id = ?').get(LOCATION);
  assert.equal(Number(stockRows.count), 0);
});

test('Goods Receipt posts accepted pack quantity into Material Stock at normalized purchase cost', () => {
  const result = ProcurementService.postGoodsReceipt({
    purchaseOrderId,
    goodsReceiptId: 'gr-proc-v1-001',
    goodsReceiptPostingId: 'grp-proc-v1-001',
    receivedBy: 'receiver-1',
    receivedAt: '2026-10-08T20:00:00+07:00',
    lines: [{
      purchase_order_line_id: db.prepare('SELECT id FROM purchase_order_lines WHERE purchase_order_id = ?').get(purchaseOrderId).id,
      accepted_purchase_quantity: 2,
      rejected_purchase_quantity: 0
    }]
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'POSTED');

  const balance = db.prepare(
    'SELECT quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?'
  ).get(LOCATION, MATERIAL);

  assert.equal(Number(balance.quantity_base), 50);
  assert.equal(Number(balance.carrying_value), 600000);
  assert.equal(Number(balance.moving_average_unit_cost), 12000);
  assert.equal(balance.cost_availability_status, 'AVAILABLE');

  const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
  assert.equal(po.status, 'PARTIALLY_RECEIVED');
});

test('second partial Goods Receipt completes PO and is weighted through the same Material valuation key', () => {
  const poLineId = db.prepare('SELECT id FROM purchase_order_lines WHERE purchase_order_id = ?').get(purchaseOrderId).id;
  const result = ProcurementService.postGoodsReceipt({
    purchaseOrderId,
    goodsReceiptId: 'gr-proc-v1-002',
    goodsReceiptPostingId: 'grp-proc-v1-002',
    lines: [{
      purchase_order_line_id: poLineId,
      accepted_purchase_quantity: 2,
      rejected_purchase_quantity: 0
    }]
  });

  assert.equal(result.success, true);

  const balance = db.prepare(
    'SELECT quantity_base, carrying_value, moving_average_unit_cost FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?'
  ).get(LOCATION, MATERIAL);

  assert.equal(Number(balance.quantity_base), 100);
  assert.equal(Number(balance.carrying_value), 1200000);
  assert.equal(Number(balance.moving_average_unit_cost), 12000);

  const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
  assert.equal(po.status, 'RECEIVED');
});

test('Goods Receipt replay is idempotent and does not duplicate Material Stock', () => {
  const replay = ProcurementService.postGoodsReceipt({
    purchaseOrderId,
    goodsReceiptId: 'gr-proc-v1-002',
    goodsReceiptPostingId: 'grp-proc-v1-002',
    lines: [{
      purchase_order_line_id: db.prepare('SELECT id FROM purchase_order_lines WHERE purchase_order_id = ?').get(purchaseOrderId).id,
      accepted_purchase_quantity: 999,
      rejected_purchase_quantity: 0
    }]
  });

  assert.equal(replay.idempotent, true);

  const movementCount = db.prepare(
    'SELECT COUNT(*) AS count FROM material_stock_movements WHERE source_reference = ?'
  ).get('gr-proc-v1-002').count;
  assert.equal(Number(movementCount), 1);

  const balance = db.prepare(
    'SELECT quantity_base, carrying_value FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?'
  ).get(LOCATION, MATERIAL);
  assert.equal(Number(balance.quantity_base), 100);
  assert.equal(Number(balance.carrying_value), 1200000);
});
