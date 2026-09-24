'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const db = require('../../server/database/db');
const { DiningTableService } = require('../../domains/dining');
const { DiningTableRepository } = require('../../core/data/repositories');
const { CashSettlementService, PaymentGatewayService } = require('../../domains/payment');

test.before(() => {
  try {
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_dinetrack', 'Org DineTrack', 'org-dinetrack')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_dinetrack', 'org_dinetrack', 'Brand DineTrack', 'brand-dinetrack')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES ('branch_dinetrack', 'brand_dinetrack', 'Cabang DineTrack', 'cabang-dinetrack', 'Jl. Track', -7.25, 112.75)`).run();
  } catch (e) {
    console.error('Seed setup error:', e.message);
  }
});

test('Dining Channel Tracking 1 — createOrAttachDiningSession records customer_app channel', () => {
  const tableId = `tbl_pwa_${Date.now()}`;
  db.prepare(`
    INSERT INTO branch_tables (id, branch_id, table_number, label, capacity, is_active)
    VALUES (?, 'branch_dinetrack', 'PWA-1', 'Meja PWA 1', 4, 1)
  `).run(tableId);

  const result = DiningTableService.createOrAttachDiningSession({
    branch_id: 'branch_dinetrack',
    table_ids: [tableId],
    customer_name: 'PWA Customer User',
    customer_phone: '081234567890',
    guest_count: 2,
    channel: 'customer_app'
  });

  assert.ok(result.session_id, 'Session ID should be generated');

  const sessionRow = db.prepare('SELECT * FROM dining_sessions WHERE id = ?').get(result.session_id);
  assert.ok(sessionRow, 'Dining session record exists');
  assert.strictEqual(sessionRow.channel, 'customer_app');
  assert.strictEqual(sessionRow.customer_name, 'PWA Customer User');
  assert.strictEqual(sessionRow.status, 'active');

  const tables = DiningTableService.getBranchLayout('branch_dinetrack');
  const targetTable = (tables.tables || []).find(t => t.id === tableId);
  assert.ok(targetTable, 'Table exists in layout');
  assert.strictEqual(targetTable.operational_state, 'occupied');
  assert.strictEqual(targetTable.session_channel, 'customer_app');
  assert.strictEqual(targetTable.session_customer_name, 'PWA Customer User');

  // Cleanup session
  DiningTableService.completeDiningSession(result.session_id);
});

test('Dining Channel Tracking 2 — createOrAttachDiningSession records pos_cashier channel', () => {
  const tableId = `tbl_pos_${Date.now()}`;
  db.prepare(`
    INSERT INTO branch_tables (id, branch_id, table_number, label, capacity, is_active)
    VALUES (?, 'branch_dinetrack', 'POS-1', 'Meja POS 1', 4, 1)
  `).run(tableId);

  const result = DiningTableService.createOrAttachDiningSession({
    branch_id: 'branch_dinetrack',
    table_ids: [tableId],
    customer_name: 'Kasir Walk-in',
    customer_phone: '081298765432',
    guest_count: 3,
    channel: 'pos_cashier'
  });

  assert.ok(result.session_id, 'Session ID should be generated');

  const sessionRow = db.prepare('SELECT * FROM dining_sessions WHERE id = ?').get(result.session_id);
  assert.ok(sessionRow, 'Dining session record exists');
  assert.strictEqual(sessionRow.channel, 'pos_cashier');
  assert.strictEqual(sessionRow.customer_name, 'Kasir Walk-in');

  const tables = DiningTableService.getBranchLayout('branch_dinetrack');
  const targetTable = (tables.tables || []).find(t => t.id === tableId);
  assert.ok(targetTable, 'Table exists in layout');
  assert.strictEqual(targetTable.operational_state, 'occupied');
  assert.strictEqual(targetTable.session_channel, 'pos_cashier');
  assert.strictEqual(targetTable.session_customer_name, 'Kasir Walk-in');

  // Cleanup session
  DiningTableService.completeDiningSession(result.session_id);
});

test('Dining Channel Tracking 3 — CashSettlementService forwards order_channel to dining session', async () => {
  const tableId = `tbl_settle_${Date.now()}`;
  const orderId = `ord_settle_${Date.now()}`;
  db.prepare(`
    INSERT INTO branch_tables (id, branch_id, table_number, label, capacity, is_active)
    VALUES (?, 'branch_dinetrack', 'SETTLE-1', 'Meja Settle 1', 2, 1)
  `).run(tableId);

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status, table_number)
    VALUES (?, ?, 'brand_dinetrack', 'branch_dinetrack', 'Settle Cust', '081234', 'dine_in', 'customer_app', 25000, 25000, 'cash', 'confirmed', 'SETTLE-1')
  `).run(orderId, `ORD-${Date.now()}`);

  db.prepare(`
    INSERT OR REPLACE INTO pos_shifts (id, branch_id, cashier_id, starting_float, total_cash_sales, expected_cash, status)
    VALUES ('shift_dinetrack', 'branch_dinetrack', 'cashier_dt', 100000, 0, 100000, 'open')
  `).run();

  await CashSettlementService.settleCashPayment({
    order_id: orderId,
    amount: 25000,
    amount_tendered: 25000,
    cashier_id: 'cashier_dt',
    branch_id: 'branch_dinetrack',
    shift_id: 'shift_dinetrack'
  });

  const stateRow = db.prepare('SELECT current_session_id, operational_state FROM branch_table_states WHERE table_id = ?').get(tableId);
  assert.strictEqual(stateRow.operational_state, 'occupied');
  assert.ok(stateRow.current_session_id, 'Table attached to session');

  const sessionRow = db.prepare('SELECT channel, customer_name FROM dining_sessions WHERE id = ?').get(stateRow.current_session_id);
  assert.strictEqual(sessionRow.channel, 'customer_app', 'Channel should be customer_app from order.order_channel');

  DiningTableService.completeDiningSession(stateRow.current_session_id);
});
