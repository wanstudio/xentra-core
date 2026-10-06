/**
 * Regression: standardisasi Bottom Sheet Merchant/Owner UI.
 *
 * Satu standar, bukan CSS sheet per fitur:
 *   - JS tidak boleh lagi menulis CSS inline untuk isi Bottom Sheet;
 *   - isi sheet memakai pola reusable .x-master-inline-*;
 *   - semua sheet dibuka lewat XentraPresentation.open({ type: 'bottom-sheet' })
 *     dan shell canonical (presentation-shells.js/.css);
 *   - shell canonical memberi gutter ke konten master-inline, sehingga action bar
 *     sticky (-16px) tidak melebar keluar sheet di mobile;
 *   - legacy .x-bottom-sheet* tetap dipertahankan selama masih ada consumer.
 *
 * Yang diuji:
 *   BS-STD-01..03  sheet input generik: perilaku nyata, struktur shared, tanpa CSS inline
 *   BS-STD-04      sheet branch (Merchant App) memakai struktur yang sama
 *   BS-STD-05      wiring Merchant App memuat shell canonical
 *   BS-STD-06      gutter konten master-inline + kesesuaian dengan action bar sticky
 *   BS-STD-07      tidak ada CSS sheet feature-specific
 *   BS-STD-08      quick-create Product/Category/Rasa = satu builder
 *   BS-STD-09      legacy .x-bottom-sheet* tetap ada dan terpisah dari shell canonical
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const DASHBOARD_JS = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');
const BRANCH_UI_JS = path.join(__dirname, '../apps/merchant-dashboard/assets/js/branch-catalog-ui.js');
const MENU_INLINE_JS = path.join(__dirname, '../apps/merchant-dashboard/assets/js/owner-master-menu-inline.js');
const MERCHANT_MENU_JS = path.join(__dirname, '../apps/merchant-app/assets/js/menu.js');
const MERCHANT_INDEX = path.join(__dirname, '../apps/merchant-app/index.html');
const DASHBOARD_INDEX = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const SHELL_CSS = path.join(__dirname, '../apps/merchant-shared/css/presentation-shells.css');
const DASHBOARD_CSS = path.join(__dirname, '../apps/merchant-shared/css/dashboard.css');
const SHARED_CSS = path.join(__dirname, '../apps/merchant-shared/css/shared.css');

const read = (p) => fs.readFileSync(p, 'utf8');

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, 'fungsi harus ada: ' + signature);
  let depth = 0;
  let started = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; started = true; }
    else if (source[i] === '}') {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('fungsi tidak lengkap: ' + signature);
}

/** Jalankan builder sheet nyata dengan stub shell, tanpa mengubah kode produksi. */
function runSheetBuilder(file, signature, name) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const opened = [];
  const closed = [];
  dom.window.XentraPresentation = {
    open: (options) => { opened.push(options); return options.id; },
    close: (id) => { closed.push(id); },
    isOpen: () => true
  };
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const src = extractFunction(read(file), signature);
  const factory = new Function('document', 'window', 'esc', 'setTimeout',
    src + '\nreturn ' + name + ';');
  return {
    dom,
    opened,
    closed,
    run: factory(dom.window.document, dom.window, esc, (cb) => cb())
  };
}

// ── BS-STD-01..03: sheet input generik (dashboard) ──

test('BS-STD-01: sheet input dashboard memakai shell bottom-sheet & struktur master-inline', async () => {
  const { dom, opened, closed, run } = runSheetBuilder(
    DASHBOARD_JS, 'function requestTextInputSheet(', 'requestTextInputSheet');

  const result = run({ title: 'Nama Cabang', label: 'Nama', value: 'Cabang A' });
  const options = opened[0];

  assert.equal(options.type, 'bottom-sheet', 'harus lewat canonical presentation shell');
  assert.equal(options.content.className, 'x-master-inline-sheet-content');
  assert.ok(options.content.querySelector('.x-master-inline-sheet-intro strong'),
    'struktur: intro/judul');
  assert.ok(options.content.querySelector('.x-master-inline-sheet-fields .x-master-inline-field'),
    'struktur: field group');
  assert.ok(options.content.querySelector('.x-master-inline-sheet-actions .x-btn-primary'),
    'struktur: action bar');

  options.content.querySelector('#x-text-input-sheet-field').value = 'Cabang Baru';
  options.content.querySelector('[data-action="save"]')
    .dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  assert.equal(await result, 'Cabang Baru', 'nilai input tetap terkirim');
  assert.deepEqual(closed, ['text-input-sheet'], 'ditutup lewat shell, bukan DOM manual');
});

