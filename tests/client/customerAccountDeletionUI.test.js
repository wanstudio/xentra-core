/**
 * Pintu "Hapus Akun" di halaman profil.
 *
 * Mesinnya (service + endpoint) sudah diuji di tests/core/customerAccountDeletion.test.js;
 * di sini yang dikunci: alurnya tidak bisa terpicu karena salah tekan, konfirmasinya
 * dikirim lewat query (bukan body), dan data lokal benar-benar dibersihkan.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/aux-pages.js'), 'utf8');

test('DELUI-01: tombol ada, dengan penjelasan apa yang hilang dan apa yang tersisa', () => {
  // Baris menu ada di profil, ikon gear, tepat di bawah Program Kemitraan.
  assert.ok(src.includes('id="x-profile-btn-account"'), 'baris Pengaturan Akun harus ada');
  assert.ok(src.includes('>⚙️</span><span>Pengaturan Akun</span>'), 'ikonnya gear');
  assert.ok(src.indexOf('Program Kemitraan') < src.indexOf('Pengaturan Akun'),
    'harus di bawah Program Kemitraan');
  // Tombol hapusnya kini di halamannya sendiri, bukan menumpang di profil.
  assert.ok(src.includes('function mountAccountSettings(container)'), 'harus jadi halaman sendiri');
  assert.ok(src.includes('id="x-profile-delete"'), 'tombol hapus akun ada di halaman itu');
  assert.ok(src.includes('bindDeleteAccountFlow(container);'), 'halaman itu yang memasang alur hapus');
  assert.ok(src.indexOf('function mountAccountSettings') < src.indexOf('bindDeleteAccountFlow(container);'),
    'pemanggilannya ada di dalam halaman itu');
  assert.ok(src.includes('>Hapus Akun</button>'), 'labelnya jelas');
  assert.ok(src.includes('Riwayat pesanan tetap tersimpan di resto, tanpa terhubung lagi ke Anda.'),
    'tamu harus diberi tahu bahwa catatan pesanan tetap ada di resto');
});

test('DELUI-02: dua langkah — harus mengetik, bukan sekadar menekan', () => {
  assert.ok(src.includes("prompt('Menghapus akun tidak bisa dibatalkan."), 'harus ada langkah ketik');
  assert.ok(src.includes("String(typed).trim().toUpperCase() !== 'HAPUS AKUN'"),
    'penulisan harus persis HAPUS AKUN');
  assert.ok(src.includes("if (typed === null) return;"), 'dibatalkan berarti tidak terjadi apa-apa');
  // Tombol lain (Keluar) tetap ada dan tidak terganggu.
  assert.ok(src.includes('id="x-profile-logout"'), 'keluar akun tidak boleh ikut berubah');
});

test('DELUI-03: konfirmasi lewat query, bukan body', () => {
  assert.ok(src.includes("API.del('/customer/account?confirm=HAPUS')"),
    'DELETE dengan query; memakai body akan dijawab 400 kosong oleh rantai middleware');
  assert.ok(!/API\.del\('[^']*',\s*\{/.test(src), 'jangan kirim body pada DELETE');
});

test('DELUI-04: setelah berhasil, data lokal dibersihkan', () => {
  ['clearCustomerSession', 'clearCart', 'clearRecipient', 'clearMyTable'].forEach(function (fn) {
    assert.ok(src.includes('Store.' + fn), 'harus membersihkan ' + fn);
  });
  assert.ok(src.includes('mountProfile(container)'), 'tampilan profil di-render ulang');
  assert.ok(src.includes("UI.toast('Akun Anda sudah dihapus.')"), 'tamu diberi tahu hasilnya');
});

test('DELUI-05: kegagalan menampilkan sebab sebenarnya, bukan pesan generik', () => {
  assert.ok(src.includes("var status = err && err.status ? (' (' + err.status + ')') : '';"),
    'status HTTP harus ikut ditampilkan');
  assert.ok(src.includes("var reason = (err && err.message) ? err.message : 'Koneksi bermasalah.';"),
    'pesan dari server harus ditampilkan');
  assert.ok(!src.includes("UI.toast('Koneksi bermasalah. Akun belum dihapus.')"),
    'pesan generik lama harus hilang — itu yang menyembunyikan sebabnya');
});

test('DELUI-06: halaman Pengaturan Akun terdaftar di router dan shell', () => {
  const router = fs.readFileSync(path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/router.js'), 'utf8');
  const shell = fs.readFileSync(path.resolve(__dirname, '../../apps/customer-pwa/index.html'), 'utf8');

  assert.ok(router.includes("return 'account-settings';"), 'view-nya dikenali router');
  assert.ok(router.includes("window.location.hash = '#account-settings';"), 'bisa dinavigasi');
  assert.ok(shell.includes("'account-settings': '/assets/js/pages/aux-pages.js'"), 'skrip halamannya dimuat');
  assert.ok(shell.includes('id="xentra-account-settings-view"'), 'container halamannya ada');
  assert.ok(shell.includes('window.XentraAuxPages.mountAccountSettings('), 'shell memasang halamannya');
});
