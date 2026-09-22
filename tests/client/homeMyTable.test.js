/**
 * Meja saya di Home: scan QR → ikon meja + badge.
 *
 * Alur yang dikunci di sini:
 * 1. Ikon scan di topbar (sebelah kiri riwayat) memanggil scanner bersama.
 * 2. Setelah scan berhasil: notifikasi hijau + tombol "Pesan menu".
 * 3. Ikon scan hilang, muncul ikon meja dengan badge merah berisi nomor meja.
 * 4. Klik ikon meja: ringkasan meja + isi pesanan, dengan CTA Tambah menu/Checkout.
 * 5. Sudah punya meja lalu scan meja lain: DIKUNCI, tamu diarahkan ke kasir.
 * 6. Badge dilepas hanya kalau tagihan yang tadinya terbuka sudah ditutup kasir.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const HTML = read('apps/customer-pwa/index.html');
const HOME = read('apps/customer-pwa/assets/js/pages/home.js');
const STORE = read('apps/customer-pwa/assets/js/core/store.js');
const CHECKOUT = read('apps/customer-pwa/assets/js/pages/checkout.js');

test('MYTABLE-01: topbar punya ikon scan dan ikon meja dengan badge', () => {
  assert.ok(HTML.includes('id="x-btn-scan-table"'), 'ikon scan harus ada');
  assert.ok(HTML.includes('id="x-btn-my-table"'), 'ikon meja harus ada');
  assert.ok(HTML.includes('id="x-my-table-badge"'), 'badge angka meja harus ada');
  assert.ok(/x-btn-my-table"[\s\S]{0,400}hidden/.test(HTML), 'ikon meja tersembunyi sampai tamu dapat meja');
  assert.ok(/x-my-table-badge"[\s\S]{0,300}background:#dc2626/.test(HTML), 'badge merah');
  assert.ok(/x-my-table-badge"[\s\S]{0,300}color:#fff/.test(HTML), 'angka badge putih');
  // Ikon: tutup makanan (cloche) hitam — kubah + alas + pegangan, tanpa tangan.
  assert.ok(HTML.includes('M5.5 17a6.5 6.5 0 0 1 13 0'), 'ikon harus punya kubah tutup makanan');
  assert.ok(HTML.includes('M3.5 17h17'), 'ikon harus punya alas');
  assert.ok(/x-btn-my-table"[\s\S]{0,900}<circle cx="12" cy="7\.9"/.test(HTML),
    'ikon harus punya pegangan di atas kubah');
  assert.ok(!HTML.includes('<rect x="8.25"'), 'ikon meja/kursi lama harus hilang');
  assert.ok(/x-btn-my-table"[\s\S]{0,900}stroke="#111111"/.test(HTML), 'ikon harus hitam');

  const scan = HTML.indexOf('x-btn-scan-table');
  const my = HTML.indexOf('x-btn-my-table');
  const lib = HTML.indexOf('x-btn-library');
  assert.ok(scan < my && my < lib, 'urutannya scan → meja → riwayat');
});

test('MYTABLE-02: ikon bertukar sesuai keadaan, dan scannernya modul bersama', () => {
  assert.ok(HOME.includes('function renderMyTableState()'), 'harus ada satu penentu tampilan');
  assert.ok(HOME.includes("btnScanTable.hidden = !!table"), 'ada meja → ikon scan hilang');
  assert.ok(HOME.includes("btnMyTable.hidden = !table"), 'ada meja → ikon meja muncul');
  assert.ok(HOME.includes("badge.textContent = table ? (table.number || '') : ''"), 'badge diisi nomor meja');
  assert.ok(HOME.includes('window.Xentra.TableQr'), 'home memakai scanner bersama, bukan salinannya sendiri');
});

test('MYTABLE-03: notifikasi berhasil + tombol "Pesan menu"', () => {
  assert.ok(HOME.includes("'Berhasil, kamu sekarang ada di meja '"), 'judul notifikasi berhasil');
  assert.ok(HOME.includes('Pesan makananmu, kami akan antarkan langsung ke mejamu.'),
    'isi notifikasi menjelaskan apa yang terjadi');
  assert.ok(HOME.includes("label: 'Pesan menu'"), 'harus ada tombol Pesan menu');
  assert.ok(HOME.includes('Store.setMyTable(table)'), 'meja disimpan supaya tidak hilang saat pindah halaman');
});

test('MYTABLE-04: klik ikon meja → ringkasan + CTA', () => {
  assert.ok(HOME.includes("title: 'Kamu di meja ' + n"), 'judul ringkasan meja');
  assert.ok(HOME.includes('Belum ada menu.'), 'kalau kosong: ajakan pesan menu');
  assert.ok(HOME.includes('items.map('), 'kalau ada isi: daftar menunya');
  assert.ok(HOME.includes("label: 'Tambah menu'"), 'CTA Tambah menu');
  assert.ok(HOME.includes("label: 'Checkout'") && HOME.includes("Router.navigate('checkout')"),
    'CTA Checkout menuju halaman checkout');
});

test('MYTABLE-05: pindah meja dikunci, tamu diarahkan ke kasir', () => {
  assert.ok(HOME.includes('Ingin pindah meja? Hubungi kasir.'), 'harus ada pesan kunci pindah meja');
  assert.ok(/var current = \(Store\.getMyTable && Store\.getMyTable\(\)\) \|\| null;\s*\n\s*if \(current\) \{/
    .test(HOME), 'scan meja lain harus ditolak saat sudah punya meja');
  assert.ok(!"Store.setMyTable({ id: res.table.id".includes('TIDAK'),
    'meja hanya dipasang kalau belum punya');
});

test('MYTABLE-06: badge dilepas hanya setelah tagihan ditutup kasir', () => {
  assert.ok(HOME.includes('hadOpenBill'), 'perlu penanda pernah ada tagihan terbuka');
  assert.ok(HOME.includes('} else if (current.hadOpenBill) {') && HOME.includes('Store.clearMyTable();'),
    'badge dilepas hanya kalau tagihannya memang sudah tidak ada');
  assert.ok(HOME.includes("API.get('/customer/dining-session')"), 'dicocokkan ke server, bukan ditebak');
});

test('MYTABLE-07: meja disimpan di Store (bertahan saat pindah halaman)', () => {
  assert.ok(STORE.includes("var MY_TABLE_KEY = PREFIX + 'my_table';"), 'kunci penyimpanan meja');
  assert.ok(STORE.includes('setMyTable: setMyTable') && STORE.includes('getMyTable: getMyTable')
    && STORE.includes('clearMyTable: clearMyTable'), 'setter/getter meja harus diekspor');
});

test('MYTABLE-09: meja yang dipilih di checkout ikut mengisi badge', () => {
  assert.ok(CHECKOUT.includes('Store.setMyTable({ id: draft.selectedTableIds[0]'),
    'badge di Home itu keterangan duduk di mana, jadi pilihan di checkout harus ikut terpasang');
  assert.ok(/state\.fulfillment\.type === 'dine_in' && Store\.setMyTable/.test(CHECKOUT),
    'hanya untuk dine-in');
});

test('MYTABLE-08: pesanan checkout terikat ke meja hasil scan', () => {
  assert.ok(CHECKOUT.includes('var storedTable = (Store.getMyTable && Store.getMyTable()) || null;'),
    'checkout harus membaca meja dari Store');
  assert.ok(CHECKOUT.includes('state.fulfillment.table_ids = [storedTable.id];'),
    'meja itu langsung terpasang, tanpa pilih meja lagi');
});
