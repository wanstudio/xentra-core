'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const db = require('../../server/database/db');
const { DiningTableService } = require('../../domains/dining');

const BRAND_ID = 'brand_bangjo';
const BRANCH_ID = 'branch_bangjo_barat';
const TABLE_ID = 'tbl_anon_4';
const TABLE_TOKEN = 'qr_token_anon_meja_4';
const CUSTOMERS = [
  { id: 'cst_dine_shared_a', phone: '081299998888', name: 'Budi' },
  { id: 'cst_dine_shared_b', phone: '081299997777', name: 'Sari' },
  { id: 'cst_dine_shared_outsider', phone: '08777777777', name: 'Tamu Luar' }
];

let server;
let baseUrl;
let tokens;
const openedSessions = [];

function resetTable() {
  db.prepare("UPDATE branch_table_states SET operational_state = 'available', current_session_id = NULL WHERE table_id = ?").run(TABLE_ID);
  db.prepare("UPDATE branch_table_holds SET status = 'released' WHERE table_id = ?").run(TABLE_ID);
}

function api(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { Host: 'app.mybangjo.com' };
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['x-customer-token'] = token;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = http.request({ method, hostname: url.hostname, port: url.port, path: url.pathname, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
}

function checkoutPayload(sessionId, customer) {
  return {
    branch_id: BRANCH_ID,
    customer: { name: customer.name },
    order_type: 'dine_in',
    table_ids: [TABLE_ID],
    dining_session_id: sessionId,
    items: [{ menu_id: 'demo_bangjo_menu_272', quantity: 1, expected_price: 25000 }],
    payment_method: 'cash'
  };
}

test.before(async () => {
  require('../helpers/demoFixtures.js')();
  db.prepare(`INSERT OR REPLACE INTO branch_tables (id, branch_id, table_number, label, capacity, qr_token, is_active)
    VALUES (?, ?, '4', 'Meja 4', 4, ?, 1)`).run(TABLE_ID, BRANCH_ID, TABLE_TOKEN);
  db.prepare(`INSERT INTO branch_table_states (table_id, operational_state, current_session_id)
    VALUES (?, 'available', NULL)
    ON CONFLICT(table_id) DO UPDATE SET operational_state = 'available', current_session_id = NULL`).run(TABLE_ID);

  const brand = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(BRAND_ID);
  const orgId = brand ? brand.organization_id : null;
  for (const customer of CUSTOMERS) {
    db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
      .run(customer.id, orgId, BRAND_ID, customer.phone, customer.name, customer.id + '@test.local');
  }

  const app = require('../../server/app');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
    baseUrl = 'http://127.0.0.1:' + server.address().port;
  });
  tokens = Object.fromEntries(CUSTOMERS.map((customer) => [
    customer.id,
    global.TokenSessionStore.createCustomerSession(customer.phone, BRAND_ID, 3600, {
      customerId: customer.id,
      organizationId: orgId,
      name: customer.name
    }).token
  ]));
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const sessionId of new Set(openedSessions)) {
    db.prepare('DELETE FROM dining_session_tables WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM dining_sessions WHERE id = ?').run(sessionId);
  }
  db.prepare('DELETE FROM branch_table_states WHERE table_id = ?').run(TABLE_ID);
  db.prepare('DELETE FROM branch_tables WHERE id = ?').run(TABLE_ID);
  db.prepare('DELETE FROM customers WHERE id IN (?, ?, ?)').run(...CUSTOMERS.map((customer) => customer.id));
});

