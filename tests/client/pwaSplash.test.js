/**
 * Splash saat memuat.
 *
 * Masalahnya: index.html adalah kerangka statis, jadi hero (latar brand + baris ikon)
 * sudah terlukis sebelum JS mengisi apa pun — saat reload, tamu melihat kerangka
 * setengah jadi. Splash menutupinya, dan harus SELALU hilang.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const HTML = read('apps/customer-pwa/index.html');
const MANIFEST = JSON.parse(read('apps/customer-pwa/assets/pwa/manifest.json'));

// Warna boleh berubah (putih dipilih karena lime terlalu menyala) — yang dikunci
// adalah KONSISTENSI antara splash di halaman dan splash bawaan PWA.
const SPLASH_BG = (function () {
  const m = HTML.slice(HTML.indexOf('id="x-splash"')).match(/background:(#[0-9a-fA-F]{6})/);
  return m ? m[1].toLowerCase() : null;
})();

test('SPLASH-01: splash dilukis paling awal, opak, dan tidak bisa tertembus', () => {
  assert.ok(HTML.includes('id="x-splash"'), 'harus ada elemen splash');
  // Urutan: splash ada SEBELUM tampilan aplikasi pertama.
  assert.ok(HTML.indexOf('id="x-splash"') < HTML.indexOf('id="xentra-home-view"'),
    'splash harus dilukis sebelum kerangka aplikasi');
  const splash = HTML.slice(HTML.indexOf('id="x-splash"'), HTML.indexOf('id="xentra-home-view"'));
  assert.ok(splash.includes('position:fixed'), 'harus menutup layar');
  assert.ok(splash.includes('z-index:9999'), 'harus di atas kerangka');
  assert.ok(SPLASH_BG, 'latar splash harus warna tetap (hex)');
  assert.ok(/object-fit:contain/.test(splash) && splash.includes('xentra-logo.png'), 'memuat logo');
  // Animasi karakter (SVG + CSS, tanpa aset baru), di ATAS logo.
  assert.ok(splash.includes('class="bot bot-float"'), 'harus ada karakter beranimasi');
  assert.ok(splash.includes('@keyframes bot-float'), 'badannya mengambang');
  assert.ok(splash.includes('@keyframes bot-blink'), 'matanya berkedip');
  // Kedip 2x per siklus: dua momen scaleY(.12) dalam keyframes.
  assert.ok((splash.match(/scaleY\(\.12\)/g) || []).length === 2, 'kedip 2x per siklus');
  // Cute cues yang sekaligus membedakannya dari karakter mana pun: senyum dan antena.
  assert.ok(splash.includes('bot-eye'), 'mata ada');
  assert.ok(splash.includes('stop-color="#e9eef3"'), 'badan memakai gradien lembut');
  // Tanpa mulut & antena, bentuk meruncing, tangan elips ramping.
  assert.ok(!/c3 3\.2 9 3\.2 12 0/.test(splash), 'mulut sudah dihilangkan');
  assert.ok(!splash.includes('cy="4" r="2.6"'), 'antena sudah dihilangkan');
  assert.ok(splash.includes('M46 8 C62 8 72 22 72 44'), 'badan meruncing ke bawah');
  assert.ok(splash.includes('rx="4.4" ry="16"'), 'tangan lebih panjang');
  assert.ok(splash.indexOf('bot-float') < splash.indexOf('xentra-logo.png'),
    'animasinya di atas logo');
  assert.ok(splash.includes('@media (prefers-reduced-motion: reduce)'),
    'gerakan harus dihentikan kalau tamu memilih reduced motion');
  assert.ok(splash.includes('Memuat'), 'teks tetap ada untuk pembaca layar');
});

test('SPLASH-02: selalu ada jalan keluar — batas waktu keras', () => {
  assert.ok(HTML.includes('window.__xentraHideSplash'), 'harus ada fungsi penutup');
  assert.ok(/setTimeout\(window\.__xentraHideSplash,\s*\d+\)/.test(HTML),
    'boot yang gagal tidak boleh meninggalkan splash selamanya');
});

test('SPLASH-03: aplikasi menutup splash saat tampilan pertama siap', () => {
  assert.ok(/__xentraHideSplash\(\)/.test(HTML), 'aplikasi harus memanggilnya');
  const appCall = HTML.slice(HTML.indexOf('window.XentraHome.refresh()'));
  assert.ok(appCall.indexOf('__xentraHideSplash') !== -1,
    'penutupan terjadi setelah render pertama, bukan sebelum');
});

test('SPLASH-04: splash bawaan PWA (manifest) sewarna dengan splash di halaman', () => {
  // Chrome membuat splash sendiri dari manifest; kalau warnanya beda, yang terjadi
  // justru dua kali ganti warna (putih lalu hijau).
  assert.equal(String(MANIFEST.background_color).toLowerCase(), SPLASH_BG,
    'background_color harus sama dengan splash di halaman');
  assert.equal(String(MANIFEST.theme_color).toLowerCase(), SPLASH_BG,
    'theme_color harus sama dengan splash di halaman');
});
