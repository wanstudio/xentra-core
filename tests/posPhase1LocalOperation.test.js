'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const db = require('../server/database/db');
const {
  PosLocalOperationService,
  PosShiftService
} = require('../domains/pos');
const { PosOperationalRepository, InventoryRepository, OrderRepository, PosShiftRepository } = require('../core/data/repositories');
const { OrderPlacementService } = require('../domains/commerce');

const posOperationalRepository = new PosOperationalRepository();
const inventoryRepository = new InventoryRepository();
const orderRepository = new OrderRepository();
const posShiftRepository = new PosShiftRepository();

test.before(() => {
  try {
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_p1', 'Holding P1', 'org-p1')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_p1', 'org_p1', 'Brand P1', 'brand-p1')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_p1_a', 'brand_p1', 'Cabang P1 A', 'cabang-p1-a', '62811111111', 'Jl. P1 A', -7.25, 112.75)`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_p1_b', 'brand_p1', 'Cabang P1 B', 'cabang-p1-b', '62822222222', 'Jl. P1 B', -7.26, 112.76)`).run();
    db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES ('cat_p1', 'brand_p1', 'Kategori P1', 'kategori-p1')`).run();

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, is_active)
      VALUES 
        ('prod_p1_1', 'brand_p1', 'cat_p1', 'Ayam Goreng P1', 'ayam-goreng-p1', 25000, 'lock', 1),
        ('prod_p1_2', 'brand_p1', 'cat_p1', 'Es Teh P1', 'es-teh-p1', 5000, 'lock', 1)
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold)
      VALUES 
        ('branch_p1_a', 'prod_p1_1', 25000, 20, 1, 5),
        ('branch_p1_a', 'prod_p1_2', 5000, 50, 1, 10),
        ('branch_p1_b', 'prod_p1_1', 25000, 30, 1, 5),
        ('branch_p1_b', 'prod_p1_2', 5000, 30, 1, 10)
    `).run();
  } catch (e) {
    console.error('POS Phase 1 Seed Error:', e.message);
  }
});

test.beforeEach(() => {
  try {
    db.prepare("UPDATE branch_products SET stock = 20, is_available = 1 WHERE branch_id = 'branch_p1_a' AND product_id = 'prod_p1_1'").run();
    db.prepare("UPDATE branch_products SET stock = 50, is_available = 1 WHERE branch_id = 'branch_p1_a' AND product_id = 'prod_p1_2'").run();
  } catch (_) {}
});

// ==============================================================================
// 1. TERMINAL BINDING & AUTHORIZATION (1 Branch = Exactly 1 POS Device)
// ==============================================================================
test('POS-P1-01: Terminal binding succeeds for a branch and registers device metadata', () => {
  const terminal = PosLocalOperationService.registerTerminal({
    branch_id: 'branch_p1_a',
    device_name: 'Kasir Utama A',
    device_identifier: 'pos_hw_uuid_branch_a_01',
    config_version: 1
  });

  assert.ok(terminal);
  assert.strictEqual(terminal.branch_id, 'branch_p1_a');
  assert.strictEqual(terminal.device_identifier, 'pos_hw_uuid_branch_a_01');
  assert.strictEqual(terminal.status, 'active');
});

test('POS-P1-02: Binding same device again is idempotent and returns existing terminal', () => {
  const terminal = PosLocalOperationService.registerTerminal({
    branch_id: 'branch_p1_a',
    device_name: 'Kasir Utama A',
    device_identifier: 'pos_hw_uuid_branch_a_01'
  });

  assert.ok(terminal);
  assert.strictEqual(terminal.device_identifier, 'pos_hw_uuid_branch_a_01');
});

test('POS-P1-03: Attempting to register a 2nd distinct POS device to the same branch is strictly rejected', () => {
  assert.throws(() => {
    PosLocalOperationService.registerTerminal({
      branch_id: 'branch_p1_a',
      device_name: 'Kasir Kedua A (Rogue)',
      device_identifier: 'pos_hw_uuid_rogue_02'
    });
  }, /already has an active POS terminal.*Exactly 1 POS device per Branch/);
});

test('POS-P1-04: Terminal authorization fails if terminal is used against a different branch', () => {
  const terminal = posOperationalRepository.findActiveTerminalByBranch('branch_p1_a');
  assert.throws(() => {
    PosLocalOperationService.assertTerminalAuthorized(terminal.id, 'branch_p1_b');
  }, /not authorized for branch/);
});

// ==============================================================================
// 2. ATOMIC OFFLINE SALE & LOCAL DURABILITY
// ==============================================================================
test('POS-P1-05: Offline sale atomically commits order, items, inventory deduction, and sync queue outbox', () => {
  const terminal = posOperationalRepository.findActiveTerminalByBranch('branch_p1_a');
  const clientTxId = 'tx_p1_atomic_' + Date.now();

  const stockBefore = inventoryRepository.getStock('branch_p1_a', 'prod_p1_1');
  assert.strictEqual(stockBefore, 20);

  const saleRes = PosLocalOperationService.recordOfflineSale({
    terminal_id: terminal.id,
    branch_id: 'branch_p1_a',
    brand_id: 'brand_p1',
    client_transaction_id: clientTxId,
    order_type: 'dine_in',
    payment_method: 'cash',
    amount_tendered: 50000,
    items: [
      { product_id: 'prod_p1_1', quantity: 2, unit_price: 25000 } // Rp 50.000
    ]
  });

  assert.strictEqual(saleRes.success, true);
  assert.strictEqual(saleRes.status, 'COMMITTED_LOCALLY');
  assert.ok(saleRes.order.id);
  assert.strictEqual(saleRes.queue_entry.status, 'pending');

  // Verify DB: local stock deducted
  const stockAfter = inventoryRepository.getStock('branch_p1_a', 'prod_p1_1');
  assert.strictEqual(stockAfter, 18);

  // Verify DB: sync queue row exists durably
  const queueEntry = posOperationalRepository.findQueueEntryByClientTxId('branch_p1_a', clientTxId);
  assert.ok(queueEntry);
  assert.strictEqual(queueEntry.status, 'pending');
  assert.strictEqual(queueEntry.client_transaction_id, clientTxId);
});

test('POS-P1-06: Repeating recordOfflineSale with same client_transaction_id is idempotent (no duplicate stock deduction)', () => {
  const terminal = posOperationalRepository.findActiveTerminalByBranch('branch_p1_a');
  const clientTxId = 'tx_p1_repeat_' + Date.now();

  const sale1 = PosLocalOperationService.recordOfflineSale({
    terminal_id: terminal.id,
    branch_id: 'branch_p1_a',
    brand_id: 'brand_p1',
    client_transaction_id: clientTxId,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_p1_1', quantity: 1, unit_price: 25000 }]
  });
  assert.strictEqual(sale1.status, 'COMMITTED_LOCALLY');

  const stockAfter1 = inventoryRepository.getStock('branch_p1_a', 'prod_p1_1');

  const sale2 = PosLocalOperationService.recordOfflineSale({
    terminal_id: terminal.id,
    branch_id: 'branch_p1_a',
    brand_id: 'brand_p1',
    client_transaction_id: clientTxId,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_p1_1', quantity: 1, unit_price: 25000 }]
  });
  assert.strictEqual(sale2.status, 'DUPLICATE_IGNORED');
  assert.strictEqual(sale2.idempotent, true);

  const stockAfter2 = inventoryRepository.getStock('branch_p1_a', 'prod_p1_1');
  assert.strictEqual(stockAfter2, stockAfter1, 'Stock must not be deducted twice on duplicate offline sale');
});

// ==============================================================================
// 3. PAYMENT BOUNDARY ENFORCEMENT
// ==============================================================================
test('POS-P1-07: External online payment method is strictly rejected in offline mode', () => {
  const terminal = posOperationalRepository.findActiveTerminalByBranch('branch_p1_a');
  const clientTxId = 'tx_p1_midtrans_' + Date.now();

  assert.throws(() => {
    PosLocalOperationService.recordOfflineSale({
      terminal_id: terminal.id,
      branch_id: 'branch_p1_a',
      brand_id: 'brand_p1',
      client_transaction_id: clientTxId,
      order_type: 'dine_in',
      payment_method: 'midtrans', // Online gateway payment!
      items: [{ product_id: 'prod_p1_1', quantity: 1, unit_price: 25000 }]
    });
  }, /Payment Boundary.*tidak dapat dikonfirmasi dalam mode offline/);
});

test('POS-P1-08: Insufficient cash payment fails fast without creating order or deducting stock', () => {
  const terminal = posOperationalRepository.findActiveTerminalByBranch('branch_p1_a');
  const clientTxId = 'tx_p1_shortcash_' + Date.now();
  const stockBefore = inventoryRepository.getStock('branch_p1_a', 'prod_p1_1');

  assert.throws(() => {
    PosLocalOperationService.recordOfflineSale({
      terminal_id: terminal.id,
      branch_id: 'branch_p1_a',
      brand_id: 'brand_p1',
      client_transaction_id: clientTxId,
      order_type: 'dine_in',
      payment_method: 'cash',
      amount_tendered: 10000, // Total 25.000, bayar 10.000
      items: [{ product_id: 'prod_p1_1', quantity: 1, unit_price: 25000 }]
    });
  }, /kurang dari total tagihan/);

  const stockAfter = inventoryRepository.getStock('branch_p1_a', 'prod_p1_1');
  assert.strictEqual(stockAfter, stockBefore, 'Stock must remain untouched on cash error');
});

// ==============================================================================
// 4. SHIFT CASH SALES EXACTLY-ONCE
// ==============================================================================
test('POS-P1-09: Offline sale with shift_id increments cash sales atomically', () => {
  const terminal = posOperationalRepository.findActiveTerminalByBranch('branch_p1_a');
  const cashierId = 'cashier_shift_p1';
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, username, password_hash, role, brand_id, branch_id)
    VALUES ('${cashierId}', 'org_p1', 'kasir_p1', 'hash123', 'cashier', 'brand_p1', 'branch_p1_a')
  `).run();

  const shift = PosShiftService.openShift({
    branch_id: 'branch_p1_a',
    cashier_id: cashierId,
    starting_float: 100000
  });

  const clientTxId = 'tx_p1_shift_' + Date.now();
  const saleRes = PosLocalOperationService.recordOfflineSale({
    terminal_id: terminal.id,
    branch_id: 'branch_p1_a',
    brand_id: 'brand_p1',
    shift_id: shift.id,
    client_transaction_id: clientTxId,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_p1_1', quantity: 1, unit_price: 25000 }]
  });

  assert.strictEqual(saleRes.status, 'COMMITTED_LOCALLY');

  const shiftRow = posShiftRepository.findById(shift.id);
  assert.strictEqual(Number(shiftRow.total_cash_sales), 25000);
  assert.strictEqual(Number(shiftRow.expected_cash), 125000);

  // Clean up shift
  PosShiftService.closeShift({
    shift_id: shift.id,
    actual_cash: 125000,
    actor_id: cashierId,
    actor_role: 'cashier'
  });
});

