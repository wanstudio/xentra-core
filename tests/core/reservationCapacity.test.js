'use strict';

/**
 * Kapasitas maksimal reservasi — diisi MANUAL per cabang.
 *
 * Reservasi tidak dihitung dari denah meja (meja berbeda-beda: 2/4/12 orang),
 * melainkan ditetapkan manager cabang. 0 berarti belum diisi/dikosongkan.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.NODE_ENV = 'test';

const app = require('../../server/app');
const db = require('../../server/database/db');
require('../helpers/demoFixtures.js')();

const BRANCH = 'branch_bangjo_barat';
const TOKEN = 'rescap_owner_token';

let server;
let baseUrl;

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { Host: 'app.mybangjo.com', Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
    const req = http.request({ method, hostname: url.hostname, port: url.port, path: url.pathname, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
}

function storedCapacity() {
  const row = db.prepare('SELECT reservation_max_guests FROM branches WHERE id = ?').get(BRANCH);
  return row ? row.reservation_max_guests : undefined;
}

test('Kapasitas reservasi: diisi manual per cabang', async (t) => {
  t.before(async () => {
    db.prepare(
      `INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, full_name, role, status, created_at, updated_at)
       VALUES ('urescap', 'brand_bangjo', NULL, ?, 'urescap', 'rescap@test.local', 'Rescap Owner', 'owner', 'active', datetime('now'), datetime('now'))`
    ).run(BRANCH);
    await new Promise((resolve) => { server = app.listen(0, resolve); baseUrl = 'http://127.0.0.1:' + server.address().port; });
    global.TokenSessionStore.sessions.set(TOKEN, {
      type: 'staff', role: 'owner', brandId: 'brand_bangjo', brand_id: 'brand_bangjo',
      organizationId: null, organization_id: null, userId: 'urescap', username: 'urescap',
      email_verified: true, expiresAt: Date.now() + 3600000
    });
  });

  t.after(async () => {
    if (server) await new Promise((r) => server.close(r));
    db.prepare('DELETE FROM users WHERE id = ?').run('urescap');
  });

  await t.test('belum diisi: kosong (bukan angka karangan)', () => {
    assert.ok(storedCapacity() === null || storedCapacity() === undefined,
      'sebelum diisi harus kosong, bukan angka bawaan');
  });

  await t.test('manager menyimpan kapasitas; tersimpan dan terbaca kembali', async () => {
    const put = await api('PUT', '/api/v1/admin/branches/' + BRANCH, { reservation_max_guests: 40 });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(storedCapacity(), 40, 'kapasitas harus tersimpan');

    // dibaca oleh aplikasi konsumen lewat daftar cabang
    const list = await api('GET', '/api/v1/brand/branches');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const branch = (list.body.branches || []).find((b) => b.id === BRANCH);
    assert.ok(branch, 'cabang harus ada di daftar');
    assert.equal(branch.reservation_max_guests, 40, 'nilai harus ikut pada daftar cabang');
  });

  await t.test('0 = dikosongkan lagi (reservasi mati)', async () => {
    const put = await api('PUT', '/api/v1/admin/branches/' + BRANCH, { reservation_max_guests: 0 });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(storedCapacity(), 0, '0 harus tersimpan sebagai "belum diisi"');
  });

  await t.test('angka tidak masuk akal ditolak', async () => {
    for (const bad of [-1, 5000, 'abc', 2.5]) {
      const res = await api('PUT', '/api/v1/admin/branches/' + BRANCH, { reservation_max_guests: bad });
      assert.equal(res.status, 400, ('harus ditolak: ' + JSON.stringify(bad)));
    }
    assert.equal(storedCapacity(), 0, 'nilai lama tidak boleh berubah saat input ditolak');
  });

  await t.test('field lain tidak ikut berubah', async () => {
    const before = db.prepare('SELECT name, timezone FROM branches WHERE id = ?').get(BRANCH);
    await api('PUT', '/api/v1/admin/branches/' + BRANCH, { reservation_max_guests: 25 });
    const after = db.prepare('SELECT name, timezone FROM branches WHERE id = ?').get(BRANCH);
    assert.deepEqual(after, before, 'mengubah kapasitas tidak boleh menyentuh kolom lain');
  });
});
