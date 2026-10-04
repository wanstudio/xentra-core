/**
 * Regression: alur Product Editor canonical (create/open/edit/save/archive).
 *
 * Bug produksi yang dikunci: membuka Editor Product memanggil
 * `GET /api/v1/admin/composed/products/:id` — route itu TIDAK ADA di contract
 * composed (hanya LIST, POST, PUT :id, PATCH :id/status), sehingga produksi
 * membalas 404 `ENDPOINT_NOT_FOUND` dan Product tidak bisa diedit.
 *
 * Test ini benar-benar memanggil route-nya (express + DB), bukan string search:
 *   CPR-01..03  create -> edit mempertahankan identitas Product yang sama
 *   CPR-04      archive/nonaktifkan lalu aktifkan kembali
 *   CPR-05      contract guard: GET by-id memang tidak ada (404 ENDPOINT_NOT_FOUND)
 *   CPR-06..07  id asing / brand lain tidak menulis apa pun
 *   CPR-08      editor memakai LIST canonical, bukan by-id / legacy
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const db = require('../server/database/db');
const registerAdminComposedMenuRoutes = require('../server/routes/admin-composed-menu');
const ComposedProductService = require('../domains/catalog/services/ComposedProductService');

const DASHBOARD_JS = fs.readFileSync(
  path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8'
);

const BRAND = 'brand_cpr';
const OTHER_BRAND = 'brand_cpr_other';

// requireAuth produksi memverifikasi token; di sini pemanggil dianggap owner
// supaya yang teruji adalah routing + handler Product-nya.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.brand_id = req.headers['x-test-brand'] || null;
    next();
  });
  const router = express.Router();
  registerAdminComposedMenuRoutes(router, {
    db,
    requireAuth: (roles) => (req, _res, next) => {
      if (!req.brand_id) return next();
      const rolesList = Array.isArray(roles) ? roles : [roles];
      req.user = { id: 'usr_cpr_owner', role: rolesList[0] };
      next();
    }
  });

  // Fallback 404 identik dengan api.js supaya beda "route tidak ada" vs
  // "product tidak ada" bisa dibuktikan di test.
  const notFound = (req, res) => {
    // hanya untuk prefix /admin/composed supaya test lain tidak terpengaruh
    res.status(404).json({ success: false, error: 'ENDPOINT_NOT_FOUND', status_code: 404 });
  };
  app.use(router);
  app.use('/admin/composed', notFound);
  return app;
}

let server;
let baseUrl;

async function call(method, urlPath, body, brand) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-test-brand': brand || BRAND
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = {};
  try { json = await res.json(); } catch (_) { json = {}; }
  return { status: res.status, body: json };
}

function countProducts(brandId, productId) {
  const row = db.prepare(
    'SELECT COUNT(*) AS c FROM products WHERE brand_id = ? AND id = ?'
  ).get(brandId, productId);
  return Number(row && row.c) || 0;
}

test.before(async () => {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_cpr', 'Org CPR', 'org-cpr')").run();
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, 'org_cpr', 'Brand CPR', 'brand-cpr')").run(BRAND);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, 'org_cpr', 'Brand CPR Other', 'brand-cpr-other')").run(OTHER_BRAND);
  ComposedProductService.listProducts({ brandId: BRAND, activeOnly: false }); // pastikan schema siap

  server = buildApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
  if (server) server.close();
});

// ── CPR-01..03: create → edit mempertahankan identitas ──

test('CPR-01: create Product lewat endpoint canonical', async () => {
  const { status, body } = await call('POST', '/admin/composed/products', {
    name: 'Ayam Bakar CPR',
    sku: 'CPR-001',
    description: 'Deskripsi awal',
    is_active: 1
  });

  assert.strictEqual(status, 201);
  assert.strictEqual(body.success, true);
  assert.ok(body.product && body.product.id, 'Product harus punya id');
  assert.strictEqual(countProducts(BRAND, body.product.id), 1);
});

test('CPR-02: edit mengubah atomic fields TANPA membuat Product baru (identitas tetap)', async () => {
  const created = await call('POST', '/admin/composed/products', {
    name: 'Produk Identitas', sku: 'CPR-002', description: 'lama'
  });
  const productId = created.body.product.id;

  const updated = await call('PUT', '/admin/composed/products/' + productId, {
    name: 'Produk Identitas (diubah)',
    sku: 'CPR-002-B',
    description: 'deskripsi baru',
    is_active: 1
  });

  assert.strictEqual(updated.status, 200, 'PUT by-id harus tersedia dan sukses');
  assert.strictEqual(updated.body.success, true);
  assert.strictEqual(updated.body.product.id, productId, 'id Product tidak boleh berubah');

  // Tetap SATU baris Product dengan id itu -> edit bukan create.
  assert.strictEqual(countProducts(BRAND, productId), 1, 'edit tidak boleh membuat Product baru');

  const list = await call('GET', '/admin/composed/products?active_only=0');
  const found = (list.body.products || []).filter((p) => String(p.id) === String(productId));
  assert.strictEqual(found.length, 1, 'list hanya memuat satu Product dengan id tersebut');
  assert.strictEqual(found[0].name, 'Produk Identitas (diubah)');
  assert.strictEqual(found[0].sku, 'CPR-002-B');
  assert.strictEqual(found[0].description, 'deskripsi baru');
});

test('CPR-03: payload commercial (price/category/options) tidak mengubah identitas Product', async () => {
  const created = await call('POST', '/admin/composed/products', { name: 'Produk Tagihan', sku: 'CPR-003' });
  const productId = created.body.product.id;

  const total = db.prepare('SELECT COUNT(*) AS c FROM products WHERE brand_id = ?').get(BRAND).c;

  const res = await call('PUT', '/admin/composed/products/' + productId, {
    name: 'Produk Tagihan',
    description: 'dengan payload komersial',
    is_active: 1
    , price: 99000, category_id: 'cat_x', options: [{ name: 'x' }]
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.product.id, productId);
  const after = db.prepare('SELECT COUNT(*) AS c FROM products WHERE brand_id = ?').get(BRAND).c;
  assert.strictEqual(after, total, 'field komersial tidak boleh menambah/menggandakan Product');
});

// ── CPR-04: archive & activate kembali ──

test('CPR-04: archive (nonaktif) lalu aktifkan kembali lewat PATCH status', async () => {
  const created = await call('POST', '/admin/composed/products', { name: 'Produk Arsip', sku: 'CPR-004' });
  const productId = created.body.product.id;

  const off = await call('PATCH', '/admin/composed/products/' + productId + '/status', { is_active: 0 });
  assert.strictEqual(off.status, 200);
  let row = db.prepare('SELECT is_active FROM products WHERE id = ?').get(productId);
  assert.strictEqual(Number(row.is_active), 0, 'Product harus nonaktif');

  const on = await call('PATCH', '/admin/composed/products/' + productId + '/status', { is_active: 1 });
  assert.strictEqual(on.status, 200);
  row = db.prepare('SELECT is_active FROM products WHERE id = ?').get(productId);
  assert.strictEqual(Number(row.is_active), 1, 'Product harus aktif kembali');
  assert.strictEqual(countProducts(BRAND, productId), 1);
});

// ── CPR-05: contract guard ──

test('CPR-05: GET by-id memang tidak ada di contract (404 ENDPOINT_NOT_FOUND)', async () => {
  const { status, body } = await call('GET', '/admin/composed/products/prod_apa_saja');
  assert.strictEqual(status, 404);
  assert.strictEqual(body.error, 'ENDPOINT_NOT_FOUND',
    'GET by-id bukan bagian contract; editor tidak boleh bergantung padanya');
});

// ── CPR-06..07: tidak menulis untuk id asing / brand lain ──

test('CPR-06: PUT id yang tidak ada ditolak sebagai PRODUCT tidak ditemukan', async () => {
  const { status, body } = await call('PUT', '/admin/composed/products/prod_tidak_ada', { name: 'X' });
  assert.strictEqual(status, 404);
  assert.strictEqual(body.error, 'MASTER_PRODUCT_NOT_FOUND');
  assert.strictEqual(countProducts(BRAND, 'prod_tidak_ada'), 0, 'tidak boleh membuat Product baru');
});

test('CPR-07: Product brand lain tidak bisa diubah lewat brand ini', async () => {
  const other = await call('POST', '/admin/composed/products', { name: 'Produk Brand Lain' }, OTHER_BRAND);
  const otherId = other.body.product.id;

  const attempt = await call('PUT', '/admin/composed/products/' + otherId, { name: 'Dibajak' }, BRAND);
  assert.strictEqual(attempt.status, 404, 'isolasi brand harus menolak');

  const row = db.prepare('SELECT name FROM products WHERE id = ?').get(otherId);
  assert.strictEqual(row.name, 'Produk Brand Lain', 'nama Product brand lain tetap utuh');
});

// ── CPR-08: sisi klien (guard terhadap regresi) ──

test('CPR-08: Editor Product memakai LIST canonical, bukan by-id atau legacy', () => {
  const start = DASHBOARD_JS.indexOf('async function loadProductEditorPage(productId)');
  const end = DASHBOARD_JS.indexOf('window.openAddProduct = function ()', start);
  assert.ok(start >= 0 && end > start, 'loader Product Editor harus ada');
  const loader = DASHBOARD_JS.slice(start, end);

  assert.ok(loader.includes("API_BASE + '/admin/composed/products?active_only=0'"),
    'loader harus memakai list canonical');
  assert.ok(!/composed\/products\/'\s*\+\s*encodeURIComponent\(productId\)/.test(loader),
    'loader tidak boleh memanggil GET by-id yang tidak ada di contract');
  assert.ok(!loader.includes("'/admin/products/'"), 'loader tidak boleh memakai endpoint legacy');

  // Save tetap canonical: PUT by-id + payload atomic saja.
  const saveStart = DASHBOARD_JS.indexOf("var formProduct = $('form-product');");
  const save = DASHBOARD_JS.slice(saveStart, saveStart + 3000);
  assert.ok(save.includes("API_BASE + '/admin/composed/products/' + encodeURIComponent(id)"));
  assert.ok(save.includes("var method = id ? 'PUT' : 'POST';"));
  ['price:', 'category_id:', 'sub_category_id:', 'rasa_id:', 'options:', 'composition:'].forEach((field) => {
    assert.ok(!save.includes('          ' + field), 'payload save tidak boleh memuat ' + field);
  });
});