test('BS-STD-02: batal pada sheet input tetap mengembalikan null dan menutup sheet', async () => {
  const { dom, opened, closed, run } = runSheetBuilder(
    DASHBOARD_JS, 'function requestTextInputSheet(', 'requestTextInputSheet');

  const result = run({ title: 'Nama Cabang', label: 'Nama' });
  const content = opened[0].content;

  content.querySelector('[data-action="cancel"]')
    .dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  assert.equal(await result, null, 'batal tidak menyimpan nilai');
  assert.deepEqual(closed, ['text-input-sheet']);
});

test('BS-STD-03: tidak ada CSS inline yang ditulis JavaScript untuk isi sheet', () => {
  const dashboardSheet = extractFunction(read(DASHBOARD_JS), 'function requestTextInputSheet(');
  const branchSheet = extractFunction(read(BRANCH_UI_JS), 'function requestBranchTextInput(');

  [['dashboard', dashboardSheet], ['branch-catalog', branchSheet]].forEach(([label, src]) => {
    assert.ok(!/style="/.test(src), label + ': isi sheet tidak boleh memakai style inline');
    assert.ok(src.includes('x-master-inline-sheet-content'), label + ': harus pakai konten shared');
    assert.ok(!/x-(product|new-product)-bottom-sheet/.test(src), label + ': tidak ada kelas sheet baru');
  });

  // Sheet Merchant App (menu display name) juga tanpa inline style.
  const menuSrc = read(MERCHANT_MENU_JS);
  const menuStart = menuSrc.indexOf('async function openBMMenuDisplayNameEditor(');
  const menuBlock = menuSrc.slice(menuStart, menuStart + 2600);
  assert.ok(menuBlock.length > 200, 'blok sheet menu ditemukan');
  assert.ok(!/style="/.test(menuBlock), 'merchant-app: isi sheet tidak boleh memakai style inline');
  assert.ok(menuBlock.includes('x-master-inline-sheet-content'));
});

// ── BS-STD-04: sheet branch (Merchant App / dashboard) ──

test('BS-STD-04: sheet input cabang memakai struktur shared yang sama', async () => {
  const { dom, opened, run } = runSheetBuilder(
    BRANCH_UI_JS, 'function requestBranchTextInput(', 'requestBranchTextInput');

  const result = run({ title: 'Kategori Cabang', label: 'Nama', value: 'Minuman' });
  const options = opened[0];

  assert.equal(options.type, 'bottom-sheet');
  assert.equal(options.content.className, 'x-master-inline-sheet-content');
  assert.ok(options.content.querySelector('.x-master-inline-sheet-actions .x-btn-secondary'));
  assert.ok(!/style="/.test(options.content.innerHTML));

  options.content.querySelector('#x-branch-text-input').value = 'Makanan';
  options.content.querySelector('[data-action="save"]')
    .dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.equal(await result, 'Makanan');
});

// ── BS-STD-05: wiring shell di Merchant App ──

test('BS-STD-05: Merchant App memuat shell canonical (JS + CSS)', () => {
  const html = read(MERCHANT_INDEX);

  assert.ok(/presentation-shells\.js\?v=/.test(html),
    'presentation-shells.js harus dimuat, kalau tidak XentraPresentation undefined');
  assert.ok(/presentation-shells\.css\?v=/.test(html),
    'presentation-shells.css harus dimuat supaya casing sheet konsisten');

  const jsIndex = html.indexOf('presentation-shells.js');
  const menuIndex = html.indexOf('/merchant-app/assets/js/menu.js');
  assert.ok(jsIndex < menuIndex, 'shell dimuat sebelum feature script yang memakainya');
});

// ── BS-STD-06: gutter konten master-inline ──

test('BS-STD-06: shell memberi gutter konten master-inline & action bar tidak melebar keluar', () => {
  const shell = read(SHELL_CSS);
  const shared = read(SHARED_CSS);

  assert.ok(/\.x-master-inline-sheet-content\s*\{[^}]*padding-left:\s*var\(--x-sheet-gutter/s.test(shell),
    'konten master-inline harus memakai gutter sheet');
  assert.ok(/--x-sheet-gutter:\s*16px/.test(shell), 'gutter mobile 16px');

  const sticky = shared.slice(shared.indexOf('.x-master-inline-sheet-actions'), shared.length);
  const mobile = sticky.slice(sticky.indexOf('@media (max-width: 480px)'));
  assert.ok(/margin:\s*0\s+-16px\s+-16px/.test(mobile),
    'action bar sticky melebar penuh dengan -16px');
  assert.ok(/padding:\s*12px 16px/.test(mobile), 'padding dalam action bar 16px');
});

test('BS-STD-06b: sheet handle disediakan shell, bukan markup fitur', () => {
  const shell = read(SHELL_CSS);
  const inline = read(MENU_INLINE_JS);

  assert.ok(/\.x-presentation-bottom-sheet \.x-presentation-surface::before/.test(shell),
    'grabber/handle bottom sheet digambar shell canonical');
  assert.ok(!inline.includes('x-bottom-sheet-handle'),
    'quick-create tidak menduplikasi handle sendiri');
});

// ── BS-STD-07: tidak ada CSS sheet feature-specific ──

test('BS-STD-07: tidak ada kelas CSS bottom sheet feature-specific', () => {
  const css = read(SHELL_CSS) + read(SHARED_CSS) + read(DASHBOARD_CSS);

  ['.x-product-bottom-sheet', '.x-new-product-sheet', '.x-owner-bottom-sheet'].forEach((selector) => {
    assert.ok(!css.includes(selector), 'tidak boleh ada CSS sheet feature-specific: ' + selector);
  });
  assert.ok(css.includes('.x-master-inline-sheet-content'), 'pakai pola shared yang ada');
});

// ── BS-STD-08: quick-create = satu builder ──

test('BS-STD-08: quick-create Product/Category/Rasa memakai satu builder shared', () => {
  const src = read(MENU_INLINE_JS);

  assert.equal((src.match(/'<div class="x-master-inline-sheet">'/g) || []).length, 1,
    'hanya ada satu template sheet master-inline di file quick-create');

  ['createProductInline', 'createCategoryInline', 'createRasaInline']
    .forEach((fn) => {
      const block = extractFunction(src, 'function ' + fn + '(');
      assert.ok(block.includes('requestFieldsSheet('), fn + ' harus memakai builder shared');
    });

  const builder = extractFunction(src, 'function requestFieldsSheet(');
  assert.ok(builder.includes("type: 'bottom-sheet'"), 'builder memakai shell canonical');
  assert.ok(!/style="/.test(builder), 'builder tidak menulis CSS inline');
  assert.ok(builder.includes('x-master-inline-sheet-intro') &&
    builder.includes('x-master-inline-sheet-fields') &&
    builder.includes('x-master-inline-sheet-actions'),
    'urutan struktur: intro → field group → action bar');
});

// ── BS-STD-09: legacy dipertahankan & terpisah ──

test('BS-STD-09: legacy .x-bottom-sheet* tetap ada dengan consumer-nya', () => {
  const css = read(DASHBOARD_CSS);
  const html = read(DASHBOARD_INDEX);

  assert.ok(css.includes('.x-bottom-sheet-overlay'), 'CSS legacy tidak dihapus');
  assert.ok(css.includes('.x-bottom-sheet {'), 'CSS sheet legacy tidak dihapus');

  // Consumer-nya: sheet rentang tanggal OCC.
  assert.ok(html.includes('id="occ-date-sheet"'), 'consumer legacy masih memakai sheet-nya');
  assert.ok(html.includes('closeOccDateSheet()'), 'handler legacy tetap ada');

  // Pemisahan: legacy memakai kelasnya sendiri, bukan shell canonical.
  const start = html.indexOf('id="occ-date-sheet-ext-close"');
  const block = html.slice(start, html.indexOf('occ-date-sheet-body', start) + 400);
  assert.ok(!/x-presentation-(bottom-sheet|surface|sheet-bar)/.test(block),
    'legacy sheet tidak dicampur dengan kelas shell canonical');
});
