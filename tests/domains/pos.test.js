'use strict';
const test = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const {
  PosShiftModel,
  OfflineRiskLimitModel,
  PosShiftService,
  PosOrderService,
  PosHardwareRouter,
  OfflineReconciliationService,
  identity,
  capabilities
} = require('../../domains/pos');
const { domain, events } = require('../../core');

// Seed test context
test.before(() => {
  try {
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_pos', 'Holding POS', 'org-pos')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_pos', 'org_pos', 'Brand POS', 'brand-pos')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_pos', 'brand_pos', 'Cabang POS', 'cabang-pos', '62812345678', 'Jl. Kasir', -7.25, 112.75)`).run();
    db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES ('cat_pos', 'brand_pos', 'Makanan POS', 'makanan-pos')`).run();

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, slug, price, pricing_mode, is_active)
      VALUES 
        ('prod_pos_1', 'brand_pos', 'cat_pos', 'Nasi Goreng POS', 'nasgor-pos', 20000, 'lock', 1),
        ('prod_pos_2', 'brand_pos', 'cat_pos', 'Es Jeruk POS', 'esjeruk-pos', 8000, 'lock', 1)
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold)
      VALUES 
        ('branch_pos', 'prod_pos_1', NULL, 50, 1, 5),
        ('branch_pos', 'prod_pos_2', NULL, 30, 1, 5)
    `).run();
  } catch (e) {
    console.error('POS Seed error:', e.message);
  }
});

// ==============================================================================
// POS 1 — Domain Self-Registration
// ==============================================================================
test('POS 1 — Self-Registration: successfully registered in core DomainRegistry', () => {
  assert.strictEqual(identity.name, 'pos');
  assert.strictEqual(capabilities.events_produced.includes('pos.shift.closed'), true);
  assert.strictEqual(capabilities.events_produced.includes('pos.offline.reconciled'), true);
  assert.strictEqual(domain.DomainRegistry.isDomainActive('pos'), true);
});

// ==============================================================================
// POS 2 — Shift & Cash Control Lifecycle (Open -> Cash In/Out -> Close & Variance)
// ==============================================================================
test('POS 2 — Cashier Shift: handles Open, Cash In/Out, and Close with exact variance', () => {
  let shiftClosedEvent = null;
  events.EventBus.subscribe('pos.shift.closed', (e) => {
    shiftClosedEvent = e;
  });

  // 1. Open Shift with Rp 100.000 starting float
  const shift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: 'cashier_01',
    starting_float: 100000
  });
  assert.strictEqual(shift.status, 'open');
  assert.strictEqual(shift.expected_cash, 100000);

  // 2. Cash In (modal kembalian tambahan Rp 50.000)
  PosShiftService.recordCashMovement({
    shift_id: shift.id,
    type: 'in',
    amount: 50000,
    reason: 'Tambahan uang kecil'
  });

  // 3. Cash Out (beli es batu darurat Rp 20.000)
  const afterOut = PosShiftService.recordCashMovement({
    shift_id: shift.id,
    type: 'out',
    amount: 20000,
    reason: 'Beli es batu darurat'
  });
  assert.strictEqual(afterOut.expected_cash, 130000); // 100k + 50k - 20k

  // 4. Close Shift with Actual Cash Rp 128.000 (Short variance of -2000)
  const closedShift = PosShiftService.closeShift({
    shift_id: shift.id,
    actual_cash: 128000
  });
  assert.strictEqual(closedShift.status, 'closed');
  assert.strictEqual(closedShift.expected_cash, 130000);
  assert.strictEqual(closedShift.actual_cash, 128000);
  assert.strictEqual(closedShift.variance, -2000); // Selisih kas minus 2000

  assert.ok(shiftClosedEvent);
  assert.strictEqual(shiftClosedEvent.payload.variance, -2000);
});

