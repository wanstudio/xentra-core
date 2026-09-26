'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../server/app');
const db = require('../server/database/db');
const DiningTableService = require('../domains/dining/services/DiningTableService');
require('./helpers/demoFixtures.js')();

const BRAND_ID = 'brand_bangjo';
const BRANCH_A = 'branch_bangjo_barat';
const BRANCH_B = 'branch_bangjo_timur';
const TOKEN = 'reservation-lifecycle-bm-token';
const USER_ID = 'reservation-lifecycle-bm';

let server;
let baseUrl;

function api(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        host: 'app.mybangjo.com',
        authorization: 'Bearer ' + TOKEN,
        'content-type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test.before(async () => {
  db.prepare(`
    INSERT OR REPLACE INTO users
      (id, brand_id, organization_id, branch_id, username, email, full_name, role, status, created_at, updated_at)
    VALUES (?, ?, 'org_xentra_holding', ?, 'res_lifecycle_bm', 'res.lifecycle@test.local',
            'Reservation Lifecycle BM', 'branch_manager', 'active', datetime('now'), datetime('now'))
  `).run(USER_ID, BRAND_ID, BRANCH_A);

  global.TokenSessionStore.sessions.set(TOKEN, {
    type: 'staff',
    role: 'branch_manager',
    userId: USER_ID,
    branchId: BRANCH_A,
    branch_id: BRANCH_A,
    brandId: BRAND_ID,
    brand_id: BRAND_ID,
    expiresAt: Date.now() + 3600000
  });

  db.prepare(`
    INSERT OR REPLACE INTO branch_tables
      (id, branch_id, table_number, label, capacity, qr_token, is_active)
    VALUES ('tbl_res_api_1', ?, 'R1', 'Reservasi 1', 4, 'qr-res-api-1', 1)
  `).run(BRANCH_A);
  db.prepare(`
    INSERT OR REPLACE INTO branch_table_states
      (table_id, operational_state, current_session_id, updated_at)
    VALUES ('tbl_res_api_1', 'available', NULL, datetime('now'))
  `).run();

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = 'http://127.0.0.1:' + server.address().port;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.prepare('DELETE FROM dining_session_tables WHERE session_id IN (SELECT id FROM dining_sessions WHERE customer_phone LIKE ? OR customer_name = ?)').run('08190000%', 'API Reservation Lifecycle');
  db.prepare('DELETE FROM dining_sessions WHERE customer_phone LIKE ? OR customer_name = ?').run('08190000%', 'API Reservation Lifecycle');
  db.prepare('DELETE FROM branch_table_states WHERE table_id = ?').run('tbl_res_api_1');
  db.prepare('DELETE FROM branch_tables WHERE id = ?').run('tbl_res_api_1');
  db.prepare('DELETE FROM orders WHERE customer_phone LIKE ?').run('08190000%');
  db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
  global.TokenSessionStore.sessions.delete(TOKEN);
});

test('Branch Manager can check-in a reservation through the API', () => {
  const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const booking = DiningTableService.createReservation({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'API Reservation Lifecycle', phone: '08190000031' },
    reservation_date: future,
    reservation_time: '19:30',
    guest_count: 2
  });
  assert.equal(booking.success, true, JSON.stringify(booking));

  const responsePromise = api('/api/v1/pos/reservations/' + booking.order_id + '/check-in', { table_number: 'R1' });
  return responsePromise.then(({ status, body }) => {
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.equal(body.order.order_type, 'dine_in');
    assert.equal(body.order.status, 'active_table');
    assert.equal(body.order.table_number, 'R1');

    const row = db.prepare('SELECT order_type, status FROM orders WHERE id = ?').get(booking.order_id);
    assert.deepEqual({ ...row }, { order_type: 'dine_in', status: 'active_table' });
  });
});

test('Branch Manager can no-show cancel an overdue reservation through the API', () => {
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const booking = DiningTableService.createReservation({
    brand_id: BRAND_ID,
    branch_id: BRANCH_A,
    customer: { name: 'API Reservation Lifecycle', phone: '08190000032' },
    reservation_date: future,
    reservation_time: '18:00',
    guest_count: 2
  });
  assert.equal(booking.success, true, JSON.stringify(booking));

  db.prepare('UPDATE orders SET scheduled_slot_start = ? WHERE id = ?')
    .run(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().slice(0, 19), booking.order_id);

  return api('/api/v1/pos/reservations/' + booking.order_id + '/no-show', {
    reason: 'No-show test'
  }).then(({ status, body }) => {
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.status, 'CANCELLED_NO_SHOW');

    const row = db.prepare('SELECT order_type, status FROM orders WHERE id = ?').get(booking.order_id);
    assert.deepEqual({ ...row }, { order_type: 'reservation', status: 'cancelled' });
  });
});

test('Branch Manager is blocked from reservation operations outside assigned branch', async () => {
  const future = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const booking = DiningTableService.createReservation({
    brand_id: BRAND_ID,
    branch_id: BRANCH_B,
    customer: { name: 'API Reservation Lifecycle', phone: '08190000033' },
    reservation_date: future,
    reservation_time: '19:00',
    guest_count: 2
  });
  assert.equal(booking.success, true, JSON.stringify(booking));

  const result = await api('/api/v1/pos/reservations/' + booking.order_id + '/no-show', {});
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'FORBIDDEN_BRANCH_SCOPE');

  db.prepare('DELETE FROM orders WHERE id = ?').run(booking.order_id);
});
