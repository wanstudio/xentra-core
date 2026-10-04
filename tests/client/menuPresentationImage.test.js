'use strict';

/**
 * CUSTOMER PWA — foto Menu (bukan foto Product).
 *
 * Contract: docs/decisions/xentra-menu-presentation-media-v1.md
 *
 *   CPI-01  kartu katalog memakai foto Menu untuk Satuan DAN Paket
 *   CPI-02  tidak ada lagi derivasi foto dari komponen Product
 *   CPI-03  Menu tanpa foto tampil sebagai placeholder netral (bukan foto Product)
 *   CPI-04  checkout memakai foto Menu
 *   CPI-05  resolving tetap canonical-first (variants → preview → legacy image_url)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOME_JS = fs.readFileSync(path.join(__dirname, '../../apps/customer-pwa/assets/js/pages/home.js'), 'utf8');
const CHECKOUT_JS = fs.readFileSync(path.join(__dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js'), 'utf8');
const MEDIA_JS = fs.readFileSync(path.join(__dirname, '../../apps/customer-pwa/assets/js/core/media.js'), 'utf8');
const HOME_CSS = fs.readFileSync(path.join(__dirname, '../../apps/customer-pwa/assets/css/home.css'), 'utf8');
const SW_JS = fs.readFileSync(path.join(__dirname, '../../apps/customer-pwa/assets/pwa/service-worker.js'), 'utf8');

test('CPI-01: adapter katalog mengambil foto dari Menu, bukan komponen', () => {
  assert.ok(/image_url:\s*menu\.image_url \|\| menu\.image \|\| ''/.test(HOME_JS),
    'image_url berasal dari Menu');
  assert.ok(/media_id:\s*menu\.media_id \|\| null/.test(HOME_JS), 'media_id Menu diteruskan');
  assert.ok(/srcset_variants:\s*Array\.isArray\(menu\.srcset_variants\)/.test(HOME_JS),
    'varian canonical diteruskan supaya delivery memakai derivatif');
});

test('CPI-02: tidak ada derivasi foto dari komponen Product', () => {
  assert.ok(!/componentSnapshot\.length === 1 \? \(componentSnapshot\[0\]\.image_url/.test(HOME_JS),
    'pola lama (foto komponen tunggal) sudah hilang');
  assert.ok(!/components\[0\]\?\.image_url|components\[0\]\.image_url/.test(HOME_JS),
    'tidak ada fallback components[0].image_url');
  assert.ok(!/first \? \(first\.image_url/.test(CHECKOUT_JS), 'checkout tidak memakai komponen pertama');
});

test('CPI-03: Menu tanpa foto tampil sebagai placeholder netral', () => {
  assert.ok(/x-product-image-empty/.test(HOME_JS), 'kartu memakai placeholder netral');
  assert.ok(/\.x-product-image-empty\s*\{/.test(HOME_CSS), 'style placeholder tersedia');
  assert.ok(/background-image:\s*url\("data:image\/svg\+xml/.test(HOME_CSS),
    'placeholder memakai glyph netral, bukan foto Product');
});

test('CPI-04: checkout memakai foto Menu', () => {
  assert.ok(/image_url:\s*menu\.image_url \|\| menu\.image \|\| ''/.test(CHECKOUT_JS));
  assert.ok(/preview_url:\s*menu\.preview_url \|\| null/.test(CHECKOUT_JS));
});

test('CPI-05: urutan resolving tetap canonical-first', () => {
  const resolveBlock = MEDIA_JS.slice(
    MEDIA_JS.indexOf('function resolveProductImg'),
    MEDIA_JS.indexOf('function buildProductImg')
  );
  const variantsIndex = resolveBlock.indexOf('srcset_variants');
  const previewIndex = resolveBlock.indexOf('preview_url');
  const legacyIndex = resolveBlock.indexOf('image_url || product.image');
  assert.ok(variantsIndex > -1 && previewIndex > -1 && legacyIndex > -1, 'tiga tingkat resolusi ada');
  assert.ok(variantsIndex < previewIndex && previewIndex < legacyIndex,
    'canonical derivatives → preview_url → legacy image_url');
});

test('CPI-06: perbaikan parser home.js & cache-bust SW tetap terjaga', () => {
  // home.js sempat rusak di main (extra paren) dan akan membuat seluruh home controller gagal parse.
  assert.ok(!/\}\)\);\s*\n\s*\}/.test(HOME_JS), 'tidak ada penutup ganda yang merusak parser');
  assert.ok(/Release 2026-10-04/.test(SW_JS),
    'SW di-bump agar shell lama terbuang dan perubahan sampai ke klien');
});