// ==============================================================================
// POS 3 — Fail-Fast Offline Risk Limit Policy
// ==============================================================================
test('POS 3 — Offline Risk Limit: validates valid limit and strictly rejects limit exceeding Owner Ceiling', () => {
  const ownerCeiling = {
    max_offline_amount: 5000000, // Rp 5.000.000
    max_offline_duration_hours: 4
  };

  // 1. Valid branch config within ceiling
  const valid = OfflineRiskLimitModel.validate({
    branchConfig: { max_offline_amount: 3000000, max_offline_duration_hours: 2 },
    ownerCeiling
  });
  assert.strictEqual(valid.is_valid, true);
  assert.strictEqual(valid.effective_config.max_offline_amount, 3000000);

  // 2. Reject if branch exceeds Owner Safety Ceiling (Fail-Fast: No silent clamp!)
  assert.throws(() => {
    OfflineRiskLimitModel.validate({
      branchConfig: { max_offline_amount: 10000000 }, // 10 jt > 5 jt
      ownerCeiling
    });
  }, /melebihi Safety Ceiling Owner/);

  // 3. Reject if duration exceeds Owner Safety Ceiling
  assert.throws(() => {
    OfflineRiskLimitModel.validate({
      branchConfig: { max_offline_duration_hours: 8 }, // 8 jam > 4 jam
      ownerCeiling
    });
  }, /melebihi Safety Ceiling Owner/);
});

// ==============================================================================
// POS 4 — Dine-in Order Holding, Split Bill, Merge Bill, & Customer App Addition
// ==============================================================================
test('POS 4 — Held Orders: supports Hold Table, Customer App Item Addition, Split, and Merge Bill', () => {
  // 1. Hold Dine-in Order for Table 5
  const held = PosOrderService.holdOrder({
    branch_id: 'branch_pos',
    table_number: '5',
    customer_name: 'Budi Santoso',
    items: [
      { product_id: 'prod_pos_1', name: 'Nasi Goreng POS', quantity: 2, price: 20000 }
    ]
  });
  assert.strictEqual(held.status, 'held');
  assert.strictEqual(held.items.length, 1);

  // 2. Customer App Addition: Tamu menambah Es Jeruk via scan QR Meja 5 (Cash/Pay at Cashier)
  const updatedTableBill = PosOrderService.appendItemsToTableBill({
    branch_id: 'branch_pos',
    table_number: '5',
    additional_items: [
      { product_id: 'prod_pos_2', name: 'Es Jeruk POS', quantity: 2, price: 8000 }
    ]
  });
  assert.strictEqual(updatedTableBill.items.length, 2); // Nasgor + Es Jeruk tergabung otomatis!

  // 3. Split Bill (Pisahkan Es Jeruk ke tagihan baru)
  const splitResult = PosOrderService.splitBill({
    held_order_id: held.id,
    split_items: [{ product_id: 'prod_pos_2', name: 'Es Jeruk POS', quantity: 2, price: 8000 }]
  });
  assert.strictEqual(splitResult.original_bill.items.length, 1); // Nasi Goreng
  assert.strictEqual(splitResult.new_bill.items.length, 1);      // Es Jeruk

  // 4. Merge Bill back
  const merged = PosOrderService.mergeBill({
    target_held_id: splitResult.original_bill.id,
    source_held_id: splitResult.new_bill.id
  });
  assert.strictEqual(merged.items.length, 2);
});

