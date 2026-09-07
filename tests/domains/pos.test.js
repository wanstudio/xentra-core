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

  // 5. Domain-Level Ownership Breach Enforcement (NEW-01 & NEW-02)
  db.prepare("DELETE FROM pos_shifts WHERE cashier_id = 'cashier_victim'").run();
  const shiftA = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: 'cashier_victim',
    starting_float: 50000
  });

  // Rogue cashier attempts to record cash movement on shiftA
  assert.throws(() => {
    PosShiftService.recordCashMovement({
      shift_id: shiftA.id,
      type: 'in',
      amount: 100000,
      actor_id: 'cashier_attacker',
      actor_role: 'cashier'
    });
  }, /Authorization Breach/);

  // Rogue cashier attempts to close shiftA
  assert.throws(() => {
    PosShiftService.closeShift({
      shift_id: shiftA.id,
      actual_cash: 0,
      actor_id: 'cashier_attacker',
      actor_role: 'cashier'
    });
  }, /Authorization Breach/);

  // Clean up shiftA
  PosShiftService.closeShift({
    shift_id: shiftA.id,
    actual_cash: 50000,
    actor_id: 'cashier_victim',
    actor_role: 'cashier'
  });

  // 6. Cashier Cross-Branch Open Shift Rejection (NEW-03)
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, username, password_hash, role, brand_id, branch_id)
    VALUES ('cashier_locked_branch', 'org_pos', 'kasir_locked', 'hash123', 'cashier', 'brand_pos', 'branch_pos')
  `).run();

  // 7. Database Unique Constraint Invariant on Active Shift (NEW-04 Race Condition Guard)
  db.prepare("DELETE FROM pos_shifts WHERE cashier_id = 'cashier_race_test'").run();
  const shiftRace1 = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: 'cashier_race_test',
    starting_float: 100000
  });

  // Attempting direct raw SQL insert of a second open shift for the exact same cashier -> UNIQUE INDEX VIOLATION
  assert.throws(() => {
    db.prepare(`
      INSERT INTO pos_shifts (id, branch_id, cashier_id, starting_float, status)
      VALUES ('shift_race_bypass', 'branch_pos', 'cashier_race_test', 50000, 'open')
    `).run();
  }, /constraint failed/);

  // Clean up race test shift
  PosShiftService.closeShift({
    shift_id: shiftRace1.id,
    actual_cash: 100000,
    actor_id: 'cashier_race_test',
    actor_role: 'cashier'
  });

  // 8. Non-Cashier User Shift Creation Rejection (NEW-05 Role Segregation Guard)
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, username, password_hash, role, brand_id, branch_id)
    VALUES ('mgr_pos_dummy', 'org_pos', 'mgr_dummy', 'hash123', 'branch_manager', 'brand_pos', 'branch_pos')
  `).run();

  assert.throws(() => {
    PosShiftService.openShift({
      branch_id: 'branch_pos',
      cashier_id: 'mgr_pos_dummy',
      starting_float: 50000
    });
  }, /Shift kasir hanya dapat dibuka untuk user dengan role "cashier"/);
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

  // 1.1 Insufficient Cash Settlement -> FAILS FAST without touching inventory or creating order (NEW-02)
  await assert.rejects(async () => {
    await PosOrderService.settleOrder({
      brand_id: 'brand_pos',
      branch_id: 'branch_pos',
      order_type: PosOrderService.ORDER_TYPES.DINE_IN,
      payment_method: 'cash',
      amount_tendered: 1000, // Total tagihan 40.000, bayar 1.000 (Kurang!)
      items: [
        { product_id: 'prod_pos_1', quantity: 2, expected_price: 20000 }
      ]
    });
  }, /kurang dari total tagihan/);

  // Assert Stock remains strictly UNTOUCHED at 48 (zero leaked deduction)
  const stockAfterFailedCash = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get('branch_pos', 'prod_pos_1').stock;
  assert.strictEqual(stockAfterFailedCash, 48);

  // 2. Same-Day Reservation via POS -> STRICTLY REJECTED
  const todayStr = new Date().toISOString().slice(0, 10);
  const sameDayPosResult = await PosOrderService.settleOrder({
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    order_type: PosOrderService.ORDER_TYPES.RESERVATION,
    reservation_date: todayStr,
    guest_count: 4,
    customer: { name: 'Tamu Reservasi Hari Ini', phone: '0812345678' }
  });
  assert.strictEqual(sameDayPosResult.success, false);
  assert.strictEqual(sameDayPosResult.status, 'SAME_DAY_RESERVATION_REJECTED');

  // 3. Future-Day Reservation via POS (Tomorrow) -> ACCEPTED without immediate stock deduction & 0 bill
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const futurePosResult = await PosOrderService.settleOrder({
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    order_type: PosOrderService.ORDER_TYPES.RESERVATION,
    reservation_date: tomorrowStr,
    guest_count: 4,
    customer: { name: 'Tamu Reservasi Besok', phone: '0899999999' }
  });

  assert.strictEqual(futurePosResult.success, true);
  assert.strictEqual(futurePosResult.order.order_type, 'reservation');
  assert.strictEqual(futurePosResult.order.reservation_date, tomorrowStr);
  assert.strictEqual(futurePosResult.order.grand_total, 0);
  assert.strictEqual(futurePosResult.order.items.length, 0);

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
    customer: { name: 'Tamu No Show', phone: '0812999999' }
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
  const txId = 'tx_offline_uuid_' + Date.now();

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

