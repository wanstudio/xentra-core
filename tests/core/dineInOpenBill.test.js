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
const http = require('node:http');

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

// ── Pintu konsumen: kembali ke bill yang masih terbuka ─────────────────────
// Fixture mengikuti tests/customerSessionAuth.test.js: requireCustomerAuth()
// mencari customer di DB, jadi baris `customers` wajib ada sebelum sesinya.

const CUST_ID = 'cst_bill_test';
const OTHER_CUST_ID = 'cst_bill_other';
const CUST_PHONE = '08120000009';
const OTHER_PHONE = '08129999999';
const RESUME_TABLE = 'tbl_bill_resume';
const RESUME_QR = 'qr_bill_resume';

let server;
let baseUrl;
let CUST_TOKEN;
let OTHER_TOKEN;

function api(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { Host: 'app.mybangjo.com' };
    if (token) { headers.Authorization = 'Bearer ' + token; headers['x-customer-token'] = token; }
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

test('Konsumen bisa kembali ke bill mejanya yang masih terbuka', async (t) => {
  t.before(async () => {
    seedTable(RESUME_TABLE, '903', RESUME_QR);
    const brand = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get('brand_bangjo');
    const orgId = brand ? brand.organization_id : null;

    db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
      .run(CUST_ID, orgId, 'brand_bangjo', CUST_PHONE, 'Rina', 'rina.bill@test.local');
    db.prepare('INSERT OR REPLACE INTO customers (id, organization_id, brand_id, phone, display_name, email) VALUES (?, ?, ?, ?, ?, ?)')
      .run(OTHER_CUST_ID, orgId, 'brand_bangjo', OTHER_PHONE, 'Budi', 'budi.bill@test.local');

    await new Promise((resolve) => {
      server = require('../../server/app').listen(0, resolve);
      baseUrl = 'http://127.0.0.1:' + server.address().port;
    });

    const Store = global.TokenSessionStore;
    CUST_TOKEN = Store.createCustomerSession(CUST_PHONE, 'brand_bangjo', 3600, { customerId: CUST_ID, organizationId: orgId }).token;
    OTHER_TOKEN = Store.createCustomerSession(OTHER_PHONE, 'brand_bangjo', 3600, { customerId: OTHER_CUST_ID, organizationId: orgId }).token;
  });

  t.after(async () => {
    if (server) await new Promise((r) => server.close(r));
    Array.from(new Set(createdSessions)).forEach((sid) => {
      db.prepare('DELETE FROM dining_session_tables WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM dining_sessions WHERE id = ?').run(sid);
    });
    db.prepare('DELETE FROM branch_table_states WHERE table_id = ?').run(RESUME_TABLE);
    db.prepare('DELETE FROM branch_tables WHERE id = ?').run(RESUME_TABLE);
    db.prepare('DELETE FROM customers WHERE id IN (?, ?)').run(CUST_ID, OTHER_CUST_ID);
  });

  await t.test('tanpa bill terbuka: session null, bukan error', async () => {
    const res = await api('GET', '/api/v1/customer/dining-session', CUST_TOKEN);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.session, null, 'tanpa bill terbuka harus balas null');
  });

  await t.test('setelah pesan di meja: bill-nya ditemukan kembali', async () => {
    const bill = DiningTableService.createOrAttachDiningSession({
      branch_id: BRANCH,
      table_ids: [RESUME_TABLE],
      customer_name: 'Rina',
      customer_phone: CUST_PHONE,
      guest_count: 2
    });
    createdSessions.push(bill.session_id);

    const res = await api('GET', '/api/v1/customer/dining-session', CUST_TOKEN);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.session, 'bill terbuka harus ditemukan');
    assert.equal(res.body.session.session_id, bill.session_id, 'harus bill yang benar');
    assert.deepEqual(res.body.session.tables.map((x) => x.id), [RESUME_TABLE], 'harus menyertakan mejanya');
    assert.deepEqual(res.body.session.orders, [], 'bill tanpa order belum punya item');
    assert.equal(res.body.session.total_bill, 0);
  });

  await t.test('konsumen lain tidak boleh melihat bill itu', async () => {
    const mine = await api('GET', '/api/v1/customer/dining-session', CUST_TOKEN);
    assert.ok(mine.body.session, 'pemilik bill harus tetap menemukannya');

    const other = await api('GET', '/api/v1/customer/dining-session', OTHER_TOKEN);
    assert.equal(other.body.session, null, 'bill konsumen lain tidak boleh terbaca');
  });

  await t.test('QR meja menyambungkan kembali ke bill (kasus ganti HP)', async () => {
    const noToken = await api('POST', '/api/v1/customer/dining-session/claim', CUST_TOKEN, {});
    assert.equal(noToken.status, 400, 'tanpa qr_token harus ditolak');

    const bogus = await api('POST', '/api/v1/customer/dining-session/claim', CUST_TOKEN, { qr_token: 'qr_tidak_ada' });
    assert.equal(bogus.status, 404, 'QR palsu harus ditolak');

    const res = await api('POST', '/api/v1/customer/dining-session/claim', OTHER_TOKEN, { qr_token: RESUME_QR });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.session && res.body.session.session_id, 'QR harus membuka bill meja itu');
    assert.equal(res.body.table_id, RESUME_TABLE);
    assert.equal(res.body.table.table_number, '903', 'QR harus membawa identitas mejanya');
  });

  await t.test('scan meja yang belum ada billnya: mejanya tetap dikenali', async () => {
    // Meja kosong: tidak ada yang bisa dilanjutkan, TAPI konsumen tidak boleh
    // diminta memilih meja lagi — mejanya sudah ada di QR.
    const empty = await api('POST', '/api/v1/customer/dining-session/claim', CUST_TOKEN, { qr_token: 'qr_bill_resume_belum_dipakai' });
    assert.equal(empty.status, 404, 'QR tak dikenal tetap ditolak');

    seedTable('tbl_bill_kosong', '905', 'qr_bill_kosong');
    const res = await api('POST', '/api/v1/customer/dining-session/claim', CUST_TOKEN, { qr_token: 'qr_bill_kosong' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.session, null, 'meja kosong belum punya bill');
    assert.equal(res.body.table.id, 'tbl_bill_kosong');
    assert.equal(res.body.table.table_number, '905');

    db.prepare('DELETE FROM branch_table_states WHERE table_id = ?').run('tbl_bill_kosong');
    db.prepare('DELETE FROM branch_tables WHERE id = ?').run('tbl_bill_kosong');
  });
});

