'use strict';

/**
 * KONFIGURASI PAYMENT GATEWAY — kredensial & satu gateway online aktif.
 *
 * Yang dikunci di sini:
 *   PGW-01..02  menyimpan kredensial tidak menghapus kredensial provider lain
 *   PGW-03..05  hanya satu gateway online yang aktif, dan hanya yang berkredensial
 *   PGW-06      menyimpan kredensial tidak mengubah gateway yang sedang aktif
 *   PGW-07      tab gateway tidak lagi punya checkbox "aktifkan"
 *   PGW-08      Finance → Payment Methods melaporkan keadaan aktif per gateway
 *
 * Bug yang mendasari: konfigurasi lama dibangun dari nol lalu menimpa seluruhnya,
 * jadi menyimpan tab Midtrans menghapus kredensial DOKU (dan sebaliknya) — praktis
 * kredensial tidak pernah bisa disimpan.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server/database/db');

require('./helpers/demoFixtures.js')();
const app = require('../server/app');

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body != null ? JSON.stringify(body) : null;

    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Host: options.headers && options.headers.Host ? options.headers.Host : 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

const CHECKOUT_PAYMENTS = '/api/v1/admin/settings/commerce/payments';
const FINANCE_METHODS = '/api/v1/admin/finance/payment-methods';

test('PAYMENT GATEWAY — kredensial tersimpan & satu gateway online aktif', async (t) => {
  const ROOT = path.join(__dirname, '..');
  const DASHBOARD_HTML = fs.readFileSync(
    path.join(ROOT, 'apps/merchant-dashboard/index.html'), 'utf8'
  );
  const DASHBOARD_JS = fs.readFileSync(
    path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8'
  );

  let server;
  let ownerToken;
  const BRAND_ID = 'brand_bangjo';

  // Config brand disimpan & dipulihkan: suite lain memakai brand yang sama.
  let originalConfig = null;

  await t.test('0. Setup: server & sesi owner', async () => {
    const row = db.prepare('SELECT default_payment_config FROM brands WHERE id = ?').get(BRAND_ID);
    originalConfig = row ? row.default_payment_config : null;

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));

    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.ok(ownerUser, 'Owner user harus ada');
    ownerToken = global.TokenSessionStore.createSession(ownerUser, BRAND_ID).token;
  });

  t.after(() => {
    if (server) server.close();
    if (originalConfig === null) {
      db.prepare('UPDATE brands SET default_payment_config = NULL WHERE id = ?').run(BRAND_ID);
    } else {
      db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?').run(originalConfig, BRAND_ID);
    }
  });

  const putCredentials = (provider, body) => makeRequest(server,
    { path: CHECKOUT_PAYMENTS + '/' + provider + '/credentials', method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` } }, body);
  const put = (body) => makeRequest(server,
    { path: CHECKOUT_PAYMENTS, method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` } }, body);
  const getSettings = () => makeRequest(server,
    { path: CHECKOUT_PAYMENTS, headers: { Authorization: `Bearer ${ownerToken}` } });
  const getFinance = () => makeRequest(server,
    { path: FINANCE_METHODS, headers: { Authorization: `Bearer ${ownerToken}` } });

  await t.test('PGW-01: menyimpan kredensial Midtrans tidak menghapus kredensial DOKU', async () => {
    // Simpan kredensial DOKU lebih dulu.
    const doku = await put({
      provider: 'doku',
      doku_client_id: 'BRN-0001-DOKU',
      doku_secret_key: 'doku-secret-xyz',
      doku_callback_url: 'https://contoh.test/doku/callback'
    });
    assert.equal(doku.status, 200, 'menyimpan DOKU harus berhasil: ' + JSON.stringify(doku.body));

    // Lalu simpan kredensial Midtrans — tanpa mengirim field DOKU sama sekali.
    const mid = await put({
      server_key: 'SB-Mid-server-AAA',
      client_key: 'SB-Mid-client-BBB',
      merchant_id: 'G123456789'
    });
    assert.equal(mid.status, 200, 'menyimpan Midtrans harus berhasil: ' + JSON.stringify(mid.body));

    const stored = JSON.parse(
      db.prepare('SELECT default_payment_config FROM brands WHERE id = ?').get(BRAND_ID).default_payment_config
    );

    assert.equal(stored.server_key, 'SB-Mid-server-AAA', 'kredensial Midtrans tersimpan');
    assert.equal(stored.client_id, 'BRN-0001-DOKU', 'client_id DOKU TIDAK boleh terhapus');
    assert.equal(stored.secret_key, 'doku-secret-xyz', 'secret_key DOKU TIDAK boleh terhapus');
    assert.equal(stored.callback_url, 'https://contoh.test/doku/callback', 'callback DOKU tetap');
  });

  await t.test('PGW-02: kolom kredensial yang dikosongkan tidak menimpa yang tersimpan', async () => {
    // Form sengaja mengosongkan kolom rahasia (server tidak pernah mengirim balik
    // nilainya), jadi menyimpan tanpa mengisi ulang tidak boleh menghapus.
    const res = await put({ merchant_id: 'G999999999' });
    assert.equal(res.status, 200, 'menyimpan harus berhasil: ' + JSON.stringify(res.body));

    const stored = JSON.parse(
      db.prepare('SELECT default_payment_config FROM brands WHERE id = ?').get(BRAND_ID).default_payment_config
    );
    assert.equal(stored.merchant_id, 'G999999999', 'field yang diisi ikut berubah');
    assert.equal(stored.server_key, 'SB-Mid-server-AAA', 'server_key lama dipertahankan');
    assert.equal(stored.client_key, 'SB-Mid-client-BBB', 'client_key lama dipertahankan');
    assert.equal(stored.secret_key, 'doku-secret-xyz', 'secret_key DOKU lama dipertahankan');
  });

  await t.test('PGW-03: mengaktifkan DOKU otomatis mematikan Midtrans (satu gateway online)', async () => {
    await put({ provider: 'midtrans' });
    let settings = await getSettings();
    assert.equal(settings.body.payment_settings.active_provider, 'midtrans');

    // Menyalakan DOKU: Midtrans harus berhenti aktif, tanpa perlu mematikannya manual.
    const res = await put({ provider: 'doku' });
    assert.equal(res.status, 200, 'mengaktifkan DOKU harus berhasil');

    settings = await getSettings();
    assert.equal(settings.body.payment_settings.active_provider, 'doku', 'DOKU menjadi satu-satunya yang aktif');

    const providers = settings.body.payment_settings.providers;
    const midtrans = providers.find((p) => p.code === 'midtrans');
    const doku = providers.find((p) => p.code === 'doku');
    assert.equal(doku.is_active, true, 'DOKU aktif');
    assert.equal(midtrans.is_active, false, 'Midtrans otomatis tidak aktif');
  });

  await t.test('PGW-04: mematikan seluruh gateway online berarti tidak ada yang aktif', async () => {
    const res = await put({ provider: '' });
    assert.equal(res.status, 200, 'mematikan gateway harus berhasil');

    const settings = await getSettings();
    assert.equal(settings.body.payment_settings.active_provider, '',
      'tidak ada gateway online yang aktif');

    const finance = await getFinance();
    const online = finance.body.payment_methods.filter((m) => m.type === 'online_gateway');
    assert.equal(online.length, 2, 'dua gateway online terdaftar');
    online.forEach((m) => {
      assert.equal(m.is_active_provider, false, m.code + ' harus nonaktif');
    });
  });

  await t.test('PGW-05: gateway tanpa kredensial tidak boleh diaktifkan', async () => {
    // Buang kredensial DOKU, lalu coba nyalakan.
    await put({ provider: '' });
    db.prepare('UPDATE brands SET default_payment_config = ? WHERE id = ?')
      .run(JSON.stringify({ provider: '', server_key: 'SB-Mid-server-AAA', is_production: false }), BRAND_ID);

    const before = await getSettings();
    const res = await put({ provider: 'doku' });

    assert.equal(res.status, 400, 'harus ditolak, bukan diterima diam-diam');
    assert.match(String(res.body.error || ''), /DOKU/i, 'pesannya menyebut gateway yang bermasalah');

    const after = await getSettings();
    assert.equal(after.body.payment_settings.active_provider,
      before.body.payment_settings.active_provider,
      'keadaan aktif tidak berubah saat pengaktifan ditolak');
  });

  await t.test('PGW-06: menyimpan kredensial tidak mengubah gateway yang aktif', async () => {
    await put({ provider: 'midtrans' });

    const before = await getSettings();
    assert.equal(before.body.payment_settings.active_provider, 'midtrans');

    // Persis seperti tab gateway menyimpan: TIDAK ada `provider` di payload.
    const res = await put({
      server_key: 'SB-Mid-server-CCC',
      client_key: 'SB-Mid-client-DDD',
      merchant_id: 'G111222333'
    });
    assert.equal(res.status, 200);

    const after = await getSettings();
    assert.equal(after.body.payment_settings.active_provider, 'midtrans',
      'menyimpan kredensial bukan tindakan mengaktifkan/mematikan gateway');

    const stored = JSON.parse(
      db.prepare('SELECT default_payment_config FROM brands WHERE id = ?').get(BRAND_ID).default_payment_config
    );
    assert.equal(stored.server_key, 'SB-Mid-server-CCC', 'kredensial baru tersimpan');
  });

  await t.test('PGW-07: tab gateway tidak punya checkbox aktifkan, dan tiap tab punya simpan sendiri', () => {
    ['set-payment-midtrans-active', 'set-payment-doku-active'].forEach((id) => {
      assert.ok(!DASHBOARD_HTML.includes(id), id + ' harus sudah dihapus dari markup');
      assert.ok(!DASHBOARD_JS.includes(id), id + ' tidak boleh lagi disentuh JavaScript');
    });

    // Kontrolnya diarahkan ke tempat yang benar.
    assert.ok(/Finance &rarr; Payment Methods/.test(DASHBOARD_HTML),
      'tab gateway harus mengarahkan ke Finance → Payment Methods');

    // Tab Midtrans dan DOKU tetap ada, keduanya dengan tombol simpan.
    assert.ok(DASHBOARD_HTML.includes('id="payment-tab-midtrans"'), 'tab Midtrans tetap ada');
    assert.ok(DASHBOARD_HTML.includes('id="payment-tab-doku"'), 'tab DOKU tetap ada');
    assert.ok(DASHBOARD_HTML.includes('id="btn-save-settings-payments-midtrans"'), 'tombol simpan Midtrans ada');
    assert.ok(DASHBOARD_HTML.includes('id="btn-save-settings-payments-doku"'), 'tombol simpan DOKU ada');

    // Dua pintu masuk terpisah — satu per tab, tidak ada jalur bersama.
    assert.ok(DASHBOARD_JS.includes('function saveSettingsPaymentsMidtrans('),
      'tab Midtrans harus punya fungsi simpan sendiri');
    assert.ok(DASHBOARD_JS.includes('function saveSettingsPaymentsDoku('),
      'tab DOKU harus punya fungsi simpan sendiri');
    assert.ok(!/function saveSettingsPayments\s*\(/.test(DASHBOARD_JS),
      'fungsi simpan bersama yang membaca kedua gateway harus hilang');

    // Pengaturan ini fokus menyimpan kredensial: tidak ada status aktif/nonaktif
    // di tab gateway — itu urusan Finance → Payment Methods.
    ['payment-tab-midtrans-status', 'payment-tab-doku-status'].forEach((id) => {
      assert.ok(!DASHBOARD_HTML.includes(id), 'badge status ' + id + ' harus dihapus dari markup');
      assert.ok(!DASHBOARD_JS.includes(id), 'badge status ' + id + ' tidak boleh lagi disentuh JavaScript');
    });
    assert.ok(!DASHBOARD_JS.includes('updateProviderStatusBadges'),
      'fungsi badge status harus hilang, bukan hanya tidak dipanggil');
    // Dibatasi ke panel payment gateway: di bagian lain dashboard, kata "Aktif"
    // memang dipakai untuk hal yang berbeda.
    const gatewayPanel = DASHBOARD_HTML.slice(
      DASHBOARD_HTML.indexOf('id="settings-panel-commerce-payments"'),
      DASHBOARD_HTML.indexOf('id="settings-panel-commerce-fulfillment"')
    );
    assert.ok(gatewayPanel.length > 0, 'panel payment gateway harus ditemukan');
    assert.ok(!/>Aktif<|>Nonaktif<|>Siap</.test(gatewayPanel),
      'panel kredensial tidak boleh menampilkan status Aktif/Nonaktif/Siap');

    // Tiap tombol menunjuk ke fungsinya masing-masing.
    assert.ok(DASHBOARD_HTML.includes('id="form-settings-payments-midtrans" onsubmit="saveSettingsPaymentsMidtrans(event)"'),
      'form Midtrans menuju fungsi Midtrans');
    assert.ok(DASHBOARD_HTML.includes('id="form-settings-payments-doku" onsubmit="saveSettingsPaymentsDoku(event)"'),
      'form DOKU menuju fungsi DOKU');
  });

  await t.test('PGW-09: environment tiap provider hanya memuat field & endpoint miliknya', () => {
    const envSrc = DASHBOARD_JS.slice(
      DASHBOARD_JS.indexOf('function createGatewayEnv('),
      DASHBOARD_JS.indexOf('var gatewayEnvs = {')
    );
    assert.ok(envSrc.length > 0, 'createGatewayEnv harus ada');
    assert.ok(envSrc.includes("'/admin/settings/commerce/payments/' + spec.key + '/credentials'"),
      'simpan menuju endpoint milik provider itu sendiri');

    const midtransSpec = DASHBOARD_JS.slice(
      DASHBOARD_JS.indexOf('midtrans: createGatewayEnv({'),
      DASHBOARD_JS.indexOf('doku: createGatewayEnv({')
    );
    const dokuSpec = DASHBOARD_JS.slice(
      DASHBOARD_JS.indexOf('doku: createGatewayEnv({'),
      DASHBOARD_JS.indexOf('// Dua pintu masuk terpisah')
    );

    assert.ok(!/doku_/.test(midtransSpec), 'environment Midtrans tidak boleh memuat field DOKU');
    assert.ok(!/server_key|client_key|merchant_id/.test(dokuSpec),
      'environment DOKU tidak boleh memuat field Midtrans');

    assert.ok(midtransSpec.includes("productionKey: 'is_production'"),
      'Midtrans memakai flag produksinya sendiri');
    assert.ok(dokuSpec.includes("productionKey: 'doku_is_production'"),
      'DOKU memakai flag produksinya sendiri');

    // Tidak ada lingkungan yang memuat ulang tab lain: pemuatan hanya menyentuh
    // elemen miliknya sendiri, lewat daftar `fields` miliknya.
    assert.ok(DASHBOARD_JS.includes('gatewayEnvs.midtrans.load(ps)') &&
      DASHBOARD_JS.includes('gatewayEnvs.doku.load(ps)'),
      'tiap environment memuat bagiannya sendiri');
    assert.ok(!DASHBOARD_JS.includes('switchPaymentTab(activeProvider);\n      } catch'),
      'pemuatan ulang tidak boleh memindahkan tab yang sedang dilihat');
  });

  await t.test('PGW-11: endpoint kredensial per provider hanya menulis provider itu', async () => {
    await putCredentials('midtrans', { server_key: 'MK-1', client_key: 'CK-1', merchant_id: 'M-1', is_production: false });
    await putCredentials('doku', { doku_client_id: 'DK-1', doku_secret_key: 'DS-1', doku_callback_url: 'https://contoh.test/cb', doku_is_production: false });

    const readStored = () => JSON.parse(
      db.prepare('SELECT default_payment_config FROM brands WHERE id = ?').get(BRAND_ID).default_payment_config
    );

    // Menyimpan DOKU hanya menyentuh DOKU.
    const dokuRes = await putCredentials('doku', { doku_client_id: 'DK-2' });
    assert.equal(dokuRes.status, 200, 'simpan DOKU harus berhasil');
    assert.equal(dokuRes.body.provider, 'doku', 'respons menyebut provider yang disimpan');

    let stored = readStored();
    assert.equal(stored.client_id, 'DK-2', 'client_id DOKU diperbarui');
    assert.equal(stored.secret_key, 'DS-1', 'rahasia DOKU yang tidak diisi tetap');
    assert.equal(stored.server_key, 'MK-1', 'server_key Midtrans TIDAK tersentuh');
    assert.equal(stored.client_key, 'CK-1', 'client_key Midtrans TIDAK tersentuh');
    assert.equal(stored.merchant_id, 'M-1', 'merchant_id Midtrans TIDAK tersentuh');

    // Menyimpan Midtrans hanya menyentuh Midtrans.
    const midRes = await putCredentials('midtrans', { server_key: 'MK-2', is_production: true });
    assert.equal(midRes.status, 200, 'simpan Midtrans harus berhasil');
    assert.equal(midRes.body.provider, 'midtrans');

    stored = readStored();
    assert.equal(stored.server_key, 'MK-2', 'server_key diperbarui');
    assert.equal(stored.client_id, 'DK-2', 'client_id DOKU TIDAK tersentuh');
    assert.equal(stored.secret_key, 'DS-1', 'rahasia DOKU TIDAK tersentuh');
    assert.equal(stored.is_production, true, 'environment Midtrans berubah');
    assert.equal(stored.doku_is_production, false, 'environment DOKU TIDAK ikut berubah');

    // Provider yang tidak dikenal ditolak, bukan disimpan diam-diam.
    const bad = await putCredentials('qris', { server_key: 'X' });
    assert.equal(bad.status, 400, 'provider tak dikenal harus ditolak');
  });

  await t.test('PGW-10: environment tiap gateway berdiri sendiri', async () => {
    // Midtrans ke produksi.
    await put({ is_production: true });
    let settings = await getSettings();
    assert.equal(settings.body.payment_settings.is_production, true, 'Midtrans produksi');
    assert.equal(settings.body.payment_settings.doku_is_production, false,
      'DOKU tidak boleh ikut ke produksi');

    let finance = await getFinance();
    let online = finance.body.payment_methods.filter((m) => m.type === 'online_gateway');
    assert.equal(online.find((m) => m.code === 'midtrans').environment, 'production');
    assert.equal(online.find((m) => m.code === 'doku').environment, 'sandbox',
      'label lingkungan DOKU harus tetap sandbox');

    // DOKU ke produksi: Midtrans tidak ikut berubah.
    await put({ doku_is_production: true });
    settings = await getSettings();
    assert.equal(settings.body.payment_settings.doku_is_production, true, 'DOKU produksi');
    assert.equal(settings.body.payment_settings.is_production, true,
      'Midtrans tetap seperti sebelumnya');

    finance = await getFinance();
    online = finance.body.payment_methods.filter((m) => m.type === 'online_gateway');
    assert.equal(online.find((m) => m.code === 'doku').environment, 'production');
  });

  await t.test('PGW-12: form bisa menampilkan kredensial tersimpan, tanpa membocorkan rahasia', async () => {
    await putCredentials('midtrans', { server_key: 'MK-SECRET', client_key: 'CK-SECRET', merchant_id: 'M-VISIBLE' });
    await putCredentials('doku', { doku_client_id: 'BRN-VISIBLE', doku_secret_key: 'DK-SECRET', doku_callback_url: 'https://contoh.test/cb' });

    const res = await getSettings();
    const ps = res.body.payment_settings;

    // Yang BUKAN rahasia dikirim balik, supaya bisa ditampilkan di form. Tanpa ini
    // kolomnya selalu kosong dan simpanannya tampak hilang.
    assert.equal(ps.merchant_id, 'M-VISIBLE', 'merchant_id Midtrans ditampilkan');
    assert.equal(ps.doku_client_id, 'BRN-VISIBLE', 'Client ID DOKU ditampilkan');
    assert.equal(ps.doku_callback_url, 'https://contoh.test/cb', 'Callback URL DOKU ditampilkan');

    // Rahasia TIDAK boleh ikut terkirim — hanya statusnya.
    assert.equal(ps.server_key, undefined, 'server_key tidak boleh dikirim');
    assert.equal(ps.client_key, undefined, 'client_key tidak boleh dikirim');
    assert.equal(ps.doku_secret_key, undefined, 'secret key DOKU tidak boleh dikirim');
    assert.ok(!JSON.stringify(ps).includes('SECRET'), 'tidak ada nilai rahasia yang bocor');
    assert.equal(ps.server_key_configured, true, 'status rahasia Midtrans dilaporkan');
    assert.equal(ps.doku_secret_key_configured, true, 'status rahasia DOKU dilaporkan');
  });

  await t.test('PGW-13: environment DOKU mengisi kolom non-rahasia dan menandai yang tersimpan', () => {
    const dokuSpec = DASHBOARD_JS.slice(
      DASHBOARD_JS.indexOf('doku: createGatewayEnv({'),
      DASHBOARD_JS.indexOf('// Dua pintu masuk terpisah')
    );
    assert.ok(dokuSpec.includes("doku_client_id: 'doku_client_id'"),
      'Client ID DOKU harus diisi dari respons');
    assert.ok(dokuSpec.includes("doku_callback_url: 'doku_callback_url'"),
      'Callback URL DOKU harus diisi dari respons');
    assert.ok(dokuSpec.includes("doku_secret_key: 'doku_secret_key_configured'"),
      'secret key hanya ditandai tersimpan, bukan diisi nilainya');

    const midtransSpec = DASHBOARD_JS.slice(
      DASHBOARD_JS.indexOf('midtrans: createGatewayEnv({'),
      DASHBOARD_JS.indexOf('doku: createGatewayEnv({')
    );
    assert.ok(midtransSpec.includes("merchant_id: 'merchant_id'"), 'merchant_id diisi');
    assert.ok(!/populated:\s*\{[^}]*server_key/.test(midtransSpec),
      'server_key tidak boleh diisi nilainya di form');

    // Placeholder kolom rahasia berubah saat sudah tersimpan, supaya tidak tampak kosong.
    assert.ok(DASHBOARD_JS.includes('Tersimpan — isi hanya jika ingin mengganti'),
      'kolom rahasia yang tersimpan harus memberi tanda jelas');
  });

  await t.test('PGW-08: toggle Finance memakai keadaan AKTIF, bukan sekadar "kredensial ada"', async () => {
    const finance = await getFinance();
    const online = finance.body.payment_methods.filter((m) => m.type === 'online_gateway');
    assert.equal(online.length, 2);
    online.forEach((m) => {
      assert.equal(typeof m.is_active_provider, 'boolean',
        m.code + ' harus melaporkan is_active_provider sebagai boolean');
      assert.equal(typeof m.is_enabled, 'boolean',
        m.code + ' harus tetap melaporkan is_enabled (kredensial tersedia)');
    });

    // Toggle di Finance harus membaca is_active_provider, dan bisa mematikan.
    assert.ok(/m\.is_active_provider === true/.test(DASHBOARD_JS),
      'keadaan hijau toggle diambil dari is_active_provider');
    assert.ok(/provider: enabled \? provider : ''/.test(DASHBOARD_JS),
      'mematikan toggle harus mengirim provider kosong, bukan tetap mengaktifkan');
  });
});
