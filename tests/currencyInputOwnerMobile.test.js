/**
 * Regression: shared currency input Owner Mobile
 * (merchant-shared/js/currency-input.js).
 *
 * Aturan yang dikunci:
 *   - yang dilihat user  : 1.232.342 (titik = pemisah ribuan)
 *   - yang dikirim ke API: 1232342    (integer murni)
 *   - kosong tetap kosong, bukan 0
 *   - caret stabil saat format, backspace & edit tengah terasa natural
 *   - hanya field nominal uang; KM/posisi/limit/kuantitas TIDAK ikut
 *
 * Yang diuji:
 *   CIN-01..02  format & parse (0, 1, 1000, 12345, 1232342)
 *   CIN-03..08  perilaku input: paste, ketik, backspace, edit tengah, kosong
 *   CIN-09..11  wiring markup: field currency vs non-currency
 *   CIN-12..14  satu sumber format (tanpa formatter lokal), field dinamis
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const MODULE_PATH = path.join(__dirname, '../apps/merchant-shared/js/currency-input.js');
const HTML_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const DASHBOARD_JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');
const BRANCH_CATALOG_JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/branch-catalog-ui.js');

const moduleSrc = fs.readFileSync(MODULE_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const dashboardJs = fs.readFileSync(DASHBOARD_JS_PATH, 'utf8');
const branchCatalogJs = fs.readFileSync(BRANCH_CATALOG_JS_PATH, 'utf8');

// Field yang MEMANG nominal uang (currency).
const CURRENCY_IDS = [
  'prod-price',
  'prod-regular-price',
  'prod-min-price',
  'prod-max-price',
  'set-ful-price-km',
  'override-price-input',
  'branch-price-km',
  'branch-promo-minorder',
  'branch-promo-discount'
];

// Angka biasa: bukan uang, tidak boleh diformat ribuan.
const NON_CURRENCY_IDS = [
  'set-ful-max-radius',
  'set-ful-free-km',
  'branch-latitude',
  'branch-longitude',
  'branch-free-km',
  'branch-radius',
  'mkt-banner-position',
  'mkt-assignment-position',
  'mkt-promo-limit-per-user',
  'mkt-promo-limit-total'
];

function boot() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  dom.window.eval(moduleSrc);
  return dom;
}

function makeField(dom, attrs) {
  const input = dom.window.document.createElement('input');
  input.setAttribute('data-input-type', 'currency');
  if (attrs) Object.keys(attrs).forEach((k) => input.setAttribute(k, attrs[k]));
  dom.window.document.body.appendChild(input);
  dom.window.XentraCurrencyInput.enhance(input);
  return input;
}

// Simulasi ketikan/paste/backspace: ubah value, taruh caret, lalu dispatch input.
function typeValue(dom, input, nextValue, caret) {
  input.value = nextValue;
  const pos = caret == null ? nextValue.length : caret;
  input.setSelectionRange(pos, pos);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

// ── CIN-01..02: format & parse ──

test('CIN-01: format ribuan mengikuti contoh Rupiah', () => {
  const dom = boot();
  const CI = dom.window.XentraCurrencyInput;

  assert.strictEqual(CI.format(0), '0');
  assert.strictEqual(CI.format(1), '1');
  assert.strictEqual(CI.format(1000), '1.000');
  assert.strictEqual(CI.format(12345), '12.345');
  assert.strictEqual(CI.format(1232342), '1.232.342');
  assert.strictEqual(CI.format('1232342'), '1.232.342', 'string angka juga diterima');
  assert.strictEqual(CI.format('1.232.342'), '1.232.342', 'sudah terformat tidak dobel titik');
  assert.strictEqual(CI.format(''), '');
  assert.strictEqual(CI.format(null), '');
});

test('CIN-02: parse mengembalikan integer murni', () => {
  const dom = boot();
  const CI = dom.window.XentraCurrencyInput;

  assert.strictEqual(CI.parse('1.232.342'), 1232342);
  assert.strictEqual(CI.parse('1232342'), 1232342);
  assert.strictEqual(CI.parse('1.000'), 1000);
  assert.strictEqual(CI.parse('0'), 0);
  assert.strictEqual(CI.parse(''), 0);
  assert.strictEqual(CI.parse('abc'), 0);
  assert.strictEqual(CI.parseOrNull(''), null);
  assert.strictEqual(CI.parseOrNull('1.000'), 1000);
});

// ── CIN-03..08: perilaku input ──

test('CIN-03: paste "1.232.342" maupun "1232342" sama-sama jadi 1.232.342', () => {
  const dom = boot();

  const a = makeField(dom);
  typeValue(dom, a, '1.232.342');
  assert.strictEqual(a.value, '1.232.342');

  const b = makeField(dom);
  typeValue(dom, b, '1232342');
  assert.strictEqual(b.value, '1.232.342');
});

test('CIN-04: mengetik angka diformat langsung dan nilai kirim tetap numeric', () => {
  const dom = boot();
  const CI = dom.window.XentraCurrencyInput;
  const input = makeField(dom);

  typeValue(dom, input, '1');
  assert.strictEqual(input.value, '1');
  typeValue(dom, input, '12');
  assert.strictEqual(input.value, '12');
  typeValue(dom, input, '1232');
  assert.strictEqual(input.value, '1.232');
  typeValue(dom, input, '1232342');
  assert.strictEqual(input.value, '1.232.342');
  assert.strictEqual(CI.getValue(input), 1232342, 'yang dikirim ke server angka murni');
});

test('CIN-05: backspace bekerja natural (satu digit, caret ikut)', () => {
  const dom = boot();
  const input = makeField(dom);
  typeValue(dom, input, '1.232.342');

  // Backspace di ujung: hapus digit terakhir.
  typeValue(dom, input, '1.232.34', 8);
  assert.strictEqual(input.value, '123.234');
  assert.strictEqual(input.selectionStart, input.value.length, 'caret tetap di ujung');
});

test('CIN-06: edit di tengah tidak membuat kursor melompat', () => {
  const dom = boot();
  const input = makeField(dom);
  typeValue(dom, input, '1.232.342');

  // Sisipkan '9' setelah '1.2' → '1.2932.342' dengan caret setelah '9' (indeks 4).
  typeValue(dom, input, '1.2932.342', 4);
  assert.strictEqual(input.value, '12.932.342');
  // '12.932.342': digit ke-3 ('9') ada di indeks 3, jadi caret duduk di indeks 4 —
  // tetap tepat setelah digit yang baru diketik, bukan melompat.
  assert.strictEqual(input.selectionStart, 4, 'caret tepat setelah digit yang baru diketik');
});

test('CIN-07: kosong tetap kosong, bukan otomatis 0', () => {
  const dom = boot();
  const CI = dom.window.XentraCurrencyInput;
  const input = makeField(dom, { value: '28000' });

  assert.strictEqual(input.value, '28.000', 'nilai dari server ikut diformat saat dipasang');

  typeValue(dom, input, '');
  assert.strictEqual(input.value, '');
  assert.strictEqual(CI.getValue(input), 0);
  assert.strictEqual(CI.parseOrNull(input.value), null, 'kosong berarti null, bukan 0');
});

test('CIN-08: field memasang keyboard angka dan tipe teks', () => {
  const dom = boot();
  const input = makeField(dom, { type: 'number' });

  assert.strictEqual(input.getAttribute('inputmode'), 'numeric', 'keyboard angka di mobile');
  assert.strictEqual(input.getAttribute('type'), 'text', 'tipe teks supaya pemisah ribuan tampil');
  assert.strictEqual(input.getAttribute('autocomplete'), 'off');
});

// ── CIN-09..11: wiring markup ──

test('CIN-09: semua field nominal Owner Mobile memakai shared currency input', () => {
  CURRENCY_IDS.forEach((id) => {
    const re = new RegExp('<input[^>]*id="' + id + '"[^>]*>');
    const tag = (html.match(re) || [])[0];
    assert.ok(tag, 'field #' + id + ' harus ada');
    assert.ok(/data-input-type="currency"/.test(tag), '#' + id + ' harus data-input-type="currency"');
    assert.ok(!/type="number"/.test(tag), '#' + id + ' tidak boleh type="number" (tidak bisa pemisah ribuan)');
    assert.ok(/inputmode="numeric"/.test(tag), '#' + id + ' harus inputmode numeric');
  });
});

test('CIN-10: angka non-currency tidak ikut jadi currency', () => {
  NON_CURRENCY_IDS.forEach((id) => {
    const re = new RegExp('<input[^>]*id="' + id + '"[^>]*>');
    const tag = (html.match(re) || [])[0];
    assert.ok(tag, 'field #' + id + ' harus ada');
    assert.ok(!/data-input-type="currency"/.test(tag),
      '#' + id + ' bukan nominal uang, tidak boleh diformat ribuan');
  });
});

test('CIN-11: label Rp tetap terpisah, value input tidak memuat simbol Rp', () => {
  assert.ok(/<label for="prod-price">Harga Jual \(Rp\)<\/label>/.test(html),
    'label Harga Jual (Rp) harus tetap terpisah dari input');
  CURRENCY_IDS.forEach((id) => {
    const re = new RegExp('<input[^>]*id="' + id + '"[^>]*>');
    const tag = (html.match(re) || [])[0];
    assert.ok(!/value="[^"]*Rp/.test(tag), '#' + id + ' tidak boleh membawa simbol Rp di value');
  });
});

// ── CIN-12..14: satu sumber format, termasuk field dinamis ──

test('CIN-12: tidak ada formatter ribuan lokal di halaman Owner', () => {
  assert.ok(!/\\B\(\?=\(\\d\{3\}\)/.test(dashboardJs),
    'dashboard.js tidak boleh punya formatter ribuan sendiri');
  assert.ok(!/\\B\(\?=\(\\d\{3\}\)/.test(branchCatalogJs),
    'branch-catalog-ui.js tidak boleh punya formatter ribuan sendiri');

  assert.ok(dashboardJs.includes('window.XentraCurrencyInput'),
    'dashboard.js harus memakai shared currency input');
  assert.ok(branchCatalogJs.includes('window.XentraCurrencyInput'),
    'branch-catalog-ui.js harus memakai shared currency input');
});

test('CIN-13: input harga dinamis (option adjustment) ikut currency', () => {
  assert.ok(dashboardJs.includes('data-input-type="currency" class="x-input" data-opt-price='),
    'input adjustment harga pada opsi produk harus memakai currency input');
});

test('CIN-14: field yang dirender belakangan otomatis dipasangi perilaku currency', async () => {
  const dom = boot();
  const CI = dom.window.XentraCurrencyInput;

  const holder = dom.window.document.createElement('div');
  holder.innerHTML = '<input data-input-type="currency" value="50000">';
  dom.window.document.body.appendChild(holder);

  // MutationObserver memproses pada microtask berikutnya.
  await new Promise((r) => setTimeout(r, 0));

  const input = holder.querySelector('input');
  assert.strictEqual(input.value, '50.000', 'nilai awal ikut diformat');
  assert.strictEqual(CI.getValue(input), 50000);
  assert.strictEqual(input.getAttribute('inputmode'), 'numeric');
});
