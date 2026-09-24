/**
 * Jalur dari PWA ke payment gateway.
 *
 * Yang rusak sebelumnya: halaman pembayaran memanggil `window.snap.pay()` langsung,
 * padahal Snap.js TIDAK PERNAH dimuat di PWA. Akibatnya `window.snap` selalu kosong,
 * tombol "Bayar Sekarang" selalu jatuh ke pesan "Gateway pembayaran sedang dimuat",
 * dan pesanan tidak pernah bisa dibayar online.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const MODULE = read('apps/customer-pwa/assets/js/core/payment-gateway.js');
const ORDER_RECEIVED = read('apps/customer-pwa/assets/js/pages/order-received.js');
const CHECKOUT = read('apps/customer-pwa/assets/js/pages/checkout.js');
const INDEX = read('apps/customer-pwa/index.html');
const API = read('server/routes/api.js');
const PAYMENT_CONFIG = read('server/routes/payment-config.js');

test('PAYGW-01: Snap.js dimuat dari client key yang dikonfigurasi', () => {
  // Snap.js butuh client key; tanpa itu gateway tidak bisa dibuka sama sekali.
  assert.ok(MODULE.includes("data-client-key"), 'Snap.js harus memuat client key');
  assert.ok(MODULE.includes('midtrans_client_key'), 'client key datang dari konfigurasi');
  assert.ok(MODULE.includes('snap_script_url'), 'alamat snap.js mengikuti environment');
  assert.ok(INDEX.includes('/assets/js/core/payment-gateway.js'),
    'modul harus dimuat oleh PWA, bukan hanya ada di repo');
});

test('PAYGW-02: server key tidak pernah ikut ke browser', () => {
  // Yang boleh keluar hanya client key (publishable). Server key tetap di server.
  assert.ok(!/server_key/.test(MODULE), 'modul PWA tidak boleh menyebut server key');
  const endpoint = PAYMENT_CONFIG.slice(
    PAYMENT_CONFIG.indexOf("router.get('/payment/config'"),
    PAYMENT_CONFIG.lastIndexOf("  });") + 6
  );
  assert.equal(
    (API.match(/router\.get\('\/payment\/config'/g) || []).length,
    0,
    'payment/config implementation must not remain inline in api.js'
  );
  assert.ok(endpoint.length > 0, 'endpoint konfigurasi gateway harus ada di module payment-config.js');
  // server_key dibaca di server untuk menilai kesiapan provider aktif — yang dilarang
  // adalah memasukkannya ke respons.
  assert.ok(!/server_key\s*:/.test(endpoint), 'server key tidak boleh ada di respons');
  assert.ok(!/secret_key\s*:/.test(endpoint), 'secret key DOKU tidak boleh ada di respons');
});

test('PAYGW-03: halaman pembayaran tidak lagi memanggil window.snap langsung', () => {
  ['order-received.js', 'checkout.js'].forEach((f) => {
    const src = f === 'checkout.js' ? CHECKOUT : ORDER_RECEIVED;
    assert.ok(!/window\.snap\.pay\(/.test(src),
      f + ' tidak boleh memanggil window.snap.pay langsung — Snap.js tidak pernah dimuat di sana');
  });
  assert.ok(ORDER_RECEIVED.includes('window.Xentra.PaymentGateway') && ORDER_RECEIVED.includes('Gateway.pay('),
    'order-received memakai modul bersama');
  assert.ok(CHECKOUT.includes('window.Xentra.PaymentGateway') && CHECKOUT.includes('Gateway.pay('),
    'checkout memakai modul bersama');
});

test('PAYGW-04: DOKU punya jalurnya sendiri (tanpa Snap)', () => {
  assert.ok(MODULE.includes('window.location.href = redirectUrl'),
    'DOKU dibuka lewat halaman pembayarannya');
  // Halaman pembayaran mengenali redirect dari gateway, bukan hanya snap token.
  assert.ok(ORDER_RECEIVED.includes('redirect_url'), 'order-received membaca redirect_url');
  assert.ok(ORDER_RECEIVED.includes('snapToken || gatewayRedirectUrl'),
    'tombol Bayar Sekarang muncul untuk kedua gateway');
});

test('PAYGW-05: kegagalan memberi pesan yang berguna, bukan "sedang dimuat"', () => {
  assert.ok(!ORDER_RECEIVED.includes('Gateway pembayaran sedang dimuat'),
    'pesan menyesatkan itu harus hilang');
  assert.ok(MODULE.includes('MIDTRANS_CLIENT_KEY_MISSING'),
    'gateway belum dikonfigurasi harus dibedakan');
  assert.ok(/belum dikonfigurasi/.test(MODULE), 'pesannya menjelaskan keadaan sebenarnya');
  assert.ok(!/window\.snap\s*&&\s*window\.snap\.pay/.test(ORDER_RECEIVED),
    'tidak boleh lagi menebak kesiapan gateway dari window.snap');
});
