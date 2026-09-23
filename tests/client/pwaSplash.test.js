/**
 * Splash robot — loading awal yang hidup, bukan splash statis membosankan.
 * Robot menampilkan merek (putih, mata besar, mengepak) lalu hilang saat
 * JS siap. Timeout 3 detik sebagai jalan keluar jika boot gagal.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const HTML = read('apps/customer-pwa/index.html');

test('SPLASH-01: splash robot dilukis paling awal, opak, tidak bisa tertembus', () => {
  assert.ok(HTML.includes('id="x-splash"'), 'harus ada elemen splash');
  assert.ok(HTML.indexOf('id="x-splash"') < HTML.indexOf('id="xentra-home-view"'),
    'splash harus dilukis sebelum kerangka aplikasi');
  const splash = HTML.slice(HTML.indexOf('id="x-splash"'), HTML.indexOf('id="xentra-home-view"'));
  assert.ok(splash.includes('position:fixed'), 'harus menutup layar');
  assert.ok(splash.includes('z-index:9999'), 'harus di atas kerangka');
  assert.ok(splash.includes('background:#ffffff'), 'latar memakai warna putih');
  assert.ok(/object-fit:contain/.test(splash) && splash.includes('xentra-logo.png'), 'memuat logo');
  assert.ok(splash.includes('class="bot bot-float"'), 'harus ada robot beranimasi');
  assert.ok(splash.includes('@keyframes bot-float'), 'badannya mengambang');
  assert.ok(splash.includes('@keyframes bot-blink'), 'matanya berkedip');
  assert.ok((splash.match(/scaleY\(\.12\)/g) || []).length === 2, 'kedip 2x per siklus');
  // Animasi karakter (SVG + CSS, tanpa aset baru), di ATAS logo.
  assert.ok(splash.indexOf('bot-float') < splash.indexOf('xentra-logo.png'),
    'animasinya di atas logo');
  assert.ok(splash.includes('@media (prefers-reduced-motion: reduce)'),
    'gerakan harus dihentikan kalau tamu memilih reduced motion');
  assert.ok(splash.includes('Memuat'), 'teks tetap ada untuk pembaca layar');
});

test('SPLASH-02: selalu ada jalan keluar — batas waktu keras 3 detik', () => {
  assert.ok(HTML.includes('window.__xentraHideSplash'), 'harus ada fungsi penutup');
  assert.ok(/setTimeout\(window\.__xentraHideSplash,\s*3000\)/.test(HTML),
    'boot yang gagal tidak boleh meninggalkan splash selamanya');
});

test('SPLASH-03: aplikasi menutup splash saat tampilan pertama siap', () => {
  assert.ok(/__xentraHideSplash\(\)/.test(HTML), 'aplikasi harus memanggilnya');
  const appCall = HTML.slice(HTML.indexOf('window.XentraHome.refresh()'));
  assert.ok(appCall.indexOf('__xentraHideSplash') !== -1,
    'penutupan terjadi setelah render pertama, bukan sebelum');
});

test('SPLASH-04: splash bawaan PWA (manifest) sewarna dengan splash di halaman', () => {
  const MANIFEST = JSON.parse(read('apps/customer-pwa/assets/pwa/manifest.json'));
  assert.equal(String(MANIFEST.background_color).toLowerCase(), '#ffffff',
    'background_color harus sama dengan splash');
  assert.equal(String(MANIFEST.theme_color).toLowerCase(), '#ffffff',
    'theme_color harus sama dengan splash');
});