// ==============================================================================
// 5. LOW-STOCK OPERATIONAL EVALUATION & MUTATION
// ==============================================================================
test('POS-P1-10: Low-stock warning calculates signal from single branch stock without altering data', () => {
  // prod_p1_1 stock is currently 17, threshold 5 -> not low
  const evalNormal = PosLocalOperationService.evaluateLocalStock({
    branch_id: 'branch_p1_a',
    product_id: 'prod_p1_1',
    custom_threshold: 5
  });
  assert.strictEqual(evalNormal.is_low, false);
  assert.strictEqual(evalNormal.requires_attention, false);

  // Set stock to 3 (below threshold 5)
  db.prepare("UPDATE branch_products SET stock = 3 WHERE branch_id = 'branch_p1_a' AND product_id = 'prod_p1_1'").run();

  const evalLow = PosLocalOperationService.evaluateLocalStock({
    branch_id: 'branch_p1_a',
    product_id: 'prod_p1_1',
    custom_threshold: 5
  });
  assert.strictEqual(evalLow.is_low, true);
  assert.strictEqual(evalLow.requires_attention, true);
});

test('POS-P1-11: Manager offline product availability mutation takes effect immediately and enqueues sync', () => {
  const terminal = posOperationalRepository.findActiveTerminalByBranch('branch_p1_a');

  const mutRes = PosLocalOperationService.mutateProductAvailabilityOffline({
    terminal_id: terminal.id,
    branch_id: 'branch_p1_a',
    product_id: 'prod_p1_1',
    is_available: false,
    actor_id: 'mgr_branch_a'
  });

  assert.strictEqual(mutRes.success, true);
  assert.strictEqual(mutRes.is_available, 0);

  const bp = db.prepare("SELECT is_available FROM branch_products WHERE branch_id = 'branch_p1_a' AND product_id = 'prod_p1_1'").get();
  assert.strictEqual(bp.is_available, 0);

  const queueEntry = posOperationalRepository.findQueueEntryById(mutRes.queue_id);
  assert.ok(queueEntry);
  assert.strictEqual(queueEntry.operation_type, 'product_availability');
  assert.strictEqual(queueEntry.status, 'pending');
});

