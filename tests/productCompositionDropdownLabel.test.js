/**
 * Regression: dropdown "Product Komposisi" menampilkan NAMA Product saja.
 *
 * Sebelumnya label opsi menempelkan SKU, sehingga terlihat seperti
 * "Ayam Kampung Asli Geprek + Nasi · SKU DEMO-prod_178946...". SKU tetap
 * dipakai sebagai identity internal (value opsi = id Product) dan tidak
 * ditampilkan. Data, API, database, dan logic composition tidak berubah.
 *
 * Yang diuji:
 *   PCD-01..02  label opsi = nama Product saja (perilaku nyata dari fungsi
 *               pembentuk opsi), tidak ada lagi format "· SKU <sku>"
 *   PCD-03      value opsi tetap id Product (SKU bukan value)
 *   PCD-04      suffix status "(Nonaktif)" tetap ada (bukan identifier)
 *   PCD-05      dataset & urutan Product tidak berubah (search/filter sama)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_JS = fs.readFileSync(
  path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8'
);
const INLINE_JS = fs.readFileSync(
  path.join(__dirname, '../apps/merchant-dashboard/assets/js/owner-master-menu-inline.js'), 'utf8'
);

/** Ambil source sebuah fungsi (function declaration) apa adanya dari bundle. */
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, 'fungsi harus ada: ' + signature);
  let depth = 0;
  let started = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') { depth += 1; started = true; }
    else if (ch === '}') {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('fungsi tidak lengkap: ' + signature);
}

// Bentuk opsi nyata dari fungsi produksi (bukan string search).
function buildOptionsWith(rows) {
  const src = extractFunction(DASHBOARD_JS, 'function ownerMasterMenuPopulateSelect(');
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const captured = {};
  const fakeSelect = { set innerHTML(value) { captured.html = value; } };
  const $ = (id) => (id === 'cm-product' ? fakeSelect : null);

  const factory = new Function('$', 'esc', src + '\nreturn ownerMasterMenuPopulateSelect;');
  const populate = factory($, esc);
  populate('cm-product', rows, 'id');
  return captured.html;
}

const PRODUCTS = [
  { id: 'prod_1789462616347', name: 'Ayam Kampung Asli Geprek + Nasi', sku: 'DEMO-prod_1789462616347', is_active: 1 },
  { id: 'prod_1789462616348', name: 'Ayam Kampung Asli Geprek Tanpa Nasi', sku: 'DEMO-prod_1789462616348', is_active: 1 },
  { id: 'prod_1789462616349', name: 'Ayam Kampung Asli Lombok Ijo + Nasi', sku: null, is_active: 0 }
];

// ── PCD-01..02: label hanya nama ──

test('PCD-01: label opsi Product Komposisi hanya memuat nama Product', () => {
  const html = buildOptionsWith(PRODUCTS);

  assert.ok(html.includes('Ayam Kampung Asli Geprek + Nasi'), 'nama Product harus tampil');
  assert.ok(html.includes('Ayam Kampung Asli Lombok Ijo + Nasi'));
  assert.ok(!html.includes('DEMO-prod_1789462616347'), 'SKU tidak boleh tampil di label');
  assert.ok(!html.includes('DEMO-prod_1789462616348'), 'SKU tidak boleh tampil di label');
  assert.ok(!html.includes('· SKU'), 'format "· SKU <sku>" harus hilang dari dropdown');
});

test('PCD-02: tidak ada lagi pembentuk label yang menempelkan SKU', () => {
  assert.ok(!/· SKU/.test(DASHBOARD_JS), 'dashboard.js tidak boleh menempelkan SKU ke label');
  assert.ok(!/· SKU/.test(INLINE_JS), 'menu inline tidak boleh menempelkan SKU ke label');
  assert.ok(!/product\.sku\s*\?/.test(INLINE_JS), 'label Product tidak boleh bercabang dari sku');
});

// ── PCD-03..04: identity & suffix status ──

test('PCD-03: value opsi tetap id Product, bukan SKU', () => {
  const html = buildOptionsWith(PRODUCTS);

  assert.ok(html.includes('value="prod_1789462616347"'), 'value harus id Product');
  assert.ok(html.includes('value="prod_1789462616348"'));
  assert.ok(!html.includes('value="DEMO-prod_'), 'SKU tidak boleh jadi value opsi');
  assert.ok(DASHBOARD_JS.includes("var id = String(row[valueKey || 'id'] || '');"),
    'value tetap diambil dari key identity (id), bukan sku');
});

test('PCD-04: suffix status (Nonaktif) tetap tampil dan bukan identifier', () => {
  const html = buildOptionsWith(PRODUCTS);
  assert.ok(html.includes('Ayam Kampung Asli Lombok Ijo + Nasi (Nonaktif)'),
    'status nonaktif tetap ditandai supaya merchant tahu kondisinya');
  assert.ok(html.includes('data-inactive="1"'));
});

// ── PCD-05: dataset search/filter tidak berubah ──

test('PCD-05: daftar & urutan Product yang ditawarkan tidak berubah', () => {
  const html = buildOptionsWith(PRODUCTS);
  const values = Array.from(html.matchAll(/value="([^"]*)"/g)).map((m) => m[1]);

  assert.deepStrictEqual(values, PRODUCTS.map((p) => p.id),
    'semua Product tetap ditawarkan, urutan sama seperti sebelumnya');

  // Field yang dibaca fungsi tetap sama: id, name, is_active (tidak ada sku).
  const src = extractFunction(DASHBOARD_JS, 'function ownerMasterMenuPopulateSelect(');
  assert.ok(!src.includes('sku'), 'fungsi pembentuk opsi tidak boleh membaca sku');
});

test('PCD-06: dropdown komponen paket juga nama saja dengan value id', () => {
  const start = DASHBOARD_JS.indexOf('function renderOwnerMasterMenuPackageComponents()');
  const end = DASHBOARD_JS.indexOf('box.querySelectorAll(\'[data-cm-product]\')', start);
  const block = DASHBOARD_JS.slice(start, end);

  assert.ok(block.includes("esc(product.name + (inactive ? ' (Nonaktif)' : ''))"),
    'label komponen paket = nama Product (+ status nonaktif)');
  assert.ok(!block.includes('sku'), 'komponen paket tidak boleh menampilkan SKU');
  assert.ok(block.includes("'<option value=\"' + esc(product.id) + '\"'"),
    'value komponen paket tetap id Product');
});

test('PCD-07: penambahan Product baru ke dropdown juga nama saja', () => {
  assert.ok(INLINE_JS.includes('var label = product.name;'),
    'label Product baru tidak lagi menempelkan SKU');
  assert.ok(INLINE_JS.includes('addOption(select, id, product.name, false);'));
  // Value yang ditulis tetap id Product.
  assert.ok(INLINE_JS.includes('addOption(document.getElementById(\'cm-product\'), product.id, label, true);'));
});
