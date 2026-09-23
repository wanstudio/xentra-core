/**
 * Isolasi environment payment gateway.
 *
 * Provider aktif harus berdiri sendiri. Ketika DOKU yang aktif, tidak boleh ada satu
 * pun ketergantungan ke Midtrans: tidak memuat Snap.js, tidak menyentuh window.snap,
 * dan tidak meminta kredensial Midtrans. Sebaliknya juga.
 *
 * Modulnya dijalankan sungguhan di sandbox kecil (window/document tiruan), jadi yang
 * diuji perilakunya — bukan kecocokan teks.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MODULE_PATH = path.resolve(
  __dirname, '../../apps/customer-pwa/assets/js/core/payment-gateway.js'
);
const CHECKOUT_PATH = path.resolve(
  __dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js'
);
const ORDER_RECEIVED_PATH = path.resolve(
  __dirname, '../../apps/customer-pwa/assets/js/pages/order-received.js'
);
const API_PATH = path.resolve(__dirname, '../../server/routes/api.js');

/**
 * Sandbox: window/document tiruan. `scripts` mencatat setiap <script> yang disuntikkan,
 * jadi bisa dibuktikan apakah Snap.js dimuat atau tidak.
 */
function loadGateway(config) {
  const scripts = [];
  const snapCalls = [];

  const doc = {
    head: {
      appendChild(script) {
        scripts.push(script);
        if (typeof script.onload === 'function') script.onload();
      }
    },
    getElementById() { return null; },
    createElement() {
      return { id: '', src: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    }
  };

  const win = {
    Xentra: {
      API: { get: () => Promise.resolve({ success: true, payment_gateway: config }) }
    },
    location: { href: '' },
    document: doc
  };

  globalThis.window = win;
  globalThis.document = doc;
  delete require.cache[MODULE_PATH];
  require(MODULE_PATH);

  // Snap "tersedia" hanya setelah script-nya benar-benar dimuat — persis seperti
  // di browser, di mana window.snap ada karena Snap.js selesai dimuat.
  doc.head.appendChild = function (script) {
    scripts.push(script);
    if (script.src && String(script.src).indexOf('snap') !== -1) {
      win.snap = { pay: (token, handlers) => snapCalls.push({ token: token, handlers: handlers }) };
    }
    if (typeof script.onload === 'function') script.onload();
  };

  return { win, scripts, snapCalls, gateway: win.Xentra.PaymentGateway };
}

const DOKU_CONFIG = {
  active_provider: 'doku',
  active_provider_configured: true,
  midtrans_client_key: '',
  midtrans_is_production: false,
  snap_script_url: 'https://app.sandbox.midtrans.com/snap/snap.js'
};

const MIDTRANS_CONFIG = {
  active_provider: 'midtrans',
  active_provider_configured: true,
  midtrans_client_key: 'SB-Mid-client-TEST',
  midtrans_is_production: false,
  snap_script_url: 'https://app.sandbox.midtrans.com/snap/snap.js'
};

// ── 1. DOKU aktif + Midtrans kosong → DOKU tetap bisa bayar ──

test('PGISO-01: DOKU aktif dengan Midtrans kosong tetap bisa membayar', async () => {
  const { win, gateway } = loadGateway(DOKU_CONFIG);
  const result = await gateway.pay({
    snapToken: null,
    redirectUrl: 'https://pay.doku.test/checkout/abc',
    handlers: {}
  });

  assert.equal(result.opened, 'redirect', 'DOKU dibuka lewat pengalihan');
  assert.equal(result.provider, 'doku');
  assert.equal(win.location.href, 'https://pay.doku.test/checkout/abc',
    'customer diarahkan ke halaman pembayaran DOKU');
  assert.equal(gateway.activeProvider(), 'doku');
});

// ── 2 & 3. DOKU aktif → Snap.js tidak dimuat, tidak ada window.snap ──

test('PGISO-02: DOKU aktif tidak memuat Snap.js sama sekali', async () => {
  const { scripts, gateway } = loadGateway(DOKU_CONFIG);
  await gateway.pay({ redirectUrl: 'https://pay.doku.test/x', handlers: {} });

  assert.equal(scripts.length, 0, 'tidak ada <script> yang disuntikkan saat DOKU aktif');
  assert.ok(!scripts.some((s) => String(s.src).includes('snap')), 'Snap.js tidak boleh dimuat');
});

test('PGISO-03: DOKU aktif tidak menyentuh window.snap', async () => {
  const { win, gateway } = loadGateway(DOKU_CONFIG);
  await gateway.pay({ redirectUrl: 'https://pay.doku.test/x', handlers: {} });

  assert.equal(win.snap, undefined, 'window.snap tidak boleh dibuat/diakses');
  // ensureSnap() pun tidak boleh dipakai di jalur DOKU.
  await assert.rejects(
    () => gateway.ensureSnap(),
    (err) => err.message === 'MIDTRANS_CLIENT_KEY_MISSING',
    'meminta Snap saat DOKU aktif harus gagal, bukan diam-diam memakai Midtrans'
  );
});

// ── 4. DOKU payment.url → redirect ke DOKU ──

test('PGISO-04: DOKU memakai tautan pembayaran gateway untuk mengalihkan', async () => {
  const { win, gateway } = loadGateway(DOKU_CONFIG);
  await gateway.pay({ redirectUrl: 'https://pay.doku.test/checkout/order-9', handlers: {} });
  assert.equal(win.location.href, 'https://pay.doku.test/checkout/order-9');

  // Tanpa tautan, DOKU tidak boleh jatuh kembali ke Snap — harus mengaku terus terang.
  const second = loadGateway(DOKU_CONFIG);
  await assert.rejects(
    () => second.gateway.pay({ snapToken: 'tok', handlers: {} }),
    (err) => err.message === 'DOKU_REDIRECT_MISSING',
    'DOKU tanpa tautan tidak boleh memakai Snap sebagai gantinya'
  );
  assert.equal(second.scripts.length, 0, 'tetap tidak memuat Snap.js');
});

// ── 5. Midtrans aktif + DOKU kosong → Midtrans tetap bisa bayar ──

test('PGISO-05: Midtrans aktif dengan DOKU kosong tetap bisa membayar', async () => {
  const { win, scripts, snapCalls, gateway } = loadGateway(MIDTRANS_CONFIG);
  const result = await gateway.pay({ snapToken: 'snap-token-1', handlers: {} });

  assert.equal(result.opened, 'snap');
  assert.equal(result.provider, 'midtrans');
  assert.equal(snapCalls.length, 1, 'Snap dipanggil sekali');
  assert.equal(snapCalls[0].token, 'snap-token-1');
  assert.equal(win.location.href, '', 'Midtrans tidak mengalihkan halaman sendiri');
  assert.equal(scripts.length, 1, 'Snap.js dimuat');
});

// ── 6. Midtrans aktif → Snap.js tetap bekerja ──

test('PGISO-06: Snap.js dimuat dengan Client Key yang dikonfigurasi', async () => {
  const { scripts, gateway } = loadGateway(MIDTRANS_CONFIG);
  await gateway.pay({ snapToken: 't', handlers: {} });

  const snapScript = scripts.find((s) => String(s.src).includes('snap.js'));
  assert.ok(snapScript, 'Snap.js harus dimuat saat Midtrans aktif');
  assert.equal(snapScript.attrs['data-client-key'], 'SB-Mid-client-TEST',
    'Snap.js memakai client key dari konfigurasi');
  assert.ok(String(snapScript.src).includes('sandbox'), 'environment sandbox dipakai');
});

// ── 7. Switching tidak membawa dependency provider sebelumnya ──

test('PGISO-07: berpindah provider tidak membawa dependency provider sebelumnya', async () => {
  // Sesi DOKU lebih dulu: tidak ada Snap sama sekali.
  const dokuSession = loadGateway(DOKU_CONFIG);
  await dokuSession.gateway.pay({ redirectUrl: 'https://pay.doku.test/a', handlers: {} });
  assert.equal(dokuSession.scripts.length, 0, 'sesi DOKU bersih dari Snap.js');

  // Berpindah ke Midtrans: mulai dari keadaan bersih, Snap dimuat karena memang perlu.
  const midtransSession = loadGateway(MIDTRANS_CONFIG);
  await midtransSession.gateway.pay({ snapToken: 'x', handlers: {} });
  assert.equal(midtransSession.scripts.length, 1, 'sesi Midtrans memuat Snap.js sendiri');
  assert.ok(!dokuSession.win.snap, 'window.snap tetap tidak ada di sesi DOKU');

  // Dan sebaliknya: sesi Midtrans yang berpindah ke DOKU tidak memakai Snap lagi.
  const backToDoku = loadGateway(DOKU_CONFIG);
  await backToDoku.gateway.pay({ redirectUrl: 'https://pay.doku.test/b', handlers: {} });
  assert.equal(backToDoku.scripts.length, 0, 'kembali ke DOKU tidak memakai Snap.js');
  assert.equal(backToDoku.win.location.href, 'https://pay.doku.test/b');
});

// ── 8. Server Secret Key tidak pernah dikirim ke browser ──

test('PGISO-08: Server Key tidak pernah ikut ke browser', () => {
  const api = fs.readFileSync(API_PATH, 'utf8');
  const endpoint = api.slice(
    api.indexOf("router.get('/payment/config'"),
    api.indexOf("router.get('/brand/info'")
  );
  assert.ok(endpoint.length > 0, 'endpoint konfigurasi gateway harus ada');
  // server_key memang dibaca di server untuk menilai kesiapan — yang dilarang adalah
  // memasukkannya ke respons.
  assert.ok(!/server_key\s*:/.test(endpoint), 'server key tidak boleh ada di respons');
  assert.ok(!/secret_key\s*:/.test(endpoint), 'secret key DOKU tidak boleh ada di respons');
  assert.ok(endpoint.includes('midtrans_client_key'), 'yang boleh keluar hanya client key');
  assert.ok(endpoint.includes('active_provider_configured'),
    'kesiapan diukur dari provider yang aktif');
});

// ── Pemeriksaan konfigurasi mengikuti provider aktif, bukan semua provider ──

test('PGISO-09: kesiapan dinilai dari provider aktif saja', () => {
  const api = fs.readFileSync(API_PATH, 'utf8');
  const endpoint = api.slice(
    api.indexOf("router.get('/payment/config'"),
    api.indexOf("router.get('/brand/info'")
  );
  assert.ok(/activeProvider === 'doku'/.test(endpoint),
    'DOKU aktif dinilai dari kredensial DOKU saja');
  assert.ok(/cfg\.client_id && cfg\.secret_key/.test(endpoint),
    'DOKU tidak boleh meminta kredensial Midtrans');
});

// ── Checkout & order-received tidak menebak provider sendiri ──

test('PGISO-10: checkout dan order-received memakai modul, tidak menulis "midtrans"', () => {
  const checkout = fs.readFileSync(CHECKOUT_PATH, 'utf8');
  const received = fs.readFileSync(ORDER_RECEIVED_PATH, 'utf8');

  // Memilih pembayaran online tidak boleh mengunci ke salah satu provider.
  assert.ok(!/state\.paymentMethod = 'midtrans'/.test(checkout),
    'pemilihan pembayaran online tidak boleh hardcode Midtrans');
  assert.ok(checkout.includes('onlinePaymentMethod()'), 'provider diambil dari modul');
  assert.ok(checkout.includes('isOnlinePayment('), 'pemeriksaan online tidak hardcode provider');

  // Order-received juga tidak boleh menganggap online == Midtrans.
  assert.ok(!/var isOnline = payMethod ===/.test(received),
    'order-received tidak boleh menyamakan online dengan Midtrans');
  assert.ok(received.includes('isOnlineMethod(payMethod)'), 'memakai pemeriksaan dari modul');
  assert.ok(received.includes('isOnlineMethod(payMethod)'),
    'order-received memakai pemeriksaan dari modul');

  // Tidak ada nama provider yang ditulis tangan di halaman: modul yang tahu namanya.
  assert.ok(!/state\.paymentMethod === 'midtrans'/.test(checkout),
    'pilihan online tidak boleh membandingkan dengan nama provider');
  assert.ok(checkout.includes('isOnlinePayment(state.paymentMethod)'),
    'pilihan online memakai pemeriksaan dari modul');
  assert.ok(!/Online Pay \(Midtrans/.test(received),
    'label tidak boleh menuliskan nama provider sendiri');
  assert.ok(received.includes('onlinePayLabel('), 'label diambil dari modul');

  // Registry provider tinggal di satu tempat.
  const moduleSrc = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.ok(moduleSrc.includes('var PROVIDERS = {'), 'nama provider terdaftar di modul');
  assert.ok(moduleSrc.includes('function onlineLabel('), 'modul menyediakan label');
});
