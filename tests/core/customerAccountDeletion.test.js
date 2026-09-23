'use strict';

/**
 * Hapus akun dari sudut pandang CUSTOMER.
 *
 * Yang harus terbukti:
 * 1. Identitas Google (sub), alamat, dan sesi benar-benar lepas.
 * 2. Pesanan TETAP ada, nominal tidak berubah, hanya keterkaitannya yang dilepas.
 * 3. Daftar lagi dengan Google yang SAMA → customer BARU dengan id baru.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.NODE_ENV = 'test';

const app = require('../../server/app');
const db = require('../../server/database/db');
require('../helpers/demoFixtures.js')();
const { CustomerIdentityService } = require('../../core/identity');

const BRAND = 'brand_bangjo';
const ORG = 'org_xentra_holding';
const BRANCH = 'branch_bangjo_barat';
const SUB = 'google-sub-del-test';
const PHONE = '08120000777';

let server;
let baseUrl;
let token;
let customerId;

function api(method, path, body, useToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { Host: 'app.mybangjo.com', 'Content-Type': 'application/json' };
    if (useToken) headers.Authorization = 'Bearer ' + useToken;
    const req = http.request({ method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
}

test('Hapus akun customer: lepas keterkaitan, bukan hapus transaksi', async (t) => {
  t.before(async () => {
    const orgId = (db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(BRAND) || {}).organization_id || ORG;
    customerId = 'cust_del_test';

    db.prepare(`INSERT OR REPLACE INTO customers (id, organization_id, brand_id, display_name, email, phone)
      VALUES (?, ?, ?, 'Rina Uji', 'rina.del@test.local', ?)`).run(customerId, orgId, BRAND, PHONE);
    db.prepare(`INSERT OR REPLACE INTO customer_auth_providers (id, customer_id, provider, provider_user_id)
      VALUES ('cap_del_test', ?, 'google', ?)`).run(customerId, SUB);
    db.prepare(`INSERT OR REPLACE INTO customer_addresses (id, brand_id, customer_id, customer_phone, label, address, latitude, longitude)
      VALUES ('addr_del_test', ?, ?, ?, 'Rumah', 'Jl. Uji 1', -7.2, 112.7)`).run(BRAND, customerId, PHONE);
    // Pesanan: terikat lewat nomor telepon, bukan customer_id. customer_name NOT NULL.
    db.prepare(`INSERT OR REPLACE INTO orders (id, brand_id, branch_id, order_number, order_type, status, customer_name, customer_phone, subtotal, grand_total, created_at, updated_at)
      VALUES ('ord_del_test', ?, ?, 'INV-DEL-1', 'delivery', 'completed', 'Rina Uji', ?, 47646, 47646, datetime('now'), datetime('now'))`).run(BRAND, BRANCH, PHONE);

    await new Promise((resolve) => { server = app.listen(0, resolve); baseUrl = 'http://127.0.0.1:' + server.address().port; });

    token = global.TokenSessionStore.createCustomerSession(PHONE, BRAND, 3600, {
      customerId, organizationId: orgId
    }).token;
  });

  t.after(async () => {
    if (server) await new Promise((r) => server.close(r));
    db.prepare("DELETE FROM customer_auth_providers WHERE customer_id = ?").run(customerId);
    db.prepare("DELETE FROM customer_addresses WHERE customer_phone = ?").run(PHONE);
    db.prepare("DELETE FROM orders WHERE id = 'ord_del_test'").run();
    db.prepare("DELETE FROM customers WHERE id = ?").run(customerId);
  });

  await t.test('tanpa konfirmasi eksplisit ditolak', async () => {
    const res = await api('DELETE', '/api/v1/customer/account?confirm=salah', undefined, token);
    assert.equal(res.status, 400, 'harus minta konfirmasi');
    assert.equal(res.body.error, 'KONFIRMASI_DIPERLUKAN');
    assert.ok(db.prepare('SELECT id FROM customer_auth_providers WHERE customer_id = ?').get(customerId),
      'akun tidak boleh tersentuh saat konfirmasi kurang');
  });

  await t.test('hapus akun: identitas, alamat, dan sesi benar-benar lepas', async () => {
    const res = await api('DELETE', '/api/v1/customer/account?confirm=HAPUS', undefined, token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deleted, true);

    assert.ok(!db.prepare('SELECT id FROM customer_auth_providers WHERE customer_id = ?').get(customerId),
      'identitas Google harus hilang');
    assert.ok(!db.prepare('SELECT id FROM customer_addresses WHERE customer_phone = ?').get(PHONE),
      'alamat harus hilang, bukan tertinggal tanpa pemilik');

    const row = db.prepare('SELECT display_name, email, phone, deleted_at FROM customers WHERE id = ?').get(customerId);
    assert.equal(row.phone, null, 'nomor di baris customer harus dikosongkan');
    assert.equal(row.email, null, 'email di baris customer harus dikosongkan');
    assert.ok(row.deleted_at, 'baris harus ditandai terhapus');

    // sesi lama tidak boleh dipakai lagi
    const after = await api('GET', '/api/v1/customer/profile', undefined, token);
    assert.equal(after.status, 401, 'sesi lama harus langsung tidak berlaku');
  });

  await t.test('pesanan tetap ada, nominal tidak berubah, keterkaitan dilepas', () => {
    const ord = db.prepare("SELECT customer_phone, customer_name, grand_total, status FROM orders WHERE id = 'ord_del_test'").get();
    assert.ok(ord, 'pesanan TIDAK boleh ikut terhapus — itu catatan transaksi resto');
    assert.equal(Number(ord.grand_total), 47646, 'nominal tidak boleh berubah');
    assert.equal(ord.status, 'completed', 'status tidak boleh berubah');
    assert.notEqual(ord.customer_phone, PHONE, 'nomor tamu tidak boleh menempel lagi');
    assert.notEqual(ord.customer_name, 'Rina Uji', 'nama tamu juga PII — harus ikut dilepas');
  });

  await t.test('daftar lagi dengan Google yang SAMA → akun BARU, bukan tersambung', () => {
    const svc = new CustomerIdentityService();
    const again = svc.findOrCreateFromGoogle({
      brand_id: BRAND, organization_id: ORG, sub: SUB, email: 'rina.del@test.local', name: 'Rina Uji'
    });
    assert.ok(again && again.customer, 'harus menghasilkan customer');
    assert.notEqual(again.customer.id, customerId,
      'harus customer BARU dengan id baru — data akun lama tidak boleh tersambung kembali');
    assert.equal(again.created !== false, true, 'harus benar-benar dibuat, bukan ditemukan');
    db.prepare('DELETE FROM customer_auth_providers WHERE customer_id = ?').run(again.customer.id);
    db.prepare('DELETE FROM customers WHERE id = ?').run(again.customer.id);
  });
});
