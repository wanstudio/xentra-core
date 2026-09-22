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
  // Badge harus kuat untuk 2-3 angka: tetap pill dan angkanya rata.
  assert.ok(/x-my-table-badge"[\s\S]{0,400}min-width:18px/.test(HTML), 'badge siap 2-3 angka');
  assert.ok(/x-my-table-badge"[\s\S]{0,400}font-variant-numeric:tabular-nums/.test(HTML), 'angka badge rata');
  assert.ok(/x-my-table-badge"[\s\S]{0,300}color:#fff/.test(HTML), 'angka badge putih');
  // Ikon: tutup makanan (cloche) versi ISI, hitam — sama gaya dengan ikon
  // riwayat & profil yang juga solid, bukan garis.
  assert.ok(HTML.includes('M4.6 13.6C4.6 9.51 7.91 6.2 12 6.2s7.4 3.31 7.4 7.4z'),
    'ikon harus punya kubah tutup makanan (isi)');
  assert.ok(/x-btn-my-table"[\s\S]{0,900}<circle cx="12" cy="4\.7"/.test(HTML),
    'ikon harus punya pegangan di atas kubah');
  assert.ok(/x-btn-my-table"[\s\S]{0,900}<rect x="3\.2"/.test(HTML), 'ikon harus punya alas');
  assert.ok(/x-btn-my-table"[\s\S]{0,900}fill="#303030"/.test(HTML),
    'warna harus sama dengan ikon riwayat & profil (#303030)');
  // Ukurannya harus sepadan dengan ikon tetangga: gambar mengisi kotaknya.
  assert.ok(/x-btn-my-table"[\s\S]{0,300}width="18"/.test(HTML), 'ikon harus sepadan (18px)');
  assert.ok(/x-btn-my-table"[\s\S]{0,300}viewBox="3\.2 3\.35 17\.6 12\.95"/.test(HTML),
    'kotak ikon harus dipaskan ke gambarnya, jangan menyisakan ruang kosong');
  assert.ok(!/x-btn-my-table"[\s\S]{0,900}stroke=/.test(HTML), 'ikon tidak boleh bergaya garis lagi');
  assert.ok(!HTML.includes('<rect x="8.25"'), 'ikon meja/kursi lama harus hilang');

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

test('MYTABLE-10: ada halaman pratinjau untuk melihat badge 2-3 angka', () => {
  const pv = read('apps/merchant-shared/prototype/badge-preview.html');
  assert.ok(pv.includes('>20<'), 'pratinjau harus memperlihatkan badge 2 angka');
  assert.ok(pv.includes('>100<'), 'dan 3 angka');
  assert.ok(pv.includes('library.svg') && pv.includes('black_flowbite_user-solid.svg'),
    'pratinjau harus memakai ikon asli supaya perbandingan warna & ukuran akurat');
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