// ── Kemampuan membuat QR meja (siap dicetak / dibagikan) ───────────────────

const STAFF_TOKEN = 'qr_staff_test';
const QR_TABLE = 'tbl_qr_test';
const QR_TABLE_TOKEN = 'qr_token_meja_uji';

test('Staf bisa membuat QR meja', async (t) => {
  t.before(async () => {
    seedTable(QR_TABLE, '904', QR_TABLE_TOKEN);
    db.prepare(
      `INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, full_name, role, status, created_at, updated_at)
       VALUES (?, 'brand_bangjo', NULL, ?, ?, ?, 'QR Staff', 'branch_manager', 'active', datetime('now'), datetime('now'))`
    ).run('uqr_staff', BRANCH, 'uqr_staff', 'uqr_staff@test.local');

    await new Promise((resolve) => {
      server = require('../../server/app').listen(0, resolve);
      baseUrl = 'http://127.0.0.1:' + server.address().port;
    });

    global.TokenSessionStore.sessions.set(STAFF_TOKEN, {
      type: 'staff',
      role: 'branch_manager',
      brandId: 'brand_bangjo',
      brand_id: 'brand_bangjo',
      branchId: BRANCH,
      branch_id: BRANCH,
      userId: 'uqr_staff',
      username: 'uqr_staff',
      email_verified: true,
      expiresAt: Date.now() + 3600000
    });
  });

  t.after(async () => {
    if (server) await new Promise((r) => server.close(r));
    db.prepare('DELETE FROM users WHERE id = ?').run('uqr_staff');
    db.prepare('DELETE FROM branch_table_states WHERE table_id = ?').run(QR_TABLE);
    db.prepare('DELETE FROM branch_tables WHERE id = ?').run(QR_TABLE);
  });

  await t.test('tanpa login: ditolak', async () => {
    const res = await api('GET', '/api/v1/dine-in/tables/' + QR_TABLE + '/qr');
    assert.equal(res.status, 401, 'QR meja tidak boleh bisa dienumerasi publik');
  });

  await t.test('meja tidak dikenal: 404', async () => {
    const res = await api('GET', '/api/v1/dine-in/tables/tbl_tidak_ada/qr', STAFF_TOKEN);
    assert.equal(res.status, 404);
  });

  await t.test('QR berisi URL gabung + token mejanya', async () => {
    const res = await api('GET', '/api/v1/dine-in/tables/' + QR_TABLE + '/qr', STAFF_TOKEN);
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    assert.ok(res.body.svg.indexOf('<svg') !== -1, 'harus ada gambar SVG-nya');
    assert.ok(res.body.join_url.indexOf('/join?meja=') !== -1, 'isinya URL gabung, bukan token mentah');
    assert.ok(res.body.join_url.indexOf(QR_TABLE_TOKEN) !== -1, 'URL harus membawa token meja itu');
    assert.equal(res.body.table.table_number, '904');
  });

  await t.test('tautan /join menyajikan PWA konsumen (bukan 404)', async () => {
    // Responsnya halaman, bukan JSON — jadi dibaca mentah.
    const res = await new Promise((resolve, reject) => {
      const url = new URL('/join?meja=' + QR_TABLE_TOKEN, baseUrl);
      const req = http.request({ method: 'GET', hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { Host: 'app.mybangjo.com' } },
        (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => resolve({ status: r.statusCode, body: d })); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.status, 200, 'tautan QR harus mendarat di halaman, bukan 404');
    assert.ok(/<html|<!doctype/i.test(res.body), 'tautan QR harus menyajikan PWA konsumen');
  });

  await t.test('melihat QR lagi TIDAK mematikan QR yang sudah ditempel', async () => {
    const a = await api('GET', '/api/v1/dine-in/tables/' + QR_TABLE + '/qr', STAFF_TOKEN);
    const b = await api('GET', '/api/v1/dine-in/tables/' + QR_TABLE + '/qr', STAFF_TOKEN);
    assert.equal(a.body.join_url, b.body.join_url, 'URL harus sama, tidak dirotasi diam-diam');
    const row = db.prepare('SELECT qr_token FROM branch_tables WHERE id = ?').get(QR_TABLE);
    assert.equal(row.qr_token, QR_TABLE_TOKEN, 'token tersimpan harus tetap sama');
  });
});