// ==============================================================================
// POS 5 — Order Settlement (Dine-in, Reservation) & Stock Delegation
// ==============================================================================
test('POS 5 — Order Settle: supports dine_in, enforces reservation same-day rejection & future date acceptance', async () => {
  // Initial stock for prod_pos_1 is 50
  const initialStock = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_pos', 'prod_pos_1').stock;
  assert.strictEqual(initialStock, 50);

  // 1. Settle direct Dine-In order
  const settleResult = await PosOrderService.settleOrder({
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    order_type: PosOrderService.ORDER_TYPES.DINE_IN,
    payment_method: 'cash',
    amount_tendered: 50000,
    items: [
      { product_id: 'prod_pos_1', quantity: 2, expected_price: 20000 } // Rp 40.000
    ]
  });

  assert.strictEqual(settleResult.success, true);
  assert.strictEqual(settleResult.order.order_type, 'dine_in');
  assert.strictEqual(settleResult.order.grand_total, 40000);
  assert.strictEqual(settleResult.order.change, 10000); // Rp 10.000 kembalian

  // Verify stock was deducted via Commerce (50 - 2 = 48)
  const stockAfterDineIn = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_pos', 'prod_pos_1').stock;
  assert.strictEqual(stockAfterDineIn, 48);

  // 2. Same-Day Reservation via POS -> STRICTLY REJECTED
  const todayStr = new Date().toISOString().slice(0, 10);
  const sameDayPosResult = await PosOrderService.settleOrder({
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    order_type: PosOrderService.ORDER_TYPES.RESERVATION,
    reservation_date: todayStr,
    guest_count: 4,
    payment_method: 'cash',
    amount_tendered: 20000,
    items: [
      { product_id: 'prod_pos_1', quantity: 1, expected_price: 20000 }
    ]
  });
  assert.strictEqual(sameDayPosResult.success, false);
  assert.strictEqual(sameDayPosResult.status, 'SAME_DAY_RESERVATION_REJECTED');

  // 3. Future-Day Reservation via POS (Tomorrow) -> ACCEPTED without immediate stock deduction
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const futurePosResult = await PosOrderService.settleOrder({
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    order_type: PosOrderService.ORDER_TYPES.RESERVATION,
    reservation_date: tomorrowStr,
    guest_count: 4,
    payment_method: 'cash',
    amount_tendered: 20000,
    items: [
      { product_id: 'prod_pos_1', quantity: 1, expected_price: 20000 }
    ]
  });

  assert.strictEqual(futurePosResult.success, true);
  assert.strictEqual(futurePosResult.order.order_type, 'reservation');
  assert.strictEqual(futurePosResult.order.reservation_date, tomorrowStr);

  // IMPORTANT: Live stock remains UNTOUCHED at 48 upon booking (no premature deduction for future dates)
  const stockAfterBooking = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_pos', 'prod_pos_1').stock;
  assert.strictEqual(stockAfterBooking, 48, 'Live stock must not be deducted upon reservation booking');

  // 4. Guest Arrival Lifecycle: POS Check-in converts EXACT SAME ORDER: reservation -> dine_in
  const checkInResult = PosOrderService.checkInReservation({
    reservation_order_id: futurePosResult.order.id,
    table_number: '12'
  });

  assert.strictEqual(checkInResult.success, true);
  assert.strictEqual(checkInResult.status, 'CHECKED_IN');
  assert.strictEqual(checkInResult.order.id, futurePosResult.order.id, 'Must keep the exact same order ID');
  assert.strictEqual(checkInResult.order.order_type, 'dine_in');
  assert.strictEqual(checkInResult.order.table_number, '12');

  // Verify database record has been mutated in-place
  const dbOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(futurePosResult.order.id);
  assert.strictEqual(dbOrder.order_type, 'dine_in');
  assert.strictEqual(dbOrder.table_number, '12');
  assert.strictEqual(dbOrder.status, 'active_table');

  // 5. No-Show Grace Period Exceeded: Manager Cancels Overdue Reservation
  const overdueRes = await PosOrderService.settleOrder({
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    order_type: PosOrderService.ORDER_TYPES.RESERVATION,
    reservation_date: tomorrowStr,
    guest_count: 2,
    payment_method: 'cash',
    amount_tendered: 20000,
    items: [{ product_id: 'prod_pos_1', quantity: 1, expected_price: 20000 }]
  });

  const cancelResult = PosOrderService.cancelNoShowReservation({
    reservation_order_id: overdueRes.order.id,
    actor_id: 'manager_branch_pos',
    reason: 'Toleransi 60 menit terlewat tanpa check-in (No-Show)'
  });

  assert.strictEqual(cancelResult.success, true);
  assert.strictEqual(cancelResult.status, 'CANCELLED_NO_SHOW');

  const cancelledDbOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(overdueRes.order.id);
  assert.strictEqual(cancelledDbOrder.status, 'cancelled');
  assert.ok(cancelledDbOrder.order_note.includes('No-Show'));
});

