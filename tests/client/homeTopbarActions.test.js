/**
 * Topbar aksi di home (index.html).
 *
 * Tombol teks "Yuk, join!" diganti ikon share yang bentuknya sama dengan ikon
 * tetangganya (riwayat & profil), tapi perilakunya tidak berubah: tetap menuju
 * halaman affiliate. Warna merah (penanda sudah jadi affiliate member) menyusul
 * setelah status keanggotaannya ada di sisi konsumen.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = path.resolve(__dirname, '../../apps/customer-pwa/index.html');
const HOME = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/home.js');

test('TOPBAR-01: tombol "Yuk, join!" sudah diganti ikon share', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  assert.ok(!html.includes('Yuk, join!'), 'tombol teks "Yuk, join!" harus hilang');
  assert.ok(html.includes('id="x-btn-join"'), 'id-nya dipertahankan supaya perilakunya tidak berubah');
  assert.ok(/x-btn-join"[\s\S]{0,700}<svg/.test(html), 'harus berupa ikon, bukan teks');
  assert.ok(/x-btn-join"[\s\S]{0,700}stroke="#111111"/.test(html), 'ikon share harus hitam');
});

test('TOPBAR-02: bentuknya sama dengan ikon riwayat & profil', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  assert.ok(html.includes('class="x-hero-icon-btn x-hero-icon-btn-join"'),
    'ikon share harus pakai kelas ikon yang sama');
  // urutan: share, riwayat, profil
  const share = html.indexOf('x-btn-join');
  const lib = html.indexOf('x-btn-library');
  const prof = html.indexOf('x-btn-profile');
  assert.ok(share < lib && lib < prof, 'urutan harus share → riwayat → profil');
});

test('TOPBAR-03: perilakunya tidak berubah (tetap ke halaman affiliate)', () => {
  const js = fs.readFileSync(HOME, 'utf8');
  assert.ok(/x-btn-join'\)[\s\S]{0,200}Router\.navigate\('affiliate'\)/.test(js),
    'ikon share tetap membuka halaman affiliate');
});
