'use strict';

/**
 * CLICK KANAN DI OWNER — pengecualian guard PWA.
 *
 * Semua surface Xentra memuat `pwa-interaction-guards.js` yang mem-preventDefault
 * `contextmenu` supaya terasa seperti aplikasi terpasang. Untuk surface kerja desktop
 * (Owner Dashboard) menu konteks browser dibutuhkan kembali, jadi guard memberi
 * pengecualian eksplisit lewat `<html data-allow-context-menu>`.
 *
 *   RCM-01  default: contextmenu tetap diblokir (perilaku PWA tidak berubah)
 *   RCM-02  surface bertanda: contextmenu TIDAK diblokir
 *   RCM-03  Owner Dashboard menandai dirinya + memuat guard terbaru
 *   RCM-04  surface lain tidak ikut berubah
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const GUARD_PATH = path.join(__dirname, '../apps/customer-pwa/assets/js/core/pwa-interaction-guards.js');
const GUARD_SOURCE = fs.readFileSync(GUARD_PATH, 'utf8');

const readHtml = (app) => fs.readFileSync(path.join(__dirname, '../apps', app, 'index.html'), 'utf8');

/** Jalankan guard sungguhan pada DOM, lalu kirim event contextmenu. */
function contextMenuPrevented({ allow }) {
  const dom = new JSDOM(
    '<!doctype html><html' + (allow ? ' data-allow-context-menu' : '') + '><body></body></html>'
  );
  const factory = new Function('document', GUARD_SOURCE);
  factory(dom.window.document);

  const event = new dom.window.Event('contextmenu', { bubbles: true, cancelable: true });
  dom.window.document.dispatchEvent(event);
  return event.defaultPrevented;
}

test('RCM-01: tanpa penanda, click kanan tetap diblokir (perilaku PWA utuh)', () => {
  assert.equal(contextMenuPrevented({ allow: false }), true,
    'surface PWA biasa tetap menonaktifkan menu konteks');
});

test('RCM-02: surface bertanda data-allow-context-menu bisa click kanan', () => {
  assert.equal(contextMenuPrevented({ allow: true }), false,
    'menu konteks browser tidak lagi di-preventDefault di Owner');
});

test('RCM-03: Owner Dashboard mengaktifkan click kanan', () => {
  const html = readHtml('merchant-dashboard');
  assert.ok(/<html[^>]*data-allow-context-menu/.test(html),
    'Owner Dashboard menandai dirinya mengizinkan menu konteks');
  assert.ok(/pwa-interaction-guards\.js\?v=1\.0\.1/.test(html),
    'memuat guard versi terbaru supaya pengecualiannya benar-benar aktif');
});

test('RCM-04: surface lain tidak ikut berubah', () => {
  ['customer-pwa', 'merchant-app', 'pos-app'].forEach((app) => {
    const html = readHtml(app);
    assert.ok(!/data-allow-context-menu/.test(html),
      app + ' tetap memakai perilaku aplikasi (click kanan nonaktif)');
    assert.ok(/pwa-interaction-guards\.js/.test(html), app + ' tetap memuat guard');
  });
});
