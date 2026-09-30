/**
 * Regression: isolasi state milik Delivery + kebersihan saat switching.
 *
 * Masalah yang dikunci di sini:
 *   Alamat pengiriman, ongkir, diskon ongkir, dan penawaran delivery dulu
 *   disimpan di SATU objek `state` bersama checkout. Akibatnya nilai delivery
 *   berpotensi terbaca/menular ke Pickup, Dine-in, atau Reservasi.
 *
 *   Sekarang nilainya disimpan di state environment Delivery
 *   (core/fulfillment-environments.js). Saat tipe berganti, environment lama
 *   di-unmount: listener dilepas dan state sementaranya dibuang.
 *
 * Yang diuji:
 *   DL-01..03  field delivery hanya ada di environment Delivery, tidak menular
 *   DL-04..05  ongkir/quote sementara, alamat tamu dipertahankan saat kembali
 *   DL-06..09  switching antar semua tipe bersih (unmount + mount, tanpa sisa)
 *   DL-10..11  checkout benar-benar memakai environment Delivery, bukan state
 *              bersama
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MODULE_PATH = path.resolve(
  __dirname, '../../apps/customer-pwa/assets/js/core/fulfillment-environments.js'
);
const CHECKOUT_PATH = path.resolve(
  __dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js'
);

function loadEnvironments() {
  globalThis.window = globalThis;
  delete require.cache[MODULE_PATH];
  require(MODULE_PATH);
  globalThis.window.Xentra.FulfillmentEnvironments.resetAll();
  globalThis.window.Xentra.FulfillmentEnvironments.switchTo('delivery');
  return globalThis.window.Xentra.FulfillmentEnvironments;
}

// ── DL-01..03: field delivery tidak menular ──

test('DL-01: setiap environment punya objek address sendiri, bukan objek bersama', () => {
  const FE = loadEnvironments();
  const delivery = FE.getState('delivery');
  assert.ok(delivery.address && typeof delivery.address === 'object', 'delivery harus punya address');

  ['pickup', 'dine_in', 'reservation'].forEach((type) => {
    const other = FE.getState(type);
    assert.ok(other.address && typeof other.address === 'object', type + ' tetap punya bentuk state seragam');
    assert.notStrictEqual(other.address, delivery.address, type + ' tidak boleh memakai objek address delivery');
    assert.strictEqual(other.deliveryFee, 0, type + ' tidak boleh ikut punya ongkir');
    assert.strictEqual(other.deliveryQuote, null, type + ' tidak boleh ikut punya quote delivery');
  });
});

test('DL-02: menulis alamat/ongkir delivery tidak muncul di tipe lain', () => {
  const FE = loadEnvironments();

  const delivery = FE.getState('delivery');
  delivery.address.formatted_address = 'Jl. Melati 3';
  delivery.address.latitude = -6.9;
  delivery.deliveryFee = 12000;
  delivery.discount = 3000;
  delivery.deliveryQuote = { final_delivery_fee: 12000, eta_minutes: 22 };

  ['pickup', 'dine_in', 'reservation'].forEach((type) => {
    const other = FE.getState(type);
    assert.strictEqual(other.address.formatted_address, '', type + ' tidak boleh mewarisi alamat delivery');
    assert.strictEqual(other.deliveryFee, 0, type + ' tidak boleh mewarisi ongkir');
    assert.strictEqual(other.discount, 0, type + ' tidak boleh mewarisi diskon ongkir');
    assert.strictEqual(other.deliveryQuote, null, type + ' tidak boleh mewarisi quote delivery');
  });

  assert.strictEqual(FE.getState('delivery').deliveryFee, 12000, 'nilai delivery tetap utuh');
});

test('DL-03: payload tipe lain tidak pernah memuat field delivery', () => {
  const FE = loadEnvironments();
  FE.getState('delivery').address.formatted_address = 'Jl. Melati 3';
  FE.getState('delivery').deliveryFee = 12000;

  ['pickup', 'dine_in', 'reservation'].forEach((type) => {
    const p = FE.switchTo(type).payloadFields();
    assert.strictEqual(p.fulfillment.type, type);
    ['table_number', 'table_ids', 'reservation_date', 'guest_count'].forEach((key) => {
      assert.ok(Object.prototype.hasOwnProperty.call(p.fulfillment, key), key + ' harus ada');
    });
  });
});

// ── DL-04..05: sementara vs data tamu saat environment dilepas ──

test('DL-04: ongkir/quote delivery dibuang saat environment di-unmount', () => {
  const FE = loadEnvironments();
  const delivery = FE.getState('delivery');
  delivery.deliveryFee = 15000;
  delivery.discount = 5000;
  delivery.deliveryQuote = { final_delivery_fee: 15000 };
  delivery.address.formatted_address = 'Jl. Melati 3';

  FE.switchTo('pickup');

  const after = FE.getState('delivery');
  assert.strictEqual(after.deliveryFee, 0, 'ongkir sementara harus dibuang');
  assert.strictEqual(after.discount, 0, 'diskon ongkir sementara harus dibuang');
  assert.strictEqual(after.deliveryQuote, null, 'quote delivery harus dibuang');
});

test('DL-05: alamat pengiriman yang sudah diisi tidak hilang saat kembali ke Delivery', () => {
  const FE = loadEnvironments();
  FE.getState('delivery').address.formatted_address = 'Jl. Melati 3';
  FE.getState('delivery').address.latitude = -6.9;

  FE.switchTo('dine_in');
  const back = FE.switchTo('delivery').state;

  assert.strictEqual(back.address.formatted_address, 'Jl. Melati 3', 'alamat tamu harus dipertahankan');
  assert.strictEqual(back.address.latitude, -6.9);
  assert.strictEqual(back.scheduled, false, 'jadwal delivery tetap sementara, jadi ikut dibuang');
});

// ── DL-06..09: switching bersih ──

const ALL_TYPES = ['delivery', 'pickup', 'dine_in', 'reservation'];

test('DL-06: berpindah antar semua pasangan tipe meninggalkan environment lama unmounted', () => {
  const FE = loadEnvironments();

  ALL_TYPES.forEach((from) => {
    ALL_TYPES.forEach((to) => {
      FE.switchTo(from);
      const prev = FE.getActive();
      assert.strictEqual(prev.type, from);

      const next = FE.switchTo(to);
      assert.strictEqual(FE.getActive().type, to, 'tipe aktif harus ' + to);
      assert.strictEqual(next.mounted, true, to + ' harus mounted');
      if (from !== to) {
        assert.strictEqual(prev.mounted, false, from + ' harus unmounted saat pindah ke ' + to);
        assert.strictEqual(prev.listeners.length, 0, 'listener ' + from + ' harus dikosongkan');
      }
    });
  });
});

test('DL-07: listener environment lama mati saat tipe berganti', () => {
  const FE = loadEnvironments();

  const target = {
    handlers: {},
    addEventListener(event, handler) { this.handlers[event] = handler; },
    removeEventListener(event) { delete this.handlers[event]; }
  };

  const deliveryEnv = FE.getActive();
  deliveryEnv.on(target, 'scroll', () => {});
  assert.ok(target.handlers.scroll);

  FE.switchTo('reservation');
  assert.ok(!target.handlers.scroll, 'listener delivery harus dilepas total');
});

test('DL-08: state sementara satu tipe tidak tertinggal ke tipe lain', () => {
  const FE = loadEnvironments();

  const deliveryEnv = FE.getActive();
  deliveryEnv.state.scheduled = true;
  deliveryEnv.state.note = 'jangan telepon';

  const pickup = FE.switchTo('pickup').state;
  assert.strictEqual(pickup.scheduled, false, 'jadwal delivery tidak boleh menular ke pickup');
  assert.strictEqual(pickup.note, '', 'catatan delivery tidak boleh menular ke pickup');
  assert.strictEqual(pickup.type, 'pickup');
});

test('DL-09: kebocoran meja/ reservasi tidak kembali lewat pintu delivery', () => {
  const FE = loadEnvironments();

  FE.getState('dine_in').table_ids = ['tbl_5'];
  FE.getState('reservation').reservationDate = '2026-10-01';

  const p = FE.switchTo('delivery').payloadFields();
  assert.strictEqual(p.fulfillment.type, 'delivery');
  assert.deepStrictEqual(p.fulfillment.table_ids, []);
  assert.strictEqual(p.fulfillment.reservation_date, null);
  assert.strictEqual(FE.getState('delivery').deliveryFee, 0);

  FE.getState('delivery').deliveryFee = 9000;
  assert.strictEqual(FE.getState('pickup').deliveryFee, 0, 'ongkir delivery tidak bocor ke pickup');
});

// ── DL-10..11: checkout memakai environment, bukan state bersama ──

test('DL-10: checkout menyimpan field delivery di environment Delivery, bukan literal state bersama', () => {
  const src = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  assert.ok(src.includes('function deliveryHome()'),
    'harus ada sumber tunggal state delivery');
  assert.ok(src.includes("FulfillmentEnv.getState('delivery')"),
    'field delivery harus dibaca dari environment Delivery');

  // Literal state bersama tidak boleh lagi mendeklarasikan field milik Delivery.
  const stateLiteral = src.slice(src.indexOf('var state = {'), src.indexOf('additionalClientTransactionId: null'));
  assert.ok(!/address:\s*\{/.test(stateLiteral),
    'alamat tidak boleh dideklarasikan di state bersama');
  assert.ok(!/deliveryFee:\s*0/.test(stateLiteral),
    'ongkir tidak boleh dideklarasikan di state bersama');
  assert.ok(!/deliveryQuote:\s*null/.test(stateLiteral),
    'quote delivery tidak boleh dideklarasikan di state bersama');
});

test('DL-11: penggantian tipe selalu lewat switchFulfillmentEnvironment', () => {
  const src = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  assert.ok(src.includes('function switchFulfillmentEnvironment('));
  assert.ok(src.includes('FulfillmentEnv.switchTo(nextType)'),
    'environment harus benar-benar ditukar (unmount lama + mount baru)');

  const direct = src.match(/state\.fulfillment\.type\s*=\s*['"]/g) || [];
  assert.strictEqual(direct.length, 0,
    'tipe tidak boleh ditulis langsung ke state bersama');
});
