/**
 * Regression: select native owner mobile dikonversi ke dropdown kustom
 * (merchant-shared/js/dropdown.js).
 *
 * Alasan: gaya acuan (filter "Semua Kategori" di Produk Master) hanya bisa
 * dicapai oleh markup .x-occ-dropdown — daftar opsi <select> digambar OS/browser
 * sehingga selalu kotak. Enhancer ini memakai markup & kelas yang sama, sementara
 * <select> asli tetap jadi sumber nilai supaya logic halaman tidak berubah.
 *
 * Yang diuji:
 *   DE-01..02  gerbang mobile & konversi ke markup acuan
 *   DE-03..05  select asli tetap sumber nilai; label mengikuti pilihan
 *   DE-06..07  opsi dinamis & disabled tersinkron
 *   DE-08      select yang sudah kustom / disembunyikan tidak disentuh
 *   DE-09..10  revert di desktop; tutup saat klik luar / Escape
 *   DE-11      ikon & kelas sama dengan acuan
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const MODULE_PATH = path.join(__dirname, '../apps/merchant-shared/js/dropdown.js');
const CSS_PATH = path.join(__dirname, '../apps/merchant-shared/css/dashboard.css');
const moduleSrc = fs.readFileSync(MODULE_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');

const SELECT_HTML =
  '<div class="x-form-group">' +
    '<label for="sel">Kategori</label>' +
    '<select id="sel" aria-label="Pilih kategori">' +
      '<option value="">Semua Kategori</option>' +
      '<option value="a">Makanan Berat</option>' +
      '<option value="b">Minuman</option>' +
    '</select>' +
  '</div>';

function boot(bodyHtml, mobile) {
  const dom = new JSDOM('<!doctype html><html><body>' + (bodyHtml || '') + '</body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  dom.window.matchMedia = function (query) {
    return {
      media: query,
      matches: Boolean(mobile),
      addEventListener: function () {},
      removeEventListener: function () {},
      addListener: function () {},
      removeListener: function () {}
    };
  };
  dom.window.eval(moduleSrc);
  return dom;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || 0));
}

// ── DE-01..02: gerbang mobile & konversi ──

test('DE-01: konversi hanya jalan di lebar mobile', () => {
  const mobile = boot(SELECT_HTML, true);
  assert.strictEqual(mobile.window.XentraDropdown.size(), 1,
    'select harus dikonversi di mobile');
  assert.ok(mobile.window.document.querySelector('.x-owner-select-dropdown'));

  const desktop = boot(SELECT_HTML, false);
  assert.strictEqual(desktop.window.XentraDropdown.size(), 0,
    'di desktop select native dibiarkan apa adanya');
  assert.strictEqual(desktop.window.document.querySelector('.x-owner-select-dropdown'), null);
});

test('DE-02: markup hasil konversi memakai kelas dropdown acuan', () => {
  const dom = boot(SELECT_HTML, true);
  const d = dom.window.document;

  const host = d.querySelector('.x-owner-select-dropdown');
  assert.ok(host.classList.contains('x-occ-dropdown'), 'host memakai .x-occ-dropdown');
  assert.ok(host.querySelector('.x-occ-dropdown-trigger'), 'ada trigger acuan');
  assert.ok(host.querySelector('.x-occ-dropdown-menu'), 'ada menu acuan');
  assert.strictEqual(host.querySelectorAll('.x-occ-dropdown-item').length, 3,
    'item dibangun dari seluruh option');

  // Menu acuan memang rounded (gaya bersama, bukan gaya baru).
  const menuRule = css.match(/^  \.x-occ-dropdown-menu,\n  \.x-branch-dropdown-menu \{([\s\S]*?)^  \}/m);
  assert.ok(menuRule && /border-radius:\s*14px/.test(menuRule[1]), 'menu acuan rounded');
});

// ── DE-03..05: sumber nilai & label ──

test('DE-03: select asli tetap ada sebagai sumber nilai (disembunyikan visual)', () => {
  const dom = boot(SELECT_HTML, true);
  const d = dom.window.document;
  const select = d.querySelector('select#sel');

  assert.ok(select, 'select asli tidak dihapus');
  assert.ok(select.classList.contains('x-owner-select-source'), 'select asli ditandai sumber');
  const sourceRule = css.match(/^  \.x-owner-select-source \{([\s\S]*?)^  \}/m);
  assert.ok(sourceRule, 'aturan penyembunyian .x-owner-select-source ada');
  assert.ok(/opacity:\s*0/.test(sourceRule[1]), 'disembunyikan visual');
  assert.ok(!/display:\s*none/.test(sourceRule[1]),
    'jangan display:none supaya nilainya tetap ikut terkirim');
});

test('DE-04: memilih opsi menulis ke select asli dan mengirim event change', () => {
  const dom = boot(SELECT_HTML, true);
  const d = dom.window.document;
  const select = d.querySelector('select#sel');

  let changes = 0;
  let lastValue = null;
  select.addEventListener('change', function () { changes += 1; lastValue = select.value; });

  const items = d.querySelectorAll('.x-occ-dropdown-item');
  items[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.strictEqual(select.value, 'b', 'nilai jatuh ke select asli');
  assert.strictEqual(changes, 1, 'handler halaman (change) tetap jalan');
  assert.strictEqual(lastValue, 'b');
});

test('DE-05: label trigger mengikuti pilihan awal dan pilihan baru', () => {
  const dom = boot(SELECT_HTML, true);
  const d = dom.window.document;
  const select = d.querySelector('select#sel');
  const label = d.querySelector('.x-occ-dropdown-label');

  assert.strictEqual(label.textContent, 'Semua Kategori', 'label awal dari select');

  select.value = 'a';
  d.querySelectorAll('.x-occ-dropdown-item')[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(label.textContent, 'Makanan Berat', 'label ikut pilihan baru');

  const active = d.querySelectorAll('.x-occ-dropdown-item.active');
  assert.strictEqual(active.length, 1, 'hanya satu item aktif');
  assert.strictEqual(active[0].textContent.trim(), 'Makanan Berat');
});

// ── DE-06..07: sinkronisasi ──

test('DE-06: opsi yang ditambahkan halaman ikut masuk ke menu', async () => {
  const dom = boot(SELECT_HTML, true);
  const d = dom.window.document;
  const select = d.querySelector('select#sel');

  const opt = d.createElement('option');
  opt.value = 'c';
  opt.textContent = 'Snack';
  select.appendChild(opt);

  await wait(10);
  const items = Array.from(d.querySelectorAll('.x-occ-dropdown-item')).map((i) => i.textContent.trim());
  assert.ok(items.includes('Snack'), 'opsi baru tersinkron, dapat: ' + items.join(' | '));
});

test('DE-07: select disabled membuat trigger disabled', () => {
  const dom = boot(SELECT_HTML, true);
  const d = dom.window.document;
  const select = d.querySelector('select#sel');
  const trigger = d.querySelector('.x-occ-dropdown-trigger');

  assert.strictEqual(trigger.disabled, false);
  select.disabled = true;
  dom.window.XentraDropdown.refresh();
  assert.strictEqual(d.querySelector('.x-occ-dropdown-trigger').disabled, true,
    'trigger mengikuti disabled select');
});

// ── DE-08: pengecualian ──

test('DE-08: select yang sudah punya dropdown kustom atau disembunyikan tidak disentuh', () => {
  const html =
    // sudah punya dropdown kustom (pola nilai-sumber seperti #prod-filter-category)
    '<div class="x-occ-dropdown"><button class="x-occ-dropdown-trigger">x</button>' +
      '<div style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;overflow:hidden;">' +
        '<select id="src"><option>a</option></select></div></div>' +
    // select tersembunyi sendiri (pola topbar)
    '<select id="hidden" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;overflow:hidden;"><option>a</option></select>';
  const dom = boot(html, true);
  const d = dom.window.document;

  assert.strictEqual(dom.window.XentraDropdown.size(), 0, 'tidak ada yang dikonversi');
  assert.strictEqual(d.querySelectorAll('.x-owner-select-dropdown').length, 0);
});

// ── DE-09..10: revert & menutup ──

test('DE-09: kembali ke desktop memulihkan select native', () => {
  const dom = boot(SELECT_HTML, true);
  const d = dom.window.document;
  assert.strictEqual(d.querySelectorAll('.x-owner-select-dropdown').length, 1);

  dom.window.matchMedia = function (q) {
    return { media: q, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  };
  dom.window.XentraDropdown.refresh();

  assert.strictEqual(d.querySelectorAll('.x-owner-select-dropdown').length, 0, 'markup kustom dibuang');
  assert.strictEqual(d.querySelector('select#sel').classList.contains('x-owner-select-source'), false,
    'select asli kembali normal');
  assert.strictEqual(dom.window.XentraDropdown.size(), 0);
});

test('DE-10: menu menutup saat klik di luar atau Escape, dan hanya satu yang terbuka', () => {
  const html = SELECT_HTML +
    '<div class="x-form-group"><select id="sel2"><option>a</option><option>b</option></select></div>';
  const dom = boot(html, true);
  const d = dom.window.document;
  const hosts = d.querySelectorAll('.x-owner-select-dropdown');
  assert.strictEqual(hosts.length, 2);

  hosts[0].querySelector('.x-occ-dropdown-trigger').click();
  assert.ok(hosts[0].classList.contains('open'), 'klik trigger membuka');
  assert.strictEqual(hosts[0].querySelector('.x-occ-dropdown-trigger').getAttribute('aria-expanded'), 'true');

  hosts[1].querySelector('.x-occ-dropdown-trigger').click();
  assert.ok(hosts[1].classList.contains('open'));
  assert.ok(!hosts[0].classList.contains('open'), 'hanya satu dropdown terbuka');

  d.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.ok(!hosts[1].classList.contains('open'), 'klik di luar menutup');

  hosts[1].querySelector('.x-occ-dropdown-trigger').click();
  d.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!hosts[1].classList.contains('open'), 'Escape menutup');
});

// ── DE-11: ikon seragam ──

test('DE-11: chevron & checkmark memakai markup ikon acuan', () => {
  assert.ok(moduleSrc.includes('class="x-occ-chevron-icon"'), 'chevron memakai kelas acuan');
  assert.ok(moduleSrc.includes('<polyline points="6 9 12 15 18 9"></polyline>'), 'chevron memakai path acuan');
  assert.ok(moduleSrc.includes('class="x-occ-check-icon" width="14" height="14"'), 'checkmark memakai ikon acuan');
  assert.ok(moduleSrc.includes('<polyline points="20 6 9 17 4 12"></polyline>'), 'checkmark memakai path acuan');
});
