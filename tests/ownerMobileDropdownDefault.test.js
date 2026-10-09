/**
 * Regression: DEFAULT DROPDOWN Owner Mobile.
 *
 * Gaya dropdown filter "Semua Kategori" di Produk Master (`.x-occ-dropdown`)
 * dijadikan kontrak default untuk dropdown lain di owner mobile:
 * pemilih periode/keuangan/pesanan, pemilih cabang (`.x-branch-dropdown`), dan
 * select native. Sumbernya satu: blok shared di merchant-shared/css/dashboard.css.
 *
 * Yang diuji:
 *   DD-01..05  kontrak visual: trigger, menu, item, checkmark, state aktif
 *   DD-06      state disabled
 *   DD-07      select native memakai kontrak yang sama
 *   DD-08      ikon (chevron & checkmark) seragam
 *   DD-09..10  tidak ada gaya per halaman; scope mobile + tidak menyentuh merchant app
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '../apps/merchant-shared/css/dashboard.css');
const HTML_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const DASHBOARD_JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');

const css = fs.readFileSync(CSS_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const dashboardJs = fs.readFileSync(DASHBOARD_JS_PATH, 'utf8');

function ruleBody(selectorPattern) {
  const match = css.match(selectorPattern);
  assert.ok(match, 'aturan harus ada: ' + selectorPattern);
  return match[1];
}

// Blok ber-indentasi 2 spasi = berada di dalam @media (max-width: 768px).
const TRIGGER = /^  \.x-occ-dropdown-trigger \{([\s\S]*?)^  \}/m;
const MENU = /^  \.x-occ-dropdown-menu,\n  \.x-branch-dropdown-menu \{([\s\S]*?)^  \}/m;
const ITEM = /^  \.x-occ-dropdown-item,\n  \.x-branch-dropdown-item \{([\s\S]*?)^  \}/m;
const SELECT = /^  body:not\(\.x-merchant-app\) select \{([\s\S]*?)^  \}/m;

// ── DD-01..05: kontrak visual ──

test('DD-01: trigger dropdown memakai kontrak acuan (rounded, touch-friendly, chevron kanan)', () => {
  const body = ruleBody(TRIGGER);

  assert.ok(/height:\s*42px/.test(body), 'tinggi touch-friendly 42px');
  assert.ok(/border:\s*1px solid #cbd5e1/.test(body), 'border tipis');
  assert.ok(/border-radius:\s*12px/.test(body), 'rounded');
  assert.ok(/justify-content:\s*space-between/.test(body), 'label kiri, chevron kanan');
  assert.ok(/font-size:\s*14px/.test(body) && /font-weight:\s*700/.test(body), 'typography owner mobile');
  assert.ok(/background:\s*#f8fafc/.test(body), 'latar field');
  assert.ok(/padding:\s*0 12px/.test(body), 'spacing kiri/kanan konsisten');
});

test('DD-02: permukaan menu dipakai bersama dropdown lain, bukan hanya halaman Kategori', () => {
  const body = ruleBody(MENU);

  assert.ok(/border-radius:\s*14px/.test(body), 'menu rounded');
  assert.ok(/box-shadow:/.test(body), 'shadow ringan');
  assert.ok(/background:\s*#ffffff/.test(body));
  // Selector gabungan membuktikan menu ini milik semua dropdown owner mobile.
  assert.ok(/^  \.x-occ-dropdown-menu,\n  \.x-branch-dropdown-menu \{/m.test(css),
    'menu .x-occ-dropdown dan .x-branch-dropdown harus satu aturan');
});

test('DD-03: menu dropdown di atas bottom nav, tetap di bawah modal/bottom sheet', () => {
  const body = ruleBody(MENU);
  const menuZ = Number((body.match(/z-index:\s*(\d+)/) || [])[1]);
  const navZ = Number((css.match(/\.x-owner-bottom-nav \{[^}]*z-index:\s*(\d+)/s) || [])[1]);
  const sheetZ = Number((css.match(/\.x-bottom-sheet-overlay \{[^}]*z-index:\s*(\d+)/s) || [])[1]);

  assert.ok(menuZ >= 220, 'menu harus punya z-index >= 220, dapat ' + menuZ);
  assert.ok(menuZ > navZ, 'menu (' + menuZ + ') harus di atas bottom nav (' + navZ + ')');
  assert.ok(menuZ < sheetZ, 'menu (' + menuZ + ') harus di bawah bottom sheet (' + sheetZ + ')');
});

test('DD-04: menu tidak boleh keluar viewport (dibatasi tinggi + bisa di-scroll)', () => {
  const body = ruleBody(MENU);

  assert.ok(/max-height:\s*min\(320px, 50dvh\)/.test(body), 'tinggi menu dibatasi tinggi layar');
  assert.ok(/overflow-y:\s*auto/.test(body), 'menu panjang bisa di-scroll');
  assert.ok(/overscroll-behavior:\s*contain/.test(body), 'scroll tidak menular ke halaman');
});

test('DD-05: item menu touch-friendly, aktif = abu-abu sangat muda + checkmark kanan', () => {
  const body = ruleBody(ITEM);

  assert.ok(/padding:\s*10px 12px/.test(body), 'padding item touch-friendly');
  assert.ok(/justify-content:\s*space-between/.test(body), 'teks kiri, checkmark kanan');

  const active = css.match(/^  \.x-occ-dropdown-item\.active,\n  \.x-branch-dropdown-item\.active \{([\s\S]*?)^  \}/m);
  assert.ok(active, 'aturan item aktif harus ada');
  assert.ok(/background:\s*#f8fafc/.test(active[1]), 'item aktif memakai abu-abu sangat muda');

  const checkActive = css.match(/^  \.x-occ-dropdown-item\.active \.x-occ-check-icon,\n  \.x-branch-dropdown-item\.active \.x-branch-check-icon \{([\s\S]*?)^  \}/m);
  assert.ok(checkActive, 'aturan checkmark aktif harus ada');
  assert.ok(/opacity:\s*1/.test(checkActive[1]), 'checkmark tampil hanya untuk item aktif');
});

// ── DD-06..07: state & select native ──

test('DD-06: state disabled tersedia untuk trigger dan select', () => {
  assert.ok(/\.x-occ-dropdown-trigger:disabled,/.test(css), 'trigger disabled state ada');
  assert.ok(/\.x-occ-dropdown\.is-disabled \.x-occ-dropdown-trigger/.test(css), 'state disabled via kelas ada');
  assert.ok(/body:not\(\.x-merchant-app\) select:disabled \{/.test(css), 'select disabled state ada');
  assert.ok(/body:not\(\.x-merchant-app\) select:focus-visible \{/.test(css), 'state focused select ada');
});

test('DD-07: select native memakai kontrak visual yang sama', () => {
  const body = ruleBody(SELECT);

  assert.ok(/-webkit-appearance:\s*none/.test(body) && /appearance:\s*none/.test(body),
    'tampilan default desktop dimatikan');
  assert.ok(/height:\s*42px/.test(body), 'tinggi sama dengan trigger');
  assert.ok(/border-radius:\s*12px/.test(body), 'rounded sama');
  assert.ok(/border:\s*1px solid #cbd5e1/.test(body), 'border sama');
  assert.ok(/font-size:\s*14px/.test(body) && /font-weight:\s*700/.test(body), 'typography sama');
  assert.ok(/background-image:\s*url\("data:image\/svg\+xml/.test(body), 'chevron digambar sendiri');
  assert.ok(/background-position:\s*right 12px center/.test(body), 'chevron di kanan');
  assert.ok(/padding:\s*0 36px 0 12px/.test(body), 'teks tidak menabrak chevron');
});

// ── DD-08..10: ikon, tanpa tambal per halaman, scope ──

test('DD-08: ikon chevron & checkmark seragam di semua dropdown', () => {
  // Chevron trigger (acuan) dan chevron di markup lain memakai kelas yang sama.
  const chevrons = html.match(/class="x-occ-chevron-icon"/g) || [];
  assert.ok(chevrons.length >= 3, 'chevron dipakai semua dropdown kustom, dapat ' + chevrons.length);

  const checkMarkup = '<svg class="x-occ-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  assert.ok(html.includes(checkMarkup), 'checkmark statis memakai markup acuan');
  assert.ok(dashboardJs.includes(checkMarkup.replace('x-occ-check-icon', 'x-occ-check-icon')),
    'checkmark yang dirender JS memakai markup yang sama');
  assert.ok(dashboardJs.includes('class="x-branch-check-icon" width="14" height="14"'),
    'checkmark pemilih cabang memakai ukuran ikon yang sama');
});

test('DD-09: tidak ada gaya dropdown yang di-scope per halaman', () => {
  const pageIds = [
    '#product-list-view', '#tab-catalog-products', '#tab-catalog-categories',
    '#customers-list-view', '#branch-list-view', '#orders-list-view',
    '#tab-marketing', '#tab-finance', '#tab-branches', '#tab-stock', '#tab-settings'
  ];

  const dropdownRules = css.match(/^[^\n]*\.x-(occ|branch)-dropdown[^\n]*\{/gm) || [];
  assert.ok(dropdownRules.length > 0, 'aturan dropdown harus ada');

  dropdownRules.forEach((rule) => {
    assert.ok(!/^#/.test(rule.trim()),
      'selector dropdown tidak boleh dimulai dengan id halaman: ' + rule.trim());
    pageIds.forEach((id) => {
      assert.ok(!rule.includes(id),
        'aturan dropdown tidak boleh di-scope ' + id + ': ' + rule.trim());
    });
  });
});

test('DD-10: kontrak dropdown hidup di blok mobile dan tidak menyentuh merchant app', () => {
  // Blok berada di dalam @media (max-width: 768px): tidak ada penutup top-level
  // sebelum aturan dropdown antara media query terakhir dan aturan ini.
  const triggerIdx = css.search(TRIGGER);
  const before = css.slice(0, triggerIdx);
  const mediaIdx = before.lastIndexOf('@media (max-width: 768px) {');
  assert.ok(mediaIdx !== -1, 'aturan dropdown harus berada di dalam media query mobile');
  assert.ok(!/\n\}/.test(before.slice(mediaIdx)), 'tidak boleh keluar dari media query sebelum aturan dropdown');

  // Select native di-scope ke owner mobile; merchant app dibiarkan.
  assert.ok(!/^\s*select \{/m.test(css), 'tidak boleh menata select secara global');
  assert.ok(/body:not\(\.x-merchant-app\) select \{/.test(css), 'skin select hanya untuk owner mobile');
});
