'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../../server/database/db');
const { DiningTableService } = require('../../domains/dining');
const OrderPlacementService = require('../../domains/commerce/services/OrderPlacementService');
const PosOrderService = require('../../domains/pos/services/PosOrderService');

const BRAND_ID = 'brand_bangjo';
const BRANCH_ID = 'branch_bangjo_barat';
const TABLE_ID = 'tbl_anon_4';
const TABLE_TOKEN = 'qr_token_anon_meja_4';
const CUST_PHONE = '081299998888';
const ATTACKER_PHONE = '08777777777';

test.before(() => {
  require('../helpers/demoFixtures.js')();
  db.prepare(`INSERT OR REPLACE INTO branch_tables (id, branch_id, table_number, label, capacity, qr_token, is_active) VALUES (?, ?, '4', 'Meja 4', 4, ?, 1)`).run(TABLE_ID, BRANCH_ID, TABLE_TOKEN);
  db.prepare(`INSERT OR REPLACE INTO branch_table_states (table_id, operational_state, current_session_id) VALUES (?, 'available', NULL)`).run(TABLE_ID);
});

test('Real-life flow: Kasir POS creates dine-in order without phone -> Customer scans QR -> Customer registers & adds order smoothly', async () => {
  db.prepare(`UPDATE branch_table_states SET operational_state = 'available', current_session_id = NULL WHERE table_id = ?`).run(TABLE_ID);
  db.prepare(`UPDATE branch_table_holds SET status = 'released' WHERE table_id = ?`).run(TABLE_ID);

  // Step 1: Cashier creates order at POS with "bayar belakangan" (hold) without customer phone
  const held = PosOrderService.holdOrder({
    branch_id: BRANCH_ID,
    table_number: '4',
    customer_name: 'Tamu Meja 4',
    customer_phone: '', // Cashier does NOT ask for phone number!
    order_type: 'dine_in',
    items: [{ menu_id: 'demo_bangjo_menu_272', quantity: 2, unit_price: 25000 }]
  });

  assert.ok(held.id, 'Held order must have an id');

  const mat = await PosOrderService.materializeHeldOrder({
    held_order_id: held.id,
    brand_id: BRAND_ID
  });

  assert.ok(mat.order && mat.order.id, 'Materialized order must have an id');

  // Order is accepted / started: table becomes occupied with dining session
  const sessionRes = DiningTableService.createOrAttachDiningSession({
    branch_id: BRANCH_ID,
    table_ids: [TABLE_ID],
    order_id: mat.order.id,
    customer_name: 'Tamu Meja 4',
    customer_phone: '',
    channel: 'pos_cashier',
    hold_reference_id: mat.order.id
  });
  assert.ok(sessionRes.session_id);

  // Verify table state is occupied and has active session with empty phone
  const tableState = db.prepare('SELECT operational_state, current_session_id FROM branch_table_states WHERE table_id = ?').get(TABLE_ID);
  assert.equal(tableState.operational_state, 'occupied');
  assert.ok(tableState.current_session_id);

  const initialSession = db.prepare('SELECT id, status, customer_phone FROM dining_sessions WHERE id = ?').get(tableState.current_session_id);
  assert.equal(initialSession.status, 'active');
  assert.equal(initialSession.customer_phone, '');

  // Step 2: Customer sits at Meja 4, scans table QR token.
  // Validate table checkout validation for Customer with phone CUST_PHONE
  const checkoutValidation = DiningTableService.prepareDineInOrderContext({
    branch_id: BRANCH_ID,
    table_ids: [TABLE_ID],
    customer_phone: CUST_PHONE,
    order_channel: 'customer_app'
  });

  assert.equal(checkoutValidation.valid, true, 'Checkout dine-in validation must succeed for customer at occupied table with empty phone');
  assert.equal(checkoutValidation.dining_session_id, initialSession.id, 'Must attach to the active session created by cashier');

  // Step 3: Customer places an add-on order from customer PWA
  const custOrderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_ID,
    customer: { name: 'Budi Santoso', phone: CUST_PHONE },
    items: [{ menu_id: 'demo_bangjo_menu_272', quantity: 1, expected_price: 25000 }],
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_ids: [TABLE_ID],
    dining_session_id: checkoutValidation.dining_session_id
  });

  assert.equal(custOrderRes.success, true, 'Customer order submission must succeed');
  assert.equal(custOrderRes.order.dining_session_id, initialSession.id, 'Customer order must attach to the same session');

  // Step 4: Verify the dining session now has the customer phone bound to it
  const updatedSession = db.prepare('SELECT id, status, customer_phone, customer_name FROM dining_sessions WHERE id = ?').get(initialSession.id);
  assert.equal(updatedSession.customer_phone, CUST_PHONE, 'Customer phone must now be bound to session');
  assert.equal(updatedSession.customer_name, 'Budi Santoso', 'Customer name must be updated');

  // Step 5: Security check: Another customer (Attacker B) attempts to order on Table 4
  const attackerOrderRes = await OrderPlacementService.submitOrder({
    brand_id: BRAND_ID,
    branch_id: BRANCH_ID,
    customer: { name: 'Attacker B', phone: ATTACKER_PHONE },
    items: [{ menu_id: 'demo_bangjo_menu_272', quantity: 1, expected_price: 25000 }],
    payment_method: 'cash',
    order_type: 'dine_in',
    order_channel: 'customer_app',
    table_ids: [TABLE_ID]
  });

  assert.equal(attackerOrderRes.success, false, 'Attacker must be rejected');
  assert.equal(attackerOrderRes.status, 'TABLE_ALREADY_OCCUPIED', 'Attacker gets TABLE_ALREADY_OCCUPIED');

  // Step 6: Close dining session cleanly
  DiningTableService.completeDiningSession(initialSession.id, 'staff', { force: true });
  const finalState = db.prepare('SELECT operational_state, current_session_id FROM branch_table_states WHERE table_id = ?').get(TABLE_ID);
  assert.equal(finalState.operational_state, 'available');
});

