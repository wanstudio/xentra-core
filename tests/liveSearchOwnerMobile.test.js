/**
 * Regression: live search (search-as-you-type) Owner Mobile
 * (merchant-shared/js/live-search.js).
 *
 * Kontrak yang dikunci:
 *   - pencarian jalan dari event `input`, tanpa tombol submit
 *   - query kosong mengembalikan default state (bukan "tidak ditemukan")
 *   - case-insensitive + spasi dinormalisasi
 *   - query yang memanggil API pakai debounce (tidak ada request storm)
 *   - nilai yang dikirim ke server adalah nilai asli, bukan query ternormalisasi
 *
 * Yang diuji:
 *   LS-01..03  normalisasi & pencocokan
 *   LS-04..08  perilaku bind: input event, debounce, kosong, Enter, unbind
 *   LS-09..13  wiring halaman: tombol Cari hilang, semua input pakai shared
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const MODULE_PATH = path.join(__dirname, '../apps/merchant-shared/js/live-search.js');
const HTML_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const DASHBOARD_JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');

const moduleSrc = fs.readFileSync(MODULE_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const dashboardJs = fs.readFileSync(DASHBOARD_JS_PATH, 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  dom.window.eval(moduleSrc);
  return dom;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── LS-01..03: normalisasi & pencocokan ──

test('LS-01: normalisasi query (trim, spasi dirapikan, lowercase)', () => {
  const LS = boot().window.XentraLiveSearch;

  assert.strictEqual(LS.normalize('  Ikhwan   Jaya '), 'ikhwan jaya');
  assert.strictEqual(LS.normalize('IKH'), 'ikh');
  assert.strictEqual(LS.normalize(''), '');
  assert.strictEqual(LS.normalize(null), '');
});

test('LS-02: pencocokan case-insensitive dan mengabaikan spasi berlebih', () => {
  const LS = boot().window.XentraLiveSearch;

  assert.strictEqual(LS.matches('Ikhwan Jaya', LS.normalize('ikh')), true);
  assert.strictEqual(LS.matches('ikhwan jaya', LS.normalize('IKHWAN')), true);
  assert.strictEqual(LS.matches('Ikhwan  Jaya', LS.normalize('ikhwan jaya')), true, 'spasi ganda di data tetap cocok');
  assert.strictEqual(LS.matches('Budi', LS.normalize('ikh')), false);
  assert.strictEqual(LS.matches('apa pun', LS.normalize('')), true, 'query kosong cocok dengan semua');
});

test('LS-03: matchesAny memakai salah satu field yang relevan', () => {
  const LS = boot().window.XentraLiveSearch;

  assert.strictEqual(LS.matchesAny(['Ikhwan', '0812'], LS.normalize('0812')), true);
  assert.strictEqual(LS.matchesAny(['Ikhwan', '0812'], LS.normalize('ikh')), true);
  assert.strictEqual(LS.matchesAny(['Ikhwan', '0812'], LS.normalize('zzz')), false);
  assert.strictEqual(LS.matchesAny([null, undefined], LS.normalize('')), true);
});

// ── LS-04..08: perilaku bind ──

test('LS-04: mengetik langsung memicu pencarian tanpa klik/Enter', () => {
  const dom = boot();
  const input = dom.window.document.createElement('input');
  dom.window.document.body.appendChild(input);

  const seen = [];
  dom.window.XentraLiveSearch.bind(input, (s) => seen.push(s.query), { debounce: 0 });

  input.value = 'ikh';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  assert.deepStrictEqual(seen, ['ikh'], 'handler jalan dari event input saja');
});

test('LS-05: debounce menahan request storm (hanya panggilan terakhir yang jalan)', async () => {
  const dom = boot();
  const input = dom.window.document.createElement('input');
  dom.window.document.body.appendChild(input);

  let calls = 0;
  let lastQuery = '';
  dom.window.XentraLiveSearch.bind(input, (s) => { calls += 1; lastQuery = s.query; }, { debounce: 40 });

  ['i', 'ik', 'ikh', 'ikhw', 'ikhwa'].forEach((v) => {
    input.value = v;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });

  assert.strictEqual(calls, 0, 'belum ada panggilan selama user masih mengetik cepat');

  await wait(80);
  assert.strictEqual(calls, 1, 'hanya satu panggilan untuk satu burst ketikan');
  assert.strictEqual(lastQuery, 'ikhwa', 'yang dipakai adalah query terakhir');
});

test('LS-06: query dikosongkan -> empty=true supaya page kembali ke default list', async () => {
  const dom = boot();
  const input = dom.window.document.createElement('input');
  dom.window.document.body.appendChild(input);

  const seen = [];
  dom.window.XentraLiveSearch.bind(input, (s) => seen.push(s), { debounce: 0 });

  input.value = 'ikh';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.strictEqual(seen[0].empty, false);

  input.value = '   ';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.strictEqual(seen[1].empty, true, 'spasi saja dihitung kosong');
  assert.strictEqual(seen[1].query, '');
});

test('LS-07: Enter hanya mempercepat, bukan jalur utama', async () => {
  const dom = boot();
  const input = dom.window.document.createElement('input');
  dom.window.document.body.appendChild(input);

  const seen = [];
  dom.window.XentraLiveSearch.bind(input, (s) => seen.push(s.query), { debounce: 100 });

  input.value = 'ikh';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  assert.deepStrictEqual(seen, ['ikh'], 'Enter memaksa pencarian saat itu juga');
});

test('LS-08: unbind menghentikan listener', () => {
  const dom = boot();
  const input = dom.window.document.createElement('input');
  dom.window.document.body.appendChild(input);

  let calls = 0;
  const unbind = dom.window.XentraLiveSearch.bind(input, () => { calls += 1; }, { debounce: 0 });

  input.value = 'a';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.strictEqual(calls, 1);

  unbind();
  input.value = 'ab';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.strictEqual(calls, 1, 'setelah unbind tidak ada panggilan lagi');
});

// ── LS-09..13: wiring halaman Owner Mobile ──

test('LS-09: tombol "Cari" pada page Pelanggan sudah hilang dari UI dan DOM', () => {
  assert.ok(!html.includes('btn-customers-search'), 'tombol #btn-customers-search harus hilang');
  assert.ok(!/onclick="searchCustomers\(\)"/.test(html), 'tidak boleh ada sisa handler tombol Cari');
  assert.ok(!dashboardJs.includes('function searchCustomers'), 'handler searchCustomers harus dihapus');
  assert.ok(html.includes('id="customers-search-input"'), 'input search tetap ada');

  // Icon search tetap berada di dalam field.
  const block = html.slice(html.indexOf('id="customers-search-input"'));
  assert.ok(block.slice(0, 400).includes('<svg'), 'icon search tetap di dalam input');
});

test('LS-10: keempat search input memakai shared live search', () => {
  ['customers-search-input', 'orders-search-input', 'prod-search-input', 'branch-search-input'].forEach((id) => {
    assert.ok(dashboardJs.includes("bindLiveSearch('" + id + "'"), '#' + id + ' harus lewat bindLiveSearch');
    assert.ok(html.includes('id="' + id + '"'), '#' + id + ' harus ada di markup');
  });

  // Tidak ada lagi listener input manual untuk search input.
  assert.ok(!/searchInput\.addEventListener\('input'/.test(dashboardJs),
    'search input tidak boleh punya listener input manual lagi');
});

test('LS-11: search field jadi full-width tanpa gap sisa tombol', () => {
  const start = html.indexOf('id="customers-search-input"');
  const wrapper = html.slice(html.lastIndexOf('<div', start), html.indexOf('</div>', start));
  assert.ok(!/x-btn-primary/.test(html.slice(start, html.indexOf('Segments Guide View', start))),
    'tidak boleh ada tombol primary (bekas tombol Cari) setelah search input');
  assert.ok(wrapper.includes('position:relative'), 'wrapper input tetap untuk ikon di dalam field');
});

test('LS-12: yang memanggil API pakai debounce, filter client-side tanpa debounce', () => {
  const serverSide = ["'customers-search-input'", "'orders-search-input'"];
  const clientSide = ["'prod-search-input'", "'branch-search-input'"];

  serverSide.forEach((id) => {
    const at = dashboardJs.indexOf('bindLiveSearch(' + id);
    const call = dashboardJs.slice(at, dashboardJs.indexOf('});', at) + 3);
    assert.ok(/debounce:\s*300/.test(call), id + ' memanggil API, harus pakai debounce');
  });
  clientSide.forEach((id) => {
    const at = dashboardJs.indexOf('bindLiveSearch(' + id);
    const call = dashboardJs.slice(at, dashboardJs.indexOf('});', at) + 3);
    assert.ok(/debounce:\s*0/.test(call), id + ' filter client-side, tanpa debounce');
  });
});

test('LS-14: respons usang dibuang supaya hasil lama tidak menimpa hasil baru', () => {
  const custStart = dashboardJs.indexOf('async function loadCustomers');
  const custBody = dashboardJs.slice(custStart, dashboardJs.indexOf('window.loadCustomers = loadCustomers', custStart));
  assert.ok(/var currentSeq = \+\+_customersFetchSeq/.test(custBody),
    'loadCustomers harus menandai setiap request');
  assert.ok((custBody.match(/currentSeq !== _customersFetchSeq/g) || []).length >= 2,
    'respons sukses maupun gagal harus dicek terhadap request terbaru');

  const orderStart = dashboardJs.indexOf('async function loadOrders');
  const orderBody = dashboardJs.slice(orderStart, orderStart + 2500);
  assert.ok(/currentSeq !== _ordersFetchSeq/.test(orderBody),
    'loadOrders (juga dipicu live search) memakai guard yang sama');
});

test('LS-13: query ke API memakai nilai asli, bukan query yang sudah dinormalisasi', () => {
  // _ordersSearchQuery dikirim sebagai ?search= ke server.
  assert.ok(/queryParams\.push\('search=' \+ encodeURIComponent\(_ordersSearchQuery\)\)/.test(dashboardJs),
    'orders mengirim _ordersSearchQuery ke API');
  assert.ok(/_ordersSearchQuery = state\.raw\.trim\(\)/.test(dashboardJs),
    'yang dikirim harus nilai asli (di-trim), bukan state.query yang di-lowercase');
});
