/**
 * QR meja di tab Meja (merchant app).
 *
 * Kemampuan membuat QR-nya ada di server (GET /dine-in/tables/:id/qr) dan sudah
 * diuji di tests/core/dineInOpenBill.test.js. Di sini yang dikunci: tab Meja
 * benar-benar menyediakan QR itu untuk dilihat, dicetak, dan dibagikan — tanpa
 * membangun token atau gambar QR sendiri di klien.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.resolve(__dirname, '../../apps/merchant-app/assets/js/merchant-app.js');
const TABLES = path.resolve(__dirname, '../../apps/merchant-app/assets/js/tables.js');
const code = fs.readFileSync(APP, 'utf8') + '\n' + (fs.existsSync(TABLES) ? fs.readFileSync(TABLES, 'utf8') : '');

test('QR-01: setiap kartu meja punya tombol QR', () => {
  assert.ok(code.includes('openBMTableQr('), 'kartu meja harus memanggil openBMTableQr');
  assert.ok(code.includes('>QR Meja</button>'), 'tombolnya harus berlabel QR Meja');
  assert.ok(/renderBMTablesGrid[\s\S]*openBMTableQr\(/.test(code), 'tombolnya dirender di grid meja');
});

test('QR-02: QR diambil dari server, bukan dibuat di klien', () => {
  assert.ok(code.includes("'/dine-in/tables/' + encodeURIComponent(tableId) + '/qr'"),
    'harus memanggil endpoint QR meja');
  assert.ok(code.includes('getAuthHeaders()'), 'harus lewat sesi staf (endpoint-nya ber-RBAC)');
  assert.ok(code.includes('data.svg'), 'gambarnya dari server');
  assert.ok(!code.includes('function makeQrCode'), 'klien tidak boleh membangun QR sendiri');
});

test('QR-03: tampil di layar dengan aksi cetak dan bagikan', () => {
  assert.ok(code.includes("id=\"bm-qr-svg\""), 'gambar QR harus terlihat');
  assert.ok(code.includes("id=\"bm-qr-print\""), 'harus ada tombol cetak');
  assert.ok(code.includes("id=\"bm-qr-share\""), 'harus ada tombol bagikan');
  assert.ok(code.includes("https://wa.me/?text="), 'bagikan lewat WhatsApp');
  assert.ok(code.includes("'QR ' + title + ': ' + data.join_url"), 'yang dibagikan adalah URL gabung');
});

test('QR-04: cetak menghasilkan halaman bersih (QR + nama meja saja)', () => {
  assert.ok(code.includes('function printBMTableQr('), 'harus ada fungsi cetak');
  assert.ok(code.includes("w.document.write('<!doctype html>"), 'cetak lewat jendela sendiri');
  assert.ok(code.includes('Scan untuk melihat pesanan meja ini'), 'halaman cetak harus memberi instruksi');
  assert.ok(code.includes('w.print();'), 'harus memanggil print');
  assert.ok(code.includes("Kode meja: ' + esc(kode)"), 'kode meja harus tercetak di bawah QR (jalan manual)');
  assert.ok(code.includes("('meja' + data.table.table_number)"),
    'kode yang dicetak harus gampang ditulis tangan, mis. meja7');
});

test('QR-05: overlay tidak menumpuk', () => {
  assert.ok(code.includes("var previous = document.getElementById('bm-qr-overlay');"),
    'overlay lama harus dicari');
  assert.ok(code.includes('if (previous) previous.remove();'), 'overlay lama harus dibuang');
  assert.ok(code.includes("overlay.querySelector('#bm-qr-close').onclick"), 'harus bisa ditutup');
});
