'use strict';
const test = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const { domain, events } = require('../../core');
const {
  InventoryMovementModel,
  InventoryStockService,
  PurchaseOrderService,
  identity,
  capabilities
} = require('../../domains/inventory');

test.before(() => {
  try {
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_inv', 'Holding Inventory', 'org-inv')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_inv', 'org_inv', 'Brand Inventory', 'brand-inv')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_inv', 'brand_inv', 'Cabang Inventory', 'cabang-inv', '62812345678', 'Jl. Gudang', -7.25, 112.75)`).run();
    db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES ('cat_inv', 'brand_inv', 'Bahan Inventory', 'bahan-inv')`).run();

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, is_active)
      VALUES 
        ('prod_inv_1', 'brand_inv', 'cat_inv', 'Beras Premium 5kg', 'beras-5kg', 75000, 'lock', 1),
        ('prod_inv_2', 'brand_inv', 'cat_inv', 'Minyak Goreng 2L', 'minyak-2l', 35000, 'lock', 1)
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold)
      VALUES 
        ('branch_inv', 'prod_inv_1', NULL, 10, 1, 5),
        ('branch_inv', 'prod_inv_2', NULL, 5, 1, 2)
    `).run();
  } catch (e) {
    console.error('Inventory seed error:', e.message);
  }
});

// ==============================================================================
// Inventory 1 — Domain Registration & Declaration
// ==============================================================================
test('Inventory 1 — Domain Self-Registration: successfully registered in core DomainRegistry', () => {
  assert.strictEqual(identity.name, 'inventory');
  assert.strictEqual(capabilities.events_produced.includes('inventory.movement.recorded'), true);
  assert.strictEqual(capabilities.events_produced.includes('inventory.stock.received'), true);
  assert.strictEqual(domain.DomainRegistry.isDomainActive('inventory'), true);
});

// ==============================================================================
// Inventory 2 — Two-Stage Purchase In Flow (PO Creation -> Goods Receipt)
// ==============================================================================
test('Inventory 2 — Two-Stage Purchase In: PO creation does not mutate stock; Goods Receipt increments stock & creates ledger entry', async () => {
  // Check initial stock for prod_inv_1 is 10
  assert.strictEqual(InventoryStockService.getStock('branch_inv', 'prod_inv_1'), 10);

  // Stage 1: Create Purchase Order (Status pending / ordered)
  const po = PurchaseOrderService.createPurchaseOrder({
    brand_id: 'brand_inv',
    branch_id: 'branch_inv',
    supplier_name: 'PT Pangan Nusantara',
    created_by: 'mgr_andi',
    items: [
      { product_id: 'prod_inv_1', quantity: 20, unit_cost: 65000 }
    ],
    notes: 'Restock mingguan beras'
  });

  assert.strictEqual(po.status, 'pending');
  assert.ok(po.id);

  // LOCKED RULE VERIFICATION: Stock must remain UNTOUCHED at 10 after PO creation
  assert.strictEqual(InventoryStockService.getStock('branch_inv', 'prod_inv_1'), 10, 'Live stock must NOT change upon PO creation');

  // Verify no ledger entry yet
  const movementsBefore = db.prepare('SELECT COUNT(*) as cnt FROM inventory_movements WHERE reference_id = ?').get(po.po_number).cnt;
  assert.strictEqual(movementsBefore, 0);

  // Stage 2: Physical Goods Receipt Verification
  let receivedEvent = null;
  events.EventBus.subscribe('inventory.stock.received', (evt) => {
    if (evt.payload.po_id === po.id) {
      receivedEvent = evt;
    }
  });

  const receiptResult = PurchaseOrderService.verifyGoodsReceipt({
    po_id: po.id,
    received_by: 'staff_gudang_budi'
  });

  assert.strictEqual(receiptResult.success, true);
  assert.strictEqual(receiptResult.status, 'received');

  // LOCKED RULE VERIFICATION: Stock must now be 10 + 20 = 30
  assert.strictEqual(InventoryStockService.getStock('branch_inv', 'prod_inv_1'), 30, 'Live stock must increment after Goods Receipt verification');

  // Verify immutable ledger entry
  const movement = db.prepare('SELECT * FROM inventory_movements WHERE reference_id = ?').get(po.po_number);
  assert.ok(movement);
  assert.strictEqual(movement.movement_type, 'purchase_in');
  assert.strictEqual(movement.quantity, 20);
  assert.strictEqual(movement.previous_stock, 10);
  assert.strictEqual(movement.current_stock, 30);
  assert.strictEqual(movement.actor_id, 'staff_gudang_budi');

  // Verify Event
  assert.ok(receivedEvent);
  assert.strictEqual(receivedEvent.payload.po_id, po.id);
});