// ==============================================================================
// POS 6 — Hardware Receipt & Kitchen Ticket / KDS Routing
// ==============================================================================
test('POS 6 — Hardware & KDS Router: formats receipt and routes kitchen ticket', async () => {
  let kdsEventReceived = null;
  events.EventBus.subscribe('pos.kitchen.ticket_routed', (e) => {
    kdsEventReceived = e;
  });

  const mockOrder = {
    id: 'ord_pos_123',
    order_number: 'ORD-POS-1001',
    grand_total: 40000,
    order_type: 'dine_in',
    table_number: '12',
    payment_method: 'cash',
    amount_tendered: 50000,
    change: 10000,
    items: [
      { name: 'Nasi Goreng POS', quantity: 2, unit_price: 20000, subtotal: 40000, note: 'Pedas sedang' }
    ]
  };

  // 1. Customer Receipt Formatting
  const receipt = PosHardwareRouter.buildCustomerReceipt({
    branch_name: 'Xentra POS Test',
    order: mockOrder
  });
  assert.strictEqual(receipt.action, 'print_receipt');
  assert.strictEqual(receipt.open_cash_drawer, true);
  assert.ok(receipt.raw_content.includes('MEJA : 12'));

  // 2. Kitchen Ticket & KDS Dispatching
  const kitchenRoute = await PosHardwareRouter.routeToKitchen({
    branch_id: 'branch_pos',
    order: mockOrder
  });
  assert.strictEqual(kitchenRoute.dispatched, true);
  assert.strictEqual(kitchenRoute.ticket_payload.action, 'print_kitchen_ticket');

  assert.ok(kdsEventReceived);
  assert.strictEqual(kdsEventReceived.payload.order_id, 'ord_pos_123');
  assert.strictEqual(kdsEventReceived.payload.table_number, '12');
  assert.ok(kdsEventReceived.payload.ticket_content.includes('Pedas sedang'));
});

// ==============================================================================
// POS 7 — Offline Sync Reconciliation & Idempotency Deduplication
// ==============================================================================
test('POS 7 — Offline Reconciliation: honors authoritative cash capture & drops duplicate sync', async () => {
  const txId = 'tx_offline_uuid_999';

  // 1. First sync attempt: Processed successfully
  const syncResult1 = await OfflineReconciliationService.reconcileOfflineTransaction({
    client_transaction_id: txId,
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [
      { product_id: 'prod_pos_2', quantity: 2, expected_price: 8000 }
    ],
    offline_created_at: '2026-08-31T20:00:00Z'
  });

  assert.strictEqual(syncResult1.status, 'PROCESSED');
  assert.strictEqual(syncResult1.order.grand_total, 16000);
  assert.strictEqual(syncResult1.order.client_transaction_id, txId);

  // 2. Duplicate sync attempt with same client_transaction_id: Ignored (Idempotent)
  const syncResult2 = await OfflineReconciliationService.reconcileOfflineTransaction({
    client_transaction_id: txId,
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    items: [
      { product_id: 'prod_pos_2', quantity: 2, expected_price: 8000 }
    ]
  });

  assert.strictEqual(syncResult2.status, 'DUPLICATE_IGNORED');
  assert.ok(syncResult2.message.includes('Idempotent'));
});

// ==============================================================================
// POS 8 — Disaster Recovery Reconciliation (Lost/Damaged Device)
// ==============================================================================
test('POS 8 — Disaster Recovery: reconciles physical cash against un-synced receipt bundles', () => {
  let disasterEvent = null;
  events.EventBus.subscribe('pos.disaster_recovery.reconciled', (e) => {
    disasterEvent = e;
  });

  // Open temporary shift for disaster recovery testing
  const disasterShift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: 'cashier_disaster',
    starting_float: 50000
  });

  // Device damaged: Cashier has Rp 250.000 in drawer, paper receipts total Rp 190.000
  // Expected in drawer = 50.000 + 190.000 = 240.000 ➔ Variance = +10.000
  const recoveryResult = OfflineReconciliationService.recordDisasterRecoveryReconciliation({
    shift_id: disasterShift.id,
    actual_physical_cash: 250000,
    paper_receipts_total: 190000,
    incident_notes: 'Tablet kasir rusak akibat tersiram air saat jam sibuk'
  });

  assert.strictEqual(recoveryResult.status, 'closed_via_disaster_recovery');
  assert.strictEqual(recoveryResult.actual_physical_cash, 250000);
  assert.strictEqual(recoveryResult.variance, 10000);

  assert.ok(disasterEvent);
  assert.strictEqual(disasterEvent.payload.disaster_variance, 10000);
  assert.ok(disasterEvent.payload.incident_notes.includes('tersiram air'));
});