// ==============================================================================
// 6. SYNC OUTBOX QUEUE LIFECYCLE & RECONCILIATION
// ==============================================================================
test('POS-P1-12: Sync outbox queue reconciles pending items and updates status to synced', async () => {
  const terminal = posOperationalRepository.findActiveTerminalByBranch('branch_p1_a');
  db.prepare("UPDATE branch_products SET stock = 50, is_available = 1 WHERE branch_id = 'branch_p1_a'").run();

  const syncRes = await PosLocalOperationService.syncOutboxQueue({
    terminal_id: terminal.id,
    branch_id: 'branch_p1_a'
  });

  assert.ok(syncRes.total >= 1);
  assert.ok(syncRes.synced >= 1);

  // Verify terminal last_sync_at updated
  const termRow = posOperationalRepository.findTerminalById(terminal.id);
  assert.ok(termRow.last_sync_at);
});

// ==============================================================================
// 7. CROSS-CHANNEL INVENTORY CONFLICT DETECTION & MANAGER RESOLUTION
// ==============================================================================
test('POS-P1-13: Cross-channel inventory conflict is detected and recorded for manager review without silent channel priority', async () => {
  const terminal = posOperationalRepository.findActiveTerminalByBranch('branch_p1_a');

  // Scenario:
  // Central stock is 2.
  // PWA places order for 2 (stock becomes 0).
  // POS was offline with sale of 2.
  // When POS resyncs, central stock is insufficient -> INVENTORY CONFLICT!

  db.prepare("UPDATE branch_products SET stock = 2 WHERE branch_id = 'branch_p1_a' AND product_id = 'prod_p1_1'").run();

  const clientTxId = 'tx_p1_conflict_' + Date.now();
  const offlineSale = PosLocalOperationService.recordOfflineSale({
    terminal_id: terminal.id,
    branch_id: 'branch_p1_a',
    brand_id: 'brand_p1',
    client_transaction_id: clientTxId,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [{ product_id: 'prod_p1_1', quantity: 2, unit_price: 25000 }]
  });
  assert.strictEqual(offlineSale.status, 'COMMITTED_LOCALLY');

  // Central online order consumes all remaining stock
  db.prepare("UPDATE branch_products SET stock = 0 WHERE branch_id = 'branch_p1_a' AND product_id = 'prod_p1_1'").run();

  // Trigger sync outbox
  const syncRes = await PosLocalOperationService.syncOutboxQueue({
    terminal_id: terminal.id,
    branch_id: 'branch_p1_a'
  });

  assert.ok(syncRes.conflicts >= 1, 'Sync must report at least 1 conflict');

  const pendingConflicts = posOperationalRepository.findPendingConflictsByBranch('branch_p1_a');
  assert.ok(pendingConflicts.length >= 1, 'Conflict must be recorded in pos_inventory_conflicts');

  const targetConflict = pendingConflicts.find(c => c.client_transaction_id === clientTxId);
  assert.ok(targetConflict);
  assert.strictEqual(targetConflict.status, 'pending_review');
  assert.strictEqual(targetConflict.pos_demand_quantity, 2);

  // Authorized Branch Manager resolves conflict
  const resolved = PosLocalOperationService.resolveInventoryConflict({
    conflict_id: targetConflict.id,
    resolution_decision: 'prioritize_pos',
    resolved_by: 'mgr_branch_a',
    reason: 'Customer dine-in sudah menerima makanan di meja'
  });

  assert.strictEqual(resolved.status, 'resolved');
  assert.strictEqual(resolved.resolution_decision, 'prioritize_pos');
  assert.strictEqual(resolved.resolved_by, 'mgr_branch_a');
});