// ==============================================================================
// Inventory 3 — Strict Non-Negative Stock Enforcement & Waste Spoilage
// ==============================================================================
test('Inventory 3 — Stock Mutation: allows valid reduction (waste) and strictly rejects negative stock', () => {
  // Current stock for prod_inv_2 is 5
  assert.strictEqual(InventoryStockService.getStock('branch_inv', 'prod_inv_2'), 5);

  // 1. Valid reduction: 2 units spoiled
  const wasteResult = InventoryStockService.recordMovement({
    branch_id: 'branch_inv',
    product_id: 'prod_inv_2',
    movement_type: InventoryMovementModel.MOVEMENT_TYPES.WASTE_SPOILAGE,
    quantity: -2,
    actor_id: 'mgr_andi',
    notes: 'Minyak bocor saat unboxing'
  });

  assert.strictEqual(wasteResult.success, true);
  assert.strictEqual(wasteResult.current_stock, 3);
  assert.strictEqual(InventoryStockService.getStock('branch_inv', 'prod_inv_2'), 3);

  // 2. Invalid reduction: Attempt to reduce 5 units when only 3 exist (would result in -2)
  assert.throws(() => {
    InventoryStockService.recordMovement({
      branch_id: 'branch_inv',
      product_id: 'prod_inv_2',
      movement_type: InventoryMovementModel.MOVEMENT_TYPES.WASTE_SPOILAGE,
      quantity: -5,
      actor_id: 'mgr_andi',
      notes: 'Over reduction'
    });
  }, /Mutasi ditolak: Stok tidak boleh negatif/);

  // Stock must remain intact at 3
  assert.strictEqual(InventoryStockService.getStock('branch_inv', 'prod_inv_2'), 3);
});

// ==============================================================================
// Inventory 4 — Audit Stock Adjustment (Stock Opname)
// ==============================================================================
test('Inventory 4 — Stock Adjustment: records opname variance with mandatory reason and immutable audit trail', () => {
  // Current stock for prod_inv_2 is 3. Physical count reveals 4 (+1 variance)
  const adjustment = InventoryStockService.recordMovement({
    branch_id: 'branch_inv',
    product_id: 'prod_inv_2',
    movement_type: InventoryMovementModel.MOVEMENT_TYPES.AUDIT_ADJUSTMENT,
    quantity: 1,
    actor_id: 'auditor_rina',
    notes: 'Hasil Stock Opname Bulanan Agustus: Ditemukan 1 botol ekstra di rak belakang'
  });

  assert.strictEqual(adjustment.success, true);
  assert.strictEqual(adjustment.previous_stock, 3);
  assert.strictEqual(adjustment.current_stock, 4);

  const ledger = db.prepare('SELECT * FROM inventory_movements WHERE id = ?').get(adjustment.movement_id);
  assert.strictEqual(ledger.movement_type, 'audit_adjustment');
  assert.strictEqual(ledger.quantity, 1);
  assert.strictEqual(ledger.actor_id, 'auditor_rina');
  assert.ok(ledger.notes.includes('Hasil Stock Opname'));
});