// ==============================================================================
// POS 9 — Cash Movement Atomicity & Rollback Guard (NEW-01)
// ==============================================================================
test('POS 9 — Cash Movement Atomicity: recordCashMovement on closed shift rolls back completely with zero orphan movement rows', () => {
  const closedShift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: 'cashier_atom_test',
    starting_float: 100000
  });

  PosShiftService.closeShift({
    shift_id: closedShift.id,
    actual_cash: 100000,
    actor_id: 'cashier_atom_test',
    actor_role: 'cashier'
  });

  const movementsBefore = db.prepare('SELECT COUNT(*) as count FROM pos_cash_movements WHERE shift_id = ?').get(closedShift.id).count;
  assert.strictEqual(movementsBefore, 0);

  // Attempting cash movement on closed shift -> REJECTED
  assert.throws(() => {
    PosShiftService.recordCashMovement({
      shift_id: closedShift.id,
      type: 'in',
      amount: 50000,
      reason: 'Mutasi terlambat'
    });
  }, /Shift tidak ditemukan atau sudah ditutup/);

  // INVARIANT CHECK: Zero orphan record inserted in pos_cash_movements
  const movementsAfter = db.prepare('SELECT COUNT(*) as count FROM pos_cash_movements WHERE shift_id = ?').get(closedShift.id).count;
  assert.strictEqual(movementsAfter, 0, 'No orphan cash movement row must remain after failed transaction');
});

// ==============================================================================
// POS 10 — Cash Drawer Invariants: Starting Float & Cash Out Boundary (NEW-03, NEW-04)
// ==============================================================================
test('POS 10 — Cash Drawer Invariants: rejects negative starting float and excessive cash out', () => {
  // 1. Negative starting float rejected (NEW-03)
  assert.throws(() => {
    PosShiftService.openShift({
      branch_id: 'branch_pos',
      cashier_id: 'cashier_float_test',
      starting_float: -50000
    });
  }, /Modal awal kasir.*non-negatif/);

  // 2. Open shift with 50.000 starting float
  const shift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: 'cashier_float_test',
    starting_float: 50000
  });
  assert.strictEqual(shift.expected_cash, 50000);

  // 3. Cash out exceeding expected cash rejected (NEW-04)
  assert.throws(() => {
    PosShiftService.recordCashMovement({
      shift_id: shift.id,
      type: 'out',
      amount: 100000, // 100k > 50k
      actor_id: 'cashier_float_test',
      actor_role: 'cashier'
    });
  }, /INSUFFICIENT_DRAWER_CASH/);

  // 4. Valid cash out within drawer balance succeeds
  const updated = PosShiftService.recordCashMovement({
    shift_id: shift.id,
    type: 'out',
    amount: 20000,
    actor_id: 'cashier_float_test',
    actor_role: 'cashier'
  });
  assert.strictEqual(updated.expected_cash, 30000);

  // Clean up
  PosShiftService.closeShift({
    shift_id: shift.id,
    actual_cash: 30000,
    actor_id: 'cashier_float_test',
    actor_role: 'cashier'
  });
});