test('POS opens an empty table cycle; multiple joined customers submit into one shared order', async () => {
  resetTable();

  const opened = DiningTableService.openTableSession({ branch_id: BRANCH_ID, table_id: TABLE_ID, actor_id: 'cashier-test' });
  openedSessions.push(opened.session_id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders WHERE dining_session_id = ?').get(opened.session_id).n, 0,
    'the POS-opened cycle exists before any order');

  const guestA = await api('POST', '/api/v1/customer/dining-session/claim', tokens[CUSTOMERS[0].id], { qr_token: TABLE_TOKEN });
  const guestB = await api('POST', '/api/v1/customer/dining-session/claim', tokens[CUSTOMERS[1].id], { qr_token: TABLE_TOKEN });
  assert.equal(guestA.status, 200, JSON.stringify(guestA.body));
  assert.equal(guestB.status, 200, JSON.stringify(guestB.body));
  assert.equal(guestA.body.session.session_id, opened.session_id);
  assert.equal(guestB.body.session.session_id, opened.session_id);

  const repeat = await api('POST', '/api/v1/customer/dining-session/claim', tokens[CUSTOMERS[0].id], { qr_token: TABLE_TOKEN });
  assert.equal(repeat.status, 200, JSON.stringify(repeat.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dining_session_members WHERE session_id = ? AND customer_id = ?')
    .get(opened.session_id, CUSTOMERS[0].id).n, 1, 'repeat scans do not duplicate membership');

  const outsider = await api('POST', '/api/v1/checkout/create-order', tokens[CUSTOMERS[2].id], checkoutPayload(opened.session_id, CUSTOMERS[2]));
  assert.equal(outsider.status, 403, JSON.stringify(outsider.body));
  assert.equal(outsider.body.status, 'UNAUTHORIZED_SESSION_ACCESS');

  const first = await api('POST', '/api/v1/checkout/create-order', tokens[CUSTOMERS[0].id], checkoutPayload(opened.session_id, CUSTOMERS[0]));
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.success, true);
  const canonicalOrderId = first.body.order_id;

  const second = await api('POST', '/api/v1/checkout/create-order', tokens[CUSTOMERS[1].id], checkoutPayload(opened.session_id, CUSTOMERS[1]));
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.order_id, canonicalOrderId, 'second customer adds to the canonical order');
  assert.equal(second.body.batch_pending, true);

  const orders = db.prepare('SELECT id FROM orders WHERE dining_session_id = ?').all(opened.session_id);
  assert.deepEqual(orders.map((order) => order.id), [canonicalOrderId], 'one table cycle has exactly one parent order');
  const batches = db.prepare('SELECT created_by FROM order_addition_batches WHERE order_id = ? ORDER BY sequence_no').all(canonicalOrderId);
  assert.equal(batches.length, 1, 'the second customer submission is a distinct attributed batch');
  assert.equal(batches[0].created_by, CUSTOMERS[1].id);

  // Simulate the accepted second batch increasing the canonical total after
  // the first customer's original online payment amount was captured.
  db.prepare('UPDATE orders SET subtotal = 50000, grand_total = 50000 WHERE id = ?').run(canonicalOrderId);
  db.prepare(`UPDATE order_payments SET provider = 'midtrans', payment_method = 'midtrans',
    payment_status = 'settlement', amount = 25000 WHERE order_id = ?`).run(canonicalOrderId);

  const sharedBillA = await api('GET', '/api/v1/customer/dining-session', tokens[CUSTOMERS[0].id]);
  const sharedBillB = await api('GET', '/api/v1/customer/dining-session', tokens[CUSTOMERS[1].id]);
  assert.equal(sharedBillA.body.session.session_id, opened.session_id);
  assert.equal(sharedBillB.body.session.session_id, opened.session_id);
  assert.equal(Object.hasOwn(sharedBillB.body.session, 'customer_name'), false,
    'shared bill response does not disclose the primary customer name');
  assert.equal(sharedBillA.body.session.my_submissions.length, 1);
  assert.equal(sharedBillA.body.session.my_submissions[0].items[0].name, 'Nasi Goreng',
    'a member sees their own items');
  assert.equal(sharedBillA.body.session.total_bill, 50000);
  assert.equal(sharedBillA.body.session.outstanding_total, 25000,
    'the original online settlement reduces the updated shared balance without treating new additions as paid');
  assert.equal(sharedBillA.body.session.orders[0].outstanding_amount, 25000);
  assert.equal(sharedBillB.body.session.my_submissions.length, 1);
  assert.equal(sharedBillB.body.session.my_submissions[0].status, 'pending_acceptance');
  assert.equal(sharedBillB.body.session.my_submissions[0].items[0].name, 'Nasi Goreng',
    'a member sees their own pending batch');

  DiningTableService.completeDiningSession(opened.session_id, 'cashier-test', { force: true });
  assert.equal(db.prepare('SELECT operational_state FROM branch_table_states WHERE table_id = ?').get(TABLE_ID).operational_state, 'available');
});
