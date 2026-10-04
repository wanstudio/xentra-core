/**
 * Regression: perangkat POS bisa mengambil konteks terminalnya dari server.
 *
 * Masalah yang dikunci: kasir di pos.<domain> tidak bisa memakai PIN kalau
 * perangkat belum punya binding lokal (localStorage bersih, browser/PWA baru,
 * origin/domain baru). POS lalu menampilkan gerbang AKTIVASI sehingga wajib
 * lewat akun manager, padahal terminalnya sudah terdaftar di cabang.
 *
 * Endpoint `GET /pos/terminal/resolve` menjawab tanpa sesi, tetapi hanya kalau
 * brand pada domain itu punya TEPAT SATU terminal aktif — supaya cabangnya tidak
 * ambigu. PIN kasir tetap satu-satunya kredensial.
 *
 * Yang diuji:
 *   PTR-01..03  satu terminal aktif dijawab; nol / lebih dari satu tidak
 *   PTR-04..05  terminal non-aktif & cabang non-aktif diabaikan
 *   PTR-06      tenant isolation: terminal brand lain tidak pernah terjawab
 *   PTR-07      tanpa konteks brand -> 400
 *   PTR-08..09  klien: resolve hanya saat konteks lokal tidak ada, lalu simpan
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const db = require('../server/database/db');
const registerPosRoutes = require('../server/routes/pos');

const POS_JS = fs.readFileSync(path.join(__dirname, '../apps/pos-app/assets/js/pos-app.js'), 'utf8');

function buildApp() {
  const app = express();
  app.use(express.json());
  // Di produksi tenantResolver mengisi req.brand_id dari domain; di sini
  // disimulasikan lewat header supaya isolasi tenant tetap teruji.
  app.use((req, _res, next) => { req.brand_id = req.headers['x-test-brand'] || null; next(); });
  const router = express.Router();
  registerPosRoutes(router, { db, requireAuth: () => (req, _res, next) => next() });
  app.use(router);
  return app;
}

let server;
let baseUrl;

test.before(async () => {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_rsv', 'Org RSV', 'org-rsv')").run();
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_rsv_a', 'org_rsv', 'Brand RSV A', 'brand-rsv-a')").run();
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_rsv_b', 'org_rsv', 'Brand RSV B', 'brand-rsv-b')").run();
  db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES ('branch_rsv_a1', 'brand_rsv_a', 'Cabang A1', 'cabang-a1', 'Jl. A1', -7.25, 112.75)").run();
  db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES ('branch_rsv_a2', 'brand_rsv_a', 'Cabang A2', 'cabang-a2', 'Jl. A2', -7.26, 112.76)").run();
  db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES ('branch_rsv_b1', 'brand_rsv_b', 'Cabang B1', 'cabang-b1', 'Jl. B1', -7.27, 112.77)").run();

  server = buildApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
  if (server) server.close();
});

function resetTerminals() {
  db.prepare('DELETE FROM pos_terminals').run();
}

async function resolve(brandHeader) {
  const res = await fetch(baseUrl + '/pos/terminal/resolve', {
    headers: brandHeader ? { 'x-test-brand': brandHeader } : {}
  });
  return { status: res.status, body: await res.json() };
}

// ── PTR-01..03: jumlah terminal menentukan jawaban ──

test('PTR-01: satu terminal aktif dijawab lengkap dengan cabangnya', async () => {
  resetTerminals();
  db.prepare("INSERT INTO pos_terminals (id, branch_id, device_name, device_identifier, status) VALUES ('term_rsv_1', 'branch_rsv_a1', 'Terminal A1', 'dev-a1', 'active')").run();

  const { status, body } = await resolve('brand_rsv_a');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.reason, 'SINGLE_ACTIVE_TERMINAL');
  assert.strictEqual(body.terminal.id, 'term_rsv_1');
  assert.strictEqual(body.terminal.branch_id, 'branch_rsv_a1');
  assert.strictEqual(body.terminal.branch_name, 'Cabang A1');
});

test('PTR-02: tanpa terminal aktif, klien tetap diarahkan ke aktivasi manager', async () => {
  resetTerminals();
  const { body } = await resolve('brand_rsv_a');
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.terminal, null);
  assert.strictEqual(body.reason, 'NO_ACTIVE_TERMINAL');
});

test('PTR-03: lebih dari satu terminal aktif -> cabang ambigu, jangan ditebak', async () => {
  resetTerminals();
  db.prepare("INSERT INTO pos_terminals (id, branch_id, device_name, device_identifier, status) VALUES ('term_rsv_1', 'branch_rsv_a1', 'Terminal A1', 'dev-a1', 'active')").run();
  db.prepare("INSERT INTO pos_terminals (id, branch_id, device_name, device_identifier, status) VALUES ('term_rsv_2', 'branch_rsv_a2', 'Terminal A2', 'dev-a2', 'active')").run();

  const { body } = await resolve('brand_rsv_a');
  assert.strictEqual(body.terminal, null);
  assert.strictEqual(body.reason, 'MULTIPLE_ACTIVE_TERMINALS');
});

// ── PTR-04..05: status terminal & cabang dihormati ──

test('PTR-04: terminal non-aktif tidak dianggap konteks', async () => {
  resetTerminals();
  db.prepare("INSERT INTO pos_terminals (id, branch_id, device_name, device_identifier, status) VALUES ('term_rsv_off', 'branch_rsv_a1', 'Terminal Off', 'dev-off', 'deactivated')").run();

  const { body } = await resolve('brand_rsv_a');
  assert.strictEqual(body.terminal, null);
  assert.strictEqual(body.reason, 'NO_ACTIVE_TERMINAL');
});

test('PTR-05: cabang non-aktif tidak dipakai sebagai konteks', async () => {
  resetTerminals();
  db.prepare("UPDATE branches SET is_active = 0 WHERE id = 'branch_rsv_a2'").run();
  db.prepare("INSERT INTO pos_terminals (id, branch_id, device_name, device_identifier, status) VALUES ('term_rsv_x', 'branch_rsv_a2', 'Terminal A2', 'dev-a2', 'active')").run();

  const { body } = await resolve('brand_rsv_a');
  assert.strictEqual(body.terminal, null, 'terminal di cabang non-aktif tidak dijawab');

  db.prepare("UPDATE branches SET is_active = 1 WHERE id = 'branch_rsv_a2'").run();
});

// ── PTR-06..07: isolasi tenant ──

test('PTR-06: terminal brand lain tidak pernah terjawab', async () => {
  resetTerminals();
  db.prepare("INSERT INTO pos_terminals (id, branch_id, device_name, device_identifier, status) VALUES ('term_rsv_b1', 'branch_rsv_b1', 'Terminal B1', 'dev-b1', 'active')").run();

  const a = await resolve('brand_rsv_a');
  assert.strictEqual(a.body.terminal, null, 'brand A tidak boleh melihat terminal brand B');

  const b = await resolve('brand_rsv_b');
  assert.strictEqual(b.body.terminal.id, 'term_rsv_b1', 'brand B tetap bisa resolve terminalnya sendiri');
});

test('PTR-07: tanpa konteks brand, permintaan ditolak', async () => {
  const { status, body } = await resolve(null);
  assert.strictEqual(status, 400);
  assert.strictEqual(body.success, false);
});

// ── PTR-08..09: sisi klien ──

test('PTR-08: klien mencoba resolve hanya saat konteks lokal tidak ada & bukan setup eksplisit', () => {
  assert.ok(POS_JS.includes("requestWithTimeout('/pos/terminal/resolve',{},2500)"),
    'klien memanggil endpoint resolve dengan timeout');
  assert.ok(/if\(!hasTerminalContext && !setupRequested\)\{[\s\S]*?resolveTerminalContextFromServer\(\)/.test(POS_JS),
    'resolve hanya dipakai saat konteks lokal kosong dan bukan alur aktivasi eksplisit');
  assert.ok(/hasTerminalContext=await resolveTerminalContextFromServer\(\);/.test(POS_JS));
});

test('PTR-09: konteks hasil resolve disimpan seperti hasil aktivasi', () => {
  assert.ok(POS_JS.includes("localStorage.setItem('xentra_pos_terminal_id',String(state.terminalId))"),
    'terminal id disimpan supaya PIN berikutnya tidak perlu resolve lagi');
  assert.ok(POS_JS.includes("localStorage.setItem('xentra_pos_branch_id',String(state.branchId))"));
  // Gerbang aktivasi tetap jadi fallback ketika server tidak bisa resolve.
  assert.ok(/await openPinUnlockGate\(!navigator\.onLine, !hasTerminalContext \|\| setupRequested\);/.test(POS_JS));
});