// ==============================================================================
// POS 11 — Disaster Recovery Idempotency & CAS Guard (Finding MEDIUM)
// ==============================================================================
test('POS 11 — Disaster Recovery Idempotency: repeated reconciliation cannot overwrite financial closing values', () => {
  // 1. Open shift for disaster recovery testing
  const shift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: 'cashier_dr_idempotency',
    starting_float: 50000
  });

  // 2. First valid disaster recovery reconciliation
  const firstResult = OfflineReconciliationService.recordDisasterRecoveryReconciliation({
    shift_id: shift.id,
    actual_physical_cash: 250000,
    paper_receipts_total: 190000,
    incident_notes: 'Initial disaster reconciliation'
  });

  assert.strictEqual(firstResult.status, 'closed_via_disaster_recovery');
  assert.strictEqual(firstResult.actual_physical_cash, 250000);
  assert.strictEqual(firstResult.variance, 10000);

  // Snapshot closed shift state from database
  const closedRow1 = db.prepare('SELECT actual_cash, variance, status, closed_at FROM pos_shifts WHERE id = ?').get(shift.id);
  assert.strictEqual(closedRow1.status, 'closed');
  assert.strictEqual(closedRow1.actual_cash, 250000);
  assert.strictEqual(closedRow1.variance, 10000);
  assert.ok(closedRow1.closed_at);

  // 3. Second reconciliation attempt against the already-closed shift MUST FAIL
  assert.throws(() => {
    OfflineReconciliationService.recordDisasterRecoveryReconciliation({
      shift_id: shift.id,
      actual_physical_cash: 999999, // Malicious / erroneous overwrite
      paper_receipts_total: 888888,
      incident_notes: 'Tampered second reconciliation'
    });
  }, /sudah ditutup/i);

  // 4. Verify authoritative values were NOT overwritten
  const closedRow2 = db.prepare('SELECT actual_cash, variance, status, closed_at FROM pos_shifts WHERE id = ?').get(shift.id);
  assert.strictEqual(closedRow2.status, 'closed');
  assert.strictEqual(closedRow2.actual_cash, 250000, 'actual_cash must not be overwritten by second reconciliation');
  assert.strictEqual(closedRow2.variance, 10000, 'variance must not be overwritten by second reconciliation');
  assert.strictEqual(closedRow2.closed_at, closedRow1.closed_at, 'closed_at must be immutable');
});

test('POS 12 — Disaster Recovery CAS Guard: atomic compare-and-set rejects closing already non-open shift', () => {
  const shift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: 'cashier_dr_cas',
    starting_float: 50000
  });

  // Close shift normally first
  PosShiftService.closeShift({
    shift_id: shift.id,
    actual_cash: 50000,
    actor_id: 'cashier_dr_cas',
    actor_role: 'cashier'
  });

  const normalClosed = db.prepare('SELECT actual_cash, variance, status, closed_at FROM pos_shifts WHERE id = ?').get(shift.id);
  assert.strictEqual(normalClosed.status, 'closed');
  assert.strictEqual(normalClosed.actual_cash, 50000);

  // Attempt disaster recovery reconciliation on normally closed shift -> MUST BE REJECTED
  assert.throws(() => {
    OfflineReconciliationService.recordDisasterRecoveryReconciliation({
      shift_id: shift.id,
      actual_physical_cash: 200000,
      paper_receipts_total: 100000,
      incident_notes: 'Late reconciliation attempt'
    });
  }, /sudah ditutup/i);

  // Verify normal closing values remain intact
  const finalRow = db.prepare('SELECT actual_cash, variance, status, closed_at FROM pos_shifts WHERE id = ?').get(shift.id);
  assert.strictEqual(finalRow.actual_cash, 50000);
  assert.strictEqual(finalRow.closed_at, normalClosed.closed_at);
});

