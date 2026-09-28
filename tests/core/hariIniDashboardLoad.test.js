/**
 * Halaman "Hari Ini" (Branch Manager) — beban muat dashboard.
 *
 * Lambatnya halaman ini bukan dari server: diukur, ketujuh endpoint-nya balas dalam
 * 1–7 ms (total 13 ms) dan database-nya kecil. Yang membuat terasa lama adalah
 * ketujuh permintaan itu dikirim BERURUTAN, sehingga di jaringan seluler waktu
 * tempuhnya menjadi tujuh kali round-trip.
 *
 * Tes ini mengunci bentuk pemuatannya supaya tidak diam-diam kembali berurutan.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../apps/merchant-app/assets/js/hari-ini.js'), 'utf8'
);

// Badan loadHariIni() saja — bagian lain berkas ini memang boleh memanggil satu-satu.
function loadBody() {
  const start = SRC.indexOf('async function loadHariIni()');
  assert.ok(start !== -1, 'loadHariIni harus ada');
  const next = SRC.indexOf('async function ', start + 10);
  return SRC.slice(start, next === -1 ? SRC.length : next);
}

test('HARIINI-01: permintaan dashboard dikirim serentak, bukan satu per satu', () => {
  const body = loadBody();

  // Semua permintaan dibuat lebih dulu, lalu ditunggu bersama.
  assert.ok(/Promise\.(allSettled|all)\(\s*\[/.test(body),
    'permintaan dashboard harus dikumpulkan dalam satu gelombang');
  assert.ok(!/await adminFetch\(/.test(body),
    'tidak boleh ada permintaan yang ditunggu satu per satu di pemuatan dashboard');
});

test('HARIINI-02: setiap hasil gelombang itu dipakai, tidak ada yang tertinggal', () => {
  const body = loadBody();
  const burst = body.slice(body.indexOf('Promise.'), body.indexOf(']);'));
  const requested = (burst.match(/adminFetch\(/g) || []).length;
  assert.ok(requested >= 5 && requested <= 8,
    'jumlah permintaan dashboard harus wajar, sekarang ' + requested);

  // Setiap indeks yang diminta harus dibaca kembali; kalau tidak, data hilang diam-diam.
  for (let i = 0; i < requested; i++) {
    assert.ok(body.includes('results[' + i + ']'),
      'hasil ke-' + i + ' harus dipakai');
  }
});

test('HARIINI-03: kegagalan satu permintaan tidak menjatuhkan sisanya', () => {
  const body = loadBody();
  // allSettled: satu endpoint bermasalah tidak boleh membatalkan seluruh dashboard.
  assert.ok(body.includes('Promise.allSettled'),
    'pakai allSettled supaya satu kegagalan tidak menjatuhkan seluruh halaman');
  assert.ok(/\.status === "fulfilled"|\.status === 'fulfilled'/.test(body),
    'hasil yang gagal harus dilewati dengan sadar');
});
