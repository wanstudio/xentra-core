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
  assert.ok(src.includes('id="x-profile-delete"'), 'tombol hapus akun harus ada di profil');
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
