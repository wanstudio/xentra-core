/**
 * Regression: isolasi environment fulfillment.
 *
 * Masalah yang dikunci di sini:
 *   Dulu checkout punya SATU `state.fulfillment` bersama untuk Delivery, Pickup,
 *   Dine-in, dan Reservation. Akibatnya nilai satu tipe terbaca tipe lain —
 *   memilih meja dine-in lalu pindah ke delivery, dan `table_ids` ikut terkirim
 *   di order delivery.
 *
 * Yang diuji:
 *   ENV-01..03  tiap environment punya state sendiri, tidak ada yang dibagi
 *   ENV-04..06  mengganti tipe = unmount lama + mount baru, listener lama mati
 *   ENV-07..10  payload hanya memuat field milik tipe itu
 *   ENV-11..13  validasi berjalan per tipe
 *   ENV-14..16  pemeriksaan di checkout.js benar-benar memakai isolasi ini
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

// ── ENV-01..03: state terpisah ──

test('ENV-01: setiap environment punya objek state sendiri, bukan objek bersama', () => {
  const FE = loadEnvironments();
  const seen = new Set();
  FE.TYPES.forEach((type) => {
    const env = FE.getState(type);
    assert.ok(env && typeof env === 'object', type + ' harus punya state');
    assert.ok(!seen.has(env), type + ' tidak boleh memakai objek state yang sama dengan tipe lain');
    seen.add(env);
  });
  assert.strictEqual(seen.size, 4, 'empat environment, empat objek state berbeda');
});

test('ENV-02: menulis state satu tipe tidak muncul di tipe lain', () => {
  const FE = loadEnvironments();

  // Tamu memilih meja untuk dine-in.
  const dineIn = FE.getState('dine_in');
  dineIn.table_ids = ['tbl_7'];
  dineIn.tableNumber = '7';
  dineIn.guestCount = 4;

  // Delivery, pickup, reservation tidak boleh ikut terisi.
  ['delivery', 'pickup', 'reservation'].forEach((type) => {
    const other = FE.getState(type);
    assert.deepStrictEqual(other.table_ids, [], type + ' tidak boleh ikut punya table_ids');
    assert.strictEqual(other.tableNumber, '', type + ' tidak boleh ikut punya tableNumber');
  });

  assert.deepStrictEqual(FE.getState('dine_in').table_ids, ['tbl_7'], 'nilai dine-in tetap utuh');
});

test('ENV-03: nilai reservation tidak bocor ke delivery', () => {
  const FE = loadEnvironments();

  const res = FE.getState('reservation');
  res.reservationDate = '2026-09-10';
  res.reservationTime = '19:00';
  res.guestCount = 4;

  const delivery = FE.getState('delivery');
  assert.strictEqual(delivery.reservationDate, '', 'delivery tidak boleh mewarisi tanggal reservasi');
  assert.strictEqual(delivery.guestCount, null, 'delivery tidak punya konsep jumlah tamu');
});

// ── ENV-04..06: switching = unmount + mount ──

test('ENV-04: mengganti tipe meng-unmount yang lama dan me-mount yang baru', () => {
  const FE = loadEnvironments();

  const deliveryEnv = FE.getActive();
  assert.strictEqual(deliveryEnv.type, 'delivery');
  assert.strictEqual(deliveryEnv.mounted, true);

  const next = FE.switchTo('dine_in');
  assert.strictEqual(next.type, 'dine_in');
  assert.strictEqual(next.mounted, true, 'environment baru harus mounted');
  assert.strictEqual(deliveryEnv.mounted, false, 'environment lama harus ter-unmount');
  assert.strictEqual(FE.getActive().type, 'dine_in');
});

test('ENV-05: listener environment lama dilepas saat tipe berganti', () => {
  const FE = loadEnvironments();

  const fired = [];
  const target = {
    handlers: {},
    addEventListener(event, handler) { this.handlers[event] = handler; },
    removeEventListener(event) { delete this.handlers[event]; }
  };

  const deliveryEnv = FE.getActive();
  deliveryEnv.on(target, 'scroll', () => fired.push('delivery'));
  assert.ok(target.handlers.scroll, 'listener terpasang saat mounted');

  FE.switchTo('pickup');

  assert.ok(!target.handlers.scroll, 'listener tipe lama harus sudah dilepas');
  assert.strictEqual(deliveryEnv.listeners.length, 0, 'daftar listener lama dikosongkan');
});

test('ENV-06: state sementara tipe lama dibuang, jadi tidak ada sisa saat kembali', () => {
  const FE = loadEnvironments();

  const deliveryEnv = FE.getActive();
  deliveryEnv.state.scheduled = true;
  deliveryEnv.state.date = 'Besok';
  deliveryEnv.state.timeSlot = '18:00-18:30';

  FE.switchTo('dine_in');
  const back = FE.switchTo('delivery');

  assert.strictEqual(back.state.scheduled, false, 'jadwal delivery lama tidak boleh tertinggal');
  assert.strictEqual(back.state.date, 'Hari Ini');
});

// ── ENV-07..10: payload per tipe ──

test('ENV-07: payload delivery tidak pernah memuat field meja', () => {
  const FE = loadEnvironments();

  // Meja dine-in sudah terisi, lalu tamu pindah ke delivery.
  FE.getState('dine_in').table_ids = ['tbl_9'];
  FE.getState('dine_in').tableNumber = '9';
  FE.switchTo('delivery');

  const p = FE.getActive().payloadFields();
  assert.strictEqual(p.fulfillment.type, 'delivery');
  assert.deepStrictEqual(p.fulfillment.table_ids, [], 'order delivery tidak boleh membawa meja');
  assert.strictEqual(p.fulfillment.table_number, null);
  assert.strictEqual(p.fulfillment.reservation_date, null);
  assert.strictEqual(p.fulfillment.guest_count, null);
});

test('ENV-08: payload dine-in membawa meja, dan bukan field reservasi', () => {
  const FE = loadEnvironments();
  const p = FE.switchTo('dine_in').payloadFields();

  assert.strictEqual(p.fulfillment.type, 'dine_in');
  assert.strictEqual(p.fulfillment.reservation_date, null, 'dine-in tidak memakai tanggal reservasi');
});

test('ENV-09: payload reservation membawa tanggal, dan bukan meja', () => {
  const FE = loadEnvironments();
  const env = FE.switchTo('reservation');
  env.state.reservationDate = '2026-09-10';

  const p = env.payloadFields();
  assert.strictEqual(p.fulfillment.type, 'reservation');
  assert.strictEqual(p.fulfillment.reservation_date, '2026-09-10');
  assert.deepStrictEqual(p.fulfillment.table_ids, [], 'reservasi bukan pesanan meja');
});

test('ENV-10: field netral selalu dikirim, jadi bentuk payload di server tidak berubah', () => {
  const FE = loadEnvironments();
  const p = FE.switchTo('pickup').payloadFields();

  ['table_number', 'table_ids', 'reservation_date', 'guest_count'].forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(p.fulfillment, key), key + ' harus ada');
    assert.ok(Object.prototype.hasOwnProperty.call(p.topLevel, key), key + ' harus ada di top level');
  });
  assert.strictEqual(p.fulfillment.type, 'pickup');
});

// ── ENV-11..13: validasi per tipe ──

test('ENV-11: dine-in menuntut meja, delivery tidak peduli meja', () => {
  const FE = loadEnvironments();

  const dineIn = FE.switchTo('dine_in');
  assert.strictEqual(dineIn.validate({}).ok, false, 'dine-in tanpa meja harus ditolak');
  dineIn.state.table_ids = ['tbl_3'];
  assert.strictEqual(dineIn.validate({}).ok, true, 'dine-in dengan meja boleh lanjut');

  const delivery = FE.switchTo('delivery');
  assert.strictEqual(delivery.validate({ hasAddress: true }).ok, true);
});

test('ENV-12: delivery menuntut alamat, pickup menuntut cabang', () => {
  const FE = loadEnvironments();

  const delivery = FE.switchTo('delivery');
  assert.strictEqual(delivery.validate({ hasAddress: false }).ok, false, 'delivery tanpa alamat harus ditolak');
  assert.strictEqual(delivery.validate({ hasAddress: true }).ok, true);

  const pickup = FE.switchTo('pickup');
  assert.strictEqual(pickup.validate({ branchId: null }).ok, false, 'pickup tanpa cabang harus ditolak');
  assert.strictEqual(pickup.validate({ branchId: 'br_1' }).ok, true);
});

test('ENV-13: reservasi menuntut tanggal, dan pesannya tidak berubah', () => {
  const FE = loadEnvironments();
  const res = FE.switchTo('reservation');

  const before = res.validate({});
  assert.strictEqual(before.ok, false);
  assert.strictEqual(before.message, 'Silakan pilih tanggal reservasi terlebih dahulu.');

  res.state.reservationDate = '2026-09-10';
  assert.strictEqual(res.validate({}).ok, true);
});

// ── ENV-14..16: integrasi di checkout.js ──

test("ENV-14: checkout memakai switchFulfillmentEnvironment, bukan menulis tipe langsung", () => {
  const src = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  assert.ok(src.includes('function switchFulfillmentEnvironment('), 'harus ada pengalih environment');
  assert.ok(src.includes("switchFulfillmentEnvironment(draft.type)"),
    'konfirmasi sheet harus mengalihkan environment');
  assert.ok(src.includes("switchFulfillmentEnvironment('dine_in')"),
    'scan QR meja harus mengalihkan ke environment dine-in');

  // Tidak boleh ada lagi penulisan tipe langsung yang melewati pengalihan.
  const direct = src.match(/state\.fulfillment\.type\s*=\s*['"]/g) || [];
  assert.strictEqual(direct.length, 0,
    'tipe tidak boleh ditulis langsung; harus lewat switchFulfillmentEnvironment()');
});

test('ENV-15: payload order dibangun dari environment, bukan dari state bersama', () => {
  const src = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  assert.ok(src.includes('var envPayload = buildFulfillmentPayload();'),
    'payload harus lewat buildFulfillmentPayload()');
  assert.ok(src.includes('fulfillment: envPayload.fulfillment'));
  assert.ok(src.includes('reservation_date: envPayload.topLevel.reservation_date'));

  // Yang lama: field tipe lain dibaca langsung dari state bersama.
  assert.ok(!src.includes('table_ids: Array.isArray(state.fulfillment.table_ids)'),
    'payload tidak boleh membaca meja langsung dari state bersama');
  assert.ok(!src.includes('reservation_date: state.fulfillment.reservationDate'),
    'payload tidak boleh membaca tanggal reservasi langsung dari state bersama');
});

test('ENV-16: claim QR meja memakai cabang yang sedang dipakai, bukan variabel tak dikenal', () => {
  const src = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  assert.ok(src.includes('function claimBranchId()'),
    'claimBranchId harus didefinisikan di checkout');
  assert.ok(src.includes('branch_id: claimBranchId()'),
    'klaim meja mengirim cabang tempat kode meja dipakai');
});

test('ENV-17: normalisasi tipe lama dinein tetap diterima', () => {
  const FE = loadEnvironments();
  assert.strictEqual(FE.normalize('dinein'), 'dine_in');
  assert.strictEqual(FE.switchTo('dinein').type, 'dine_in',
    'nilai lama dari penyimpanan tetap dipetakan ke environment yang benar');
});
