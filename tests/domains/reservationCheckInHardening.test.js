'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../server/database/db');
const { DiningTableService } = require('../../domains/pos');

const ORG_ID = 'org_res_checkin_hardening';
const BRAND_ID = 'brand_res_checkin_hardening';
const BRANCH_A = 'branch_res_checkin_a';
const BRANCH_B = 'branch_res_checkin_b';
const TABLE_A1 = 'tbl_res_checkin_a1';
const TABLE_A2 = 'tbl_res_checkin_a2';
const TABLE_A3 = 'tbl_res_checkin_a3';
const TABLE_B1 = 'tbl_res_checkin_b1';

function futureDate(days = 2) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function seed() {
  db.prepare(`INSERT OR REPLACE INTO organizations (id, name, slug) VALUES (?, 'Org Reservation Checkin', 'org-res-checkin')`).run(ORG_ID);
  db.prepare(`INSERT OR REPLACE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Brand Reservation Checkin', 'brand-res-checkin')`).run(BRAND_ID, ORG_ID);
  db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Reservation Branch A', 'reservation-a', 'Jl. A', -7.25, 112.75)`).run(BRANCH_A, BRAND_ID);
  db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Reservation Branch B', 'reservation-b', 'Jl. B', -7.26, 112.76)`).run(BRANCH_B, BRAND_ID);

  for (const [id, branchId, number, active] of [
    [TABLE_A1, BRANCH_A, '1', 1],
    [TABLE_A2, BRANCH_A, '2', 1],
    [TABLE_A3, BRANCH_A, '3', 0],
    [TABLE_B1, BRANCH_B, '99', 1]
  ]) {
    db.prepare(`INSERT OR REPLACE INTO branch_tables (id, branch_id, table_number, label, capacity, is_active) VALUES (?, ?, ?, ?, 4, ?)`)
      .run(id, branchId, number, `Meja ${number}`, active);
    db.prepare(`INSERT OR REPLACE INTO branch_table_states (table_id, operational_state, current_session_id, notes) VALUES (?, 'available', NULL, NULL)`)
      .run(id);
  }
}

function createReservation(phone) {
  const result = DiningTableService.createReservation({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'Reservation Guest', phone },
    reservation_date: futureDate(),
    guest_count: 2,
    order_channel: 'customer_app'
  });
  assert.equal(result.success, true);
  return result.order_id;
}

test.before(() => seed());

test.after(() => {
  for (const tableId of [TABLE_A1, TABLE_A2, TABLE_A3, TABLE_B1]) {
    db.prepare('DELETE FROM branch_table_holds WHERE table_id = ?').run(tableId);
    db.prepare('DELETE FROM dining_session_tables WHERE table_id = ?').run(tableId);
    db.prepare('DELETE FROM branch_table_states WHERE table_id = ?').run(tableId);
    db.prepare('DELETE FROM branch_tables WHERE id = ?').run(tableId);
  }
  db.prepare('DELETE FROM dining_sessions WHERE branch_id IN (?, ?)').run(BRANCH_A, BRANCH_B);
  db.prepare('DELETE FROM orders WHERE branch_id IN (?, ?)').run(BRANCH_A, BRANCH_B);
  db.prepare('DELETE FROM branches WHERE id IN (?, ?)').run(BRANCH_A, BRANCH_B);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND_ID);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG_ID);
});

test('reservation check-in rejects inactive table', () => {
  const orderId = createReservation('08190000001');

  assert.throws(
    () => DiningTableService.checkInReservation({ reservation_order_id: orderId, table_number: '3' }),
    /RESERVATION_CHECKIN_TABLE_INVALID/
  );

  const order = db.prepare('SELECT order_type, status FROM orders WHERE id = ?').get(orderId);
  assert.equal(order.order_type, 'reservation');
  assert.equal(order.status, 'confirmed');
});

test('reservation check-in rejects table unavailable due to another active session', () => {
  const orderId = createReservation('08190000002');

  const occupied = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_A,
    table_ids: [TABLE_A2],
    customer_name: 'Other Guest',
    customer_phone: '08290000002',
    channel: 'customer_app'
  });

  assert.throws(
    () => DiningTableService.checkInReservation({ reservation_order_id: orderId, table_number: '2' }),
    /RESERVATION_CHECKIN_TABLE_UNAVAILABLE/
  );

  const order = db.prepare('SELECT order_type, status FROM orders WHERE id = ?').get(orderId);
  assert.equal(order.order_type, 'reservation');
  assert.equal(order.status, 'confirmed');

  DiningTableService.completeDiningSession(occupied.session_id);
});

test('reservation check-in resolves table only inside the reservation branch scope', () => {
  const orderId = createReservation('08190000003');

  assert.throws(
    () => DiningTableService.checkInReservation({ reservation_order_id: orderId, table_number: '99' }),
    /RESERVATION_CHECKIN_TABLE_INVALID/
  );

  const order = db.prepare('SELECT order_type, status, branch_id FROM orders WHERE id = ?').get(orderId);
  assert.equal(order.branch_id, BRANCH_A);
  assert.equal(order.order_type, 'reservation');
  assert.equal(order.status, 'confirmed');
});

test('successful reservation check-in creates the dining session and converts the same order atomically', () => {
  const orderId = createReservation('08190000004');

  const result = DiningTableService.checkInReservation({
    reservation_order_id: orderId,
    table_number: '1'
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'CHECKED_IN');
  assert.equal(result.order.id, orderId);
  assert.equal(result.order.order_type, 'dine_in');
  assert.equal(result.order.status, 'active_table');
  assert.equal(result.order.table_number, '1');
  assert.ok(result.order.dining_session_id);

  const order = db.prepare('SELECT order_type, status, table_number, dining_session_id, branch_id FROM orders WHERE id = ?').get(orderId);
  assert.equal(order.order_type, 'dine_in');
  assert.equal(order.status, 'active_table');
  assert.equal(order.table_number, '1');
  assert.equal(order.dining_session_id, result.order.dining_session_id);
  assert.equal(order.branch_id, BRANCH_A);

  const session = db.prepare('SELECT status, branch_id, customer_phone FROM dining_sessions WHERE id = ?').get(order.dining_session_id);
  assert.equal(session.status, 'active');
  assert.equal(session.branch_id, BRANCH_A);
  assert.equal(session.customer_phone, '08190000004');

  const table = db.prepare('SELECT operational_state, current_session_id FROM branch_table_states WHERE table_id = ?').get(TABLE_A1);
  assert.equal(table.operational_state, 'occupied');
  assert.equal(table.current_session_id, order.dining_session_id);

  DiningTableService.completeDiningSession(order.dining_session_id);
});