// ==============================================================================
// POS 13 — Offline Reconciliation Atomicity: Normal Flow (Order + Shift Cash Sales)
// ==============================================================================
test('POS 13 — Offline Reconciliation Atomicity: normal reconciliation commits order and increments shift cash_sales atomically', async () => {
  const shift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: `cashier_atom_norm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    starting_float: 100000
  });

  const txId = 'tx_offline_atom_norm_' + Date.now();
  const res = await OfflineReconciliationService.reconcileOfflineTransaction({
    client_transaction_id: txId,
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    shift_id: shift.id,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [
      { product_id: 'prod_pos_1', quantity: 2, expected_price: 20000 }
    ],
    offline_created_at: new Date().toISOString()
  });

  assert.strictEqual(res.status, 'PROCESSED');
  assert.strictEqual(res.order.grand_total, 40000);

  // Check order persisted
  const persistedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(res.order.id);
  assert.ok(persistedOrder);
  assert.strictEqual(persistedOrder.grand_total, 40000);

  // Check shift cash sales incremented
  const updatedShift = db.prepare('SELECT total_cash_sales, expected_cash FROM pos_shifts WHERE id = ?').get(shift.id);
  assert.strictEqual(updatedShift.total_cash_sales, 40000);
  assert.strictEqual(updatedShift.expected_cash, 140000); // 100k float + 40k cash
});

// ==============================================================================
// POS 14 — Offline Reconciliation Atomicity: Rollback on Shift Update Failure
// ==============================================================================
test('POS 14 — Offline Reconciliation Atomicity: failure in shift cash_sales update rolls back order completely (zero orphan order)', async () => {
  const cid = `cashier_atom_closed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  // Create and close a shift immediately so that updating shift fails ([SHIFT_UPDATE_FAILED])
  const closedShift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: cid,
    starting_float: 50000
  });

  PosShiftService.closeShift({
    shift_id: closedShift.id,
    actual_cash: 50000,
    actor_id: cid,
    actor_role: 'cashier'
  });

  const txId = 'tx_offline_atom_fail_' + Date.now();

  const ordersCountBefore = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE branch_id = ?').get('branch_pos').cnt;

  // Attempt offline reconciliation targeting closed shift
  const res = await OfflineReconciliationService.reconcileOfflineTransaction({
    client_transaction_id: txId,
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    shift_id: closedShift.id,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [
      { product_id: 'prod_pos_1', quantity: 1, expected_price: 20000 }
    ],
    offline_created_at: new Date().toISOString()
  });

  assert.strictEqual(res.status, 'ERROR');
  assert.ok(res.message.includes('Gagal'));

  // Verify order was rolled back and NOT persisted in orders table
  const orphanOrder = db.prepare('SELECT * FROM orders WHERE branch_id = ? AND client_transaction_id = ?').get('branch_pos', txId);
  assert.strictEqual(orphanOrder, undefined, 'Order must not remain persisted when shift update fails');

  const ordersCountAfter = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE branch_id = ?').get('branch_pos').cnt;
  assert.strictEqual(ordersCountAfter, ordersCountBefore, 'Total orders count must be unchanged');

  // Verify shift cash sales remain untouched
  const shiftAfter = db.prepare('SELECT total_cash_sales, expected_cash FROM pos_shifts WHERE id = ?').get(closedShift.id);
  assert.strictEqual(shiftAfter.total_cash_sales, 0);
  assert.strictEqual(shiftAfter.expected_cash, 50000);
});

