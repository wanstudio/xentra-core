/**
 * Regression: casing bottom sheet XentraPresentation.
 *
 * Dua hal yang dikunci:
 *   1. Gutter. Konten bottom sheet dari markup modal legacy (mis. "Tambah/Ubah
 *      Kategori" = #master-reference-editor) kehilangan casing .x-modal-card saat
 *      dipindah ke .x-presentation-surface, sehingga label/input/helper menempel
 *      ke sisi sheet. Gutter sekarang datang dari presentation shell.
 *   2. Tombol tutup. ✕ tampil DI ATAS sheet (bagian casing), bukan di dalam
 *      surface — kalau di dalam, ia terpotong overflow konten. Pemanggilan dan
 *      animasi dari feature context tidak berubah.
 *
 * Yang diuji:
 *   BS-01..05  gutter blok isi & footer, tanpa dobel padding, target tutup
 *   BS-06..08  gutter responsif, tanpa !important, markup fitur tidak ditambal
 *   BS-09..12  tombol tutup di casing: posisi, teruskan klik, restore, pengecualian
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const CSS_PATH = path.join(__dirname, '../apps/merchant-shared/css/presentation-shells.css');
const DASHBOARD_CSS_PATH = path.join(__dirname, '../apps/merchant-shared/css/dashboard.css');
const SHELL_JS_PATH = path.join(__dirname, '../apps/merchant-shared/js/presentation-shells.js');
const HTML_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');

const css = fs.readFileSync(CSS_PATH, 'utf8');
// Casing shell tidak berdiri sendiri: header/footer/form legacy berasal dari
// dashboard.css. Keduanya dimuat supaya cascade-nya diuji apa adanya.
const dashboardCss = fs.readFileSync(DASHBOARD_CSS_PATH, 'utf8');
const shellJs = fs.readFileSync(SHELL_JS_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');

const SHEET_HTML = (content) =>
  '<!doctype html><html><head>' +
  '<style>' + dashboardCss + '</style><style>' + css + '</style>' +
  '</head><body>' +
  '<div class="x-presentation-shell x-presentation-bottom-sheet">' +
  '<div class="x-presentation-surface">' + content + '</div>' +
  '</div></body></html>';

// Konten seperti Category Editor: header legacy + form berisi grup isi + footer.
const LEGACY_BODY_CONTENT =
  '<div class="x-reference-editor-content">' +
    '<div class="x-modal-header">' +
      '<div><h3>Tambah Kategori</h3><p>Tambahkan pilihan master.</p></div>' +
      '<button class="x-modal-close" aria-label="Tutup">&#10005;</button>' +
    '</div>' +
    '<form class="x-form">' +
      '<div class="x-form-group"><label>Nama Kategori</label><input class="x-input"><small>helper</small></div>' +
      '<div class="x-modal-footer"><button>Batal</button><button>Simpan</button></div>' +
    '</form>' +
  '</div>';

const CARD_CONTENT =
  '<div class="x-modal-card">' +
    '<div class="x-modal-header"><div><h3>Tim</h3></div><button class="x-modal-close">&#10005;</button></div>' +
    '<form class="x-form"><div class="x-form-group"><label>Nama</label><input class="x-input"></div>' +
    '<div class="x-modal-footer"><button>Batal</button><button>Simpan</button></div></form>' +
  '</div>';

function computed(dom, selector, prop) {
  const el = dom.window.document.querySelector(selector);
  assert.ok(el, 'elemen ' + selector + ' harus ada');
  return dom.window.getComputedStyle(el).getPropertyValue(prop).trim();
}

// Boot shell JS di dalam jsdom supaya perilaku casing diuji, bukan disalin ulang.
function boot(contentHtml) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  dom.window.eval(shellJs);

  const content = dom.window.document.createElement('div');
  content.className = 'x-reference-editor-content';
  content.id = 'sheet-content';
  content.innerHTML = contentHtml;
  dom.window.document.body.appendChild(content);

  return { dom, content };
}

// ── BS-01..05: gutter seragam, tanpa dobel padding, target tutup ──

test('BS-01: blok isi form memakai gutter yang sama dengan header & footer', () => {
  const dom = new JSDOM(SHEET_HTML(LEGACY_BODY_CONTENT), { pretendToBeVisual: true });

  const groupGutter = computed(dom, '.x-form-group', 'padding-left');
  const headerGutter = computed(dom, '.x-modal-header', 'padding-left');
  const footerGutter = computed(dom, '.x-modal-footer', 'padding-left');

  assert.ok(groupGutter.includes('--x-sheet-gutter'),
    'grup isi (label/input/helper) harus mengambil gutter sheet, dapat: ' + JSON.stringify(groupGutter));
  assert.strictEqual(groupGutter, headerGutter, 'gutter isi harus sama dengan header');
  assert.strictEqual(groupGutter, footerGutter, 'gutter isi harus sama dengan footer');
});

test('BS-02: <form> tidak dipadding sendiri, jadi tidak ada dobel gutter', () => {
  const dom = new JSDOM(SHEET_HTML(LEGACY_BODY_CONTENT), { pretendToBeVisual: true });

  assert.strictEqual(computed(dom, '.x-form', 'padding-left'), '0',
    'form tidak boleh punya padding horizontal; gutter dipasang per blok isi');
  assert.strictEqual(computed(dom, '.x-form', 'padding-right'), '0',
    'form tidak boleh punya padding horizontal; gutter dipasang per blok isi');
});

test('BS-03: footer tetap selebar sheet, gutter-nya dari footer sendiri', () => {
  const dom = new JSDOM(SHEET_HTML(LEGACY_BODY_CONTENT), { pretendToBeVisual: true });

  assert.ok(computed(dom, '.x-modal-footer', 'padding-left').includes('--x-sheet-gutter'));
  assert.ok(computed(dom, '.x-modal-footer', 'padding-right').includes('--x-sheet-gutter'));
});

test('BS-04: konten .x-modal-card memakai gutter kartunya sendiri, tidak dobel', () => {
  const dom = new JSDOM(SHEET_HTML(CARD_CONTENT), { pretendToBeVisual: true });

  // Gutter kartu berasal dari dashboard.css (`.x-modal-card .x-form`: 20px).
  // Kalau aturan shell ikut berlaku, nilainya jadi 40px (dobel).
  assert.strictEqual(computed(dom, '.x-modal-card .x-form', 'padding-left'), '20px',
    'form kartu harus tetap 20px, bukan dobel dengan aturan shell');
  assert.strictEqual(computed(dom, '.x-modal-card .x-form-group', 'padding-left'), '0',
    'shell tidak boleh menambah gutter di dalam kartu');
});

test('BS-05: tombol tutup di casing punya target sentuh 44x44', () => {
  const closeRule = css.match(/\.x-presentation-sheet-close \{([\s\S]*?)\}/);
  assert.ok(closeRule, 'aturan .x-presentation-sheet-close harus ada');
  const body = closeRule[1];
  assert.ok(/width:\s*44px/.test(body) && /height:\s*44px/.test(body),
    'tombol tutup casing harus 44x44');
  assert.ok(/border-radius:\s*999px/.test(body), 'tombol tutup casing harus bulat');
  assert.ok(/animation:\s*x-presentation-sheet-in/.test(body),
    'tombol tutup harus ikut animasi naik/turun yang sama dengan sheet');
});

// ── BS-06..08: responsif, tanpa !important, markup fitur utuh ──

test('BS-06: gutter bottom sheet 16px di mobile dan 20px dari tablet ke atas', () => {
  assert.ok(/\.x-presentation-bottom-sheet \{[^}]*--x-sheet-gutter: 16px;/s.test(css),
    'shell bottom sheet harus mendefinisikan gutter mobile 16px');

  const desktop = css.slice(css.indexOf('@media (min-width: 769px)'));
  assert.ok(/\.x-presentation-bottom-sheet \{[^}]*--x-sheet-gutter: 20px;/s.test(desktop),
    'gutter desktop harus 20px (sama dengan padding header legacy)');
});

test('BS-07: perbaikan casing tidak memakai !important baru', () => {
  const start = css.indexOf('/* --- Bottom sheet body contract');
  const end = css.indexOf('.x-presentation-dialog .x-presentation-surface {');
  assert.ok(start !== -1 && end > start, 'blok kontrak bottom sheet harus ada');
  assert.ok(!css.slice(start, end).includes('!important'),
    'kontrak shell mengandalkan cascade, bukan !important');
});

test('BS-08: markup Category Editor tidak ditambal', () => {
  const start = html.indexOf('id="master-reference-editor"');
  assert.ok(start !== -1, '#master-reference-editor harus ada');
  const block = html.slice(start, html.indexOf('<!-- MODAL: MASTER MENU COMPONENT MANAGER -->', start));

  assert.ok(block.includes('class="x-modal-header"'), 'header editor harus tetap');
  assert.ok(block.includes('class="x-form"'), 'form editor harus tetap');
  assert.ok(block.includes('class="x-modal-footer"'), 'footer editor harus tetap');
  assert.ok(!/x-reference-editor-content[^>]*style=/.test(block),
    'konten editor tidak boleh diberi style inline sebagai tambalan');
});

// ── BS-09..12: tombol tutup di casing ──

test('BS-09: ✕ dirender di casing, di atas surface, bukan di dalamnya', () => {
  const { dom, content } = boot(LEGACY_BODY_CONTENT);
  dom.window.XentraPresentation.open({ id: 'kategori', type: 'bottom-sheet', content: content });

  const d = dom.window.document;
  const shell = d.querySelector('.x-presentation-shell');
  const surface = shell.querySelector('.x-presentation-surface');
  const bar = shell.querySelector('.x-presentation-sheet-bar');
  const close = shell.querySelector('.x-presentation-sheet-close');

  assert.ok(bar && close, 'casing harus punya baris + tombol tutup');
  assert.ok(!surface.contains(close), '✕ tidak boleh berada di dalam surface');
  assert.ok(content.classList.contains('x-presentation-close-relocated'),
    'tombol tutup asli di header ditandai sudah dipindah');
  assert.ok(d.querySelector('.x-presentation-close-relocated .x-modal-close'),
    'tombol asli tetap ada di markup (handler-nya tidak dipindah)');

  // Baris tutup berada tepat sebelum surface.
  assert.strictEqual(bar.nextElementSibling, surface, 'baris ✕ harus tepat di atas surface');
});

test('BS-10: klik ✕ di casing meneruskan ke handler aslinya lalu menutup sheet', () => {
  const { dom, content } = boot(LEGACY_BODY_CONTENT);
  const api = dom.window.XentraPresentation;
  api.open({ id: 'kategori', type: 'bottom-sheet', content: content });

  let forwarded = 0;
  content.querySelector('.x-modal-close').addEventListener('click', function () { forwarded += 1; });

  dom.window.document.querySelector('.x-presentation-sheet-close')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.strictEqual(forwarded, 1, 'klik harus diteruskan ke tombol tutup asli');
  assert.strictEqual(api.isOpen('kategori'), false, 'sheet harus tertutup');
});

test('BS-11: menutup sheet mengembalikan konten seperti semula', () => {
  const { dom, content } = boot(LEGACY_BODY_CONTENT);
  const api = dom.window.XentraPresentation;
  api.open({ id: 'kategori', type: 'bottom-sheet', content: content });
  api.close('kategori');

  assert.strictEqual(content.classList.contains('x-presentation-close-relocated'), false,
    'penanda pindah harus dilepas supaya pemanggilan berikutnya bersih');
  assert.strictEqual(content.hidden, true, 'konten dikembalikan dalam keadaan hidden');
  assert.strictEqual(dom.window.document.querySelector('.x-presentation-sheet-close'), null,
    'tombol ✕ di casing ikut hilang bersama shell');
});

test('BS-12: dialog dan konten tanpa tombol tutup tidak diberi ✕ di casing', () => {
  const dialogBoot = boot(LEGACY_BODY_CONTENT);
  dialogBoot.dom.window.XentraPresentation.open({
    id: 'dialog', type: 'dialog', content: dialogBoot.content
  });
  assert.strictEqual(dialogBoot.dom.window.document.querySelector('.x-presentation-sheet-close'), null,
    'dialog bukan bottom sheet, jadi tidak boleh dapat baris ✕');

  const noCloseBoot = boot('<div class="x-modal-header"><div><h3>Tanpa ✕</h3></div></div>');
  noCloseBoot.dom.window.XentraPresentation.open({
    id: 'tanpa-tutup', type: 'bottom-sheet', content: noCloseBoot.content
  });
  assert.strictEqual(noCloseBoot.dom.window.document.querySelector('.x-presentation-sheet-close'), null,
    'konten tanpa .x-modal-close tidak ditambahi tombol tutup');
});

test('BS-14: satu klik ✕ menutup semuanya sekaligus — fokus input (keyboard) ikut lepas', () => {
  const { dom, content } = boot(
    '<div class="x-modal-header"><div><h3>Ubah Kategori</h3></div>' +
      '<button class="x-modal-close" aria-label="Tutup">&#10005;</button></div>' +
    '<form class="x-form"><div class="x-form-group">' +
      '<label>Nama Kategori</label><input id="fld" class="x-input" type="text">' +
    '</div></form>'
  );
  const w = dom.window, d = w.document;
  const api = w.XentraPresentation;

  api.open({ id: 'kategori', type: 'bottom-sheet', content: content });

  const input = d.querySelector('#fld');
  input.focus();
  assert.strictEqual(d.activeElement, input, 'input ter-fokus dulu (keyboard mobile terbuka)');

  d.querySelector('.x-presentation-sheet-close')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  assert.strictEqual(api.stackSize(), 0, 'stack dikosongkan dalam satu klik (bukan dua tahap)');
  assert.strictEqual(d.querySelector('.x-presentation-shell'), null, 'shell langsung dilepas');
  assert.notStrictEqual(d.activeElement, input,
    'fokus input ikut lepas saat subtree-nya dilepas, jadi keyboard turun bersamaan');
});

test('BS-13: bottom sheet yang tidak dismissible tidak diberi ✕ di casing', () => {
  const { dom, content } = boot(LEGACY_BODY_CONTENT);
  dom.window.XentraPresentation.open({
    id: 'wajib', type: 'bottom-sheet', content: content, dismissible: false
  });

  const d = dom.window.document;
  assert.strictEqual(d.querySelector('.x-presentation-sheet-close'), null,
    'sheet yang tidak boleh ditutup tidak boleh punya tombol tutup');
  assert.strictEqual(content.classList.contains('x-presentation-close-relocated'), false,
    'tombol asli di header dibiarkan apa adanya');
});
