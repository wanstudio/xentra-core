'use strict';

/**
 * Satu meja = satu bill (dine-in).
 *
 * Sesi meja (`dining_sessions`) adalah billnya: pesanan pertama membuka sesi,
 * pesanan tambahan menempel ke sesi YANG SAMA supaya konsumen tidak bisa pindah
 * meja dan kasir hanya menagih satu bill per meja.
 *
 * Kontrak yang dikunci di sini:
 * 1. Pesanan pertama untuk sebuah meja membuka sesi aktif dan mengunci mejanya.
 * 2. Pesanan tambahan di meja yang sama TIDAK membuat bill baru.
 * 3. Meja berbeda tetap dapat sesi sendiri (tidak saling menempel).
 * 4. QR meja bisa dipakai menemukan mejanya kembali (fondasi join ulang).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../server/database/db');
require('../helpers/demoFixtures.js')();
const { DiningTableService } = require('../../domains/pos');

const BRANCH = 'branch_bangjo_barat';
const TABLE_A = 'tbl_bill_test_a';
const TABLE_B = 'tbl_bill_test_b';
const QR_A = 'qr_bill_test_a';

const createdSessions = [];

function seedTable(id, number, qrToken) {
  db.prepare(
    `INSERT OR REPLACE INTO branch_tables (id, branch_id, table_number, label, capacity, qr_token)
     VALUES (?, ?, ?, ?, 4, ?)`
  ).run(id, BRANCH, number, 'Meja ' + number, qrToken);
  // State row must exist: attach/occupy is a plain UPDATE on branch_table_states.
  db.prepare(
    `INSERT INTO branch_table_states (table_id, operational_state, updated_at)
     VALUES (?, 'available', datetime('now'))
     ON CONFLICT(table_id) DO UPDATE SET operational_state = 'available', current_session_id = NULL`
  ).run(id);
}

function stateOf(id) {
  return db.prepare('SELECT operational_state, current_session_id FROM branch_table_states WHERE table_id = ?').get(id);
}

function mappingsOf(sessionId) {
  return db.prepare('SELECT table_id FROM dining_session_tables WHERE session_id = ?').all(sessionId);
}

function activeSessionIds() {
  return db.prepare("SELECT id FROM dining_sessions WHERE branch_id = ? AND status = 'active'").all(BRANCH).map((r) => r.id);
}

function openBill(tableId, customerName) {
  const result = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH,
    table_ids: [tableId],
    customer_name: customerName,
    customer_phone: '08120000009',
    guest_count: 2
  });
  if (result && result.session_id) createdSessions.push(result.session_id);
  return result;
}

test('Dine-in: satu meja = satu bill', async (t) => {
  t.before(() => {
    seedTable(TABLE_A, '901', QR_A);
    seedTable(TABLE_B, '902', 'qr_bill_test_b');
  });

  t.after(() => {
    Array.from(new Set(createdSessions)).forEach((sid) => {
      db.prepare('DELETE FROM dining_session_tables WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM dining_sessions WHERE id = ?').run(sid);
    });
    db.prepare('DELETE FROM branch_table_states WHERE table_id IN (?, ?)').run(TABLE_A, TABLE_B);
    db.prepare('DELETE FROM branch_tables WHERE id IN (?, ?)').run(TABLE_A, TABLE_B);
  });

  await t.test('1. the first order opens a session and locks the table', () => {
    const before = activeSessionIds().length;
    const bill = openBill(TABLE_A, 'Rina');

    assert.ok(bill && bill.session_id, 'the first order must open a bill');
    assert.equal(activeSessionIds().length, before + 1, 'exactly one new bill may be opened');

    const state = stateOf(TABLE_A);
    assert.equal(state.operational_state, 'occupied', 'the chosen table must be locked');
    assert.equal(state.current_session_id, bill.session_id, 'the table must point at its bill');

    assert.deepEqual(mappingsOf(bill.session_id).map((m) => m.table_id), [TABLE_A],
      'the bill must carry exactly the chosen table');
  });

  await t.test('2. an add-on order joins the SAME bill (no second bill)', () => {
    const first = openBill(TABLE_A, 'Rina');
    const second = openBill(TABLE_A, 'Rina');

    assert.equal(second.session_id, first.session_id,
      'a second order on the same table must join the open bill, never open a new one');
    assert.equal(mappingsOf(second.session_id).length, 1,
      'the table must not be attached twice');
    assert.equal(stateOf(TABLE_A).current_session_id, first.session_id,
      'the table must keep pointing at the same bill');
  });

  await t.test('3. a different table still gets its own bill', () => {
    const billA = openBill(TABLE_A, 'Rina');
    const billB = openBill(TABLE_B, 'Budi');

    assert.notEqual(billB.session_id, billA.session_id, 'separate tables must not share a bill');
    assert.equal(stateOf(TABLE_B).current_session_id, billB.session_id);
    assert.deepEqual(mappingsOf(billB.session_id).map((m) => m.table_id), [TABLE_B]);
  });

  await t.test('4. the table QR resolves back to its table (rejoin foundation)', () => {
    const resolved = DiningTableService.resolveFromQr(QR_A);
    assert.ok(resolved, 'a table QR must resolve');
    assert.equal(resolved.id || resolved.table_id, TABLE_A, 'the QR must resolve to its own table');
  });
});