// ==============================================================================
// POS 15 — Offline Reconciliation Atomicity: Reverse Failure (Order Validation/Stock Failure)
// ==============================================================================
test('POS 15 — Offline Reconciliation Atomicity: order placement failure does NOT increment shift cash_sales', async () => {
  const shift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: `cashier_atom_stock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    starting_float: 50000
  });

  const txId = 'tx_offline_atom_stockfail_' + Date.now();

  // Submit offline transaction with invalid non-existent product
  const res = await OfflineReconciliationService.reconcileOfflineTransaction({
    client_transaction_id: txId,
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    shift_id: shift.id,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [
      { product_id: 'prod_non_existent_fake_999', quantity: 1, expected_price: 50000 }
    ],
    offline_created_at: new Date().toISOString()
  });

  assert.strictEqual(res.status, 'ERROR');

  // Shift cash sales must remain 0 and expected_cash remain initial float
  const shiftAfter = db.prepare('SELECT total_cash_sales, expected_cash FROM pos_shifts WHERE id = ?').get(shift.id);
  assert.strictEqual(shiftAfter.total_cash_sales, 0, 'Shift total_cash_sales must not be incremented');
  assert.strictEqual(shiftAfter.expected_cash, 50000);
});

// ==============================================================================
// POS 16 — Offline Reconciliation Idempotency & Replay: Exactly One Order and One Shift Increment
// ==============================================================================
test('POS 16 — Offline Reconciliation Idempotency: replaying same offline transaction yields DUPLICATE_IGNORED and increments cash_sales exactly once', async () => {
  const shift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: `cashier_atom_idem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    starting_float: 100000
  });

  const txId = 'tx_offline_atom_idem_' + Date.now();
  const txPayload = {
    client_transaction_id: txId,
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    shift_id: shift.id,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [
      { product_id: 'prod_pos_2', quantity: 2, expected_price: 8000 }
    ],
    offline_created_at: new Date().toISOString()
  };

  // Attempt 1: Processed
  const res1 = await OfflineReconciliationService.reconcileOfflineTransaction(txPayload);
  assert.strictEqual(res1.status, 'PROCESSED');
  assert.strictEqual(res1.order.grand_total, 16000);

  // Check shift cash sales after attempt 1
  const shiftAfter1 = db.prepare('SELECT total_cash_sales, expected_cash FROM pos_shifts WHERE id = ?').get(shift.id);
  assert.strictEqual(shiftAfter1.total_cash_sales, 16000);
  assert.strictEqual(shiftAfter1.expected_cash, 116000);

  // Attempt 2: Replay same payload
  const res2 = await OfflineReconciliationService.reconcileOfflineTransaction(txPayload);
  assert.strictEqual(res2.status, 'DUPLICATE_IGNORED');

  // Verify only 1 order exists
  const orders = db.prepare('SELECT * FROM orders WHERE branch_id = ? AND client_transaction_id = ?').all('branch_pos', txId);
  assert.strictEqual(orders.length, 1);

  // Verify shift cash sales was NOT double incremented
  const shiftAfter2 = db.prepare('SELECT total_cash_sales, expected_cash FROM pos_shifts WHERE id = ?').get(shift.id);
  assert.strictEqual(shiftAfter2.total_cash_sales, 16000, 'cash_sales must not be double incremented on replay');
  assert.strictEqual(shiftAfter2.expected_cash, 116000);
});