test('E2E HTTP Flow: Cashier creates Hold Bill -> Guest scans QR -> Registers -> Sees bill -> Adds items -> Settles at POS', async () => {
  const http = require('node:http');
  const app = require('../../server/app');
  let server;
  let baseUrl;

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
    baseUrl = 'http://127.0.0.1:' + server.address().port;
  });

  function api(method, path, token, body, role = 'customer') {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const headers = { Host: 'app.mybangjo.com' };
      if (token) {
        headers.Authorization = 'Bearer ' + token;
        if (role === 'customer') headers['x-customer-token'] = token;
        else headers['x-auth-token'] = token;
      }
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const req = http.request({ method, hostname: url.hostname, port: url.port, path: url.pathname, headers }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      });
      req.on('error', reject);
      req.end(body !== undefined ? JSON.stringify(body) : undefined);
    });
  }

  try {
    // 1. Ensure Table 4 is available
    db.prepare(`UPDATE branch_table_states SET operational_state = 'available', current_session_id = NULL WHERE table_id = ?`).run(TABLE_ID);
    db.prepare(`UPDATE branch_table_holds SET status = 'released' WHERE table_id = ?`).run(TABLE_ID);

    // 2. Cashier holds order at POS (Bayar Belakangan) without phone number
    const held = PosOrderService.holdOrder({
      branch_id: BRANCH_ID,
      table_number: '4',
      customer_name: 'Tamu Meja 4',
      customer_phone: '',
      order_type: 'dine_in',
      items: [{ menu_id: 'demo_bangjo_menu_272', quantity: 2, unit_price: 25000 }]
    });
    const materialized = await PosOrderService.materializeHeldOrder({
      held_order_id: held.id,
      brand_id: BRAND_ID
    });
    const orderId = materialized.order_id;
    assert.ok(orderId);

    // Verify table is held
    const heldState = db.prepare('SELECT operational_state FROM branch_table_states WHERE table_id = ?').get(TABLE_ID);
    assert.equal(heldState.operational_state, 'held');

    const unauthClaim = await api('POST', '/api/v1/customer/dining-session/claim', null, {
      qr_token: TABLE_TOKEN,
      branch_id: BRANCH_ID
    });
    assert.equal(unauthClaim.status, 200);
    assert.equal(unauthClaim.body.success, true);
    assert.equal(unauthClaim.body.table.table_number, '4');

    // After scan, the held order is activated into a dining session
    const occState = db.prepare('SELECT operational_state, current_session_id FROM branch_table_states WHERE table_id = ?').get(TABLE_ID);
    assert.equal(occState.operational_state, 'occupied');
    const diningSessionId = occState.current_session_id;
    assert.ok(diningSessionId);

    // 4. Customer registers / logs in with phone
    const brand = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(BRAND_ID);
    const orgId = brand ? brand.organization_id : null;
    const custId = 'cst_anon_' + Date.now();
    db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
      .run(custId, orgId, BRAND_ID, CUST_PHONE, 'Budi Tamu', 'budi.tamu@test.local');

    const Store = global.TokenSessionStore;
    const custToken = Store.createCustomerSession(CUST_PHONE, BRAND_ID, 3600, { customerId: custId, organizationId: orgId }).token;

    // 5. Customer app calls claim with authenticated token (triggered by Store.subscribe)
    const authClaim = await api('POST', '/api/v1/customer/dining-session/claim', custToken, {
      qr_token: TABLE_TOKEN,
      branch_id: BRANCH_ID
    });
    assert.equal(authClaim.status, 200);
    assert.equal(authClaim.body.success, true);

    // Verify session & order are now bound to CUST_PHONE
    const boundSession = db.prepare('SELECT customer_phone FROM dining_sessions WHERE id = ?').get(diningSessionId);
    assert.equal(boundSession.customer_phone, CUST_PHONE);
    const boundOrder = db.prepare('SELECT customer_phone FROM orders WHERE id = ?').get(orderId);
    assert.equal(boundOrder.customer_phone, CUST_PHONE);

    // 6. Customer fetches open bill
    const billRes = await api('GET', '/api/v1/customer/dining-session', custToken);
    assert.equal(billRes.status, 200);
    assert.ok(billRes.body.session);
    assert.equal(billRes.body.session.session_id, diningSessionId);
    assert.equal(Number(billRes.body.session.total_bill), 50000);

    // 7. Customer submits addition items from phone
    const additionRes = await api('POST', '/api/v1/customer/dining-session/additions', custToken, {
      order_id: orderId,
      items: [{ menu_id: 'demo_bangjo_menu_272', quantity: 1, expected_price: 25000 }]
    });
    assert.equal(additionRes.status, 201);
    assert.equal(additionRes.body.success, true);

    // 8. Cashier user for POS settlement
    const cashierId = 'csh_anon_' + Date.now();
    db.prepare('INSERT OR REPLACE INTO users (id, brand_id, branch_id, username, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run(cashierId, BRAND_ID, BRANCH_ID, 'kasir_anon', 'hash', 'cashier');
    const cashierUser = { id: cashierId, role: 'cashier', brand_id: BRAND_ID, branch_id: BRANCH_ID };
    const cashierToken = Store.createSession(cashierUser, BRAND_ID).token;

    // Cashier opens shift
    const shiftId = 'shift_anon_' + Date.now();
    db.prepare(`INSERT INTO pos_shifts (id, branch_id, cashier_id, starting_float, status, opened_at) VALUES (?, ?, ?, 100000, 'open', datetime('now'))`)
      .run(shiftId, BRANCH_ID, cashierId);

    // 8b. Branch Manager accepts the dine-in order
    const managerId = 'mgr_anon_' + Date.now();
    db.prepare('INSERT OR REPLACE INTO users (id, brand_id, branch_id, username, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run(managerId, BRAND_ID, BRANCH_ID, 'mgr_anon', 'hash', 'branch_manager');
    const managerUser = { id: managerId, role: 'branch_manager', brand_id: BRAND_ID, branch_id: BRANCH_ID };
    const managerToken = Store.createSession(managerUser, BRAND_ID).token;

    const acceptRes = await api('POST', `/api/v1/orders/${orderId}/branch-acceptance`, managerToken, {
      decision: 'accept'
    }, 'manager');
    assert.equal(acceptRes.status, 200);

    // 9. Cashier settles cash payment at POS
    const settleRes = await api('POST', `/api/v1/pos/orders/${orderId}/settle-cash`, cashierToken, {
      amount_tendered: 100000,
      shift_id: shiftId
    }, 'cashier');
    assert.equal(settleRes.status, 200);
    assert.equal(settleRes.body.success, true);

    // 10. Cashier releases table
    const releaseRes = await api('POST', `/api/v1/dine-in/tables/${TABLE_ID}/release`, cashierToken, {}, 'cashier');
    assert.equal(releaseRes.status, 200);
    assert.equal(releaseRes.body.success, true);

    // 11. Customer checks dining session after release: returns null!
    const afterReleaseBill = await api('GET', '/api/v1/customer/dining-session', custToken);
    assert.equal(afterReleaseBill.status, 200);
    assert.equal(afterReleaseBill.body.session, null, 'Dining session is now completed and destroyed');

    // Table 4 is back to available
    const tableStateFinal = db.prepare('SELECT operational_state, current_session_id FROM branch_table_states WHERE table_id = ?').get(TABLE_ID);
    assert.equal(tableStateFinal.operational_state, 'available');
    assert.equal(tableStateFinal.current_session_id, null);
  } finally {
    if (server) await new Promise((r) => server.close(r));
  }
});