// ==============================================================================
// POS 17 — Concurrent Reconciliation Race: UNIQUE constraint prevents duplicate order & double increment
// ==============================================================================
test('POS 17 — Offline Reconciliation Concurrency: simulated concurrent sync requests result in exactly one processed and no double increment', async () => {
  const shift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: `cashier_atom_conc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    starting_float: 50000
  });

  const txId = 'tx_offline_atom_conc_' + Date.now();
  const txPayload = {
    client_transaction_id: txId,
    brand_id: 'brand_pos',
    branch_id: 'branch_pos',
    shift_id: shift.id,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [
      { product_id: 'prod_pos_2', quantity: 1, expected_price: 8000 }
    ],
    offline_created_at: new Date().toISOString()
  };

  // Launch two concurrent reconciliation promises
  const [res1, res2] = await Promise.all([
    OfflineReconciliationService.reconcileOfflineTransaction(txPayload),
    OfflineReconciliationService.reconcileOfflineTransaction(txPayload)
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepStrictEqual(statuses, ['DUPLICATE_IGNORED', 'PROCESSED']);

  // Verify exactly one order exists
  const orders = db.prepare('SELECT * FROM orders WHERE branch_id = ? AND client_transaction_id = ?').all('branch_pos', txId);
  assert.strictEqual(orders.length, 1);

  // Verify shift cash sales incremented exactly once (8000)
  const shiftAfter = db.prepare('SELECT total_cash_sales, expected_cash FROM pos_shifts WHERE id = ?').get(shift.id);
  assert.strictEqual(shiftAfter.total_cash_sales, 8000);
  assert.strictEqual(shiftAfter.expected_cash, 58000);
});

// ==============================================================================
// POS 18 — Batch Sync Isolation: Independent Transactions in processBatchSync
// ==============================================================================
test('POS 18 — Batch Sync Isolation: failure in one transaction does not roll back an already-successful independent transaction', async () => {
  const shift = PosShiftService.openShift({
    branch_id: 'branch_pos',
    cashier_id: `cashier_atom_batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    starting_float: 50000
  });

  const txGood = {
    client_transaction_id: 'tx_batch_good_' + Date.now(),
    brand_id: 'brand_pos',
    shift_id: shift.id,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [
      { product_id: 'prod_pos_2', quantity: 2, expected_price: 8000 }
    ],
    offline_created_at: new Date().toISOString()
  };

  const txBad = {
    client_transaction_id: 'tx_batch_bad_' + Date.now(),
    brand_id: 'brand_pos',
    shift_id: shift.id,
    order_type: 'dine_in',
    payment_method: 'cash',
    items: [
      { product_id: 'prod_does_not_exist_xyz', quantity: 1, expected_price: 99999 }
    ],
    offline_created_at: new Date().toISOString()
  };

  const batchResult = await OfflineReconciliationService.processBatchSync({
    branch_id: 'branch_pos',
    transactions: [txGood, txBad]
  });

  assert.strictEqual(batchResult.total, 2);
  assert.strictEqual(batchResult.processed, 1);
  assert.strictEqual(batchResult.failed, 1);

  // Verify txGood order was successfully committed and persisted
  const goodOrder = db.prepare('SELECT * FROM orders WHERE branch_id = ? AND client_transaction_id = ?').get('branch_pos', txGood.client_transaction_id);
  assert.ok(goodOrder, 'Valid transaction in batch must remain persisted');
  assert.strictEqual(goodOrder.grand_total, 16000);

  // Verify txBad order does not exist
  const badOrder = db.prepare('SELECT * FROM orders WHERE branch_id = ? AND client_transaction_id = ?').get('branch_pos', txBad.client_transaction_id);
  assert.strictEqual(badOrder, undefined, 'Failed transaction must not exist');

  // Verify shift cash sales reflects only txGood (16000)
  const shiftAfter = db.prepare('SELECT total_cash_sales, expected_cash FROM pos_shifts WHERE id = ?').get(shift.id);
  assert.strictEqual(shiftAfter.total_cash_sales, 16000);
  assert.strictEqual(shiftAfter.expected_cash, 66000);
});


